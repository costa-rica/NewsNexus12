---
created_at: 2026-10-06T16:58:40Z
updated_at: 2026-10-06T17:11:10Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops State Assignment Todo V03

## Purpose

Implement the Phase 6 recovery correction from `20261006_ops_state_assignment_plan_v06.md`.

The implementation removes the lifetime incompatible-replacement cap, preserves one new job per invocation, safely normalizes legacy V04 markers, and permits unlimited valid continuation invocations.

This todo does not change worker-node behavior, Article selection, Phase 6 inputs, the 12-hour monitoring limit, CLI syntax, systemd units, or Phase 7 implementation.

## V03 Changes

V03 resolves `20261006_ops_state_assignment_todo_v02_assessment_claude.md`:

1. Phase 1 adds shared recovery types and normalization without changing existing consumers.
2. Phase 2 performs the persistence and runner cutover together so the checkpoint compiles and passes.
3. The shared parser and V04 normalizer live in one named module.
4. The runner and both persistence implementations use that shared module.
5. Every Phase 6 write with recovery state persists the normalized V06 shape after cutover.
6. Completion normalizes legacy state even when no earlier recovery write occurred.
7. A test covers direct completion by a compatible legacy replacement.

## Final Decisions

- [ ] Allow unlimited valid Phase 6 continuations through:
  - [ ] Automatic no-argument continuation inside the 72-hour default window.
  - [ ] `--continue-run`.
  - [ ] `--continue-run ID`.
- [ ] Start at most one new Phase 6 job per coordinator invocation.
- [ ] Exit when the newly started job does not complete successfully.
- [ ] Preserve the immutable `articleCount` and 180-day threshold.
- [ ] Identify incompatible attempts by exact `jobId + jobCreatedAt`.
- [ ] Use attempt history as audit and disqualification evidence, never as an attempt limit.
- [ ] Normalize only proven V04 source incompatibility.
- [ ] Permit a valid current job to complete regardless of earlier attempts.
- [ ] Keep malformed, mismatched, and ambiguously active jobs non-replaceable.

## Implementation Guardrails

- [ ] Preserve unrelated working-tree changes.
- [ ] Do not review or modify `docs/archive/`.
- [ ] Do not run weekly-flow-02 against a real environment without explicit operator authorization.
- [ ] Do not restart worker-node, worker-python, PostgreSQL, or systemd services.
- [ ] Do not change `runSelection.ts` or `cli.ts` unless a failing test proves a requirement is missing.
- [ ] Do not add a database column or migration.
- [ ] Do not change worker-node runtime code unless an unexpected contract defect is demonstrated.
- [ ] Do not recalculate, reduce, or overwrite `articleCount`.
- [ ] Do not start multiple new Phase 6 jobs in one invocation.
- [ ] Do not persist secrets, prompts, Article content, model input, or full worker responses.
- [ ] Keep default ops tests independent of PostgreSQL, running workers, network access, and `.env` files.
- [ ] End every implementation phase with passing type checks, tests, and build before committing.

## Phase 1: Add Shared Recovery Helpers

- [x] Review plan V06, its assessment history, todo V02 assessment, and current Phase 6 recovery code.
- [x] Inventory every production and test reference to the V04 incompatible marker and replacement method.
- [x] Add `ops/src/weekly-flow-02/phaseSixRecoveryState.ts` as the only parser and normalizer for incompatible-contract recovery state.
- [x] Keep the existing persistence interface and V04 callers unchanged during this phase.
- [x] Add new exported types without replacing the live V04 type yet:
  - [x] `PhaseSixIncompatibleAttempt`.
  - [x] `PhaseSixIncompatibleRecoveryV06`.
  - [x] A validated V04 legacy input shape used only by the normalizer.
- [x] Define attempt identity as exact `jobId + jobCreatedAt`.
- [x] Implement V06 history parsing and validation.
- [x] Implement V04 marker parsing and normalization.
- [x] Normalize V04 without `replacementJobId` into one source attempt with attributable validated details.
- [x] Normalize V04 with `replacementJobId` into one source attempt only.
- [x] Omit status and cancellation fields when a V04 replacement makes their attribution ambiguous.
- [x] Never add the V04 replacement to attempt history without a worker lookup proving incompatibility and supplying `createdAt`.
- [x] Reject invalid legacy source identity, detection time, or missing-field evidence.
- [x] Implement helpers to:
  - [x] Find an attempt by exact identity.
  - [x] Add or update one attempt without duplication.
  - [x] Serialize compact V06 history.
- [x] Do not add `latestAttemptJobId` or any attempt counter.
- [x] Add `ops/tests/weekly-flow-02/phaseSixRecoveryState.test.ts`.
- [x] Add the compiled test path to the explicit `ops/package.json` test command.
- [x] Test V06 parsing, V04 normalization, ambiguous-field omission, deduplication, and reused job IDs.
- [x] Confirm no current production caller has changed behavior in Phase 1.

### Phase 1 Checkpoint

1. [x] Build `db-models`.
2. [x] Run the ops type check.
3. [x] Run the complete ops test suite.
4. [x] Build ops.
5. [x] Fix failures and repeat all checks.
6. [x] Check off completed Phase 1 tasks.
7. [x] Stage only Phase 1 changes.
8. [x] Commit using repository guidance and reference Phase 1 of this todo in the commit body.

## Phase 2: Atomically Cut Over Persistence and Runner

Complete the persistence and runner changes in one phase. Do not stop at an intermediate state where shared types or methods have incompatible callers.

### Persistence Contract

- [x] Replace the live V04 recovery type with `PhaseSixIncompatibleRecoveryV06` after all Phase 2 consumers are ready.
- [x] Replace `recordPhaseSixIncompatibleReplacementStarted` with `recordPhaseSixContinuationJobStarted` or an equally clear protected operation.
- [x] Use the operation for replacements of:
  - [x] Failed saved jobs.
  - [x] Canceled saved jobs.
  - [x] Unavailable saved jobs.
  - [x] Inactive monitoring-limited jobs.
  - [x] Inactive incompatible jobs.
- [x] Keep initial Phase 6 start and no-job-ID persistence-gap handling on their existing paths when no prior saved job exists.
- [x] Require continuation start to atomically:
  - [x] Validate active Phase 6 and immutable inputs.
  - [x] Confirm the expected prior job equals `stateAssignerJobId`.
  - [x] Save the new job ID.
  - [x] Record start time and reason.
  - [x] Preserve monitoring and incompatible-attempt history.
- [x] Ensure a failed atomic save leaves prior state unchanged.

### Shared Normalization Use

- [x] Make `sequelizePersistence.ts` read recovery data only through `phaseSixRecoveryState.ts`.
- [x] Make `persistenceTestSupport.ts` read recovery data only through the shared module.
- [x] Make `06_runStateAssignment.ts` read recovery data only through the shared module.
- [x] Remove duplicate V04 parsing and normalization logic from those files.
- [x] Ensure `recordPhaseSixProgress` normalizes recovery state before merging an attempt.
- [x] Ensure `recordPhaseSixCompleted` normalizes recovery state before checking incompatibility.
- [x] Ensure the runner normalizes recovery state before making a recovery decision.
- [x] Persist V06 recovery history on any Phase 6 write that receives or preserves recovery state after cutover.
- [x] Cover the case where completion is the first persistence operation after loading a V04 marker.

### Progress and Completion

- [x] Merge repeated incompatible observations by exact `jobId + jobCreatedAt`.
- [x] Preserve start time, input mirror, all other attempts, monitoring marker, result, and sibling data.
- [x] Require completion job ID to equal `stateAssignerJobId`.
- [x] Reject completion only when exact job ID and `createdAt` match:
  - [x] The monitoring-limit marker.
  - [x] An incompatible attempt.
- [x] Remove the V04 completion check tied to `replacementJobId`.
- [x] Do not replace it with attempt order, latest attempt, or history length.
- [x] Preserve all input and result-count validation.

### Runner Recovery

- [x] Remove `markerRole` and the singular source-versus-replacement model.
- [x] Remove branches that stop because:
  - [x] No second replacement is allowed.
  - [x] A replacement was already consumed.
  - [x] A marked replacement ended unsuccessfully.
  - [x] Completion does not match the obsolete replacement slot.
- [x] Preserve `startedThisInvocation` and one new job per invocation.
- [x] Monitor valid active saved jobs and accept valid completed saved jobs.
- [x] Use the protected continuation-start operation for every replacement reason.
- [x] Add or update an incompatible attempt before cancellation or terminal exit.
- [x] Cancel active incompatible jobs and verify inactivity or unavailability.
- [x] Exit after a new job is found incompatible.
- [x] Permit a later continuation after verified inactivity regardless of history length.
- [x] Preserve permanent stops for malformed parameters, identity mismatch, invalid timestamps, and ambiguous cancellation.
- [x] Preserve monitoring-limit cancellation and exact-identity late-result rejection.
- [x] Keep counts separate across attempts.
- [x] Remove the transitional V04 type, old persistence method, and any wrapper only after all Phase 2 callers compile.

### Phase 2 Tests

- [x] Update production and in-memory persistence tests together.
- [x] Verify V04 without replacement normalizes with attributable details.
- [x] Verify V04 with replacement normalizes only the proven source and omits ambiguous details.
- [x] Verify a legacy compatible replacement completes with no earlier recovery write.
- [x] Verify a legacy replacement found incompatible becomes a new V06 attempt.
- [x] Verify incompatible A followed by compatible B completed.
- [x] Verify incompatible A followed by failed compatible B and completed C.
- [x] Verify incompatible A followed by incompatible B and completed C.
- [x] Verify exact incompatible identity cannot complete.
- [x] Verify a reused job ID with different `createdAt` can complete.
- [x] Verify attempt merge deduplicates exact identities.
- [x] Verify continuation start is atomic for every replacement reason.
- [x] Verify persistence failure leaves prior state unchanged.
- [x] Replace tests expecting permanent exhaustion after a second incompatible job.
- [x] Verify an incompatible replacement exits its invocation and a later invocation may continue.
- [x] Verify no invocation starts a second new job.

### Phase 2 Checkpoint

1. [x] Build `db-models`.
2. [x] Run the ops type check.
3. [x] Run the complete ops test suite.
4. [x] Build ops.
5. [x] Fix failures and repeat all checks.
6. [x] Confirm no transitional wrapper or legacy live type remains unintentionally.
7. [x] Check off completed Phase 2 tasks.
8. [x] Stage only Phase 2 changes.
9. [ ] Commit using repository guidance and reference Phase 2 of this todo in the commit body.

## Phase 3: Prove Repeated Continuation Boundaries

- [ ] Add a multi-invocation test that replaces a failed job across at least three separate invocations.
- [ ] Add equivalent later-invocation coverage for canceled and unavailable jobs where not already proven.
- [ ] Verify an inactive monitoring-limited job can be replaced on a later invocation.
- [ ] Verify an incompatible job is recorded, canceled when active, and ends the invocation.
- [ ] Verify a second incompatible job becomes a separate attempt and ends its invocation.
- [ ] Verify a third continuation may start another job.
- [ ] Verify a valid later job completes regardless of earlier attempt count.
- [ ] Verify repeated observations update one attempt rather than append duplicates.
- [ ] Verify malformed or ambiguously active jobs never become replacement eligible.
- [ ] Verify Article count, threshold, original Phase 6 start, and completed Phase 5 remain unchanged.
- [ ] Confirm the coordinator records failure and exits without reinvoking itself.
- [ ] Confirm Phase 7 is reached only after validated Phase 6 completion.
- [ ] Confirm repeated no-argument continuation remains possible while the run is within 72 hours.
- [ ] Confirm repeated `--continue-run` invocations revisit incomplete Phase 6.
- [ ] Confirm repeated `--continue-run ID` invocations revisit the selected eligible run.
- [ ] Confirm explicit continuation retains existing deliberate older-run behavior.
- [ ] Add coordinator or run-selection tests only when existing coverage does not prove these boundaries.
- [ ] Do not add multiple new job starts to one invocation.
- [ ] Do not add process self-restart or internal command reinvocation.

### Phase 3 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 3 tasks.
7. [ ] Stage only Phase 3 changes.
8. [ ] Commit only when Phase 3 produced code or test changes; do not create an empty commit.

## Phase 4: Update Operator Documentation

- [ ] Update `ops/README.md` to distinguish unlimited continuation invocations from one new job per invocation.
- [ ] Document no-argument continuation inside the 72-hour window.
- [ ] Document repeated `--continue-run` and `--continue-run ID` behavior.
- [ ] Document explicit continuation's existing eligibility behavior.
- [ ] Remove one-replacement and permanently-consumed language.
- [ ] Document incompatible identity as job ID plus `createdAt`.
- [ ] Document repeated-attempt AI cost and newest-first selection drift.
- [ ] Document malformed and unverified states that still require investigation.
- [ ] Update `ops/AGENTS.md` with the corrected Phase 6 recovery contract.
- [ ] Warn that future systemd units must not use `Restart=on-failure`, `Restart=always`, or another automatic restart policy.
- [ ] State that continuation after failure requires another timer trigger or deliberate operator command.
- [ ] Do not add or enable a systemd unit.

### Phase 4 Checkpoint

1. [ ] Build `db-models`.
2. [ ] Run the ops type check.
3. [ ] Run the complete ops test suite.
4. [ ] Build ops.
5. [ ] Fix failures and repeat all checks.
6. [ ] Check off completed Phase 4 tasks.
7. [ ] Stage only Phase 4 documentation changes.
8. [ ] Commit using repository guidance and reference Phase 4 of this todo in the commit body.

## Phase 5: Final Regression and Handoff

- [ ] Confirm every approved plan V06 requirement is implemented.
- [ ] Confirm the todo V02 assessment concern is resolved.
- [ ] Confirm Phase 1 was additive and every phase checkpoint was passable.
- [ ] Confirm one shared module owns V04 and V06 recovery parsing.
- [ ] Confirm runner, production persistence, and in-memory persistence use the shared module.
- [ ] Confirm completion normalizes legacy state without requiring an earlier recovery write.
- [ ] Confirm a legacy replacement cannot be falsely marked incompatible.
- [ ] Confirm attempt history never limits continuation eligibility.
- [ ] Confirm one invocation starts at most one new job.
- [ ] Confirm repeated later invocations remain allowed.
- [ ] Confirm exact job ID plus `createdAt` protects against reuse.
- [ ] Confirm Phase 6 completion leaves the weekly run incomplete at Phase 7.
- [ ] Confirm no schema, worker-node runtime, Phase 7, or systemd implementation change was introduced.
- [ ] Confirm no archive file was modified.
- [ ] Confirm default tests use no real network, database, worker, or AI process.
- [ ] Build `db-models`.
- [ ] Run the ops type check.
- [ ] Run the complete ops test suite.
- [ ] Build ops.
- [ ] Run `git diff --check`.
- [ ] Review the final diff for accidental scope expansion.
- [ ] Fix failures and repeat the full sequence.
- [ ] Check off completed Phase 5 tasks.
- [ ] Commit final verification fixes if any; do not create an empty commit.
- [ ] Provide the operator with verification results and remaining deployment warnings.

## Completion Criteria

- [ ] Phase 6 has no lifetime continuation-attempt cap.
- [ ] All three continuation paths can revisit incomplete Phase 6 repeatedly.
- [ ] One invocation starts at most one new state-assignment job.
- [ ] One shared module parses and normalizes V04 and V06 recovery state.
- [ ] Every consumer uses the shared normalizer after cutover.
- [ ] Every Phase 6 write preserves recovery state in V06 form after cutover.
- [ ] Completion safely handles a legacy marker as its first recovery-state read.
- [ ] Incompatible attempts use exact job ID plus `createdAt`.
- [ ] Legacy normalization records only proven source incompatibility.
- [ ] A compatible legacy replacement can complete.
- [ ] A compatible job after multiple earlier failures can complete.
- [ ] Attempt history is compact, deduplicated, and never an attempt limit.
- [ ] Monitoring-limited and incompatible jobs remain unable to complete.
- [ ] Malformed and unverified jobs remain non-replaceable.
- [ ] Immutable Article count, threshold, and Phase 6 start survive continuation.
- [ ] Documentation accurately describes continuation, cost, selection drift, and systemd restart safety.
- [ ] Ops type checks, tests, build, and diff checks pass.
