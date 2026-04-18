# Postgres Transition Plan — NewsNexus12

**Date:** 2026-04-18
**Status:** Draft for discussion (not yet a task list)
**Motivation:** Replace SQLite with Postgres to resolve concurrent-write contention from `worker-python` and `worker-node`, which frequently hold long write bursts against a single-writer database.

---

## 1. Goals

- Eliminate `SQLITE_BUSY` / write-lock contention across api, worker-node, worker-python, and db-manager.
- Preserve the existing backup/replenish workflow (compressed CSVs in a ZIP, wipe, recreate empty, reload).
- Keep Sequelize as the ORM — do not rewrite data access.
- Keep the same `db-models` boundary so all four services pick up the change from one package.
- No data migration from the existing SQLite file is required. Production will be seeded from the most recent CSV backup.

## 2. Non-Goals (for this phase)

- No Redis / external queue.
- No multi-region / replicated Postgres.
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

- A single Postgres instance (local dev: Docker; production: Ubuntu VM service or managed).
- All four services connect via Sequelize `dialect: 'postgres'`.
- Backup artifact stays a ZIP of CSVs (same format, same filenames).
- Replenish becomes: **drop schema → recreate schema → `sequelize.sync()` → load CSVs → reset sequences → re-enable FKs**.

## 5. Work Breakdown (Exhaustive)

### 5.1 db-models
- Add `pg` and `pg-hstore` dependencies.
- Update `_connection.ts`:
  - Switch `dialect` to `'postgres'`.
  - Replace `storage` (file path) with host/port/user/password/database config.
  - Add connection pool settings (`pool: { max, min, idle, acquire }`).
  - Keep `logging` behavior toggleable.
- Review every model for SQLite-only assumptions:
  - `DataTypes.STRING` fields storing JSON, arrays, or non-string data.
  - `DataTypes.DATE` / `DATEONLY` fields — Postgres is strict; SQLite accepted garbage.
  - Booleans stored as integers (0/1) vs real booleans.
  - Any `BLOB` usage.
  - Columns relying on SQLite's implicit type coercion.
- Re-verify `_associations.ts` — FK cascade behavior can differ (SQLite silently permissive).
- Decide: keep `sequelize.sync()` or introduce proper migrations (see §7).

### 5.2 api
- Update `initializeDatabase()` to use Postgres env vars.
- Review any raw SQL (`sequelize.query(...)`) for SQLite-specific syntax:
  - `PRAGMA` statements (will fail on Postgres).
  - `||` concatenation vs `CONCAT`.
  - `datetime()` / `strftime()` — use Postgres date functions.
  - `LIMIT ? OFFSET ?` — fine; `INSERT OR IGNORE` is SQLite-only.
  - `AUTOINCREMENT`, `ROWID`.
- Review transactions — Postgres supports real nested/savepoint transactions; the api may have code that assumes SQLite's single-writer simplicity.
- Review any code that interprets `SQLITE_BUSY` / `SQLITE_CONSTRAINT` error codes.

### 5.3 worker-node
- Update its connection path (it uses `@newsnexus/db-models`, so mostly free).
- Audit bulk-insert paths — scrapers, RSS ingester, state-assigner — for raw SQL or SQLite idioms.
- Confirm transactions wrap write bursts so Postgres pool isn't thrashed.

### 5.4 worker-python
- Currently shares the SQLite file directly. Needs its DB access layer replaced.
  - Option A: switch Python side to `psycopg` / SQLAlchemy pointing at Postgres.
  - Option B: have worker-python call api endpoints for all writes (removes direct DB access).
- Decide connection strategy: shared pool, per-request connection, or subprocess-owned connection.
- Env vars swap: `PATH_DATABASE` / `NAME_DB` → `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`.

### 5.5 db-manager — Backup
- `backup.ts` currently reads every table via Sequelize and writes CSV rows. This should be **mostly unchanged** because it goes through the ORM.
- Optional: add a faster path using Postgres `COPY ... TO STDOUT WITH CSV` for large tables.
- Output ZIP format and filenames: **unchanged**.

### 5.6 db-manager — Replenish / Import
- Replace "delete .db file" step:
  - New step: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (or drop/recreate the database).
  - Decide who owns the credentials to do this — likely a dedicated role, not the app user.
- `sequelize.sync()` — works the same; recreates schema in the empty public schema.
- Foreign key handling during import:
  - SQLite: `PRAGMA foreign_keys = OFF`.
  - Postgres options:
    1. `SET session_replication_role = 'replica';` (superuser only, simplest).
    2. Drop FK constraints before import, re-add after.
    3. Mark constraints DEFERRABLE and use `SET CONSTRAINTS ALL DEFERRED`.
  - **Recommendation:** option 1 if the app role is granted the privilege; option 2 otherwise.
- **Sequence reset after import (critical).** For every table with a serial/identity column, after CSV load run:
  ```sql
  SELECT setval(pg_get_serial_sequence('"TableName"', 'id'),
                COALESCE(MAX(id), 1)) FROM "TableName";
  ```
  Without this, the next insert collides with existing IDs. This is the single most common post-migration bug.
- Date sanitization: keep current invalid-date → NULL logic; Postgres will reject values SQLite accepted, so expect a few new cases (e.g. `"0000-00-00"`, empty strings in DATE columns).
- Optional bulk speed: switch per-row `INSERT` to `COPY FROM STDIN` — 10–100x faster on large tables.
- Wrap the import in a single transaction where possible, or one per table for progress reporting.

### 5.7 portal / api backup routes
- Same behavior, same UI. The routes call into db-manager logic or a shared library.
- Confirm long-running imports don't hit api request timeouts; may need to run async with job status.

### 5.8 Tests
- api Jest tests currently assume SQLite. Decide:
  - Run tests against a real ephemeral Postgres (Docker, testcontainers, or a `pg-mem` stub).
  - Or keep SQLite for unit tests and add a separate Postgres integration suite.
  - **Recommendation:** switch tests to Postgres to catch dialect issues before deploy.
- db-manager has 146 tests — same decision applies. Backup/import tests especially need Postgres.
- CI: add a Postgres service container.

### 5.9 Environment / Ops
- Replace env vars: `PATH_DATABASE` + `NAME_DB` → `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`, `PG_SCHEMA` (optional), `PG_SSL` (bool).
- Update `.env.example` in every package.
- Production install: Postgres package on the Ubuntu VM, systemd service, `pg_hba.conf` for the app user, data directory, nightly `pg_dump` (optional, alongside CSV backups).
- Local dev: `docker-compose.yml` at repo root with a Postgres service and a named volume.
- Credentials: app role (read/write), a restore role (can drop schema), and a superuser-only admin.

## 6. Open Questions to Discuss

1. **worker-python strategy.** Direct Postgres connection (keeps current architecture) or route all writes through api (simpler but a bigger refactor)?
2. **Managed vs self-hosted.** Running Postgres on the same Ubuntu VM is cheapest but couples uptime. A managed service (RDS, Supabase, Neon) is hands-off but costs.
3. **Schema management.** Stay on `sequelize.sync()` or introduce migrations (`umzug` / `sequelize-cli`)? Sync is simpler; migrations are safer once data matters.
4. **Sequence-reset ownership.** Should this logic live in db-manager's import module, or in a small helper in db-models that any service can call?
5. **FK-disable strategy.** Is the app role allowed to `SET session_replication_role`? If not, we need the drop/recreate-FK approach.
6. **Tests.** Switch Jest to run against a Postgres container, or keep SQLite-in-tests? (Risk of dialect drift if we keep SQLite.)
7. **CSV format stability.** Do any current CSVs hold values Postgres will reject (timestamps, booleans as "true"/"false"/"1"/"0", nulls-as-empty-string)? Sampling before migration will save pain.
8. **Connection pooling.** Default Sequelize pool is tiny (max 5). Four services × workers means we should plan per-service pool sizes and a total cap.
9. **Downtime window.** Backup → spin up Postgres → replenish → redeploy services. How long can the app be offline? Can the portal show a maintenance banner?
10. **Rollback plan.** If Postgres goes sideways in production, can we restore the last SQLite file and redeploy the previous build? Keep SQLite-compatible branch tagged.
11. **Case sensitivity.** Postgres folds unquoted identifiers to lowercase; Sequelize quotes everything, but any raw SQL that references `Article` vs `"Article"` will break.
12. **Text collation / LIKE behavior.** Postgres `LIKE` is case-sensitive by default; SQLite's is not. Search features may need `ILIKE` or `citext`.
13. **Timezone handling.** Postgres `TIMESTAMP WITH TIME ZONE` vs `WITHOUT`. Pick one convention and apply consistently.
14. **JSON columns.** Any SQLite `STRING` column holding JSON should become `JSONB` for indexability — but that's schema change, scope creep. Decide whether to defer.
15. **Backup file size / performance.** Postgres can restore faster via `COPY`. Worth implementing in phase 1, or defer?

## 7. Suggested Phasing

**Phase 0 — Decide (this document).** Resolve the open questions in §6.

**Phase 1 — db-models + local Postgres.**
- Swap dialect, add Docker compose, get api booting against Postgres locally.
- Fix dialect fallout in models and raw SQL.

**Phase 2 — worker-node + worker-python.**
- Point them at Postgres.
- Decide worker-python path (direct vs via-api).

**Phase 3 — db-manager backup/replenish.**
- Rework delete/recreate step.
- Add sequence-reset step.
- Add FK-toggle strategy.
- (Optional) COPY-based fast import.

**Phase 4 — Tests + CI.**
- Switch test runners to Postgres container.

**Phase 5 — Production cutover.**
- Install Postgres on VM.
- Take final SQLite CSV backup.
- Deploy Postgres-enabled build.
- Replenish from CSVs.
- Verify, monitor, keep SQLite build tagged for rollback.

## 8. Risks

- **Silent data-type drift.** SQLite accepts values Postgres rejects; bugs surface only at import or at first write.
- **Sequence collisions** if reset step is missed.
- **Raw SQL pockets** in api/worker-node that nobody remembers writing.
- **Worker-python Python code** diverging from the Sequelize model truth.
- **Test suite false-green** if tests stay on SQLite while prod moves to Postgres.
- **Ops learning curve** — backups, upgrades, monitoring are new responsibilities.

## 9. Success Criteria

- All four services boot against Postgres locally and in production.
- `npm test` passes in api, worker-node, and db-manager against Postgres.
- Backup → wipe → replenish round-trip produces a working database identical in row counts to the source.
- No `SQLITE_*` error strings remain in the codebase.
- Worker bursts (deduper, scorer, scraper) complete without lock-contention retries.
- Portal backup/restore buttons work with no UX change.

---

## Next Step

Review §6 open questions together, lock in answers, then convert §5 into a task list for the implementing agent.
