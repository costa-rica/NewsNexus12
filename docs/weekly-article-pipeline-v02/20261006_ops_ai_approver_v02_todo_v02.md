---
created_at: 2026-10-06T19:05:55Z
updated_at: 2026-10-06T19:27:46Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops AI Approver V02 Todo V02

## Purpose

Implement Phase 7 of weekly-flow-02 from the approved plans:

- `20261006_ops_ai_approver_v02_plan_v02.md`
- `20261006_ops_ai_approver_v02_plan_v03.md`

V03 controls when it changes V02. Implement unlimited continuation invocations, one new V02 job per invocation, acceptance-aware recovery, exact current-attempt identity, and atomic Phase 7 plus weekly-run completion.

## V02 Changes

V02 resolves `20261006_ops_ai_approver_v02_todo_v01_assessment_claude.md`:

1. Phase 2 assigns stable snake_case client error-category values.
2. Phase 4 uses the existing runner dependency shape and injected clock and delay.
3. Phase 4 polling tests advance fake time and never wait on real timers.
4. Phase 5 builds the production Phase 7 worker from the coordinator's injected request dependency.
5. Phase 5 names and updates the existing coordinator tests in `01_clearDuplicateAnalyses.test.ts`.
6. Phase 5 removes every obsolete Phase 7 boundary assertion and proves no global network fallback occurs.

All other V01 tasks remain in force.

## Implementation Guardrails

- [x] Read the root `AGENTS.md`, `ops/AGENTS.md`, and `worker-python/AGENTS.md` before editing their scopes.
- [x] Inspect the working tree and preserve unrelated or in-progress changes.
- [x] Do not run weekly-flow-02 against a real environment.
- [x] Keep default ops tests database-free and worker-free.
- [x] Use a disposable test database for worker-python integration tests.
- [x] Add no database columns.
- [x] Do not change V02 selection, prompts, prediction behavior, CLI syntax, or systemd units.
- [x] Never log or persist preview tokens, selection snapshots, Article content, prompt content, model input, credentials, or database secrets.
- [x] Keep `articleCount` and all four Phase 7 inputs immutable across attempts.
- [x] Do not aggregate prediction counters across attempts.
- [x] Do not add a lifetime attempt limit.

## Phase 1: Lock Worker-Python Contracts

### Contract Review

- [x] Confirm `POST /ai-approver-v02/preview` accepts the exact Phase 7 input shape.
- [x] Confirm typed HTTP 400 `no_eligible_articles` remains distinguishable from all other preview errors.
- [x] Confirm `POST /ai-approver-v02/start` accepts only the V02 run ID and preview token.
- [x] Confirm start queues `parameters.runId` and attaches the queue job ID to the V02 run.
- [x] Confirm `GET /ai-approver-v02/runs/:runId` hides draft and expired previews.
- [x] Confirm detail returns the complete durable execution row and matching queue record without exposing the preview token.
- [x] Confirm accepted execution rows remain available through terminal statuses.
- [x] Confirm startup reconciliation marks incomplete accepted V02 runs failed.
- [x] Confirm cancellation can return `canceled`, `cancel_requested`, or `not_found`.

### Worker Tests

- [x] Add or extend focused tests for the exact preview request and both required Boolean flags.
- [x] Add or extend the typed zero-work response test.
- [x] Lock the start response and `parameters.runId` queue contract.
- [x] Lock the detail response fields required by Phase 7:
  - [x] V02 run identity and immutable inputs.
  - [x] Planned, attempted, completed, failed, invalid, and skipped counts.
  - [x] Status, ending reason, and lifecycle timestamps.
  - [x] Queue job identity, endpoint, parameters, and lifecycle timestamps.
  - [x] No preview token in detail or queue parameters.
- [x] Cover completed, failed, canceled, circuit-breaker, and restart-reconciled durable outcomes.
- [x] Preserve existing API proxy and portal-compatible behavior.
- [x] Change worker runtime code only if a focused test proves a required contract is absent.

### Phase 1 Verification and Commit

- [x] Run `cd worker-python && ./venv/bin/pytest tests/unit/ai_approver_v02 tests/integration/test_ai_approver_v02_routes.py`.
- [x] Run the full worker-python suite with `cd worker-python && ./venv/bin/pytest` if focused tests pass and a disposable test database is configured.
- [x] Fix failures caused by this phase and rerun the affected commands.
- [x] Review the diff for accidental token, content, credential, or unrelated changes.
- [x] Check off every completed Phase 1 task in this todo.
- [x] Commit Phase 1 changes using the repository commit format, reference this todo and Phase 1, and include all contributing-agent co-author lines.

## Phase 2: Add Phase 7 Configuration and Client

### Configuration

- [x] Extend `OpsConfig` with Phase 7-specific settings:
  - [x] Request timeout defaulting to 60 seconds.
  - [x] Status poll interval defaulting to 300 seconds.
  - [x] Tolerated consecutive transient status failures defaulting to 2.
  - [x] Monitoring limit defaulting to 12 hours.
- [x] Add the settings to `ops/.env.example` without adding secrets.
- [x] Extend config tests for defaults, valid overrides, and invalid nonpositive values.

### AI Approver V02 Client

- [x] Create `ops/src/weekly-flow-02/phases/07_aiApproverV02Client.ts`.
- [x] Define exact request and response types for preview, start, detail, and cancel.
- [x] Define durable V02 statuses, queue statuses, immutable inputs, counters, and lifecycle fields without using `any`.
- [x] Implement these exact stable client error-category values:
  - [x] `transient_request`.
  - [x] `permanent_request`.
  - [x] `malformed_response`.
  - [x] `identity_mismatch`.
  - [x] `start_conflict`.
  - [x] `unavailable_unaccepted_preview`.
  - [x] `accepted_run_unavailable`.
  - [x] `cancellation_failure`.
  - [x] `unverified_outcome`.
- [x] Preserve these literal values through runner errors, coordinator classification, logs, and persisted failures.
- [x] Send exactly the required preview body using the persisted `articleCount`.
- [x] Validate successful preview identity, inputs, count, snapshot length, item identity, content source, token, and worker-owned timestamps.
- [x] Recognize only typed `no_eligible_articles` as zero work.
- [x] Keep the preview token in memory only and exclude it from errors, logs, and durable client results after start.
- [x] Send exactly `{ runId, previewToken }` to start.
- [x] Validate the HTTP 202 start run ID, nonempty job ID, and queued status.
- [x] Parse typed start conflicts without assuming the conflicting run's identity.
- [x] Fetch detail by the persisted V02 run ID.
- [x] Distinguish 404 for a caller-supplied pre-acceptance context from 404 for an accepted attempt.
- [x] Validate durable run inputs, counts, status, ending reason, and lifecycle timestamps.
- [x] Validate queue job ID, endpoint, exact `parameters.runId`, status, and lifecycle timestamps when queue status exists.
- [x] Do not compare worker timestamps with the ops process clock.
- [x] Allow a missing queue record in the parsed detail result without inventing `queueCreatedAt`.
- [x] Implement cancellation and accept only matching `canceled` or `cancel_requested` results.
- [x] Reject `not_found`, mismatched identities, and malformed cancellation responses.

### Client Tests

- [x] Create `ops/tests/weekly-flow-02/07_aiApproverV02Client.test.ts`.
- [x] Test exact preview and start bodies.
- [x] Test token handling and verify it is absent from persisted-safe results and error messages.
- [x] Test typed zero work and rejection of lookalike HTTP 400 responses.
- [x] Test preview snapshot, count, input, identity, and timestamp validation.
- [x] Test every supported V02 and queue lifecycle status.
- [x] Test durable counters and both completion invariants.
- [x] Test transient, permanent, timeout, conflict, malformed, and both 404 classifications.
- [x] Test missing queue status without a fabricated timestamp.
- [x] Test cancellation outcomes, including explicit rejection of `not_found`.

### Phase 2 Verification and Commit

- [x] Add the compiled client test file to the explicit `ops/package.json` test command.
- [x] Run `npm run build --workspace @newsnexus/db-models`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops`.
- [x] Run `npm test --workspace newsnexus12-ops`.
- [x] Run `npm run build --workspace newsnexus12-ops`.
- [x] Fix failures and rerun all affected Phase 2 commands.
- [x] Check off every completed Phase 2 task in this todo.
- [x] Commit Phase 2 changes using the repository commit format, reference this todo and Phase 2, and include all contributing-agent co-author lines.

## Phase 3: Implement Durable Phase 7 State

### State Types and Parsing

- [x] Add Phase 7 input, attempt, progress, monitoring, cancellation, and result types to the ops persistence boundary.
- [x] Add a focused Phase 7 recovery-state module if needed to keep parsing and validation separate from Sequelize writes.
- [x] Represent every attempt with a positive `v02RunId` as its stable key.
- [x] Store `jobId + queueCreatedAt` when queue identity is available.
- [x] Store acceptance evidence from a valid start response or visible execution status.
- [x] Store monitoring-limit evidence on the exact attempt.
- [x] Merge repeated observations by `v02RunId` instead of duplicating attempts.
- [x] Treat history length only as audit and recovery evidence, never as continuation eligibility.
- [x] Reject malformed current identity, immutable inputs, counters, or chronology.

### Persistence Interface

- [x] Add a dedicated Phase 7 start operation that persists the immutable input mirror before preview.
- [x] Add initial preview persistence with `currentV02RunId` and a null `aiApproverV02JobId` mirror.
- [x] Add protected continuation preview persistence that:
  - [x] Locks and validates the run.
  - [x] Checks the expected current V02 run and job identities.
  - [x] Confirms the prior attempt is continuation-eligible.
  - [x] Preserves prior attempt history.
  - [x] Appends the new preview attempt.
  - [x] Makes the new V02 run current.
  - [x] Clears `aiApproverV02JobId` atomically.
- [x] Add protected start-response job binding.
- [x] Add protected recovery job adoption.
- [x] Require both binding operations to update the current attempt and `aiApproverV02JobId` together.
- [x] Reject binding when a different non-null current job identity exists.
- [x] Add attempt progress writes that preserve every sibling attempt and phase node.
- [x] Add monitoring-limit and cancellation evidence writes tied to the exact V02 run and queue identity.
- [x] Add atomic zero-work completion that clears the current job mirror and records `zeroWorkAfterPriorAttempts`.
- [x] Add atomic successful completion that verifies current V02 run ID, current attempt job ID, and the weekly-row job mirror.
- [x] Prevent generic `recordPhaseCompleted` and `recordRunCompleted` from completing Phase 7 independently.

### Sequelize and Test Support

- [x] Implement every Phase 7 operation in `sequelizePersistence.ts` with row locking and expected-identity checks.
- [x] Preserve the repository's database-error suppression behavior.
- [x] Update `persistenceTestSupport.ts` with matching in-memory semantics and preconditions.
- [x] Ensure progress writes cannot restore a prior attempt's job ID after a continuation preview clears the mirror.
- [x] Ensure failed atomic writes leave the prior current attempt and job mirror unchanged.

### Persistence Tests

- [x] Extend `ops/tests/weekly-flow-02/persistence.test.ts` for Phase 7 initialization and immutable inputs.
- [x] Test that preview persistence excludes the token and selection snapshot.
- [x] Test that continuation preview persistence archives the prior identity and clears `aiApproverV02JobId`.
- [x] Test rollback behavior when the protected continuation transition fails.
- [x] Test atomic job binding and ambiguous-start recovery adoption.
- [x] Test rejection of a stale prior-attempt mirror.
- [x] Test attempt merge behavior and preservation of monitoring history.
- [x] Test exact current identities for successful completion.
- [x] Test that a prior attempt's late completion cannot complete Phase 7.
- [x] Test initial and later zero-work completion, including `zeroWorkAfterPriorAttempts`.
- [x] Test that Phase 7 and weekly-run completion cannot be split.

### Phase 3 Verification and Commit

- [x] Run `npm run build --workspace @newsnexus/db-models`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops`.
- [x] Run `npm test --workspace newsnexus12-ops`.
- [x] Run `npm run build --workspace newsnexus12-ops`.
- [x] Fix failures and rerun all affected Phase 3 commands.
- [x] Check off every completed Phase 3 task in this todo.
- [x] Commit Phase 3 changes using the repository commit format, reference this todo and Phase 3, and include all contributing-agent co-author lines.

## Phase 4: Implement the Phase 7 Runner

### Runner Foundation

- [x] Create `ops/src/weekly-flow-02/phases/07_runAiApproverV02.ts`.
- [x] Validate that Phase 6 is complete, the weekly run is incomplete, and `articleCount` is positive.
- [x] Validate the Phase 7 input mirror against `articleCount` and required constants on every continuation.
- [x] Define Phase 7 runner dependencies using the existing Phase 6 pattern: `persistence`, `worker`, `now`, `delay`, and `onEvent`.
- [x] Keep HTTP transport inside the injected worker rather than letting the runner call `fetch`.
- [x] Use injected `now` and `delay` for every poll, monitoring-limit calculation, and final cancellation wait.
- [x] Add an invocation-local guard that permits at most one new V02 start.
- [x] Never loop into another preview or start after failure, cancellation, monitoring limit, or conflict.

### Initial Preview and Start

- [x] Persist Phase 7 start before requesting the first preview.
- [x] Handle typed zero work through the dedicated atomic completion operation.
- [x] Persist a validated preview before sending start.
- [x] Bind the returned job ID immediately after a valid start response.
- [x] Stop after an ambiguous start request without retrying start.
- [x] Poll immediately after a successful start, then use non-overlapping configured delays.

### Saved-Attempt Recovery

- [x] Load and validate the current attempt by `currentV02RunId`.
- [x] Monitor a valid active accepted attempt when queue evidence is available.
- [x] Adopt a recovered job ID only when the current attempt and weekly-row mirrors are null.
- [x] Stop on a stale non-current job mirror rather than silently repairing it.
- [x] Treat queued without job ID as an orphaned accepted run for the current invocation.
- [x] Permit later adoption or startup-reconciled failure observation.
- [x] Treat pre-acceptance 404 as an unavailable unaccepted preview eligible for a later attempt.
- [x] Treat post-acceptance 404 as identity mismatch or unverified outcome with no replacement.
- [x] On typed start conflict, stop without canceling or modifying another V02 run.
- [x] Let the saved unaccepted preview expire and reinspect it on later continuation.

### Completion and Terminal Outcomes

- [x] Accept only a valid durable V02 `completed` outcome with exact current identities and count invariants.
- [x] Accept durable completion during the brief queue transition.
- [x] Accept durable completion with a missing or restart-failed queue record when every durable contract validates.
- [x] Record failed, canceled, and circuit-breaker outcomes without completing Phase 7.
- [x] Exit after an unsuccessful attempt started in the current invocation.
- [x] Permit one new attempt on a later invocation after verified terminal inactivity.
- [x] Never aggregate counters across attempts.

### Monitoring and Cancellation

- [x] Reset the transient failure counter after each valid detail response.
- [x] Stop on the third consecutive transient request failure.
- [x] Stop immediately on permanent, malformed, authorization, configuration, or identity errors.
- [x] Measure the 12-hour limit only from validated queue `createdAt`.
- [x] Count time spent queued in the shared worker queue.
- [x] Do not invent a queue timestamp when queue status is absent.
- [x] For an active durable run without queue evidence, stop as unverified without cancellation or replacement.
- [x] Persist an exact monitoring-limit marker before cancellation.
- [x] Cancel once and accept only matching `canceled` or `cancel_requested`.
- [x] After `cancel_requested`, wait one interval and make one final detail request.
- [x] Verify inactivity before allowing later continuation.
- [x] Treat cancel `not_found` or ambiguous verification as a stop without replacement.
- [x] Permanently reject late completion from every monitoring-limited V02 run.

### Unlimited Continuation

- [x] Permit later invocations to create one new attempt after:
  - [x] An unavailable unaccepted preview.
  - [x] A terminal failed, canceled, or circuit-breaker run.
  - [x] A verified inactive monitoring-limited run.
  - [x] An orphaned accepted run later reconciled to terminal failure.
- [x] Use the original `articleCount` and required flags for every new attempt.
- [x] Use the protected continuation preview operation before every later start.
- [x] Stop the invocation if the newly started attempt is unsuccessful.
- [x] Keep later continuation eligibility unlimited by attempt count.

### Runner Tests

- [x] Create `ops/tests/weekly-flow-02/07_runAiApproverV02.test.ts`.
- [x] Test fresh preview, start, immediate poll, and atomic successful completion.
- [x] Test initial zero work and zero work after prior attempts.
- [x] Test completion with failed, invalid, or skipped individual Articles.
- [x] Test active continuation and ambiguous-start job adoption.
- [x] Test attempt A failure followed by attempt B ambiguous start and later successful adoption.
- [x] Test pre-acceptance and post-acceptance 404 behavior.
- [x] Test a queued run without job ID across separate invocations.
- [x] Test manual-run conflict without cancellation of the other run.
- [x] Test three or more continuation invocations with one new start each.
- [x] Test no second start after a new job fails in the same invocation.
- [x] Test monitoring-limit marking, cancellation, inactive verification, and later continuation.
- [x] Test late completion rejection for any earlier monitoring-limited attempt.
- [x] Test queue job-ID reuse across different V02 run IDs and queue creation times.
- [x] Test durable completion with missing queue status.
- [x] Test active durable status with missing queue evidence stopping as unverified.
- [x] Test worker database timestamps that differ slightly from the ops clock.
- [x] Advance an injected fake clock from the injected delay in monitoring tests.
- [x] Prove the 12-hour monitoring path without real five-minute waits or real timers.
- [x] Test immutable inputs, no count aggregation, and no sensitive logging payloads.

### Phase 4 Verification and Commit

- [x] Add the compiled runner test file to the explicit `ops/package.json` test command.
- [x] Run `npm run build --workspace @newsnexus/db-models`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops`.
- [x] Run `npm test --workspace newsnexus12-ops`.
- [x] Run `npm run build --workspace newsnexus12-ops`.
- [x] Fix failures and rerun all affected Phase 4 commands.
- [x] Check off every completed Phase 4 task in this todo.
- [x] Commit Phase 4 changes using the repository commit format, reference this todo and Phase 4, and include all contributing-agent co-author lines.

## Phase 5: Integrate Phase 7 with the Coordinator

### Coordinator Wiring

- [x] Add `runAiApprover` and `aiApproverWorker`, or names matching the existing Phase 6 pattern, to `CoordinatorDependencies`.
- [x] Define the Phase 7 runner dependency shape consistently with `runState` and `stateWorker`.
- [x] Create a `createAiApproverV02Worker(config, request)` factory or equivalent.
- [x] Build the default Phase 7 worker from the coordinator's shared injected `request` dependency.
- [x] Use the configured worker-python base URL and Phase 7 request timeout inside that factory.
- [x] Do not call `globalThis.fetch` or another direct fetch path when an injected request exists.
- [x] Ensure preview, start, detail, and cancellation all use the same injected request transport.
- [x] Refresh the persisted run after Phase 6 completes before evaluating the Phase 7 boundary.
- [x] Replace the existing Phase 7 boundary stop with Phase 7 execution.
- [x] Skip Phase 7 when the weekly run is already complete.
- [x] Skip worker requests when Phase 7 is already complete.
- [x] Reject entry when Phase 6 is incomplete or `articleCount` is invalid.
- [x] Log current V02 run ID, current job ID, status, counts, recovery decision, elapsed observation, and cancellation outcome.
- [x] Keep tokens, snapshots, content, prompts, model input, and secrets out of logs.
- [x] Add Phase 7 client and runner error categories to coordinator failure classification.
- [x] Persist Phase 7 failures with `phase: 7` while preserving Phase 6 completion.
- [x] Return only after Phase 7 has atomically completed the weekly run.

### Coordinator and Entry Tests

- [x] Treat `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts` as the current coordinator test file.
- [x] Search that file for every `Phase 7 boundary` assertion before changing coordinator behavior.
- [x] Rename the test that says Phases 1 through 6 stop at the Phase 7 boundary.
- [x] Rewrite every positive and negative boundary-log assertion for the implemented Phase 7 outcomes.
- [x] Make every existing test that reaches completed Phase 6 inject a controlled Phase 7 runner or a controlled Phase 7 worker.
- [x] Extend coordinator tests for the complete Phase 1 through Phase 7 order.
- [x] Test positive-work Phase 7 completion.
- [x] Test Phase 7 zero-work completion.
- [x] Test continuation into incomplete Phase 7 without restarting completed phases.
- [x] Test completed Phase 7 performs no worker request.
- [x] Test Phase 7 failure leaves Phase 6 complete and the weekly run incomplete.
- [x] Add a regression test that injects the coordinator `request` but does not inject a Phase 7 worker.
- [x] In that regression test, prove Phase 7 uses the injected request and never falls back to real `fetch`.
- [x] Keep all coordinator tests independent of running workers, PostgreSQL, network access, and package `.env` files.
- [x] Update entrypoint tests only where the new production dependency wiring changes expectations.
- [x] Preserve existing run-selection and CLI behavior.

### Phase 5 Verification and Commit

- [x] Run `npm run build --workspace @newsnexus/db-models`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops`.
- [x] Run `npm test --workspace newsnexus12-ops`.
- [x] Run `npm run build --workspace newsnexus12-ops`.
- [x] Fix failures and rerun all affected Phase 5 commands.
- [x] Check off every completed Phase 5 task in this todo.
- [x] Commit Phase 5 changes using the repository commit format, reference this todo and Phase 5, and include all contributing-agent co-author lines.

## Phase 6: Update Operations Documentation and Verify

### Ops Documentation

- [x] Update `ops/README.md` with Phase 7 configuration and operator behavior.
- [x] Document the exact preview, start, detail, zero-work, and completion contracts.
- [x] Document that `aiApproverV02JobId` mirrors only the current attempt.
- [x] Document unlimited continuation invocations and one new job per invocation.
- [x] Distinguish the 72-hour default-selection window from explicit continuation behavior.
- [x] Document the five-minute poll interval, 60-second request timeout, two tolerated transient failures, and 12-hour queue-age limit.
- [x] Explain that shared-queue wait time counts toward the limit.
- [x] Document pre-acceptance and post-acceptance 404 behavior.
- [x] Document manual V02 run conflicts and the prohibition on canceling another run.
- [x] Document orphaned accepted-run and missing-queue-evidence behavior.
- [x] Explain positional-window drift and possible additional AI cost across attempts.
- [x] State that valid Phase 7 success or typed zero work completes the weekly run.
- [x] Retain the prohibition on automatic systemd restart after failure.

### Agent and Worker Documentation

- [x] Update `ops/AGENTS.md` so Phase 7 replaces the current boundary statement.
- [x] Add Phase 7 worker, recovery, persistence, monitoring, cancellation, and logging rules.
- [x] Update active worker-python guidance that describes V02 as manual-only.
- [x] Preserve historical or archived statements.
- [x] Do not add or enable systemd units.

### Final Verification

- [x] Confirm every new compiled ops test file appears in `ops/package.json`.
- [x] Run focused worker-python V02 tests if worker tests or contracts changed.
- [x] Run the full worker-python suite if applicable and a disposable test database is configured.
- [x] Run `npm run build --workspace @newsnexus/db-models`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops`.
- [x] Run `npm test --workspace newsnexus12-ops`.
- [x] Run `npm run build --workspace newsnexus12-ops`.
- [x] Run API tests only if an observable worker-python proxy contract changed.
- [x] Do not run `weekly-flow-02:dev`, `weekly-flow-02:start`, or compiled runtime entry points as smoke tests.
- [x] Review the complete diff for accidental schema, selection, CLI, systemd, or unrelated changes.
- [x] Confirm no preview token, Article content, prompt content, credential, or secret appears in source fixtures, logs, snapshots, or documentation.
- [x] Confirm Phase 7 has no lifetime attempt cap and never starts more than one new job per invocation.
- [x] Confirm Phase 7 completion and weekly-run completion remain atomic.
- [x] Search active ops tests and source for obsolete `Phase 7 boundary` expectations.
- [x] Confirm no coordinator path bypasses its injected request with a direct network transport.
- [x] Confirm monitoring tests use fake time and no real five-minute waits.
- [x] Check off every completed Phase 6 task and every completed guardrail in this todo.
- [x] Commit Phase 6 changes using the repository commit format, reference this todo and Phase 6, and include all contributing-agent co-author lines.

## Operator Rollout Boundary

Implementation completion does not authorize a real weekly-flow run.

Before an operator-authorized run:

- [ ] Confirm Phase 6 implementation and deployment are complete.
- [ ] Deploy and restart reviewed worker-python code.
- [ ] Confirm exactly one active V02 prompt.
- [ ] Confirm Codex CLI authentication and model access for the worker service account.
- [ ] Confirm the shared queue and V02 detail endpoints.
- [ ] Confirm Phase 7 polling and monitoring configuration.
- [ ] Build db-models, db-manager, and ops for the intended environment.
- [ ] Verify the intended worker-python URL and PostgreSQL target.
- [ ] Perform an operator-observed manual weekly-flow run before enabling any timer.
