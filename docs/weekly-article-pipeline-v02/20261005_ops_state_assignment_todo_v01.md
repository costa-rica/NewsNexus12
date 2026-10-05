---
created_at: 2026-10-05T22:52:17Z
updated_at: 2026-10-05T23:14:59Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops State Assignment Todo V01

## Purpose

Implement Phase 6 of weekly-flow-02 from `20261005_ops_state_assignment_plan_v04.md`.

The implementation adds the worker-node state-assignment result contract, starts and monitors the Phase 6 queue job, persists its recovery state and verified outcome, and stops the incomplete weekly run at the Phase 7 boundary.

This todo does not implement AI Approver V02, systemd scheduling, a new state-assignment selection mode, or a general queue-job framework.

## Final Review Decisions

- Use 180 days for `targetArticleThresholdDaysOld`.
- Use the immutable Phase 4 `articleCount` for `targetArticleStateReviewCount`.
- Use a 12-hour Phase 6 monitoring limit.
- Missing queue parameters follow the dedicated incompatible-worker-contract recovery path. Do not classify them as an ordinary malformed response that can never recover.
- Malformed parameter types remain invalid and unverified with no automatic replacement.
- Present but different valid parameter values indicate a wrong or reused job and use ordinary unavailable-job replacement.
- Cancel active missing-contract jobs because their results can never complete Phase 6.
- Allow one marked replacement after an incompatible job is inactive.
- If the marked replacement is also incompatible, cancel it when active and never start another recovery replacement.
- Accept completed jobs with Article-level skips or failures when the overall result contract validates.
- Keep the weekly run incomplete after Phase 6, including zero selected Articles.

## Accepted Persistence Gap

- A replacement start can reach worker-node before ops atomically saves the replacement job ID and consumed marker.
- If that persistence write fails, later continuation can see the old marker as unused and start another replacement.
- Treat this like the established lost-job-ID gap for other phases.
- Do not add a latest-job lookup, coordinator deduplication system, queue search, or new database field for this gap.
- Stop the current invocation on the persistence failure and document the possible additional AI cost and older-Article selection.

## Implementation Guardrails

- Preserve unrelated working-tree changes.
- Do not review or modify `docs/archive/`.
- Do not run weekly-flow-02 against a real environment without explicit operator authorization.
- Do not restart worker-node, PostgreSQL, worker-python, or systemd services automatically.
- Do not send Article IDs, ID ranges, or `includeArticlesThatMightHaveBeenStateAssigned`.
- Do not recalculate, reduce, or overwrite the persisted `articleCount`.
- Do not persist AI keys, prompt text, Article content, model input, or filesystem paths in queue parameters or coordinator logs.
- Start at most one state-assigner job per coordinator invocation.
- Keep default ops tests independent of PostgreSQL, running workers, network access, and package `.env` files.
- Keep worker-node tests independent of real AI providers, Codex CLI processes, and PostgreSQL.
- Use the dedicated missing-contract recovery rules whenever plan wording appears to conflict with the generic invalid-response wording.

## Phase 1: Add the Worker Queue Contract

- [x] Review the accepted plan V04, worker-node queue engine and store, state-assigner route, state-assigner job, startup queue maintenance, and their tests.
- [x] Extend `EnqueueJobInput` with optional non-secret `parameters`.
- [x] Persist supplied parameters on the queue record when the job is created.
- [x] Preserve existing queue behavior when parameters are omitted.
- [x] Ensure queue-store validation continues to require a plain object when parameters are present.
- [x] Update `/state-assigner/start-job` to enqueue exactly these parameters:
  - [x] `targetArticleThresholdDaysOld`
  - [x] `targetArticleStateReviewCount`
- [x] Keep AI configuration, keys, model input, prompt text, filesystem paths, and Article content out of queue parameters.
- [x] Add a `StateAssignerJobResult` type containing:
  - [x] `selectedCount`
  - [x] `completedCount`
  - [x] `skippedCount`
  - [x] `failedCount`
  - [x] `targetArticleThresholdDaysOld`
  - [x] `targetArticleStateReviewCount`
- [x] Refactor `processStateAssignmentsWithTimeout` to return counters rather than `void`.
- [x] Count a persisted `ArticleStateContract02` as completed.
- [x] Count an individual AI timeout as skipped and continue.
- [x] Count an individual analysis or persistence exception as failed and continue when the queue signal is not aborted.
- [x] Treat only the actual queue signal as authoritative cancellation.
- [x] Remove error-name or message matching as an independent reason to return early.
- [x] Count an error containing `AbortError` or `aborted` as failed when the queue signal is not aborted.
- [x] Continue to assignment after enrichment failure when the queue signal is not aborted.
- [x] Stop after enrichment failure only when the queue signal is actually aborted.
- [x] Return zero counts when no candidates are selected.
- [x] Fail the queue job for fatal setup or pre-selection errors instead of saving a completed zero result.
- [x] Save the final result with `queueContext.updateResult` before every non-canceled normal return.
- [x] Permit a canceled job to save diagnostic partial counters, while relying on queue status to prevent those counters from being trusted.
- [x] Enforce the completed-result invariant:
  - [x] `selectedCount = completedCount + skippedCount + failedCount`
- [x] Extend queue-engine tests for parameter persistence and omission.
- [x] Extend state-assigner route tests for the exact non-secret parameters.
- [x] Extend state-assigner job tests for zero work, completion, timeout, Article failure, enrichment failure, cancellation, fatal setup failure, and saved results.
- [x] Add explicit tests for persistence and enrichment errors whose messages contain `aborted` while the queue signal remains active.
- [x] Run the Phase 1 checkpoint:
  1. Build `db-models`.
  2. Build worker-node.
  3. Run the complete worker-node test suite.
  4. Fix failures and repeat the build and tests.
- [x] Check off completed Phase 1 tasks.
- [x] Commit only Phase 1 changes using the repository commit guidance and `co-authored-by: codex (gpt-6.1-sol)`.

## Phase 2: Add Phase 6 Configuration and Client

- [x] Extend `OpsConfig` with:
  - [x] `stateAssignerTargetArticleThresholdDaysOld`, required and set to 180 in production configuration.
  - [x] `stateAssignerStatusPollIntervalSeconds`, optional default 300.
  - [x] `stateAssignerToleratedConsecutiveStatusFailures`, optional default 2.
  - [x] `stateAssignerMonitoringLimitHours`, optional default 12.
- [x] Reject explicit zero, negative, fractional, empty, and nonnumeric values.
- [x] Update every explicit `OpsConfig` fixture or construct it through configuration defaults.
- [x] Add `ops/src/weekly-flow-02/phases/06_stateAssignerClient.ts`.
- [x] Define typed request inputs, start result, lifecycle job, completed result, cancellation result, and error categories.
- [x] Start with `POST /state-assigner/start-job` and exactly the threshold and persisted Article count.
- [x] Require HTTP 202, nonempty job ID, `queued`, and `/state-assigner/start-job`.
- [x] Read status with `GET /queue-info/check-status/:jobId`.
- [x] Cancel with `POST /queue-info/cancel_job/:jobId` and accept only `canceled` or `cancel_requested`.
- [x] Expose cancellation 404 for one verification lookup.
- [x] Apply the shared worker-node request timeout.
- [x] Distinguish transient request, permanent request, malformed response, unavailable job, incompatible worker contract, and cancellation failure.
- [x] Validate job ID, endpoint, known lifecycle status, and `createdAt` at or after the original Phase 6 start.
- [x] Validate lifecycle timestamps:
  - [x] `queued` requires only `createdAt`.
  - [x] `running` requires chronological `startedAt`.
  - [x] `completed` requires chronological `startedAt` and `endedAt`.
  - [x] `failed` and `canceled` require chronological `endedAt`; validate `startedAt` only when present.
- [x] Parse identity, lifecycle, and timestamps before classifying missing queue parameters.
- [x] Return the otherwise validated job lifecycle with the incompatible-contract classification when parameters or required keys are missing.
- [x] Treat wrong parameter types as malformed and non-replaceable.
- [x] Treat present positive integers that differ from persisted inputs as unavailable job identity.
- [x] Require exact parameter values for a valid job.
- [x] Parse and require the completed result only for `status = completed`.
- [x] Validate nonnegative safe-integer counts, input echoes, count invariant, and `selectedCount <= articleCount`.
- [x] Keep canceled or failed partial results diagnostic and never sufficient for completion.
- [x] Add `ops/tests/weekly-flow-02/06_stateAssignerClient.test.ts`.
- [x] Cover exact start body, lifecycle shapes, timestamp ordering, endpoint and ID mismatches, old creation time, HTTP classifications, and cancellation responses.
- [x] Cover missing parameter object, each missing key, malformed types, different valid values, and exact matches.
- [x] Cover missing, negative, fractional, inconsistent, oversized, and input-mismatched results.
- [x] Add the compiled client test to the explicit `ops/package.json` test command.
- [x] Run the Phase 2 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 2 tasks.
- [x] Commit only Phase 2 changes and reference Phase 2 of this todo in the commit body.

## Phase 3: Add Protected Phase 6 Persistence

- [x] Add typed Phase 6 start, progress, monitoring-limit, incompatible-contract recovery, and completion inputs to the persistence contract.
- [x] Add `recordPhaseSixStarted`.
- [x] Require an incomplete run, completed Phase 5, positive immutable `articleCount`, and Phase 6 as next.
- [x] Atomically write:
  - [x] `lastPhaseStarted = 6`
  - [x] `targetArticleThresholdDaysOld = 180`
  - [x] `phaseData.phase6.status`
  - [x] `phaseData.phase6.startedAt`
  - [x] `phaseData.phase6.input.targetArticleStateReviewCount`
  - [x] `phaseData.phase6.input.targetArticleThresholdDaysOld`
- [x] Treat the threshold column and `articleCount` column as authoritative.
- [x] Validate the `phaseData.phase6.input` audit mirror against both columns on every Phase 6 persistence operation.
- [x] Reject repeated Phase 6 start and preserve the original start and inputs.
- [x] Add `recordPhaseSixProgress`.
- [x] Require active incomplete Phase 6 and preserve original start and input state.
- [x] Save a nonempty `stateAssignerJobId` immediately after start.
- [x] Store ordinary observations only in `phaseData.phase6.latestProgress`.
- [x] Preserve `startedAt`, `input`, `monitoringLimit`, `incompatibleContractRecovery`, and result during ordinary progress and failure writes.
- [x] Add explicit monitoring-limit marker persistence tied to job ID and validated `createdAt`.
- [x] Add explicit incompatible-contract marker persistence containing source identity, missing fields, detection time, lifecycle status, and cancellation evidence.
- [x] Add an atomic incompatible-contract replacement operation that updates both:
  - [x] `stateAssignerJobId`
  - [x] `phaseData.phase6.incompatibleContractRecovery.replacementJobId`
- [x] Store replacement start time in the same update.
- [x] Preserve the source marker after replacement.
- [x] Prevent a second incompatible-contract replacement after `replacementJobId` is saved.
- [x] Add `recordPhaseSixCompleted`.
- [x] Require active incomplete Phase 6, matching saved job ID, valid job `createdAt`, exact inputs, and valid result counts.
- [x] Reject completion by the incompatible source job.
- [x] Reject completion by a job matching the monitoring-limit marker.
- [x] Permit the marked replacement to complete only after the full contract validates.
- [x] Atomically save the result, set `lastPhaseCompleted = 6`, preserve `articleCount`, and keep `runCompleted = false`.
- [x] Make generic `recordPhaseCompleted` reject Phase 6.
- [x] Use the existing `stateAssignerJobId` and `targetArticleThresholdDaysOld` columns; do not change the schema.
- [x] Update in-memory persistence support to match production behavior.
- [x] Add persistence tests for protected start, audit-mirror validation, job-ID persistence, sibling preservation, both marker types, atomic replacement consumption, and completion rules.
- [x] Add a persistence test where saving the replacement job ID fails after the worker start response.
- [x] Assert that this failure does not fabricate a saved replacement ID or silently continue in the same invocation.
- [x] Treat the later duplicate-start possibility as the accepted gap; do not add recovery infrastructure outside the plan.
- [x] Run the Phase 3 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 3 tasks.
- [x] Commit only Phase 3 changes and reference Phase 3 of this todo in the commit body.

## Phase 4: Implement the Phase 6 Module

- [x] Add `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`.
- [x] Keep Phase 6 worker responses, monitoring state, and recovery decisions inside this module.
- [x] Persist Phase 6 start before the worker request and job ID before monitoring.
- [x] Use only the persisted 180-day threshold and immutable `articleCount` when starting any attempt.
- [x] Poll immediately, then wait one configured interval after each active response.
- [x] Prevent overlapping requests and cap delay at the remaining 12-hour budget.
- [x] Allow two consecutive transient status failures and stop on the third.
- [x] Reset the failure count after every valid status response.
- [x] Stop immediately on permanent request failures and malformed responses.
- [x] Persist compact latest progress without secrets or Article content.
- [x] Complete only a validated `completed` job through `recordPhaseSixCompleted`.
- [x] Accept valid completed outcomes with zero selected Articles or nonzero skipped and failed counts.
- [x] Monitor a valid active saved job rather than replacing it.
- [x] Allow one ordinary replacement for an unavailable, failed, canceled, or inactive monitoring-limited job from an earlier invocation.
- [x] Enforce one start per invocation across fresh starts, persistence-gap recovery, ordinary replacement, and incompatible-contract replacement.
- [x] Treat a Phase 6 start without a saved job ID as an accepted persistence gap eligible for one start.
- [x] Do not replace a job started during the current invocation.
- [x] At the 12-hour monitoring limit:
  - [x] Persist the marker before cancellation.
  - [x] Send one cancellation request.
  - [x] Persist `canceled` or `cancel_requested`.
  - [x] After `cancel_requested`, wait one interval and perform one final lookup.
  - [x] After cancellation 404, perform one lookup and classify inactive, active, or unverified.
  - [x] Never trust the marked job's late result.
  - [x] Never replace it in the same invocation.
  - [x] Raise a Phase 6 error and exit nonzero.
- [x] On continuation, re-cancel a matching active monitoring-limited job before replacement.
- [x] Allow one later replacement after a matching marked job is verified inactive.
- [x] Log elapsed monitoring time, requested `articleCount`, and diagnostic `selectedCount` when present.

### Incompatible-Contract Recovery

- [x] Follow this section instead of the generic invalid-response wording when required parameters are missing.
- [x] Persist the incompatible-contract source marker before canceling an active incompatible job.
- [x] Cancel an incompatible `queued` or `running` job and verify inactivity or unavailability.
- [x] Stop without replacement when cancellation or verification is ambiguous.
- [x] Never trust a completed incompatible job result.
- [x] Do not replace an incompatible job in the invocation that started or canceled it.
- [x] On later continuation, permit one replacement after the source job is verified inactive.
- [x] Save the replacement job ID and consumed marker atomically after the start response.
- [x] If that persistence operation fails, throw immediately and start nothing else in that invocation.
- [x] Accept that a later continuation may retry because the replacement ID was not saved.
- [x] If the saved replacement also lacks required parameters, mark it as the replacement, cancel it when active, verify inactivity, and stop permanently without another recovery start.
- [x] Allow a compatible marked replacement to monitor and complete normally.

### Phase Module Tests

- [x] Add `ops/tests/weekly-flow-02/06_runStateAssignment.test.ts`.
- [x] Cover fresh start, immediate polling, active polling, transient failures, verified completion, partial outcome, zero selection, and one-start enforcement.
- [x] Cover failed, canceled, unavailable, persistence-gap, and monitoring-limit recovery.
- [x] Cover exact 12-hour timing, capped delay, queued and running cancellation, cancellation 404, cancellation failure, and unverified cancellation.
- [x] Cover an active missing-contract job being marked and canceled without same-invocation replacement.
- [x] Cover continuation after `failureReason = worker_restart` starting one compatible replacement and completing Phase 6.
- [x] Cover a completed incompatible source job followed by one compatible replacement.
- [x] Cover a marked replacement that also lacks parameters, is canceled when active, and never causes a second replacement.
- [x] Cover the replacement start response followed by persistence failure, nonzero exit, and no second start in the same invocation.
- [x] Cover a later continuation after that accepted unsaved-ID gap without adding new lookup behavior.
- [x] Cover preservation of threshold, Article count, source marker, and monitoring marker through recovery.
- [x] Add the compiled phase-module test to the explicit `ops/package.json` test command.
- [x] Run the Phase 4 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 4 tasks.
- [x] Commit only Phase 4 changes and reference Phase 4 of this todo in the commit body.

## Phase 5: Connect Phase 6 to the Coordinator

- [x] Extend coordinator dependencies with the Phase 6 runner and worker client through the existing injection pattern.
- [x] Add Phase 6 client and orchestration error-category mapping without changing earlier categories.
- [x] Refresh the persisted run after executing Phase 5 before evaluating Phase 6.
- [x] Require completed Phase 5, positive immutable `articleCount`, and incomplete run before Phase 6.
- [x] Gate Phase 6 on `lastPhaseCompleted < 6`.
- [x] Run or continue Phase 6 with the persisted inputs.
- [x] Record Phase 6 failures with `phase: 6` while preserving completed Phase 5.
- [x] After Phase 6 completion, leave the run incomplete and log the Phase 7 boundary.
- [x] Skip Phases 4, 5, and 6 when Phase 6 is already complete.

### Existing Coordinator Test Location

- [x] Add and update coordinator tests inside the existing `describe('runCoordinator')` block in `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`.
- [x] Do not create an unlisted coordinator test file.
- [x] If a separate coordinator test file becomes necessary, add its compiled path to `ops/package.json` in this phase.
- [x] Add controlled successful and failing Phase 6 dependencies that never call real `fetch`.
- [x] Audit every `runCoordinator` test that reaches completed Phase 5 and inject a controlled Phase 6 dependency.
- [x] Confirm earlier failure and zero-work branches cannot reach the default Phase 6 client.

### Coordinator Test Updates

- [x] Update the successful end-to-end coordinator case to run Phases 1–6 in order and stop at the Phase 7 boundary.
- [x] Assert `lastPhaseCompleted = 6` and `runCompleted = false`.
- [x] Update continuation cases at the Phase 4, Phase 5, and Phase 6 boundaries.
- [x] Preserve Phase 4 zero-Article completion as a branch that never calls Phases 5 or 6.
- [x] Preserve Phase 1–5 failure branches as paths that never call Phase 6.
- [x] Add a controlled Phase 6 failure proving:
  - [x] Phase 5 remains completed.
  - [x] Phase 6 does not complete.
  - [x] `recordFailure` receives `phase: 6`.
  - [x] The coordinator rejects and does not log the Phase 7 boundary.
- [x] Add or retain focused cases for completed Phase 6 skipping all worker phases and saved active or completed Phase 6 recovery.
- [x] Update `coordinatorConfig` and entrypoint fixtures with all Phase 6 fields.
- [x] Assert no coordinator test reaches the default state-assigner client or opens a network connection.
- [x] Run the Phase 5 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite, including the coordinator and both Phase 6 test files.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 5 tasks.
- [x] Commit only Phase 5 changes and reference Phase 5 of this todo in the commit body.

## Phase 6: Update Operator Documentation

- [ ] Add all four Phase 6 settings and defaults to `ops/.env.example`.
- [ ] Set or document the production threshold as 180 days and the monitoring limit as 12 hours.
- [ ] Update `ops/README.md` so weekly-flow-02 runs Phases 1–6 and stops at the Phase 7 boundary.
- [ ] Document the exact start body and that `articleCount` remains unchanged for Phase 7.
- [ ] Document result-count meanings and accepted partial outcomes.
- [ ] Document immediate first polling, later five-minute polling, request timeout, transient failures, and the 12-hour limit.
- [ ] Document monitoring-limit cancellation, nonzero exit, marker identity, and later replacement.
- [ ] Document incompatible-worker detection, active cancellation, one marked replacement, and permanent stop after a second incompatible job.
- [ ] Document that compatible worker-node must be deployed and restarted before the Phase 6 ops build is run.
- [ ] Document that replacement starts a new full newest-first selection rather than resuming only unfinished Articles.
- [ ] Document potential additional AI work and older-Article selection for monitoring, incompatible-contract, and persistence-gap replacements.
- [ ] Document the accepted unsaved replacement-ID gap without adding unsupported recovery commands.
- [ ] Document correlation through `stateAssignerJobId`, worker parameters, and coordinator logs.
- [ ] Update `ops/AGENTS.md` with the implemented Phase 6 contract, recovery rules, safety limits, and Phase 7 boundary.
- [ ] Keep destructive-run warnings and database-free verification commands accurate.
- [ ] Run the Phase 6 checkpoint:
  1. Build `db-models`.
  2. Build and test worker-node.
  3. Run the ops type check.
  4. Run the complete ops test suite.
  5. Build ops.
  6. Fix failures and repeat all checks.
- [ ] Check off completed Phase 6 tasks.
- [ ] Commit only Phase 6 documentation and example-configuration changes.

## Phase 7: Final Regression and Handoff

- [ ] Confirm every accepted V04 plan requirement and final-review decision is implemented.
- [ ] Confirm the dedicated missing-contract recovery path overrides the conflicting generic wording noted in final review.
- [ ] Confirm the replacement-ID persistence failure remains an accepted gap and did not cause new lookup or deduplication scope.
- [ ] Confirm no db-models schema change was introduced.
- [ ] Confirm no archive file was modified.
- [ ] Confirm `ops/package.json` executes both new Phase 6 test files.
- [ ] Confirm every coordinator test that can reach Phase 6 injects controlled dependencies.
- [ ] Confirm default tests do not open network or PostgreSQL connections or start real AI processes.
- [ ] Build `db-models`.
- [ ] Build worker-node.
- [ ] Run the complete worker-node test suite.
- [ ] Run the ops type check.
- [ ] Run the complete ops test suite.
- [ ] Build ops.
- [ ] Run `git diff --check`.
- [ ] Review the diff for accidental Phase 7, systemd, schema, real-environment, or generic-framework scope.
- [ ] Fix failures and repeat the full sequence.
- [ ] Check off completed Phase 7 tasks.
- [ ] Commit verification fixes if any; do not create an empty commit.
- [ ] Demonstrate the database-free worker and ops Phase 6 tests to the operator.

## Completion Criteria

- [ ] Worker queue records persist the two non-secret state-assigner targeting parameters.
- [ ] Worker completed results contain valid selected, completed, skipped, and failed counts.
- [ ] Abort-like text cannot end an active job early or create a malformed completed result.
- [ ] Phase 6 starts with the persisted 180-day threshold and unchanged `articleCount`.
- [ ] Original Phase 6 start and inputs remain immutable through continuation.
- [ ] Queue identity, parameters, timestamps, lifecycle, and completed result all validate before completion.
- [ ] Missing parameters use the durable incompatible-contract recovery path.
- [ ] An active incompatible job is canceled and never trusted.
- [ ] One inactive incompatible job can receive one compatible replacement.
- [ ] A second incompatible job cannot create another replacement.
- [ ] The accepted unsaved replacement-ID gap is tested and documented.
- [ ] Twelve hours triggers marking, cancellation, Phase 6 failure, nonzero exit, and lock release.
- [ ] Completed zero-work and partial Article outcomes advance to Phase 7 without completing the run.
- [ ] `articleCount` remains unchanged for AI Approver V02.
- [ ] Generic Phase completion cannot bypass Phase 6 persistence protections.
- [ ] Completed Phase 6 is skipped correctly during continuation.
- [ ] Phase 6 failure leaves Phase 5 complete.
- [ ] Successful Phase 6 leaves the run incomplete at the Phase 7 boundary.
- [ ] Worker-node and ops type checks, tests, builds, and diff checks pass.
