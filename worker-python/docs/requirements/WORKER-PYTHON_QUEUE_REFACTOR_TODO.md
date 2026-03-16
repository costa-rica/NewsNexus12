# Worker-Python Queue Refactor TODO

This checklist breaks the refactor into phases so engineers can move from the current deduper-specific in-memory job manager toward a worker-node-style queue contract backed by a JSON file at `PATH_UTILTIES/worker-python/queue-jobs.json`.

Testing guidance for every phase should follow the spirit of `docs/TEST_IMPLEMENTATION_NODE.md`, adapted to the existing `worker-python` `pytest` stack:

1. test behavior and contract, not internal implementation details
2. keep tests deterministic by mocking boundaries such as filesystem and workflow runners when those are not the subject of the test
3. keep route tests thin and focused on request, response, and key side effects
4. use temporary directories and files for queue-store tests
5. keep env setup explicit in each suite
6. cover a happy path and at least one failure path per new route or module

Recommended test layout for this refactor:

1. `tests/unit/queue/`
   - queue store
   - queue ID generation
   - queue engine
   - queue status helpers
2. `tests/integration/`
   - queue-info route behavior with FastAPI test client
   - workflow route enqueue behavior
3. `tests/contracts/`
   - stable response contracts for queue-info endpoints when they become part of the service contract

## Phase 1. Define the queue record contract and JSON store path

- [ ] Add `PATH_UTILTIES` startup validation for worker-python.
- [ ] Define the resolved queue store target path as `PATH_UTILTIES/worker-python/queue-jobs.json`.
- [ ] Document the queue record shape in code comments or module docs:
  - `jobId`
  - `endpointName`
  - `status`
  - `createdAt`
  - `startedAt`
  - `endedAt`
  - `failureReason`
  - optional `logs`
  - optional `parameters`
- [ ] Define status vocabulary aligned to the portal and worker-node pattern:
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `canceled`
- [ ] Define `jobId` as a string field, not an integer field.
- [ ] Define the human-readable `jobId` format as 4-digit zero-padded strings such as `0001`.
- [ ] Define overflow behavior so IDs continue past `9999` as wider strings rather than rolling over.

Tests to implement in this phase:

- [ ] Add a unit test file for queue path resolution and startup validation.
- [ ] Add unit tests that validate accepted status values.
- [ ] Add unit tests that validate the `jobId` formatting rules and overflow behavior.
- [ ] Add at least one failure-path test for missing `PATH_UTILTIES`.

Suggested test files:

1. `tests/unit/queue/test_queue_config.py`
2. `tests/unit/queue/test_queue_types.py`
3. `tests/unit/queue/test_job_id_generation.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/queue/test_queue_config.py tests/unit/queue/test_queue_types.py tests/unit/queue/test_job_id_generation.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 1 changes before starting Phase 2.

## Phase 2. Build the JSON queue store

- [ ] Create a queue store module responsible for initializing, reading, and writing `queue-jobs.json`.
- [ ] Ensure the store creates the `worker-python` subdirectory under `PATH_UTILTIES` when missing.
- [ ] Ensure the store creates an empty `queue-jobs.json` file when missing.
- [ ] Implement serialized writes to avoid concurrent write corruption.
- [ ] Implement atomic file replacement behavior for updates.
- [ ] Implement methods to:
  - load all jobs
  - append a job
  - update a job by `jobId`
  - fetch a job by `jobId`
  - fetch the latest job by `endpointName`
- [ ] Decide and implement queue file shape:
  - single array of jobs
  - or object wrapper with metadata plus jobs array
- [ ] Add a bounded retention policy or define that pruning is deferred to a later phase.

Tests to implement in this phase:

- [ ] Add unit tests for first-run initialization with an empty temp directory.
- [ ] Add unit tests for append and update behavior.
- [ ] Add unit tests for latest-job lookup by `endpointName`.
- [ ] Add unit tests for atomic update behavior at the store boundary.
- [ ] Add at least one failure-path test for invalid JSON or unreadable file state.

Suggested test files:

1. `tests/unit/queue/test_job_store.py`
2. `tests/unit/queue/test_job_store_latest_job.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/queue/test_job_store.py tests/unit/queue/test_job_store_latest_job.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 2 changes before starting Phase 3.

## Phase 3. Build the queue engine

- [ ] Create a queue engine that separates enqueueing and execution from workflow-specific logic.
- [ ] Ensure queued jobs transition through:
  - `queued`
  - `running`
  - terminal state
- [ ] Implement generation of 4-digit zero-padded string `jobId` values using the JSON store.
- [ ] Ensure the engine persists lifecycle transitions back to `queue-jobs.json`.
- [ ] Implement single-job lookup by `jobId`.
- [ ] Implement latest-job lookup by `endpointName`.
- [ ] Implement queue summary generation for queued and running jobs.
- [ ] Implement cancellation for:
  - queued jobs
  - running jobs using cooperative cancellation
- [ ] Define restart behavior for jobs left in `queued` or `running` state after process restart.

Tests to implement in this phase:

- [ ] Add unit tests for enqueue behavior and initial `queued` status.
- [ ] Add unit tests for running and completion transitions.
- [ ] Add unit tests for failure transitions with `failureReason`.
- [ ] Add unit tests for queued-job cancel behavior.
- [ ] Add unit tests for running-job cancel-request behavior.
- [ ] Add unit tests for latest-job lookup through the queue engine.
- [ ] Add unit tests for queue summary behavior.

Suggested test files:

1. `tests/unit/queue/test_queue_engine.py`
2. `tests/unit/queue/test_queue_status.py`
3. `tests/unit/queue/test_queue_cancellation.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/queue/test_queue_engine.py tests/unit/queue/test_queue_status.py tests/unit/queue/test_queue_cancellation.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 3 changes before starting Phase 4.

## Phase 4. Add queue-info routes

- [ ] Add a dedicated queue-info route module.
- [ ] Add `GET /queue-info/check-status/{jobId}`.
- [ ] Add `GET /queue-info/latest-job`.
- [ ] Add `GET /queue-info/queue-status`.
- [ ] Add `POST /queue-info/cancel-job/{jobId}`.
- [ ] Validate required route and query parameters.
- [ ] Return stable JSON response shapes that match the intended API proxy contract.
- [ ] Mount the queue-info router in `src/main.py`.
- [ ] Decide whether route naming should fully match worker-node or remain Python-style with minimal variation. Favor matching worker-node unless a framework constraint prevents it.

Tests to implement in this phase:

- [ ] Add integration tests for each queue-info route using the FastAPI test client.
- [ ] Add success-path and failure-path coverage for missing job IDs and missing `endpointName`.
- [ ] Add contract tests for stable response shape on:
  - latest-job
  - check-status
  - queue-status
  - cancel-job

Suggested test files:

1. `tests/integration/test_queue_info_routes.py`
2. `tests/contracts/test_queue_info_contract.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/integration/test_queue_info_routes.py tests/contracts/test_queue_info_contract.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 4 changes before starting Phase 5.

## Phase 5. Migrate deduper onto the shared queue infrastructure

- [ ] Refactor deduper job creation to use the shared queue engine instead of the current in-memory-only `job_manager` flow.
- [ ] Assign a stable workflow identifier for deduper, for example `/deduper/start-job` or another final endpoint name chosen by the team.
- [ ] Preserve existing deduper behavior where needed while routing storage and lifecycle updates through the new queue store.
- [ ] Ensure deduper cancellation integrates with the shared queue cancellation mechanism.
- [ ] Ensure deduper status lookups remain available during migration.
- [ ] Decide whether to keep existing deduper routes temporarily for backward compatibility.
- [ ] Remove or reduce duplicate logic in the legacy `job_manager` after the new path is verified.

Tests to implement in this phase:

- [ ] Add unit tests for any deduper-to-queue adapter logic.
- [ ] Update integration tests so deduper job creation writes to the JSON queue store.
- [ ] Add an end-to-end integration test proving:
  - job creation returns a string `jobId`
  - queue-info latest-job can find the deduper job by workflow
  - cancel or completion updates are persisted to `queue-jobs.json`
- [ ] Preserve or update existing deduper route tests so backward compatibility is explicit.

Suggested test files:

1. `tests/unit/test_job_manager.py`
2. `tests/integration/test_routes.py`
3. `tests/integration/test_deduper_queue_flow.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/test_job_manager.py tests/integration/test_routes.py tests/integration/test_deduper_queue_flow.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 5 changes before starting Phase 6.

## Phase 6. Prepare for additional worker-python workflows

- [ ] Extract workflow-runner interfaces or helper abstractions so non-deduper jobs can use the same queue engine.
- [ ] Add a worker-python workflow registration pattern for future jobs such as location scoring.
- [ ] Ensure each workflow can declare:
  - `endpointName`
  - parameter validation
  - execution handler
  - cancellation behavior
- [ ] Confirm that the queue-info routes remain workflow-agnostic.
- [ ] Confirm that the API can proxy worker-python queue-info routes using the same general pattern already used for worker-node.
- [ ] Update docs so future engineers can add worker-python workflows without rebuilding queue semantics.

Tests to implement in this phase:

- [ ] Add unit tests for workflow registration or runner abstraction.
- [ ] Add integration tests for at least one non-deduper placeholder workflow using the shared queue engine.
- [ ] Add contract tests proving queue-info behavior does not depend on deduper-specific fields.

Suggested test files:

1. `tests/unit/queue/test_workflow_registry.py`
2. `tests/integration/test_generic_workflow_queue_flow.py`
3. `tests/contracts/test_queue_info_workflow_agnostic_contract.py`

Phase completion instructions:

1. Run:

```bash
cd worker-python
source venv/bin/activate
pytest tests/unit/queue/test_workflow_registry.py tests/integration/test_generic_workflow_queue_flow.py tests/contracts/test_queue_info_workflow_agnostic_contract.py
```

2. If all tests pass, check off the completed tasks in this file.
3. Commit all Phase 6 changes before marking the refactor ready for API and portal integration work.

## Final validation

- [ ] Run the full worker-python test suite after all phases are complete.
- [ ] Verify the queue JSON file can be created from a clean temp `PATH_UTILTIES`.
- [ ] Verify queue-info responses remain stable across process restart scenarios that are covered by tests.
- [ ] Update worker-python API documentation for all new queue-info and workflow endpoints.
- [ ] Update any internal requirements or migration docs affected by the refactor.

Final validation commands:

```bash
cd worker-python
source venv/bin/activate
pytest
```

Final completion instructions:

1. If the full suite passes, check off the remaining tasks in this file.
2. Commit all remaining changes.
3. Only then move on to API proxy work or portal integration work that depends on the new worker-python queue contract.
