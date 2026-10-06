---
created_at: 2026-10-06T17:14:08Z
updated_at: 2026-10-06T17:14:08Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops AI Approver V02 Plan V03

## Goal

Correct the Phase 7 current-attempt identity rules in `20261006_ops_ai_approver_v02_plan_v02.md` so a prior attempt's queue job ID cannot block recovery of a newer attempt.

V03 also removes a cross-clock chronology comparison and defines safe behavior when a durable V02 run has no matching queue record or queue creation timestamp.

All V02 requirements not changed here remain in effect, including unlimited continuation invocations, one new V02 job per invocation, durable attempt history, acceptance-aware 404 handling, monitoring-limit disqualification, and atomic weekly-run completion.

## V03 Decision

A V03 plan is required.

The V02 assessment identifies a valid permanent-stall sequence. V02 makes a new preview current before start but does not require `aiApproverV02JobId` to stop identifying the previous attempt. A later ambiguous start can therefore expose a valid new job that conflicts with the stale weekly-row mirror.

Use the assessment's preferred correction:

1. Atomically clear `aiApproverV02JobId` when a new preview attempt becomes current.
2. Preserve the prior job ID in the prior attempt's history entry.
3. Adopt the new job ID after a valid start response or recovery detail response.

No additional operator response is required. This is a persistence and identity-consistency correction, not a new product decision.

## Sources and Scope

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Carry forward `20261006_ops_ai_approver_v02_plan_v02.md` except where V03 changes it.
- Resolve `20261006_ops_ai_approver_v02_plan_v02_assessment_claude.md`.
- Keep the accepted Phase 6 unlimited-continuation direction.
- Add no database columns.
- Do not change V02 selection, prompt, prediction, or queue behavior.
- Keep default ops tests database-free and worker-free.

## Current-Attempt Identity Invariant

The Phase 7 state has two current-identity fields:

- `phaseData.phase7.currentV02RunId` identifies the current V02 database run.
- `aiApproverV02JobId` mirrors the current attempt's queue job ID after one is known.

Apply these invariants:

1. A current preview that has not produced or exposed a queue job must have `aiApproverV02JobId = null`.
2. A current accepted attempt with a known job must have the same job ID in its attempt entry and `aiApproverV02JobId`.
3. A prior attempt's job ID remains only in that prior attempt's history entry.
4. `aiApproverV02JobId` must never point to a non-current attempt.
5. Attempt history remains keyed by `v02RunId`; queue identity remains `jobId + queueCreatedAt` when both values are available.

The column is a current-attempt mirror, not lifetime audit history.

## Atomic Preview Transition

Initial and continuation preview persistence must make one atomic state transition.

For a continuation preview, the operation should:

1. Lock and validate the weekly run.
2. Confirm Phase 7 is incomplete with the required immutable inputs.
3. Confirm the expected prior `currentV02RunId` and `aiApproverV02JobId`.
4. Confirm the prior attempt is eligible for continuation.
5. Preserve the prior attempt, including its job ID and queue creation time.
6. Append the new preview attempt.
7. Set `currentV02RunId` to the new V02 run ID.
8. Set `aiApproverV02JobId` to null.
9. Preserve all other attempt history and monitoring markers.

The initial preview operation should also require and preserve a null job-ID mirror.

If the atomic write fails, the prior attempt must remain current with its original job-ID mirror. Do not send the new preview's start request.

## Start Response Persistence

After a valid HTTP 202 start response, atomically:

1. Confirm `currentV02RunId` equals the response run ID.
2. Confirm the current attempt has no conflicting saved job ID.
3. Confirm `aiApproverV02JobId` is null or already equals the same job ID during an idempotent repeat of the persistence operation.
4. Save the job ID on the current attempt.
5. Set `aiApproverV02JobId` to the same value.
6. Save acceptance evidence.

Do not overwrite a non-null, different job ID. That remains an identity mismatch.

## Recovery Adoption

After an ambiguous start request, a later invocation queries the saved `currentV02RunId`.

When the durable detail response exposes a valid job ID:

1. Confirm the detail run ID equals `currentV02RunId`.
2. Confirm the current attempt has no different job ID.
3. Confirm `aiApproverV02JobId` is null or already equals the exposed job ID.
4. Validate the V02 inputs and any available queue identity.
5. Atomically save the job ID on the current attempt and in `aiApproverV02JobId`.
6. Persist acceptance evidence.

This permits the sequence:

```text
attempt A job 0007 fails
-> attempt B preview becomes current and clears the mirror
-> B start response is lost
-> detail exposes B job 0008
-> ops adopts 0008 and continues
```

If the weekly-row mirror contains a job from a non-current attempt, classify the persisted state as invalid. Do not silently clear it outside the protected preview transition.

## Detail Validation

Replace V02 detail rule 6 with current-attempt-aware validation:

1. A present V02 job ID must equal the current attempt's saved job ID when that attempt value is non-null.
2. A present V02 job ID may be adopted when both the current attempt's job ID and `aiApproverV02JobId` are null.
3. After adoption, the V02 job ID, current attempt job ID, and weekly-row mirror must match.
4. A prior attempt's historical job ID has no role in validating the current attempt.

Keep the existing V02 run identity, immutable input, counter, lifecycle, endpoint, queue parameter, and timestamp checks.

## Successful Completion Invariant

The atomic Phase 7 completion operation must require:

1. The completing V02 run ID equals `currentV02RunId`.
2. The completing V02 run ID equals the current attempt's `v02RunId`.
3. The completing run's job ID equals the current attempt's saved job ID.
4. `aiApproverV02JobId` equals that same job ID.
5. The current attempt is not monitoring-limited.
6. All V02 input, count, status, and chronology checks pass.

A completed prior attempt cannot complete Phase 7 after a later attempt becomes current.

## Zero-Work Completion

A continuation preview can return typed `no_eligible_articles` before it creates a V02 run or queue job.

The zero-work completion operation should:

1. Confirm the expected prior attempt is eligible for continuation.
2. Set `aiApproverV02JobId` to null.
3. Preserve all prior attempt history and job identities.
4. Record `zeroWorkAfterPriorAttempts = true` when history contains a started attempt.
5. Atomically complete Phase 7 and the weekly run under the V02 zero-work rules.

For initial zero work, keep `aiApproverV02JobId` null and set `zeroWorkAfterPriorAttempts = false`.

## Chronology Source

Do not compare worker-python's PostgreSQL `createdAt` with an ops-process-clock Phase 7 `startedAt`.

Validate chronology within one clock domain:

1. The V02 run `createdAt` must equal, or be consistent with, the persisted preview `createdAt` returned by worker-python.
2. Preview expiration must be later than preview creation.
3. Queue `createdAt`, when present, must not be earlier than the V02 run's creation.
4. V02 `startedAt` and `endedAt` must be chronological for the reported lifecycle state.
5. Queue lifecycle timestamps must be chronological for the queue status.

Keep the local Phase 7 `startedAt` for coordinator audit and elapsed coordinator logging. Do not use it to reject a worker-owned database timestamp.

## Missing Queue Record or Creation Time

Do not invent a queue creation time from the V02 run, preview, coordinator clock, or adoption time.

When a durable V02 run has a job ID but no matching queue record:

1. A valid durable `completed` run may still complete Phase 7 under the existing authoritative-completion rule.
2. A valid durable terminal unsuccessful run remains unsuccessful and continuation-eligible on a later invocation.
3. A durable `queued` or `running` run without queue status is unverified and cannot be monitored against the 12-hour queue-age limit.
4. Stop while that durable run remains active and the queue identity is unavailable.
5. Do not cancel, time out, replace, or complete the active run using an inferred queue timestamp.

Startup reconciliation or a later valid detail response may eventually convert the state into a verified terminal outcome or restore usable queue evidence.

## Persistence Interface

The Phase 7 persistence interface should expose protected operations for:

- Initial preview persistence with a null job-ID mirror.
- Continuation preview persistence that archives the prior identity and clears the mirror.
- Start-response job binding.
- Recovery job adoption.
- Attempt progress and monitoring evidence.
- Zero-work completion with a null mirror.
- Successful completion with exact current identities.

Progress writes must not change `currentV02RunId` or `aiApproverV02JobId` unless they are the specific protected binding or adoption operation.

In-memory test persistence and Sequelize persistence must enforce the same preconditions.

## Phase Runner Behavior

The Phase 7 runner should:

1. Validate the current run and attempt identities before worker calls.
2. Use the protected preview transition before a continuation start.
3. Stop if preview persistence fails.
4. Bind the job identity after a valid start response.
5. Stop after an ambiguous start response.
6. Adopt a recovered current-attempt job only through the protected adoption operation.
7. Treat missing queue time on an active durable run as unverified.
8. Complete only through the exact current-identity operation.

Retain the one-new-job-per-invocation guard and all V02 continuation eligibility rules.

## Verification Strategy

Add phase tests for:

- Attempt A fails, attempt B preview becomes current, and the weekly-row job mirror is cleared.
- Attempt B's start response is ambiguous, a later invocation adopts B's job, and B completes.
- A stale prior-attempt mirror is rejected as invalid persisted state.
- A prior attempt's late completion cannot complete Phase 7 after B becomes current.
- Zero work after prior attempts leaves the mirror null and preserves history.
- A worker database timestamp slightly earlier than the ops clock does not fail validation.
- A valid completed V02 run with a missing queue record can complete.
- An active V02 run with a missing queue record stops without an invented monitoring deadline.

Add persistence tests for:

- Continuation preview persistence clears `aiApproverV02JobId` atomically.
- A failed preview transition preserves the prior current attempt and job mirror.
- Job binding and adoption update the current attempt and mirror together.
- Binding rejects a different non-null mirror.
- Progress writes cannot restore a prior attempt's job ID.
- Successful completion requires matching current V02 run and job identities.
- Zero-work completion clears the mirror and preserves historical identities.

Retain all V02 worker contract, client, monitoring, cancellation, 404, unlimited-continuation, and coordinator tests.

## Documentation

Update `ops/README.md` and `ops/AGENTS.md` to explain:

- `aiApproverV02JobId` mirrors only the current attempt.
- A new current preview clears that mirror before start.
- Historical job IDs remain under Phase 7 attempt history.
- Missing queue timestamps are never inferred.
- Active durable runs without queue evidence require later recovery evidence or operator investigation.

## Build and Test Order

Run:

1. Focused worker-python V02 tests only if contract-locking coverage changes.
2. `npm run build --workspace @newsnexus/db-models`.
3. `npm run typecheck --workspace newsnexus12-ops`.
4. `npm test --workspace newsnexus12-ops`.
5. `npm run build --workspace newsnexus12-ops`.

Do not use the weekly-flow runtime as a smoke test.

## Expected File Areas

- `ops/src/weekly-flow-02/phases/07_runAiApproverV02.ts`
- `ops/src/weekly-flow-02/persistence.ts`
- `ops/src/weekly-flow-02/sequelizePersistence.ts`
- Phase 7 client, phase, persistence, and coordinator tests
- `ops/tests/weekly-flow-02/persistenceTestSupport.ts`
- `ops/README.md`
- `ops/AGENTS.md`

No db-models schema, V02 worker selection behavior, general retry framework, CLI syntax, or systemd unit should change under this correction.
