---
created_at: 2026-10-05T21:39:38Z
updated_at: 2026-10-05T21:41:02Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops Semantic Scoring Todo V01

## Purpose

Implement Phase 5 of weekly-flow-02 from `20261005_ops_semantic_scoring_plan_v03.md`.

The implementation starts worker-node semantic scoring without Article targeting, monitors and recovers its queue job, persists a verified completion, and stops at the Phase 6 boundary.

This todo does not implement Phase 6, Phase 7, systemd scheduling, or a general worker-job framework.

## Final Review Decisions

- Add a dedicated `recordPhaseFiveCompleted` persistence operation.
- Do not complete Phase 5 through the generic `recordPhaseCompleted` path.
- Make the generic completion path reject Phase 5 so future callers cannot bypass monitoring-limit validation.
- `recordPhaseFiveCompleted` must reject a job whose ID and `createdAt` match the durable monitoring-limit marker.
- When status returns 404, the saved job is unavailable. There is no record whose `createdAt` can be compared with the marker, so use the normal unavailable-job replacement rule.
- Preserve an old monitoring-limit marker for compact audit and recovery state. It affects only a job matching both its ID and `createdAt`.

## Implementation Guardrails

- Preserve the operator's unrelated working-tree changes, including the current archive moves.
- Do not modify or review files under `docs/archive/` for implementation context.
- Do not pass `articleCount`, `articleIdMinExclusive`, or `articleIdMaxInclusive` to worker-node.
- Do not recalculate or modify the Phase 4 `articleCount`.
- Do not change worker-node's semantic-scorer route or job contract unless a newly discovered blocker is documented and reviewed.
- Keep default ops tests independent of PostgreSQL, worker-python, worker-node, and package `.env` files.
- Start at most one semantic-scorer job per coordinator invocation.
- Never mark a monitoring-limited job as Phase 5 completion.
- Never start a replacement while a saved job is still verified active.
- Do not automatically restart worker-node.

## Phase 1: Add Configuration and the Worker Client

- [ ] Re-read the accepted V03 plan, current `ops/src/config.ts`, Phase 4 worker client, worker-node semantic-scorer route, queue-info route, and queue record types before editing.
- [ ] Add optional `OpsConfig` fields with these defaults:
  - [ ] `semanticScorerStatusPollIntervalSeconds = 300`
  - [ ] `semanticScorerToleratedConsecutiveStatusFailures = 2`
  - [ ] `semanticScorerMonitoringLimitHours = 6`
- [ ] Refactor or add a configuration helper that accepts a setting-specific default instead of reusing the current hard-coded optional value.
- [ ] Validate every explicitly supplied Phase 5 setting as a positive safe integer.
- [ ] Extend `ops/tests/config.test.ts` for defaults, explicit valid values, zero, negative, fractional, empty, and nonnumeric values.
- [ ] Add `ops/src/weekly-flow-02/phases/05_semanticScorerClient.ts`.
- [ ] Define typed start, status, cancellation, job-record, and client-error results.
- [ ] Start semantic scoring with `POST /semantic-scorer/start-job`, `Content-Type: application/json`, and `{}` as the complete request body.
- [ ] Require HTTP 202, a non-empty `jobId`, `status = queued`, and `endpointName = /semantic-scorer/start-job` from the start response.
- [ ] Classify a start-request 404 as a permanent start rejection, not as an unavailable saved job.
- [ ] Read status with `GET /queue-info/check-status/:jobId`.
- [ ] Classify a status-request 404 as an unavailable saved job.
- [ ] Cancel with `POST /queue-info/cancel_job/:jobId` and accept only `canceled` or `cancel_requested`.
- [ ] Classify a cancellation 404 separately so the phase module can perform one follow-up status lookup.
- [ ] Apply `workerNodeRequestTimeoutSeconds` to start, status, and cancellation requests.
- [ ] Distinguish request timeout, connection failure, temporary server response, permanent response, invalid response, and unavailable-job errors.
- [ ] Validate common job identity:
  - [ ] Exact semantic-scorer endpoint name.
  - [ ] Valid `createdAt` at or after the original persisted Phase 5 start.
  - [ ] Known queue status.
- [ ] Validate status-specific timestamps:
  - [ ] `queued` requires no additional timestamp.
  - [ ] `running` requires `startedAt` and `createdAt <= startedAt`.
  - [ ] `completed` requires `startedAt` and `endedAt` with chronological ordering.
  - [ ] `failed` and `canceled` require `endedAt`; `startedAt` is optional and is checked only when present.
- [ ] Add `ops/tests/weekly-flow-02/05_semanticScorerClient.test.ts`.
- [ ] Cover valid lifecycle shapes, malformed fields, unknown status, endpoint mismatch, reused old job ID, and non-chronological timestamps.
- [ ] Cover `canceled_before_start` and queued `worker_restart` records without `startedAt`.
- [ ] Cover start, status, and cancellation HTTP classifications and request timeouts.
- [ ] Add the compiled Phase 5 client test to the explicit `ops/package.json` test command.
- [ ] Run the Phase 1 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat until all checks pass.
- [ ] Check off completed Phase 1 tasks.
- [ ] Commit only Phase 1 changes using the repository commit guidance, a lowercase title, a concise body when required, and `co-authored-by: codex (gpt-6.1-sol)`.

## Phase 2: Add Protected Phase 5 Persistence

- [ ] Extend `ops/src/weekly-flow-02/persistence.ts` with typed Phase 5 start, progress, monitoring-limit, and completion inputs.
- [ ] Add `recordPhaseFiveStarted(runId, startedAt)` to `WeeklyFlowPersistence`.
- [ ] Require Phase 4 completion, positive persisted `articleCount`, incomplete run state, and Phase 5 as the next phase.
- [ ] Reject a second Phase 5 start when `lastPhaseStarted = 5` or `phaseData.phase5.startedAt` already exists.
- [ ] Persist `lastPhaseStarted = 5`, `status = started`, and the original Phase 5 `startedAt` together.
- [ ] Add `recordPhaseFiveProgress(runId, progress)`.
- [ ] Require Phase 5 to be the active incomplete phase and preserve its original `startedAt`.
- [ ] Save a validated non-empty `semanticScorerJobId` immediately after a valid start response.
- [ ] Store ordinary status observations only under `phaseData.phase5.latestProgress`.
- [ ] Ensure an ordinary progress write replaces only `latestProgress` and preserves sibling `startedAt`, `monitoringLimit`, and any result.
- [ ] Add an explicit monitoring-limit progress variant that stores:
  - [ ] `jobId`
  - [ ] validated `jobCreatedAt`
  - [ ] `reachedAt`
  - [ ] optional cancellation request time
  - [ ] optional cancellation outcome
  - [ ] optional verification observation
- [ ] Require monitoring-limit identity fields to be non-empty and chronological where applicable.
- [ ] Replace `monitoringLimit` only when an explicit monitoring-limit update is supplied.
- [ ] Preserve `monitoringLimit` across later ordinary observations and `recordFailure` updates.
- [ ] Add `recordPhaseFiveCompleted(runId, completedAt, phaseResult, fields)`.
- [ ] Require Phase 5 to be the active incomplete phase and the completion job ID to equal the saved `semanticScorerJobId`.
- [ ] Require a valid completion `jobCreatedAt`.
- [ ] Read the durable marker inside the persistence operation.
- [ ] Reject completion when both marker `jobId` and `jobCreatedAt` match the completion attempt.
- [ ] Atomically save the final job ID and compact result, set `lastPhaseCompleted = 5`, and preserve `articleCount` and run incompletion.
- [ ] Make generic `recordPhaseCompleted` reject Phase 5 with an instruction to use `recordPhaseFiveCompleted`.
- [ ] Do not add a db-models column; use the existing `semanticScorerJobId` column and structured Phase 5 data.
- [ ] Update the in-memory persistence test support with behavior matching the production adapter.
- [ ] Extend `ops/tests/weekly-flow-02/persistence.test.ts` for:
  - [ ] Protected first start and rejected second start.
  - [ ] Immediate job-ID persistence.
  - [ ] Ordinary progress replacing only `latestProgress`.
  - [ ] Marker survival across ordinary progress and failure recording.
  - [ ] Marker identity using job ID plus creation time.
  - [ ] Replacement with a different ID not matching the marker.
  - [ ] Reused ID with a different creation time not matching the marker.
  - [ ] A replacement's limit replacing the compact marker.
  - [ ] Dedicated completion rejecting a matching marked job.
  - [ ] Dedicated completion accepting an unmarked replacement.
  - [ ] Generic completion rejecting Phase 5.
- [ ] Run the Phase 2 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat until all checks pass.
- [ ] Check off completed Phase 2 tasks.
- [ ] Commit only Phase 2 changes using the repository commit guidance and reference Phase 2 of this todo in the commit body.

## Phase 3: Implement the Independently Runnable Phase Module

- [ ] Add `ops/src/weekly-flow-02/phases/05_runSemanticScoring.ts`.
- [ ] Keep worker response details and recovery decisions inside the Phase 5 module rather than the coordinator.
- [ ] On a new Phase 5, call `recordPhaseFiveStarted` before the worker start request.
- [ ] After a valid start response, persist `semanticScorerJobId` before the first status request.
- [ ] Perform the first status lookup immediately.
- [ ] After each valid active response, wait one configured poll interval before the next lookup.
- [ ] Do not overlap status requests.
- [ ] Cap a scheduled wait at the remaining six-hour invocation budget so the module evaluates the limit without sleeping past it by a full poll interval.
- [ ] Allow the configured number of consecutive transient status failures and stop on the next failure.
- [ ] Reset the consecutive failure count after a valid response.
- [ ] Stop immediately for permanent errors and invalid responses.
- [ ] Persist compact latest progress after valid job observations.
- [ ] Accept only an unmarked, validated `completed` job as Phase 5 success.
- [ ] Complete through `recordPhaseFiveCompleted`; do not call generic completion.
- [ ] Treat ordinary `failed`, `canceled`, and unavailable saved jobs from an earlier invocation as eligible for one replacement.
- [ ] Treat ordinary terminal `failed` or `canceled` jobs without `startedAt` as valid and replacement-eligible.
- [ ] Apply the normal replacement rule when status returns 404, including when an old marker exists, because no current record is available for ID-plus-creation-time matching.
- [ ] Preserve the old marker when starting a replacement. Its identity must not match the replacement unless both ID and creation time match.
- [ ] Monitor an ordinary active saved job rather than starting a replacement.
- [ ] Accept an ordinary completed saved job through the dedicated completion operation.
- [ ] If Phase 5 started without a saved job ID, log the persistence gap and start at most one job.
- [ ] Enforce one semantic-scorer start per coordinator invocation across every recovery branch.
- [ ] At six hours with a validated active job:
  - [ ] Persist the marker with job ID, validated creation time, and limit time before cancellation.
  - [ ] Send one cancellation request.
  - [ ] Persist `canceled` and stop with a Phase 5 error.
  - [ ] For `cancel_requested`, persist the outcome, wait one normal interval, and perform one final lookup.
  - [ ] Persist the final observation without erasing marker identity.
  - [ ] For cancellation 404, perform one status lookup and classify inactive, active, or unverified.
  - [ ] Never complete Phase 5 from a marked job, including a late `completed` result.
  - [ ] Never start a replacement in the same monitoring-limited invocation.
  - [ ] Raise an error in every monitoring-limit outcome so the coordinator exits nonzero and releases the lock.
- [ ] On continuation, fetch and validate an available saved record before comparing it with the marker.
- [ ] If job ID and `createdAt` match the marker and the job is active, cancel immediately without granting another six-hour window.
- [ ] If a matching marked job is terminal, treat it as unsuccessful and allow at most one replacement.
- [ ] If a marked job is unavailable, use the normal unavailable replacement path.
- [ ] If the marker does not match the current record, monitor or accept the current replacement normally.
- [ ] Add `ops/tests/weekly-flow-02/05_runSemanticScoring.test.ts`.
- [ ] Test new start, immediate poll, active polling, successful completion, ordinary failures, and every replacement branch.
- [ ] Test transient failure increment, reset, and stop behavior.
- [ ] Test six-hour boundary timing, capped final delay, queued cancellation, running cancellation, and cancellation 404 follow-up.
- [ ] Test cancellation failure, unverified cancellation, and late completion remaining unsuccessful.
- [ ] Test a matching marked active job receiving immediate cancellation on continuation.
- [ ] Test a matching marked inactive job allowing one replacement.
- [ ] Test a replacement being monitored and completed normally while the old marker remains.
- [ ] Test reused job ID with a new creation time as a normal replacement.
- [ ] Test status 404 using normal replacement even when an old marker exists.
- [ ] Test at-most-one start per invocation.
- [ ] Add the compiled Phase 5 module test to the explicit `ops/package.json` test command.
- [ ] Run the Phase 3 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat until all checks pass.
- [ ] Check off completed Phase 3 tasks.
- [ ] Commit only Phase 3 changes using the repository commit guidance and reference Phase 3 of this todo in the commit body.

## Phase 4: Connect Phase 5 to the Coordinator

- [ ] Extend coordinator dependencies with the Phase 5 runner and semantic-scorer worker client using the existing injection pattern.
- [ ] Add Phase 5 error-category mapping without changing earlier-phase categories.
- [ ] Gate the Phase 4 block on `lastPhaseCompleted < 4`.
- [ ] When Phase 4 is already complete, skip `collectGoogleNewsRss` and log persisted-result reuse.
- [ ] After executing Phase 4, refresh the run from persistence before deciding whether to enter Phase 5.
- [ ] Stop immediately when Phase 4's zero-Article branch completed the run.
- [ ] Before Phase 5, require `lastPhaseCompleted >= 4`, `runCompleted = false`, and positive persisted `articleCount`.
- [ ] Gate Phase 5 on `lastPhaseCompleted < 5`.
- [ ] Start or continue Phase 5 through the new module without passing `articleCount` to worker-node.
- [ ] Route Phase 5 failures through `recordFailure` with `phase: 5`, then rethrow for a nonzero process exit.
- [ ] After verified Phase 5 completion, keep `runCompleted = false`, log the Phase 6 boundary, and return.
- [ ] When Phase 5 is already complete, skip both Phase 4 and Phase 5 and log the Phase 6 boundary.
- [ ] Extend coordinator tests for:
  - [ ] Phase 4 zero work never starting Phase 5.
  - [ ] Completed Phase 4 not calling `collectRss` on continuation.
  - [ ] Positive Phase 4 count entering Phase 5.
  - [ ] No semantic request receiving `articleCount` or Article IDs.
  - [ ] Phase order through verified Phase 5 completion.
  - [ ] Phase 5 completion stopping at the Phase 6 boundary with an incomplete run.
  - [ ] Completed Phase 5 skipping both worker phases on continuation.
  - [ ] Saved active and completed Phase 5 recovery.
  - [ ] Replacement after queued cancellation or worker restart without `startedAt`.
  - [ ] Marked active, marked inactive, replacement, and late-completion branches.
  - [ ] Monitoring-limit failure persisting `phase: 5` and exiting nonzero.
- [ ] Run the Phase 4 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat until all checks pass.
- [ ] Check off completed Phase 4 tasks.
- [ ] Commit only Phase 4 changes using the repository commit guidance and reference Phase 4 of this todo in the commit body.

## Phase 5: Update Operator Documentation

- [ ] Add all three Phase 5 settings and defaults to `ops/.env.example`.
- [ ] Update `ops/README.md` so it no longer says Phase 4 is unimplemented.
- [ ] Document that completed Phase 4 is skipped during later-phase continuation.
- [ ] Document untargeted semantic scoring and that `articleCount` is retained only for later phases.
- [ ] Document start, status, and cancellation endpoints.
- [ ] Document status-specific timestamp rules, including terminal jobs that never received `startedAt`.
- [ ] Document immediate first polling, five-minute later polling, request timeout, and transient failure policy.
- [ ] Document the six-hour per-invocation limit, cancellation attempt, nonzero exit, and lock release.
- [ ] Document the durable marker's job ID and creation-time identity.
- [ ] Document unavailable-job and replacement behavior without implying that 404 can be matched to a marker.
- [ ] Document that ops cannot detect semantic zero work or full per-article coverage.
- [ ] Document coordinator and worker log correlation through `semanticScorerJobId`.
- [ ] Document the Phase 6 boundary and state that Phases 6–7 and scheduling remain unimplemented.
- [ ] Document the start-response persistence gap and possible redundant queued work.
- [ ] Document that repeated failed cancellation can indicate worker work that does not observe aborts.
- [ ] Tell the operator to inspect worker-node logs and manually restart worker-node when cancellation cannot stop a stuck job; do not automate the restart.
- [ ] Keep destructive real-run warnings and database-free test commands accurate.
- [ ] Run the Phase 5 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat until all checks pass.
- [ ] Check off completed Phase 5 tasks.
- [ ] Commit only Phase 5 documentation and configuration-example changes using the repository commit guidance.

## Phase 6: Final Regression and Handoff

- [ ] Confirm the implementation matches every accepted V03 plan section and both final-review decisions at the top of this todo.
- [ ] Confirm no worker-node production code changed. If it did, document why and run the worker-node build and tests.
- [ ] Confirm no db-models schema change was introduced.
- [ ] Confirm no file under `docs/archive/` was modified by this implementation.
- [ ] Confirm default tests do not open network connections or use PostgreSQL.
- [ ] Confirm `ops/package.json` runs both new compiled Phase 5 test files.
- [ ] Build `db-models`.
- [ ] Run the ops type check.
- [ ] Run the complete ops test suite.
- [ ] Build ops.
- [ ] Run `git diff --check`.
- [ ] Review the final diff for accidental Phase 6, Phase 7, systemd, schema, or generic-framework scope.
- [ ] Fix every failure and repeat the full verification sequence.
- [ ] Check off completed Phase 6 tasks.
- [ ] Commit any verification fixes with the repository commit guidance. Do not create an empty commit when verification produces no changes.
- [ ] Demonstrate the database-free Phase 5 tests and explain normal completion, continuation, monitoring-limit cancellation, replacement, and the Phase 6 boundary to the operator.

## Completion Criteria

- [ ] Phase 5 starts worker-node semantic scoring with exactly an empty JSON body.
- [ ] Phase 5 uses the persisted positive `articleCount` only as an entry precondition, never changes it, and never sends it to worker-node.
- [ ] Completed Phase 4 and Phase 5 are skipped correctly during continuation.
- [ ] Phase 5's original start timestamp cannot be overwritten.
- [ ] Job IDs are persisted before monitoring.
- [ ] Lifecycle timestamp validation accepts queued terminal jobs without `startedAt`.
- [ ] Only validated, unmarked completed jobs can complete Phase 5.
- [ ] The dedicated completion operation enforces the marker rule inside persistence.
- [ ] Ordinary progress cannot erase the monitoring-limit marker.
- [ ] Markers match jobs by ID and creation time.
- [ ] Unavailable jobs use the normal one-replacement rule.
- [ ] Replacement jobs do not inherit an old marker.
- [ ] One invocation starts at most one semantic job.
- [ ] Six hours triggers cancellation, a recorded Phase 5 error, nonzero exit, and lock release.
- [ ] Successful Phase 5 leaves the weekly run incomplete at the Phase 6 boundary.
- [ ] Type checking, tests, builds, and diff checks pass.
