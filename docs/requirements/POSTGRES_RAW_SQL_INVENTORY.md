# Postgres Raw SQL Inventory

This inventory tracks the SQLite-specific SQL and direct SQL call sites involved in the Postgres transition. Each entry is marked as `converted`, `ruled safe`, or `pending`.

## TypeScript packages

| Package | File | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| `api` | `src/modules/analysis/state-assigner-sql.ts` | `date('now', ...)` | `converted` | Replaced SQLite date function with a parameterized ISO timestamp comparison. |
| `api` | `src/modules/adminDb.ts` | `PRAGMA foreign_keys` | `converted` | PRAGMAs removed; CSV import now ordered via `MODEL_LOAD_ORDER` to satisfy FK constraints without toggling. |
| `api` | `src/modules/articles.ts` | `sequelize.query(...)` | `converted` | Identifiers quoted; `entityWhoCategorizesId` and `publishedDateAfter` now passed via Sequelize `replacements` instead of string interpolation. |
| `api` | `src/modules/queriesSql.ts` | `sequelize.query(...)` | `converted` | `GROUP_CONCAT` → `STRING_AGG`; SQLite boolean `= 1` comparisons dropped in favor of `= true`; `asc` alias renamed to `asct` to avoid reserved-word collision. |
| `api` | `src/modules/analysis/llm04.ts` | `sequelize.query(...)` | `ruled safe` | Double-quoted identifiers, no SQLite-only functions, no boolean integer comparisons. |
| `api` | `src/routes/analysis/llm02.ts` | `sequelize.query(...)` | `ruled safe` | Double-quoted identifiers, no SQLite-only functions. |
| `db-manager` | `src/index.ts` | `sqlite_master` | `converted` | Replaced with `sequelize.getQueryInterface().showAllTables()` plus row-existence probe. |
| `db-manager` | `src/modules/zipImport.ts` | `PRAGMA foreign_keys` | `converted` | Rebuilt: `DROP SCHEMA public CASCADE` + `sequelize.sync()` + topological CSV load via `MODEL_LOAD_ORDER` + `resetAllSequences()` + SQLite boolean coercion. |
| `db-models` | `src/models/_index.ts` | `DROP TABLE IF EXISTS "ArticleContents"` | `ruled safe` | Postgres-compatible statement; runtime call sites still need removal. |

## Python packages

| Package | File | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| `worker-python` | `src/modules/deduper/repository.py` | `sqlite3`, `?`, `datetime('now')`, `lastrowid` | `pending` | Migrated to psycopg + `ConnectionPool` but still relies on a runtime `_normalize_query()` substitution (`?` → `%s`, `datetime('now')` → `CURRENT_TIMESTAMP`). Flagged as fragile; rewrite at source in Phase 2. |
| `worker-python` | `src/modules/location_scorer/repository.py` | `sqlite3`, `?`, `datetime('now')` | `pending` | Full driver and SQL migration required. |
| `worker-python` | `src/modules/ai_approver/repository.py` | `sqlite3`, `?`, `datetime('now')` | `pending` | Full driver and SQL migration required. |
| `worker-python` | `src/standalone/setup_ai_approver_prompt.py` | `sqlite3`, `sqlite_master`, `?`, `datetime('now')` | `pending` | Needs Postgres-compatible implementation. |

## Runtime DDL call sites

| Package | File | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| `api` | `src/app.ts` | `sequelize.sync()` | `converted` | Replaced with `ensureSchemaReady(sequelize)`. |
| `worker-node` | `src/modules/db/ensureDbReady.ts` | `sequelize.sync()` | `pending` | Needs runtime DDL removal. |
| `worker-node` | `src/modules/jobs/requestGoogleRssJob.ts` | `sequelize.sync()` | `pending` | Needs runtime DDL removal. |
| `worker-node` | `src/modules/jobs/semanticScorerJob.ts` | `sequelize.sync()` | `pending` | Needs runtime DDL removal. |

## Inventory status summary

- `converted`: 7
- `ruled safe`: 3
- `pending`: 7

Phase 1 exit requires every Phase 1-relevant entry to be `converted` or `ruled safe`. Remaining `pending` entries are scoped to worker-python (Phase 2) and worker-node runtime DDL (Phase 3).
