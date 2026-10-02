---
created_at: 2026-10-02T21:21:44Z
updated_at: 2026-10-02T21:21:44Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Plan V02

## Purpose

- Replace the Phase 1 logging stub with a working call to worker-python.
- Clear `ArticleDuplicateAnalyses` through `DELETE /deduper/clear-db-table`.
- Confirm the operation completed before the coordinator can advance.
- Keep this increment small, readable, and independent of direct database access.

## Basis and scope

- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Operator decisions: [Weekly Flow 02 Phase 1 Plan V01](20261002_weekly_flow_02_phase_1_plan_v01.md).
- Endpoint requirements: [Worker Python Deduper Clear PRD V01](../archive/202610/20261001_worker_python_deduper_clear_prd_v01.md).
- Endpoint implementation record: [Worker Python Deduper Clear Todo V01](../archive/202610/20261001_worker_python_deduper_clear_todo_v01.md).
- Existing coordinator scaffold: [Weekly Pipeline Coordinator Scaffold Todo V01](../archive/202610/20261001_ops_coordinator_scaffold_todo_v01.md).

This plan covers the working Phase 1 module and the coordinator changes required to await it. It does not add Phase 2, scheduling, retries, run continuation, or durable run persistence.

## Decisions incorporated in V02

1. Use `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` for the worker-python base URL.
2. Use `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS=30` for the client request timeout.
3. Use Node's built-in `node:test` runner for focused ops tests.
4. Keep the supporting endpoint and scaffold documents archived for now.

The operator reports that both environment values have already been added to the local `ops/.env`. The implementation must still add parsing, validation, and safe examples to the tracked files.

## Inside-out implementation direction

Build the phase from its result and failure rules outward to HTTP and configuration.

1. Define the successful Phase 1 result used by the coordinator.
2. Validate unknown endpoint data before treating it as a result.
3. Test the result and validation rules with `node:test`.
4. Add the HTTP call that obtains the endpoint data.
5. Add configuration parsing for the worker address and client timeout.
6. Connect the asynchronous phase to the coordinator.
7. Verify the isolated behavior before calling the real development worker.

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

The request timeout is read from `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`. The configured value is 30 seconds and is converted to milliseconds only at the request boundary.

The client timeout equals worker-python's default 30-second deduper cancellation limit. Either side may reach its deadline first. The client may therefore abort before receiving a worker 504 response.

An aborted request has an unverified outcome because worker-python may still finish the operation. The coordinator stops, reports the uncertainty, and does not retry automatically.

## Response and error handling

- Treat every non-success HTTP status as a phase failure.
- Include the HTTP status and the worker's concise `error` value when available.
- Treat malformed JSON or an invalid success body as a phase failure.
- Distinguish a client timeout from an HTTP rejection and invalid response data.
- Preserve the original error as the cause when wrapping it with Phase 1 context.
- Limit response details placed in errors and logs so an unexpected worker response cannot produce excessive output.
- Never report completion or allow Phase 2 to start after an uncertain result.

No automatic retry belongs in this increment. A timeout or lost connection creates an ambiguous result that must be checked before another destructive request is sent.

## Configuration

Extend `OpsConfig` with:

- `workerPythonBaseUrl`, sourced from required `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`.
- `workerPythonRequestTimeoutSeconds`, sourced from required `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`.

Validate the base URL during startup and accept only `http:` or `https:`. Validate the timeout as a positive integer. Do not silently replace a missing or invalid value with a default.

Keep environment-specific hostnames and ports in `ops/.env`; do not place server addresses in source code. Existing process environment values continue to take priority over `.env`.

Update `ops/.env.example` and `ops/README.md` with both variable names, units, and a local example. Do not copy the operator's environment-specific value into tracked documentation.

## Code structure

Keep the implementation explicit and small. Use the shared `01_` prefix when Phase 1 needs more than one file.

- `01_clearDuplicateAnalyses.ts` owns the public phase function and readable control flow.
- A second `01_` file may own runtime response validation if keeping it in the phase file makes the main operation harder to scan.
- Focused Phase 1 tests use the same prefix and sit near the code.
- `coordinator.ts` awaits the phase result and logs completion only after validation succeeds.
- `index.ts` awaits the coordinator and retains its existing top-level failure handling and logger shutdown.

Avoid a generic pipeline framework, reusable retry layer, or broad worker client. Add shared abstractions later only when another phase demonstrates the same need.

## Test runner

- Use Node's built-in `node:test` and `node:assert` modules.
- Do not add Jest, Vitest, or another test dependency to ops.
- Compile TypeScript test files with the existing ops TypeScript build.
- Run the generated JavaScript tests with `node --test` through an ops workspace script.
- Keep HTTP tests deterministic by substituting the request dependency or using a controlled local fixture.
- Do not call the real development worker from the automated test command.

## Coordinator behavior and logging

The coordinator call sequence becomes:

1. Log weekly pipeline startup.
2. Log Phase 1 start.
3. Await the clear request and validation.
4. Log Phase 1 completion with `rowsDeleted`, `cancelledJobs`, and `cancellationRequestedJobs`.
5. Stop at the existing scaffold boundary until Phase 2 is implemented.

On failure, the error reaches the existing top-level handler, the process exits unsuccessfully, and Phase 2 does not run. Logs identify Phase 1 and the failure category without exposing credentials or dumping full response bodies.

The final scaffold-boundary message says that execution stopped before Phase 2. It no longer describes Phase 1 as a stub after the real request succeeds.

## Persistence boundary

- Do not add `WeeklyArticleFlowRuns02` in this increment.
- Do not write temporary JSONL state.
- Return typed data and record the useful values in the coordinator log.
- Use response fixtures in tests to refine the future persistence shape.

Add the run table before implementing cross-phase continuation and automated recovery. Its design should use evidence from completed phase integrations rather than a temporary file contract.

## Verification approach

1. Add focused validation tests:
   - Valid successful response, including zero rows deleted.
   - `cleared = false` in an HTTP success response.
   - Missing, incorrectly typed, and invalid numeric fields.
   - Invalid job-ID collections and malformed JSON.
2. Add focused request tests:
   - Correct HTTP method and URL.
   - Base URL behavior with and without a trailing slash.
   - Successful result propagation.
   - Worker 409, 500, and 504 responses.
   - Client timeout and connection failure.
   - Confirmation that failures prevent completion logging and later phase work.
3. Add focused configuration tests:
   - Required worker URL and timeout.
   - Accepted HTTP and HTTPS URLs.
   - Rejected protocols and malformed URLs.
   - Rejected zero, negative, fractional, and nonnumeric timeout values.
4. Run the ops test command, type checking, and compilation.
5. Run the development and compiled entry points against a controlled HTTP fixture.
6. Run against worker-python on `nws-nn12dev` only after confirming its database target and endpoint deployment.
7. Verify the real response, logs, process exit status, deleted-row count, preserved table, and a second successful clear returning zero rows.

The real endpoint check is destructive to duplicate-analysis rows. Use the intended development database or a disposable database, never an assumed target.

## Completion boundary

Phase 1 is ready when:

- The coordinator makes and awaits the real DELETE request.
- Only a validated `cleared = true` response counts as completion.
- Failure and timeout outcomes stop the flow with a nonzero exit status.
- The result is logged without direct database or JSONL persistence.
- Focused tests, type checking, compilation, and controlled runtime checks pass.
- The Ubuntu development run confirms the endpoint and configuration work under the intended service user.

Implementation should follow a separate task-style todo after this plan is reviewed under [Plan and Vet](../PLAN_AND_VET.md).
