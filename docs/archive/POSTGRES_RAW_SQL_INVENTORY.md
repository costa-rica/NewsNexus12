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
| `worker-python` | `src/modules/deduper/repository.py` | `sqlite3`, `?`, `datetime('now')`, `lastrowid` | `converted` | Rewritten to native psycopg SQL with `%s` placeholders, quoted Postgres identifiers, `CURRENT_TIMESTAMP`, and pooled connections. Covered by Postgres-backed repository, processor, job-manager, and route tests. |
| `worker-python` | `src/modules/location_scorer/repository.py` | `sqlite3`, `?`, `datetime('now')` | `converted` | Rewritten to native psycopg SQL with `%s` placeholders, `ON CONFLICT DO NOTHING`, quoted identifiers, and pooled connections. Covered by Postgres-backed repository tests. |
| `worker-python` | `src/modules/ai_approver/repository.py` | `sqlite3`, `?`, `datetime('now')` | `converted` | Rewritten to native psycopg SQL with quoted identifiers, `%s` placeholders, `CURRENT_TIMESTAMP`, and pooled connections. Covered by Postgres-backed repository tests. |
| `worker-python` | `src/standalone/setup_ai_approver_prompt.py` | `sqlite3`, `sqlite_master`, `?`, `datetime('now')` | `converted` | Uses psycopg, `information_schema.tables`, `%s` placeholders, `CURRENT_TIMESTAMP`, and `RETURNING id`. |

## Runtime DDL call sites

| Package | File | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| `api` | `src/app.ts` | `sequelize.sync()` | `converted` | Replaced with `ensureSchemaReady(sequelize)`. |
| `worker-node` | `src/modules/db/ensureDbReady.ts` | `sequelize.sync()` | `converted` | Runtime DDL removed; helper now keeps the public contract but calls `ensureSchemaReady(sequelize)`. |
| `worker-node` | `src/modules/jobs/requestGoogleRssJob.ts` | `sequelize.sync()` | `converted` | Per-job runtime DDL removed; jobs assume schema bootstrap already happened. Covered by Postgres-backed worker-node tests. |
| `worker-node` | `src/modules/jobs/semanticScorerJob.ts` | `sequelize.sync()` | `converted` | Per-job runtime DDL removed; jobs assume schema bootstrap already happened. Covered by Postgres-backed worker-node tests. |

## Inventory status summary

- `converted`: 14
- `ruled safe`: 3
- `pending`: 0

All currently inventoried worker entries are now `converted` or `ruled safe`.
