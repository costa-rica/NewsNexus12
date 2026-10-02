---
created_at: 2026-10-02T21:41:33Z
updated_at: 2026-10-02T21:41:33Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Plan V04

## Purpose

- Replace the Phase 1 logging stub with a working call to worker-python.
- Clear `ArticleDuplicateAnalyses` through `DELETE /deduper/clear-db-table`.
- Confirm the operation completed before the coordinator can advance.
- Keep this increment small, readable, and independent of direct database access.

## Basis and scope

- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Prior plan: [Weekly Flow 02 Phase 1 Plan V03](20261002_weekly_flow_02_phase_1_plan_v03.md).
- Assessment: [V03 Assessment by Claude](20261002_weekly_flow_02_phase_1_plan_v03_assessment_claude.md).
- Endpoint requirements: [Worker Python Deduper Clear PRD V01](../archive/202610/20261001_worker_python_deduper_clear_prd_v01.md).
- Endpoint implementation record: [Worker Python Deduper Clear Todo V01](../archive/202610/20261001_worker_python_deduper_clear_todo_v01.md).
- Existing coordinator scaffold: [Weekly Pipeline Coordinator Scaffold Todo V01](../archive/202610/20261001_ops_coordinator_scaffold_todo_v01.md).

This plan covers the working Phase 1 module and the coordinator changes required to await it. It does not add Phase 2, scheduling, notifications, run continuation, or durable run persistence.

## Decisions incorporated through V04

1. Use `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` for the worker-python base URL.
2. Use `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS=90` for the overall client request timeout.
3. Stop the run after every failed, timed-out, or unverified Phase 1 request.
4. Do not retry or inspect the database automatically after a failure.
5. Allow the next operator or scheduler invocation to begin again at Phase 1.
6. Use a pure configuration parser with an explicit base directory.
7. Use a separate Node test build with explicit test paths compatible with Node 20.
8. Add `dist-test/` to `ops/.gitignore` before generating compiled tests.
9. Keep supporting endpoint and scaffold documents archived for now.

The operator reports that both environment variables have been added to the local `ops/.env`. The implementation must still add parsing, validation, and safe examples to tracked files.

## Inside-out implementation direction

Build the phase from its result and failure rules outward to HTTP and configuration.

1. Define the successful Phase 1 result used by the coordinator.
2. Validate unknown endpoint data before treating it as a result.
3. Test the result and validation rules with `node:test`.
4. Add the HTTP call that obtains the endpoint data.
5. Add pure configuration parsing and dotenv-backed loading.
6. Pass worker settings and the request dependency through the coordinator.
7. Verify isolated behavior before calling the real development worker.

This order lets the internal contract stabilize before transport details spread through the coordinator.

## Phase result

The phase returns a typed result containing the information needed by the coordinator and future run persistence:

- `rowsDeleted`: a non-negative integer.
- `cancelledJobs`: an array of worker job IDs.
- `cancellationRequestedJobs`: an array of worker job IDs that received a cancellation request.
- `timestamp`: the worker timestamp for the completed clear.

The phase completes only when all of these conditions are true:

1. The worker returns an HTTP success status.
2. The response is valid JSON with the required fields.
3. `cleared` is exactly `true`.
4. `rowsDeleted` is a non-negative integer.
5. Job collections contain strings only.

The endpoint's `stdout`, `stderr`, and `exitCode` remain transport details unless they provide useful failure context. The coordinator does not parse human-readable output to determine success.

## Worker request

- Read the worker base URL from `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`.
- Send one plain `DELETE` request to `/deduper/clear-db-table`.
- Do not send a request body or add query parameters.
- Await the response because worker-python performs cancellation, waiting, and deletion before responding.
- Do not poll a job endpoint. The clear operation does not return a job ID for later monitoring.
- Use the built-in Node `fetch` implementation instead of adding an HTTP dependency.
- Construct the endpoint with `URL` so base URLs with or without a trailing slash behave consistently.

Read the overall request timeout from `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`. The configured value is 90 seconds and is converted to milliseconds only at the request boundary.

Worker-python's `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` limits only cancellation waiting and defaults to 30 seconds. Database connection, deletion, and response delivery occur outside that limit.

The ops timeout must remain longer than the worker cancellation limit plus expected deletion and response time. Deployment documentation tells the operator to review both settings together when either value changes.

Worker-python has no overall deadline for this endpoint. The 90-second ops timeout is the overall limit observed by the coordinator.

## Failure and rerun behavior

- Treat every non-success HTTP status as a Phase 1 failure.
- Treat malformed JSON or an invalid success body as a Phase 1 failure.
- Treat a client timeout or lost connection as an unverified failure.
- Stop the run after every Phase 1 failure and return a nonzero process exit status.
- Do not start Phase 2 or any backup without a validated `cleared = true` response.
- Do not retry automatically or inspect the table automatically after a failure.

The next run starts again at Phase 1 without a manual outcome check. Repeating the clear request is safe because the operation is idempotent and guarded by worker-python:

1. If the earlier delete completed, the next clear succeeds with `rowsDeleted: 0` unless new analyses were added.
2. If the earlier request did not delete, the next clear performs the deletion normally.
3. If the earlier clear is still active, the worker returns 409 and the new run stops without performing a competing deletion.

A rerun is not guaranteed to succeed. A new deduper job, slow worker, slow database, or repeated transport problem may cause another failure. Every such failure stops the run under the same rules.

## Error reporting

- Include the HTTP status and the worker's concise `error` value when available.
- Distinguish a client timeout from an HTTP rejection and invalid response data.
- Preserve the original error as the cause when wrapping it with Phase 1 context.
- Limit response details in errors and logs so an unexpected response cannot produce excessive output.
- Never log credentials or the full worker base URL when it may contain sensitive components.

During manual execution, the operator sees the top-level error and nonzero exit in the terminal. The structured Phase 1 error is also written according to the configured logger environment.

When systemd scheduling is added later, a nonzero exit must mark the service failed. The operator will use the unit status, journal, and coordinator log to see the failure. Alert delivery is required before unattended rollout but is outside this Phase 1 increment.

## Configuration design

Extend `OpsConfig` with:

- `workerPythonBaseUrl`, sourced from required `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`.
- `workerPythonRequestTimeoutSeconds`, sourced from required `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`.

Split configuration into two responsibilities:

1. `loadConfig()` loads `ops/.env` while preserving process-supplied values, then calls the pure parser with `opsDirectory`.
2. `parseOpsConfig(env, baseDirectory)` returns a validated `OpsConfig` without reading files or changing `process.env`.

The explicit base directory keeps relative path resolution independent of the compiled module location. Production passes the real ops directory. Tests pass a fixed temporary or fixture path.

Tests call `parseOpsConfig()` with complete test objects. They do not call dotenv, read the operator's `.env`, or share mutable environment state.

Validate the base URL and accept only `http:` or `https:`. Validate the request timeout with a new required-positive-integer parser.

Do not reuse the log-rotation helper for the request timeout. Missing log rotation values continue to default to five; a missing request timeout is an error.

Update `ops/.env.example` and `ops/README.md` with both variable names, the 90-second value, units, and a safe local URL. Document the relationship to `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` without copying environment-specific values.

## Runtime dependency flow

Keep dependency passing direct and visible:

1. `index.ts` loads `OpsConfig`, creates the logger, and calls the coordinator with both.
2. `runCoordinator()` passes the worker URL, timeout, and request function to Phase 1.
3. `clearDuplicateAnalyses()` performs the request, validates the response, and returns the typed result.

Production uses `globalThis.fetch`. Tests provide a small compatible request function through the coordinator or phase boundary.

Do not add a dependency-injection framework or a generic worker client. The request seam exists only to keep Phase 1 and coordinator behavior deterministic in tests.

## Code structure

Use the shared `01_` prefix when Phase 1 needs more than one file.

- `src/weekly-flow-02/phases/01_clearDuplicateAnalyses.ts` owns the public phase function and readable control flow.
- A second `01_` source file may own runtime response validation if the main operation becomes hard to scan.
- `src/weekly-flow-02/coordinator.ts` awaits the phase and logs completion only after validation succeeds.
- `src/weekly-flow-02/index.ts` awaits the coordinator and retains top-level failure handling and logger shutdown.
- `tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts` covers Phase 1 and coordinator behavior.
- `tests/config.test.ts` covers the pure configuration parser and explicit base directory.

Avoid a generic pipeline framework, reusable retry layer, or broad worker client. Add shared abstractions later only when another phase demonstrates the same need.

## Test build and commands

Use Node's built-in `node:test` and `node:assert` modules. Do not add Jest, Vitest, or another test dependency.

Add `ops/tsconfig.test.json` with these boundaries:

- Extend the production TypeScript settings.
- Set `rootDir` to `.` and `outDir` to `dist-test`.
- Include `src/**/*` and `tests/**/*`.
- Exclude `dist`, `dist-test`, and `node_modules`.

Keep tests outside `src/` so the production `tsconfig.json` does not compile them into `dist/`.

Add `dist-test/` to `ops/.gitignore` before running the test build. Keep the existing `logs/` rule.

Add these exact workspace scripts:

```json
{
  "clean": "node -e \"require('node:fs').rmSync('dist', { recursive: true, force: true })\"",
  "build": "npm run clean && tsc -p tsconfig.json",
  "clean:test": "node -e \"require('node:fs').rmSync('dist-test', { recursive: true, force: true })\"",
  "test:build": "npm run clean:test && tsc -p tsconfig.test.json",
  "test": "npm run test:build && node --test dist-test/tests/config.test.js dist-test/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.js"
}
```

Explicit paths avoid Node version-dependent glob behavior and prevent discovery of TypeScript source files. Cleaning both output directories prevents renamed or deleted compiled files from remaining active.

This design supports the repository's declared Node 20 minimum. Confirm the actual Node version on `nws-nn12dev` during validation and record it with the results.

The generated `dist-test/` directory is ignored through `ops/.gitignore` and is not deployed as production runtime output.

## Coordinator behavior and logging

The coordinator call sequence becomes:

1. Log weekly pipeline startup.
2. Log Phase 1 start.
3. Await the clear request and validation.
4. Log Phase 1 completion with `rowsDeleted`, `cancelledJobs`, and `cancellationRequestedJobs`.
5. Stop at the existing scaffold boundary until Phase 2 is implemented.

On failure, the error reaches the existing top-level handler, the process exits unsuccessfully, and Phase 2 does not run.

The final scaffold-boundary message says that execution stopped before Phase 2. It no longer describes Phase 1 as a stub after the real request succeeds.

## Persistence boundary

- Do not add `WeeklyArticleFlowRuns02` in this increment.
- Do not write temporary JSONL state.
- Return typed data and record useful values in the coordinator log.
- Use response fixtures in tests to refine the future persistence shape.

Add the run table before implementing cross-phase continuation and automated recovery. Its design should use evidence from completed phase integrations rather than a temporary file contract.

## Verification approach

1. Add focused response tests:
   - Valid successful response, including zero rows deleted.
   - `cleared = false` in an HTTP success response.
   - Missing, incorrectly typed, and invalid numeric fields.
   - Invalid job-ID collections and malformed JSON.
2. Add focused request and coordinator tests:
   - Correct DELETE method and URL.
   - Base URL behavior with and without a trailing slash.
   - Successful result and completion logging.
   - Worker 409, 500, and 504 responses.
   - Client timeout and connection failure.
   - No completion logging or later phase work after failure.
3. Add focused pure configuration tests:
   - Required worker URL and timeout.
   - Accepted HTTP and HTTPS URLs.
   - Rejected protocols and malformed URLs.
   - Rejected zero, negative, fractional, and nonnumeric timeout values.
   - Unchanged log rotation defaults.
   - Relative log paths resolved against the supplied base directory.
4. Run the ops test command, type checking, and clean production build.
5. Confirm tests are absent from `dist/` and stale renamed files are absent after building.
6. Confirm `git check-ignore ops/dist-test/example.js` succeeds.
7. Confirm `git status --short -- ops/dist-test` reports no generated files.
8. Run development and compiled entry points against a controlled HTTP fixture.
9. Run against worker-python on `nws-nn12dev` after confirming its database target and endpoint deployment.
10. Record the server's Node version, response, logs, exit status, deleted-row count, preserved table, and a second successful clear returning zero rows.

The real endpoint check is destructive to duplicate-analysis rows. Use the intended development database or a disposable database, never an assumed target.

## Completion boundary

Phase 1 is ready when:

- The coordinator makes and awaits the real DELETE request.
- Only a validated `cleared = true` response counts as completion.
- Failure and timeout outcomes stop the flow with a nonzero exit status.
- A later invocation can safely begin again at Phase 1 without automatic reconciliation.
- The result is logged without direct database or JSONL persistence.
- Focused tests, type checking, clean compilation, and controlled runtime checks pass.
- Generated test output remains ignored and absent from commits.
- The Ubuntu development run confirms the endpoint and configuration under the intended service user.

Implementation requires a separate task-style todo after this plan is reviewed under [Plan and Vet](../PLAN_AND_VET.md).
