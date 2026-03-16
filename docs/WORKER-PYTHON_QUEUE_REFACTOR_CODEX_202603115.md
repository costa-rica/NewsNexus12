# Worker-Python Queue Refactor Feasibility Assessment

This document assesses the feasibility of refactoring `worker-python` so its queue infrastructure can support the same automation experience that the portal already uses with `worker-node`.

It builds on the behavior summary in `docs/AUTOMATIONS_TO_WORKER_FLOW_SUMMARY_202603115.md` and compares that target contract against the current implementation in `worker-python`.

## 1. Executive assessment

1. The refactor is feasible.
2. The current `worker-python` implementation already has several useful building blocks:
   - background job execution
   - job creation and job status lookup
   - cancellation support
   - timestamps and logs
3. The largest gap is not job execution. The largest gap is the queue contract expected by the portal:
   - durable job history
   - workflow-based latest-job lookup
   - a normalized queue-info API surface
   - a shared status vocabulary aligned with the portal and API proxy pattern
4. This is best treated as a moderate refactor, not a ground-up rewrite.
5. The recommended approach is to introduce a worker-python queue subsystem that mirrors the worker-node behavior at the contract level while staying Python-native internally.

## 2. Why this refactor is needed

The portal automations page is evolving into a shared operational control surface for background workflows. The relevant user experience is not just “start a task.” It is:

1. start a workflow
2. receive an immediate `jobId`
3. refresh the latest job for a workflow
4. inspect shared workflow status after page reload
5. cancel a queued or running job
6. allow multiple authenticated users to see the same operational state

`worker-node` currently supports this model through durable queue records and queue-info endpoints. `worker-python` currently supports a narrower deduper-oriented job model.

## 3. Current worker-python capabilities

Based on the current code:

1. `worker-python/src/services/job_manager.py`
   - maintains job records in memory
   - creates jobs with incremental IDs today, which should be refactored to 4-digit zero-padded string IDs such as `0001`
   - tracks status, timestamps, logs, report ID, exit code, stdout, stderr, error, and cancellation flag
   - starts jobs in background threads
   - supports cooperative cancellation

2. `worker-python/src/routes/deduper.py`
   - creates jobs
   - creates report-scoped jobs
   - returns job status by `jobId`
   - lists jobs
   - cancels jobs
   - exposes a health endpoint

3. `worker-python` already uses an internal orchestration pattern for deduper rather than shelling out to an external process. That is a good base for adding more formal queue lifecycle handling.

## 4. Current worker-python limitations relative to the portal contract

The current implementation does not yet align with the portal automation model in several important ways.

### 4.1 Job storage is in-memory only

1. `job_manager.jobs` is an in-memory dictionary.
2. `job_counter` is reset on service restart.
3. Recent job history is lost after restart.
4. The portal status panel is designed around durable workflow visibility, not per-session memory.

Impact:

1. page refresh can still work while the process remains alive
2. service restart breaks historical lookup
3. “latest job for workflow” is not reliable across process restarts

### 4.2 There is no workflow-based latest-job lookup

The portal status component is workflow-based. It asks questions like:

1. what is the latest job for Google RSS
2. what is the latest job for State Assigner
3. what is the latest job for a future Location Scorer workflow

Current worker-python jobs are deduper-specific and keyed primarily by `jobId` and optional `report_id`. They do not appear to store a normalized workflow identifier such as `endpointName`.

Impact:

1. the portal cannot ask for “latest job for workflow X” in a generic way
2. the browser would have to remember prior `jobId` values, which is the fragile pattern already avoided in the worker-node design

### 4.3 There is no queue-info route family

Current routes are deduper-specific:

1. `GET /deduper/jobs`
2. `GET /deduper/jobs/reportId/{report_id}`
3. `GET /deduper/jobs/{job_id}`
4. `POST /deduper/jobs/{job_id}/cancel`
5. `GET /deduper/jobs/list`

`worker-node` exposes a more reusable queue contract:

1. latest job by workflow
2. single job by `jobId`
3. queue summary
4. cancellation

Impact:

1. current worker-python routes do not map cleanly to the reusable portal status component
2. adding more worker-python workflows would likely duplicate deduper-specific route patterns rather than converging on a shared queue API

### 4.4 Status vocabulary is close, but not yet normalized

Current worker-python statuses:

1. `pending`
2. `running`
3. `completed`
4. `failed`
5. `cancelled`

Current worker-node statuses used by the portal pattern:

1. `queued`
2. `running`
3. `completed`
4. `failed`
5. `canceled`

This is not a major blocker, but it matters for reuse and consistency.

Impact:

1. portal and API code become more conditional than necessary
2. spelling and semantic mismatches create avoidable integration friction

### 4.5 Current queue behavior is more job-runner than queue-engine

The current worker-python model starts each job in its own background thread immediately after creation. That is valid for job execution, but it is not yet equivalent to a durable global queue engine with explicit queued/running transitions and queue inspection.

Questions this raises:

1. should worker-python run one automation at a time like worker-node
2. should it allow concurrent jobs by workflow type
3. how should queued order be represented and persisted

This does not make the refactor infeasible. It means the desired execution model needs to be decided explicitly before implementing parity.

## 5. Feasibility conclusion

The refactor is feasible because the current worker-python service already has:

1. a dedicated service boundary
2. internal job lifecycle concepts
3. route handlers that are already thin enough to evolve
4. an orchestration layer that can be run asynchronously
5. cooperative cancellation patterns

The refactor is not trivial because the missing pieces are structural:

1. durable job persistence
2. reusable workflow identifiers
3. queue-info endpoints
4. normalized status and response shapes
5. possible queue serialization or concurrency control decisions

Assessment:

1. engineering feasibility is high
2. implementation complexity is moderate
3. operational risk is manageable if introduced behind new routes first

## 6. Recommended target contract for worker-python

The goal is contract parity with `worker-node`, not implementation parity.

### 6.1 Job record shape

At minimum, each worker-python job record should support:

1. `jobId`
2. `endpointName` or another stable workflow identifier
3. `status`
4. `createdAt`
5. `startedAt`
6. `endedAt`
7. `failureReason`

Useful optional fields:

1. workflow label
2. request parameters snapshot
3. logs
4. cancelRequested
5. result summary metadata

Job ID format recommendation:

1. `jobId` should be stored and treated as a string, not an integer
2. `jobId` should use a 4-digit zero-padded human-readable format such as `0001`, `0002`, and `0147`
3. the next ID generator should read the highest existing numeric value from `queue-jobs.json`, increment it, and left-pad to 4 digits
4. if the queue eventually exceeds `9999`, the implementation should continue with wider string values such as `10000` rather than rolling over

### 6.2 Queue-info endpoints

Recommended worker-python queue-info surface:

1. `GET /queue-info/latest-job?endpointName=...`
2. `GET /queue-info/check-status/{jobId}`
3. `GET /queue-info/queue-status`
4. `POST /queue-info/cancel-job/{jobId}`

The exact path naming can vary if needed, but keeping it similar to `worker-node` will reduce API and portal adaptation cost.

### 6.3 Start-job endpoint behavior

Each worker-python automation endpoint should:

1. enqueue work
2. return quickly
3. return `jobId`
4. return a normalized initial status such as `queued`
5. include workflow identity in the response when helpful

Job ID handling expectation:

1. all queue-info lookup and cancel endpoints should accept string `jobId` values
2. no part of the API contract should require worker-python `jobId` to be parseable only as an integer

## 7. Recommended persistence approach

The recommended persistence model for `worker-python` should match `worker-node` and use a JSON-backed job store.

Target path:

1. `PATH_UTILTIES/worker-python/queue-jobs.json`

Configuration expectation:

1. `PATH_UTILTIES` should be introduced as a worker-python `.env` variable
2. the worker should resolve the queue store path from that environment variable
3. the worker should create the `worker-python` subdirectory and `queue-jobs.json` file if they do not already exist

Why this is the preferred approach:

1. it aligns directly with the existing worker-node queue storage pattern
2. it keeps the queue implementation conceptually consistent across worker services
3. it avoids introducing new database schema work for queue persistence
4. it is sufficient for the portal status-panel contract, which needs durable job metadata rather than relational querying
5. it keeps the refactor focused on queue behavior and contract parity instead of storage-system expansion

Implementation considerations:

1. writes should be serialized to avoid JSON corruption
2. updates should be atomic, for example by writing a temporary file and renaming it
3. startup should validate that `PATH_UTILTIES` is present and writable
4. the worker should define a restart policy for jobs that were `queued` or `running` before process termination
5. retention or pruning rules should be defined so the JSON file does not grow without bound

Assessment:

1. this is the most appropriate persistence choice for the current refactor
2. it gives the team the closest parity with worker-node at the lowest architectural cost
3. it should be treated as the target design, not just a short-term fallback

## 8. Architectural refactor recommendation

The cleanest approach is to split the current `job_manager` responsibilities into more explicit layers.

### Suggested layers

1. queue store
   - reads and writes durable job records
2. queue engine
   - enqueues jobs
   - manages queued and running state transitions
   - handles cancellation
3. workflow runners
   - deduper runner
   - future location scorer runner
   - future worker-python workflows
4. queue-info routes
   - generic job inspection endpoints
5. workflow routes
   - start-job endpoints for each workflow

This would move worker-python toward the same conceptual model already proven in worker-node while preserving Python-specific execution details.

## 9. Impact on existing deduper functionality

The deduper should be a strong candidate for migration into the shared queue model rather than remaining a special case.

Benefits:

1. deduper becomes compatible with the same portal status patterns
2. future portal automation sections can reuse the same status component
3. API proxy code becomes simpler and more consistent

Risks:

1. deduper currently exposes job creation as `GET`, which is semantically unusual
2. current consumers may depend on existing response shapes
3. cancellation timing may change slightly if the queue engine is redesigned

Recommended approach:

1. preserve existing deduper endpoints initially
2. implement queue-info support underneath or alongside them
3. add new normalized endpoints without breaking current consumers
4. migrate API and portal usage after the new contract is validated

## 10. Main technical risks

### 10.1 Restart recovery

If the process restarts while jobs are running:

1. how will those jobs be marked
2. should they be resumed, failed, or marked abandoned

This needs an explicit policy.

### 10.2 Cancellation semantics

Current deduper cancellation is cooperative. That is good, but the queue model should make sure:

1. cancel requested is persisted
2. final canceled state is recorded durably
3. status transitions are not ambiguous

### 10.3 Concurrency model

The team needs to decide whether worker-python should:

1. process one job globally at a time
2. process one job per workflow
3. allow bounded concurrency

The answer affects:

1. queue representation
2. queue-status summaries
3. cancellation behavior
4. operational expectations in the portal

### 10.4 Backward compatibility

If the deduper routes are changed too aggressively, existing integrations may break. A staged rollout is safer.

## 11. Recommended phased implementation

### Phase 1. Introduce normalized job model

1. add `endpointName`
2. normalize status vocabulary
3. normalize timestamps and failure fields
4. preserve current deduper endpoints

### Phase 2. Add durable store

1. implement JSON persistence at `PATH_UTILTIES/worker-python/queue-jobs.json`
2. persist job lifecycle transitions
3. support latest-job lookup by workflow

### Phase 3. Add queue-info endpoints

1. add latest-job lookup
2. add check-status by `jobId`
3. add queue-status summary
4. add cancel by `jobId`

### Phase 4. Move workflows onto shared queue engine

1. deduper
2. location scorer
3. future worker-python automations

### Phase 5. Integrate through API and portal

1. add API proxy endpoints matching the worker-node proxy pattern
2. reuse the portal status panel with little or no specialization
3. validate shared operational behavior across workers

## 12. Final recommendation

Refactoring `worker-python` toward the `worker-node` queue model is practical and worth doing.

The strongest reason is product consistency. The portal automations page is clearly moving toward a shared pattern where users can:

1. launch workflows
2. see the latest workflow job
3. refresh status
4. cancel jobs

`worker-python` is already far enough along that this should be an evolutionary refactor, not a replacement project. The recommended path is to preserve the current Python orchestration logic, but introduce:

1. a durable JSON job store at `PATH_UTILTIES/worker-python/queue-jobs.json`
2. a generic queue engine contract
3. reusable queue-info endpoints
4. normalized workflow identity and status fields

If implemented that way, the portal, API, worker-node, and worker-python can converge on one operational model without requiring identical internal technology choices.
