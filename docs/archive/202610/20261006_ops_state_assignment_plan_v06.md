---
created_at: 2026-10-06T16:52:31Z
updated_at: 2026-10-06T16:52:31Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops State Assignment Plan V06

## Goal

Revise the implemented Phase 6 recovery policy so an incomplete weekly run has no lifetime limit on valid continuation attempts.

Automatic continuation within the 72-hour window, `--continue-run`, and `--continue-run ID` may each start another state-assignment job when the saved job is verified inactive and Phase 6 remains incomplete.

One coordinator invocation still starts at most one new Phase 6 job. If that job does not complete successfully, the invocation exits nonzero. A later command invocation may continue the run again.

## V06 Changes

V06 resolves the qualifying concern in `20261006_ops_state_assignment_plan_v05_assessment_claude.md`:

1. Normalize a legacy V04 marker as proof about its source job only.
2. Never infer that a V04 replacement was incompatible merely because its ID appears in the marker.
3. Identify every incompatible attempt by both job ID and worker `createdAt`.
4. Drop `latestAttemptJobId`; attempt history is audit and disqualification evidence only.
5. Remove completion checks tied to the obsolete V04 replacement slot.
6. Allow a valid current job to complete Phase 6 regardless of how many earlier attempts exist.
7. Use one protected continuation-start persistence operation for every replacement reason.
8. Warn that the future systemd service must not restart the coordinator after a failure exit.

V06 retains the unlimited-continuation policy, one-new-job-per-invocation guard, 180-day threshold, 12-hour monitoring limit, and all worker result validation from V05.

## Source and Scope

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Resolve the V05 assessment without adding a new product decision.
- Continue using worker-node's global queue and `/state-assigner/start-job` route.
- Keep the implemented Phase 6 module and client.
- Do not change worker-node selection, processing, or result contracts.
- Do not change CLI syntax or run-selection rules.
- Do not add database columns.
- Do not create a general retry framework.
- Keep default ops tests database-free and worker-free.

## Continuation Model

The weekly-flow process does not restart itself.

When a Phase 6 job ends unsuccessfully:

1. The current invocation records the outcome.
2. The invocation exits nonzero.
3. It does not start another Phase 6 job.
4. A later weekly-flow command may continue the incomplete run.

Supported continuation paths are:

1. A no-argument invocation automatically continues the latest eligible incomplete run within the 72-hour default window.
2. `--continue-run` deliberately continues the latest eligible incomplete run.
3. `--continue-run ID` deliberately continues the selected eligible incomplete run.

None of these paths has a lifetime Phase 6 attempt cap.

The 72-hour rule controls default run selection. It is not an attempt counter. Explicit continuation retains its existing deliberate-run behavior.

## Immutable Phase Inputs

Every attempt must use:

- `targetArticleStateReviewCount = articleCount`
- `targetArticleThresholdDaysOld = 180`

The coordinator must not recalculate or reduce `articleCount` between attempts.

Every worker record must continue to validate:

1. Saved job ID.
2. `endpointName = /state-assigner/start-job`.
3. Valid `createdAt` no earlier than the original Phase 6 start.
4. Both required queue parameters and their exact persisted values.
5. Lifecycle timestamps appropriate to the status.
6. Valid result fields and count invariant for completion.

Only a validated completed job with a valid result completes Phase 6.

## One New Job Per Invocation

Retain `startedThisInvocation` or an equivalent invocation-local guard.

One invocation may:

1. Inspect, cancel, or verify an older saved job.
2. Start one new job after the older job is verified inactive or unavailable.
3. Monitor the new job.
4. Complete Phase 6 if the job succeeds.
5. Exit if the new job does not succeed.

The guard is not persisted and is not a lifetime continuation limit.

## Ordinary Recovery

Preserve the implemented ordinary recovery behavior:

1. Monitor a valid active saved job.
2. Accept a valid completed saved job.
3. Replace a verified inactive or unavailable saved job once in the current invocation.
4. Stop if that newly started job fails or is canceled.
5. On a later invocation, treat that job as the saved job and permit another valid continuation.

This applies to failed, canceled, unavailable, and inactive monitoring-limited jobs.

Do not add a total-attempt ceiling.

## Incompatible Worker Contract Recovery

A job is incompatible when its otherwise valid queue record lacks either required Phase 6 parameter.

Its result can never complete Phase 6 because ops cannot prove that it used the immutable Article count and threshold.

For every incompatible job:

1. Record its exact job ID and worker `createdAt`.
2. Record detection time, missing fields, and latest validated status.
3. If active, cancel it and verify inactivity or unavailability.
4. Exit the current invocation after starting or canceling that incompatible job.
5. On a later invocation, permit one new job after verified inactivity.
6. If the new job is also incompatible, record it as a separate attempt and repeat this process on later invocations.

Remove every branch that rejects continuation only because an earlier incompatible replacement was consumed.

Continue stopping on malformed parameter types, identity mismatches, invalid timestamps, or ambiguous cancellation. Those are unverified states and are not replacement eligible.

## Durable Incompatible-Attempt History

Replace the V04 source/replacement slot with repeatable attempt history under `phaseData.phase6`:

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
```

Use the pair `jobId + jobCreatedAt` as the attempt identity.

This protects against worker job-ID reuse. It also matches the existing monitoring-marker identity rule.

Each identity appears at most once. Later observations update that entry rather than appending a duplicate.

Do not add `latestAttemptJobId`. The current worker job is already identified by `stateAssignerJobId` and its validated status record.

Attempt history has only two purposes:

1. Preserve compact recovery evidence.
2. Prevent an exactly matching incompatible job from completing Phase 6.

History length never controls continuation eligibility.

Do not store Article text, prompts, model input, credentials, worker logs, or full status responses.

## Safe V04 Marker Normalization

An incomplete run may contain this V04 marker:

```text
sourceJobId
sourceJobCreatedAt
detectedAt
missingParameterFields
lastStatus
cancellationRequestedAt
cancellationOutcome
verification
replacementJobId
replacementStartedAt
```

The V04 fields after `missingParameterFields` may describe either the source or replacement when `replacementJobId` exists. Their attribution is not reliable.

Normalize with these rules:

1. Create one incompatible attempt for `sourceJobId + sourceJobCreatedAt`.
2. Preserve `detectedAt` and `missingParameterFields` because they prove the source lacked the contract.
3. If `replacementJobId` is absent, preserve the source status and cancellation fields after validation.
4. If `replacementJobId` is present, omit status and cancellation fields whose attribution is ambiguous.
5. Do not add `replacementJobId` to incompatible-attempt history.
6. Do not infer a replacement `createdAt`, missing-field list, or contract outcome.

The saved `stateAssignerJobId` identifies the current replacement. Its next worker status lookup determines whether it is compatible, incompatible, active, terminal, or unavailable.

If the current replacement is compatible and completed, it may complete Phase 6.

If it is incompatible, its validated `jobId + createdAt` is added as a new attempt before cancellation or exit.

If legacy source identity, detection time, or missing fields cannot be validated, stop with an invalid run state. Do not discard or guess them.

## Completion Rules

`recordPhaseSixCompleted` must require:

1. The completion job ID equals `stateAssignerJobId`.
2. The completion job ID and `createdAt` do not exactly match the monitoring-limit marker.
3. The completion job ID and `createdAt` do not exactly match any incompatible attempt.
4. The result inputs equal the persisted Phase 6 inputs.
5. The result counts are valid and consistent.

Remove the V04 rule that rejects completion because `replacementJobId` exists and differs from the completing job.

Do not replace that rule with a comparison to the last incompatible attempt or attempt-history position.

These valid sequences must complete:

```text
incompatible A -> compatible B -> completed B
```

```text
incompatible A -> compatible B failed -> compatible C completed
```

```text
incompatible A -> incompatible B -> compatible C completed
```

The exact-identity checks still prevent A or B from completing when their validated records showed an incompatible contract.

## Continuation-Start Persistence

Replace `recordPhaseSixIncompatibleReplacementStarted` with a protected operation such as `recordPhaseSixContinuationJobStarted`.

Use this operation for every replacement start, including:

- failed saved job;
- canceled saved job;
- unavailable saved job;
- inactive monitoring-limited job;
- inactive incompatible job.

The operation should atomically:

1. Confirm Phase 6 is in progress with valid immutable inputs.
2. Confirm the expected prior job ID still equals `stateAssignerJobId`.
3. Save the new job ID.
4. Record start time and replacement reason in compact progress.
5. Preserve monitoring and incompatible-attempt history.

Initial Phase 6 start and a start-record persistence gap may keep their existing paths when there is no prior saved job to compare.

A failed atomic continuation-start write must leave the prior saved job and recovery history unchanged.

## Progress Persistence

Phase 6 progress writes should merge incompatible attempts by `jobId + jobCreatedAt`.

They must preserve:

- original Phase 6 `startedAt`;
- immutable input mirror;
- all other incompatible attempts;
- monitoring-limit marker;
- result and sibling phase data.

On the first successful write of V06 history, replace the normalized V04 marker with the V06 shape.

Do not use attempt history as a proxy for the current saved job.

## Phase Module Changes

Update `06_runStateAssignment.ts` without changing its success result.

The runner should:

1. Parse V06 attempt history or normalize a V04 marker.
2. Match an incompatible job only by `jobId + createdAt`.
3. Let the saved current job's status classify it independently of the legacy replacement slot.
4. Cancel and verify active incompatible jobs.
5. Replace any verified inactive incompatible job on a later invocation.
6. Add a newly incompatible replacement as a separate attempt.
7. Retain `startedThisInvocation` so a failed new job ends the invocation.

Remove error branches and messages stating:

- no second replacement is allowed;
- a replacement has already been consumed;
- a marked replacement failure permanently exhausts recovery;
- a completion job must match the obsolete incompatible replacement slot.

Replace them with messages describing the actual current job state and whether later continuation is safe.

## Monitoring and Cancellation

Keep the 12-hour Phase 6 monitoring limit.

When the limit is reached:

1. Persist a marker tied to job ID and `createdAt`.
2. Cancel the job.
3. Verify inactivity or unavailability.
4. Exit nonzero.
5. Allow a later invocation to start another job.

A matching marked job's late completion remains untrusted. A later job with a reused ID but different `createdAt` does not match the marker.

## Selection and Count Consequences

Every new job performs worker-node's normal newest-first selection using the original Article count and threshold.

Already state-assigned Articles are excluded by existing worker rules. A continuation is not an exact remainder resume and may select older eligible Articles.

Do not aggregate counts across attempts. The final validated completed job supplies the Phase 6 completion result.

Document possible additional AI cost and selection drift.

## Coordinator, CLI, and Future systemd

Do not change `runSelection.ts` or `cli.ts`.

The coordinator still selects one run, skips completed phases, enters incomplete Phase 6, and exits nonzero after an unsuccessful attempt.

It must not reinvoke itself.

Add an explicit warning to `ops/AGENTS.md` and the scheduling plan:

- The future systemd service must not use `Restart=on-failure`, `Restart=always`, or another automatic restart policy.
- The weekly timer creates one service invocation per trigger.
- Continuation after failure requires another timer trigger or deliberate operator command.

Systemd unit implementation remains outside this plan.

## Verification Strategy

Update Phase 6 runner tests to verify:

- A failed job started in the current invocation exits without another start.
- Later invocations can replace failed, canceled, unavailable, and inactive monitoring-limited jobs repeatedly.
- An incompatible job is recorded by ID and `createdAt`.
- An active incompatible job is canceled and stops the invocation.
- A later invocation replaces it after verified inactivity.
- A replacement that is also incompatible becomes a separate attempt.
- A third or later continuation remains allowed.
- Repeated observations update one attempt rather than duplicating it.
- A reused job ID with a different `createdAt` does not match an older attempt.
- Malformed or ambiguously active jobs never become replacement eligible.
- No invocation starts more than one new job.

Add explicit legacy-normalization tests:

- A V04 marker without `replacementJobId` becomes one source attempt with attributable status and cancellation details.
- A V04 marker with `replacementJobId` becomes only one source attempt and omits ambiguous lifecycle details.
- A compatible saved V04 replacement can complete Phase 6.
- A saved V04 replacement found incompatible becomes a new V06 attempt.

Add completion-chain tests:

- Incompatible A, compatible B, completed B.
- Incompatible A, failed compatible B, completed C.
- Incompatible A, incompatible B, completed C.
- An exact incompatible identity cannot complete.
- A reused job ID with a later `createdAt` can complete when otherwise valid.

Update persistence tests and in-memory support to verify:

- Atomic continuation-start updates for every replacement reason.
- Failed continuation-start persistence leaves prior state unchanged.
- Attempt merges use ID plus `createdAt`.
- Completion ignores V04 `replacementJobId` ordering.
- Completion checks exact monitoring and incompatible identities.
- Final completion preserves immutable inputs and stops at the Phase 7 boundary.

Update coordinator or run-selection tests only as needed to demonstrate repeated separate invocations. Do not test or implement multiple new Phase 6 jobs in one invocation.

## Documentation

Update `ops/README.md` and `ops/AGENTS.md` to distinguish:

- unlimited valid continuation invocations;
- one new Phase 6 job per invocation;
- the 72-hour default window;
- explicit continuation behavior;
- repeated-attempt AI cost and selection drift;
- incompatible jobs that require worker deployment repair;
- prohibition on future systemd automatic restart.

Remove statements describing the incompatible replacement slot as permanently consumed.

## Build and Test Order

Run:

1. `npm run build --workspace @newsnexus/db-models`
2. `npm run typecheck --workspace newsnexus12-ops`
3. `npm test --workspace newsnexus12-ops`
4. `npm run build --workspace newsnexus12-ops`

Worker-node behavior does not change. Run focused worker-node tests only if implementation unexpectedly touches its contracts.

Do not use the weekly-flow runtime as a smoke test.

## Expected File Areas

- `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`
- `ops/src/weekly-flow-02/persistence.ts`
- `ops/src/weekly-flow-02/sequelizePersistence.ts`
- `ops/tests/weekly-flow-02/06_runStateAssignment.test.ts`
- `ops/tests/weekly-flow-02/persistence.test.ts`
- `ops/tests/weekly-flow-02/persistenceTestSupport.ts`
- Coordinator or run-selection tests if required
- `ops/README.md`
- `ops/AGENTS.md`

No db-models schema, worker-node runtime, systemd unit, or Phase 7 implementation should change for this correction.
