# NewsNexus Python Worker

The FastAPI worker runs AI Approver V02, deduplication, location scoring, and shared queue operations in-process.

## Quick start

1. Create the environment and install dependencies:

   ```bash
   cd worker-python
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   pip install -r requirements-dev.txt
   ```

2. Configure `worker-python/.env` from `.env.example`.
3. Start the service:

   ```bash
   uvicorn src.main:app --reload --host 0.0.0.0 --port 5000
   ```

## Tests

1. Run the complete suite:

   ```bash
   ./venv/bin/pytest
   ```

2. Run focused AI Approver V02 tests:

   ```bash
   ./venv/bin/pytest tests/unit/ai_approver_v02 tests/integration/test_ai_approver_v02_routes.py
   ```

## Live workflows

1. AI Approver V02:
   - `POST /ai-approver-v02/preview`
   - `POST /ai-approver-v02/start`
   - `GET /ai-approver-v02/runs/latest`
   - `GET /ai-approver-v02/runs/{run_id}`
   - `POST /ai-approver-v02/runs/{run_id}/cancel`
2. Deduper:
   - `GET /deduper/jobs`
   - `GET /deduper/jobs/reportId/{report_id}`
   - `GET /deduper/jobs/{job_id}`
   - `POST /deduper/jobs/{job_id}/cancel`
3. Location scorer:
   - `POST /location-scorer/start-job`
4. Shared queue:
   - `GET /queue-info/check-status/{job_id}`
   - `GET /queue-info/latest-job`
   - `GET /queue-info/queue-status`
   - `POST /queue-info/cancel-job/{job_id}`

AI Approver V01 and the former cross-worker weekly workflow are not live features.

Files named `orchestrator.py` inside `src/modules/ai_approver_v02/` coordinate V02 internals only. They are not the removed cross-service legacy orchestrator product feature. The current weekly flow is owned by `../ops/weekly-article-flow`.
