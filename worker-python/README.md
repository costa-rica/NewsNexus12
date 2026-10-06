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
   - `POST /deduper/jobs` and `POST /deduper/jobs/reportId/{report_id}` (optional body `{"rebuildEmbeddings": true}`)
   - `GET /deduper/jobs/{job_id}`
   - `POST /deduper/jobs/{job_id}/cancel`
   - `DELETE /deduper/clear-db-table`
3. Article embeddings:
   - `POST /article-embeddings/jobs` (optional body `{"mode": "incremental" | "rebuild"}`)
4. Location scorer:
   - `POST /location-scorer/start-job`
5. Shared queue:
   - `GET /queue-info/check-status/{job_id}`
   - `GET /queue-info/latest-job`
   - `GET /queue-info/queue-status`
   - `POST /queue-info/cancel-job/{job_id}`

AI Approver V01 and the former cross-worker weekly workflow are not live features.

AI Approver V02 is used by weekly-flow-02 Phase 7 as well as operator-facing clients. Worker-python provides preview, execution, detail, and cancellation contracts; ops owns weekly scheduling and continuation policy.

## Stored article embeddings

- Each deduper job runs an `embedding_sync` step before scoring. It embeds approved articles that are missing from `ArticleEmbeddings`, or whose text changed. The `embedding` step then scores pairs from the stored vectors.
- `POST /article-embeddings/jobs` runs the same sync on its own. Use it to fill the table ahead of a weekly run, or after a database import, since `ArticleEmbeddings` is excluded from backups.
- Settings: `ARTICLE_EMBEDDINGS_MODEL_NAME`, `ARTICLE_EMBEDDINGS_BATCH_SIZE` (default 64) and `DEDUPER_BATCH_SIZE_EMBEDDING` (default 5000, the scores written per bulk update).

## Clearing deduper analysis

- `DELETE /deduper/clear-db-table` cancels only queued/running deduper jobs, waits for running deduper execution to exit, and then clears `ArticleDuplicateAnalyses`. Other workflows and the worker service remain running.
- `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` accepts a positive integer and defaults to 30. If cancellation does not finish in time, the endpoint returns 504 without deleting rows.
- During clearing, competing clear requests and new deduper job requests return 409. Successful responses include `rowsDeleted`, confirmed `cancelledJobs`, and `cancellationRequestedJobs` (requests are not proof of cancellation).
- Coordination uses the existing single queue-owning process. Do not run multiple worker processes or instances against the same queue/database and assume this process-local guard coordinates them.
