---
created_at: 2026-10-05T21:43:08Z
updated_at: 2026-10-05T22:00:03Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops Semantic Scoring Todo V02

## Purpose

Implement Phase 5 of weekly-flow-02 from `20261005_ops_semantic_scoring_plan_v03.md`.

The implementation starts worker-node semantic scoring without Article targeting, monitors and recovers its queue job, persists verified completion, and stops at the Phase 6 boundary.

This todo does not implement Phase 6, Phase 7, systemd scheduling, or a general worker-job framework.

## V02 Changes

This version resolves the qualifying V01 todo assessment concern:

1. Coordinator tests stay in the existing `describe('runCoordinator')` block in `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`.
2. Existing positive Phase 4 coordinator tests receive a controlled Phase 5 dependency and assert the new Phase 6 boundary.
3. A controlled Phase 5 failure test proves Phase 4 remains complete while failure is recorded with `phase: 5`.
4. Every `OpsConfig` test fixture receives the three Phase 5 fields or is constructed through configuration defaults.
5. No coordinator test may reach the default semantic client or real `fetch`.

## Final Review Decisions

- Add a dedicated `recordPhaseFiveCompleted` persistence operation.
- Make generic `recordPhaseCompleted` reject Phase 5 so callers cannot bypass monitoring-limit validation.
- `recordPhaseFiveCompleted` rejects a job whose ID and `createdAt` match the durable monitoring-limit marker.
- A status 404 means the job is unavailable. Because no record exists for marker comparison, apply the normal one-replacement rule.
- Preserve the old marker as compact state. It affects only a job matching both its ID and `createdAt`.

## Implementation Guardrails

- Preserve unrelated working-tree changes, including the current archive moves.
- Do not modify or review `docs/archive/` for implementation context.
- Do not pass `articleCount`, `articleIdMinExclusive`, or `articleIdMaxInclusive` to worker-node.
- Do not recalculate or modify the persisted Phase 4 `articleCount`.
- Keep default ops tests independent of PostgreSQL, running workers, network access, and package `.env` files.
- Start at most one semantic job per coordinator invocation.
- Never complete Phase 5 from a monitoring-limited job.
- Never replace a verified active job.
- Do not automatically restart worker-node.

## Phase 1: Add Configuration and the Worker Client

- [x] Review accepted plan V03, current ops configuration, Phase 4 client patterns, worker-node semantic routes, queue-info routes, and queue types.
- [x] Add optional `OpsConfig` fields with defaults:
  - [x] `semanticScorerStatusPollIntervalSeconds = 300`
  - [x] `semanticScorerToleratedConsecutiveStatusFailures = 2`
  - [x] `semanticScorerMonitoringLimitHours = 6`
- [x] Add or refactor a positive-integer parser that accepts a setting-specific default.
- [x] Reject explicitly supplied zero, negative, fractional, empty, and nonnumeric values.
- [x] Extend `ops/tests/config.test.ts` for defaults and explicit valid or invalid settings.
- [x] Search all ops tests for explicit `OpsConfig` objects and update them with Phase 5 values or construct them through defaults.
- [x] Update at least `coordinatorConfig` in `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts` and configuration fixtures in `ops/tests/weekly-flow-02/entrypoint.test.ts`.
- [x] Add `ops/src/weekly-flow-02/phases/05_semanticScorerClient.ts`.
- [x] Define typed start, status, cancellation, job-record, and error results.
- [x] Start with `POST /semantic-scorer/start-job`, JSON content type, and exactly `{}`.
- [x] Require HTTP 202, non-empty job ID, `queued`, and the exact semantic endpoint.
- [x] Treat a start 404 as a permanent configuration rejection.
- [x] Read status with `GET /queue-info/check-status/:jobId` and treat status 404 as unavailable.
- [x] Cancel with `POST /queue-info/cancel_job/:jobId`; accept only `canceled` and `cancel_requested`.
- [x] Expose cancellation 404 separately for one follow-up status lookup.
- [x] Apply the shared 60-second worker-node request timeout.
- [x] Distinguish timeout, connection, temporary response, permanent response, invalid response, and unavailable-job errors.
- [x] Validate endpoint, known status, and `createdAt` at or after the persisted Phase 5 start.
- [x] Validate timestamps by lifecycle:
  - [x] `queued` needs no additional timestamp.
  - [x] `running` requires chronological `startedAt`.
  - [x] `completed` requires chronological `startedAt` and `endedAt`.
  - [x] `failed` and `canceled` require chronological `endedAt`; validate `startedAt` only when present.
- [x] Add `ops/tests/weekly-flow-02/05_semanticScorerClient.test.ts`.
- [x] Cover lifecycle shapes, malformed identity, old reused IDs, timestamp ordering, and every HTTP classification.
- [x] Cover `canceled_before_start` and queued `worker_restart` without `startedAt`.
- [x] Add the compiled client test to the explicit `ops/package.json` test command.
- [x] Run the Phase 1 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 1 tasks.
- [x] Commit only Phase 1 changes using the repository commit guidance and `co-authored-by: codex (gpt-6.1-sol)`.

## Phase 2: Add Protected Phase 5 Persistence

- [x] Add typed Phase 5 start, progress, monitoring-limit, and completion inputs to the persistence contract.
- [x] Add `recordPhaseFiveStarted`.
- [x] Require completed Phase 4, positive `articleCount`, incomplete run state, and Phase 5 as next.
- [x] Reject a repeated Phase 5 start and preserve the original start timestamp.
- [x] Add `recordPhaseFiveProgress`.
- [x] Require active incomplete Phase 5 and preserve the original start.
- [x] Persist a non-empty `semanticScorerJobId` immediately after start.
- [x] Store ordinary observations only in `phaseData.phase5.latestProgress`.
- [x] Preserve sibling `startedAt`, `monitoringLimit`, and result on ordinary progress and failure writes.
- [x] Add an explicit monitoring-limit update containing job ID, validated job creation time, limit time, optional cancellation time and outcome, and optional verification observation.
- [x] Replace `monitoringLimit` only through that explicit update.
- [x] Add `recordPhaseFiveCompleted`.
- [x] Require active incomplete Phase 5, matching saved job ID, and valid completion job creation time.
- [x] Read the durable marker inside the persistence operation.
- [x] Reject completion when marker job ID and creation time both match the attempt.
- [x] Atomically save the result and job ID, set `lastPhaseCompleted = 5`, preserve `articleCount`, and leave the run incomplete.
- [x] Make generic `recordPhaseCompleted` reject Phase 5.
- [x] Use the existing `semanticScorerJobId` column; do not change the db-models schema.
- [x] Update in-memory persistence support to match production behavior.
- [x] Extend persistence tests for protected start, job-ID persistence, sibling preservation, marker identity, marker replacement, completion rejection, accepted replacement, and generic-completion rejection.
- [x] Include cases for a reused job ID with a different creation time and a replacement with a different ID.
- [x] Run the Phase 2 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 2 tasks.
- [x] Commit only Phase 2 changes and reference Phase 2 of this todo in the commit body.

## Phase 3: Implement the Phase Module

- [x] Add `ops/src/weekly-flow-02/phases/05_runSemanticScoring.ts`.
- [x] Keep worker responses and recovery decisions inside the phase module.
- [x] Persist Phase 5 start before the worker request and job ID before monitoring.
- [x] Poll immediately, then wait one configured interval after each active response.
- [x] Prevent overlapping requests and cap delay at the remaining six-hour budget.
- [x] Apply configured consecutive transient failure handling and reset after valid status.
- [x] Stop immediately on permanent or invalid responses.
- [x] Persist compact latest progress.
- [x] Complete only an unmarked validated `completed` job through `recordPhaseFiveCompleted`.
- [x] Treat ordinary failed, canceled, and unavailable jobs from earlier invocations as eligible for one replacement.
- [x] Accept failed and canceled terminal records without `startedAt` when their remaining timestamps validate.
- [x] For status 404, use normal replacement even when an old marker exists.
- [x] Preserve the old marker when starting a replacement; match only ID plus creation time.
- [x] Monitor active saved jobs and accept ordinary completed saved jobs.
- [x] If the phase started without a saved job ID, log the persistence gap and start at most one job.
- [x] Enforce one start per invocation across all branches.
- [x] At six hours with an active job:
  - [x] Persist marker identity before cancellation.
  - [x] Send one cancellation request.
  - [x] Persist immediate `canceled` or `cancel_requested`.
  - [x] After `cancel_requested`, wait one interval and perform one final lookup.
  - [x] Preserve marker identity through final progress.
  - [x] After cancellation 404, perform one lookup and classify inactive, active, or unverified.
  - [x] Never trust a late completion from the marked job.
  - [x] Never replace in the same invocation.
  - [x] Raise a Phase 5 error in every limit branch.
- [x] On continuation, validate an available job before marker comparison.
- [x] Immediately re-cancel a matching marked active job without another six-hour window.
- [x] Allow one replacement for a matching marked terminal job.
- [x] Use normal unavailable replacement for status 404 because creation time cannot be compared.
- [x] Monitor or accept a nonmatching replacement normally.
- [x] Add `ops/tests/weekly-flow-02/05_runSemanticScoring.test.ts`.
- [x] Cover new start, saved-job recovery, polling, transient failures, successful completion, replacements, and one-start enforcement.
- [x] Cover exact limit timing, capped delay, queued and running cancellation, cancellation 404, cancellation failure, and unverified cancellation.
- [x] Cover matching marked active and inactive jobs, late completion rejection, old-marker preservation, replacement completion, reused ID with new creation time, and status-404 replacement.
- [x] Add the compiled module test to the explicit `ops/package.json` test command.
- [x] Run the Phase 3 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 3 tasks.
- [x] Commit only Phase 3 changes and reference Phase 3 of this todo in the commit body.

## Phase 4: Connect Phase 5 to the Coordinator

- [x] Extend coordinator dependencies with the Phase 5 runner and worker client through the existing injection pattern.
- [x] Add Phase 5 error-category mapping without changing earlier-phase categories.
- [x] Gate Phase 4 on `lastPhaseCompleted < 4`.
- [x] Skip `collectGoogleNewsRss` and log persisted-result reuse when Phase 4 is already complete.
- [x] Refresh the run from persistence after executing Phase 4.
- [x] Return when Phase 4 completed the run through zero work.
- [x] Require completed Phase 4, incomplete run, and positive `articleCount` before Phase 5.
- [x] Gate Phase 5 on `lastPhaseCompleted < 5`.
- [x] Run or continue Phase 5 without passing the count or Article IDs to worker-node.
- [x] Record Phase 5 failures with `phase: 5` and rethrow for nonzero exit.
- [x] After Phase 5 completion, leave the run incomplete and log the Phase 6 boundary.
- [x] Skip both worker phases when Phase 5 is already complete.

### Existing Coordinator Test Location

- [x] Add and update coordinator tests inside the existing `describe('runCoordinator')` block in `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`.
- [x] Do not create an unlisted coordinator test file.
- [x] If a separate coordinator test file becomes necessary, add its compiled path to the explicit `ops/package.json` test command in the same phase.
- [x] Add a controlled successful Phase 5 runner or worker fixture that never calls real `fetch` and persists or returns the same completion contract as the production phase module.
- [x] Add a controlled failing Phase 5 fixture for coordinator failure assertions.
- [x] Audit every `runCoordinator` call in this test file that reaches a positive Phase 4 result and inject a controlled Phase 5 dependency.
- [x] Confirm coordinator tests that stop in Phases 1–4 cannot accidentally reach the default semantic client.

### Existing Coordinator Test Updates

- [x] Rename and update `runs Phases 1 through 4 in order and stops at the Phase 5 boundary` to prove Phases 1–5 execute in order and stop at the Phase 6 boundary.
- [x] Replace its Phase 5-boundary log assertion with verified Phase 5 completion and a Phase 6-boundary assertion.
- [x] Update its call-order and persisted-state expectations through `lastPhaseCompleted = 5` while keeping `runCompleted = false`.
- [x] Update `continues a recent run at the Phase 4 boundary...` to inject controlled Phase 5 completion and assert the Phase 6 boundary.
- [x] Update `continues within 72 hours and replaces an older timed-out Phase 4 job` to complete the replacement RSS job, run controlled Phase 5, and end at completed Phase 5.
- [x] Audit other existing positive Phase 4 cases, including replacement-run, explicit-run, and all-zero Phase 3 cases, and update their expected final phase from 4 to 5 where applicable.
- [x] Preserve the Phase 4 zero-Article test as a branch that never calls Phase 5.
- [x] Preserve Phase 1–4 failure tests as branches that never call Phase 5.
- [x] Add a controlled Phase 5 failure case proving:
  - [x] Phase 4 remains completed.
  - [x] Phase 5 does not complete.
  - [x] `recordFailure` receives `phase: 5`.
  - [x] The coordinator rejects and does not log the Phase 6 boundary.
- [x] Add or retain focused cases for completed Phase 4 skipping RSS, completed Phase 5 skipping both worker phases, saved active and completed Phase 5 recovery, terminal jobs without `startedAt`, marked-job recovery, and replacement completion.
- [x] Ensure `coordinatorConfig` contains all three Phase 5 fields.
- [x] Ensure entrypoint and other explicit config fixtures compile with the new fields or intentionally exercise defaults.
- [x] Assert no coordinator test reaches the default semantic client or opens a network connection.
- [x] Run the Phase 4 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite, including `01_clearDuplicateAnalyses.test.ts` and both Phase 5 test files.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 4 tasks.
- [x] Commit only Phase 4 changes and reference Phase 4 of this todo in the commit body.

## Phase 5: Update Operator Documentation

- [x] Add all three settings and defaults to `ops/.env.example`.
- [x] Update `ops/README.md` so it no longer says Phase 4 is unimplemented.
- [x] Document Phase 4 skipping, untargeted semantic behavior, retained `articleCount`, and the Phase 6 boundary.
- [x] Document start, status, and cancellation endpoints.
- [x] Document status-specific timestamps, including terminal jobs without `startedAt`.
- [x] Document immediate first polling, later five-minute polling, request timeout, and transient failures.
- [x] Document six-hour monitoring, cancellation, nonzero exit, and lock release.
- [x] Document marker identity, status-404 replacement, replacement rules, and the lost-ID gap.
- [x] Document that ops cannot detect semantic zero work or full per-article coverage.
- [x] Document coordinator/worker correlation through `semanticScorerJobId`.
- [x] Document that repeated cancellation failure may require operator inspection and manual worker-node restart.
- [x] Keep destructive-run warnings and database-free verification commands accurate.
- [x] Run the Phase 5 checkpoint:
  1. Build `db-models`.
  2. Run the ops type check.
  3. Run the complete ops test suite.
  4. Build ops.
  5. Fix failures and repeat all checks.
- [x] Check off completed Phase 5 tasks.
- [x] Commit only Phase 5 documentation and example-configuration changes.

## Phase 6: Final Regression and Handoff

- [x] Confirm every accepted V03 plan requirement and final-review decision is implemented.
- [x] Confirm no worker-node production code or db-models schema changed, or document and fully verify any necessary exception.
- [x] Confirm no archive file was modified by this implementation.
- [x] Confirm `ops/package.json` executes both new Phase 5 test files.
- [x] Confirm every coordinator test that can reach Phase 5 injects controlled dependencies.
- [x] Confirm default tests do not open network connections or PostgreSQL connections.
- [x] Build `db-models`.
- [x] Run the ops type check.
- [x] Run the complete ops test suite.
- [x] Build ops.
- [x] Run `git diff --check`.
- [x] Review the diff for accidental Phase 6, Phase 7, systemd, schema, network-test, or generic-framework scope.
- [x] Fix failures and repeat the full sequence.
- [x] Check off completed Phase 6 tasks.
- [x] Commit verification fixes if any; do not create an empty commit.
- [x] Demonstrate database-free Phase 5 and coordinator tests to the operator.

## Completion Criteria

- [x] Semantic scoring starts with exactly `{}` and no Article targeting.
- [x] `articleCount` is only an entry precondition and is never changed or sent to worker-node.
- [x] Completed Phase 4 and Phase 5 are skipped correctly during continuation.
- [x] Original Phase 5 start and job identity are durable.
- [x] Terminal queued jobs without `startedAt` are valid.
- [x] Only validated unmarked completion can finish Phase 5.
- [x] Dedicated persistence completion enforces the marker rule.
- [x] Ordinary progress cannot erase marker state.
- [x] Markers match by job ID and creation time.
- [x] Unavailable jobs and replacements follow the accepted one-start rules.
- [x] Six hours triggers cancellation, Phase 5 failure, nonzero exit, and lock release.
- [x] Successful Phase 5 leaves the run incomplete at the Phase 6 boundary.
- [x] Existing coordinator tests are updated rather than bypassed.
- [x] Every coordinator path reaching Phase 5 uses controlled test dependencies.
- [x] Type checks, tests, builds, and diff checks pass.
