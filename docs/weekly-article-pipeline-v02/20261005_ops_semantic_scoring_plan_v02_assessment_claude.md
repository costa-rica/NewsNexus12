---
created_at: 2026-10-05T21:33:38Z
updated_at: 2026-10-05T21:33:38Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops Semantic Scoring Plan V02 Assessment

## Summary

V02 resolves all three V01 concerns and applies the operator's six-hour decision:

- Phase 4 is skipped when it is already complete. A new coordinator test covers it.
- `recordPhaseFiveStarted` refuses a second start, so the original `startedAt` cannot be overwritten.
- A six-hour per-invocation limit cancels the job, exits with an error, and releases the lock.
- The non-blocking notes from the V01 assessment are also addressed: setting defaults, separate 404 meanings, and an immediate first status check.

I checked the new cancellation and recovery rules against worker-node's queue code and the existing `ops/` persistence helpers. Two concerns qualify. Both can leave Phase 5 stuck, and both come from the new six-hour limit path.

## Concern 1: Jobs that never started are rejected as invalid

Criteria: the plan will not work as intended; it conflicts with the worker-node contract.

Job identity validation rule 4 says: "Require a valid `startedAt` for `running` and terminal jobs."

Worker-node does not set `startedAt` on a terminal job that never left the queue:

- Canceling a queued job sets `status = canceled`, `endedAt`, and `failureReason = canceled_before_start`. It does not set `startedAt` (`worker-node/src/modules/queue/queueEngine.ts`, `cancelJob`).
- A worker restart marks a queued job `failed` with `worker_restart` and `endedAt`, again without `startedAt` (`worker-node/src/modules/startup/queueMaintenance.ts`).

The first case is exactly what the new six-hour limit produces when the semantic job is still waiting behind another job. Here is what happens:

1. A semantic job sits `queued` for six hours behind a long portal job.
2. Ops cancels it. Worker-node returns `outcome = canceled`, and ops exits with an error, as intended.
3. The operator continues the run. Ops looks up the saved job: `canceled` with no `startedAt`.
4. Rule 4 rejects the record as invalid, and rule 8 classifies it as "invalid and unverified." Ops stops without starting a replacement.
5. Every later continuation reads the same record and stops the same way. Phase 5 can only move forward with `--new-run`, which repeats Phases 1–3.

The planned test "Immediate queued cancellation" would pass, because it covers the cancel call itself. The continuation that follows is what fails.

Phase 4's client already handles this correctly. It treats `startedAt` as optional and only validates it when present (`ops/src/weekly-flow-02/phases/04_googleNewsRssClient.ts`).

Recommendation:

- Require `startedAt` only for `running` and `completed`.
- Make it optional for `failed` and `canceled`. Validate the time order only when it is present.
- Add tests for continuing past a `canceled_before_start` job and a queued job that failed with `worker_restart` (no `startedAt`). Both should be eligible for one replacement.

## Concern 2: The monitoring-limit marker is not tied to a specific job

Criteria: the plan will not work as intended; recovery can get stuck or accept a late result.

Recovery rules 2–5 depend on a persisted record that the six-hour limit was reached. The plan stores it through `recordPhaseFiveProgress` as "`monitoringLimitReachedAt`, cancellation request time, outcome." It does not say which job the record belongs to, or that later progress writes must keep it.

Both gaps cause failures with the existing persistence helpers.

### 2a. The marker can be overwritten

The plan says to save "compact latest progress under `phaseData.phase5`." Phase 4 saves its latest progress as one `progress` object. `mergePhaseData` replaces that whole object on every update (`ops/src/weekly-flow-02/sequelizePersistence.ts`). If the Phase 5 marker sits inside the latest-progress object, the next progress write deletes it:

1. Invocation A reaches six hours. Cancellation is requested but not confirmed, and the job is still `running`. The marker is saved.
2. Invocation B sees the marker, looks up the job, and saves that status observation as the new latest progress. The marker is now gone. B cancels again and exits.
3. The job then finishes with `completed`.
4. Invocation C finds no marker, sees a valid `completed` job, and marks Phase 5 complete.

This breaks the plan's rule: "Never mark Phase 5 complete from that job afterward."

### 2b. A replacement job inherits the old marker

After a confirmed inactive limited job, rule 5 allows one replacement. If the marker is not tied to a job ID, the next continuation sees "monitoring limit reached." It then treats the healthy replacement as a limited job:

- If the replacement is still running, ops cancels it immediately.
- If it completed, ops never trusts the result. It starts another replacement, which inherits the same marker.

Phase 5 could then never complete.

Recommendation:

- Store the marker as its own field, separate from latest progress. For example, use `phaseData.phase5.monitoringLimitedJobId`, plus the time and the cancellation details.
- Treat a job as monitoring-limited only when its ID matches `monitoringLimitedJobId`.
- Never clear or overwrite the marker through progress updates. A new limit on a replacement job replaces it with that job's ID.
- Add persistence tests showing the marker survives later progress writes. Add coordinator tests showing a replacement job is monitored normally, and that its `completed` result is accepted.

## Non-blocking notes

- A cancel can be overtaken by a normal finish. If the job finishes while cancellation is pending, worker-node records `canceled`, not `completed`, because `queueEngine` checks `cancelRequested` after the handler returns. That agrees with the plan's never-trust rule. The README can mention it.
- Repeated cancel requests are expected. While a database call that has no timeout is hanging, the scorer cannot see the abort, so each continuation sends another cancel and exits. The README's operator notes could say that a worker-node restart is the remedy when a job ignores cancellation.
