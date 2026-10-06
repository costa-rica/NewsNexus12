---
created_at: 2026-10-05T21:00:56Z
updated_at: 2026-10-05T21:23:07Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops Semantic Scoring Plan V01 Assessment

## Summary

The plan follows the PRD V10 Phase 5 contract closely:

- Untargeted start with an empty body, matching `worker-node/src/routes/semanticScorer.ts`.
- Job identity checks that reuse the Phase 4 pattern, which protects against reused job IDs.
- An accurate reading of what `completed` means. The worker skips articles without text, per-article timeouts, and per-article errors internally, so queue completion is not proof of full coverage.
- One start per invocation, and continuation checks the saved job first.

I checked the plan against the current `ops/` coordinator, persistence layer, Phase 4 module, and worker-node queue code. Three concerns qualify. The first one stops every Phase 5 continuation from working.

## Concern 1: Continued runs fail at Phase 4 before reaching Phase 5

Criteria: the plan will not work as described for continuation.

Coordinator flow step 2 says: "Execute or continue Phases 1 through 4 as currently implemented."

In the current code, `runCoordinator` skips Phases 1–3 when `lastPhaseCompleted >= 3`. It always calls `collectRss` (`ops/src/weekly-flow-02/coordinator.ts`, the Phase 4 `try` block). `ensurePhaseFourStarted` then throws when Phase 4 is already complete:

```ts
if ((run.lastPhaseCompleted ?? 0) >= 4) {
  throw new CollectGoogleNewsRssError('invalid_run_state', 'Phase 4 is already complete');
}
```

(`ops/src/weekly-flow-02/phases/04_collectGoogleNewsRss.ts:131`)

Here is what happens to a run that is continued after Phase 4 has completed:

1. Phase 4 completes with `articleCount > 0`, so `lastPhaseCompleted = 4`.
2. Phase 5 starts. The semantic job is interrupted, fails, or monitoring stops as unverified.
3. The operator triggers a continuation within 72 hours. Run selection continues the run.
4. The coordinator calls `collectRss` again. It throws `invalid_run_state`, and `recordFailure` saves that as a Phase 4 failure.
5. Phase 5 never runs. Every later continuation fails in the same way. Only `--new-run` gets past it, and that repeats the destructive Phases 1–3.

The same failure affects the plan's rule "When a continued run already has Phase 5 completed... log the Phase 6 boundary and return successfully." That run also fails at Phase 4 before the coordinator can log the boundary.

The planned coordinator tests ("Continuation monitoring a saved active semantic job" and "Already completed Phase 5 not rerunning semantic scoring") would expose this. The plan should still state the required change so the todo includes it.

Recommendation:

- Gate the Phase 4 block on `lastPhaseCompleted < 4`, the same way Phases 1–3 are already gated on `< 3`.
- When Phase 4 is skipped, log that it was already completed and keep its persisted `articleCount`.
- Then apply the Phase 5 entry check: Phase 4 completed and `articleCount > 0`. After that, either start or continue Phase 5, or log the Phase 6 boundary.
- Add a coordinator test: a continued run with `lastPhaseCompleted = 4` must not call `collectRss`.

## Concern 2: Unbounded monitoring can silently block later weekly triggers

Criteria: risk to existing functionality, namely the single-execution guard and scheduling.

The plan deliberately has no Phase 5 duration limit: "An active semantic-scorer job can therefore remain monitored until it reaches a terminal state, the coordinator is stopped, or status monitoring becomes unverified."

Monitoring is unbounded in these cases:

- The status endpoint keeps answering.
- The job stays `queued` or `running` and never reaches a terminal state.

The coordinator holds the `flock` guard the whole time (`ops/scripts/runWeeklyFlow02.sh`). The README says guard rejection exits with 75, and a future systemd service must treat that as success. Every later trigger would then be an expected no-op. Nothing would report it as a failure.

This is a realistic scenario, for these reasons:

- Worker-node uses a single global queue. A semantic job can sit `queued` behind a long portal-triggered job, such as an article-content scrape or a state-assigner run, for any length of time.
- Inside the semantic job, `Article.findAll` and the per-article `upsert` have no timeout. `withTimeout` gives up waiting after 10 seconds, but it does not cancel the underlying work.
- The PRD added the Phase 4 24-hour limit specifically because a stuck job blocks the global queue. The same reasoning applies to the coordinator process that holds the guard.

Observed semantic runtimes are minutes, not hours. Manual job `0272` scored 871 articles in about 3.5 minutes (`docs/weekly-article-flow-v01/20260929_weekly_article_flow_run_4_failure_report.md`). A generous limit would never affect a healthy run.

Recommendation: keep the "no cancellation" scope, but bound each invocation's monitoring.

- Add `SEMANTIC_SCORER_MONITORING_LIMIT_HOURS`, for example 6. The 6 is a suggestion, not a measured value.
- When the limit is reached, stop as an unverified outcome without canceling. Preserve `semanticScorerJobId` so a continuation checks the same job first. This reuses the existing recovery rule 6.
- Measure the limit from when this invocation began monitoring, not from the original Phase 5 start. That avoids the continuation lockout found in the Phase 4 V03 assessment.

If the operator prefers no limit, the plan should say so explicitly, and the README should say that a stuck semantic job can suppress later triggers until someone stops the coordinator. See open question 1.

## Concern 3: The generic start operation can overwrite the original Phase 5 start time

Criteria: the plan will not work as intended if implemented with the existing persistence operations.

The plan requires: "Preserve the first Phase 5 `startedAt` across continuation." It also relies on that value for the identity check `createdAt >= Phase 5 startedAt`.

The plan adds a dedicated progress operation but no dedicated start operation. That implies Phase 5 starts through the generic `recordPhaseStarted`. That operation does not protect the start time:

- `assertCanStartPhase` only checks `phase === lastPhaseCompleted + 1`. It allows Phase 5 to be "started" again while `lastPhaseStarted = 5` and `lastPhaseCompleted = 4`.
- `mergePhaseData` writes `status: 'started'` and a new `startedAt` over `phaseData.phase5`.

If the module calls `recordPhaseStarted(5)` on continuation, through a wrong branch or a later refactor, the saved job's `createdAt` is now earlier than the new `startedAt`. The plan then classifies that job as unavailable and starts a replacement, even if the saved job is still running or has already completed. The only safeguard would be one condition in the caller.

Phase 4 avoids this. `recordPhaseFourStarted` refuses to run again once its marks are set.

Recommendation:

- Add `recordPhaseFiveStarted`. It should reject the call when `lastPhaseStarted === 5` or when `phaseData.phase5.startedAt` already exists.
- Alternatively, make the generic `recordPhaseStarted` reject a phase that is already the active started phase. Phase 4 already bypasses the generic operation, and Phases 1–3 always run on a new run, so this change does not affect them.
- Add a persistence test showing that a second Phase 5 start is rejected and the original `startedAt` is unchanged.

## Non-blocking notes

- New required settings affect every phase. `requiredPositiveInteger` makes the two new settings mandatory when the config loads. Until each host's `.env` is updated, every invocation fails at startup, including Phases 1–4 and continuations. The todo should update the development and production `.env` files before deployment, or give the settings defaults.
- Start-request 404 is a configuration error. `POST /semantic-scorer/start-job` returns 404 when `PATH_TO_SEMANTIC_SCORER_DIR` or the keywords workbook is missing. The client should classify that as a permanent start rejection, not as the "unavailable saved job" meaning that a 404 has for status requests.
- A reused job ID can match a portal-triggered job. A later portal-triggered semantic job that reuses the saved ID after the store resets passes every identity check. For untargeted semantic scoring this is harmless, because it scored the same backlog. The README can mention it.
- Some planned items cannot be distinguished. Ops cannot tell zero work from any other `completed` job, because worker-node returns no counts. So the test "Empty semantic work advancing" duplicates the completed-job test. Likewise, the "completed with no structured result" flag is always true today. Both are harmless, but the todo should not suggest that ops detects zero work.
- First poll timing. Healthy jobs finish in about 3–4 minutes, so a run gains up to 5 minutes of idle wait if the first status check comes after a full interval. That is acceptable. The plan could state whether it does an immediate first check, to match Phase 4's behavior.

## Open Questions

### 1. Phase 5 per-invocation monitoring limit

Should one coordinator invocation stop monitoring an active semantic job after a fixed time, without canceling it, so the guard is released?

#### Operator Response

Use a 6-hour limit as a last resort. When it is reached, cancel the semantic job, exit the weekly flow with an error, and release the lock.
