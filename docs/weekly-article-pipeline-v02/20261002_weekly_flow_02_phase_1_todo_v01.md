---
created_at: 2026-10-02T21:43:28Z
updated_at: 2026-10-02T21:43:28Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Todo V01

## Basis and scope

- Accepted plan: [Weekly Flow 02 Phase 1 Plan V04](20261002_weekly_flow_02_phase_1_plan_v04.md).
- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md).
- Codex is the todo creator. Claude is the assessor unless the operator reassigns either role.

This todo replaces the Phase 1 stub with a validated call to worker-python. It includes configuration, focused tests, coordinator integration, documentation, and development-server verification.

This increment does not add Phase 2, direct database access, JSONL state, automatic retries, run persistence, systemd units, or notifications.

## Working agreement

1. Implement one phase at a time and review its result before starting the next phase.
2. Keep control flow direct and names descriptive. Add comments only for intent or non-obvious behavior.
3. Preserve unrelated operator changes in the dirty worktree.
4. Do not include archived-document moves or unrelated files in implementation commits unless the operator directs it.
5. Check off only completed work and record verification results in this file.
6. Do not call the real worker endpoint from automated tests.
7. Do not advance past Phase 1 without a validated `cleared = true` response.

## Implementation phase 1: Test and configuration foundation

- [ ] Add `dist-test/` to `ops/.gitignore` while preserving the existing `logs/` rule.
- [ ] Add `ops/tsconfig.test.json` extending the production TypeScript settings.
- [ ] Configure the test build with `rootDir: "."`, `outDir: "dist-test"`, and includes for `src/**/*` and `tests/**/*`.
- [ ] Exclude `dist`, `dist-test`, and `node_modules` from the test build.
- [ ] Add the accepted `clean`, `clean:test`, `test:build`, and `test` scripts to `ops/package.json`.
- [ ] Change the production `build` script to clean `dist/` before compiling.
- [ ] Pass the two explicit compiled test paths to `node --test`; do not use a glob or bare test discovery.
- [ ] Extend `OpsConfig` with `workerPythonBaseUrl` and `workerPythonRequestTimeoutSeconds`.
- [ ] Extract pure `parseOpsConfig(env, baseDirectory)` configuration parsing.
- [ ] Keep `loadConfig()` responsible only for dotenv loading and calling the pure parser with the real `opsDirectory`.
- [ ] Preserve the `NODE_ENV=test` alias, environment precedence, and existing log rotation defaults.
- [ ] Validate `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` as a required HTTP or HTTPS URL.
- [ ] Validate `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` with a required-positive-integer parser.
- [ ] Do not reuse the optional log-rotation integer parser for the required request timeout.
- [ ] Resolve relative log paths against the explicit base directory supplied to `parseOpsConfig()`.
- [ ] Add `ops/tests/config.test.ts` without reading `.env` or mutating shared `process.env`.
- [ ] Test required values, HTTP and HTTPS URLs, malformed URLs, rejected protocols, invalid timeout values, log defaults, the test environment alias, and explicit base-directory path resolution.
- [ ] Update `ops/.env.example` with a safe local worker URL and `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS=90`.
- [ ] Update `ops/README.md` with the variable names, units, validation, and the relationship to worker-python's cancellation timeout.
- [ ] Preserve any existing operator edits in `ops/.env.example` and documentation while applying the accepted settings.

### Phase 1 verification and closeout

- [ ] Run `git check-ignore ops/dist-test/example.js` and confirm it succeeds.
- [ ] Run the focused configuration test through the new workspace test command.
- [ ] Run the ops type check and clean production build.
- [ ] Confirm no test files are emitted into `ops/dist/`.
- [ ] Confirm the stale pre-rename `dist/weekly-flow-02/phases/clearDuplicateAnalyses.js` file is absent after the clean build.
- [ ] Confirm `git status --short -- ops/dist-test` reports no generated files.
- [ ] Record commands, versions, and results below before checking off this phase.
- [ ] Commit only Phase 1 files and this todo update using the repository commit-message guidance.
- [ ] Review Phase 1 with the operator before beginning Phase 2.

### Phase 1 verification record

- Pending.

## Implementation phase 2: Phase result and worker request

- [ ] Define a small typed successful result with `rowsDeleted`, `cancelledJobs`, `cancellationRequestedJobs`, and `timestamp`.
- [ ] Keep runtime response input typed as `unknown` until validation succeeds.
- [ ] Validate `cleared` as exactly `true`.
- [ ] Validate `rowsDeleted` as a non-negative safe integer.
- [ ] Validate both job collections as arrays containing strings only.
- [ ] Validate `timestamp` as a non-empty string.
- [ ] Keep `exitCode`, `stdout`, and `stderr` optional and outside success determination.
- [ ] Implement one DELETE request to `/deduper/clear-db-table` with no body or query parameters.
- [ ] Construct the endpoint with `URL` and support base URLs with or without a trailing slash.
- [ ] Use `globalThis.fetch` in production and accept a small compatible request dependency for tests.
- [ ] Apply the configured 90-second limit with the Node abort API at the request boundary.
- [ ] Convert seconds to milliseconds only when creating the request timeout.
- [ ] Treat 409, 500, 504, and every other non-success status as a Phase 1 failure.
- [ ] Include the status and concise worker `error` value when available without dumping the full response.
- [ ] Distinguish HTTP rejection, invalid response data, connection failure, and timeout in error context.
- [ ] Preserve the original error as the cause when wrapping request failures.
- [ ] Do not log credentials or a complete worker URL that may contain sensitive components.
- [ ] Do not poll, retry, query the database, or reconcile an uncertain result.
- [ ] Return only the validated typed result on success.
- [ ] Add `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`.
- [ ] Test valid success, zero rows, malformed JSON, `cleared = false`, missing fields, wrong field types, invalid numeric values, and invalid job collections.
- [ ] Test the DELETE method, exact endpoint, trailing-slash behavior, 409, 500, 504, connection failure, timeout, and concise error extraction.
- [ ] Use deterministic request substitutes or controlled fixtures; do not contact worker-python.

### Phase 2 verification and closeout

- [ ] Run the complete ops test command, not only a single test file.
- [ ] Run the ops type check and clean production build.
- [ ] Confirm test output remains ignored and production output contains no tests or stale renamed files.
- [ ] Review error messages to confirm they are actionable and do not expose the configured worker URL.
- [ ] Record commands, versions, test counts, and results below.
- [ ] Commit only Phase 2 files and this todo update using the repository commit-message guidance.
- [ ] Review Phase 2 with the operator before beginning Phase 3.

### Phase 2 verification record

- Pending.

## Implementation phase 3: Coordinator integration and documentation

- [ ] Make `runCoordinator()` asynchronous and pass it `OpsConfig` from `index.ts`.
- [ ] Await `runCoordinator()` before draining and closing the logger.
- [ ] Pass the worker URL, timeout, and request dependency directly from the coordinator to Phase 1.
- [ ] Keep the default production request dependency as `globalThis.fetch`.
- [ ] Log Phase 1 start before issuing the request.
- [ ] Await the validated Phase 1 result.
- [ ] Log Phase 1 completion with `rowsDeleted`, `cancelledJobs`, and `cancellationRequestedJobs`.
- [ ] Replace the stub message with a message that execution stopped before unimplemented Phase 2.
- [ ] Allow every Phase 1 error to reach the existing top-level handler and produce a nonzero exit status.
- [ ] Confirm a failure never logs Phase 1 completion or the scaffold success boundary.
- [ ] Keep the next invocation starting from Phase 1; do not add retry or state inspection.
- [ ] Test coordinator success logging with a substituted request.
- [ ] Test that HTTP, invalid-response, connection, and timeout failures prevent completion logging and later work.
- [ ] Update `ops/README.md` with the real Phase 1 call sequence, success output, failure behavior, and safe rerun behavior.
- [ ] Document where a manual operator sees failure: terminal output, nonzero exit, and configured coordinator log.
- [ ] State that future systemd execution must expose the failed unit, journal entry, and application log before unattended rollout.
- [ ] Do not add systemd files or notification logic in this increment.

### Phase 3 verification and closeout

- [ ] Run the complete ops test command.
- [ ] Run the ops type check and clean production build.
- [ ] Confirm success logs contain validated counts and no stub completion claim remains.
- [ ] Confirm each tested failure returns a nonzero result and produces no Phase 1 completion message.
- [ ] Confirm generated test output remains ignored and absent from the commit.
- [ ] Record commands, versions, test counts, and results below.
- [ ] Commit only Phase 3 files and this todo update using the repository commit-message guidance.
- [ ] Review Phase 3 with the operator before beginning Phase 4.

### Phase 3 verification record

- Pending.

## Implementation phase 4: Local runtime verification

- [ ] Create a temporary controlled HTTP fixture outside the tracked source tree.
- [ ] Return the documented worker success shape from the fixture without accessing PostgreSQL.
- [ ] Run the development entry point against the fixture and confirm one DELETE request, Phase 1 completion, the Phase 2 boundary message, and a clean exit.
- [ ] Run the compiled entry point against the fixture and confirm the same behavior.
- [ ] Exercise a controlled non-success response and confirm a nonzero exit with no completion message.
- [ ] Exercise a controlled delayed response beyond a short test-specific timeout and confirm safe timeout failure without waiting 90 seconds.
- [ ] Verify invocation from both the repository root and `ops/` still resolves configuration and logs consistently.
- [ ] Run the complete ops test command, type check, and clean production build after the runtime checks.
- [ ] Confirm `ops/dist-test/` is ignored and `ops/dist/` contains no tests or stale modules.
- [ ] Remove temporary fixtures and logs created for verification.

### Phase 4 verification and closeout

- [ ] Record the fixture behavior, commands, Node version, exit statuses, and log results below.
- [ ] Record any verification that could not be completed; do not mark it successful.
- [ ] Update tracked docs only when the verification changes operator instructions.
- [ ] Commit only Phase 4 documentation or fixes and this todo update using the repository commit-message guidance.
- [ ] Review local readiness with the operator before contacting the development worker.

### Phase 4 verification record

- Pending.

## Implementation phase 5: Ubuntu development validation

- [ ] Confirm `nws-nn12dev` has the intended branch and commit before testing.
- [ ] Record the server's Node and npm versions and confirm Node 20 or newer.
- [ ] Confirm the intended Linux user, repository path, log path permissions, and ops environment file permissions.
- [ ] Confirm `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` targets the intended development worker without printing credentials.
- [ ] Confirm `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` is 90.
- [ ] Confirm the worker's database target is the intended development or disposable PostgreSQL database before invoking the clear endpoint.
- [ ] Run the ops test command, type check, and clean production build on the server.
- [ ] Confirm generated test output is ignored and absent from production `dist/`.
- [ ] Run the compiled weekly-flow-02 entry point under the intended user.
- [ ] Confirm the request reaches `DELETE /deduper/clear-db-table` and the process exits successfully only after a validated response.
- [ ] Record `rowsDeleted`, cancellation collections, worker timestamp, coordinator logs, and process exit status without recording secrets.
- [ ] Confirm `ArticleDuplicateAnalyses` still exists after clearing.
- [ ] Run the flow a second time and confirm a successful zero-row result when no new analyses were added.
- [ ] Confirm unrelated database data remains intact using an agreed non-destructive check.
- [ ] Confirm a Phase 1 failure is visible in the terminal, nonzero exit status, and configured coordinator log using a safe controlled failure when practical.
- [ ] Do not install or enable systemd units as part of this validation.

### Phase 5 verification and closeout

- [ ] Record server commands, versions, database target description, results, and limitations below.
- [ ] Distinguish operator-reported evidence from commands directly observed by the implementing agent.
- [ ] Record any unavailable concurrency or timeout validation as a limitation rather than success.
- [ ] Run final local ops tests, type checking, and clean production build if server validation causes code changes.
- [ ] Confirm the final diff contains no environment secrets, generated output, temporary logs, or unrelated archived-document changes.
- [ ] Commit only Phase 5 documentation or fixes and this todo update using the repository commit-message guidance.
- [ ] Review the completed Phase 1 increment with the operator before planning Phase 2.

### Phase 5 verification record

- Pending.

## Shared phase closeout

At the end of every implementation phase:

1. Run the tests, type checks, builds, and focused runtime checks applicable to that phase.
2. Fix failures without weakening required behavior or deleting meaningful tests.
3. Check `git status` and inspect the scoped diff before staging anything.
4. Confirm no `.env`, credential, generated output, temporary fixture, or unrelated operator change is staged.
5. Update this todo's completed checkboxes, verification record, `updated_at`, and `modified_by`.
6. Commit only the completed phase and its todo progress. Follow the root commit-message guidance, including the applicable co-author line.
7. Do not push unless the operator separately requests it.
8. Explain the completed increment and review the next phase with the operator before continuing.
