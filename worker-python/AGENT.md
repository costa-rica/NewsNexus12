# AGENT.md

This file provides guidance to engineers and AI agents working in `worker-python`.

## Purpose

`worker-python` is the FastAPI-based execution service for NewsNexus Python workflows.

It now runs absorbed workflows in-process and uses a shared JSON-backed queue for:

1. durable job tracking
2. latest-job lookup by workflow endpoint
3. queue status inspection
4. cooperative job cancellation

The deduper workflow from NewsNexusDeduper02 is already absorbed internally under `src/modules/deduper`.

## Runtime architecture

1. Application bootstrap
- `src/main.py`
- Loads `.env`, validates startup requirements, configures logging, and mounts routers.

2. HTTP routes
- `src/routes/index.py`
- `src/routes/deduper.py`
- `src/routes/queue_info.py`

3. Shared queue infrastructure
- `src/modules/queue/config.py`
- `src/modules/queue/store.py`
- `src/modules/queue/engine.py`
- `src/modules/queue/status.py`
- `src/modules/queue/types.py`
- `src/modules/queue/global_queue.py`

4. Deduper workflow
- `src/services/job_manager.py`
- `src/modules/deduper/config.py`
- `src/modules/deduper/repository.py`
- `src/modules/deduper/orchestrator.py`
- `src/modules/deduper/types.py`
- `src/modules/deduper/errors.py`

5. Deduper processors
- `src/modules/deduper/processors/load.py`
- `src/modules/deduper/processors/states.py`
- `src/modules/deduper/processors/url_check.py`
- `src/modules/deduper/processors/content_hash.py`
- `src/modules/deduper/processors/embedding.py`

6. Deduper utilities
- `src/modules/deduper/utils/csv_input.py`
- `src/modules/deduper/utils/text_norm.py`

## Queue model

The queue is the backbone of worker status reporting used by the portal automations UI and by API proxy routes.

1. Storage
- Queue state is persisted to `PATH_UTILTIES/worker-python/queue-jobs.json`.
- The queue store is JSON-backed, not in-memory.

2. Job identifiers
- `jobId` values are stored as strings.
- IDs use zero-padded human-readable values like `0001`, `0002`, `0127`.

3. Status values
- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

4. Queue lifecycle
- Jobs are enqueued into the shared queue engine.
- Only one job runs at a time.
- Cancellation is cooperative.
- On worker restart, any persisted `queued` or `running` jobs are reconciled to `failed` with `worker_restarted_before_completion`.

## Current runtime flow

### Deduper create and execute flow

1. API calls worker-python deduper routes:
- `GET /deduper/jobs`
- `GET /deduper/jobs/reportId/{report_id}`

2. `src/routes/deduper.py` delegates to `src/services/job_manager.py`.

3. `JobManager` enqueues a queue job with endpoint name:
- `/deduper/start-job`

4. The shared queue engine runs the job in a background thread.

5. `DeduperOrchestrator.run_analyze_fast(...)` executes in-process stages:
- `load`
- `states`
- `url_check`
- `embedding`

6. Job state is persisted to `queue-jobs.json` and exposed through both deduper routes and queue-info routes.

### Queue status flow

1. Latest workflow job lookup:
- `GET /queue-info/latest-job?endpointName=/deduper/start-job`

2. Job-specific status lookup:
- `GET /queue-info/check-status/{job_id}`

3. Queue summary:
- `GET /queue-info/queue-status`

4. Cancellation:
- `POST /queue-info/cancel-job/{job_id}`

## Environment variables

Required:

1. `PATH_DATABASE`
- Directory containing the SQLite database.

2. `NAME_DB`
- SQLite database filename.

3. `PATH_UTILTIES`
- Base utilities path used to resolve `worker-python/queue-jobs.json`.

Optional:

1. `PATH_TO_CSV`
- Used by deduper load stage when no `report_id` is provided.

2. `DEDUPER_ENABLE_EMBEDDING`
- Enable or disable the embedding stage.
- Default: `true`.

3. Deduper batch tuning
- `DEDUPER_BATCH_SIZE_LOAD` default `1000`
- `DEDUPER_BATCH_SIZE_STATES` default `1000`
- `DEDUPER_BATCH_SIZE_URL` default `1000`
- `DEDUPER_BATCH_SIZE_CONTENT_HASH` default `1000`
- `DEDUPER_BATCH_SIZE_EMBEDDING` default `100`

4. Deduper resilience and memory tuning
- `DEDUPER_CACHE_MAX_ENTRIES` default `10000`
- `DEDUPER_CHECKPOINT_INTERVAL` default `250`

Deprecated in the absorbed runtime path:

1. `PATH_TO_MICROSERVICE_DEDUPER`
2. `PATH_TO_PYTHON_VENV`

## Local development

Start the app with:

```bash
cd worker-python
source venv/bin/activate
uvicorn src.main:app --reload --host 0.0.0.0 --port 5000
```

## Operational guidance

1. Health and verification
- `GET /`
- `GET /deduper/health`
- `GET /deduper/jobs/list`
- `GET /deduper/jobs/{job_id}`
- `GET /queue-info/latest-job?endpointName=/deduper/start-job`
- `GET /queue-info/queue-status`

2. Common issue: worker fails at startup with `PATH_UTILTIES is required`
- Ensure `.env` is present in `worker-python/`.
- Ensure `PATH_UTILTIES` is defined.

3. Common issue: `job not found`
- Usually caused by polling with `reportId` instead of `jobId`.
- Queue and deduper status routes require the job ID returned at creation time.

4. Common issue: completed job but no rows
- Validate source rows for the report in the shared SQLite database.
- Validate approved rows exist for the target report.
- Validate worker-python points at the intended DB file.

5. Cancellation behavior
- Cancellation is cooperative, not force-kill based.
- Processors must check `should_cancel` at checkpoints between batches or units of work.

## Design rules for maintainers

1. Keep route handlers thin.
- Routes should validate input, enqueue or dispatch work, and shape responses.

2. Keep durable queue behavior centralized.
- Queue lifecycle logic belongs in `src/modules/queue/`.
- New workflow routes should reuse the shared queue engine instead of creating parallel job stores.

3. Keep SQL in repository modules.
- Processors and routes should not issue raw SQL directly.

4. Keep processors stage-focused.
- One processor per stage.
- Limit side effects to the processor's owned responsibility.

5. Preserve workflow endpoint names.
- Endpoint names such as `/deduper/start-job` are part of the status lookup contract used by API and portal clients.

6. Keep docs updated with code changes.
- Update `worker-python/docs/worker-python-api-documentation/*` when route behavior changes.
- Update this file when architecture or runtime flow changes materially.

## Troubleshooting and rollback

1. If a workflow fails
- Capture the request payload.
- Capture the `jobId`.
- Capture `/queue-info/check-status/{jobId}`.
- Capture `/queue-info/latest-job?endpointName=...` when relevant.
- Capture `/deduper/health` for deduper issues.

2. If queue state looks inconsistent
- Inspect `PATH_UTILTIES/worker-python/queue-jobs.json`.
- Check whether the worker restarted and reconciled in-flight jobs to failed.

3. Rollback order
- First prefer a code-level fix in the current worker.
- Next use a commit-level rollback in `worker-python`.
- Do not reintroduce a separate child-process worker path unless explicitly required.
