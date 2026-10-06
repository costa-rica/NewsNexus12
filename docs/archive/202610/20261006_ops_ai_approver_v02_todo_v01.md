---
created_at: 2026-10-06T19:02:29Z
updated_at: 2026-10-06T19:02:29Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops AI Approver V02 Todo V01

## Purpose

Implement Phase 7 of weekly-flow-02 from the approved plans:

- `20261006_ops_ai_approver_v02_plan_v02.md`
- `20261006_ops_ai_approver_v02_plan_v03.md`

V03 controls when it changes V02. Implement unlimited continuation invocations, one new V02 job per invocation, acceptance-aware recovery, exact current-attempt identity, and atomic Phase 7 plus weekly-run completion.

## Implementation Guardrails

- [ ] Read the root `AGENTS.md`, `ops/AGENTS.md`, and `worker-python/AGENTS.md` before editing their scopes.
- [ ] Inspect the working tree and preserve unrelated or in-progress changes.
- [ ] Do not run weekly-flow-02 against a real environment.
- [ ] Keep default ops tests database-free and worker-free.
- [ ] Use a disposable test database for worker-python integration tests.
- [ ] Add no database columns.
- [ ] Do not change V02 selection, prompts, prediction behavior, CLI syntax, or systemd units.
- [ ] Never log or persist preview tokens, selection snapshots, Article content, prompt content, model input, credentials, or database secrets.
- [ ] Keep `articleCount` and all four Phase 7 inputs immutable across attempts.
- [ ] Do not aggregate prediction counters across attempts.
- [ ] Do not add a lifetime attempt limit.

## Phase 1: Lock Worker-Python Contracts

### Contract Review

- [ ] Confirm `POST /ai-approver-v02/preview` accepts the exact Phase 7 input shape.
- [ ] Confirm typed HTTP 400 `no_eligible_articles` remains distinguishable from all other preview errors.
- [ ] Confirm `POST /ai-approver-v02/start` accepts only the V02 run ID and preview token.
- [ ] Confirm start queues `parameters.runId` and attaches the queue job ID to the V02 run.
- [ ] Confirm `GET /ai-approver-v02/runs/:runId` hides draft and expired previews.
- [ ] Confirm detail returns the complete durable execution row and matching queue record without exposing the preview token.
- [ ] Confirm accepted execution rows remain available through terminal statuses.
- [ ] Confirm startup reconciliation marks incomplete accepted V02 runs failed.
- [ ] Confirm cancellation can return `canceled`, `cancel_requested`, or `not_found`.

### Worker Tests

- [ ] Add or extend focused tests for the exact preview request and both required Boolean flags.
- [ ] Add or extend the typed zero-work response test.
- [ ] Lock the start response and `parameters.runId` queue contract.
- [ ] Lock the detail response fields required by Phase 7:
  - [ ] V02 run identity and immutable inputs.
  - [ ] Planned, attempted, completed, failed, invalid, and skipped counts.
  - [ ] Status, ending reason, and lifecycle timestamps.
  - [ ] Queue job identity, endpoint, parameters, and lifecycle timestamps.
  - [ ] No preview token in detail or queue parameters.
- [ ] Cover completed, failed, canceled, circuit-breaker, and restart-reconciled durable outcomes.
- [ ] Preserve existing API proxy and portal-compatible behavior.
- [ ] Change worker runtime code only if a focused test proves a required contract is absent.

### Phase 1 Verification and Commit

- [ ] Run `cd worker-python && ./venv/bin/pytest tests/unit/ai_approver_v02 tests/integration/test_ai_approver_v02_routes.py`.
- [ ] Run the full worker-python suite with `cd worker-python && ./venv/bin/pytest` if focused tests pass and a disposable test database is configured.
- [ ] Fix failures caused by this phase and rerun the affected commands.
- [ ] Review the diff for accidental token, content, credential, or unrelated changes.
- [ ] Check off every completed Phase 1 task in this todo.
- [ ] Commit Phase 1 changes using the repository commit format, reference this todo and Phase 1, and include all contributing-agent co-author lines.

## Phase 2: Add Phase 7 Configuration and Client

### Configuration

- [ ] Extend `OpsConfig` with Phase 7-specific settings:
  - [ ] Request timeout defaulting to 60 seconds.
  - [ ] Status poll interval defaulting to 300 seconds.
  - [ ] Tolerated consecutive transient status failures defaulting to 2.
  - [ ] Monitoring limit defaulting to 12 hours.
- [ ] Add the settings to `ops/.env.example` without adding secrets.
- [ ] Extend config tests for defaults, valid overrides, and invalid nonpositive values.

### AI Approver V02 Client

- [ ] Create `ops/src/weekly-flow-02/phases/07_aiApproverV02Client.ts`.
- [ ] Define exact request and response types for preview, start, detail, and cancel.
- [ ] Define durable V02 statuses, queue statuses, immutable inputs, counters, and lifecycle fields without using `any`.
- [ ] Implement typed client error categories for:
  - [ ] Transient request.
  - [ ] Permanent request.
  - [ ] Malformed response.
  - [ ] Identity mismatch.
  - [ ] Start conflict.
  - [ ] Unavailable unaccepted preview.
  - [ ] Accepted run unavailable.
  - [ ] Cancellation failure.
  - [ ] Unverified outcome.
- [ ] Send exactly the required preview body using the persisted `articleCount`.
- [ ] Validate successful preview identity, inputs, count, snapshot length, item identity, content source, token, and worker-owned timestamps.
- [ ] Recognize only typed `no_eligible_articles` as zero work.
- [ ] Keep the preview token in memory only and exclude it from errors, logs, and durable client results after start.
- [ ] Send exactly `{ runId, previewToken }` to start.
- [ ] Validate the HTTP 202 start run ID, nonempty job ID, and queued status.
- [ ] Parse typed start conflicts without assuming the conflicting run's identity.
- [ ] Fetch detail by the persisted V02 run ID.
- [ ] Distinguish 404 for a caller-supplied pre-acceptance context from 404 for an accepted attempt.
- [ ] Validate durable run inputs, counts, status, ending reason, and lifecycle timestamps.
- [ ] Validate queue job ID, endpoint, exact `parameters.runId`, status, and lifecycle timestamps when queue status exists.
- [ ] Do not compare worker timestamps with the ops process clock.
- [ ] Allow a missing queue record in the parsed detail result without inventing `queueCreatedAt`.
- [ ] Implement cancellation and accept only matching `canceled` or `cancel_requested` results.
- [ ] Reject `not_found`, mismatched identities, and malformed cancellation responses.

### Client Tests

- [ ] Create `ops/tests/weekly-flow-02/07_aiApproverV02Client.test.ts`.
- [ ] Test exact preview and start bodies.
- [ ] Test token handling and verify it is absent from persisted-safe results and error messages.
- [ ] Test typed zero work and rejection of lookalike HTTP 400 responses.
- [ ] Test preview snapshot, count, input, identity, and timestamp validation.
- [ ] Test every supported V02 and queue lifecycle status.
- [ ] Test durable counters and both completion invariants.
- [ ] Test transient, permanent, timeout, conflict, malformed, and both 404 classifications.
- [ ] Test missing queue status without a fabricated timestamp.
- [ ] Test cancellation outcomes, including explicit rejection of `not_found`.

### Phase 2 Verification and Commit

- [ ] Add the compiled client test file to the explicit `ops/package.json` test command.
- [ ] Run `npm run build --workspace @newsnexus/db-models`.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops`.
- [ ] Run `npm test --workspace newsnexus12-ops`.
- [ ] Run `npm run build --workspace newsnexus12-ops`.
- [ ] Fix failures and rerun all affected Phase 2 commands.
- [ ] Check off every completed Phase 2 task in this todo.
- [ ] Commit Phase 2 changes using the repository commit format, reference this todo and Phase 2, and include all contributing-agent co-author lines.

## Phase 3: Implement Durable Phase 7 State

### State Types and Parsing

- [ ] Add Phase 7 input, attempt, progress, monitoring, cancellation, and result types to the ops persistence boundary.
- [ ] Add a focused Phase 7 recovery-state module if needed to keep parsing and validation separate from Sequelize writes.
- [ ] Represent every attempt with a positive `v02RunId` as its stable key.
- [ ] Store `jobId + queueCreatedAt` when queue identity is available.
- [ ] Store acceptance evidence from a valid start response or visible execution status.
- [ ] Store monitoring-limit evidence on the exact attempt.
- [ ] Merge repeated observations by `v02RunId` instead of duplicating attempts.
- [ ] Treat history length only as audit and recovery evidence, never as continuation eligibility.
- [ ] Reject malformed current identity, immutable inputs, counters, or chronology.

### Persistence Interface

- [ ] Add a dedicated Phase 7 start operation that persists the immutable input mirror before preview.
- [ ] Add initial preview persistence with `currentV02RunId` and a null `aiApproverV02JobId` mirror.
- [ ] Add protected continuation preview persistence that:
  - [ ] Locks and validates the run.
  - [ ] Checks the expected current V02 run and job identities.
  - [ ] Confirms the prior attempt is continuation-eligible.
  - [ ] Preserves prior attempt history.
  - [ ] Appends the new preview attempt.
  - [ ] Makes the new V02 run current.
  - [ ] Clears `aiApproverV02JobId` atomically.
- [ ] Add protected start-response job binding.
- [ ] Add protected recovery job adoption.
- [ ] Require both binding operations to update the current attempt and `aiApproverV02JobId` together.
- [ ] Reject binding when a different non-null current job identity exists.
- [ ] Add attempt progress writes that preserve every sibling attempt and phase node.
- [ ] Add monitoring-limit and cancellation evidence writes tied to the exact V02 run and queue identity.
- [ ] Add atomic zero-work completion that clears the current job mirror and records `zeroWorkAfterPriorAttempts`.
- [ ] Add atomic successful completion that verifies current V02 run ID, current attempt job ID, and the weekly-row job mirror.
- [ ] Prevent generic `recordPhaseCompleted` and `recordRunCompleted` from completing Phase 7 independently.

### Sequelize and Test Support

- [ ] Implement every Phase 7 operation in `sequelizePersistence.ts` with row locking and expected-identity checks.
- [ ] Preserve the repository's database-error suppression behavior.
- [ ] Update `persistenceTestSupport.ts` with matching in-memory semantics and preconditions.
- [ ] Ensure progress writes cannot restore a prior attempt's job ID after a continuation preview clears the mirror.
- [ ] Ensure failed atomic writes leave the prior current attempt and job mirror unchanged.

### Persistence Tests

- [ ] Extend `ops/tests/weekly-flow-02/persistence.test.ts` for Phase 7 initialization and immutable inputs.
- [ ] Test that preview persistence excludes the token and selection snapshot.
- [ ] Test that continuation preview persistence archives the prior identity and clears `aiApproverV02JobId`.
- [ ] Test rollback behavior when the protected continuation transition fails.
- [ ] Test atomic job binding and ambiguous-start recovery adoption.
- [ ] Test rejection of a stale prior-attempt mirror.
- [ ] Test attempt merge behavior and preservation of monitoring history.
- [ ] Test exact current identities for successful completion.
- [ ] Test that a prior attempt's late completion cannot complete Phase 7.
- [ ] Test initial and later zero-work completion, including `zeroWorkAfterPriorAttempts`.
- [ ] Test that Phase 7 and weekly-run completion cannot be split.

### Phase 3 Verification and Commit

- [ ] Run `npm run build --workspace @newsnexus/db-models`.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops`.
- [ ] Run `npm test --workspace newsnexus12-ops`.
- [ ] Run `npm run build --workspace newsnexus12-ops`.
- [ ] Fix failures and rerun all affected Phase 3 commands.
- [ ] Check off every completed Phase 3 task in this todo.
- [ ] Commit Phase 3 changes using the repository commit format, reference this todo and Phase 3, and include all contributing-agent co-author lines.

## Phase 4: Implement the Phase 7 Runner

### Runner Foundation

- [ ] Create `ops/src/weekly-flow-02/phases/07_runAiApproverV02.ts`.
- [ ] Validate that Phase 6 is complete, the weekly run is incomplete, and `articleCount` is positive.
- [ ] Validate the Phase 7 input mirror against `articleCount` and required constants on every continuation.
- [ ] Inject the client, persistence, clock, delay, and event callback.
- [ ] Add an invocation-local guard that permits at most one new V02 start.
- [ ] Never loop into another preview or start after failure, cancellation, monitoring limit, or conflict.

### Initial Preview and Start

- [ ] Persist Phase 7 start before requesting the first preview.
- [ ] Handle typed zero work through the dedicated atomic completion operation.
- [ ] Persist a validated preview before sending start.
- [ ] Bind the returned job ID immediately after a valid start response.
- [ ] Stop after an ambiguous start request without retrying start.
- [ ] Poll immediately after a successful start, then use non-overlapping configured delays.

### Saved-Attempt Recovery

- [ ] Load and validate the current attempt by `currentV02RunId`.
- [ ] Monitor a valid active accepted attempt when queue evidence is available.
- [ ] Adopt a recovered job ID only when the current attempt and weekly-row mirrors are null.
- [ ] Stop on a stale non-current job mirror rather than silently repairing it.
- [ ] Treat queued without job ID as an orphaned accepted run for the current invocation.
- [ ] Permit later adoption or startup-reconciled failure observation.
- [ ] Treat pre-acceptance 404 as an unavailable unaccepted preview eligible for a later attempt.
- [ ] Treat post-acceptance 404 as identity mismatch or unverified outcome with no replacement.
- [ ] On typed start conflict, stop without canceling or modifying another V02 run.
- [ ] Let the saved unaccepted preview expire and reinspect it on later continuation.

### Completion and Terminal Outcomes

- [ ] Accept only a valid durable V02 `completed` outcome with exact current identities and count invariants.
- [ ] Accept durable completion during the brief queue transition.
- [ ] Accept durable completion with a missing or restart-failed queue record when every durable contract validates.
- [ ] Record failed, canceled, and circuit-breaker outcomes without completing Phase 7.
- [ ] Exit after an unsuccessful attempt started in the current invocation.
- [ ] Permit one new attempt on a later invocation after verified terminal inactivity.
- [ ] Never aggregate counters across attempts.

### Monitoring and Cancellation

- [ ] Reset the transient failure counter after each valid detail response.
- [ ] Stop on the third consecutive transient request failure.
- [ ] Stop immediately on permanent, malformed, authorization, configuration, or identity errors.
- [ ] Measure the 12-hour limit only from validated queue `createdAt`.
- [ ] Count time spent queued in the shared worker queue.
- [ ] Do not invent a queue timestamp when queue status is absent.
- [ ] For an active durable run without queue evidence, stop as unverified without cancellation or replacement.
- [ ] Persist an exact monitoring-limit marker before cancellation.
- [ ] Cancel once and accept only matching `canceled` or `cancel_requested`.
- [ ] After `cancel_requested`, wait one interval and make one final detail request.
- [ ] Verify inactivity before allowing later continuation.
- [ ] Treat cancel `not_found` or ambiguous verification as a stop without replacement.
- [ ] Permanently reject late completion from every monitoring-limited V02 run.

### Unlimited Continuation

- [ ] Permit later invocations to create one new attempt after:
  - [ ] An unavailable unaccepted preview.
  - [ ] A terminal failed, canceled, or circuit-breaker run.
  - [ ] A verified inactive monitoring-limited run.
  - [ ] An orphaned accepted run later reconciled to terminal failure.
- [ ] Use the original `articleCount` and required flags for every new attempt.
- [ ] Use the protected continuation preview operation before every later start.
- [ ] Stop the invocation if the newly started attempt is unsuccessful.
- [ ] Keep later continuation eligibility unlimited by attempt count.

### Runner Tests

- [ ] Create `ops/tests/weekly-flow-02/07_runAiApproverV02.test.ts`.
- [ ] Test fresh preview, start, immediate poll, and atomic successful completion.
- [ ] Test initial zero work and zero work after prior attempts.
- [ ] Test completion with failed, invalid, or skipped individual Articles.
- [ ] Test active continuation and ambiguous-start job adoption.
- [ ] Test attempt A failure followed by attempt B ambiguous start and later successful adoption.
- [ ] Test pre-acceptance and post-acceptance 404 behavior.
- [ ] Test a queued run without job ID across separate invocations.
- [ ] Test manual-run conflict without cancellation of the other run.
- [ ] Test three or more continuation invocations with one new start each.
- [ ] Test no second start after a new job fails in the same invocation.
- [ ] Test monitoring-limit marking, cancellation, inactive verification, and later continuation.
- [ ] Test late completion rejection for any earlier monitoring-limited attempt.
- [ ] Test queue job-ID reuse across different V02 run IDs and queue creation times.
- [ ] Test durable completion with missing queue status.
- [ ] Test active durable status with missing queue evidence stopping as unverified.
- [ ] Test worker database timestamps that differ slightly from the ops clock.
- [ ] Test immutable inputs, no count aggregation, and no sensitive logging payloads.

### Phase 4 Verification and Commit

- [ ] Add the compiled runner test file to the explicit `ops/package.json` test command.
- [ ] Run `npm run build --workspace @newsnexus/db-models`.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops`.
- [ ] Run `npm test --workspace newsnexus12-ops`.
- [ ] Run `npm run build --workspace newsnexus12-ops`.
- [ ] Fix failures and rerun all affected Phase 4 commands.
- [ ] Check off every completed Phase 4 task in this todo.
- [ ] Commit Phase 4 changes using the repository commit format, reference this todo and Phase 4, and include all contributing-agent co-author lines.

## Phase 5: Integrate Phase 7 with the Coordinator

### Coordinator Wiring

- [ ] Add the Phase 7 runner and worker to coordinator dependencies.
- [ ] Create the production Phase 7 client from the configured worker-python base URL and Phase 7 request timeout.
- [ ] Refresh the persisted run after Phase 6 completes before evaluating the Phase 7 boundary.
- [ ] Replace the existing Phase 7 boundary stop with Phase 7 execution.
- [ ] Skip Phase 7 when the weekly run is already complete.
- [ ] Skip worker requests when Phase 7 is already complete.
- [ ] Reject entry when Phase 6 is incomplete or `articleCount` is invalid.
- [ ] Log current V02 run ID, current job ID, status, counts, recovery decision, elapsed observation, and cancellation outcome.
- [ ] Keep tokens, snapshots, content, prompts, model input, and secrets out of logs.
- [ ] Add Phase 7 client and runner error categories to coordinator failure classification.
- [ ] Persist Phase 7 failures with `phase: 7` while preserving Phase 6 completion.
- [ ] Return only after Phase 7 has atomically completed the weekly run.

### Coordinator and Entry Tests

- [ ] Extend coordinator tests for the complete Phase 1 through Phase 7 order.
- [ ] Test positive-work Phase 7 completion.
- [ ] Test Phase 7 zero-work completion.
- [ ] Test continuation into incomplete Phase 7 without restarting completed phases.
- [ ] Test completed Phase 7 performs no worker request.
- [ ] Test Phase 7 failure leaves Phase 6 complete and the weekly run incomplete.
- [ ] Test injected dependencies prevent real worker or database access.
- [ ] Update entrypoint tests only where the new production dependency wiring changes expectations.
- [ ] Preserve existing run-selection and CLI behavior.

### Phase 5 Verification and Commit

- [ ] Run `npm run build --workspace @newsnexus/db-models`.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops`.
- [ ] Run `npm test --workspace newsnexus12-ops`.
- [ ] Run `npm run build --workspace newsnexus12-ops`.
- [ ] Fix failures and rerun all affected Phase 5 commands.
- [ ] Check off every completed Phase 5 task in this todo.
- [ ] Commit Phase 5 changes using the repository commit format, reference this todo and Phase 5, and include all contributing-agent co-author lines.

## Phase 6: Update Operations Documentation and Verify

### Ops Documentation

- [ ] Update `ops/README.md` with Phase 7 configuration and operator behavior.
- [ ] Document the exact preview, start, detail, zero-work, and completion contracts.
- [ ] Document that `aiApproverV02JobId` mirrors only the current attempt.
- [ ] Document unlimited continuation invocations and one new job per invocation.
- [ ] Distinguish the 72-hour default-selection window from explicit continuation behavior.
- [ ] Document the five-minute poll interval, 60-second request timeout, two tolerated transient failures, and 12-hour queue-age limit.
- [ ] Explain that shared-queue wait time counts toward the limit.
- [ ] Document pre-acceptance and post-acceptance 404 behavior.
- [ ] Document manual V02 run conflicts and the prohibition on canceling another run.
- [ ] Document orphaned accepted-run and missing-queue-evidence behavior.
- [ ] Explain positional-window drift and possible additional AI cost across attempts.
- [ ] State that valid Phase 7 success or typed zero work completes the weekly run.
- [ ] Retain the prohibition on automatic systemd restart after failure.

### Agent and Worker Documentation

- [ ] Update `ops/AGENTS.md` so Phase 7 replaces the current boundary statement.
- [ ] Add Phase 7 worker, recovery, persistence, monitoring, cancellation, and logging rules.
- [ ] Update active worker-python guidance that describes V02 as manual-only.
- [ ] Preserve historical or archived statements.
- [ ] Do not add or enable systemd units.

### Final Verification

- [ ] Confirm every new compiled ops test file appears in `ops/package.json`.
- [ ] Run focused worker-python V02 tests if worker tests or contracts changed.
- [ ] Run the full worker-python suite if applicable and a disposable test database is configured.
- [ ] Run `npm run build --workspace @newsnexus/db-models`.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops`.
- [ ] Run `npm test --workspace newsnexus12-ops`.
- [ ] Run `npm run build --workspace newsnexus12-ops`.
- [ ] Run API tests only if an observable worker-python proxy contract changed.
- [ ] Do not run `weekly-flow-02:dev`, `weekly-flow-02:start`, or compiled runtime entry points as smoke tests.
- [ ] Review the complete diff for accidental schema, selection, CLI, systemd, or unrelated changes.
- [ ] Confirm no preview token, Article content, prompt content, credential, or secret appears in source fixtures, logs, snapshots, or documentation.
- [ ] Confirm Phase 7 has no lifetime attempt cap and never starts more than one new job per invocation.
- [ ] Confirm Phase 7 completion and weekly-run completion remain atomic.
- [ ] Check off every completed Phase 6 task and every completed guardrail in this todo.
- [ ] Commit Phase 6 changes using the repository commit format, reference this todo and Phase 6, and include all contributing-agent co-author lines.

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
