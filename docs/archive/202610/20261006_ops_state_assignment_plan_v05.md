---
created_at: 2026-10-06T16:45:11Z
updated_at: 2026-10-06T16:45:11Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops State Assignment Plan V05

## Goal

Revise the implemented Phase 6 recovery policy so an incomplete weekly run has no lifetime limit on valid continuation attempts.

Automatic continuation within the 72-hour window, `--continue-run`, and `--continue-run ID` may each start another state-assignment job when the saved job is verified inactive and Phase 6 remains incomplete.

One coordinator invocation still starts at most one new Phase 6 job. If that job fails, is canceled, reaches its monitoring limit, or lacks the required worker contract, the invocation exits nonzero. A later command invocation may continue the run again.

## V05 Changes

V05 changes only Phase 6 recovery policy and its durable audit state:

1. Remove the lifetime one-replacement limit from incompatible-worker-contract recovery.
2. Permit repeated valid continuations after successive incompatible, failed, canceled, unavailable, or monitoring-limited jobs.
3. Preserve the one-new-job-per-invocation rule.
4. Preserve inactive-job verification before every replacement.
5. Replace the one-off incompatible source/replacement marker with repeatable attempt records.
6. Keep the original Article count, 180-day threshold, worker result contract, 12-hour monitoring limit, and Phase 7 boundary unchanged.

This version supersedes the incompatible-contract replacement cap in V04. The remaining V04 worker, monitoring, completion, and safety contracts remain in force.

## Source and Scope

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Continue using worker-node's existing global queue and `/state-assigner/start-job` route.
- Keep the implemented Phase 6 module and state-assigner client.
- Do not create a general retry framework.
- Do not change run selection, the 72-hour default continuation window, or CLI syntax.
- Do not change worker-node Article selection or result counting.
- Do not add database columns.
- Keep default ops tests database-free and worker-free.

## Clarified Continuation Model

The weekly-flow process does not restart itself.

When a Phase 6 job ends unsuccessfully:

1. The current coordinator invocation records the outcome.
2. The invocation exits nonzero.
3. No replacement job starts automatically in that invocation.
4. A later weekly-flow command may continue the same incomplete run.

The supported continuation paths are:

1. A no-argument invocation automatically continues the latest eligible incomplete run when its original `runStartedAt` is within the 72-hour window.
2. `--continue-run` deliberately continues the latest eligible incomplete run.
3. `--continue-run ID` deliberately continues the selected eligible incomplete run.

These paths have no lifetime Phase 6 attempt cap. They remain subject to existing run-selection eligibility, phase ordering, single-execution locking, and job verification.

The 72-hour rule controls default run selection. It is not a maximum number of Phase 6 attempts. Explicit continuation retains its existing ability to select an eligible incomplete run deliberately.

## Invariants That Remain Unchanged

Every Phase 6 attempt must use the same persisted inputs:

- `targetArticleStateReviewCount = articleCount`
- `targetArticleThresholdDaysOld = 180`

The coordinator must not recalculate or reduce `articleCount` between attempts.

Every status record must continue to validate:

1. The saved job ID.
2. `endpointName = /state-assigner/start-job`.
3. A valid `createdAt` no earlier than the original Phase 6 start.
4. Both required queue parameters and their exact persisted values.
5. Lifecycle timestamps appropriate to the reported status.
6. A valid result and count invariant for completed jobs.

Only a validated completed job with a valid result completes Phase 6.

## One New Job Per Invocation

Retain `startedThisInvocation` or an equivalent invocation-local guard.

The guard means:

1. A continuation may inspect, cancel, or verify an older saved job.
2. It may start one new state-assignment job after the older job is verified inactive or unavailable.
3. It monitors that newly started job.
4. If the new job does not complete successfully, the invocation exits.
5. Another command invocation may try again.

The guard is not a lifetime continuation limit. Do not persist it as one.

## Ordinary Recovery

The implemented ordinary recovery behavior already matches the clarified policy for failed, canceled, unavailable, and inactive monitoring-limited jobs.

Preserve these rules:

1. Monitor a valid active saved job rather than replacing it.
2. Accept a valid completed saved job.
3. Replace a verified inactive or unavailable saved job once during the current invocation.
4. If that newly started job fails, stop the invocation.
5. On a later continuation, treat that failed job as the saved job and allow another replacement.

Do not introduce a persisted total-attempt ceiling for ordinary recovery.

## Incompatible Worker Contract Recovery

A job is incompatible when its otherwise valid queue record omits the required Phase 6 parameters.

Its result can never complete Phase 6 because ops cannot prove that it used the immutable Article count and threshold.

Apply these rules to every incompatible attempt:

1. Persist the incompatible job identity, `createdAt`, detection time, missing fields, and latest lifecycle status.
2. If it is active, cancel it and verify that it becomes inactive or unavailable.
3. Exit the current invocation after starting or canceling that incompatible job.
4. On a later continuation, start one new job only after the saved incompatible job is verified inactive or unavailable.
5. If the new job is also incompatible, record it as another attempt, cancel it when active, and exit.
6. Permit another continuation after that job is verified inactive.

Remove branches that reject continuation solely because an earlier incompatible replacement was already consumed.

Continue stopping on malformed parameter types, identity mismatches, invalid timestamps, or ambiguous cancellation. Those are unverified states, not eligible inactive jobs.

## Durable Incompatible-Attempt History

Replace the one-off `sourceJobId` plus `replacementJobId` model with a repeatable attempt history under `phaseData.phase6`.

Use this logical shape:

```text
phase6:
  incompatibleContractRecovery:
    attempts:
      - jobId
        jobCreatedAt
        detectedAt
        missingParameterFields
        lastStatus
        cancellationRequestedAt
        cancellationOutcome
        verification
    latestAttemptJobId
```

Each job identity should appear at most once in the array. Later observations update that attempt rather than append duplicates.

Keep every entry compact. Do not store Article text, prompt content, model input, credentials, worker logs, or full queue responses.

The history is an audit record, not an attempt limiter. Its length must never determine whether another continuation is allowed.

## Compatibility With Existing Phase Data

Existing incomplete runs may contain the V04 singular marker:

```text
sourceJobId
sourceJobCreatedAt
detectedAt
missingParameterFields
lastStatus
replacementJobId
replacementStartedAt
```

Read this legacy shape safely and normalize it into the V05 attempt model in memory.

On the next Phase 6 progress write, persist the V05 shape without changing the original Phase 6 start time or immutable inputs.

If the legacy marker identifies both source and replacement jobs, preserve both identities in attempt history when sufficient validated data exists. Do not invent a `createdAt` or contract assessment for a replacement that was never observed.

Legacy data that cannot be validated remains an invalid run state and must not be silently discarded.

## Persistence Operations

Replace `recordPhaseSixIncompatibleReplacementStarted` with a Phase 6 continuation-start operation whose name does not imply a single allowed replacement.

The operation should atomically:

1. Confirm Phase 6 is in progress with valid immutable inputs.
2. Confirm the saved prior job matches the verified recovery decision.
3. Update `stateAssignerJobId` to the newly started job ID.
4. Record the continuation start time and reason.
5. Preserve incompatible-attempt history and the monitoring-limit marker.

Use the same protected operation for repeated incompatible-contract continuations. A failed atomic save must leave the prior job ID and recovery history unchanged.

Phase 6 progress writes must merge one incompatible attempt by job identity while preserving all other attempts and sibling phase data.

Phase 6 completion must continue rejecting:

- a job matching an active monitoring-limit marker;
- a job recorded as incompatible;
- a job whose identity or parameters do not match the saved Phase 6 state.

## Phase Module Changes

Update `06_runStateAssignment.ts` without changing its public success result.

The recovery loop should:

1. Parse V05 attempt history or normalize the V04 marker.
2. Identify whether the current saved job is a recorded incompatible attempt.
3. Cancel and verify an active incompatible job.
4. Allow a later invocation to replace any verified inactive incompatible job.
5. Record a newly incompatible job as a new attempt rather than classifying it as an exhausted replacement.
6. Retain `startedThisInvocation` so a failed new job ends the current invocation.

Remove error branches and messages that say:

- no second replacement is allowed;
- the replacement has already been consumed;
- an unsuccessful marked replacement permanently exhausts recovery.

Replace them with messages that explain the current job's actual state and whether another command invocation may continue it.

## Monitoring and Cancellation

Keep the 12-hour Phase 6 monitoring limit.

The limit applies to the current coordinator invocation's monitoring period. It does not limit how many later continuations may occur.

When the limit is reached:

1. Persist the job-specific monitoring marker.
2. Cancel the job.
3. Verify inactivity or unavailability.
4. Exit nonzero.
5. Allow a later invocation to start another job.

A marked job's late result remains permanently untrusted. Repeated continuation does not change that rule.

## Selection and Count Consequences

Every new state-assignment job performs the worker's normal newest-first selection using the original persisted count and threshold.

The worker excludes Articles already state-assigned under its existing rules. A continuation therefore does not resume an exact frozen remainder and may select older eligible Articles.

Do not aggregate counts from multiple attempts. Persist each attempt's observations for diagnosis, while the final validated completed job supplies the Phase 6 completion result.

Document the possibility of additional AI cost and selection drift across repeated continuations.

## Coordinator and CLI Behavior

Do not change `runSelection.ts` or `cli.ts` for this correction.

The coordinator continues to:

1. Select or create a run once at process start.
2. Skip completed earlier phases.
3. Enter Phase 6 when Phase 5 is complete and Phase 6 is incomplete.
4. Record a Phase 6 failure and exit nonzero when the attempt does not succeed.
5. Advance to Phase 7 only after verified Phase 6 completion.

The process must not reinvoke itself or automatically launch another coordinator after failure.

## Verification Strategy

Update Phase 6 module tests to verify:

- A failed job started during the current invocation exits without a second start.
- A later continuation replaces that failed job.
- Repeating this sequence across three or more invocations remains allowed.
- The same behavior applies to canceled, unavailable, and inactive monitoring-limited jobs.
- An incompatible job is recorded, canceled when active, and stops the invocation.
- A later continuation starts one replacement after verified inactivity.
- A replacement that is also incompatible is recorded as a new attempt and stops.
- A third continuation may start another job after the second is verified inactive.
- Attempt history deduplicates repeated observations of the same job.
- A malformed or ambiguously active job never becomes replacement eligible.
- No invocation starts more than one new state-assignment job.
- A valid later job can complete Phase 6 regardless of the number of earlier attempts.

Update persistence tests to verify:

- V04 singular markers normalize without losing validated evidence.
- V05 attempt history appends and updates by job identity.
- Continuation start atomically changes the saved job ID and preserves history.
- A failed continuation-start write leaves the prior state unchanged.
- Attempt count never blocks another valid continuation.
- Monitoring and incompatible markers remain job-specific.
- Incompatible or monitoring-limited jobs cannot complete Phase 6.
- Final completion preserves immutable inputs and leaves the weekly run incomplete at the Phase 7 boundary.

Update coordinator and run-selection tests only where needed to demonstrate:

- Repeated default continuation remains possible while the run is within 72 hours.
- Repeated `--continue-run` invocations can revisit incomplete Phase 6.
- Repeated `--continue-run ID` invocations can revisit the selected eligible run.
- An error exit never launches a second coordinator invocation.

Do not add a test that starts multiple Phase 6 jobs in one invocation.

## Documentation

Update `ops/README.md` and `ops/AGENTS.md` to distinguish:

- unlimited valid continuation invocations;
- one new Phase 6 job per invocation;
- the 72-hour default run-selection window;
- explicit continuation behavior;
- repeated-attempt AI cost and selection drift;
- worker-contract errors that still require deployment or configuration repair.

Remove statements that describe an incompatible-contract replacement as permanently consumed.

## Build and Test Order

Run:

1. `npm run build --workspace @newsnexus/db-models`
2. `npm run typecheck --workspace newsnexus12-ops`
3. `npm test --workspace newsnexus12-ops`
4. `npm run build --workspace newsnexus12-ops`

Worker-node behavior does not change. Run focused worker-node tests only if implementation work unexpectedly touches its queue or state-assigner contracts.

Do not use the weekly-flow runtime as a smoke test.

## Expected File Areas

- `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`
- `ops/src/weekly-flow-02/persistence.ts`
- `ops/src/weekly-flow-02/sequelizePersistence.ts`
- `ops/tests/weekly-flow-02/06_runStateAssignment.test.ts`
- `ops/tests/weekly-flow-02/persistence.test.ts`
- `ops/tests/weekly-flow-02/persistenceTestSupport.ts`
- Coordinator or run-selection tests if needed for repeated-invocation coverage
- `ops/README.md`
- `ops/AGENTS.md`

No db-models schema file, worker-node runtime file, systemd unit, or Phase 7 implementation should change for this correction.
