---
created_at: 2026-10-05T22:31:46Z
updated_at: 2026-10-05T22:31:46Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops State Assignment Plan V01 Assessment

## Summary

The plan follows PRD V10 and reuses the Phase 5 patterns that already passed review:

- Monitoring-limit marker tied to job ID and `createdAt`.
- `startedAt` optional on jobs that end before they start.
- Dedicated start, progress, and completion persistence methods.

I checked it against worker-node's state assigner, queue engine, and job store, and against the Phase 5 ops persistence code. Three concerns qualify. Each one can leave Phase 6 unable to complete, or keep starting AI jobs that are never accepted.

This matters more for Phase 6 than for earlier phases. If a run gets stuck here, the operator's only exit is `--new-run`. Within 72 hours, RSS repeat suppression would make the new run's `articleCount` close to zero, so this week's Articles would never reach Phase 7.

## Concern 1: Existing early returns break the result contract

Criteria: the plan will not work as intended; it misreads the current worker code.

The plan defines `failedCount` as Articles whose processing "raised a non-cancellation error". It also says to save the result "before it returns normally." The current code has two normal-return paths that skip both:

1. In `processStateAssignmentsWithTimeout`, the catch block runs `if (signal.aborted || isAbortError(error)) return;`. `isAbortError` matches any `Error` whose message contains `aborted`. The queue does not have to be canceled. For example, a Postgres "current transaction is aborted" error during `persistAssignment` ends the whole loop.
2. In `runLegacyWorkflow`, the enrichment catch block uses the same test and returns before `processAssignments` runs.

In both cases the queue signal is not aborted, so the queue engine marks the job `completed`. Here is what happens:

1. Path 1 returns with counts where `selectedCount > completed + skipped + failed`. Path 2 returns before any result is saved.
2. Ops sees `completed` with an invalid or missing result.
3. Recovery rule 7 stops Phase 6 without a replacement.
4. Every continuation reads the same record and stops the same way.

The plan's "refactor to return its counters" step does not mention these paths. An implementer could keep the `return` and still pass every planned test.

Recommendation:

- Exit early only when the queue `signal.aborted` is true. Count any other error, including abort-like messages, as `failedCount` and continue.
- Make every normal return save a result: zero selected, enrichment failure, and loop completion.
- Add worker tests for a non-cancellation error whose message contains `aborted`, both during persistence and during enrichment.

## Concern 2: Missing queue parameters can cause repeated replacements

Criteria: the plan will not work as intended; recovery could loop.

The plan says to treat a "parameter mismatch" as an unavailable saved job, which allows a replacement. It treats "malformed ... parameters" as invalid, which stops the run. It does not say which rule covers a status record with no `parameters` at all.

That record is exactly what the current worker-node returns. `enqueueJob` never writes `parameters`. If ops Phase 6 runs before the worker-node update is deployed and restarted (the rollout section warns about this, but nothing enforces it), and missing parameters count as a mismatch:

1. Ops starts a job. The first status lookup has no parameters, so the job is unavailable. The job was started in this invocation, so ops stops.
2. The job still runs in worker-node and persists state assignments.
3. The next continuation sees the same missing parameters and starts one replacement. That replacement also runs, assigns another `articleCount` Articles, and is rejected.
4. Each continuation repeats this until the 72-hour window ends. That spends AI calls on work that is never accepted.

Recommendation:

- Treat missing `parameters` or a missing parameter key as invalid and unverified. Stop with no replacement.
- Keep "unavailable" for a record that has both parameters with different values, which means the job ID was reused.
- Make the stop message say that worker-node probably lacks the Phase 6 contract.
- Add a client test for a status record with no parameters.

## Concern 3: The 24-hour limit may be shorter than one full job

Criteria: the plan will not work as intended for larger weeks; this limit was not reviewed by the operator.

Phase 6 work grows with `articleCount`, unlike Phase 5:

- Codex CLI backend: up to 180 seconds per Article (`DEFAULT_CODEX_TIMEOUT_SECONDS`). That is about 480 Articles in 24 hours at the timeout ceiling.
- Pre-scrape enrichment runs first, for every candidate, with its own per-Article timeout.
- Time spent waiting in worker-node's single global queue also counts toward the limit.

The plan's own replacement rule then prevents progress:

1. A large-week job reaches 24 hours and is canceled.
2. The replacement sends the same full `articleCount`, as the plan requires.
3. The worker excludes Articles that are already assigned, so the replacement selects a full `articleCount` of older unassigned Articles within 180 days. It does not select only the unfinished remainder.
4. The replacement can reach the limit for the same reason. Phase 6 never completes, and later replacements process Articles further and further outside the Phase 7 window.

Recommendation:

- Add an open question so the operator can set the monitoring limit, as was done for Phase 5's six-hour limit.
- Alternatively, derive the limit from `articleCount` and the configured per-Article timeout, with a floor.
- State in the README that a monitoring-limit replacement does not resume the remainder. It starts a new newest-first selection.

## Non-blocking notes

- Persistence-gap recovery (rule 6) can start a second full job if the first start reached worker-node. Both run in sequence. The second assigns up to `articleCount` older Articles. The PRD accepts the Phase 4 version of this, but the README should mention the extra AI cost.
- The threshold is stored in the `targetArticleThresholdDaysOld` column and in `phaseData.phase6.input`. Say which one is authoritative, and have the start method write both in one update.
