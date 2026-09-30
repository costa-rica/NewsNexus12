---
created_at: 2026-09-29T22:45:09Z
updated_at: 2026-09-29T22:45:09Z
created_by: hermes (gpt-5.6-sol) nws-nn12dev
modified_by: hermes (gpt-5.6-sol) nws-nn12dev
source_plan: docs/20260929_weekly_flow_diagnostics_plan_v04.md
---

# Weekly flow semantic diagnostics TODO v01

## Purpose

Implement, verify, deploy, and use bounded worker-node diagnostics to correlate a future semantic-scorer connection reset with process age, memory, event-loop responsiveness, model initialization, and the first scoring attempt.

This TODO implements `docs/20260929_weekly_flow_diagnostics_plan_v04.md`. It deliberately excludes all weekly-flow `.service` and `.timer` modifications and tests.

## Non-negotiable boundaries

- [ ] Do not modify, copy, reinstall, inspect, hash-check, or retest the installed weekly-flow `.service` or `.timer` files on development or production.
- [ ] Do not change any tracked file under `ops/weekly-article-flow/systemd/`.
- [ ] Do not write to `/etc/systemd/system/`, create a drop-in, run `systemctl daemon-reload`, alter enablement, or schedule another timer drill.
- [ ] Do not change semantic selection, SQL behavior, model choice, queue concurrency, polling cadence, request timeout, retry behavior, or cancellation behavior.
- [ ] Do not mix the state-assigner model failure, AI Approver eligibility failure, or alert-publisher privilege failure into this change.
- [ ] Do not log credentials, environment dumps, article text, prompts, SQL text, HTTP bodies, or response bodies.
- [ ] Do not stage or commit the pre-existing `package-lock.json` modification.
- [ ] Do not stage or commit `ops/weekly-article-flow/systemd/nws-nn12dev-drill/`.
- [ ] Do not restart `newsnexus12-db-manager.service`.
- [ ] Use strict test-first RED → GREEN → REFACTOR cycles for every production-code change. Record the focused failing and passing command in the implementation notes or commit message.

## Phase 0 — Safety and baseline

### Repository guard

- [ ] Confirm the checkout is `/home/limited_user/applications/NewsNexus12` on `nws-nn12dev`.
- [ ] Record the current branch, `HEAD`, upstream, and `git status --short --branch`.
- [ ] Confirm the only expected pre-existing unrelated changes are `package-lock.json` and `ops/weekly-article-flow/systemd/nws-nn12dev-drill/`. Stop if any other unexpected path is dirty.
- [ ] Confirm this TODO and `docs/20260929_weekly_flow_diagnostics_plan_v04.md` are the only intended planning artifacts.
- [ ] Confirm no implementation commit includes the unrelated paths.

### Existing behavior baseline

- [ ] Run the current focused worker tests against a uniquely named disposable database before changing code.
- [ ] Explicitly set `NODE_ENV=test`, a unique `newsnexus_test_worker_diag_<suffix>` database, and the configured test/bootstrap PostgreSQL role.
- [ ] Compare the disposable database name with every runtime database name available to the executor and abort if any match.
- [ ] Never source a runtime environment and then run Jest without overriding `PG_DATABASE` to the disposable name.
- [ ] Record the baseline result for:
  - `worker-node/tests/modules/startupConfig.test.ts`
  - `worker-node/tests/modules/semanticScorerJob.test.ts`
  - `worker-node/tests/routes/semanticScorer.test.ts`
- [ ] Do not continue if baseline failures make later regression results ambiguous; investigate or document the blocker first.

### Phase 0 verification gate

- [ ] Working-tree scope is understood.
- [ ] Disposable-test-database safety is proven.
- [ ] Focused baseline tests pass or a concise blocker report is produced.
- [ ] Make no commit in this phase unless an approved planning-artifact commit is explicitly requested.

## Phase 1 — Diagnostic configuration, test first

**Files**

- Modify: `worker-node/src/modules/startup/config.ts`
- Modify: `worker-node/tests/modules/startupConfig.test.ts`
- Modify as needed for typed propagation: `worker-node/src/server.ts`
- Modify as needed for typed propagation: `worker-node/src/app.ts`

### RED: define configuration behavior

- [ ] Add a failing test proving `WORKER_HTTP_DIAGNOSTICS_ENABLED` defaults to `false` when absent or blank.
- [ ] Add failing table-driven tests for the repository's accepted explicit boolean forms. At minimum, assess existing conventions before fixing the accepted set; keep the final set narrow and documented.
- [ ] Add a failing test proving an explicitly invalid value throws `StartupConfigError` naming `WORKER_HTTP_DIAGNOSTICS_ENABLED`.
- [ ] Run only `worker-node/tests/modules/startupConfig.test.ts` and verify the new tests fail because the setting is not implemented—not because of setup or syntax errors.

### GREEN: implement minimal configuration

- [ ] Add `workerHttpDiagnosticsEnabled: boolean` to `AppConfig`.
- [ ] Add one shared boolean parser in `worker-node/src/modules/startup/config.ts`; do not duplicate environment parsing in the route or semantic job.
- [ ] Default the optional flag to `false`.
- [ ] Fail worker startup on an explicit invalid value.
- [ ] Include only the resolved boolean—not raw environment contents—in the safe startup configuration log.
- [ ] Thread the resolved boolean from `startServer()` into app/semantic-route construction without reading or parsing the environment again.
- [ ] Re-run the focused config test and verify it passes.

### REFACTOR and regression gate

- [ ] Remove duplication and keep naming worker-scoped.
- [ ] Confirm no coordinator configuration or weekly-flow unit file was changed.
- [ ] Run the focused startup and semantic-route tests against the disposable database.
- [ ] Run `npm run build --workspace newsnexus12-worker-node`.
- [ ] Commit only Phase 1 files with a focused message after all checks pass.

## Phase 2 — Bounded semantic diagnostic collector, test first

**Files**

- Create: `worker-node/src/modules/jobs/semanticScorerDiagnostics.ts`
- Create: `worker-node/tests/modules/semanticScorerDiagnostics.test.ts`
- Reuse logger contract from: `worker-node/src/modules/logger.ts`

### Collector contract

The collector must provide a narrow API that can:

- start for one semantic queue job;
- emit named boundary events;
- sample process-wide measurements while active;
- emit one final/suppression summary;
- stop idempotently and release every timer/monitor;
- no-op when diagnostics are disabled.

Every event must contain a stable event name, queue job ID, UTC timestamp, monotonic elapsed milliseconds, and a label that measurements are process-wide.

### RED: disabled mode and safe fields

- [ ] Add a failing test proving disabled mode emits no diagnostic records and allocates no active sampler.
- [ ] Add a failing test proving enabled boundary records contain:
  - queue job ID;
  - phase/event name;
  - UTC timestamp;
  - monotonic elapsed duration;
  - process uptime;
  - RSS, heap used, heap total, external memory, and array-buffer memory when supported;
  - event-loop utilization;
  - event-loop-delay summary fields;
  - `scope: process` or an equivalently explicit process-wide label.
- [ ] Add a failing test proving emitted records cannot contain credential-like values, article text, prompts, SQL text, environment dumps, URLs with query data, or HTTP bodies.
- [ ] Verify each test fails for the expected missing collector behavior.

### GREEN: minimal collector

- [ ] Use supported `node:perf_hooks` APIs for monotonic timing, event-loop utilization, and event-loop-delay monitoring.
- [ ] Use `process.memoryUsage()` and `process.uptime()` for process measurements.
- [ ] Emit structured metadata through the existing worker logger rather than string-concatenating arbitrary inputs.
- [ ] Accept the logger and clock/timer/performance dependencies by injection where needed for deterministic tests.
- [ ] Ensure a diagnostic logging exception is caught and cannot change job behavior.
- [ ] Make disabled mode a true no-op.
- [ ] Run the focused collector tests and verify they pass.

### RED/GREEN: bounds and cleanup

- [ ] Add failing fake-timer tests proving periodic sampling occurs no more than once per second.
- [ ] Add a failing test proving sampling stops at 15 minutes.
- [ ] Add a failing test proving no more than 1,000 records are emitted.
- [ ] Add a failing test proving exactly one suppression/final summary is emitted when a limit is reached.
- [ ] Add a failing test proving the sampling timer is `unref()`'d.
- [ ] Add failing tests proving `stop()` is idempotent and disables the event-loop monitor.
- [ ] Add a failing test that simulates delayed timer execution and requires the next record to identify the delayed sample after the loop resumes.
- [ ] Implement the smallest bounded sampler satisfying those tests.
- [ ] Run focused collector tests with open-handle detection if supported by the existing Jest setup.

### Phase 2 verification gate

- [ ] All collector tests pass.
- [ ] Existing startup and semantic tests still pass.
- [ ] TypeScript build passes.
- [ ] No dependency addition or `package-lock.json` change is required; stop for review if implementation unexpectedly requires one.
- [ ] Commit only the collector, tests, and directly required typed interfaces.

## Phase 3 — Semantic lifecycle integration, test first

**Files**

- Modify: `worker-node/src/modules/jobs/semanticScorerJob.ts`
- Modify: `worker-node/tests/modules/semanticScorerJob.test.ts`
- Modify: `worker-node/src/routes/semanticScorer.ts`
- Modify: `worker-node/tests/routes/semanticScorer.test.ts`
- Modify as required by Phase 1 plumbing: `worker-node/src/app.ts`
- Use: `worker-node/src/modules/jobs/semanticScorerDiagnostics.ts`

### RED: route-to-job correlation

- [ ] Add a failing route test proving the already-validated diagnostics boolean reaches `createSemanticScorerJobHandler` without reparsing `process.env`.
- [ ] Keep optional article-ID targeting unchanged and verify the weekly flow can still omit bounds.
- [ ] Implement only the typed configuration plumbing needed to make the route test pass.

### RED: lifecycle boundary events

- [ ] Add failing semantic-job tests requiring correlated events for:
  - `semantic_job_started`;
  - candidate/keyword selection completed with existing aggregate counts;
  - `semantic_model_initialization_started`;
  - model initialization completed with duration, or failed with bounded safe error metadata;
  - `semantic_first_article_attempt_started`;
  - terminal `completed`, `failed`, or `canceled` event;
  - collector cleanup/final summary.
- [ ] Require every event to carry the queue job ID.
- [ ] Do not require article IDs, article text, keyword values, prompts, or model output in diagnostics.
- [ ] Verify tests fail because lifecycle events are absent.

### GREEN: integrate without changing semantics

- [ ] Create the collector once per semantic queue job when diagnostics are enabled.
- [ ] Start it at the queue-job boundary, before expensive semantic preparation.
- [ ] Emit candidate and keyword counts using values already loaded by the existing workflow; do not add database queries.
- [ ] Wrap model initialization only for boundary timing and safe error reporting; preserve the existing cached `embedderPromise` behavior.
- [ ] Add a one-shot first-attempt callback/hook at the scoring-loop boundary that emits before the first scorable article attempt without exposing its content or ID.
- [ ] Ensure an all-skipped/no-usable-text run produces an unambiguous terminal record even when no first-attempt event occurs.
- [ ] Stop the collector in a `finally` path so completion, thrown failure, and cancellation all clean up.
- [ ] Catch diagnostic failures locally and preserve the original semantic result/error.
- [ ] Do not change `SemanticScorerJobResult`, queue status semantics, persistence behavior, iteration timeout, or cancellation checks unless the approved TODO assessment explicitly identifies a required compatibility field.

### RED/GREEN: behavior-preservation tests

- [ ] Add a test proving disabled diagnostics preserve existing logs/results and emit no new diagnostic events.
- [ ] Add a test proving a collector/logging exception does not alter a successful semantic result.
- [ ] Add a test proving a collector/logging exception does not replace the original semantic failure.
- [ ] Add a test proving cancellation still returns the same selected/unattempted counts and does not write completion status.
- [ ] Add a test proving model initialization failure emits a bounded failure event and preserves the original failure.
- [ ] Add a test proving all-skipped and zero-selected jobs terminate cleanly without fabricating a first-attempt event.
- [ ] Re-run each focused test through RED and GREEN.

### Phase 3 verification gate

- [ ] `startupConfig`, `semanticScorerDiagnostics`, `semanticScorerJob`, and semantic route tests pass against the disposable database.
- [ ] Existing request count, queue lifecycle, cancellation, and result contracts are unchanged.
- [ ] TypeScript build passes.
- [ ] Inspect emitted test records and confirm they contain no sensitive/body fields.
- [ ] Commit only Phase 3 implementation and tests.

## Phase 4 — Full development verification without weekly systemd testing

### Test and build

- [ ] Recreate or verify a unique disposable worker-node test database; repeat the runtime-name mismatch guard.
- [ ] Run the complete worker-node Jest suite with `NODE_ENV=test` and the disposable database.
- [ ] Treat Jest exit code as authoritative; investigate failures rather than weakening tests.
- [ ] Run `npm run build --workspace newsnexus12-worker-node`.
- [ ] Verify `worker-node/dist/` contains the approved diagnostic event names and configuration handling.
- [ ] Run `git diff --check` and inspect the complete intended diff.
- [ ] Verify no weekly `.service`/`.timer` path, unrelated lockfile, or drill unit is staged.

### Development runtime validation

- [ ] Confirm no weekly flow or semantic job is active before changing the worker runtime.
- [ ] Back up the existing worker-node application configuration through its established safe mechanism.
- [ ] Add `WORKER_HTTP_DIAGNOSTICS_ENABLED=true` only to the existing worker-node application configuration; do not edit a systemd unit or drop-in.
- [ ] Stop then start only `newsnexus12-worker-node.service` using the approved control path.
- [ ] Do not restart `newsnexus12-db-manager.service` or unrelated services.
- [ ] Verify worker-node service health, local health endpoint, PID/start time, and safe startup log showing diagnostics enabled.
- [ ] Trigger at most one semantic job through the existing application/manual endpoint if needed to validate live event correlation. Do not use a weekly timer or weekly service.
- [ ] Record job ID, terminal queue result, diagnostic event sequence, maximum sample count, cleanup summary, and whether any open sampler remained.
- [ ] Verify the live job's selected/attempted/success/skipped/failed/unattempted counts using the queue result; do not infer health from HTTP acceptance alone.
- [ ] Treat non-reproduction of `ECONNRESET` as inconclusive, not as a fix.

### Phase 4 verification gate

- [ ] Full worker-node tests pass.
- [ ] Build passes and compiled output is verified.
- [ ] Worker-node is healthy with diagnostics enabled.
- [ ] Development diagnostic records are bounded, correlated, and safe.
- [ ] Weekly systemd files and timer were not modified or tested.
- [ ] Commit any final test-only corrections separately after rerunning the gate.

## Phase 5 — Review, commit, and push

- [ ] Review the implementation against every v04 hard boundary.
- [ ] Run a security-focused diff review for credential/body leakage and unbounded logging.
- [ ] Run a code-quality review for timer/monitor cleanup, error isolation, and cached model initialization.
- [ ] Run the final focused tests, full worker-node suite, build, and `git diff --check`.
- [ ] Stage only:
  - approved worker-node source changes;
  - approved worker-node tests;
  - `docs/20260929_weekly_flow_diagnostics_plan_v04.md`;
  - this approved TODO and any qualifying assessment/revision files.
- [ ] Confirm `package-lock.json` and `ops/weekly-article-flow/systemd/nws-nn12dev-drill/` are not staged.
- [ ] Inspect `git diff --cached --name-status` and `git diff --cached` before committing.
- [ ] Commit with focused messages; do not squash unrelated work into the diagnostics commit.
- [ ] Fetch the target remote branch and stop if upstream divergence or overlapping remote changes are found.
- [ ] Push without force and verify local/remote SHA parity.

## Phase 6 — Production deployment without unit-file changes

### Production safety gate

- [ ] Confirm host `nws-nn12prod`, UTC time, repository path, active branch/revision, origin URL, upstream relationship, and clean worktree.
- [ ] Stop if production has uncommitted files, divergent history, or unexpected branch state.
- [ ] Fetch the approved branch and inspect the incoming file list before pulling.
- [ ] Prove the incoming diff contains no weekly `.service`/`.timer` file, no systemd drop-in, and no unrelated lockfile change.
- [ ] Pull with `--ff-only`; do not reset, rebase, merge, or force.
- [ ] Do not inspect or retest the installed weekly-flow unit files; simply keep them outside the deployment procedure.

### Build and worker activation

- [ ] Do not run `npm install`/`npm ci` unless the approved diff actually changes dependency manifests or lockfiles.
- [ ] Build `newsnexus12-worker-node` and verify the compiled diagnostic event names/config path.
- [ ] Back up the existing worker-node application configuration through its established safe mechanism.
- [ ] Add `WORKER_HTTP_DIAGNOSTICS_ENABLED=true` to the existing worker-node application configuration without printing secrets.
- [ ] Stop then start only `newsnexus12-worker-node.service` through the approved production control path.
- [ ] Do not restart `newsnexus12-db-manager.service` or unrelated services.
- [ ] Verify worker-node service health, local endpoint, PID/start time, deployed revision, and safe startup log.
- [ ] Stop and report if worker-node does not become healthy; do not trigger the weekly flow.

### Phase 6 verification gate

- [ ] Production checkout is clean and at the pushed SHA.
- [ ] Compiled diagnostics are present.
- [ ] Worker-node is healthy with diagnostics enabled.
- [ ] No weekly unit/timer file or schedule was touched.

## Phase 7 — One manually triggered production observation

> **Real production data change:** This phase runs the complete production weekly flow. It performs its normal backup, duplicate cleanup, age-based deletion, RSS ingestion, semantic scoring, state assignment, AI Approver work, reporting, and database writes. Production mode has no canary target.

### Preflight

- [ ] Verify no active or nonterminal weekly run exists.
- [ ] Verify no conflicting semantic, RSS, state-assignment, maintenance, backup, or deletion job/process is active.
- [ ] Verify the weekly-flow lock is not held by another run without deleting or bypassing it.
- [ ] Verify worker-node is healthy and diagnostics are enabled.
- [ ] Record production revision, worker PID/start time, process age, baseline memory, Node version, and UTC clock alignment.
- [ ] Verify the established production environment and `limited_user`/`newsnexus_app` identities without displaying credentials.
- [ ] Run the existing configuration check if it can be done through the established authorized path without changing files or starting work.
- [ ] Stop on any identity, lock, active-run, service-health, or configuration mismatch.

### Manual launch

- [ ] Start exactly one production weekly flow through the established manual operator path.
- [ ] Do not wait for, reschedule, enable, disable, or test the timer.
- [ ] If the established manual path starts the already-installed weekly service directly, use it only as the launch mechanism; do not inspect, edit, reload, or otherwise test its definition.
- [ ] Do not submit a second start if output appears delayed.
- [ ] Record the durable weekly run ID and semantic child job ID as soon as available.

### Observation

- [ ] Follow coordinator output/journal, worker log, durable run state, and exact semantic queue job to terminal status.
- [ ] Correlate events by UTC timestamp, weekly run ID, semantic job ID, and worker PID.
- [ ] Capture model-initialization start/completion, first-attempt, memory, event-loop, delayed-sample, and collector-summary records.
- [ ] If coordinator polling fails, record endpoint, duration, nested cause, timeout/status state, cancellation-request outcome, and the worker's state at the same timestamp.
- [ ] If the workflow fails, identify the final business stage separately from durable `currentStage=reporting` behavior.
- [ ] Check whether the semantic child job remains active after coordinator failure before any recovery decision; do not cancel or mutate it without separate authorization.
- [ ] Keep downstream state-assigner, AI Approver, and alert-publisher failures separate from semantic transport findings.

### Terminal report

- [ ] Report whether `ECONNRESET` reproduced.
- [ ] Report the semantic job's selected, attempted, successful, skipped, failed, and unattempted counts.
- [ ] Report worker age and resource/event-loop measurements around selection, model initialization, first attempt, and any reset.
- [ ] State what the evidence establishes and what remains unknown; do not infer the reset sender from timing alone.
- [ ] If no reset occurs, state only that this observation did not reproduce it.
- [ ] Do not rerun automatically. Review evidence before proposing a new condition or resilience change.

## Final completion checklist

- [ ] v04 plan and approved TODO artifacts are preserved without overwriting earlier versions.
- [ ] All implementation used verified RED → GREEN → REFACTOR cycles.
- [ ] Focused and full worker-node tests pass against a disposable database.
- [ ] Worker-node build passes and deployed compiled output is verified.
- [ ] Diagnostics are opt-in, bounded, correlated, redacted, and cleaned up on every terminal path.
- [ ] Semantic behavior and coordinator polling/cancellation behavior are unchanged.
- [ ] No weekly-flow `.service`, `.timer`, drop-in, schedule, or systemd directory file was modified or tested.
- [ ] `package-lock.json` and dev drill units remain excluded from commits.
- [ ] Production worker-node alone was refreshed; db-manager and unrelated services were not restarted.
- [ ] Exactly one manually triggered production observation was performed.
- [ ] Final evidence clearly separates semantic transport, semantic scoring, downstream AI stages, and alert publication.
