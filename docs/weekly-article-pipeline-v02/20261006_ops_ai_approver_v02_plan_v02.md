---
created_at: 2026-10-06T17:08:19Z
updated_at: 2026-10-06T17:08:19Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops AI Approver V02 Plan V02

## Goal

Implement Phase 7 of weekly-flow-02 in `ops/`. The phase previews, starts, monitors, and records the existing worker-python AI Approver V02 workflow.

Phase 7 atomically completes the weekly run after either:

1. A verified V02 completion.
2. A verified zero-work preview.

This plan covers the Phase 7 module and the narrow worker-python contracts it requires. It does not implement systemd scheduling, change V02 selection, create another approver workflow, or create a general retry framework.

## V02 Decision

A V02 plan is required.

The V01 body limits the weekly run to one replacement, while its operator response allows unlimited continuation attempts. The V01 recovery rules also treat an unavailable saved V02 run too broadly, even though the detail route hides draft and expired previews but retains accepted execution rows.

V02 resolves both assessment concerns and incorporates the non-blocking technical clarifications from `20261005_ops_ai_approver_v02_plan_v01_assessment_claude.md`.

No additional operator response is required. The unresolved items are technical contract decisions supported by the PRD, the accepted Phase 6 direction, and current worker-python behavior.

## Sources and Constraints

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Treat the accepted Phase 6 plan and implementation as prerequisites.
- Follow Phase 6 V06's continuation model where the workflows share the same operational policy.
- Preserve the inside-out structure used by earlier phase modules.
- Call worker-python directly through the configured worker-python base URL.
- Reuse the existing `/ai-approver-v02` workflow and shared worker-python queue.
- Keep default ops tests database-free and worker-free.
- Never run the weekly-flow entry point against a real environment during implementation verification.
- Add no database columns.

## Phase 7 Entry Boundary

Run Phase 7 only when all of these conditions hold:

1. The weekly run is incomplete.
2. Phase 6 is complete.
3. The persisted Phase 4 `articleCount` is a positive safe integer.
4. Phase 7 is not already complete.

Pass the same persisted `articleCount` used by Phase 6. Do not recalculate it or reduce it because Phase 6 selected, skipped, failed, or completed fewer Articles.

A continuation with completed Phase 7 should observe that the weekly run is complete and make no worker request.

## Existing V02 Responsibilities

Worker-python V02 already owns:

1. Previewing eligible Articles and freezing their ordered selection in `AiApproverRunsV02.selectionSnapshot`.
2. Binding the preview to the active prompt, model, Article high point, and approved boundary.
3. Accepting a short-lived preview token once.
4. Enqueuing the accepted V02 run on the shared queue.
5. Persisting predictions and run counters.
6. Enforcing one queued or running V02 execution at a time.
7. Stopping on cooperative cancellation or existing circuit breakers.

Ops coordinates this workflow. It must not select Articles, read prompt content, call Codex directly, or write V02 prediction rows.

## Immutable Phase Inputs

Every Phase 7 preview must use:

```json
{
  "selectionMode": "article_position_count",
  "requestedArticleCount": 100,
  "allowPastApprovedBoundary": true,
  "allowDescriptionFallback": true
}
```

The count is illustrative. At runtime, `requestedArticleCount` equals the weekly run's immutable `articleCount`.

Every attempt, including later continuation attempts, must use the same count and flags. The input mirror under `phaseData.phase7` must match the authoritative `articleCount` on every read.

## Preview Contract

Call `POST /ai-approver-v02/preview` and validate:

1. The response is an object with a positive safe-integer V02 run ID.
2. `status` is `draft` and `jobId` is null.
3. The selection mode, requested count, and both flags equal the request.
4. `plannedEligibleCount` is a positive safe integer no greater than `articleCount`.
5. `selectionSnapshot` is an array with `plannedEligibleCount` items.
6. Every snapshot item has a positive Article ID and recognized content source.
7. The preview token is nonempty.
8. Creation and expiration timestamps are valid and chronological.

Hold the token only in memory through the immediate start request. Never log or persist it.

Do not persist the selection snapshot in `WeeklyArticleFlowRuns02`. The V02 run row owns that data. Do not write Article identifiers or content-source details to coordinator logs.

## Zero-Work Preview

Worker-python reports no eligible Articles as HTTP 400 with `error = no_eligible_articles`.

Treat only that exact typed response to the required preview request as verified zero work.

Atomically:

1. Record Phase 7 completed with a zero-work result.
2. Set `lastPhaseStarted = 7` and `lastPhaseCompleted = 7`.
3. Set `runCompleted = true` and `runCompletedAt` to the same completion time.
4. Leave `aiApproverV02JobId` null when no earlier attempt supplied a job ID.
5. Record whether earlier Phase 7 attempts existed.

Use a field such as `zeroWorkAfterPriorAttempts` so later zero work does not look like a weekly run that performed no prior AI work.

An inactive prompt, invalid configuration, malformed response, connection failure, timeout, or any other HTTP error is not zero work.

## Preview Persistence Boundary

Persist each validated preview before sending its start request.

The saved attempt must include:

- V02 run ID.
- Preview creation and expiration times.
- Planned eligible count.
- Immutable input mirror.
- Attempt creation time and continuation reason.

This boundary supports recovery when the coordinator stops before or during start. It prevents an unrelated V02 run from being adopted.

Creating a preview does not count as starting a V02 job. One invocation may create only the preview needed for its one permitted start attempt.

## Start Contract

Call `POST /ai-approver-v02/start` with only:

```json
{
  "runId": 41,
  "previewToken": "ephemeral-preview-token"
}
```

Validate the HTTP 202 response:

1. `runId` equals the persisted preview run ID.
2. `jobId` is nonempty.
3. `status` is `queued`.

Persist the V02 run ID, returned job ID, and acceptance evidence immediately after validation. The existing `aiApproverV02JobId` column identifies the current queue job. The V02 run ID remains in the current Phase 7 attempt.

Start at most one V02 execution per coordinator invocation. Retain an invocation-local `startedThisInvocation` guard or equivalent.

## Continuation Model

An incomplete weekly run has no lifetime limit on valid Phase 7 continuation attempts.

Supported paths are:

1. Automatic continuation of the latest eligible incomplete run within the 72-hour default window.
2. `--continue-run` for the latest eligible incomplete run.
3. `--continue-run ID` for a deliberately selected eligible run.

The 72-hour rule controls default run selection. It is not an attempt limit. Explicit continuation keeps its existing deliberate-run behavior.

When an attempt ends unsuccessfully:

1. Record its verified outcome.
2. Exit the current invocation nonzero.
3. Do not start another Phase 7 execution in that invocation.
4. Allow a later invocation to continue after the prior attempt is verified inactive or unavailable under the rules below.

Do not add `replacementConsumed`, a replacement-exhausted error, a third-attempt prohibition, or any other lifetime attempt ceiling.

## Durable Attempt History

Use repeatable attempt history under `phaseData.phase7`:

```text
phase7:
  status
  startedAt
  input
    selectionMode
    requestedArticleCount
    allowPastApprovedBoundary
    allowDescriptionFallback
  attempts:
    - v02RunId
      previewCreatedAt
      previewExpiresAt
      plannedEligibleCount
      continuationReason
      acceptedObservedAt
      acceptedStatus
      jobId
      queueCreatedAt
      lastObservedStatus
      endingReason
      counts
      monitoringLimitedAt
      cancellationRequestedAt
      cancellationOutcome
      inactiveVerifiedAt
  currentV02RunId
  latestProgress
  result
```

Use `v02RunId` as the stable attempt key. Worker queue job IDs can be reused after queue-store replacement, while the database V02 run ID remains stable.

When a job exists, also validate and retain its `jobId + queueCreatedAt` identity. This distinguishes reused queue IDs and binds monitoring-limit evidence to the exact queue execution.

Each V02 run ID appears once. Later observations update its entry rather than append duplicates.

Attempt history is audit, recovery, and disqualification evidence. Its length never controls continuation eligibility.

Do not store tokens, prompt text, Article text, selection snapshots, model input, credentials, worker logs, or full responses.

## Detail and Queue Identity Contract

Monitor a saved attempt through `GET /ai-approver-v02/runs/:runId`.

Validate the durable V02 run on every successful response:

1. Run ID equals the attempt's `v02RunId`.
2. `selectionMode = article_position_count`.
3. `requestedArticleCount` equals the persisted `articleCount`.
4. Both required flags are true.
5. `plannedEligibleCount` is a nonnegative safe integer no greater than `articleCount`.
6. A present V02 `jobId` matches the attempt and `aiApproverV02JobId`.
7. Run creation is not older than the saved preview or original Phase 7 start.

When queue status is present, also require:

1. Job ID equals both saved job identities.
2. `endpointName = /ai-approver-v02/start`.
3. Queue parameters contain exactly the expected positive `runId` identity.
4. Lifecycle timestamps are valid for the status.
5. Queue creation is not older than the V02 run or preview.

Unknown statuses, wrong types, contradictory identities, and invalid chronology are malformed and unverified. They cannot complete the weekly run or authorize another attempt.

## Acceptance Evidence and 404 Handling

The worker detail route calls `get_run(..., include_preview=False)`. It returns 404 for draft, expired, purged, or nonexistent previews. It does not return those preview states to ops.

Persist acceptance evidence when either occurs:

1. A valid start response is received.
2. A valid detail response first shows `queued`, `running`, or a terminal execution status.

A saved attempt's 404 is continuation-eligible only when:

1. No job ID is saved for the attempt.
2. No acceptance evidence was ever persisted.

Treat this as an unavailable unaccepted preview. Do not claim whether it was draft, expired, or purged because the route does not reveal that distinction.

If an accepted attempt returns 404, stop with an identity mismatch or unverified outcome. Do not start another V02 run. Accepted V02 database rows are not normally deleted, so this indicates a wrong environment, corrupted identity, or another contract failure.

## Start-Request Ambiguity

After a timed-out, disconnected, or interrupted start request, stop the current invocation without sending the start request again.

On later continuation:

1. Query the persisted V02 run ID.
2. Adopt a valid attached job ID when the weekly row lacks it.
3. Persist acceptance evidence from a visible execution status.
4. Monitor a valid active execution.
5. Validate a completed execution.
6. Treat a pre-acceptance 404 as an unavailable unaccepted preview eligible for a new attempt.
7. Treat a post-acceptance 404 as an identity mismatch and stop.

If detail shows `queued` without a job ID, stop that invocation as an orphaned accepted run. Do not make this a permanent disqualifier. A later invocation may adopt the job after attachment, or observe a failed run after worker startup reconciliation.

Do not add automatic worker restart or a force-fail endpoint.

## Start Conflicts and Manual V02 Runs

A manual or portal V02 execution can block Phase 7 start because worker-python permits only one active V02 run.

On a typed start conflict:

1. Stop the invocation.
2. Record the current attempt as not yet accepted unless separate evidence proves acceptance.
3. Do not cancel or otherwise alter the other V02 run.
4. Let the saved draft expire naturally.
5. Reinspect the saved V02 run on a later continuation before creating a new preview.

The shared `v02_run_conflict` code covers more than a manual-run collision. Preserve the returned category and safe message for diagnosis, but do not infer another run's identity or cancel any run not bound to this weekly attempt.

Document that an active manual V02 run blocks Phase 7.

## Authoritative Completion Contract

The durable `AiApproverRunsV02` row owns the business outcome. The queue record provides execution and recovery evidence but does not own prediction counters.

Accept success only when the V02 run has `status = completed` and:

1. All planned, attempted, completed, failed, invalid, and skipped counts are nonnegative safe integers.
2. `plannedEligibleCount = attemptedCount + skippedCount`.
3. `attemptedCount = completedCount + failedCount + invalidResponseCount`.
4. `plannedEligibleCount` does not exceed `articleCount`.
5. Immutable inputs and identities match persisted Phase 7 state.
6. `startedAt` and `endedAt` are present and chronological.
7. The attempt is not marked monitoring-limited.

A completed run may include failed, invalid, or skipped Articles. Record its counts and complete the weekly run. Do not retry individual Articles or aggregate counts across attempts.

Accept a valid durable completed row during the brief interval before the queue record becomes completed.

Also accept it when the matching queue record is absent or restart-failed after the V02 transaction committed. Log the queue discrepancy without discarding the durable outcome.

## Unsuccessful Outcomes

These durable statuses leave Phase 7 incomplete:

- `failed`
- `canceled`
- `circuit_breaker`

Persist the attempt's latest counters and ending reason. Exit the invocation without starting another job.

A later invocation may start one new attempt after confirming the saved attempt is terminal.

Draft and expired are preview states, but ops cannot observe them through the execution detail route.

## Monitoring Policy

Use Phase 7-specific defaults:

- Poll interval: 5 minutes.
- Individual request timeout: 60 seconds.
- Tolerated consecutive transient status failures: 2.
- Per-job monitoring limit: 12 hours from queue `createdAt`.

Poll immediately after a successful start or recovery lookup. Wait one interval between non-overlapping requests.

Reset the transient count after each valid detail response. Stop on the third consecutive timeout, connection failure, or temporary server error.

Stop immediately on permanent errors, malformed responses, identity mismatches, and authorization or configuration failures.

Time spent queued behind deduper, location-scorer, or other shared worker jobs counts toward the 12-hour limit.

## Monitoring-Limit Cancellation

When a matching V02 job remains queued or running at 12 hours:

1. Mark that exact attempt as monitoring-limited using `v02RunId`, `jobId`, and queue `createdAt`.
2. Call `POST /ai-approver-v02/runs/:runId/cancel` once.
3. Accept only matching `canceled` or `cancel_requested` outcomes.
4. After `cancel_requested`, wait one poll interval and perform one final detail lookup.
5. Verify that the durable run and queue job are inactive.
6. Stop the invocation without starting another attempt.

Treat cancel outcome `not_found` as ambiguous and stop. Do not replace from that response alone.

If cancellation or inactive verification is ambiguous, leave Phase 7 incomplete.

Never accept later completion from a monitoring-limited V02 run. The marker on that attempt permanently disqualifies that exact V02 run, even after a later attempt starts.

A later invocation may create one new attempt only after the limited attempt is verified inactive.

## Continuation Eligibility

A later invocation may create and start one new attempt when the current saved attempt is:

- An unavailable unaccepted preview under the 404 rules.
- Terminal `failed`, `canceled`, or `circuit_breaker`.
- A verified inactive monitoring-limited execution.
- An orphaned accepted execution later reconciled to a verified terminal failure.

Apply these safeguards:

1. Never start another job after starting or canceling a job in the current invocation.
2. Never start more than one V02 job in one invocation.
3. Use the original immutable `articleCount` and required flags.
4. Persist the new preview as a new attempt before its start request.
5. Stop on malformed state, identity mismatch, ambiguous activity, or post-acceptance 404.
6. Permit another later invocation after each newly started attempt ends unsuccessfully.

Each new preview selects the newest `articleCount` Article positions at that time and then applies V02 eligibility rules.

Newer Articles can shift the positional window. Repeated attempts may incur additional AI cost and are not remainder-only resumes.

## Persistence Operations

Use dedicated operations for:

- Phase 7 initialization and immutable input persistence.
- Preview attempt persistence.
- Acceptance observation and job adoption.
- Attempt progress updates.
- Monitoring-limit marking and cancellation evidence.
- Atomic continuation-attempt preview persistence.
- Zero-work completion.
- Successful Phase 7 and weekly-run completion.

The continuation operation should atomically:

1. Confirm Phase 7 is in progress with valid inputs.
2. Confirm the expected current V02 run and saved job identities.
3. Confirm the prior attempt is eligible for continuation.
4. Append the new preview attempt and make it current.
5. Preserve every prior attempt and monitoring marker.

A failed continuation persistence write must leave the prior current attempt and history unchanged.

Progress writes merge by `v02RunId` and preserve all sibling phase data.

Generic phase or run completion operations must not independently complete Phase 7. A dedicated atomic operation must validate the Phase 7 result while setting both phase and weekly-run completion.

## Worker Contract Adjustments

Keep worker-python changes narrow.

Current code already:

- Enqueues `parameters.runId`.
- Returns the durable execution row and queue record from detail.
- Clears the preview token on acceptance.
- Hides draft and expired previews from execution detail.

Treat these as contracts to lock with tests before adding route code. Change runtime code only if a focused test proves a required field is missing.

Preserve API proxy and portal behavior. Never expose the preview token through detail or queue parameters.

## Coordinator Integration

Extend the coordinator with injected Phase 7 and worker dependencies.

The positive-work flow becomes:

1. Reuse or complete Phase 4.
2. Reuse or complete Phase 5.
3. Reuse or complete Phase 6.
4. Reuse or complete Phase 7.
5. Return only after the weekly run is durably complete.

Before Phase 7, reject invalid run state without sending a preview request.

Log run ID, phase, V02 run ID, job ID, queue status, planned and terminal counts, recovery decisions, cancellation outcomes, and actionable errors.

Never log tokens, selection snapshots, Article or prompt content, model input, credentials, or connection values.

Persist Phase 7 failures while leaving Phase 6 complete and the weekly run incomplete.

## Error Classification

Use typed categories for:

- invalid run state
- transient request
- permanent request
- malformed response
- identity mismatch
- start conflict
- unavailable unaccepted preview
- accepted run unavailable
- unsuccessful terminal result
- monitoring limit
- cancellation failure
- orphaned accepted run
- unverified outcome
- persistence failure

Remove `replacement exhausted`.

The typed `no_eligible_articles` preview response is a completion outcome, not an error.

Never report completion because a preview succeeded, start returned a job ID, the queue became terminal, or some predictions were written.

## Verification Strategy

Worker-python tests should verify:

- The exact preview request and positional count boundary.
- Both required flags persist on the V02 run.
- No eligible Articles returns typed `no_eligible_articles`.
- Start enqueues `parameters.runId` and attaches the job ID.
- Detail hides previews and returns execution counters plus queue identity without a token.
- Completed, failed, canceled, circuit-breaker, and restart-reconciled outcomes retain counters and ending reason.
- Existing API proxy tests remain compatible.

Ops client tests should verify:

- Exact preview and start bodies.
- Token handling without logging or persistence.
- Typed zero-work recognition and lookalike rejection.
- Preview identity, inputs, snapshot, count, and timestamp validation.
- Start and detail validation across lifecycle states.
- Counter invariants and authoritative durable completion.
- Completion during queue transition and after queue-store discrepancy.
- Transient, permanent, timeout, malformed, and typed error classifications.
- Cancellation accepts matching `canceled` and `cancel_requested` only.
- Cancellation rejects `not_found`.

Ops phase tests should verify:

- Fresh preview, start, immediate poll, completion, and atomic weekly completion.
- Zero work completes Phase 7 and records whether prior attempts existed.
- Individual failed, invalid, or skipped Articles do not block valid completion.
- Active execution continuation and start-ambiguity job adoption.
- Pre-acceptance 404 permits a later attempt.
- Post-acceptance 404 stops without another attempt.
- A queued run without job ID stops one invocation and can be adopted later.
- A manual-run start conflict stops without canceling the other run.
- Three or more invocations may each start one continuation attempt.
- A newly started unsuccessful job never causes a second start in the same invocation.
- Monitoring-limited attempts are canceled, verified, and replaced only later.
- Late completion of any earlier monitoring-limited V02 run is rejected.
- Reused queue job IDs do not confuse attempts with different V02 run IDs or creation times.
- Original `articleCount` and flags survive every continuation.
- Counts are not aggregated across attempts.

Persistence and coordinator tests should verify:

- Phase 7 initialization atomically writes its input mirror.
- Preview persistence excludes tokens and snapshots.
- Acceptance observation and job adoption are atomic.
- Continuation preview persistence checks the expected prior attempt.
- Attempt updates merge by V02 run ID and preserve history.
- Monitoring evidence remains attached to the exact attempt.
- Zero-work and successful completion set Phase 7 and run completion together.
- Failed persistence cannot split phase and run completion.
- Completed Phase 7 is skipped.
- Phase 7 failures leave Phase 6 complete.
- The coordinator executes Phases 1 through 7 in order.

Add each compiled ops test file to the explicit command in `ops/package.json`.

## Documentation and Rollout

Update `ops/.env.example`, `ops/README.md`, and `ops/AGENTS.md` with:

- Preview, start, detail, and completion contracts.
- Token handling and zero-work behavior.
- Unlimited continuation invocations and one start per invocation.
- The 72-hour default selection window and explicit continuation behavior.
- Polling, queue-age limit, cancellation, and shared-queue wait behavior.
- Pre-acceptance and post-acceptance 404 handling.
- Manual V02 conflict behavior.
- Orphaned accepted-run recovery.
- Positional-window drift and additional AI cost.
- Successful Phase 7 completing the weekly run.
- A warning that future systemd service units must not automatically restart the coordinator after a failure exit.

Update active worker-python guidance that describes V02 as manual-only. Preserve historical documents.

Build and test in this order:

1. Run focused worker-python V02 and queue tests.
2. Run the complete worker-python test suite if focused tests pass.
3. Build db-models.
4. Run ops typecheck and database-free tests.
5. Build ops.
6. Run API tests only if an observable proxy contract changes.

Do not use the weekly-flow runtime as a smoke test.

Before an operator-authorized real run:

1. Finish and verify Phase 6.
2. Deploy and restart worker-python with the reviewed contract.
3. Confirm exactly one active V02 prompt.
4. Confirm Codex CLI authentication and model access for the worker service account.
5. Confirm queue status and V02 detail endpoints.
6. Confirm the five-minute interval and 12-hour queue-age limit.
7. Build ops and verify its intended worker and database targets.
8. Perform an operator-observed manual weekly-flow run before enabling a timer.

## Expected File Areas

- `worker-python/src/routes/ai_approver_v02.py`
- `worker-python/src/modules/ai_approver_v02/repository.py`
- Related worker-python V02 route, repository, orchestrator, and queue tests
- Active worker-python operations documentation
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

No db-models schema, V02 selection algorithm, general retry framework, or systemd unit should change under this plan.
