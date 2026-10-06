---
created_at: 2026-10-06T16:55:21Z
updated_at: 2026-10-06T16:55:21Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops State Assignment Todo V02

## Purpose

Implement the Phase 6 recovery correction from `20261006_ops_state_assignment_plan_v06.md`.

The implementation removes the lifetime incompatible-replacement cap, preserves one new state-assignment job per coordinator invocation, safely normalizes legacy V04 markers, and permits unlimited valid continuation invocations.

This todo does not change worker-node behavior, Article selection, Phase 6 inputs, the 12-hour monitoring limit, CLI syntax, systemd units, or Phase 7 implementation.

## Final Decisions

- [ ] Allow unlimited valid Phase 6 continuations through:
  - [ ] Automatic no-argument continuation within the 72-hour default window.
  - [ ] `--continue-run`.
  - [ ] `--continue-run ID`.
- [ ] Start at most one new Phase 6 job per coordinator invocation.
- [ ] Exit the invocation when its newly started job does not complete successfully.
- [ ] Keep `articleCount` and the 180-day threshold immutable across attempts.
- [ ] Identify incompatible attempts by `jobId + jobCreatedAt`.
- [ ] Use attempt history as audit and exact disqualification evidence, never as an attempt counter.
- [ ] Never infer that a V04 replacement was incompatible merely because `replacementJobId` exists.
- [ ] Permit any valid current job to complete regardless of earlier attempt count.
- [ ] Keep malformed, mismatched, or ambiguously active jobs non-replaceable.

## Implementation Guardrails

- [ ] Preserve unrelated working-tree changes.
- [ ] Do not review or modify `docs/archive/`.
- [ ] Do not run weekly-flow-02 against a real environment without explicit operator authorization.
- [ ] Do not restart worker-node, worker-python, PostgreSQL, or systemd services.
- [ ] Do not change `runSelection.ts` or `cli.ts` unless a failing test proves a documented requirement is not implemented.
- [ ] Do not add a db-models column or migration.
- [ ] Do not modify worker-node runtime code unless an unexpected contract defect is demonstrated.
- [ ] Do not recalculate, reduce, or overwrite `articleCount`.
- [ ] Do not start multiple new Phase 6 jobs in one invocation.
- [ ] Do not persist secrets, prompts, Article content, model input, or full worker responses.
- [ ] Keep default ops tests independent of PostgreSQL, running workers, network access, and `.env` files.

## Phase 1: Define Repeatable Recovery State

- [ ] Review plan V06, its V05 assessment, and the implemented Phase 6 recovery paths before editing.
- [ ] Identify every production and test reference to:
  - [ ] `PhaseSixIncompatibleContractRecovery`.
  - [ ] `recordPhaseSixIncompatibleReplacementStarted`.
  - [ ] `sourceJobId` and `sourceJobCreatedAt`.
  - [ ] `replacementJobId` and `replacementStartedAt`.
  - [ ] `markerRole` and replacement-consumed errors.
- [ ] Add a typed incompatible-attempt shape containing:
  - [ ] `jobId`.
  - [ ] `jobCreatedAt`.
  - [ ] `detectedAt`.
  - [ ] `missingParameterFields`.
  - [ ] Optional latest status.
  - [ ] Optional cancellation request time and outcome.
  - [ ] Optional cancellation verification.
- [ ] Change `PhaseSixIncompatibleContractRecovery` to contain an `attempts` array.
- [ ] Do not add `latestAttemptJobId` or a total-attempt limit.
- [ ] Define attempt equality as exact `jobId + jobCreatedAt` equality.
- [ ] Add parsing and validation helpers for the V06 history shape.
- [ ] Add a normalizer for the legacy V04 singular shape.
- [ ] Normalize a V04 marker without `replacementJobId` into one source attempt with attributable validated details.
- [ ] Normalize a V04 marker with `replacementJobId` into one source attempt only.
- [ ] When `replacementJobId` exists, omit status and cancellation fields whose source-versus-replacement attribution is ambiguous.
- [ ] Never add the V04 replacement ID to incompatible history until a current worker lookup proves it incompatible and supplies `createdAt`.
- [ ] Reject invalid legacy source identity, detection time, or missing-field evidence.
- [ ] Add focused unit coverage for new and legacy shape parsing before changing recovery flow.

### Phase 1 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 1 tasks.
7. [ ] Stage only Phase 1 changes.
8. [ ] Commit using repository guidance and reference Phase 1 of this todo in the commit body.

## Phase 2: Update Protected Persistence

- [ ] Replace `recordPhaseSixIncompatibleReplacementStarted` with `recordPhaseSixContinuationJobStarted` or an equally clear name.
- [ ] Use the protected operation for replacements of:
  - [ ] Failed saved jobs.
  - [ ] Canceled saved jobs.
  - [ ] Unavailable saved jobs.
  - [ ] Inactive monitoring-limited jobs.
  - [ ] Inactive incompatible jobs.
- [ ] Keep initial Phase 6 start and no-job-ID persistence-gap handling on their existing paths when no prior saved job exists.
- [ ] Require the continuation-start operation to atomically:
  - [ ] Confirm incomplete Phase 6 and valid immutable inputs.
  - [ ] Confirm the expected prior job still equals `stateAssignerJobId`.
  - [ ] Save the new job ID.
  - [ ] Record start time and replacement reason.
  - [ ] Preserve monitoring and incompatible-attempt history.
- [ ] Ensure a failed atomic save leaves the prior job ID and attempt history unchanged.
- [ ] Update `recordPhaseSixProgress` to merge an incompatible attempt by `jobId + jobCreatedAt`.
- [ ] Update repeated observations in place rather than duplicating the attempt.
- [ ] Preserve the original Phase 6 start, immutable input mirror, monitoring marker, result, and sibling data.
- [ ] Persist the normalized V06 shape on the first successful Phase 6 recovery write.
- [ ] Update `recordPhaseSixCompleted` to reject only:
  - [ ] A job ID that does not equal `stateAssignerJobId`.
  - [ ] An exact job ID and `createdAt` matching the monitoring marker.
  - [ ] An exact job ID and `createdAt` matching an incompatible attempt.
  - [ ] Invalid inputs or result counts.
- [ ] Remove the V04 completion check requiring a completing job to match `replacementJobId`.
- [ ] Do not replace that check with attempt order, latest attempt, or history-length logic.
- [ ] Update in-memory persistence support to match production behavior exactly.
- [ ] Remove obsolete persistence types, serializers, and method names after all callers move.

### Persistence Tests

- [ ] Add a V04 marker without a replacement and verify complete source normalization.
- [ ] Add a V04 marker with a replacement and verify only the source identity and provable fields survive.
- [ ] Verify a compatible saved V04 replacement can complete Phase 6.
- [ ] Verify incompatible A followed by failed compatible B and completed C can complete.
- [ ] Verify incompatible A followed by incompatible B and completed C can complete.
- [ ] Verify exact incompatible identity cannot complete.
- [ ] Verify a reused job ID with different `createdAt` can complete when otherwise valid.
- [ ] Verify attempt merging deduplicates by both identity fields.
- [ ] Verify continuation start is atomic for every replacement reason.
- [ ] Verify persistence failure leaves the old current job and history unchanged.

### Phase 2 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 2 tasks.
7. [ ] Stage only Phase 2 changes.
8. [ ] Commit using repository guidance and reference Phase 2 of this todo in the commit body.

## Phase 3: Revise the Phase 6 Recovery Loop

- [ ] Update `06_runStateAssignment.ts` to parse V06 attempt history or normalize V04 state.
- [ ] Match an incompatible job only by exact `jobId + createdAt`.
- [ ] Remove the singular source-versus-replacement role model.
- [ ] Remove branches that stop because:
  - [ ] No second replacement is allowed.
  - [ ] A replacement was already consumed.
  - [ ] A marked replacement ended unsuccessfully.
  - [ ] The current job does not match the obsolete replacement slot.
- [ ] Preserve `startedThisInvocation` and enforce one new job per invocation.
- [ ] Continue monitoring a valid active saved job.
- [ ] Continue accepting a valid completed saved job.
- [ ] Use the protected continuation-start persistence operation for every ordinary or incompatible replacement.
- [ ] When a current job lacks required parameters:
  - [ ] Add or update its exact incompatible attempt before recovery action.
  - [ ] Cancel it when active.
  - [ ] Verify inactivity or unavailability.
  - [ ] Exit the current invocation.
- [ ] On a later continuation, replace a verified inactive incompatible job.
- [ ] If the new job is also incompatible, record it as another attempt and exit after cancellation or terminal observation.
- [ ] Permit a later continuation regardless of attempt-history length.
- [ ] Preserve permanent stops for malformed parameter types, identity mismatches, invalid timestamps, and ambiguous cancellation.
- [ ] Preserve the 12-hour monitoring marker, cancellation, and late-result rejection.
- [ ] Preserve immutable count and threshold across every start.
- [ ] Keep attempt results separate and do not aggregate counts.
- [ ] Improve recovery errors and events so they describe current job state rather than exhausted allowance.

### Recovery Tests

- [ ] Replace tests that expect permanent stop after a second incompatible job.
- [ ] Verify one invocation never starts a second new job after its new job fails.
- [ ] Verify a later invocation replaces that failed job.
- [ ] Repeat failed-job continuation across at least three invocations.
- [ ] Repeat canceled, unavailable, and inactive monitoring-limited continuation across later invocations.
- [ ] Verify active incompatible job marking, cancellation, verification, and exit.
- [ ] Verify later replacement of the inactive incompatible job.
- [ ] Verify a second incompatible job becomes another attempt and exits.
- [ ] Verify a third continuation may start another job.
- [ ] Verify a valid later job completes regardless of earlier attempt count.
- [ ] Verify repeated status observations update one attempt.
- [ ] Verify reused job IDs are distinguished by `createdAt`.
- [ ] Verify malformed or unverified jobs never become replacement eligible.
- [ ] Verify Article count, threshold, Phase 6 start time, and Phase 5 completion remain unchanged.

### Phase 3 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 3 tasks.
7. [ ] Stage only Phase 3 changes.
8. [ ] Commit using repository guidance and reference Phase 3 of this todo in the commit body.

## Phase 4: Verify Coordinator and CLI Boundaries

- [ ] Confirm the coordinator still records a Phase 6 failure and exits nonzero after an unsuccessful new job.
- [ ] Confirm the coordinator never reinvokes itself.
- [ ] Confirm completed Phase 5 remains complete after every Phase 6 failure.
- [ ] Confirm Phase 7 is reached only after validated Phase 6 completion.
- [ ] Confirm a no-argument invocation can repeatedly continue the same eligible run while it remains inside the 72-hour window.
- [ ] Confirm repeated `--continue-run` invocations revisit incomplete Phase 6.
- [ ] Confirm repeated `--continue-run ID` invocations revisit the selected eligible run.
- [ ] Confirm explicit continuation retains its existing deliberate older-run behavior.
- [ ] Add or update coordinator and run-selection tests only where existing coverage does not prove these behaviors.
- [ ] Do not add a loop that starts multiple jobs in one coordinator invocation.
- [ ] Do not add a process self-restart or internal command reinvocation.

### Phase 4 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 4 tasks.
7. [ ] Stage only Phase 4 changes.
8. [ ] Commit only when Phase 4 produced code or test changes; do not create an empty commit.

## Phase 5: Update Operator Documentation

- [ ] Update `ops/README.md` to distinguish unlimited continuation invocations from one new job per invocation.
- [ ] Document all three continuation paths.
- [ ] Document that the default no-argument path uses the 72-hour window.
- [ ] Document that explicit continuation retains its existing eligibility rules.
- [ ] Remove one-replacement and permanently-consumed language.
- [ ] Document exact incompatible-attempt identity as job ID plus `createdAt`.
- [ ] Document repeated-attempt AI cost and newest-first selection drift.
- [ ] Document that malformed or unverified jobs still require investigation rather than automatic replacement.
- [ ] Update `ops/AGENTS.md` with the corrected Phase 6 recovery contract.
- [ ] Add a warning that future systemd service units must not use `Restart=on-failure`, `Restart=always`, or another automatic restart policy.
- [ ] State that a timer trigger creates one service invocation and failure continuation requires another trigger or operator command.
- [ ] Do not add or enable a systemd unit in this task.

### Phase 5 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 5 tasks.
7. [ ] Stage only Phase 5 documentation changes.
8. [ ] Commit using repository guidance and reference Phase 5 of this todo in the commit body.

## Phase 6: Final Regression and Handoff

- [ ] Confirm every approved plan V06 requirement is implemented.
- [ ] Confirm the V05 assessment concern is resolved.
- [ ] Confirm legacy V04 replacement identity cannot taint a compatible current job.
- [ ] Confirm attempt history never limits continuation eligibility.
- [ ] Confirm one invocation starts at most one new Phase 6 job.
- [ ] Confirm repeated later invocations remain allowed.
- [ ] Confirm exact job ID plus `createdAt` protects against ID reuse.
- [ ] Confirm completed Phase 6 remains incomplete at the Phase 7 boundary.
- [ ] Confirm no db-models schema or worker-node runtime change was introduced.
- [ ] Confirm no Phase 7 or systemd implementation was introduced.
- [ ] Confirm no archive file was modified.
- [ ] Confirm default tests open no network or PostgreSQL connection and start no real worker.
- [ ] Build `db-models`.
- [ ] Run the ops type check.
- [ ] Run the complete ops test suite.
- [ ] Build ops.
- [ ] Run `git diff --check`.
- [ ] Review the final diff for accidental schema, worker-node, Phase 7, systemd, or generic-framework scope.
- [ ] Fix failures and repeat the complete verification sequence.
- [ ] Check off completed Phase 6 tasks.
- [ ] Commit final verification fixes if any; do not create an empty commit.
- [ ] Provide the operator with verification results and any remaining deployment warning.

## Completion Criteria

- [ ] Phase 6 has no lifetime continuation-attempt cap.
- [ ] Default continuation within 72 hours, `--continue-run`, and `--continue-run ID` can revisit incomplete Phase 6 repeatedly.
- [ ] One coordinator invocation starts at most one new state-assignment job.
- [ ] Incompatible attempts use exact job ID plus `createdAt` identity.
- [ ] Legacy V04 normalization records only proven source incompatibility.
- [ ] A compatible V04 replacement can complete Phase 6.
- [ ] A compatible job after multiple earlier failures can complete Phase 6.
- [ ] Attempt history is compact, deduplicated, and never used as an attempt limit.
- [ ] Monitoring-limited and incompatible jobs remain unable to complete.
- [ ] Malformed and unverified jobs remain non-replaceable.
- [ ] Immutable Article count, threshold, and Phase 6 start survive all continuations.
- [ ] Phase 6 completion leaves the weekly run incomplete at the Phase 7 boundary.
- [ ] Operator documentation describes continuation, cost, selection drift, and systemd restart safety accurately.
- [ ] Ops type checks, tests, build, and diff checks pass.
