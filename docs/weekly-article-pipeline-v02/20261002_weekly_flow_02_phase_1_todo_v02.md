---
created_at: 2026-10-02T21:46:42Z
updated_at: 2026-10-02T22:06:11Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Todo V02

## Basis and scope

- Accepted plan: [Weekly Flow 02 Phase 1 Plan V04](20261002_weekly_flow_02_phase_1_plan_v04.md).
- Prior todo: [Weekly Flow 02 Phase 1 Todo V01](20261002_weekly_flow_02_phase_1_todo_v01.md).
- Todo assessment: [V01 Assessment by Claude](20261002_weekly_flow_02_phase_1_todo_v01_assessment_claude.md).
- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md).
- Codex is the todo creator. Claude is the assessor unless the operator reassigns either role.

This todo replaces the Phase 1 stub with a validated call to worker-python. It includes the existing source-file rename, configuration, focused tests, coordinator integration, documentation, and development-server verification.

This increment does not add Phase 2, direct database access, JSONL state, automatic retries, run persistence, systemd units, or notifications.

## Existing in-scope worktree changes

The operator has already made these uncommitted changes for this increment:

- Renamed `phases/clearDuplicateAnalyses.ts` to `phases/01_clearDuplicateAnalyses.ts`.
- Updated the coordinator import to the `01_` filename.
- Added the worker URL and request-timeout variables to `ops/.env.example` with a temporary 30-second value.

Treat these changes as in-scope operator work. Do not leave the rename split across commits or restore the old filename.

Phase 0 commits the complete rename, including the coordinator import and the existing formatting in that file. Phase 1 preserves the operator's `.env.example` additions while changing the accepted timeout value from 30 to 90 seconds.

## Working agreement

1. Implement one phase at a time and review its result before starting the next phase.
2. Keep control flow direct and names descriptive. Add comments only for intent or non-obvious behavior.
3. Preserve unrelated operator changes in the dirty worktree.
4. Do not include archived-document moves or unrelated files in implementation commits unless the operator directs it.
5. Check off only completed work and record verification results in this file.
6. Do not call the real worker endpoint from automated tests.
7. Do not advance past Phase 1 without a validated `cleared = true` response.
8. Confirm every expected compiled test file exists before running `node --test`.
9. Record the executed test files and test count at every phase closeout.

## Implementation phase 0: Adopt the filename rename

- [x] Review the existing deletion and addition to confirm they represent only the intended rename to `01_clearDuplicateAnalyses.ts`.
- [x] Confirm the renamed file still exports `clearDuplicateAnalyses` and retains the current stub behavior.
- [x] Confirm `coordinator.ts` imports `./phases/01_clearDuplicateAnalyses`.
- [x] Treat the existing quote-style formatting in `coordinator.ts` as part of this operator-authored baseline; do not rewrite it solely for style.
- [x] Search active ops source for imports or references to the old filename and update any remaining references.
- [x] Record that the operator-directed baseline commit included `ops/.env.example`; Phase 1 will change its timeout from 30 to 90.

### Phase 0 verification and closeout

- [x] Run the ops type check and production build using the currently available scripts.
- [x] Run the existing development and compiled scaffold entry points without adding a worker call.
- [x] Confirm both runs enter the renamed stub and exit cleanly.
- [x] Inspect the scoped diff and confirm the old file deletion, new file addition, and coordinator import move together.
- [x] Record commands, Node version, and results below.
- [x] Commit the rename, coordinator import, and todo baseline using the repository commit-message guidance.
- [x] Review the rename baseline with the operator before beginning Phase 1.

### Phase 0 verification record

- Baseline commit: `786d87d prepare weekly flow phase 1 implementation`.
- Node: v24.11.0 on macOS.
- `npm run typecheck --workspace newsnexus12-ops`: passed.
- `npm run build --workspace newsnexus12-ops`: passed.
- Development entry point: passed after allowing the existing tsx IPC socket requirement. Console output showed coordinator startup, renamed Phase 1 stub entry, and the scaffold stop message.
- Compiled entry point: passed with the same startup, stub-entry, and stop messages.
- Active source search found only the `01_clearDuplicateAnalyses` import. Git recorded the source change as a 100 percent rename.
- The operator requested that every existing change be committed before implementation. That baseline commit therefore included the current `.env.example` placeholder value of 30; Phase 1 remains responsible for changing it to 90.

## Implementation phase 1: Test and configuration foundation

- [x] Add `dist-test/` to `ops/.gitignore` while preserving the existing `logs/` rule.
- [x] Add `ops/tsconfig.test.json` extending the production TypeScript settings.
- [x] Configure the test build with `rootDir: "."`, `outDir: "dist-test"`, and includes for `src/**/*` and `tests/**/*`.
- [x] Exclude `dist`, `dist-test`, and `node_modules` from the test build.
- [x] Add the accepted `clean`, `clean:test`, and `test:build` scripts to `ops/package.json`.
- [x] Change the production `build` script to clean `dist/` before compiling.
- [x] For Phase 1, make `test` compile and run only `dist-test/tests/config.test.js`.
- [x] Do not list the Phase 2 test path before that source file exists.
- [x] Extend `OpsConfig` with `workerPythonBaseUrl` and `workerPythonRequestTimeoutSeconds`.
- [x] Extract pure `parseOpsConfig(env, baseDirectory)` configuration parsing.
- [x] Keep `loadConfig()` responsible only for dotenv loading and calling the pure parser with the real `opsDirectory`.
- [x] Preserve the `NODE_ENV=test` alias, environment precedence, and existing log rotation defaults.
- [x] Validate `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` as a required HTTP or HTTPS URL.
- [x] Validate `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` with a required-positive-integer parser.
- [x] Do not reuse the optional log-rotation integer parser for the required request timeout.
- [x] Resolve relative log paths against the explicit base directory supplied to `parseOpsConfig()`.
- [x] Add `ops/tests/config.test.ts` without reading `.env` or mutating shared `process.env`.
- [x] Test required values, accepted URLs, malformed URLs, rejected protocols, invalid timeout values, log defaults, the test environment alias, and explicit base-directory path resolution.
- [x] Preserve the operator-added variables in `ops/.env.example` and change `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` from 30 to 90.
- [x] Keep the operator's environment-specific `ops/.env` untracked and unchanged by implementation code.
- [x] Update `ops/README.md` with the variable names, units, validation, and relationship to worker-python's cancellation timeout.

### Phase 1 verification and closeout

- [x] Run `git check-ignore ops/dist-test/example.js` and confirm it succeeds.
- [x] Confirm `ops/dist-test/tests/config.test.js` exists after `test:build` before running tests.
- [x] Run the Phase 1 workspace test command and confirm only the configuration test file reports results.
- [x] Record the exact test count as the Phase 1 baseline.
- [x] Run the ops type check and clean production build.
- [x] Confirm no test files are emitted into `ops/dist/`.
- [x] Confirm the stale pre-rename `dist/weekly-flow-02/phases/clearDuplicateAnalyses.js` file is absent after the clean build.
- [x] Confirm `git status --short -- ops/dist-test` reports no generated files.
- [x] Record commands, versions, executed test file, test count, and results below.
- [x] Commit only Phase 1 files and this todo update using the repository commit-message guidance.
- [x] Review Phase 1 with the operator before beginning Phase 2.

### Phase 1 verification record

- Environment: macOS, Node v24.11.0, npm 11.6.1.
- `npm test --workspace newsnexus12-ops`: passed with only `dist-test/tests/config.test.js`; 11 tests passed in one suite.
- `npm run typecheck --workspace newsnexus12-ops`: passed.
- `npm run build --workspace newsnexus12-ops`: passed after the new clean step.
- `git check-ignore -v ops/dist-test/example.js`: matched `ops/.gitignore` line 2.
- The test build emitted only `config.test.js` and its source map under `dist-test/tests/`.
- Production `dist/` contains no test files. The stale unnumbered Phase 1 module was removed, and only `01_clearDuplicateAnalyses.js` remains.
- `git status --short -- ops/dist-test`: no output.
- The updated README temporary-log check passed with all required environment values supplied explicitly and did not contact worker-python.
- `ops/.env` remained ignored and unchanged. The tracked example timeout is now 90 seconds.

## Implementation phase 2: Phase result and worker request

- [x] Define a small typed successful result with `rowsDeleted`, `cancelledJobs`, `cancellationRequestedJobs`, and `timestamp`.
- [x] Keep runtime response input typed as `unknown` until validation succeeds.
- [x] Validate `cleared` as exactly `true`.
- [x] Validate `rowsDeleted` as a non-negative safe integer.
- [x] Validate both job collections as arrays containing strings only.
- [x] Validate `timestamp` as a non-empty string.
- [x] Keep `exitCode`, `stdout`, and `stderr` optional and outside success determination.
- [x] Implement one DELETE request to `/deduper/clear-db-table` with no body or query parameters.
- [x] Construct the endpoint with `URL` and support base URLs with or without a trailing slash.
- [x] Use `globalThis.fetch` in production and accept a small compatible request dependency for tests.
- [x] Apply the configured 90-second limit with the Node abort API at the request boundary.
- [x] Convert seconds to milliseconds only when creating the request timeout.
- [x] Treat 409, 500, 504, and every other non-success status as a Phase 1 failure.
- [x] Include the status and concise worker `error` value when available without dumping the full response.
- [x] Distinguish HTTP rejection, invalid response data, connection failure, and timeout in error context.
- [x] Preserve the original error as the cause when wrapping request failures.
- [x] Do not log credentials or a complete worker URL that may contain sensitive components.
- [x] Do not poll, retry, query the database, or reconcile an uncertain result.
- [x] Return only the validated typed result on success.
- [x] Add `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`.
- [x] Test valid success, zero rows, malformed JSON, `cleared = false`, missing fields, wrong field types, invalid numeric values, and invalid job collections.
- [x] Test the DELETE method, exact endpoint, trailing-slash behavior, 409, 500, 504, connection failure, timeout, and concise error extraction.
- [x] Use deterministic request substitutes or controlled fixtures; do not contact worker-python.
- [x] Update the `test` script only after creating the Phase 2 test file so it runs both explicit compiled paths.

### Phase 2 verification and closeout

- [x] Confirm both expected compiled test files exist before running `node --test`.
- [x] Run the complete ops test command and confirm both files report results.
- [x] Confirm the total test count is at least the recorded Phase 1 count plus the new Phase 2 tests.
- [x] Run the ops type check and clean production build.
- [x] Confirm test output remains ignored and production output contains no tests or stale renamed files.
- [x] Review error messages to confirm they are actionable and do not expose the configured worker URL.
- [x] Record commands, versions, executed test files, test count, and results below.
- [x] Commit only Phase 2 files and this todo update using the repository commit-message guidance.
- [x] Review Phase 2 with the operator before beginning Phase 3.

### Phase 2 verification record

- Environment: macOS, Node v24.11.0, npm 11.6.1.
- `npm test --workspace newsnexus12-ops`: passed with both explicit compiled test paths.
- Test result: 25 tests passed in three suites, up from the Phase 1 baseline of 11. The Phase 2 file contributed 14 tests in its response-parser and request suites.
- `npm run typecheck --workspace newsnexus12-ops`: passed.
- `npm run build --workspace newsnexus12-ops`: passed after cleaning production output.
- Both expected compiled test files existed before the test run. `git status --short -- ops/dist-test` produced no output.
- Production `dist/` contains the numbered stub and request module, no test files, and no stale unnumbered module.
- Tests covered 409, 500, 504, malformed success data, connection failure, and timeout without contacting worker-python on port 5000.
- HTTP error details are limited to 300 characters. Connection and timeout messages do not include the configured worker URL.

## Implementation phase 3: Coordinator integration and documentation

- [x] Make `runCoordinator()` asynchronous and pass it `OpsConfig` from `index.ts`.
- [x] Await `runCoordinator()` before draining and closing the logger.
- [x] Pass the worker URL, timeout, and request dependency directly from the coordinator to Phase 1.
- [x] Keep the default production request dependency as `globalThis.fetch`.
- [x] Log Phase 1 start before issuing the request.
- [x] Await the validated Phase 1 result.
- [x] Log Phase 1 completion with `rowsDeleted`, `cancelledJobs`, and `cancellationRequestedJobs`.
- [x] Replace the stub message with a message that execution stopped before unimplemented Phase 2.
- [x] Allow every Phase 1 error to reach the existing top-level handler and produce a nonzero exit status.
- [x] Confirm a failure never logs Phase 1 completion or the scaffold success boundary.
- [x] Keep the next invocation starting from Phase 1; do not add retry or state inspection.
- [x] Add coordinator success and failure cases to `01_clearDuplicateAnalyses.test.ts` so the explicit test-file list remains unchanged.
- [x] Test that HTTP, invalid-response, connection, and timeout failures prevent completion logging and later work.
- [x] Update `ops/README.md` with the real Phase 1 call sequence, success output, failure behavior, and safe rerun behavior.
- [x] Rewrite or retire the existing temporary-log scaffold check because the new configuration is required and the flow performs a real DELETE.
- [x] If a runnable README check remains, require a controlled local fixture and explicit environment values; never let it fall back to the worker URL in `ops/.env`.
- [x] Document where a manual operator sees failure: terminal output, nonzero exit, and configured coordinator log.
- [x] State that future systemd execution must expose the failed unit, journal entry, and application log before unattended rollout.
- [x] Do not add systemd files or notification logic in this increment.

### Phase 3 verification and closeout

- [x] Confirm both expected compiled test files exist before running tests.
- [x] Run the complete ops test command and confirm both files report results.
- [x] Confirm the test count is not lower than the Phase 2 count and includes the new coordinator cases.
- [x] Run the ops type check and clean production build.
- [x] Confirm success logs contain validated counts and no stub completion claim remains.
- [x] Confirm each tested failure produces no Phase 1 completion message.
- [x] Confirm generated test output remains ignored and absent from the commit.
- [x] Record commands, versions, executed test files, test count, and results below.
- [x] Commit only Phase 3 files and this todo update using the repository commit-message guidance.
- [x] Review Phase 3 with the operator before beginning Phase 4.

### Phase 3 verification record

- Environment: macOS, Node v24.11.0, npm 11.6.1.
- `npm test --workspace newsnexus12-ops`: passed with both explicit compiled test paths.
- Test result: 27 tests passed in four suites, up from the Phase 2 total of 25. The two new coordinator cases cover success and four failure categories.
- `npm run typecheck --workspace newsnexus12-ops`: passed.
- `npm run build --workspace newsnexus12-ops`: passed after cleaning production output.
- Both expected compiled test files existed. The success case recorded validated counts and job collections before the Phase 2 boundary message.
- HTTP, invalid-response, connection, and timeout cases logged Phase 1 failure and produced no Phase 1 completion or Phase 2 boundary message.
- `git status --short -- ops/dist-test` produced no output. Generated test output remained ignored, and production output contained no tests or stale unnumbered module.
- The README scaffold command was retired because the entry point now performs the real DELETE. Automated verification uses injected request substitutes and does not contact worker-python.

## Implementation phase 4: Local runtime verification

- [x] Create a temporary controlled HTTP fixture outside the tracked source tree.
- [x] Return the documented worker success shape from the fixture without accessing PostgreSQL.
- [x] Run the development entry point against the fixture and confirm one DELETE request, Phase 1 completion, the Phase 2 boundary message, and a clean exit.
- [x] Run the compiled entry point against the fixture and confirm the same behavior.
- [x] Exercise a controlled non-success response and confirm a nonzero exit with no completion message.
- [x] Exercise a controlled delayed response beyond a one-second test timeout and confirm safe timeout failure without waiting 90 seconds.
- [x] Supply every required environment variable explicitly for fixture checks; do not read the worker URL from `ops/.env`.
- [x] Verify invocation from both the repository root and `ops/` still resolves configuration and logs consistently.
- [x] Run the complete ops test command, type check, and clean production build after runtime checks.
- [x] Confirm both expected test files ran and the count did not drop below the Phase 3 count.
- [x] Confirm `ops/dist-test/` is ignored and `ops/dist/` contains no tests or stale modules.
- [x] Remove temporary fixtures and logs created for verification.

### Phase 4 verification and closeout

- [x] Record fixture behavior, commands, Node version, exit statuses, executed test files, test count, and log results below.
- [x] Record any verification that could not be completed; do not mark it successful.
- [x] Update tracked docs only when verification changes operator instructions.
- [x] Commit only Phase 4 documentation or fixes and this todo update using the repository commit-message guidance.
- [ ] Review local readiness with the operator before contacting the development worker.

### Phase 4 verification record

- Environment: macOS, Node v24.11.0, npm 11.6.1.
- A temporary Node HTTP fixture listened on `127.0.0.1:51234`. It recorded four requests, each using `DELETE /deduper/clear-db-table`, and did not access PostgreSQL.
- The development entry point ran from the repository root with explicit environment values. It logged `rowsDeleted=4`, both fixture job collections, the worker timestamp, and the Phase 2 boundary before exiting with status 0.
- The compiled entry point ran from `ops/` with explicit environment values and produced the same success result with exit status 0.
- The controlled HTTP 500 run exited with status 1. Its terminal and application log contained `failureCategory=http` and no Phase 1 completion or Phase 2 boundary.
- The delayed response exceeded the explicit one-second timeout. The run failed after about one second with status 1, `failureCategory=timeout`, and an unverified-outcome message.
- Every runtime command supplied all required settings explicitly. No command used the worker URL or other values from `ops/.env`, and worker-python on port 5000 was not contacted.
- `npm test --workspace newsnexus12-ops`: 27 tests passed across both compiled test files and four suites.
- `npm run typecheck --workspace newsnexus12-ops` and `npm run build --workspace newsnexus12-ops`: passed.
- Test output remained ignored. Production output contained no tests or stale unnumbered module.
- The temporary fixture, mode file, request record, and application logs were removed. No additional operator documentation changes were needed.

## Implementation phase 5: Ubuntu development validation

- [ ] Confirm `nws-nn12dev` has the intended branch and commit before testing.
- [ ] Record the server's Node and npm versions and confirm Node 20 or newer.
- [ ] Confirm the intended Linux user, repository path, log path permissions, and ops environment file permissions.
- [ ] Confirm `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` targets the intended development worker without printing credentials.
- [ ] Confirm `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` is 90.
- [ ] Confirm the worker's database target is the intended development or disposable PostgreSQL database before invoking the clear endpoint.
- [ ] Run the ops test command, type check, and clean production build on the server.
- [ ] Confirm both expected compiled test files report results and record the test count.
- [ ] Confirm generated test output is ignored and absent from production `dist/`.
- [ ] Run the compiled weekly-flow-02 entry point under the intended user.
- [ ] Confirm the request reaches `DELETE /deduper/clear-db-table` and exits successfully only after a validated response.
- [ ] Record `rowsDeleted`, cancellation collections, worker timestamp, coordinator logs, and exit status without recording secrets.
- [ ] Confirm `ArticleDuplicateAnalyses` still exists after clearing.
- [ ] Run the flow a second time and confirm a successful zero-row result when no new analyses were added.
- [ ] Confirm unrelated database data remains intact using an agreed non-destructive check.
- [ ] Confirm a Phase 1 failure is visible in the terminal, nonzero exit status, and configured coordinator log using a safe controlled failure when practical.
- [ ] Do not install or enable systemd units as part of this validation.

### Phase 5 verification and closeout

- [ ] Record server commands, versions, database target description, test count, results, and limitations below.
- [ ] Distinguish operator-reported evidence from commands directly observed by the implementing agent.
- [ ] Record unavailable concurrency or timeout validation as a limitation rather than success.
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
5. Confirm every expected compiled test path exists before relying on the test result.
6. Record the test files and count, comparing them with the previous phase when applicable.
7. Update this todo's completed checkboxes, verification record, `updated_at`, and `modified_by`.
8. Commit only the completed phase and its todo progress. Follow the root commit-message guidance, including the applicable co-author line.
9. Do not push unless the operator separately requests it.
10. Explain the completed increment and review the next phase with the operator before continuing.
