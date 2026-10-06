---
created_at: 2026-10-05T22:49:31Z
updated_at: 2026-10-05T22:50:07Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops State Assignment Plan V04

## Goal

Implement Phase 6 of weekly-flow-02 in `ops/`. The phase starts worker-node AI state assignment with the immutable Phase 4 `articleCount`, monitors the queue job, records its article-level outcome, and advances the incomplete run to the Phase 7 boundary.

This plan covers the Phase 6 module and the narrow worker-node result contract it requires. It does not implement AI Approver V02, systemd scheduling, a general retry framework, or a new article-selection algorithm.

## V04 Changes

This version resolves the qualifying concern in the V03 assessment:

1. Active jobs with missing contract parameters are canceled because their results can never complete Phase 6.
2. Inactive missing-contract jobs become eligible for one durable recovery replacement.
3. A marker tied to the incompatible job records detection, cancellation, and the single replacement identity.
4. A replacement that also lacks the contract stops without another replacement.
5. Tests cover worker restart followed by a compatible replacement and rejection of a second incompatible job.
6. The reviewed 180-day threshold and 12-hour monitoring limit remain unchanged.

## Sources and Constraints

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Resolve the findings in `20261005_ops_state_assignment_plan_v01_assessment_claude.md` and `20261005_ops_state_assignment_plan_v03_assessment_claude.md`.
- Continue the inside-out structure already used by Phases 4 and 5.
- Use worker-node's existing global queue and `/state-assigner/start-job` route.
- Pass `targetArticleStateReviewCount = articleCount` without recalculating or reducing the count.
- Pass `targetArticleThresholdDaysOld = 180`, as selected by the operator.
- Do not send Article IDs, an ID range, or `includeArticlesThatMightHaveBeenStateAssigned`.
- Preserve the worker's newest-first, date-threshold, relevance, and prior-assignment filters.
- Record selected, completed, skipped, and failed article counts.
- Keep the run incomplete after Phase 6, including when the worker selects no eligible articles.
- Start at most one state-assigner job during one coordinator invocation.
- Keep default ops tests database-free and worker-free.

## Existing Integration Boundary

Phase 5 completes by recording `lastPhaseCompleted = 5`. Its completion does not change the positive Phase 4 `articleCount` and does not complete the weekly run.

Phase 6 should run only when all of these conditions hold:

1. The run is incomplete.
2. Phase 5 is complete.
3. The persisted `articleCount` is a positive safe integer.
4. Phase 6 is not already complete.

The coordinator should skip completed Phases 4, 5, and 6 during continuation. A run with completed Phase 6 stops successfully at the Phase 7 boundary without starting another state-assigner job.

## State-Assigner Worker Contract

Use these interfaces:

- Start: `POST /state-assigner/start-job`.
- Status: `GET /queue-info/check-status/:jobId`.
- Cancellation: `POST /queue-info/cancel_job/:jobId`.
- Expected endpoint identity: `/state-assigner/start-job`.
- Expected start response: HTTP 202 with a nonempty job ID, `status = queued`, and the expected endpoint name.

Send exactly this request body shape:

```json
{
  "targetArticleThresholdDaysOld": 180,
  "targetArticleStateReviewCount": 100
}
```

The review count above is illustrative. At runtime, it is the persisted `articleCount` for the run.

Do not send the state assigner's optional Article-ID targeting fields. Phase 6 retains the worker's existing selection rules rather than creating a pure RSS cohort.

## Durable Job Parameters

Worker-node already defines an optional `parameters` object on queue records. Extend enqueue input with optional non-secret parameters and persist them when the job record is created.

The state-assigner route should enqueue only these parameters:

- `targetArticleThresholdDaysOld`
- `targetArticleStateReviewCount`

Do not persist the OpenAI key, backend credentials, prompt text, filesystem paths, model input, or Article content in queue parameters.

Ops should require both saved parameters to equal the immutable Phase 6 inputs on every status response. This protects continuation from a reused job ID or a different state-assigner job.

Classify parameter problems precisely:

1. A missing `parameters` object or missing required key means worker-node lacks the Phase 6 queue contract. Return the otherwise validated job lifecycle so the phase can apply incompatible-contract recovery.
2. A present value with the wrong type is malformed. Stop as invalid and unverified, with no replacement.
3. Two present positive integers that differ from the persisted inputs indicate a reused or wrong job identity. Treat that saved job as unavailable and permit normal replacement rules.

The missing-contract error should tell the operator to deploy and restart the compatible worker-node build. The durable recovery marker prevents an unfixed worker from causing an unlimited replacement loop.

## Incompatible Worker Contract Recovery

Keep missing-contract recovery separate from ordinary unavailable-job replacement.

Persist `phaseData.phase6.incompatibleContractRecovery` with:

- The incompatible job ID and validated `createdAt`.
- Detection time and missing parameter fields.
- Last validated lifecycle status.
- Cancellation request time, outcome, and verification when cancellation is needed.
- Replacement start time and replacement job ID when the one replacement is consumed.

Apply these rules:

1. Never trust the result of a job missing required queue parameters, including a completed result.
2. If the job is `queued` or `running`, persist the marker before cancellation.
3. Cancel the active incompatible job and verify that it becomes inactive or unavailable using the established cancellation checks.
4. Do not start a replacement in the same invocation that started or canceled the incompatible job.
5. If the incompatible job is already inactive, or a later continuation verifies it inactive, allow one replacement.
6. Persist the replacement job ID in the marker atomically with updating `stateAssignerJobId`.
7. If the marked replacement also lacks required parameters, cancel it when active and verify inactivity, then stop without another recovery start.
8. If cancellation or inactive-state verification is ambiguous, stop without replacement.

Immediate cancellation limits untracked AI work and reduces the chance that a later full replacement selects older Articles beyond the Phase 7 position window.

A completed incompatible job may already have persisted state assignments. The compatible replacement still uses the original Article count and threshold, while the worker excludes already assigned Articles under its existing rules.

## Worker Result Contract

The current state-assigner handler returns no structured queue result. Add a focused result contract so ops can satisfy the PRD without querying mutable database state after the job.

Use this logical result:

```text
selectedCount
completedCount
skippedCount
failedCount
targetArticleThresholdDaysOld
targetArticleStateReviewCount
```

Define the counts as follows:

- `selectedCount`: candidate Articles returned by the existing targeting query.
- `completedCount`: selected Articles for which `ArticleStateContract02` persistence succeeded.
- `skippedCount`: selected Articles skipped because their individual AI operation reached its timeout.
- `failedCount`: selected Articles whose individual analysis or assignment persistence raised a non-cancellation error.

For a normally completed queue job, require this invariant:

```text
selectedCount = completedCount + skippedCount + failedCount
```

Return zero for every count when the targeting query selects no Articles. A fatal setup or pre-selection error fails the queue job rather than manufacturing a completed count result.

Refactor `processStateAssignmentsWithTimeout` to return its counters. The job handler should save the final result through `queueContext.updateResult` before every non-canceled normal return.

## Cancellation and Abort-Like Errors

Use `queueContext.signal.aborted` as the authoritative cancellation signal. Error names or messages containing `AbortError` or `aborted` are not sufficient by themselves.

Apply these rules:

1. If the queue signal is aborted, stop processing. Any saved partial result is diagnostic and cannot complete Phase 6.
2. If an Article operation throws while the queue signal is not aborted, increment `failedCount` and continue.
3. This includes errors whose names or messages contain `AbortError` or `aborted`.
4. If enrichment throws while the queue signal is not aborted, log the enrichment failure and continue with assignment, matching the existing intended fallback.
5. If enrichment observes an actually aborted queue signal, stop and let the queue engine persist cancellation.

The implementation should remove broad abort-message matching from workflow control. It may retain a helper only when it is combined with an authoritative aborted signal.

If cancellation occurs during the Article loop, return partial counters to the handler so it may save diagnostic progress before returning. The queue engine still marks the job canceled, and ops never trusts those counts as completion.

## Meaning of Phase 6 Completion

Treat only a validated queue record with `status = completed` and a valid result as verified Phase 6 success.

Validate that:

1. Every count is a nonnegative safe integer.
2. The count invariant holds.
3. `selectedCount` does not exceed the requested `articleCount`.
4. Both result input values equal the persisted Phase 6 inputs.
5. The queue record identity, parameters, and timestamps are valid.

Article-level skips and failures are accepted partial outcomes when the overall job completes with a valid result. Record and log them, then advance to Phase 7.

Do not retry individual Articles, reduce the Phase 7 count, or mark the weekly run complete.

A completed job with zero selected Articles also completes Phase 6. The coordinator records a zero-work outcome and advances because zero work in an intermediate phase does not finish the weekly run.

## Job Identity and Timestamp Validation

Validate the saved job ID, endpoint, queue parameters, lifecycle status, and timestamps.

Apply these common checks:

1. Require the expected endpoint name.
2. Require the expected job ID.
3. Require a valid `createdAt` at or after the original persisted Phase 6 start.
4. Require both input parameters and exact value matches.
5. Reject unknown statuses.

Validate timestamps by lifecycle:

- `queued`: require `createdAt` only.
- `running`: require `startedAt` and `createdAt <= startedAt`.
- `completed`: require `startedAt` and `endedAt`, in chronological order.
- `failed` or `canceled`: require `endedAt`; permit a missing `startedAt` when the job never ran.

Treat HTTP 404, endpoint mismatch, creation before Phase 6, or present-but-different parameter values as an unavailable saved job.

Treat malformed identity, timestamps, status, missing parameters, malformed parameters, or malformed results as invalid and unverified.

Preserve the first Phase 6 `startedAt` across continuation and replacement attempts.

## Phase Module Design

Add these files under `ops/src/weekly-flow-02/phases/`:

- `06_runStateAssignment.ts` owns phase start, saved-job recovery, monitoring, replacement eligibility, monitoring-limit cancellation, progress persistence, and verified completion.
- `06_stateAssignerClient.ts` owns requests, parsing, identity checks, parameter checks, result validation, cancellation validation, and transport error categories.

The phase function accepts the persisted run, Phase 6 configuration, persistence adapter, worker client, clock, delay function, and event callback. It returns the validated job identity and result counts to the coordinator.

Keep Phase 6 policy local. Do not generalize the Phase 5 client or monitoring module until a later refactor has multiple stable contracts to unify.

## Configuration

Add these ops settings:

- `STATE_ASSIGNER_TARGET_ARTICLE_THRESHOLD_DAYS_OLD`: required positive integer; production value 180.
- `STATE_ASSIGNER_STATUS_POLL_INTERVAL_SECONDS`: optional positive integer, default 300.
- `STATE_ASSIGNER_TOLERATED_CONSECUTIVE_STATUS_FAILURES`: optional positive integer, default 2.
- `STATE_ASSIGNER_MONITORING_LIMIT_HOURS`: optional positive integer, default and production value 12.

The reviewed production policy is a 180-day Article threshold and a 12-hour Phase 6 monitoring limit. Explicit configuration may override the limit for controlled testing, but the documented production value remains 12.

The monitoring limit bounds one coordinator invocation. It is separate from the Phase 4 job timeout and the 72-hour run-continuation selection window.

## Monitoring Policy

- Perform the first status lookup immediately after saving a new job ID or loading a saved job.
- Poll active jobs every five minutes by default without overlapping requests.
- Use the shared 60-second worker-node request timeout.
- Allow two consecutive transient status failures and stop on the third.
- Reset the failure count after every valid status response.
- Treat timeouts, connection failures, HTTP 408, HTTP 425, HTTP 429, and server errors as transient.
- Stop immediately for permanent request errors or malformed responses.
- Persist compact observations without Article text or prompt content.

Start the monitoring-limit clock when the current coordinator invocation begins monitoring Phase 6. Reaching the limit triggers durable marking and cancellation; it does not establish that the worker failed.

## Monitoring-Limit Cancellation

Follow the Phase 5 marker pattern, using a separate `phaseData.phase6.monitoringLimit` object tied to both job ID and validated `createdAt`.

When an active job reaches the limit:

1. Persist the marker before cancellation.
2. Send one cancellation request.
3. Accept only `canceled` or `cancel_requested`.
4. After `cancel_requested`, wait one normal poll interval and check status once.
5. Verify that the job is inactive or unavailable.
6. Exit nonzero and never trust that marked job's result.

If cancellation or verification is ambiguous, stop without replacement. If the same marked job is active on continuation, attempt cancellation again before any replacement decision.

An inactive marked job may be replaced once on a later invocation. A replacement must still use the original persisted Article count and threshold.

A replacement is not a remainder-resume operation. It starts a new newest-first selection, excluding Articles already state-assigned under existing worker rules. It may therefore select older eligible Articles beyond the intended Phase 7 position window.

## Recovery and Replacement

Persist Phase 6 start before calling worker-node and save `stateAssignerJobId` immediately after a successful start response.

Recovery follows these rules:

1. Monitor a valid active saved job.
2. Accept a valid completed saved job and persist its result.
3. Allow one replacement for an unavailable, failed, canceled, or inactive monitoring-limited saved job.
4. Apply the separate one-replacement marker to an inactive missing-contract job.
5. Never replace a job started or canceled during the current invocation.
6. Never start more than one state-assigner job during one invocation.
7. Treat a Phase 6 start record without a saved job ID as a persistence gap eligible for one recovery start.
8. Stop on a completed job whose result is missing or invalid when its queue parameters were valid.
9. Stop on malformed queue parameters without replacement.
10. Stop when the marked incompatible-contract replacement also lacks required parameters.

State assignment can persist successful rows before a job later fails or is canceled. A replacement relies on the existing worker selection rule that excludes previously assigned Articles.

Persist replacement reasons and job observations separately. Do not claim that counts from multiple attempts are unique cohort totals, and do not add them together.

A persistence-gap recovery can queue a second full job if the original start reached worker-node before ops saved its job ID. Document the possible additional AI cost and older-Article selection in the operator README.

## Durable Phase 6 State

Use the existing `stateAssignerJobId` and `targetArticleThresholdDaysOld` columns. Add no database columns.

Store this logical shape under `phaseData.phase6`:

```text
phase6:
  status
  startedAt
  input
    targetArticleStateReviewCount
    targetArticleThresholdDaysOld
  latestProgress
  monitoringLimit
  incompatibleContractRecovery
  result
```

Persist both inputs atomically with Phase 6 start. They become immutable for that run.

The `targetArticleThresholdDaysOld` column is authoritative for the threshold. The existing `articleCount` column is authoritative for the review count.

The `phaseData.phase6.input` object is the required audit mirror. Every Phase 6 read should validate that its two values match the authoritative columns and stop on a mismatch.

Use dedicated persistence methods for Phase 6 start, progress, and completion. Generic `recordPhaseCompleted` must not complete Phase 6 because it cannot enforce immutable inputs, job identity, result counts, or monitoring markers.

Progress writes should replace only `latestProgress`. They must preserve `startedAt`, `input`, `monitoringLimit`, `incompatibleContractRecovery`, and any sibling data.

Completion should atomically save the validated counts, set `lastPhaseCompleted = 6`, preserve `runCompleted = false`, and require the completed job to match the saved job ID.

The incompatible source job and a matching monitoring-limited job cannot complete Phase 6. A marked replacement may complete it only after passing the full parameter, identity, timestamp, and result contract.

## Coordinator Integration

Extend the coordinator with injected Phase 6 function and worker dependencies.

The coordinator flow becomes:

1. Reuse or complete Phase 4.
2. Reuse or complete Phase 5.
3. Reuse or complete Phase 6.
4. Stop successfully at the Phase 7 boundary.

Log the run ID, phase, job ID, immutable inputs, queue status, counts, elapsed observations, recovery decisions, cancellation outcomes, and actionable failures.

Extend failure categorization for Phase 6 client and orchestration errors. Persist Phase 6 failures with `phase: 6` while leaving Phase 5 complete.

## Error Classification

Use typed categories for:

- invalid run state
- incompatible worker contract
- transient request
- permanent request
- malformed response
- unavailable job
- unsuccessful terminal result
- monitoring limit
- cancellation failure
- unverified outcome
- persistence failure

A start-request 404 is permanent. A status 404 is unavailable and may permit replacement. A cancellation 404 requires one status lookup before deciding whether the job is inactive or cancellation is unverified.

Missing queue parameters use the incompatible-worker-contract category and never the unavailable-job category.

Never report Phase 6 completed merely because the start request succeeded or the queue job reached an unvalidated terminal state.

## Verification Strategy

Worker-node tests should verify:

- Queue parameters are saved without secrets.
- The state-assigner route supplies the two targeting parameters.
- Zero candidates produce a valid zero-count result.
- Successful persistence increments `completedCount`.
- Per-Article timeouts increment `skippedCount` and processing continues.
- Per-Article analysis or persistence errors increment `failedCount` and processing continues.
- A persistence error containing `aborted` counts as failed when the queue signal is active.
- An enrichment error containing `aborted` still proceeds when the queue signal is active.
- Actual queue cancellation stops work and cannot produce trusted completion.
- Every non-canceled normal return saves a result satisfying the count invariant.
- Fatal setup and pre-selection errors fail the queue job.

Ops client tests should verify:

- The exact start body and start-response identity.
- Status identity, queue parameters, lifecycle timestamps, and result counts.
- Missing parameters and missing keys produce an incompatible-contract error.
- Wrong parameter types are malformed and do not permit replacement.
- Present but different parameter values classify the saved job as unavailable.
- Rejection of endpoint, job ID, creation time, or parameter mismatches.
- Rejection of missing, negative, fractional, inconsistent, or oversized counts.
- Request error classification and cancellation response validation.

Ops phase tests should verify:

- Fresh start, immediate polling, and verified completion.
- Positive, partial, and zero-selected completed outcomes.
- Transient failure reset and stop on the third consecutive failure.
- Permanent and malformed response handling.
- An active missing-contract job is marked, canceled, and not replaced in the same invocation.
- Continuation past an inactive missing-contract job, including `failureReason = worker_restart`, starts one compatible replacement.
- The recovery marker and replacement job ID survive continuation.
- A replacement that also lacks parameters stops without a second replacement.
- Saved active-job continuation.
- Failed, canceled, unavailable, and persistence-gap replacement rules.
- One-start-per-invocation enforcement.
- Monitoring-limit marking, cancellation, verification, and later replacement.
- Cancellation logs include elapsed monitoring time, requested `articleCount`, and diagnostic `selectedCount` when the worker saved one.
- Rejection of a matching monitoring-limited completion.
- Preservation of the original Article count and threshold across continuation.

Persistence and coordinator tests should verify:

- Atomic Phase 6 start writes both authoritative input columns and the audit mirror.
- Reads reject an input mirror that disagrees with the columns.
- Progress writes preserve monitoring-limit and incompatible-contract recovery markers.
- Completion requires the saved job and valid result.
- Phase 6 never changes `articleCount` or completes the run.
- Completed Phase 6 is skipped on continuation.
- Phase 6 failures leave Phase 5 complete.
- The coordinator stops at the Phase 7 boundary.

Add the new compiled ops test files to the explicit test command in `ops/package.json`.

## Documentation and Rollout

Update `ops/.env.example`, `ops/README.md`, and `ops/AGENTS.md` with the Phase 6 contract, configuration, recovery rules, and Phase 7 boundary.

The README should state that monitoring-limit, persistence-gap, and incompatible-contract replacements perform a new full newest-first selection. They do not resume only the unfinished Articles and can spend additional AI calls on older eligible Articles.

Build and test in this order:

1. Build and test worker-node after adding its result and queue-parameter contracts.
2. Build db-models before ops because ops consumes the local package.
3. Run the ops typecheck, database-free tests, and build.

Do not use the weekly-flow runtime as a smoke test.

Before a real operator-authorized run:

1. Deploy and restart worker-node with the result and parameter contracts.
2. Confirm a status record exposes both required parameters.
3. Confirm the reviewed 180-day threshold and 12-hour monitoring limit in ops configuration.
4. Build ops and confirm both services point at the intended environment.

## Expected File Areas

- `worker-node/src/modules/queue/queueEngine.ts`
- `worker-node/src/routes/stateAssigner.ts`
- `worker-node/src/modules/jobs/stateAssignerJob.ts`
- Related worker-node queue, route, and job tests
- `ops/src/config.ts`
- `ops/src/weekly-flow-02/phases/06_stateAssignerClient.ts`
- `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`
- `ops/src/weekly-flow-02/persistence.ts`
- `ops/src/weekly-flow-02/sequelizePersistence.ts`
- `ops/src/weekly-flow-02/coordinator.ts`
- Related ops configuration, phase, persistence, and coordinator tests
- `ops/package.json`
- `ops/.env.example`
- `ops/README.md`
- `ops/AGENTS.md`
