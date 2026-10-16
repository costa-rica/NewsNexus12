---
created_at: 2026-10-06T22:34:23Z
updated_at: 2026-10-06T22:34:23Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Article Embeddings Plan v06

## Changes From v05

This version addresses `docs/20261006_article_embeddings_plan_v05_assessment_codex.md`.

1. Embeddings now follow the current text. A row exists only while the article's selected approved text is non-null, so a row is removed when its text becomes null, not only when the article stops being approved.
2. Sync cleanup uses one rule in both modes: `delete_embeddings_without_current_text(model_name)` replaces `delete_embeddings_not_in_approved`.
3. `ensure_embeddings()` checks the current selected text before returning anything:
   - Rows with a changed hash are re-encoded.
   - Rows whose text is now null are deleted and left out.
4. `EmbeddingProcessor` drops its separate content query. An article has content exactly when it is a key in the dictionary that `ensure_embeddings()` returns.
5. Tests cover text changing from non-null to null.

## Changes From v04

This version addresses `docs/20261006_article_embeddings_plan_v04_assessment_codex.md`.

1. The bulk score write uses a new `DeduperRepository.execute_statement(query, params)` helper. The option to use `execute_insert()` or `execute_many()` is removed.
2. `execute_insert()` cannot be used: it calls `cursor.fetchone()` after committing, which raises on an `UPDATE` with no `RETURNING`.
3. A test confirms one bulk statement succeeds and returns the updated row count.

## Changes From v03

This version addresses `docs/20261006_article_embeddings_plan_v03_assessment_codex.md`.

1. Cancellation mapping rule: every caller of the embeddings service that passes `should_cancel` converts `ArticleEmbeddingsCancelledError` into the error its own runner treats as a cancel.
2. `EmbeddingProcessor` now converts the module's cancel error around its `ensure_embeddings()` call, as `EmbeddingSyncProcessor` already does.
3. The standalone job runner converts the module's cancel error into `QueueJobCanceledError`, so the queue marks the job `canceled`, not `failed`.
4. Tests cover cancellation during `ensure_embeddings()` and during a standalone sync, checked at the queue job status.

## Changes From v02

This version addresses `docs/20261006_article_embeddings_plan_v02_assessment_codex.md`.

1. Step result contract: the deduper's sync step returns a dictionary with `processed`, because the orchestrator calls `result.get("processed", 0)` on every step.
2. Cancellation contract: the module raises its own cancel error. The deduper step translates it to `DeduperProcessorError`, which the orchestrator treats as cancelled.
3. Bounded memory: `EmbeddingProcessor` reads analysis records in id-ordered pages and writes each page's scores before reading the next. It never holds all 1.5M records or scores at once.
4. Fallback API: the service adds `ensure_embeddings(article_ids)`, so the processor's fallback does not reach into repository or encoder internals.
5. Open question 1 is resolved: the states and url_check speed-up is a follow-up plan.

## Changes From v01

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
2. Removing the per-pair queries and per-row writes in the states, url_check and content_hash processors (idea 1). The operator chose a follow-up plan, after this change is measured.
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
  5. `get_selected_texts(article_ids)`: the same text selection for a given list of IDs. Used by `ensure_embeddings()`.
  6. `delete_embeddings_without_current_text(model_name)`: deletes rows whose article has no selected non-null text. This covers both cases:
     - The article is no longer approved.
     - Its selected `textForPdfReport` is now null.

     Write it as a `DELETE ... WHERE "articleId" NOT IN (...)` over the text selection subquery, filtered to non-null text.
  7. `delete_embeddings(article_ids, model_name)`: deletes specific rows. Used by `ensure_embeddings()`.

### Text selection

- Use the newest approved row per article: `DISTINCT ON ("articleId") ... WHERE "isApproved" = TRUE ORDER BY "articleId", id DESC`.
- Today's `get_article_content` uses `LIMIT 1` without `ORDER BY`. That picks an undefined row when an article has more than one approved row.
- The same rule is used everywhere this plan reads article text: sync, cleanup and `ensure_embeddings()`.

### Row lifecycle rule

An `ArticleEmbeddings` row for the current model exists only while all of these are true:

1. The article has an approved row.
2. Its selected (newest) approved row has non-null `textForPdfReport`.
3. The stored `textHash` matches the hash of that text after preprocessing.

`sync()` enforces this for the whole table. `ensure_embeddings()` enforces it for the IDs it is given.

### Service API

```python
class ArticleEmbeddingService:
    def sync(
        self,
        mode: EmbeddingSyncMode = EmbeddingSyncMode.INCREMENTAL,
        should_cancel: Callable[[], bool] | None = None,
    ) -> EmbeddingSyncSummary: ...

    def load_embeddings(self, article_ids: Iterable[int]) -> dict[int, np.ndarray]: ...

    def ensure_embeddings(
        self,
        article_ids: Iterable[int],
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict[int, np.ndarray]: ...
```

- `sync()` manages the whole table. The standalone route and the deduper's sync step call it.
- `load_embeddings()` reads stored rows only and never encodes.
- `ensure_embeddings()` serves callers that need specific articles. It never trusts a stored row without checking the current text:
  1. Fetch the current selected text for the given IDs with `get_selected_texts`, then preprocess and hash it.
  2. Load the stored rows for the IDs.
  3. IDs whose text is null or missing: delete any stored row and leave the ID out of the result.
  4. IDs with no stored row, or with a stored hash that differs: encode and upsert them.
  5. Return a dictionary with one entry for every ID that has non-null text. Empty text after preprocessing is included, as a zero vector.
- Callers never touch the repository or encoder directly.

`EmbeddingSyncMode.INCREMENTAL` (default):

1. Fetch every approved article's text in one query.
2. Preprocess and hash each text.
3. Fetch the stored `articleId` / `textHash` pairs.
4. Select articles that are missing, or whose stored hash differs from the current hash.
5. Encode the selected articles in batches (e.g. 64) and upsert them.
6. Call `delete_embeddings_without_current_text`.

This adds about 1–2 seconds per run when nothing needs encoding.

`EmbeddingSyncMode.REBUILD`:

1. Fetch and encode every approved article.
2. Upsert over existing rows.
3. Call `delete_embeddings_without_current_text`.

The rebuild never truncates first. Existing rows stay usable until they are replaced, so a cancelled rebuild leaves a valid table.

Other rules:

- Articles with a null `textForPdfReport` get no row, and an existing row is deleted when the text becomes null. See "Row lifecycle rule".
- Text that is empty after preprocessing is stored as a zero vector. This matches today's behavior, where similarity becomes 0, and stops those articles from being picked up again on every run.
- Cancellation: check `should_cancel` between encode batches. On cancel, raise `ArticleEmbeddingsCancelledError`, defined in the module's own `errors.py`. The module does not import deduper errors.
- `EmbeddingSyncSummary` is a dataclass with mode, approved articles, missing, stale, encoded, upserted, deleted and elapsed seconds.
- It also has `to_dict()`, which returns those fields plus `processed`, set to the encoded count. Routes and pipeline steps use this dictionary.

### Cancellation mapping

- The module raises only `ArticleEmbeddingsCancelledError` on cancel. It never imports deduper or queue errors.
- Every caller that passes `should_cancel` to `sync()` or `ensure_embeddings()` must convert that error into the cancel error its own runner expects:

| Caller | Converts to | Then handled by |
|---|---|---|
| `EmbeddingSyncProcessor` (deduper step) | `DeduperProcessorError` | Orchestrator marks the run cancelled. `JobManager` raises `QueueJobCanceledError`. |
| `EmbeddingProcessor` (`ensure_embeddings` call) | `DeduperProcessorError` | Same as above. |
| Standalone job runner | `QueueJobCanceledError` | Queue engine marks the job `canceled`. |

- Without this mapping, the error reaches the queue engine as a general exception, and a cancelled job is recorded as `failed`.

### Configuration

Add these to the module's config:

1. `ARTICLE_EMBEDDINGS_BATCH_SIZE`, default 64.
2. `ARTICLE_EMBEDDINGS_MODEL_NAME`, default `sentence-transformers/all-MiniLM-L6-v2`.

Reuse the existing `PG_*` connection settings.

## Component 4: Deduper Integration

### New pipeline step

1. Add `PipelineStep.EMBEDDING_SYNC = "embedding_sync"`.
2. Insert it before `EMBEDDING` in both `run_analyze` and `run_analyze_fast`.
3. The step is a small wrapper, for example `EmbeddingSyncProcessor` in `deduper/processors/embedding_sync.py`. This matches the other steps. The wrapper:
   - Calls `ArticleEmbeddingService.sync(mode, should_cancel)`.
   - Returns `summary.to_dict()`. The orchestrator reads every step result with `result.get("processed", 0)`, so the step must return a dictionary.
   - Catches `ArticleEmbeddingsCancelledError` and raises `DeduperProcessorError("Embedding sync cancelled")`. The orchestrator and `JobManager` treat that error as a cancel.
4. Skip it when `enable_embedding` is false, the same way the embedding step is skipped.
5. `run_analyze` and `run_analyze_fast` take a new `rebuild_embeddings: bool = False` argument. False maps to `INCREMENTAL` and true maps to `REBUILD`.

### EmbeddingProcessor changes

Setup, once per run:

1. Get the distinct article IDs in the analysis table with one query: the union of `articleIdNew` and `articleIdApproved`. This is about 10k IDs.
2. Call `ensure_embeddings(ids, should_cancel)` once.
   - Wrap the call: catch `ArticleEmbeddingsCancelledError` and raise `DeduperProcessorError("Embedding processor cancelled")`. This matches the message the processor already uses for cancels. See "Cancellation mapping".
   - Embeddings already stored by the sync step are simply loaded.
   - An article with content but no stored or current embedding, for example one approved or edited after the sync step ran, is encoded and stored here. This is the fallback.
   - The result is held in memory, about 15 MB.
3. An article has content exactly when its ID is a key in the returned dictionary. No separate content query is needed. This keeps today's rules:
   - Both articles missing from the dictionary gives 1.0.
   - One article missing from the dictionary gives 0.0.
   - Both present gives the clamped dot product.

Scoring, page by page:

4. Read analysis records in id-ordered pages of `DEDUPER_BATCH_SIZE_EMBEDDING` rows. Use a new repository method `get_analysis_records_for_embedding_update_page(after_id, limit)`:
   - `WHERE "embeddingSearch" = 0 AND id > %s ORDER BY id LIMIT %s`.
   - Keyset paging by `id` means rows whose score is legitimately 0 are not read again.
5. For each record in the page, compute `np.dot` from the in-memory dictionary and clamp the result to [0, 1], as today.
6. Write the page's scores with the bulk write below. Discard the page before reading the next one.
7. Check `should_cancel` between pages, as the current processor does at its checkpoint interval.

Memory stays bounded: at most one page of records and scores, plus the embedding dictionary. The processor never holds all 1.5M records or scores.

Cleanup:

8. Remove the per-pair `get_article_content` calls and the in-processor cache. Keep `DEDUPER_CACHE_MAX_ENTRIES` for the content hash processor.
9. Remove `get_analysis_records_for_embedding_update` if nothing else uses it.
10. Keep `get_embedding_processing_stats` and the returned `processed` count, so the step result is unchanged.

### Bulk score writes

Replace the body of `DeduperRepository.update_analysis_embedding_batch` with one statement per batch:

```sql
UPDATE "ArticleDuplicateAnalyses" AS a
SET "embeddingSearch" = v.score, "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES (%s::integer, %s::double precision), ...) AS v(id, score)
WHERE a.id = v.id
```

- Build the `VALUES` placeholders for the batch size and pass the values as parameters. Never put values into the SQL string.
- Run each batch through a new helper in `DeduperRepository`:

```python
def execute_statement(self, query: str, params: tuple = ()) -> int:
    # Executes once, commits, returns cursor.rowcount. Never fetches a row.
```

- It follows the error handling of `execute_many`: it wraps `psycopg.Error` in `DeduperDatabaseError`.
- Do not use `execute_insert()`. It calls `cursor.fetchone()` after the commit, which raises on an `UPDATE` without `RETURNING`.
- Do not use `execute_many()`. It runs one parameter tuple per execution, which is the per-row pattern this change replaces.
- `update_analysis_embedding_batch` returns the row count from `execute_statement`.
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
   - The runner calls `sync(mode, should_cancel=context.is_cancel_requested)` and stores `summary.to_dict()` as the job result.
   - It catches `ArticleEmbeddingsCancelledError` and raises `QueueJobCanceledError`, so the job ends as `canceled`.
   - Like the deduper runner, it raises `QueueJobCanceledError` if a cancel was requested after sync returned.
   - Other errors propagate, so the job ends as `failed`.
   - The existing `POST /queue-info/cancel-job/{job_id}` route works unchanged, because cancellation goes through the shared queue.
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
   - Text changing from non-null to null: after sync, the article's row is deleted.
   - The newest approved row is used when an article has two approved rows.
   - Empty text is stored as a zero vector, and null text gets no row.
   - Cancellation stops between batches and raises `ArticleEmbeddingsCancelledError`.
   - `to_dict()` includes `processed`.
   - `ensure_embeddings` returns stored rows without encoding when hashes match, and encodes and stores only missing or changed IDs.
   - `ensure_embeddings` with an ID whose text changed from non-null to null deletes the stored row and leaves the ID out of the result.
3. `EmbeddingSyncProcessor`: returns a dictionary with `processed`, and turns a module cancel into `DeduperProcessorError`.
4. `EmbeddingProcessor`:
   - The existing `test_embedding_processor_with_fake_model` still passes.
   - Same scores with stored embeddings as with on-the-fly encoding.
   - Fallback encode for an article with no stored embedding.
   - Cancellation during `ensure_embeddings()` raises `DeduperProcessorError`, not the module error.
   - With a page size smaller than the record count, every record is scored exactly once.
   - Rows whose score is 0 are not read again.
   - Bounded memory: a spy on the bulk write sees several calls, none larger than the page size.
5. Bulk writes:
   - `execute_statement` runs one bulk `UPDATE ... FROM (VALUES ...)` without error and returns the updated row count.
   - `update_analysis_embedding_batch` updates every row in a batch and returns the matching count. This includes a batch smaller than the batch size, and an empty batch, which returns 0 without querying.
6. Orchestrator: `embedding_sync` runs before `embedding`, is skipped when embedding is disabled, and a cancel during sync marks the run cancelled.
7. Routes:
   - The GET routes are unchanged.
   - The POST routes accept and validate the body.
   - `/article-embeddings/jobs` enqueues a job with the requested mode.
8. Queue job cancellation, checked at the queue job status:
   - A deduper job cancelled during `ensure_embeddings()` ends as `canceled`, not `failed`.
   - A deduper job cancelled during the sync step ends as `canceled`.
   - A standalone embeddings job cancelled during sync ends as `canceled`.
   - A standalone job whose sync raises an unrelated error ends as `failed`.

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
   - The analysis records and scores are capped at one page, about 5,000 rows.
   - None of this is a concern.
3. Model download: the first encode in a fresh environment downloads the model, same as today.
4. Remaining slow steps: the states and url_check steps still query and write per pair. The whole job will speed up a lot, but not to minutes. A follow-up plan covers these steps.

## Open Questions

None at this time. The v02 question about the states and url_check steps is resolved: they will be handled in a follow-up plan, after this change is measured.
