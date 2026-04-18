# News Nexus 12 Postgres Transition Phase 1 TODO

Phase 1 sets up the Postgres foundation for the monorepo. The goal is to complete the database boundary changes in `db-models`, establish local Postgres environments, produce the raw SQL inventory required by the transition plan, and get `api` booting against Postgres without runtime DDL on startup.

## Phase goal

- Complete the Postgres foundation work described in Phase 1 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with local Postgres working for `db-models` and `api`.
- Commit the raw SQL inventory with every discovered call site marked converted or ruled safe.

## Task list

### 1. Local Postgres setup

- [x] Install and verify local Postgres 16 for development. _(documented in `docs/db-models/LOCAL_POSTGRES_SETUP.md`; each engineer runs locally.)_
- [x] Create local databases:
  - [x] `newsnexus_dev`
  - [x] `newsnexus_test_api`
  - [x] `newsnexus_test_db_manager`
  - [x] `newsnexus_test_worker_node`
  - [ ] `newsnexus_test_worker_python` _(deferred to Phase 2 where worker-python Postgres migration lands.)_
- [x] Document the exact local setup commands needed for another engineer to reproduce the environment. _(see `docs/db-models/LOCAL_POSTGRES_SETUP.md`.)_

### 2. db-models foundation

- [x] Add Postgres driver dependencies in `db-models`.
- [x] Replace SQLite connection config in `db-models/src/models/_connection.ts` with Postgres env-driven config.
- [x] Add pool configuration support for Postgres connections.
- [x] Keep logging configurable for development and debugging.
- [x] Add `db-models/src/models/_loadOrder.ts`.
- [x] Derive and define `MODEL_LOAD_ORDER` from `_associations.ts`.
- [x] Verify `_associations.ts` does not create circular foreign key dependencies that would block topological import order. _(reviewed: graph is a DAG; ArticleDuplicateAnalysis has two FKs to Article but is not circular.)_
- [x] Review cascade behavior assumptions in `_associations.ts` for Postgres strictness. _(no `onDelete`/`onUpdate` cascade set; defaults are `NO ACTION`, same in both dialects.)_
- [x] Add `db-models/src/utils/resetSequences.ts`.
- [x] Implement `resetAllSequences(sequelize)` for all models with serial `id` columns.
- [x] Add `db-models/src/utils/ensureSchemaReady.ts`.
- [x] Implement `ensureSchemaReady(sequelize)` with `authenticate()` plus a lightweight schema check.
- [x] Re-export the new helpers from the package entrypoint.
- [x] Review models for SQLite-only assumptions:
  - [x] implicit type coercion _(none; Sequelize `DataTypes` are dialect-neutral.)_
  - [x] booleans stored as numeric values _(boolean coercion handled in db-manager zipImport and api adminDb on CSV ingest.)_
  - [x] date and date-only fields that may contain bad legacy data _(db-manager zipImport sanitizes invalid date strings to null on import.)_
  - [x] string fields storing structured data _(none flagged during sweep.)_
  - [x] blob or binary edge cases _(no BLOB columns in the schema.)_
- [x] Remove or justify the legacy `DROP TABLE IF EXISTS "ArticleContents";` behavior in `db-models/src/models/_index.ts`. _(retained as a one-time cleanup; call site guarded and ruled safe in inventory.)_

### 3. Raw SQL inventory

- [x] Create the inventory file required by the transition plan. _(see `docs/requirements/POSTGRES_RAW_SQL_INVENTORY.md`.)_
- [x] Record every discovered call site using these patterns:
  - [x] `sequelize.query(...)`
  - [x] `PRAGMA`
  - [x] `sqlite_master`
  - [x] `sqlite3`
  - [x] `?` SQL placeholders
  - [x] `datetime('now')`
  - [x] `strftime`
  - [x] `INSERT OR IGNORE`
  - [x] `INSERT OR REPLACE`
  - [x] `ROWID`
  - [x] `AUTOINCREMENT`
  - [x] `LIKE` that should become `ILIKE` _(no raw `LIKE`/`Op.like` in api source after sweep.)_
- [x] Include status per entry:
  - [x] converted
  - [x] ruled safe
  - [x] pending
- [x] Resolve every Phase 1 entry so nothing needed for `db-models` or `api` remains pending at phase close. _(all api + db-models + db-manager entries are `converted` or `ruled safe`; remaining `pending` entries are worker-python (Phase 2) and worker-node runtime DDL (Phase 3).)_

### 4. api startup and dialect cleanup

- [x] Update `api` startup to use Postgres env vars. _(via shared `_connection.ts` in `db-models`.)_
- [x] Remove runtime `sequelize.sync()` from `api/src/app.ts`.
- [x] Replace runtime startup DDL with `ensureSchemaReady(sequelize)`.
- [x] Confirm startup now fails fast with a clear message if schema bootstrap has not been run. _(`ensureSchemaReady` throws "Database schema is missing required table" when tables are absent.)_
- [x] Remove SQLite-specific foreign key toggling in `api/src/modules/adminDb.ts`. _(PRAGMAs removed; CSVs now imported in `MODEL_LOAD_ORDER`.)_
- [x] Audit and convert raw SQL in the known `api` call sites identified by the inventory.
- [x] Review search and filter behavior for `LIKE` versus `ILIKE`. _(no raw `LIKE` in api source.)_
- [x] Remove SQLite-specific error handling such as `SQLITE_BUSY` and `SQLITE_CONSTRAINT` paths if still present. _(grep confirms none remain in api source.)_

### 5. Environment updates

- [x] Replace `PATH_DATABASE` and `NAME_DB` usage with `PG_*` variables for Phase 1 packages.
- [x] Update `.env.example` files touched by this phase.
- [x] Confirm local development values are documented clearly enough for `db-models` and `api`. _(see `docs/db-models/LOCAL_POSTGRES_SETUP.md`.)_

## Validation

### 1. Required checks before marking the phase complete

- [x] `db-models` builds successfully. _(`npm run build` in `db-models` succeeds.)_
- [x] `api` builds successfully. _(`npm run build` in `api` succeeds.)_
- [x] `api` boots against local Postgres. _(verified: api starts cleanly, portal login confirmed working against local Postgres.)_
- [x] Startup succeeds without runtime `sequelize.sync()` in `api`. _(`app.ts` calls `ensureSchemaReady(sequelize)` only.)_
- [x] The raw SQL inventory file is committed and every entry relevant to Phase 1 is marked converted or ruled safe.
- [x] Grep confirms `api` runtime startup no longer performs DDL. _(grep for `sequelize.sync` in `api/src` returns no matches.)_

### 2. Suggested commands to run during completion

1. Run the `db-models` build.
2. Run the `api` build.
3. Start `api` against local Postgres and confirm boot succeeds.
4. Run targeted grep checks for:
   - runtime `sequelize.sync()`
   - `PRAGMA`
   - `sqlite_master`
   - `SQLITE_BUSY`
   - `SQLITE_CONSTRAINT`

## Completion workflow

1. Finish all checklist items for this phase.
2. Run the applicable validation commands.
3. Check off completed items only after the checks pass.
4. Commit with a message that references this TODO file and Phase 1 completion progress.

## Commit note

- Reference this file in the commit body.
- Mention that the commit completes all or part of Phase 1.
- Keep commits scoped to discrete, testable units when possible.
