---
created_at: 2026-10-06T23:03:56Z
updated_at: 2026-10-06T23:03:56Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Article embeddings endpoints

These endpoints manage the `ArticleEmbeddings` table. It stores one sentence embedding (`all-MiniLM-L6-v2`, 384 float32 values) per approved article. The deduper reads these stored embeddings instead of encoding articles during every pair comparison.

Key behavior:

1. Text source: the newest approved `ArticleApproveds` row per article, `textForPdfReport`.
2. A row exists only while that text is non-null. Its `textHash` must match the current text after preprocessing.
3. `ArticleEmbeddings` is excluded from database backups. After a database import the table is empty. Run this endpoint, or let the next deduper job fill it.
4. Jobs run on the shared queue, one job at a time, so a sync job and a deduper job never write the table at once.

## POST /article-embeddings/jobs

Queues an embeddings sync job.

### parameters

- Body (optional): `mode` (string, default `incremental`)
  - `incremental`: embed articles that are missing an embedding or whose text changed. This takes seconds when nothing changed.
  - `rebuild`: re-encode every approved article. Existing rows are overwritten in place, never truncated first. This takes an estimated 5–15 minutes on CPU.
- Both modes delete rows for articles that are no longer approved or whose text became null.

### Sample Request

```bash
curl --location --request POST 'http://localhost:5000/article-embeddings/jobs' \
--header 'Content-Type: application/json' \
--data '{"mode": "incremental"}'
```

### Sample Response

```json
{
  "jobId": "0012",
  "status": "queued",
  "mode": "incremental"
}
```

### Job status

Poll with `GET /queue-info/check-status/{job_id}`, or `GET /queue-info/latest-job?endpointName=/article-embeddings/start-job`. A completed job's `result` holds the sync summary:

```json
{
  "mode": "incremental",
  "approved_articles": 10412,
  "missing": 150,
  "stale": 2,
  "encoded": 152,
  "upserted": 152,
  "deleted": 0,
  "elapsed_seconds": 9.4,
  "processed": 152,
  "status": "ok"
}
```

Cancel with `POST /queue-info/cancel-job/{job_id}`. A cancelled job ends as `canceled`. Rows written before the cancel stay valid.

### Error responses

- `422`: Invalid body, for example an unknown `mode` or an unknown field
- `500`: Internal server error

### Configuration

- `ARTICLE_EMBEDDINGS_MODEL_NAME`: defaults to `sentence-transformers/all-MiniLM-L6-v2`.
- `ARTICLE_EMBEDDINGS_BATCH_SIZE`: defaults to 64. This is the number of articles encoded and saved per batch.
- Uses the same `PG_*` connection settings as the rest of worker-python.
