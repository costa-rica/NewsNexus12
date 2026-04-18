# Postgres Transition Plan — NewsNexus12

**Date:** 2026-04-18
**Version:** v2 (revised after review)
**Status:** Design agreed — ready to convert §6 into a task list
**Motivation:** Replace SQLite with Postgres to resolve concurrent-write contention from `worker-python` and `worker-node`, which frequently hold long write bursts against a single-writer database.

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
- One Postgres instance holds two databases:
  - `newsnexus_dev` (local) / `newsnexus` (prod) — the app database.
  - `newsnexus_test` — dropped and recreated by the Jest suites on each run.
- All four services connect via Sequelize `dialect: 'postgres'`, except worker-python which uses `psycopg` directly.
- Backup artifact stays a ZIP of CSVs (same format, same filenames).
- Replenish becomes: **drop schema → recreate schema → `sequelize.sync()` → load CSVs in topological order → reset sequences**. No FK-disable step.

## 5. Key Design Decisions

These are the decisions made during v1 review. Each resolves one of the open questions that the original plan flagged.

### 5.1 worker-python — direct `psycopg`

worker-python already writes raw SQL via the `sqlite3` driver (see `src/modules/deduper/repository.py`, `src/modules/location_scorer/repository.py`, `src/modules/ai_approver/repository.py`). The swap is a straight driver change, not a rewrite:

- `sqlite3.connect(path)` → `psycopg.connect(dsn)` / `psycopg_pool.ConnectionPool`.
- Parameter style `?` → `%s`.
- `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`.
- `cursor.lastrowid` → `RETURNING id`.
- Date/bool normalization (Postgres is strict, SQLite was not).

Rejected alternative: routing all worker-python writes through api. Would require designing a new batched-write surface and would regress throughput on the embedding / deduper paths.

### 5.2 Schema management — keep `sequelize.sync()` for this migration

The replenish flow drops and recreates the schema every time, which makes a migration framework low-value right now. File a follow-up ticket post-cutover for `umzug` migrations when we want to stop dropping-and-recreating. Not bundled with this work.

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

Phase 1 subtask: derive the full list by reading `db-models/src/models/_associations.ts`, and verify no circular FK references exist. If any are found (unlikely based on current associations), a local FK-disable fallback will be added for those specific tables.

### 5.4 Sequence-reset — helper in `db-models`

Postgres auto-increment columns are backed by sequences (e.g. `Articles_id_seq`). When CSV load inserts rows with explicit IDs, the sequence counter does not advance — the next app-level insert collides. Fix runs per table after CSV load:

```sql
SELECT setval(pg_get_serial_sequence('"Articles"', 'id'),
              COALESCE(MAX(id), 1)) FROM "Articles";
```

Handles gaps correctly: `MAX(id)` returns the highest existing value regardless of gaps, so deleted-and-not-replaced rows are a non-issue.

Lives in `db-models/src/utils/resetSequences.ts`, exports `resetAllSequences(sequelize)` that iterates models with serial `id` columns. db-manager import and any future replenish caller uses this helper — no duplication of model metadata.

### 5.5 Connection pooling

Per-service Sequelize pool config (worker-python uses `psycopg_pool.ConnectionPool` with equivalent numbers):

| Service       | max | min | rationale |
| ------------- | --- | --- | --------- |
| api           | 10  | 2   | many short human reads/writes, some concurrent |
| worker-node   | 5   | 1   | queue caps concurrency to 1 job, burst headroom |
| worker-python | 5   | 1   | same shape as worker-node |
| db-manager    | 3   | 0   | CLI, short-lived, rarely concurrent with itself |

Total ceiling ≈ 23 concurrent connections. Postgres default `max_connections = 100` leaves ample headroom. Each connection costs ~10 MB RAM on the Postgres side; at the 100 ceiling that's ~1 GB baseline.

### 5.6 Tests — real Postgres, separate database on same instance

Run Jest suites (api, db-manager, worker-node) against `newsnexus_test` on the same native Postgres instance used for dev. Tests drop and recreate `newsnexus_test` at the start of each run. No Docker, no `pg-mem` (which has its own dialect drift).

CI: install Postgres in the CI runner via apt (or whatever GitHub Actions / host CI uses natively), provision `newsnexus_test` at job start, run suites.

### 5.7 Hosting — self-hosted on the same VM

Postgres runs on the Ubuntu production VM alongside the app services. Managed databases (RDS, Supabase, Neon) rejected for this phase — not enough scale to justify cost and vendor lock-in.

### 5.8 Case / collation / timezone

- **Case sensitivity:** Sequelize quotes identifiers — low risk. Phase 1 grep pass over raw SQL will confirm.
- **`LIKE` vs `ILIKE`:** audit article search paths; swap `LIKE` → `ILIKE` where case-insensitive match is expected.
- **Timezones:** use `TIMESTAMP WITH TIME ZONE` (Sequelize default on Postgres).

## 6. Work Breakdown

### 6.1 db-models

- Add `pg` and `pg-hstore` dependencies.
- Update `src/models/_connection.ts`:
  - Switch `dialect` to `'postgres'`.
  - Replace `storage` (file path) with host/port/user/password/database config from env vars.
  - Add `pool: { max, min, idle, acquire }` sized for the consumer (read from env or helper).
  - Keep `logging` behavior toggleable.
- Add `src/models/_loadOrder.ts` — export `MODEL_LOAD_ORDER: string[]` derived from `_associations.ts`.
- Add `src/utils/resetSequences.ts` — export `resetAllSequences(sequelize)` that walks models with serial `id` columns and runs `setval(pg_get_serial_sequence(...), COALESCE(MAX(id), 1))` for each.
- Re-export both from `src/index.ts`.
- Review every model for SQLite-only assumptions:
  - `DataTypes.STRING` fields storing JSON, arrays, or non-string data.
  - `DataTypes.DATE` / `DATEONLY` fields — Postgres is strict; SQLite accepted garbage.
  - Booleans stored as integers (0/1) vs real booleans.
  - Any `BLOB` usage.
  - Columns relying on SQLite's implicit type coercion.
- Re-verify `_associations.ts`:
  - Confirm no circular FK references (blocks the topological-load design).
  - FK cascade behavior (SQLite was silently permissive).
- Remove the legacy `DROP TABLE IF EXISTS "ArticleContents";` in `src/models/_index.ts:184` or confirm it's still needed under Postgres.

### 6.2 api

- Update `initializeDatabase()` to use Postgres env vars.
- Remove `PRAGMA foreign_keys = OFF/ON` in `src/modules/adminDb.ts:135-152` — the admin reset path should call `resetAllSequences` from db-models and/or use the shared replenish helper.
- Review raw SQL in `src/modules/articles.ts:106` (`sequelize.query<SemanticKeywordRatedArticleRow>`) for SQLite-only idioms (`||` concat, `datetime()`, `strftime()`, `INSERT OR IGNORE`, `ROWID`).
- Audit search/filter routes for `LIKE` that should become `ILIKE`.
- Review transactions — Postgres supports real nested/savepoint transactions; api code written against SQLite's single-writer model may over-serialize.
- Remove any handling of `SQLITE_BUSY` / `SQLITE_CONSTRAINT` error codes.

### 6.3 worker-node

- Connection comes from `@newsnexus/db-models`, so most of the change is free.
- Audit bulk-insert paths (scrapers, RSS ingester, state-assigner) for raw SQL or SQLite idioms.
- Confirm transactions wrap write bursts so the Postgres pool isn't thrashed.
- Verify `src/modules/db/ensureDbReady.ts` still does the right thing under Postgres.

### 6.4 worker-python

- Replace `sqlite3` driver with `psycopg` (v3) across:
  - `src/modules/deduper/repository.py`
  - `src/modules/location_scorer/repository.py`
  - `src/modules/ai_approver/repository.py`
- Use `psycopg_pool.ConnectionPool` with `max_size=5, min_size=1` sized per §5.5.
- Query rewrites:
  - `?` → `%s` for parameter placeholders.
  - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`.
  - `cursor.lastrowid` → `RETURNING id` and `cursor.fetchone()`.
  - `INTEGER` affinity booleans read as `int` → read as real `bool`.
- Update `config.py` files: replace `sqlite_path` property with `dsn` (or host/port/user/pass/db fields).
- Env var swap: `PATH_DATABASE` / `NAME_DB` → `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`.
- Update `tests/conftest.py` and integration tests to use the shared test database, not a temp SQLite file.

### 6.5 db-manager — Backup

- `backup.ts` goes through the ORM and should be mostly unchanged.
- Update `src/index.ts:52` — the SQLite `sqlite_master` metadata query needs to become `information_schema.tables` or `sequelize.getQueryInterface().showAllTables()`.
- Verify CSV column order and escaping behavior produce files that the import path can round-trip.
- (Deferred to follow-up) optional `COPY ... TO STDOUT WITH CSV` fast path for large tables.

### 6.6 db-manager — Replenish / Import

- Replace "delete .db file" step with:
  ```sql
  DROP SCHEMA public CASCADE;
  CREATE SCHEMA public;
  ```
  followed by `sequelize.sync()` to recreate the empty schema.
- Remove the `PRAGMA foreign_keys = OFF/ON` calls in `src/modules/zipImport.ts:252-290`. Replace the whole FK-toggle block with the topological-load design:
  - Read `MODEL_LOAD_ORDER` from `@newsnexus/db-models`.
  - For each model name in order, resolve the matching CSV file in the ZIP and call `bulkCreate` with explicit IDs.
  - Skip files whose model isn't in the order array (with a clear warning — probably indicates a new model that wasn't added to the order list).
- After all CSVs are loaded, call `resetAllSequences(sequelize)` from db-models.
- Keep the existing invalid-date → NULL logic; expect a few new rejections Postgres catches that SQLite accepted (empty strings in DATE columns, `"0000-00-00"`).
- Add boolean coercion for CSV values that SQLite stored as `"0"`/`"1"`.
- Wrap each table's load in its own transaction so progress logs remain meaningful.
- (Deferred to follow-up) `COPY FROM STDIN` fast path.

### 6.7 portal / api backup routes

- Same UX, same buttons.
- Replenish is slower than "rm + recreate db file"; long-running imports may exceed the api HTTP timeout. Either:
  - Run the import as a background job with status polling (reuse worker-node's queue model).
  - Or raise the route timeout and accept a longer synchronous wait with client-side progress UI.
- Decide based on measured replenish duration during Phase 3.

### 6.8 Tests

- Convert api, db-manager, and worker-node Jest suites to run against `newsnexus_test` on the native Postgres instance.
- Add a shared Jest setup file per package that:
  - Drops and recreates `newsnexus_test` at suite start.
  - Runs `sequelize.sync()`.
- Rewrite db-manager tests that assert on the literal strings `"PRAGMA foreign_keys = OFF;"` / `"PRAGMA foreign_keys = ON;"` in `tests/modules/zipImport.test.ts:291-316`. Replace with behavior-level assertions (e.g. "rows are loaded in topological order", "sequences are reset after import").
- Convert worker-python's `tests/conftest.py` temp-SQLite fixtures to use `newsnexus_test` via `psycopg`.
- CI: install Postgres natively on the runner, provision `newsnexus_test` at job start.

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
- Local dev setup doc: Homebrew Postgres install commands, `createdb newsnexus_dev newsnexus_test`, role creation.
- Prod setup doc: apt install, `pg_hba.conf` config for localhost-only access, data directory on the VM's persistent volume, restart policy via systemd.
- Credentials: one app role with read/write on the app database. No separate restore role needed — the app role can `DROP SCHEMA` on its own schema. Reserve superuser for admin use only.
- (Optional) nightly `pg_dump` alongside the CSV backup for disaster recovery.

## 7. Phasing

**Phase 0 — Decide (done).** Decisions recorded in §5.

**Phase 1 — db-models + local Postgres.**
- Homebrew install, create `newsnexus_dev` / `newsnexus_test`.
- Swap dialect, add pool config, build `MODEL_LOAD_ORDER`, add `resetAllSequences`.
- Get api booting against local Postgres.
- Fix dialect fallout in models and api raw SQL.

**Phase 2 — worker-node + worker-python.**
- Point worker-node at Postgres through `@newsnexus/db-models`.
- Swap worker-python to `psycopg` + `psycopg_pool`.
- Smoke-test each worker's main job path against local Postgres.

**Phase 3 — db-manager backup/replenish.**
- Rework delete/recreate step (drop schema + sequelize.sync).
- Switch to topological CSV load.
- Call `resetAllSequences` after load.
- Write a dry-run validator that attempts to load last SQLite export into a scratch Postgres DB and reports rejected rows — use this to catch CSV format surprises before prod cutover.

**Phase 4 — Tests + CI.**
- Convert Jest suites to Postgres.
- Rewrite `PRAGMA`-asserting tests.
- Update CI to provision `newsnexus_test`.

**Phase 5 — Production cutover.**
- Install Postgres on the Ubuntu VM.
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
- **Raw SQL pockets** in api/worker-node that nobody remembers writing. Mitigated by Phase 1 grep pass.
- **worker-python query rewrites.** Every `?` placeholder and `INSERT OR IGNORE` must be converted; miss one and the code blows up at runtime.
- **Test suite false-green** if any package's tests silently stay on SQLite.
- **Topological-order list drift** when a new model is added without updating `MODEL_LOAD_ORDER`. FK error on next replenish makes this loud, not silent.
- **Replenish duration exceeding api HTTP timeout.** Mitigated by running replenish as a background job.
- **Ops learning curve** — backups, upgrades, monitoring are new responsibilities on the VM.

## 9. Success Criteria

- All four services boot against Postgres locally and in production.
- `npm test` passes in api, worker-node, and db-manager against Postgres.
- `pytest` passes in worker-python against Postgres.
- Backup → wipe → replenish round-trip produces a working database identical in row counts to the source.
- No `SQLITE_*` error strings, `PRAGMA` statements, or `sqlite3` imports remain in the codebase.
- Worker bursts (deduper, scorer, scraper) complete without lock-contention retries.
- Portal backup/restore buttons work with no UX change.
- `pre-postgres` git tag exists for rollback reference.

## 10. Deferred (explicit non-work for this phase)

- Docker / docker-compose.
- Managed Postgres vendor.
- `umzug` / `sequelize-cli` migrations.
- `COPY`-based fast import/export in db-manager.
- Migrating `STRING`-storing-JSON columns to `JSONB`.
- Multi-region or replicated Postgres.

---

## Next Step

Convert §6 into a numbered task list for the implementing agent, one sub-section per PR where possible.
