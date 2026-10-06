---
created_at: 2026-10-06T22:40:48Z
updated_at: 2026-10-06T22:40:48Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Article Embeddings Todo v01

Source plan: `docs/20261006_article_embeddings_plan_v06.md`. Read the plan before starting. Each task names the plan section it implements.

## Ground Rules

1. Work through the phases in order. Later phases depend on earlier ones.
2. Do not change scoring behavior beyond what the plan allows. The only accepted difference is the newest-approved-row text rule.
3. worker-python tests use a real Postgres database. Before running them, confirm `PG_DATABASE` points at the disposable test database (default `newsnexus_test_worker_python`), never a shared or production database.
4. Keep SQL in repository modules and route handlers thin, per `worker-python/AGENTS.md`.
5. Do not print credentials or database passwords.

### End of every phase

Run these for every package changed in the phase:

| Package | Type / lint | Tests | Build |
|---|---|---|---|
| db-models | `npm run build` (tsc type check) | none configured | `npm run build` |
| db-manager | `npx tsc --noEmit` | `npm test` | `npm run build` |
| api | `npx tsc --noEmit -p tsconfig.json` | `npm test` | `npm run build` |
| worker-python | `./venv/bin/python -m compileall -q src` | `./venv/bin/pytest` | none |

1. If a check fails, fix the code so the intended behavior stays and the check passes. Do not weaken or delete existing tests to make them pass.
2. Check off every completed task in this file.
3. Commit the phase's changes. Follow the commit guidance in the root `AGENTS.md`:
   - Lowercase title, max 50 characters.
   - Reference this file and the phase, e.g. `feat: article embeddings todo phase 1`.
   - End with `co-authored-by: <agent name> (<model>)`.

## Phase 1: db-models

Plan: Component 1.

- [ ] Create `db-models/src/models/ArticleEmbedding.ts` following the `ArticleDuplicateAnalysis.ts` pattern:
  - [ ] Columns `id`, `articleId`, `modelName`, `embeddingDimension`, `textHash` (`STRING(64)`), `embedding` (`DataTypes.BLOB`), all not null except `id`.
  - [ ] `modelName: "ArticleEmbedding"`, `tableName: "ArticleEmbeddings"`, `timestamps: true`.
  - [ ] Unique index `idx_article_embeddings_article_id_model_name` on (`articleId`, `modelName`).
- [ ] Register in `db-models/src/models/_index.ts`: import, call `initArticleEmbedding()` in `initModels()`, and export the model.
- [ ] Add associations in `_associations.ts`: `Article.hasMany(ArticleEmbedding, { foreignKey: "articleId", onDelete: "CASCADE" })` and the matching `belongsTo`.
- [ ] Add `"ArticleEmbedding"` to `MODEL_LOAD_ORDER` in `_loadOrder.ts`, after `"ArticleDuplicateAnalysis"`.
- [ ] Add and export `BACKUP_EXCLUDED_MODELS: string[] = ["ArticleEmbedding"]`, in a new `_backupPolicy.ts` or next to `MODEL_LOAD_ORDER`. Make sure the package entry point exports it.
- [ ] Verify against a local dev database: run the api's normal startup, or a short script calling `initModels()` and `sequelize.sync()`. Confirm `ArticleEmbeddings` exists with a `bytea` `embedding` column and the unique index.
- [ ] End-of-phase checks for db-models. Then rebuild so db-manager and api pick up the new `dist/`.
- [ ] Check off tasks and commit.

## Phase 2: Backup Exclusion

Plan: Component 2.

- [ ] `db-manager/src/modules/backup.ts`: in `createDatabaseBackupZipFile`, skip any model in `BACKUP_EXCLUDED_MODELS`. Add no CSV and no manifest entry for it.
- [ ] `api/src/modules/adminDb` `createDatabaseBackupZipFile`: skip the same models.
- [ ] Confirm `db-manager/src/modules/zipImport.ts` needs no change: a missing `ArticleEmbedding.csv` is skipped by the `MODEL_LOAD_ORDER` loop.
- [ ] Tests, db-manager `tests/modules/backup.test.ts`: an excluded model in the mocked registry produces no CSV and no manifest entry. Update the existing model-count assertion only if the mock registry changes.
- [ ] Tests, db-manager `tests/modules/zipImport.test.ts`: a zip without `ArticleEmbedding.csv` imports successfully.
- [ ] Tests, api `tests/modules/adminDb.module.test.ts`: the backup skips excluded models.
- [ ] End-of-phase checks for db-manager and api.
- [ ] Check off tasks and commit.

## Phase 3: worker-python Embeddings Module

Plan: Component 3.

- [ ] Create `worker-python/src/modules/article_embeddings/` with `__init__.py`, `errors.py`, `types.py`, `config.py`, `text.py`, `encoder.py`, `repository.py` and `service.py`.
- [ ] `errors.py`: `ArticleEmbeddingsError` (base), `ArticleEmbeddingsCancelledError` and `ArticleEmbeddingsDatabaseError`. Import nothing from `deduper` or `queue`.
- [ ] `types.py`:
  - [ ] `EmbeddingSyncMode` (`StrEnum`: `incremental`, `rebuild`).
  - [ ] `EmbeddingSyncSummary` dataclass: mode, approved articles, missing, stale, encoded, upserted, deleted, elapsed seconds.
  - [ ] `to_dict()` returns those fields plus `processed` (equal to encoded).
- [ ] `config.py`: read `ARTICLE_EMBEDDINGS_BATCH_SIZE` (default 64) and `ARTICLE_EMBEDDINGS_MODEL_NAME` (default `sentence-transformers/all-MiniLM-L6-v2`). Reuse the `PG_*` settings, following `deduper/config.py` validation style.
- [ ] `text.py`:
  - [ ] Move `_preprocess_text` from `EmbeddingProcessor` as `preprocess_text(text)`, with identical behavior.
  - [ ] Add `text_hash(text)`, the sha256 hex digest of the preprocessed text.
- [ ] `encoder.py`:
  - [ ] Lazy, process-wide `SentenceTransformer` loader with `max_seq_length = 256`.
  - [ ] `encode_batch(texts)` with `normalize_embeddings=True`, returning float32 arrays.
  - [ ] Empty text yields a zero vector of the model dimension.
  - [ ] Raise a clear error if `sentence-transformers` or `numpy` is missing.
- [ ] `repository.py`, using the deduper's psycopg pool pattern. All SQL here:
  - [ ] `get_approved_article_texts()`: newest approved row per article (`DISTINCT ON ("articleId") ... ORDER BY "articleId", id DESC`).
  - [ ] `get_selected_texts(article_ids)`: the same selection for the given IDs.
  - [ ] `get_embedding_hashes(model_name)`.
  - [ ] `get_embeddings(article_ids, model_name)`.
  - [ ] `upsert_embeddings(rows)`: batched `INSERT ... ON CONFLICT ("articleId", "modelName") DO UPDATE`. Store embeddings as float32 little-endian bytes.
  - [ ] `delete_embeddings_without_current_text(model_name)`.
  - [ ] `delete_embeddings(article_ids, model_name)`.
  - [ ] Raise `ArticleEmbeddingsDatabaseError` with a clear message if the `ArticleEmbeddings` table does not exist.
- [ ] `service.py`, `ArticleEmbeddingService`:
  - [ ] `sync(mode, should_cancel)` implements incremental and rebuild as in the plan. No truncate. Cleanup always runs through `delete_embeddings_without_current_text`.
  - [ ] `load_embeddings(article_ids)`: read only.
  - [ ] `ensure_embeddings(article_ids, should_cancel)`: follow the five steps in the plan. Never return a stored row without checking the current text.
  - [ ] Check `should_cancel` between encode batches and raise `ArticleEmbeddingsCancelledError`.
- [ ] Add the `ArticleEmbeddings` DDL to a shared worker-python test schema helper, or to each new test file's schema setup, matching the db-models table.
- [ ] Tests, new `tests/unit/article_embeddings/`, using a fake encoder like `_FakeSentenceTransformer`:
  - [ ] `preprocess_text` matches the old `_preprocess_text` output for HTML, whitespace and over-1000-character inputs. `text_hash` is stable.
  - [ ] Incremental mode encodes only missing and changed articles, and encodes nothing when every hash matches.
  - [ ] Rebuild overwrites rows and removes rows for articles no longer approved.
  - [ ] Text changing from non-null to null: sync deletes the row.
  - [ ] The newest approved row is used when an article has two approved rows.
  - [ ] Empty text is stored as a zero vector, and null text gets no row.
  - [ ] Cancellation stops between batches and raises `ArticleEmbeddingsCancelledError`.
  - [ ] `to_dict()` includes `processed`.
  - [ ] `ensure_embeddings` returns stored rows without encoding when hashes match, and encodes only missing or changed IDs.
  - [ ] `ensure_embeddings` with text changed to null deletes the row and leaves the ID out.
  - [ ] Embedding bytes round-trip: what is stored loads back as an equal float32 array.
- [ ] End-of-phase checks for worker-python.
- [ ] Check off tasks and commit.

## Phase 4: Deduper Repository Bulk Writes and Paging

Plan: Component 4, "Bulk score writes" and "Scoring, page by page".

- [ ] Add `DeduperRepository.execute_statement(query, params)`: execute once, commit, return `cursor.rowcount`, never fetch. Wrap `psycopg.Error` in `DeduperDatabaseError`, like `execute_many`.
- [ ] Rewrite `update_analysis_embedding_batch` to build one `UPDATE ... FROM (VALUES (%s::integer, %s::double precision), ...) AS v(id, score)` per call:
  - [ ] Values go in as parameters only.
  - [ ] Return the row count from `execute_statement`.
  - [ ] An empty list returns 0 without querying.
  - [ ] Keep the signature and input shape.
- [ ] Add `get_analysis_records_for_embedding_update_page(after_id, limit)`: `WHERE "embeddingSearch" = 0 AND id > %s ORDER BY id LIMIT %s`.
- [ ] Add `get_analysis_article_ids()`: the distinct union of `articleIdNew` and `articleIdApproved`.
- [ ] Raise the `DEDUPER_BATCH_SIZE_EMBEDDING` default from 100 to 5000 in `deduper/config.py`.
- [ ] Tests, `tests/unit/deduper/test_repository.py`:
  - [ ] `execute_statement` runs one bulk update and returns the updated row count.
  - [ ] `update_analysis_embedding_batch` handles a full batch, a partial batch and an empty batch.
  - [ ] Paging returns rows in id order, starting after `after_id`.
- [ ] Update `test_config.py` if it asserts the old default of 100.
- [ ] End-of-phase checks for worker-python.
- [ ] Check off tasks and commit.

## Phase 5: Deduper Pipeline Integration

Plan: Component 4, "New pipeline step" and "EmbeddingProcessor changes", plus "Cancellation mapping".

- [ ] Add `PipelineStep.EMBEDDING_SYNC = "embedding_sync"` in `deduper/types.py`.
- [ ] Create `deduper/processors/embedding_sync.py` with `EmbeddingSyncProcessor`:
  - [ ] Skip with the same result shape as `EmbeddingProcessor` when `enable_embedding` is false.
  - [ ] Call `ArticleEmbeddingService.sync(mode, should_cancel)` and return `summary.to_dict()`.
  - [ ] Catch `ArticleEmbeddingsCancelledError` and raise `DeduperProcessorError("Embedding sync cancelled")`.
- [ ] Orchestrator, `deduper/orchestrator.py`:
  - [ ] Add `rebuild_embeddings: bool = False` to `run_analyze` and `run_analyze_fast`.
  - [ ] Insert the `EMBEDDING_SYNC` step before `EMBEDDING` in both.
  - [ ] Map false to `INCREMENTAL` and true to `REBUILD`.
- [ ] Rewrite `EmbeddingProcessor.execute`:
  - [ ] Keep the disabled-embedding skip and the missing-dependency error.
  - [ ] Setup: `get_analysis_article_ids()`, then one `ensure_embeddings(ids, should_cancel)` call wrapped to convert `ArticleEmbeddingsCancelledError` into `DeduperProcessorError("Embedding processor cancelled")`.
  - [ ] Scoring rules: both IDs missing from the dictionary gives 1.0, one missing gives 0.0, otherwise `np.dot` clamped to [0, 1].
  - [ ] Page with `get_analysis_records_for_embedding_update_page` using `batch_size_embedding`. Write each page with `update_analysis_embedding_batch` before reading the next.
  - [ ] Check `should_cancel` between pages and raise `DeduperProcessorError("Embedding processor cancelled")`.
  - [ ] Return `get_embedding_processing_stats()` plus `processed` and `status`, as today.
- [ ] Remove the processor's per-pair `get_article_content` calls, `embedding_cache`, `_set_cache`, `_get_or_compute_embedding`, `_load_model` and `_preprocess_text`.
- [ ] Remove `get_analysis_records_for_embedding_update` from the repository if a search finds no other callers. Keep `get_article_content` only if something else still uses it.
- [ ] Keep `DEDUPER_CACHE_MAX_ENTRIES` in use by the content hash processor.
- [ ] Tests, `tests/unit/deduper/test_processors.py` and `test_orchestrator.py`:
  - [ ] `test_embedding_processor_with_fake_model` still passes. Update its setup only to add the `ArticleEmbeddings` DDL and the fake encoder hook.
  - [ ] Stored-embedding scores equal on-the-fly scores for the same fixtures.
  - [ ] Fallback: an article with text but no stored row is encoded and scored.
  - [ ] Cancellation during `ensure_embeddings()` raises `DeduperProcessorError`.
  - [ ] With a page size smaller than the record count, every record is scored exactly once.
  - [ ] Rows that score 0 are not read again.
  - [ ] A spy on `update_analysis_embedding_batch` sees several calls, none larger than the page size.
  - [ ] `EmbeddingSyncProcessor` returns a dictionary with `processed`, and converts a module cancel to `DeduperProcessorError`.
  - [ ] Orchestrator: `embedding_sync` runs before `embedding` in both modes, is skipped when embedding is disabled, and a cancel during sync marks the run cancelled.
- [ ] End-of-phase checks for worker-python.
- [ ] Check off tasks and commit.

## Phase 6: Routes and Job Runners

Plan: Component 5, plus "Cancellation mapping".

- [ ] `JobManager.enqueue_deduper_job(report_id=None, rebuild_embeddings=False)`:
  - [ ] Add `rebuildEmbeddings: true` to the queue parameters only when true.
  - [ ] Pass the flag through `_build_deduper_runner` to `run_analyze_fast`.
- [ ] `src/routes/deduper.py`:
  - [ ] Leave both GET job routes unchanged.
  - [ ] Add `POST /deduper/jobs` and `POST /deduper/jobs/reportId/{report_id}` with an optional Pydantic body `{ "rebuildEmbeddings": bool = false }`.
  - [ ] Return status 201 and keep the `DeduperClearBusyError` → 409 handling.
  - [ ] Make sure the POST routes do not collide with `POST /deduper/jobs/{job_id}/cancel`.
- [ ] Standalone job runner, in `JobManager` or a small job builder in the `article_embeddings` module:
  - [ ] Endpoint name `/article-embeddings/start-job`.
  - [ ] Calls `sync(mode, should_cancel=context.is_cancel_requested)` and stores `summary.to_dict()` as the job result.
  - [ ] Converts `ArticleEmbeddingsCancelledError` into `QueueJobCanceledError`.
  - [ ] Raises `QueueJobCanceledError` if a cancel was requested after sync returned.
  - [ ] Lets other errors propagate.
  - [ ] Closes the repository connection in `finally`.
- [ ] Create `src/routes/article_embeddings.py`:
  - [ ] Prefix `/article-embeddings`.
  - [ ] `POST /jobs` with optional body `{ "mode": "incremental" | "rebuild" }`, default `incremental`.
  - [ ] Returns `jobId`, `status` and `mode` with status 201.
- [ ] Register the router in `src/main.py` with `app.include_router(...)`.
- [ ] Tests, `tests/integration/`:
  - [ ] The GET deduper routes behave as before.
  - [ ] The POST deduper routes accept an empty body and `{ "rebuildEmbeddings": true }`, and reject an invalid body with 422.
  - [ ] `POST /article-embeddings/jobs` enqueues with the requested mode, and rejects an unknown mode with 422.
- [ ] Tests, queue job cancellation, checked at the queue job status:
  - [ ] A deduper job cancelled during `ensure_embeddings()` ends as `canceled`.
  - [ ] A deduper job cancelled during the sync step ends as `canceled`.
  - [ ] A standalone embeddings job cancelled during sync ends as `canceled`.
  - [ ] A standalone job whose sync raises an unrelated error ends as `failed`.
- [ ] End-of-phase checks for worker-python.
- [ ] Check off tasks and commit.

## Phase 7: Docs

Plan: Component 7.

- [ ] `worker-python/docs/worker-python-api-documentation/`: document `POST /deduper/jobs`, `POST /deduper/jobs/reportId/{report_id}` and `POST /article-embeddings/jobs`, following the existing endpoint doc format.
- [ ] `worker-python/AGENTS.md`: add `src/routes/article_embeddings.py` and `src/modules/article_embeddings/` to the runtime entry points.
- [ ] `worker-python/README.md`: mention the embedding sync step and the standalone route where the deduper is described.
- [ ] `worker-python/.env.example`: add `ARTICLE_EMBEDDINGS_BATCH_SIZE`, `ARTICLE_EMBEDDINGS_MODEL_NAME` and `DEDUPER_BATCH_SIZE_EMBEDDING=5000`, without real values for secrets.
- [ ] `docs/api-documentation/endpoints/admin-db.md`: note under create-database-backup and import-db-backup that `ArticleEmbeddings` is excluded and is regenerated after an import.
- [ ] `db-manager/AGENTS.md`: the same note for `--create_backup` and `--zip_file`.
- [ ] Update `updated_at` and `modified_by` frontmatter on any edited doc that has it.
- [ ] End-of-phase checks: run the full worker-python, db-manager and api test suites once more.
- [ ] Check off tasks and commit.

## Phase 8: Operator Verification

Plan: Rollout. The operator runs or approves these steps. They touch shared or production systems.

- [ ] Deploy db-models, then restart the api so `sync()` creates `ArticleEmbeddings`.
- [ ] Deploy db-manager, api and worker-python.
- [ ] Check that production `.env` does not pin `DEDUPER_BATCH_SIZE_EMBEDDING=100`.
- [ ] In a quiet window, call `POST /article-embeddings/jobs` and record the run time and the summary counts.
- [ ] Run a deduper job for a known report. Compare `embeddingSearch` values and the Excel output with the previous run, and record the total run time.
- [ ] Create a backup and confirm the zip has no `ArticleEmbedding.csv`.
