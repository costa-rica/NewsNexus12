# News Nexus 12 Postgres Transition Phase 1 TODO

Phase 1 sets up the Postgres foundation for the monorepo. The goal is to complete the database boundary changes in `db-models`, establish local Postgres environments, produce the raw SQL inventory required by the transition plan, and get `api` booting against Postgres without runtime DDL on startup.

## Phase goal

- Complete the Postgres foundation work described in Phase 1 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with local Postgres working for `db-models` and `api`.
- Commit the raw SQL inventory with every discovered call site marked converted or ruled safe.

## Task list

### 1. Local Postgres setup

- [ ] Install and verify local Postgres 16 for development.
- [ ] Create local databases:
  - [ ] `newsnexus_dev`
  - [ ] `newsnexus_test_api`
  - [ ] `newsnexus_test_db_manager`
  - [ ] `newsnexus_test_worker_node`
  - [ ] `newsnexus_test_worker_python`
- [ ] Document the exact local setup commands needed for another engineer to reproduce the environment.

### 2. db-models foundation

- [ ] Add Postgres driver dependencies in `db-models`.
- [ ] Replace SQLite connection config in `db-models/src/models/_connection.ts` with Postgres env-driven config.
- [ ] Add pool configuration support for Postgres connections.
- [ ] Keep logging configurable for development and debugging.
- [ ] Add `db-models/src/models/_loadOrder.ts`.
- [ ] Derive and define `MODEL_LOAD_ORDER` from `_associations.ts`.
- [ ] Verify `_associations.ts` does not create circular foreign key dependencies that would block topological import order.
- [ ] Review cascade behavior assumptions in `_associations.ts` for Postgres strictness.
- [ ] Add `db-models/src/utils/resetSequences.ts`.
- [ ] Implement `resetAllSequences(sequelize)` for all models with serial `id` columns.
- [ ] Add `db-models/src/utils/ensureSchemaReady.ts`.
- [ ] Implement `ensureSchemaReady(sequelize)` with `authenticate()` plus a lightweight schema check.
- [ ] Re-export the new helpers from the package entrypoint.
- [ ] Review models for SQLite-only assumptions:
  - [ ] implicit type coercion
  - [ ] booleans stored as numeric values
  - [ ] date and date-only fields that may contain bad legacy data
  - [ ] string fields storing structured data
  - [ ] blob or binary edge cases
- [ ] Remove or justify the legacy `DROP TABLE IF EXISTS "ArticleContents";` behavior in `db-models/src/models/_index.ts`.

### 3. Raw SQL inventory

- [ ] Create the inventory file required by the transition plan.
- [ ] Record every discovered call site using these patterns:
  - [ ] `sequelize.query(...)`
  - [ ] `PRAGMA`
  - [ ] `sqlite_master`
  - [ ] `sqlite3`
  - [ ] `?` SQL placeholders
  - [ ] `datetime('now')`
  - [ ] `strftime`
  - [ ] `INSERT OR IGNORE`
  - [ ] `INSERT OR REPLACE`
  - [ ] `ROWID`
  - [ ] `AUTOINCREMENT`
  - [ ] `LIKE` that should become `ILIKE`
- [ ] Include status per entry:
  - [ ] converted
  - [ ] ruled safe
  - [ ] pending
- [ ] Resolve every Phase 1 entry so nothing needed for `db-models` or `api` remains pending at phase close.

### 4. api startup and dialect cleanup

- [ ] Update `api` startup to use Postgres env vars.
- [ ] Remove runtime `sequelize.sync()` from `api/src/app.ts`.
- [ ] Replace runtime startup DDL with `ensureSchemaReady(sequelize)`.
- [ ] Confirm startup now fails fast with a clear message if schema bootstrap has not been run.
- [ ] Remove SQLite-specific foreign key toggling in `api/src/modules/adminDb.ts`.
- [ ] Audit and convert raw SQL in the known `api` call sites identified by the inventory.
- [ ] Review search and filter behavior for `LIKE` versus `ILIKE`.
- [ ] Remove SQLite-specific error handling such as `SQLITE_BUSY` and `SQLITE_CONSTRAINT` paths if still present.

### 5. Environment updates

- [ ] Replace `PATH_DATABASE` and `NAME_DB` usage with `PG_*` variables for Phase 1 packages.
- [ ] Update `.env.example` files touched by this phase.
- [ ] Confirm local development values are documented clearly enough for `db-models` and `api`.

## Validation

### 1. Required checks before marking the phase complete

- [ ] `db-models` builds successfully.
- [ ] `api` builds successfully.
- [ ] `api` boots against local Postgres.
- [ ] Startup succeeds without runtime `sequelize.sync()` in `api`.
- [ ] The raw SQL inventory file is committed and every entry relevant to Phase 1 is marked converted or ruled safe.
- [ ] Grep confirms `api` runtime startup no longer performs DDL.

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
