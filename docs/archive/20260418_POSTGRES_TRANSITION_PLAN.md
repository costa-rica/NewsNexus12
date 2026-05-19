# Postgres Transition Plan — NewsNexus12

**Date:** 2026-04-18
**Version:** v3 (post-review)
**Status:** Design agreed — ready to convert §6 into task list
**Motivation:** Replace SQLite with Postgres to resolve concurrent-write contention from `worker-python` and `worker-node`, which frequently hold long write bursts against a single-writer database.

**Change log from v2:**
- Test isolation: per-package test databases to prevent Jest-worker and CI-parallelism races (§5.6, §6.8).
- Raw SQL audit promoted to a named Phase 1 deliverable with a committed inventory file (§5.10, §7).
- Runtime services (api, worker-node) no longer execute DDL on startup; `sequelize.sync()` is restricted to explicit bootstrap paths (§4, §5.9, §6.2, §6.3).
- Expanded §6.4 to cover every `datetime('now')` call site in worker-python (10+ locations).

---

## 1. Goals

- Eliminate `SQLITE_BUSY` / write-lock contention across api, worker-node, worker-python, and db-manager.
- Preserve the existing backup/replenish workflow (compressed CSVs in a ZIP, wipe, recreate empty, reload).
- Keep Sequelize as the ORM — do not rewrite data access.
- Keep the same `db-models` boundary so all four services pick up the change from one package.
- No data migration from the existing SQLite file is required. Production will be seeded from the most recent CSV backup.

## 2. Non-Goals (for this phase)

- No Docker. Native Postgres on macOS (Homebrew) for local, native Postgres on the Ubuntu VM (apt + systemd) for prod.
- No Redis / external queue.
- No multi-region / replicated Postgres.
- No managed-database vendor (RDS / Supabase / Neon) — same VM as the app services.
- No schema redesign. Models, associations, and column types stay as-is unless migration forces a change.
- No change to the portal's UX around backup/restore (same buttons, same file format).

## 3. Current State Recap

| Package        | Role in data access                                                |
| -------------- | ------------------------------------------------------------------ |
| db-models      | Sequelize models, `_connection.ts`, `_associations.ts`, `_index.ts` |
| api            | Primary reader/writer. Calls `initializeDatabase()` on boot        |
| worker-node    | Heavy writer during scrapers, scorers, state-assigner              |
| worker-python  | Writer during deduper + location-scorer jobs                       |
| db-manager     | CLI: backup → ZIP of CSVs; import → sync + CSV load; delete workflow |
| portal         | No direct DB access; all via api                                   |

All services currently share one SQLite file via `PATH_DATABASE` / `NAME_DB`. Backup/replenish is invoked both from `db-manager` CLI and from portal → api routes.

## 4. Target Architecture

- A single native Postgres 16 instance.
  - Local dev/test (MacBook): Homebrew `postgresql@16`, native service on `localhost:5432`.
  - Prod (Ubuntu VM): apt `postgresql-16`, systemd service, `pg_hba.conf` restricted to the app user on localhost.
- One Postgres instance holds multiple databases:
  - `newsnexus_dev` (local) / `newsnexus` (prod) — the app database.
  - `newsnexus_test_api`, `newsnexus_test_db_manager`, `newsnexus_test_worker_node`, `newsnexus_test_worker_python` — per-package test databases, each dropped and recreated at suite start.
- All four services connect via Sequelize `dialect: 'postgres'`, except worker-python which uses `psycopg` directly.
- **Runtime services do not execute DDL.** Only explicit bootstrap paths — the db-manager CLI and the portal replenish route — may run `sequelize.sync()` or schema-altering statements. api and worker-node boot against an existing schema and fail fast if the schema is missing.
- Backup artifact stays a ZIP of CSVs (same format, same filenames).
- Replenish becomes: **drop schema → recreate schema → `sequelize.sync()` → load CSVs in topological order → reset sequences**. No FK-disable step.

## 5. Key Design Decisions

These are the decisions locked in during v1/v2 review.

### 5.1 worker-python — direct `psycopg`

worker-python already writes raw SQL via the `sqlite3` driver (see `src/modules/deduper/repository.py`, `src/modules/location_scorer/repository.py`, `src/modules/ai_approver/repository.py`). The swap is a straight driver change, not a rewrite:

- `sqlite3.connect(path)` → `psycopg.connect(dsn)` / `psycopg_pool.ConnectionPool`.
- Parameter style `?` → `%s`.
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`.
- `cursor.lastrowid` → `RETURNING id`.
- `datetime('now')` → `NOW()` or `CURRENT_TIMESTAMP`.
- Date/bool normalization (Postgres is strict, SQLite was not).

Rejected alternative: routing all worker-python writes through api. Would require designing a new batched-write surface and would regress throughput on the embedding / deduper paths.

### 5.2 Schema management — `sequelize.sync()` only in bootstrap paths

Keep `sync()` for this migration (no migration framework yet), but restrict it to bootstrap paths:

- `db-manager` CLI initial-sync path.
- Portal replenish route (which calls the same db-manager logic).

Runtime services (api, worker-node) call `sequelize.authenticate()` and a lightweight schema check at startup, then fail fast if the schema is missing. See §5.9.

File a follow-up ticket post-cutover for `umzug` migrations when we want to stop dropping-and-recreating.

### 5.3 Replenish — topological load, no FK-disable

Drop and recreate the `public` schema, run `sequelize.sync()`, then load CSVs **in topological order** (parents before children). FKs stay enabled the entire time because the parent row always exists by the time the child is inserted. No superuser privilege needed, no `SET session_replication_role`, no drop-and-recreate FK constraints.

The load order lives in `db-models/src/models/_loadOrder.ts` as an exported ordered array:

```ts
export const MODEL_LOAD_ORDER: string[] = [
  // level 0 — roots (no FKs)
  // level 1 — reference level 0
  // level 2 — reference level 1
  // ...
];
```

Phase 1 subtask: derive the full list by reading `db-models/src/models/_associations.ts`, and verify no circular FK references exist. If any are found, a local FK-disable fallback will be added for those specific tables.

### 5.4 Sequence-reset — helper in `db-models`

Postgres auto-increment columns are backed by sequences (e.g. `Articles_id_seq`). When CSV load inserts rows with explicit IDs, the sequence counter does not advance — the next app-level insert collides. Fix runs per table after CSV load:

```sql
SELECT setval(pg_get_serial_sequence('"Articles"', 'id'),
              COALESCE(MAX(id), 1)) FROM "Articles";
```

Handles gaps correctly: `MAX(id)` returns the highest existing value regardless of gaps.

Lives in `db-models/src/utils/resetSequences.ts`, exports `resetAllSequences(sequelize)` that iterates models with serial `id` columns. db-manager import and any future replenish caller uses this helper.

### 5.5 Connection pooling

Per-service Sequelize pool config (worker-python uses `psycopg_pool.ConnectionPool` with equivalent numbers):

| Service       | max | min | rationale |
| ------------- | --- | --- | --------- |
| api           | 10  | 2   | many short human reads/writes, some concurrent |
| worker-node   | 5   | 1   | queue caps concurrency to 1 job, burst headroom |
| worker-python | 5   | 1   | same shape as worker-node |
| db-manager    | 3   | 0   | CLI, short-lived, rarely concurrent with itself |

Total ceiling ≈ 23 concurrent connections. Postgres default `max_connections = 100` leaves ample headroom. Each connection costs ~10 MB RAM on the Postgres side.

### 5.6 Tests — per-package databases on the same Postgres instance

Each package gets its own test database, dropped and recreated at suite start. Prevents two classes of races:

1. **Within a package:** Jest defaults to parallel workers (none of the current configs set `--runInBand` or `maxWorkers: 1`). Workers all connecting to a single DB would have one worker wipe state another worker is using.
2. **Across packages:** CI may run `api` tests and `db-manager` tests on parallel runners; even locally, `npm test` in two terminals would collide on a shared DB.

Concrete setup:

- api → `newsnexus_test_api`
- db-manager → `newsnexus_test_db_manager`
- worker-node → `newsnexus_test_worker_node`
- worker-python → `newsnexus_test_worker_python`

Each package's Jest `globalSetup` (pytest `conftest.py` for worker-python) drops and recreates its own DB, then runs `sequelize.sync()` (bootstrap-only usage is allowed here because tests own the DB lifecycle).

The `PG_DATABASE` env var for tests is set by each package's test runner, not inherited from the dev env.

Rejected alternatives:
- `--runInBand` everywhere: trivially safe but slows suites meaningfully.
- Per-`JEST_WORKER_ID` schemas inside a single DB: more complex without clear benefit given the small package count.
- `pg-mem`: separate dialect drift risk.

### 5.7 Hosting — self-hosted on the same VM

Postgres runs on the Ubuntu production VM alongside the app services. Managed databases rejected for this phase — not enough scale to justify cost and vendor lock-in.

### 5.8 Case / collation / timezone

- **Case sensitivity:** Sequelize quotes identifiers — low risk. Phase 1 raw SQL inventory (§5.10) will confirm.
- **`LIKE` vs `ILIKE`:** audit article search paths; swap where case-insensitive match is expected.
- **Timezones:** use `TIMESTAMP WITH TIME ZONE` (Sequelize default on Postgres).

### 5.9 Runtime services do not execute DDL

Under SQLite, `sequelize.sync()` calls on service startup were harmless — single writer, file-based. Under Postgres they become a real failure mode: multiple services racing on DDL at startup, jobs calling `sync()` while replenish is dropping the schema, and the app role needing schema-altering privileges it otherwise wouldn't.

**Runtime services must not run DDL.** Confirmed `sync()` call sites to remove or rework:

- `api/src/app.ts:133` — remove.
- `worker-node/src/modules/db/ensureDbReady.ts:13` — rework to schema-check only.
- `worker-node/src/modules/jobs/requestGoogleRssJob.ts:102` — remove (per-job sync is wrong regardless of dialect).
- `worker-node/src/modules/jobs/semanticScorerJob.ts:78` — remove.

Replacement pattern on startup:
1. `await sequelize.authenticate()` — confirms connection and credentials.
2. Lightweight schema check — e.g. `SELECT 1 FROM "Articles" LIMIT 0` or read `information_schema.tables`.
3. On missing schema, throw a clear error instructing the operator to run the bootstrap path; do not attempt recovery.

Bootstrap paths where `sync()` remains legitimate:
- `db-manager/src/index.ts:47` — CLI initial-sync.
- Portal replenish route (calls db-manager logic).
- Each package's test `globalSetup` (tests own their DB lifecycle).

Defense-in-depth benefit: the production app role can drop DDL privileges entirely, reserving them for a separate bootstrap role used only by db-manager and the replenish route.

### 5.10 Raw SQL audit as a Phase 1 deliverable

The SQLite → Postgres driver swap is not the whole change. Every hand-written SQL statement in the codebase is a potential dialect issue. Phase 1 is not complete until a committed inventory file exists at `docs/requirements/POSTGRES_RAW_SQL_INVENTORY.md` (or similar) enumerating every call site with a status: **converted**, **ruled safe**, or **pending**.

Scope includes:

| Pattern                                        | Where it matters                     |
| ---------------------------------------------- | ------------------------------------ |
| `sequelize.query(...)`                         | TS packages (api, db-manager, worker-node) |
| `PRAGMA`                                       | TS packages                          |
| `sqlite_master`                                | TS packages                          |
| `import sqlite3` / `sqlite3.connect`           | Python                               |
| `?` parameter placeholders                     | Python (SQLite-specific; must become `%s`) |
| `datetime('now')` / `strftime`                 | Both                                 |
| `INSERT OR IGNORE` / `INSERT OR REPLACE`       | Both                                 |
| `||` string concatenation in SQL               | Both                                 |
| `AUTOINCREMENT`, `ROWID`                       | Both                                 |
| `LIKE` that should be `ILIKE`                  | TS (search routes)                   |

Known non-exhaustive file list to audit:
- `api/src/modules/articles.ts`
- `api/src/modules/adminDb.ts`
- `api/src/modules/queriesSql.ts`
- `api/src/modules/analysis/state-assigner-sql.ts`
- `api/src/modules/analysis/llm04.ts`
- `api/src/routes/analysis/llm02.ts`
- `db-manager/src/index.ts`
- `db-manager/src/modules/zipImport.ts`
- `worker-python/src/modules/deduper/repository.py`
- `worker-python/src/modules/location_scorer/repository.py`
- `worker-python/src/modules/ai_approver/repository.py`
- `worker-python/src/standalone/setup_ai_approver_prompt.py`

The inventory is produced by a grep pass early in Phase 1 and converted iteratively. Phase 1 exit requires every entry marked **converted** or **ruled safe** with a one-line justification.

## 6. Work Breakdown

### 6.1 db-models

- Add `pg` and `pg-hstore` dependencies.
- Update `src/models/_connection.ts`:
  - Switch `dialect` to `'postgres'`.
  - Replace `storage` (file path) with host/port/user/password/database config from env vars.
  - Add `pool: { max, min, idle, acquire }` sized per §5.5; accept overrides via env for per-service tuning.
  - Keep `logging` behavior toggleable.
- Add `src/models/_loadOrder.ts` — export `MODEL_LOAD_ORDER: string[]` derived from `_associations.ts`.
- Add `src/utils/resetSequences.ts` — export `resetAllSequences(sequelize)` that walks models with serial `id` columns and runs `setval(pg_get_serial_sequence(...), COALESCE(MAX(id), 1))` for each.
- Add `src/utils/ensureSchemaReady.ts` — export `ensureSchemaReady(sequelize)` that does `authenticate()` + a lightweight schema check (one core table). Throws a clear error if missing.
- Re-export the above from `src/index.ts`.
- Review every model for SQLite-only assumptions:
  - `DataTypes.STRING` fields storing JSON, arrays, or non-string data.
  - `DataTypes.DATE` / `DATEONLY` fields — Postgres is strict; SQLite accepted garbage.
  - Booleans stored as integers (0/1) vs real booleans.
  - Any `BLOB` usage.
- Re-verify `_associations.ts`:
  - Confirm no circular FK references (blocks the topological-load design).
  - FK cascade behavior (SQLite was silently permissive).
- Remove the legacy `DROP TABLE IF EXISTS "ArticleContents";` in `src/models/_index.ts:184` or confirm it's still needed under Postgres.

### 6.2 api

- Update `initializeDatabase()` to use Postgres env vars.
- **Remove `sequelize.sync()` at `src/app.ts:133`** — replace with `ensureSchemaReady(sequelize)` from db-models. Fail fast on missing schema.
- **Remove `PRAGMA foreign_keys = OFF/ON`** in `src/modules/adminDb.ts:135-152`. The admin reset path should call `resetAllSequences` and/or the shared replenish helper.
- Audit and convert raw SQL per the §5.10 inventory. Known call sites include:
  - `src/modules/articles.ts:106` (`sequelize.query<SemanticKeywordRatedArticleRow>`) — check for `||` concat, `datetime()`, `strftime()`, `INSERT OR IGNORE`, `ROWID`.
  - `src/modules/queriesSql.ts`
  - `src/modules/analysis/state-assigner-sql.ts`
  - `src/modules/analysis/llm04.ts`
  - `src/routes/analysis/llm02.ts`
- Audit search/filter routes for `LIKE` that should become `ILIKE`.
- Review transactions — Postgres supports real savepoint transactions; api code written against SQLite's single-writer model may over-serialize.
- Remove any handling of `SQLITE_BUSY` / `SQLITE_CONSTRAINT` error codes.

### 6.3 worker-node

- Connection comes from `@newsnexus/db-models`, so the dialect swap is free.
- **Remove `sequelize.sync()` from all three runtime call sites:**
  - `src/modules/db/ensureDbReady.ts:13` — rework this helper to call `ensureSchemaReady(sequelize)` from db-models instead of `sync()`. Keep the function name/signature so callers don't change.
  - `src/modules/jobs/requestGoogleRssJob.ts:102` — remove. Jobs should assume the schema exists.
  - `src/modules/jobs/semanticScorerJob.ts:78` — remove.
- Audit bulk-insert paths (scrapers, RSS ingester, state-assigner) for raw SQL or SQLite idioms per the §5.10 inventory.
- Confirm transactions wrap write bursts so the Postgres pool isn't thrashed.

### 6.4 worker-python

- Replace `sqlite3` driver with `psycopg` (v3) across:
  - `src/modules/deduper/repository.py`
  - `src/modules/location_scorer/repository.py`
  - `src/modules/ai_approver/repository.py`
  - `src/standalone/setup_ai_approver_prompt.py`
- Use `psycopg_pool.ConnectionPool` with `max_size=5, min_size=1` per §5.5.
- Query rewrites (every call site; verified count ≥ 10):
  - `?` → `%s` for parameter placeholders.
  - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`.
  - `cursor.lastrowid` → `RETURNING id` and `cursor.fetchone()`.
  - `datetime('now')` → `NOW()` or `CURRENT_TIMESTAMP`. Known occurrences:
    - `deduper/repository.py:116,196,245,306,339`
    - `location_scorer/repository.py:125`
    - `ai_approver/repository.py:221`
    - `standalone/setup_ai_approver_prompt.py:98`
  - `INTEGER` booleans read as `int` → real `bool`.
- Update test fixtures that embed `datetime('now')` / `?` to match the new syntax:
  - `tests/unit/location_scorer/test_repository.py`
  - `tests/unit/ai_approver/test_repository.py`
  - (any other tests surfaced during the audit)
- Update config files: replace `sqlite_path` property with `dsn` (or host/port/user/pass/db fields).
- Env var swap: `PATH_DATABASE` / `NAME_DB` → `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`.
- Update `tests/conftest.py` to use `newsnexus_test_worker_python` via `psycopg` instead of temp SQLite files.

### 6.5 db-manager — Backup

- `backup.ts` goes through the ORM and should be mostly unchanged.
- Update `src/index.ts:52` — the SQLite `sqlite_master` metadata query becomes `information_schema.tables` or `sequelize.getQueryInterface().showAllTables()`.
- Verify CSV column order and escaping produce files that the import path can round-trip.
- (Deferred to follow-up) optional `COPY ... TO STDOUT WITH CSV` fast path for large tables.

### 6.6 db-manager — Replenish / Import

- Replace "delete .db file" with:
  ```sql
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  ```
  followed by `sequelize.sync()` to recreate the empty schema. **This is a legitimate bootstrap-only `sync()` call** per §5.9.
- Remove `PRAGMA foreign_keys = OFF/ON` in `src/modules/zipImport.ts:252-290`. Replace the FK-toggle block with the topological-load design:
  - Read `MODEL_LOAD_ORDER` from `@newsnexus/db-models`.
  - For each model name in order, resolve the matching CSV file in the ZIP and call `bulkCreate` with explicit IDs.
  - Skip files whose model isn't in the order array (with a clear warning — probably indicates a new model that wasn't added to the order list).
- After all CSVs are loaded, call `resetAllSequences(sequelize)` from db-models.
- Keep existing invalid-date → NULL logic; expect a few new Postgres rejections SQLite accepted (empty strings in DATE columns, `"0000-00-00"`).
- Add boolean coercion for CSV values SQLite stored as `"0"`/`"1"`.
- Wrap each table's load in its own transaction so progress logs remain meaningful.
- (Deferred to follow-up) `COPY FROM STDIN` fast path.

### 6.7 portal / api backup routes

- Same UX, same buttons.
- The portal replenish route is a bootstrap path per §5.9 — it may call `sync()` via the shared db-manager logic.
- Long-running imports may exceed the api HTTP timeout. Either:
  - Run the import as a background job with status polling (reuse worker-node's queue model).
  - Or raise the route timeout and accept a longer synchronous wait with client-side progress UI.
- Decide based on measured replenish duration during Phase 3.

### 6.8 Tests

- Per-package test databases per §5.6: `newsnexus_test_api`, `newsnexus_test_db_manager`, `newsnexus_test_worker_node`, `newsnexus_test_worker_python`.
- Add a shared Jest `globalSetup` in each TS package that:
  - Reads `PG_DATABASE` from a package-specific test env.
  - Drops and recreates the package's test database.
  - Runs `sequelize.sync()` to create the empty schema (bootstrap-only usage; legitimate).
- Rewrite db-manager tests that assert on the literal strings `"PRAGMA foreign_keys = OFF;"` / `"PRAGMA foreign_keys = ON;"` in `tests/modules/zipImport.test.ts:291-316`. Replace with behavior-level assertions:
  - Rows are loaded in topological order.
  - `resetAllSequences` is called after import.
  - Invalid dates become NULL.
- Update `db-manager/tests/smoke/entrypoint.test.ts:66-70` — those tests assert on `sync()` call behavior that is changing shape.
- Convert worker-python's `tests/conftest.py` temp-SQLite fixtures to use `newsnexus_test_worker_python` via `psycopg`.
- CI: install Postgres natively on the runner; each package's test job creates its own DB at job start.

### 6.9 Environment / Ops

Env var changes across all packages:

| Old                  | New                                                    |
| -------------------- | ------------------------------------------------------ |
| `PATH_DATABASE`      | `PG_HOST`, `PG_PORT`                                   |
| `NAME_DB`            | `PG_DATABASE`                                          |
| (n/a)                | `PG_USER`, `PG_PASSWORD`                               |
| (n/a)                | `PG_SCHEMA` (optional, default `public`)               |
| (n/a)                | `PG_SSL` (optional boolean)                            |

- `PATH_DATABASE` and `NAME_DB` are **removed** from every package — not renamed, not kept as fallback. Audit `.env`, `.env.example`, and any code that reads these (e.g. `db-models/src/models/_connection.ts`, worker-python config files, db-manager env loader) and delete them alongside the dialect swap.
- Update `.env.example` in every package with the new `PG_*` variables.
- Local dev setup doc: Homebrew Postgres install commands, `createdb` for the app DB plus one test DB per package, role creation.
- Prod setup doc: apt install, `pg_hba.conf` config for localhost-only access, data directory on the VM's persistent volume, restart policy via systemd.
- Credentials model:
  - **App role** — read/write on app tables. No DDL privileges. Used by api and workers in production.
  - **Bootstrap role** — can `DROP SCHEMA`, `CREATE SCHEMA`, and `sync()`. Used by db-manager and the portal replenish route only.
  - Superuser reserved for admin use.
- (Optional) nightly `pg_dump` alongside the CSV backup for disaster recovery.

## 7. Phasing

**Phase 0 — Decide (done).** Decisions recorded in §5.

**Phase 1 — db-models, raw SQL audit, local Postgres.**
- Homebrew install, create `newsnexus_dev` + per-package test DBs.
- Swap dialect, add pool config, build `MODEL_LOAD_ORDER`, add `resetAllSequences`, add `ensureSchemaReady`.
- **Produce and commit the raw SQL inventory (§5.10).** Phase 1 is not complete until every call site is marked converted or ruled safe.
- Get api booting against local Postgres with no `sync()` on startup.
- Fix dialect fallout in models and api raw SQL identified by the inventory.

**Phase 2 — worker-node + worker-python.**
- Point worker-node at Postgres through `@newsnexus/db-models`; remove runtime `sync()` calls.
- Swap worker-python to `psycopg` + `psycopg_pool`; convert all `datetime('now')` and `?` placeholders flagged by the inventory.
- Smoke-test each worker's main job path against local Postgres.

**Phase 3 — db-manager backup/replenish.**
- Rework delete/recreate step (drop schema + bootstrap sync).
- Switch to topological CSV load.
- Call `resetAllSequences` after load.
- Write a dry-run validator that loads last SQLite export into a scratch Postgres DB and reports rejected rows.

**Phase 4 — Tests + CI.**
- Per-package test DBs wired into each Jest/pytest `globalSetup`.
- Rewrite `PRAGMA`-asserting tests and `sync()`-asserting tests.
- CI provisions one test DB per package job.

**Phase 5 — Production cutover.**
- Install Postgres on the Ubuntu VM with the two-role credential model.
- Tag `main` as `pre-postgres`.
- Portal maintenance banner ON.
- Take final SQLite CSV backup.
- Deploy Postgres-enabled build.
- Replenish from CSVs.
- Verify row counts and smoke-test core flows.
- Portal maintenance banner OFF.
- Expected window: 30–60 minutes.

**Phase 6 (follow-up, out of scope here).**
- `umzug` migrations.
- `COPY`-based fast import/export.
- JSONB for columns currently storing JSON in STRING.

## 8. Risks

- **Silent data-type drift.** SQLite accepts values Postgres rejects; bugs surface only at import or at first write. Mitigated by the Phase 3 dry-run validator.
- **Sequence collisions** if `resetAllSequences` is missed on any table.
- **Incomplete raw SQL audit** leaves SQLite-specific syntax in hot paths. Mitigated by the §5.10 inventory deliverable gating Phase 1 exit.
- **Test isolation failures** if any package's Jest suite runs against a shared DB. Mitigated by per-package DBs in §5.6.
- **Runtime DDL regressions** if a future change reintroduces `sync()` on a hot path. Mitigated by the split app-role / bootstrap-role credentials — the app role physically cannot run DDL in prod.
- **Topological-order list drift** when a new model is added without updating `MODEL_LOAD_ORDER`. FK error on next replenish makes this loud, not silent.
- **Replenish duration exceeding api HTTP timeout.** Mitigated by running replenish as a background job.
- **Ops learning curve** — backups, upgrades, monitoring are new responsibilities on the VM.

## 9. Success Criteria

- All four services boot against Postgres locally and in production.
- No `sequelize.sync()` calls remain in runtime paths (api `app.ts`, worker-node startup or jobs). Grep confirms.
- Raw SQL inventory file is committed with every entry marked **converted** or **ruled safe**.
- `npm test` passes in api, worker-node, and db-manager against per-package Postgres test DBs.
- `pytest` passes in worker-python against `newsnexus_test_worker_python`.
- Backup → wipe → replenish round-trip produces a working database identical in row counts to the source.
- No `SQLITE_*` error strings, `PRAGMA` statements, or `sqlite3` imports remain in the codebase.
- Worker bursts (deduper, scorer, scraper) complete without lock-contention retries.
- Portal backup/restore buttons work with no UX change.
- `pre-postgres` git tag exists for rollback reference.
- Production app role lacks DDL privileges (verified by attempting a `CREATE TABLE` as that role and confirming it's rejected).

## 10. Deferred (explicit non-work for this phase)

- Docker / docker-compose.
- Managed Postgres vendor.
- `umzug` / `sequelize-cli` migrations.
- `COPY`-based fast import/export in db-manager.
- Migrating `STRING`-storing-JSON columns to `JSONB`.
- Multi-region or replicated Postgres.
- Per-`JEST_WORKER_ID` schema isolation (per-package DB is sufficient).

---

## Next Step

Convert §6 into a numbered task list (one TODO file per phase) per the guidance in `docs/TODO_LIST_GUIDANCE.md`. Phase 1 TODO is the natural first file.
