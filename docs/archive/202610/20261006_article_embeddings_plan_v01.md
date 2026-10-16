---
created_at: 2026-10-06T20:48:28Z
updated_at: 2026-10-06T22:17:31Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Article Embeddings Plan v01

## Goal

Store one sentence embedding per approved article in a new `ArticleEmbeddings` table. The deduper should load stored embeddings instead of encoding articles during every pair comparison.

- The default run embeds only articles that have no stored embedding.
- An optional flag rebuilds every embedding.
- The table population lives in a reusable worker-python module, so a later endpoint can manage the table without running the full deduper.

Background: `docs/20261006_deduper_claude_ideas.md`, idea 2.

## Current State

1. The portal calls api `GET /analysis/deduper/request-job/:reportId`. The api then calls worker-python `GET /deduper/jobs/reportId/{report_id}`.
2. `JobManager._build_deduper_runner` runs `DeduperOrchestrator.run_analyze_fast`. The steps are load, states, url_check and embedding. `run_analyze` adds content_hash.
3. For each pair, `EmbeddingProcessor` does the following:
   - It calls `get_article_content` twice, which is two queries.
   - It encodes each article one at a time with `all-MiniLM-L6-v2`.
   - It caches encodings in memory, capped by `DEDUPER_CACHE_MAX_ENTRIES` (default 10000).
4. There are now more than 10,000 approved articles, so the cache clears during a run and the same articles get encoded again. This is the likely cause of the ~125 ms per pair.
5. The api writes the Excel output later, from `ArticleDuplicateAnalyses.embeddingSearch`. The api, the portal and the Excel generation are out of scope.

## Scope

In scope:

1. db-models: a new `ArticleEmbedding` model and a shared backup exclusion list.
2. db-manager and api: both backup functions skip excluded models.
3. worker-python: a new `article_embeddings` module, deduper integration, and new POST routes.
4. Tests and docs for each changed package.

Out of scope:

1. Comparing only likely candidates (idea 3).
2. Removing the per-pair queries in the states, url_check and content_hash processors (idea 1).
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
| `textHash` | STRING(64), not null | sha256 of the preprocessed text |
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
- After an import, `rebuildSchema()` drops the schema and `sync()` recreates `ArticleEmbeddings` empty. The next deduper run fills it, or an operator triggers a fill ahead of time.

### Why the table is excluded

- json2csv would write a `bytea` value as `{"type":"Buffer",...}` text, and import would load that text as raw bytes. The embeddings would be corrupted.
- The table can always be regenerated from `ArticleApproveds.textForPdfReport`. A full fill takes an estimated 5–15 minutes on CPU.

## Component 3: worker-python Embeddings Module

### Location

The new package `worker-python/src/modules/article_embeddings/` is kept separate from `deduper/`, so other workflows and routes can reuse it.

| File | Purpose |
|---|---|
| `__init__.py` | Public exports |
| `text.py` | `preprocess_text(text)`, moved from `EmbeddingProcessor._preprocess_text`, and `text_hash(text)` |
| `encoder.py` | Lazy, process-wide `SentenceTransformer` loader (model name, `max_seq_length=256`) and batched encode |
| `repository.py` | All SQL for `ArticleEmbeddings` |
| `service.py` | `ArticleEmbeddingService`: sync and load operations |
| `types.py` | `EmbeddingSyncMode`, `EmbeddingSyncSummary` |

### Repository

- The repository takes a psycopg connection, or reuses the deduper's connection-pool pattern. All SQL stays in this file.
- Key queries:
  1. `get_approved_article_ids_missing_embedding(model_name)`: an anti-join from approved articles to `ArticleEmbeddings`.
  2. `get_approved_article_texts(article_ids)`: one query that returns `articleId` and `textForPdfReport`.
  3. `upsert_embeddings(rows)`: batched `INSERT ... ON CONFLICT ("articleId", "modelName") DO UPDATE`.
  4. `get_embeddings(article_ids, model_name)`: returns `articleId`, `embedding` and `embeddingDimension`.
  5. `delete_embeddings_not_in_approved(model_name)`: cleanup after a rebuild.

### Text selection

- Today `get_article_content` uses `WHERE "isApproved" = TRUE LIMIT 1` without `ORDER BY`. That picks an undefined row if an article has more than one approved row.
- The new query uses `DISTINCT ON ("articleId") ... ORDER BY "articleId", id DESC`, so it picks the newest approved row.
- See open question 2.

### Service API

```python
class ArticleEmbeddingService:
    def sync(
        self,
        mode: EmbeddingSyncMode = EmbeddingSyncMode.MISSING,
        should_cancel: Callable[[], bool] | None = None,
    ) -> EmbeddingSyncSummary: ...

    def load_embeddings(self, article_ids: Iterable[int]) -> dict[int, np.ndarray]: ...
```

- `EmbeddingSyncMode.MISSING` (default):
  1. Run the anti-join query.
  2. Fetch the texts.
  3. Preprocess and hash each one.
  4. Encode in batches (e.g. 64).
  5. Upsert.
- `EmbeddingSyncMode.REBUILD`:
  1. Fetch and encode every approved article.
  2. Upsert over existing rows.
  3. Delete rows for articles that are no longer approved.
- The rebuild never truncates first. Existing rows stay usable until they are replaced, so a cancelled rebuild leaves a valid table.
- Text that is empty after preprocessing is stored as a zero vector. This matches today's behavior, where similarity becomes 0, and stops those articles from showing up as missing on every run.
- Cancellation: check `should_cancel` between encode batches.
- The summary reports mode, candidates, encoded, upserted, deleted and elapsed seconds.

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
5. `run_analyze` and `run_analyze_fast` take a new `rebuild_embeddings: bool = False` argument, which maps to the sync mode.

### EmbeddingProcessor changes

1. Read all analysis records once, as today.
2. Collect the distinct `articleIdNew` and `articleIdApproved` values.
3. Load their embeddings in one `load_embeddings` call.
4. Load which of those articles have content (non-null `textForPdfReport`) in one query. This keeps today's rules:
   - Both texts missing gives 1.0.
   - One text missing gives 0.0.
5. For each record, compute `np.dot` from the in-memory dict and clamp the result to [0, 1], as today.
6. Write the results with the existing `update_analysis_embedding_batch`.
7. Fallback: if an article has content but no stored embedding, for example one approved after the sync step ran, encode it then and upsert it through the service.
8. Remove the per-pair `get_article_content` calls and the in-processor cache. Keep `DEDUPER_CACHE_MAX_ENTRIES` for the content hash processor.

### Scoring

- The scores should be the same as today: same model, same preprocessing, same normalization, and the same dot product.
- Batched encoding may differ from single encoding by about 1e-6. That is far below any threshold.

### Remaining bottleneck

- About 1.5M single-row `UPDATE`s through `executemany` at batch size 100 will probably dominate the run time after this change.
- This plan does not change the write path. See open question 4.

## Component 5: worker-python Routes

### Deduper routes

1. Keep `GET /deduper/jobs` and `GET /deduper/jobs/reportId/{report_id}` unchanged. They now include the missing-only sync step, and the api caller needs no change.
2. Add `POST /deduper/jobs` and `POST /deduper/jobs/reportId/{report_id}`.
   - Optional JSON body: `{ "rebuildEmbeddings": false }`.
   - Use a Pydantic request model.
   - With an empty body, they behave the same as the GET routes.
3. `JobManager.enqueue_deduper_job` takes `rebuild_embeddings: bool = False`.
   - It adds `rebuildEmbeddings` to the queue parameters only when true.
   - It passes the value to the runner.
4. The routes reuse the existing `DeduperClearBusyError` → 409 handling.

### Standalone embeddings route (reuse of the module)

1. Add a new router `src/routes/article_embeddings.py` with prefix `/article-embeddings`.
2. `POST /article-embeddings/jobs` takes the optional body `{ "mode": "missing" | "rebuild" }`. The default is `missing`.
3. It enqueues the job on the shared queue under endpoint name `/article-embeddings/start-job`.
4. Job status is read through the existing queue-info routes.
5. The shared queue runs one job at a time, so a sync job and a deduper job never write the table at once.

## Component 6: Tests

### worker-python (pytest)

1. `text.py`: preprocessing matches the old `_preprocess_text` output, and the hash is stable.
2. Service with a fake encoder:
   - Missing mode encodes only the missing articles.
   - Rebuild mode overwrites rows and removes rows for articles no longer approved.
   - Empty text is stored as a zero vector.
   - Cancellation stops between batches.
3. `EmbeddingProcessor`:
   - The existing `test_embedding_processor_with_fake_model` still passes.
   - Same scores with stored embeddings as with on-the-fly encoding.
   - Fallback encode for an article with no stored embedding.
4. Orchestrator: `embedding_sync` runs before `embedding` and is skipped when embedding is disabled.
5. Routes:
   - The GET routes are unchanged.
   - The POST routes accept and validate the body.
   - `/article-embeddings/jobs` enqueues a job.

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

## Rollout

1. Build and deploy db-models. The api restarts and `sync()` creates `ArticleEmbeddings`.
2. Deploy db-manager, api and worker-python.
3. Before the next weekly run, during a quiet window, call `POST /article-embeddings/jobs` once to fill the table.
4. Run a deduper job for a known report. Compare `embeddingSearch` values and the Excel output with the previous run.
5. After any database import, run step 3 again, or let the next deduper run fill the table.

## Risks

1. Text selection change: `DISTINCT ON ... ORDER BY id DESC` may pick a different row than today's undefined `LIMIT 1` for articles with more than one approved row. Rare, but it can change scores.
2. Stale embeddings: default mode does not detect edited `textForPdfReport`. `textHash` makes later detection cheap. See open question 1.
3. Memory: 10k × 384 float32 is about 15 MB. Negligible.
4. Model download: the first encode in a fresh environment downloads the model, same as today.
5. Write path: run time after the change depends mostly on the 1.5M analysis-row updates. See open question 4.

## Open Questions

### 1. Detect edited article text

Should missing mode also re-embed articles whose `textHash` no longer matches the current text? It adds about 1–2 seconds per run.

#### Operator Response

Yes

### 2. Text row selection rule

When an article has more than one approved `ArticleApproveds` row, should the newest row (`ORDER BY id DESC`) be used?

#### Operator Response

Use the newest row

### 3. Standalone route in this phase

Should `POST /article-embeddings/jobs` ship with this plan, or wait until it is needed?

#### Operator Response

Ship with this plan

### 4. Speed up analysis row writes

Should this plan also replace the per-row `executemany` updates with a bulk `UPDATE ... FROM (VALUES ...)` or a temp-table `COPY`?

What this means in plain terms:

- After the deduper computes a similarity score for a pair, it saves the score into that pair's row in `ArticleDuplicateAnalyses`.
- There are about 1.5M pairs, so it saves about 1.5M scores.
- Today it sends one save instruction per row, grouped 100 at a time, with a commit after each group. That is about 15,000 round trips to the database.
- It is like mailing 1.5M letters one at a time instead of handing the post office one big box.

Why it matters after this plan:

- Today the embedding work is so slow (about 125 ms per pair) that the time spent saving is hidden.
- Once embeddings are stored, computing a score takes microseconds. Saving the scores becomes the slowest remaining part.
- Rough guess: tens of minutes to about an hour for the saves alone. A timed run would confirm it.

The two faster options:

1. Bulk update: send thousands of scores in one instruction, as a list of (row id, score) pairs that the database matches to rows in one pass.
2. Temp table copy: stream all scores into a temporary table with Postgres `COPY`, which is its fastest loading path. Then one statement copies them into `ArticleDuplicateAnalyses`.

Either option could cut the save time to a few minutes. The saved scores stay exactly the same; only how they are sent changes.

#### Operator Response

Use batched `UPDATE ... FROM (VALUES ...)`. It is less complex and risky than a temporary-table `COPY`, while preserving the same scores and functionality.
