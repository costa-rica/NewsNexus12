---
created_at: 2026-10-06T22:18:36Z
updated_at: 2026-10-06T22:18:36Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Article Embeddings Plan v02

## Changes From v01

This version folds in the operator responses to the v01 open questions.

1. Edited text detection: the default sync mode now also re-embeds articles whose text hash changed. The mode is renamed from `missing` to `incremental`.
2. Text row selection: use the newest approved row per article. This is now a decision, not a risk.
3. Standalone route: `POST /article-embeddings/jobs` ships with this plan.
4. Score writes: the embedding step saves scores with a batched `UPDATE ... FROM (VALUES ...)` instead of per-row `executemany`.

## Goal

Store one sentence embedding per approved article in a new `ArticleEmbeddings` table. The deduper should load stored embeddings instead of encoding articles during every pair comparison.

- The default run embeds articles that have no stored embedding, or whose text changed since they were embedded.
- An optional flag rebuilds every embedding.
- The table population lives in a reusable worker-python module, which is shared by the deduper and a standalone endpoint.

Background: `docs/20261006_deduper_claude_ideas.md`, idea 2.

## Current State

1. The portal calls api `GET /analysis/deduper/request-job/:reportId`. The api then calls worker-python `GET /deduper/jobs/reportId/{report_id}`.
2. `JobManager._build_deduper_runner` runs `DeduperOrchestrator.run_analyze_fast`. The steps are load, states, url_check and embedding. `run_analyze` adds content_hash.
3. For each pair, `EmbeddingProcessor` does the following:
   - It calls `get_article_content` twice, which is two queries.
   - It encodes each article one at a time with `all-MiniLM-L6-v2`.
   - It caches encodings in memory, capped by `DEDUPER_CACHE_MAX_ENTRIES` (default 10000).
4. There are now more than 10,000 approved articles, so the cache clears during a run and the same articles get encoded again. This is the likely cause of the ~125 ms per pair.
5. `update_analysis_embedding_batch` saves scores one row at a time through `executemany`. The batch size is `DEDUPER_BATCH_SIZE_EMBEDDING`, default 100.
6. The api writes the Excel output later, from `ArticleDuplicateAnalyses.embeddingSearch`. The api, the portal and the Excel generation are out of scope.

## Scope

In scope:

1. db-models: a new `ArticleEmbedding` model and a shared backup exclusion list.
2. db-manager and api: both backup functions skip excluded models.
3. worker-python: a new `article_embeddings` module, deduper integration, bulk score writes, and new POST routes.
4. Tests and docs for each changed package.

Out of scope:

1. Comparing only likely candidates (idea 3).
2. Removing the per-pair queries and per-row writes in the states, url_check and content_hash processors (idea 1). See open question 1.
3. Changes to the portal or to the api deduper routes.

## Component 1: db-models

### New model `ArticleEmbedding`

- File: `db-models/src/models/ArticleEmbedding.ts`.
- Model name `ArticleEmbedding`, table name `ArticleEmbeddings`. This matches the `ArticleDuplicateAnalysis` / `ArticleDuplicateAnalyses` pattern.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, autoincrement | |
| `articleId` | INTEGER, not null | FK to `Articles.id`, `onDelete: CASCADE` |
| `modelName` | STRING, not null | e.g. `sentence-transformers/all-MiniLM-L6-v2` |
| `embeddingDimension` | INTEGER, not null | 384 for the current model |
| `textHash` | STRING(64), not null | sha256 hex of the preprocessed text |
| `embedding` | BLOB (`bytea`), not null | float32 little-endian, normalized |
| `createdAt` / `updatedAt` | timestamps | |

Indexes:

1. A unique index on (`articleId`, `modelName`), named `idx_article_embeddings_article_id_model_name`.
2. The unique index also serves lookups by `articleId`.

### Registration

1. Add the init and export calls to `_index.ts`.
2. Add the association to `_associations.ts`: `Article.hasMany(ArticleEmbedding)` and `ArticleEmbedding.belongsTo(Article)`, with an explicit `onDelete: "CASCADE"`.
3. Add `ArticleEmbedding` to `MODEL_LOAD_ORDER` after `ArticleDuplicateAnalysis`. This keeps the list complete for schema tooling. Import skips the table anyway, because its CSV is never present.

### Backup exclusion list

- Export `BACKUP_EXCLUDED_MODELS: string[] = ["ArticleEmbedding"]` from db-models, either in a new `_backupPolicy.ts` or next to `MODEL_LOAD_ORDER`.
- Both backup implementations use this one list, so they cannot drift apart.

### Table creation

- `sequelize.sync()` creates the table when the api starts and after `rebuildSchema()`.
- worker-python does not create tables. It must handle the table being empty, and fail with a clear error if the table is missing.

## Component 2: Backup and Import

### Backup

Skip excluded models in both places:

1. `db-manager/src/modules/backup.ts`, in `createDatabaseBackupZipFile`:
   - Skip models in `BACKUP_EXCLUDED_MODELS`.
   - Do not add a manifest entry for them, so the manifest describes only the tables that were backed up.
2. `api/src/modules/adminDb` `createDatabaseBackupZipFile`: skip the same models.

### Import

- No change is needed. `zipImport.ts` skips any table without a CSV.
- After an import, `rebuildSchema()` drops the schema and `sync()` recreates `ArticleEmbeddings` empty. The next deduper run fills it, or an operator calls `POST /article-embeddings/jobs` ahead of time.

### Why the table is excluded

- json2csv would write a `bytea` value as `{"type":"Buffer",...}` text, and import would load that text as raw bytes. The embeddings would be corrupted.
- The table can always be regenerated from `ArticleApproveds.textForPdfReport`. A full fill takes an estimated 5–15 minutes on CPU.

## Component 3: worker-python Embeddings Module

### Location

The new package `worker-python/src/modules/article_embeddings/` is kept separate from `deduper/`, so the deduper and the standalone route can both use it.

| File | Purpose |
|---|---|
| `__init__.py` | Public exports |
| `text.py` | `preprocess_text(text)`, moved from `EmbeddingProcessor._preprocess_text`, and `text_hash(text)` |
| `encoder.py` | Lazy, process-wide `SentenceTransformer` loader (model name, `max_seq_length=256`) and batched encode |
| `repository.py` | All SQL for `ArticleEmbeddings` and approved article text |
| `service.py` | `ArticleEmbeddingService`: sync and load operations |
| `types.py` | `EmbeddingSyncMode`, `EmbeddingSyncSummary` |

### Repository

- The repository takes a psycopg connection, or reuses the deduper's connection-pool pattern. All SQL stays in this file.
- Key queries:
  1. `get_approved_article_texts()`: one query that returns `articleId` and `textForPdfReport` for every approved article, using the text selection rule below.
  2. `get_embedding_hashes(model_name)`: returns `articleId` and `textHash`, without the embedding bytes.
  3. `upsert_embeddings(rows)`: batched `INSERT ... ON CONFLICT ("articleId", "modelName") DO UPDATE`.
  4. `get_embeddings(article_ids, model_name)`: returns `articleId`, `embedding` and `embeddingDimension`.
  5. `delete_embeddings_not_in_approved(model_name)`: removes rows for articles that are no longer approved.

### Text selection

- Use the newest approved row per article: `DISTINCT ON ("articleId") ... WHERE "isApproved" = TRUE ORDER BY "articleId", id DESC`.
- Today's `get_article_content` uses `LIMIT 1` without `ORDER BY`. That picks an undefined row when an article has more than one approved row.
- The same rule is used everywhere this plan reads article text, including the content check in `EmbeddingProcessor`.

### Service API

```python
class ArticleEmbeddingService:
    def sync(
        self,
        mode: EmbeddingSyncMode = EmbeddingSyncMode.INCREMENTAL,
        should_cancel: Callable[[], bool] | None = None,
    ) -> EmbeddingSyncSummary: ...

    def load_embeddings(self, article_ids: Iterable[int]) -> dict[int, np.ndarray]: ...
```

`EmbeddingSyncMode.INCREMENTAL` (default):

1. Fetch every approved article's text in one query.
2. Preprocess and hash each text.
3. Fetch the stored `articleId` / `textHash` pairs.
4. Select articles that are missing, or whose stored hash differs from the current hash.
5. Encode the selected articles in batches (e.g. 64) and upsert them.
6. Delete rows for articles that are no longer approved.

This adds about 1–2 seconds per run when nothing needs encoding.

`EmbeddingSyncMode.REBUILD`:

1. Fetch and encode every approved article.
2. Upsert over existing rows.
3. Delete rows for articles that are no longer approved.

The rebuild never truncates first. Existing rows stay usable until they are replaced, so a cancelled rebuild leaves a valid table.

Other rules:

- Articles with a null `textForPdfReport` get no row. The deduper's content check handles them, as today.
- Text that is empty after preprocessing is stored as a zero vector. This matches today's behavior, where similarity becomes 0, and stops those articles from being picked up again on every run.
- Cancellation: check `should_cancel` between encode batches.
- The summary reports mode, approved articles, missing, stale, encoded, upserted, deleted and elapsed seconds.

### Configuration

Add these to the module's config:

1. `ARTICLE_EMBEDDINGS_BATCH_SIZE`, default 64.
2. `ARTICLE_EMBEDDINGS_MODEL_NAME`, default `sentence-transformers/all-MiniLM-L6-v2`.

Reuse the existing `PG_*` connection settings.

## Component 4: Deduper Integration

### New pipeline step

1. Add `PipelineStep.EMBEDDING_SYNC = "embedding_sync"`.
2. Insert it before `EMBEDDING` in both `run_analyze` and `run_analyze_fast`.
3. The step calls `ArticleEmbeddingService.sync(mode)` and returns the summary.
4. Skip it when `enable_embedding` is false, the same way the embedding step is skipped.
5. `run_analyze` and `run_analyze_fast` take a new `rebuild_embeddings: bool = False` argument. False maps to `INCREMENTAL` and true maps to `REBUILD`.

### EmbeddingProcessor changes

1. Read all analysis records once, as today.
2. Collect the distinct `articleIdNew` and `articleIdApproved` values.
3. Load their embeddings in one `load_embeddings` call.
4. Load which of those articles have content (non-null `textForPdfReport`) in one query, using the text selection rule. This keeps today's rules:
   - Both texts missing gives 1.0.
   - One text missing gives 0.0.
5. For each record, compute `np.dot` from the in-memory dict and clamp the result to [0, 1], as today.
6. Collect the scores and write them with the bulk write below.
7. Fallback: if an article has content but no stored embedding, for example one approved after the sync step ran, encode it then and upsert it through the service.
8. Remove the per-pair `get_article_content` calls and the in-processor cache. Keep `DEDUPER_CACHE_MAX_ENTRIES` for the content hash processor.

### Bulk score writes

Replace the body of `DeduperRepository.update_analysis_embedding_batch` with one statement per batch:

```sql
UPDATE "ArticleDuplicateAnalyses" AS a
SET "embeddingSearch" = v.score, "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES (%s::integer, %s::double precision), ...) AS v(id, score)
WHERE a.id = v.id
```

- Build the `VALUES` placeholders for the batch size and pass the values as parameters. Never put values into the SQL string.
- Commit once per batch through the existing `execute_insert` / `execute_many` connection handling, or a new `execute_statement` helper in the same repository.
- Raise the default `DEDUPER_BATCH_SIZE_EMBEDDING` from 100 to 5000. That is 10,000 parameters per statement, well under Postgres's 65,535 limit.
- The method signature and the input shape (`[{"id", "embeddingSearch"}]`) stay the same, so callers do not change.
- Expected effect: about 300 statements instead of about 15,000 groups of single-row updates. The stored scores are identical.

### Scoring

- The scores should be the same as today: same model, same preprocessing, same normalization, and the same dot product.
- Batched encoding may differ from single encoding by about 1e-6. That is far below any threshold.
- The only intended difference is the text selection rule, for articles that have more than one approved row.

## Component 5: worker-python Routes

### Deduper routes

1. Keep `GET /deduper/jobs` and `GET /deduper/jobs/reportId/{report_id}` unchanged. They now include the incremental sync step, and the api caller needs no change.
2. Add `POST /deduper/jobs` and `POST /deduper/jobs/reportId/{report_id}`.
   - Optional JSON body: `{ "rebuildEmbeddings": false }`.
   - Use a Pydantic request model.
   - With an empty body, they behave the same as the GET routes.
3. `JobManager.enqueue_deduper_job` takes `rebuild_embeddings: bool = False`.
   - It adds `rebuildEmbeddings` to the queue parameters only when true.
   - It passes the value to the runner.
4. The routes reuse the existing `DeduperClearBusyError` → 409 handling.

### Standalone embeddings route

1. Add a new router `src/routes/article_embeddings.py` with prefix `/article-embeddings`, and register it in `src/main.py`.
2. `POST /article-embeddings/jobs` takes the optional body `{ "mode": "incremental" | "rebuild" }`. The default is `incremental`.
3. A `JobManager` method, or a small new job builder in the module, enqueues the job on the shared queue under endpoint name `/article-embeddings/start-job`.
4. Job status is read through the existing queue-info routes.
5. The shared queue runs one job at a time, so a sync job and a deduper job never write the table at once.

## Component 6: Tests

The worker-python tests run against a real Postgres test schema built by hand in each test file. Tests that touch embeddings must add the `ArticleEmbeddings` DDL to that schema.

### worker-python (pytest)

1. `text.py`: preprocessing matches the old `_preprocess_text` output, and the hash is stable.
2. Service with a fake encoder:
   - Incremental mode encodes only missing articles and articles whose text changed.
   - Incremental mode encodes nothing when every hash matches.
   - Rebuild mode overwrites rows and removes rows for articles no longer approved.
   - The newest approved row is used when an article has two approved rows.
   - Empty text is stored as a zero vector, and null text gets no row.
   - Cancellation stops between batches.
3. `EmbeddingProcessor`:
   - The existing `test_embedding_processor_with_fake_model` still passes.
   - Same scores with stored embeddings as with on-the-fly encoding.
   - Fallback encode for an article with no stored embedding.
4. Bulk writes: `update_analysis_embedding_batch` updates every row in a batch, including a batch smaller than the batch size and an empty batch.
5. Orchestrator: `embedding_sync` runs before `embedding` and is skipped when embedding is disabled.
6. Routes:
   - The GET routes are unchanged.
   - The POST routes accept and validate the body.
   - `/article-embeddings/jobs` enqueues a job with the requested mode.

### db-manager (Jest)

1. `backup.test.ts`: excluded models produce no CSV and no manifest entry.
2. `zipImport.test.ts`: a zip without `ArticleEmbedding.csv` imports successfully.

### api (Jest)

1. `adminDb.module.test.ts`: the backup skips excluded models.

## Component 7: Docs

1. worker-python API docs in `worker-python/docs/worker-python-api-documentation/`: the new POST deduper routes and `/article-embeddings/jobs`.
2. `worker-python/AGENTS.md`: add the `article_embeddings` module to the runtime entry points.
3. `docs/api-documentation/endpoints/admin-db.md`: note that the backup excludes `ArticleEmbeddings` and that the table is regenerated after an import.
4. `db-manager/AGENTS.md`: the same note for `--create_backup` and `--zip_file`.
5. worker-python env docs or `.env` example: `ARTICLE_EMBEDDINGS_BATCH_SIZE`, `ARTICLE_EMBEDDINGS_MODEL_NAME`, and the new `DEDUPER_BATCH_SIZE_EMBEDDING` default.

## Rollout

1. Build and deploy db-models. The api restarts and `sync()` creates `ArticleEmbeddings`.
2. Deploy db-manager, api and worker-python.
3. Check that no production `.env` pins `DEDUPER_BATCH_SIZE_EMBEDDING` to 100. If one does, raise it or remove it.
4. Before the next weekly run, during a quiet window, call `POST /article-embeddings/jobs` once to fill the table.
5. Run a deduper job for a known report. Compare `embeddingSearch` values and the Excel output with the previous run.
6. After any database import, run step 4 again, or let the next deduper run fill the table.

## Risks

1. Text selection change: the newest approved row may differ from today's undefined `LIMIT 1` pick. This only affects articles with more than one approved row, and it is an accepted change.
2. Memory:
   - The embeddings take about 15 MB (10k × 384 float32).
   - The approved texts during sync take about 10–20 MB.
   - The 1.5M collected scores take tens of MB.
   - None of this is a concern.
3. Model download: the first encode in a fresh environment downloads the model, same as today.
4. Remaining slow steps: the states and url_check steps still query and write per pair. The whole job will speed up a lot, but not to minutes. See open question 1.

## Open Questions

### 1. Bulk writes for other steps

The states and url_check steps also make per-pair queries and per-row `executemany` writes for about 1.5M rows. Should they get the same treatment in this plan, or in a follow-up plan?

#### Operator Response

Let's tackle this as a follow-up plan, after this change is measured, so the embeddings work ships and can be checked by itself.
