# Worker Python Guidance

## Purpose

Worker-python is the FastAPI execution service for AI Approver V02, deduplication, location scoring, and shared durable queue operations.

## Runtime entry points

1. Application bootstrap: `src/main.py`
2. AI Approver V02: `src/routes/ai_approver_v02.py` and `src/modules/ai_approver_v02/`
3. Deduper: `src/routes/deduper.py`, `src/services/job_manager.py`, and `src/modules/deduper/`
4. Location scorer: `src/routes/location_scorer.py` and `src/modules/location_scorer/`
5. Shared queue: `src/routes/queue_info.py` and `src/modules/queue/`

The old product feature formerly named orchestrator is removed. Files named `orchestrator.py` inside retained workflow packages are internal single-workflow coordinators, not a shared scheduler or public product feature.

## Queue behavior

1. Queue state is stored at `PATH_UTILTIES/worker-python/queue-jobs.json`.
2. Status values are `queued`, `running`, `completed`, `failed`, and `canceled`.
3. Cancellation is cooperative.
4. Restart reconciliation marks persisted in-flight jobs failed.
5. New workflows must reuse the shared queue rather than create a parallel job store.

## AI Approver V02

1. V02 routes use the `/ai-approver-v02` prefix.
2. V02 uses dedicated `AI_APPROVER_V02_*` settings and the Codex CLI backend.
3. Preview creates a short-lived database draft with a frozen selection.
4. Start commits the preview and enqueues only the database run ID.
5. Prompt, run, and prediction persistence belongs in `src/modules/ai_approver_v02/repository.py`.
6. Keep V02 isolated from removed V01 routes, tables, settings, and prompt assets.

## Design rules

1. Keep route handlers thin.
2. Keep SQL in repository modules.
3. Keep processors stage-focused.
4. Preserve live endpoint names used by queue status clients.
5. Update README and active API documentation when route behavior changes.
6. Do not restore a shared scheduler or cross-worker lock without a new approved design.

## Development

1. Start locally:

   ```bash
   cd worker-python
   source venv/bin/activate
   uvicorn src.main:app --reload --host 0.0.0.0 --port 5000
   ```

2. Run all tests:

   ```bash
   ./venv/bin/pytest
   ```

3. Run focused retained workflow tests:

   ```bash
   ./venv/bin/pytest tests/unit/ai_approver_v02 tests/integration/test_ai_approver_v02_routes.py
   ./venv/bin/pytest tests/unit/deduper tests/unit/location_scorer
   ```

## Safety

1. Do not print credentials or database passwords.
2. Confirm the target database before database-backed tests.
3. Use a disposable test database for destructive integration tests.
4. Keep production service and schedule changes behind operator approval.
