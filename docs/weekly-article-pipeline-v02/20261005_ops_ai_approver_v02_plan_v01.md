---
created_at: 2026-10-05T23:07:05Z
updated_at: 2026-10-06T16:04:23Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops AI Approver V02 Plan V01

## Goal

Implement Phase 7 of weekly-flow-02 in `ops/`. The phase previews, starts, monitors, and records the existing worker-python AI Approver V02 workflow, then atomically completes the weekly run after either verified V02 completion or a verified zero-work preview.

This plan covers the Phase 7 module and the narrow worker-python contracts it requires. It does not implement systemd scheduling, change the V02 selection algorithm, create a second approver workflow, or implement a general retry framework.

## Sources and Constraints

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Treat the accepted Phase 6 plan and implementation as a prerequisite.
- Preserve the inside-out structure already used by the earlier phase modules.
- Call worker-python directly through the configured worker-python base URL.
- Reuse the existing `/ai-approver-v02` workflow and shared worker-python queue.
- Keep default ops tests database-free and worker-free.
- Never run the weekly-flow entry point against a real environment during implementation verification.

## Existing Phase 7 Boundary

Phase 7 should run only when all of these conditions hold:

1. The weekly run is incomplete.
2. Phase 6 is complete.
3. The persisted Phase 4 `articleCount` is a positive safe integer.
4. Phase 7 is not already complete.

The coordinator must pass the same persisted `articleCount` used by Phase 6. It must not recalculate the count or reduce it because Phase 6 selected, skipped, failed, or completed fewer Articles.

A continuation with completed Phase 7 should observe that the run is already complete and make no worker request.

## Existing V02 Workflow

The worker-python V02 workflow already owns these responsibilities:

1. Preview the eligible Articles and freeze their ordered selection in `AiApproverRunsV02.selectionSnapshot`.
2. Bind the preview to the active prompt, model, Article high point, and approved boundary.
3. Accept a short-lived preview token exactly once.
4. Enqueue the accepted V02 database run on worker-python's shared queue.
5. Persist Article predictions and run counters.
6. Enforce one queued or running V02 execution at a time.
7. Stop on cooperative cancellation or its existing circuit breakers.

Ops should coordinate this workflow. It should not select Articles, read prompt content, call Codex directly, or write V02 prediction rows.

## Required Preview Contract

Call:

- `POST /ai-approver-v02/preview`

Send exactly this logical body:

```json
{
  "selectionMode": "article_position_count",
  "requestedArticleCount": 100,
  "allowPastApprovedBoundary": true,
  "allowDescriptionFallback": true
}
```

The count above is illustrative. At runtime, `requestedArticleCount` is the immutable Phase 4 `articleCount`.

The two enabled flags satisfy the PRD requirements to scan past the latest approved boundary and use Article descriptions when successful `ArticleContents02` content is unavailable.

Validate a successful preview before starting it:

1. The response is an object with a positive safe-integer V02 run ID.
2. `status` is `draft` and `jobId` is null.
3. The selection mode, requested count, and both Boolean flags equal the request.
4. `plannedEligibleCount` is a positive safe integer no greater than `articleCount`.
5. `selectionSnapshot` is an array whose length equals `plannedEligibleCount`.
6. Every snapshot item has a positive Article ID and a recognized content source.
7. The preview token is a nonempty string.
8. The preview expiration and creation timestamps are valid and chronological.

Do not log or durably save the preview token. Hold it only in memory until the immediate start request finishes.

Do not persist the selection snapshot in `WeeklyArticleFlowRuns02`. The V02 run row is its durable owner, and Article identifiers or content-source details do not belong in coordinator logs.

## Zero-Work Preview

Worker-python currently reports no eligible Articles as HTTP 400 with `error = no_eligible_articles`, rather than returning a draft with a zero count.

Treat only that exact typed response to the exact required preview request as verified zero work.

On verified zero work, atomically:

1. Record Phase 7 completed with a zero-work result.
2. Set `lastPhaseStarted = 7` and `lastPhaseCompleted = 7`.
3. Set `runCompleted = true` and `runCompletedAt` to the same completion time.
4. Leave `aiApproverV02JobId` null.

An inactive prompt, invalid configuration, malformed response, connection failure, timeout, or any other HTTP error is not zero work and must leave the weekly run incomplete.

## Preview Persistence Boundary

Persist the validated V02 preview identity before sending the start request. Store its run ID, creation time, expiration time, planned eligible count, and immutable input mirror under `phaseData.phase7`.

This boundary supports recovery when the coordinator stops before or during start. It also prevents a later continuation from mistaking an unrelated V02 execution for this weekly run.

The preview token remains intentionally absent from durable phase data.

## Required Start Contract

Call:

- `POST /ai-approver-v02/start`

Send only:

```json
{
  "runId": 41,
  "previewToken": "ephemeral-preview-token"
}
```

Validate the HTTP 202 response:

1. `runId` equals the persisted preview run ID.
2. `jobId` is a nonempty string.
3. `status` is `queued`.

Persist the V02 run ID and returned job ID immediately after validation. The existing `aiApproverV02JobId` column stores the queue job ID. The V02 run ID remains under `phaseData.phase7` because the weekly-run model has no dedicated column for it.

Start at most one V02 execution during one coordinator invocation. Creating a preview is not a job start, but the implementation should not loop through repeated previews after a start or preview failure.

## Worker Detail and Queue Identity Contract

Monitor the saved V02 run through:

- `GET /ai-approver-v02/runs/:runId`

The response contains both the durable V02 `run` and its shared `queueStatus` when a job is attached.

Validate the V02 run identity and immutable inputs on every valid detail response:

1. The run ID equals the persisted Phase 7 V02 run ID.
2. `selectionMode = article_position_count`.
3. `requestedArticleCount` equals the weekly run's persisted `articleCount`.
4. `allowPastApprovedBoundary = true`.
5. `allowDescriptionFallback = true`.
6. `plannedEligibleCount` is a nonnegative safe integer no greater than `articleCount`.
7. The saved V02 `jobId`, when present, equals `aiApproverV02JobId`.
8. The V02 run creation time is not older than the persisted Phase 7 start.

When queue status is present, also require:

1. Its job ID equals both saved job identities.
2. `endpointName = /ai-approver-v02/start`.
3. Queue parameters contain exactly the expected positive `runId` identity.
4. Its timestamps are valid for the reported lifecycle state.
5. Its creation time is not older than the V02 run or persisted preview.

Unknown statuses, wrong types, contradictory identities, and invalid chronology are malformed and unverified. They must never complete the weekly run.

## Worker Contract Adjustments

Keep changes to worker-python narrow:

1. Ensure V02 queue records continue to persist `parameters.runId`.
2. Ensure the detail route returns the complete durable run counters and queue identity needed by ops.
3. Add tests that lock the detail response contract used by Phase 7.
4. Preserve existing API proxy and portal behavior.

The queue result does not need a duplicate V02 result object. `AiApproverRunsV02` already durably owns V02 status, ending reason, counts, inputs, and the frozen selection.

Do not expose the preview token from the execution detail route or add it to queue parameters.

## Authoritative Completion Contract

The durable `AiApproverRunsV02` row is authoritative for the V02 business outcome. The shared queue record provides execution and recovery evidence but is not the owner of prediction counters.

Accept Phase 7 success only when the V02 run has `status = completed` and all of these checks pass:

1. `plannedEligibleCount`, `attemptedCount`, `completedCount`, `failedCount`, `invalidResponseCount`, and `skippedCount` are nonnegative safe integers.
2. `plannedEligibleCount = attemptedCount + skippedCount`.
3. `attemptedCount = completedCount + failedCount + invalidResponseCount`.
4. `plannedEligibleCount` does not exceed the immutable `articleCount`.
5. The immutable inputs and identities match the persisted Phase 7 state.
6. `startedAt` and `endedAt` are present and chronological.

A completed V02 run may contain individual failed, invalid, or skipped Articles. Record those counts and complete the weekly run. Do not retry individual Articles, change `articleCount`, or require every selected Article to produce a completed prediction.

The V02 row may become `completed` just before the queue engine changes its record from `running` to `completed`. Accept the valid durable completed row without waiting for that brief queue update.

Also accept a valid durable completed row when its matching queue record is missing or was marked failed by a restart after V02 committed completion. Log the queue discrepancy for diagnosis without discarding the durable V02 outcome.

## Unsuccessful V02 Outcomes

These durable V02 statuses do not complete Phase 7:

- `failed`
- `canceled`
- `circuit_breaker`

Persist their latest counters and ending reason as diagnostic progress. Do not add counters from separate V02 executions together or present them as unique cohort totals.

The draft and expired statuses are preview states, not execution outcomes.

## Monitoring Policy

Use Phase 7-specific configuration with these defaults:

- Status poll interval: 5 minutes.
- Individual request timeout: 60 seconds.
- Tolerated consecutive transient status failures: 2.
- Per-job monitoring limit: 12 hours from the queue `createdAt` timestamp.

Poll immediately after a successful start or recovery lookup, then wait one interval between non-overlapping requests.

Reset the transient-failure count after each valid detail response. Stop on the third consecutive timeout, connection failure, or temporary server error.

Stop immediately on permanent errors, malformed responses, identity mismatches, and authorization or configuration failures.

The 12-hour limit is a safety boundary for the shared worker-python queue. Time spent queued counts.

## Monitoring-Limit Cancellation

When the matching V02 queue job remains `queued` or `running` at the 12-hour limit:

1. Persist a monitoring-limit marker tied to the job ID and queue `createdAt`.
2. Call `POST /ai-approver-v02/runs/:runId/cancel` once.
3. Accept only `outcome = canceled` or `outcome = cancel_requested` with matching run and job identities.
4. After `cancel_requested`, wait one poll interval and perform one final detail lookup.
5. Verify that the durable run and queue job are no longer active.
6. Stop the invocation without starting a replacement.

If cancellation or inactive-state verification is ambiguous, stop Phase 7 and leave the run incomplete.

Never accept a later completion from the monitoring-limited V02 run. Its marker permanently disqualifies that attempt, even if worker records later report success.

## Recovery and Replacement Policy

Persist Phase 7 attempts so continuation can distinguish previews, started executions, monitoring-limited attempts, and a replacement.

Allow at most one replacement V02 execution for the weekly run. A replacement must use the original immutable `articleCount` and all required Phase 7 flags.

A later invocation may create and start the one replacement when the saved attempt is:

- an expired or unavailable unaccepted preview;
- a terminal failed, canceled, or circuit-breaker execution;
- a verified inactive monitoring-limited execution; or
- an unavailable execution whose persisted identity cannot resolve to an active or completed V02 run.

Apply these safeguards:

1. Never replace a V02 job started or canceled during the current invocation.
2. Never start more than one V02 job in one invocation.
3. Persist that the replacement allowance is consumed before or atomically with saving its preview identity.
4. If the replacement is also unsuccessful, stop for operator review without a third execution.
5. Do not replace a completed run with malformed counters or mismatched identity. That is a contract failure requiring investigation.

A replacement creates a new preview rather than resuming the old frozen selection. It selects the newest `articleCount` Article positions at replacement time, then applies V02 eligibility rules.

Because newer Articles can shift that positional window, document this limitation and the possible additional AI cost. Do not describe a replacement as a remainder-only resume.

## Start-Request Ambiguity

Persisting the preview run ID before start allows recovery from a timed-out or interrupted start request.

On continuation, inspect the saved V02 run ID before creating another preview:

1. If it has an attached job ID, validate and adopt that ID when the weekly run has none.
2. If it is completed, validate its durable outcome.
3. If it is active with an attached job, monitor it.
4. If it remains a draft or expires without starting, use the one replacement allowance.
5. If it is queued without a job ID, stop as an orphaned accepted run.

An accepted run with no attached queue job blocks later V02 acceptance and cannot be safely canceled through the existing route. The operator should restart worker-python only after diagnosis so startup reconciliation can mark the orphaned run failed.

Do not add an automatic worker restart or a force-fail endpoint as part of Phase 7.

## Durable Phase 7 State

Add no database columns. Use the existing `aiApproverV02JobId` column and store this logical shape under `phaseData.phase7`:

```text
phase7:
  status
  startedAt
  input
    selectionMode
    requestedArticleCount
    allowPastApprovedBoundary
    allowDescriptionFallback
  currentAttempt
    v02RunId
    previewCreatedAt
    previewExpiresAt
    plannedEligibleCount
    jobId
    queueCreatedAt
  attempts
  latestProgress
  monitoringLimit
  replacementConsumed
  result
```

The `articleCount` column remains authoritative for `requestedArticleCount`. The input object is its audit mirror.

Every Phase 7 read should validate that the input mirror matches the authoritative count and required constants. Stop on mismatch.

Attempt history should contain only identities, timestamps, terminal status, ending reason, and summary counts. Do not save preview tokens, prompt text, Article text, selection snapshots, or credentials.

Use dedicated persistence operations for Phase 7 start, preview, job adoption, progress, monitoring-limit marking, replacement consumption, zero-work completion, and successful completion.

Generic `recordPhaseCompleted` and `recordRunCompleted` must not independently complete Phase 7. A dedicated atomic operation must enforce the Phase 7 result contract while setting both phase and run completion.

Progress writes should replace only the relevant progress node and preserve inputs, attempt history, monitoring markers, and replacement state.

## Coordinator Integration

Extend the coordinator with injected Phase 7 function and worker dependencies.

The positive-work coordinator flow becomes:

1. Reuse or complete Phase 4.
2. Reuse or complete Phase 5.
3. Reuse or complete Phase 6.
4. Reuse or complete Phase 7.
5. Return only after the weekly run is durably complete.

Before Phase 7, reject an invalid run state instead of sending a preview request.

Log the weekly run ID, phase, V02 run ID, job ID, queue status, planned and terminal counts, elapsed observations, recovery decisions, cancellation outcomes, and actionable errors.

Never log the preview token, selection snapshot, Article content, prompt content, model input, credentials, or database connection values.

Extend failure categorization for Phase 7 client and orchestration errors. Persist failures with `phase: 7` while leaving Phase 6 complete and the weekly run incomplete.

## Error Classification

Use typed categories for:

- invalid run state
- transient request
- permanent request
- malformed response
- identity mismatch
- preview conflict
- unavailable V02 run
- unsuccessful terminal result
- monitoring limit
- cancellation failure
- orphaned accepted run
- replacement exhausted
- unverified outcome
- persistence failure

A preview `no_eligible_articles` response is a completion outcome, not an error category.

Never report Phase 7 or the weekly run completed merely because preview succeeded, start returned a job ID, the queue became terminal, or some predictions were written.

## Verification Strategy

Worker-python tests should verify:

- Preview accepts the exact Phase 7 request and freezes no more than the requested positional count.
- Both required flags are persisted on the V02 run.
- No eligible Articles returns the typed `no_eligible_articles` response.
- Start enqueues `parameters.runId` and attaches the queue job ID.
- Detail returns matching durable run and queue identities without a preview token.
- Completed, failed, canceled, circuit-breaker, and restart-reconciled outcomes retain their counters and ending reason.
- The existing API proxy tests remain compatible.

Ops client tests should verify:

- Exact preview and start bodies.
- Preview token handling without logging or persistence.
- Typed zero-work recognition and rejection of lookalike errors.
- Preview identity, input, snapshot, count, and timestamp validation.
- Start response validation.
- Detail validation across every V02 and queue lifecycle state.
- Durable completion count invariants.
- Completed-run acceptance during the brief queue transition and after a queue-store restart discrepancy.
- Transient, permanent, timeout, malformed, and 404 classifications.
- Cancellation request and response validation.

Ops phase tests should verify:

- Fresh preview, start, immediate poll, verified completion, and atomic weekly completion.
- Preview zero work atomically completes Phase 7 and the weekly run without a job ID.
- Completed results with individual failed, invalid, or skipped Articles still complete the run.
- Saved active execution continuation.
- Recovery of a job ID from the persisted V02 run ID after start ambiguity.
- Unaccepted preview replacement after expiration or unavailability.
- One replacement for failed, canceled, circuit-breaker, inactive monitoring-limited, or unavailable attempts.
- No third execution after replacement failure.
- One-start-per-invocation enforcement.
- Monitoring-limit marking, cancellation, verification, and later replacement.
- Rejection of a monitoring-limited late completion.
- Orphaned accepted run handling.
- Preservation of the original `articleCount` and required flags across continuation and replacement.
- No aggregation of counts across attempts.

Persistence and coordinator tests should verify:

- Phase 7 start atomically writes the immutable input mirror.
- Preview persistence excludes the token and snapshot.
- Job adoption and replacement consumption are atomic.
- Progress writes preserve attempt and monitoring data.
- Zero-work and successful completion set Phase 7 and run completion together.
- Failed persistence cannot leave `lastPhaseCompleted = 7` with `runCompleted = false`, or the reverse.
- Completed Phase 7 is skipped on continuation.
- Phase 7 failures leave Phase 6 complete.
- The complete coordinator path runs Phases 1–7 in order.

Add every new compiled ops test file to the explicit test command in `ops/package.json`.

## Documentation and Rollout

Update `ops/.env.example`, `ops/README.md`, and `ops/AGENTS.md` with:

- The Phase 7 request and completion contracts.
- Preview token handling.
- Zero-work behavior.
- Polling, monitoring limit, and cancellation behavior.
- Recovery and one-replacement rules.
- The orphaned accepted-run procedure.
- The positional-window and additional AI-cost warning for replacements.
- The fact that a successful Phase 7 completes the weekly run.

Update active worker-python documentation that still describes V02 as manual-only. Preserve the historical statement in archived or release-specific documents, but make current operational guidance clear that weekly-flow-02 is now an approved caller.

Build and test in this order:

1. Run focused worker-python V02 and queue tests.
2. Run the complete worker-python test suite if focused tests pass.
3. Build db-models before ops because ops consumes the local package.
4. Run ops typecheck, database-free tests, and build.
5. Run API tests if the worker detail contract changes anything observable through its proxy.

Do not use the weekly-flow runtime as a smoke test.

Before a real operator-authorized run:

1. Finish and verify Phase 6.
2. Deploy and restart worker-python with the reviewed Phase 7 contract.
3. Confirm exactly one active V02 prompt exists.
4. Confirm Codex CLI authentication and model access under the worker service account.
5. Confirm the shared queue status and V02 detail endpoints.
6. Confirm the Phase 7 poll interval and 12-hour monitoring limit.
7. Build ops and verify that it targets the intended worker-python and database environment.
8. Perform an operator-observed manual weekly-flow run before enabling a timer.

## Expected File Areas

- `worker-python/src/routes/ai_approver_v02.py`
- `worker-python/src/modules/ai_approver_v02/repository.py`
- Related worker-python V02 route, repository, orchestrator, and queue tests
- Active worker-python API or operations documentation
- `ops/src/config.ts`
- `ops/src/weekly-flow-02/phases/07_aiApproverV02Client.ts`
- `ops/src/weekly-flow-02/phases/07_runAiApproverV02.ts`
- `ops/src/weekly-flow-02/persistence.ts`
- `ops/src/weekly-flow-02/sequelizePersistence.ts`
- `ops/src/weekly-flow-02/coordinator.ts`
- Related ops configuration, phase, persistence, and coordinator tests
- `ops/package.json`
- `ops/.env.example`
- `ops/README.md`
- `ops/AGENTS.md`

## Open Questions

### 1. Phase 7 monitoring limit

How long should Phase 7 allow a V02 queue job to remain queued or running before cancellation?

#### Operator Response

Use a 12-hour queue-age limit. Phase 7 should cancel the V02 run after that limit and record the attempt as unsuccessful.

### 2. Replacement allowance

Should an unsuccessful Phase 7 attempt receive the planned single replacement, despite the positional window being recalculated at replacement time?

#### Operator Response

Allow unlimited Phase 7 continuation attempts through automatic continuation within the 72-hour window, `--continue-run`, and `--continue-run ID`. Each invocation starts at most one new Phase 7 job and exits if that job fails.
