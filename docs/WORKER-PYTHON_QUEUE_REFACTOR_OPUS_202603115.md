# Worker-Python Queue Refactor: Feasibility Assessment

This document assesses the feasibility of refactoring the worker-python queue infrastructure to match the operational contract established by worker-node. The goal is enabling the portal automations page to manage worker-python workflows using the same reusable status panel and user experience currently working for worker-node.

## 1. Executive summary

The refactor is feasible and moderate in scope. Worker-python already has the right structural foundation (job creation, status tracking, cancellation, background threading), but it lacks the two capabilities the portal contract requires: **persistent job state** and a **latest-job-by-workflow lookup**. The core work is adding a durable job store and a small set of queue-info endpoints. No external dependencies (Redis, Celery, BullMQ) are needed.

Estimated scope: medium. The changes are localized to `job_manager.py`, a new persistence module, new route handlers, and minor API proxy routes.

## 2. Architecture comparison

### Worker-node queue model

| Component | Implementation | Key file |
|-----------|---------------|----------|
| Queue engine | Custom in-process FIFO, max concurrency 1 | `worker-node/src/modules/queue/queueEngine.ts` |
| Job store | JSON file with atomic writes and promise-chain locking | `worker-node/src/modules/queue/jobStore.ts` |
| Job record | `{ jobId, endpointName, status, createdAt, startedAt?, endedAt?, failureReason? }` | `worker-node/src/modules/queue/types.ts` |
| Queue-info API | 4 endpoints: check-status, latest-job, queue_status, cancel_job | `worker-node/src/routes/queueInfo.ts` |
| Startup maintenance | Repairs stale queued/running jobs, prunes records older than 30 days | `worker-node/src/modules/startup/queueMaintenance.ts` |
| Cancellation | AbortSignal + SIGTERM/SIGKILL with grace period for child processes | `queueEngine.ts` |

### Worker-python current model

| Component | Implementation | Key file |
|-----------|---------------|----------|
| Job manager | In-memory dict with threading.Lock, daemon threads | `worker-python/src/services/job_manager.py` |
| Job record | `JobRecord` dataclass: `{ id, status, created_at, logs, report_id, started_at, completed_at, exit_code, stdout, stderr, error, cancel_requested }` | `job_manager.py` |
| Job dispatch | `GET /deduper/jobs` or `GET /deduper/jobs/reportId/{report_id}` | `worker-python/src/routes/deduper.py` |
| Status query | `GET /deduper/jobs/{job_id}` | `deduper.py` |
| Cancellation | Cooperative via `cancel_requested` flag checked at checkpoint intervals | `job_manager.py` |
| Persistence | None (in-memory only, lost on restart) | - |
| Workflow identifier | None (implicit single workflow: deduper) | - |

### Gap analysis

| Portal contract requirement | Worker-node | Worker-python | Gap severity |
|------------------------------|------------|---------------|-------------|
| Durable job store (survives restart) | JSON file | In-memory dict | **High** |
| Stable jobId (string UUID) | UUID string | Auto-increment integer | Medium |
| Stable workflow/endpoint identifier | `endpointName` field | Not present | **High** |
| Latest-job-by-workflow lookup | `GET /queue-info/latest-job?endpointName=...` | Not available | **High** |
| Normalized status values | `queued, running, completed, failed, canceled` | `pending, running, completed, failed, cancelled` | Low |
| Timestamps (created, started, ended) | `createdAt, startedAt, endedAt` | `created_at, started_at, completed_at` | Low |
| Failure reason field | `failureReason` | `error` field | Low |
| Cancel by jobId | `POST /queue-info/cancel_job/:jobId` | `DELETE /deduper/jobs/{job_id}/cancel` | Low |
| Queue summary endpoint | `GET /queue-info/queue_status` | `GET /deduper/health` (partial) | Medium |
| Startup maintenance (stale job repair) | Yes | No | Medium |

## 3. Assessment against the flow summary questions

The flow summary document (`docs/AUTOMATIONS_TO_WORKER_FLOW_SUMMARY_202603115.md`, section 8) poses seven questions. Here are the current answers for worker-python:

1. **Does worker-python have a durable job store today?** No. Jobs are stored in `self.jobs: dict[int, JobRecord]` and lost on process restart.

2. **Can worker-python identify jobs by a stable jobId?** Partially. Jobs use auto-incrementing integers that reset to 1 on restart. Not globally stable.

3. **Can worker-python identify jobs by workflow type?** No. There is no `endpointName` or workflow identifier field on `JobRecord`. Currently only the deduper workflow exists, so the need was implicit.

4. **Can worker-python answer "latest job for workflow X" after restart?** No. Neither persistence nor workflow filtering exists.

5. **Can worker-python cancel both queued and running jobs?** Yes. Cooperative cancellation via `cancel_requested` flag is implemented and processors check `should_cancel()` between batches.

6. **Can worker-python expose timestamps and failure reasons?** Partially. Timestamps exist (`created_at`, `started_at`, `completed_at`) but naming differs from the contract. `error` field exists but is not called `failureReason`.

7. **Can worker-python preserve job history for multiple users?** No. In-memory state is session-bound and not shared durably.

**Result: 4 of 7 answers are "no" or "partially." The refactor must start at the job model and persistence layer.**

## 4. Recommended refactor scope

### 4.1 Persistent job store

**What:** Replace `self.jobs: dict[int, JobRecord]` with a file-backed store.

**Recommended approach:** JSON file with atomic writes, matching the worker-node pattern.

- Create `worker-python/src/services/job_store.py`
- Store jobs in a JSON file at a configurable path (env: `PATH_UTILITIES` or similar)
- Use atomic write pattern: write to temp file, then `os.rename()` to final path
- Use `threading.Lock` for serialized access (already established pattern in `job_manager.py`)
- File location example: `{PATH_UTILITIES}/worker-python/queue-jobs.json`

**Why JSON over SQLite:** The worker-node uses JSON and it works well for this volume of data (dozens to low hundreds of job records). Keeping the same format simplifies cross-service tooling and debugging. SQLite is a valid alternative but adds complexity without clear benefit at this scale.

### 4.2 Job record alignment

**What:** Align `JobRecord` fields to match the cross-worker contract.

Current `JobRecord` (Python):
```python
@dataclass
class JobRecord:
    id: int
    status: JobStatus          # pending, running, completed, failed, cancelled
    created_at: str
    logs: list[str]
    report_id: int | None
    started_at: str | None
    completed_at: str | None
    exit_code: int | None
    stdout: str | None
    stderr: str | None
    error: str | None
    cancel_requested: bool
```

Target `QueueJobRecord` (contract):
```python
@dataclass
class QueueJobRecord:
    job_id: str                # UUID string (was int)
    endpoint_name: str         # workflow identifier (new)
    status: QueueJobStatus     # queued, running, completed, failed, canceled
    created_at: str
    started_at: str | None
    ended_at: str | None       # renamed from completed_at
    failure_reason: str | None # renamed from error
```

Changes needed:
- `id: int` becomes `job_id: str` (UUID)
- Add `endpoint_name: str` field
- Rename `completed_at` to `ended_at`
- Rename `error` to `failure_reason`
- Rename status `pending` to `queued`, `cancelled` to `canceled` (single-l, matching worker-node)
- Fields like `logs`, `report_id`, `exit_code`, `stdout`, `stderr` can remain as Python-internal metadata but should not be part of the persisted queue record. They can be kept on a separate internal job detail object or stored alongside the queue record as optional fields.

### 4.3 Workflow identifier

**What:** Each automation workflow gets a stable `endpoint_name` string.

For the current deduper workflow: `"/deduper/start-job"` (or similar convention).

Future Python-based automations would each get their own identifier, allowing the portal to query latest-job per workflow.

### 4.4 Queue-info endpoints

**What:** Add a queue-info router to worker-python that mirrors the worker-node contract.

New routes (suggested prefix: `/queue-info`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/queue-info/check-status/{job_id}` | GET | Return single job record by jobId |
| `/queue-info/latest-job?endpointName=...` | GET | Return latest job for a workflow |
| `/queue-info/queue_status` | GET | Return queue summary with counts and active/queued jobs |
| `/queue-info/cancel_job/{job_id}` | POST | Cancel a queued or running job |

Response shapes should match worker-node:

```json
// check-status and latest-job
{ "job": { "jobId": "...", "endpointName": "...", "status": "...", ... } }

// queue_status
{ "summary": { "totalJobs": 0, "queued": 0, ... }, "runningJob": null, "queuedJobs": [] }

// cancel_job
{ "jobId": "...", "outcome": "canceled" | "cancel_requested" | "not_found" }
```

**Key detail:** The JSON field names in API responses should use camelCase (`jobId`, `endpointName`, `createdAt`, `startedAt`, `endedAt`, `failureReason`) to match the worker-node response format. Python internals can use snake_case but serialization to the API must produce camelCase.

### 4.5 Startup maintenance

**What:** On worker-python startup, scan persisted jobs and repair stale state.

- Mark any `queued` or `running` jobs as `failed` with `failure_reason: "worker_restart"`
- Prune jobs older than 30 days
- Log repair and prune counts

This is a direct port of `worker-node/src/modules/startup/queueMaintenance.ts`.

### 4.6 API layer proxy routes

**What:** Add routes in the API service to proxy queue-info requests to worker-python, matching the pattern used for worker-node.

Current API automations routes (`api/src/routes/newsOrgs/automations.ts`) proxy to worker-node at paths like:
- `GET /automations/worker-node/latest-job?endpointName=...`
- `POST /automations/worker-node/cancel-job/{jobId}`

Equivalent routes for worker-python:
- `GET /automations/worker-python/latest-job?endpointName=...`
- `POST /automations/worker-python/cancel-job/{jobId}`
- `POST /automations/deduper/start-job` (if deduper is exposed as a portal automation)

### 4.7 Portal integration

**What:** The reusable `WorkerNodeJobStatusPanel` component (`portal/src/components/automations/WorkerNodeJobStatusPanel.tsx`) should work with worker-python jobs if the API response shape matches.

Two options:
1. **Rename to generic:** Rename the component to `WorkerJobStatusPanel` and parameterize the API base path (e.g., `worker-node` vs `worker-python`).
2. **Keep as-is:** Create a parallel `WorkerPythonJobStatusPanel` that follows the same pattern but hits worker-python API routes.

Option 1 is cleaner and aligns with the flow summary's stated goal of reusable components.

## 5. What does NOT need to change

- **Threading model:** Worker-python's daemon thread approach for background execution is fine. Worker-node uses an async event loop; the contract does not require a specific concurrency model.
- **Deduper pipeline internals:** The orchestrator, processors, and repository layers are unaffected. Only the job manager wrapper changes.
- **Cooperative cancellation:** The `should_cancel()` callback pattern already works. It just needs to be wired to the new job record's state.
- **Database access:** The deduper's SQLite repository is internal to the workflow and separate from the queue job store.
- **No external dependencies needed:** No Redis, Celery, or message broker. The JSON file store is sufficient for the single-instance, sequential execution model.

## 6. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Concurrent file access corruption | Low | Medium | Use threading.Lock + atomic writes (temp file + rename). Single-process model means no cross-process races. |
| Job ID collisions after restart | Very low | Low | Use `uuid.uuid4()` instead of auto-increment. |
| Status naming mismatch breaks portal | Low | Medium | Validate response shapes match worker-node exactly before portal integration. |
| Deduper regressions during refactor | Medium | Medium | Keep existing deduper route handlers working during transition. Add queue-info routes alongside, not replacing. |
| JSON file grows unbounded | Low | Low | Startup maintenance prunes records older than 30 days (same as worker-node). |
| Breaking existing API consumers | Medium | Medium | Existing `/deduper/jobs` routes should continue working. New `/queue-info` routes are additive. Deprecate old routes later. |

## 7. Implementation order

1. **Job store module** — Create `job_store.py` with JSON file persistence, atomic writes, and lock-based serialization.
2. **Job record alignment** — Update `JobRecord` to include `job_id` (UUID string), `endpoint_name`, and rename fields to match contract.
3. **JobManager refactor** — Wire `JobManager` to use the new persistent store instead of `self.jobs` dict.
4. **Startup maintenance** — Add stale job repair and pruning on application startup.
5. **Queue-info routes** — Add `/queue-info` router with the four contract endpoints.
6. **API proxy routes** — Add worker-python queue-info proxy routes in the API service.
7. **Portal integration** — Generalize `WorkerNodeJobStatusPanel` or create a worker-python variant. Add a deduper section to the automations page if desired.
8. **Deprecation** — Mark old `/deduper/jobs` status-check routes as deprecated once queue-info routes are validated.

## 8. Files to create or modify

### New files
- `worker-python/src/services/job_store.py` — Persistent JSON job store
- `worker-python/src/routes/queue_info.py` — Queue-info endpoint router
- `worker-python/src/services/queue_maintenance.py` — Startup maintenance logic

### Modified files
- `worker-python/src/services/job_manager.py` — Refactor to use persistent store, UUID job IDs, endpoint_name field
- `worker-python/src/routes/deduper.py` — Wire start-job to pass endpoint_name
- `worker-python/src/main.py` — Register queue-info router, run startup maintenance
- `worker-python/AGENT.md` — Document new queue infrastructure
- `api/src/routes/newsOrgs/automations.ts` — Add worker-python proxy routes
- `portal/src/components/automations/WorkerNodeJobStatusPanel.tsx` — Generalize for multi-worker use (optional)
- `portal/src/app/(dashboard)/articles/automations/page.tsx` — Add deduper automation section (optional)

## 9. Conclusion

The refactor is straightforward because both workers already use the same fundamental pattern: in-process, single-threaded FIFO queues with no external broker. The gap is not architectural — it is contractual. Worker-python needs to persist job state, identify workflows by name, and expose the same small set of query endpoints that the portal already consumes from worker-node.

No new infrastructure dependencies are required. The implementation can remain Python-native, using JSON file persistence and threading. The estimated scope is 3-5 files created and 4-6 files modified, with the majority of the work concentrated in `job_store.py` and the refactored `job_manager.py`.
