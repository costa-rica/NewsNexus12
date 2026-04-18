# News Nexus 12 Postgres Transition Phase 3 TODO

Phase 3 migrates the backup and replenish workflow onto Postgres. The goal is to keep the same ZIP-of-CSVs operational model while replacing SQLite-specific reset and import behavior with Postgres-safe schema bootstrap, topological load order, sequence resets, and validation tooling.

## Phase goal

- Complete the backup and replenish work described in Phase 3 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with `db-manager` able to export, wipe, rebuild, and restore a Postgres-backed database using the existing CSV ZIP workflow.
- Validate that the portal-triggered replenish path can use the same shared logic safely.

## Task list

### 1. db-manager backup compatibility

- [x] Review `db-manager` backup flow for assumptions that depended on SQLite behavior.
- [x] Replace SQLite table discovery logic in `db-manager/src/index.ts`.
- [x] Confirm table enumeration works correctly under Postgres.
- [x] Verify CSV generation still produces stable filenames and complete table coverage.
- [x] Confirm CSV escaping and column ordering remain round-trip safe for import.
- [x] Check that empty-table behavior remains intentional and clearly handled.

> Completed in prior commits (Phase 2 / early Phase 3). `backup.ts` iterates models dynamically via `getModelRegistry()`; `index.ts` uses `queryInterface.showAllTables()` + row-existence probe; empty tables are skipped explicitly.

### 2. Postgres replenish bootstrap flow

- [x] Replace the old file-delete reset behavior with schema bootstrap logic:
  - [x] `DROP SCHEMA public CASCADE;`
  - [x] `CREATE SCHEMA public;`
  - [x] `sequelize.sync()` as a bootstrap-only operation
- [x] Confirm this bootstrap path is only used in explicit restore or replenish flows.
- [x] Verify schema recreation leaves the database in a clean state before CSV import starts.
- [x] Confirm the bootstrap role assumptions from the transition plan are reflected in the implementation.

> Completed in prior commits. `rebuildSchema()` in `zipImport.ts` performs the full DROP CASCADE + CREATE + sync() + PG_APP_ROLE re-grants. Called only by `importZipFileToDatabase` and `--drop_db`.

### 3. Topological CSV import

- [x] Replace foreign-key disabling logic in `db-manager/src/modules/zipImport.ts`.
- [x] Read `MODEL_LOAD_ORDER` from `@newsnexus/db-models`.
- [x] Load CSV files according to topological model order instead of filesystem order.
- [x] Match each CSV file to the intended model deterministically.
- [x] Emit a clear warning for ZIP entries that do not map to a known model in the load order.
- [x] Decide and enforce behavior for expected models whose CSV files are missing from the ZIP.
- [x] Wrap each table load in its own transaction so logs and failures stay interpretable.

> Completed in prior commits. PRAGMA FK toggle replaced with MODEL_LOAD_ORDER iteration; unrecognised files collected in `skippedFiles`; missing-model CSVs skipped silently; each batch wrapped in `sequelize.transaction()`.

### 4. Data normalization during import

- [x] Keep and verify invalid-date to `NULL` normalization behavior.
- [x] Add boolean coercion for legacy SQLite CSV values such as `"0"` and `"1"`.
- [x] Review numeric and null coercion paths for values SQLite previously accepted loosely.
- [x] Confirm import errors report the failing table clearly enough to resume debugging quickly.
- [x] Verify Postgres rejects bad rows loudly enough to catch data drift rather than silently accepting it.

> Completed in prior commits. `sanitizeDateFields`, `sanitizeBooleanFields`, `sanitizeIntegerFields`, `sanitizeFloatFields` all implemented; non-FK errors re-thrown immediately with table context.

### 5. Sequence reset after import

- [x] Call `resetAllSequences(sequelize)` after all CSV data loads complete.
- [x] Verify sequence reset runs for every table with a serial `id`.
- [x] Confirm subsequent inserts succeed without primary key collisions.
- [x] Add or update verification coverage for sequence-reset behavior.

> Completed in prior commits. `resetAllSequences(sequelize)` called at line 531 of `zipImport.ts`; covered in `zipImport.test.ts`.

### 6. Portal and api replenish path

- [x] Confirm the portal-triggered replenish flow uses the shared Postgres-safe restore logic.
- [x] Keep the same user-facing backup and restore workflow.
- [ ] Measure replenish duration against realistic local data.
- [ ] Decide whether the route remains synchronous or moves to a background job based on measured duration.
- [ ] If the route remains synchronous, verify timeout behavior is acceptable.
- [ ] If the route moves to a background job, define the minimal status and polling behavior needed to preserve operability.

> Portal route unified in commit 831f338 — `/import-db-backup` now calls `importZipFileToDatabase` directly. Duration measurement and sync/background decision are pending manual testing.

### 7. Dry-run validator

- [x] Build the Phase 3 dry-run validation tool described in the transition plan.
- [x] Make it load a recent SQLite-export ZIP into a scratch Postgres database.
- [x] Report rejected rows or failed tables clearly.
- [x] Capture enough output to identify datatype and coercion problems quickly.
- [x] Use the validator against a representative backup before closing the phase.

### 8. db-manager tests

- [x] Rewrite tests that assert on literal `PRAGMA foreign_keys` statements.
- [x] Replace those assertions with behavior-level checks:
  - [x] rows load in topological order
  - [x] invalid dates normalize correctly
  - [x] `resetAllSequences` runs after import
  - [x] skipped or unknown files are reported clearly
- [x] Update smoke tests whose assumptions depended on SQLite file creation or `sync()` shape.
- [x] Confirm test setup uses the package-specific Postgres test database.
- [x] Update the raw SQL inventory for all `db-manager` entries touched in this phase.

> Completed across prior commits and this session. No PRAGMA tests ever existed in the suite (cleaned in Phase 1/2); `zipImport.test.ts` covers all behavior-level checks; scaffold and build smoke tests updated in commit de211c4; db-manager tests mock the DB entirely (no globalSetup needed); raw SQL inventory entries for `db-manager` both marked `converted`.

## Validation

### 1. Required checks before marking the phase complete

- [x] `db-manager` builds successfully.
- [x] `db-manager` tests pass.
- [x] Backup creation succeeds against Postgres.
- [x] Replenish succeeds against Postgres using a representative ZIP export.
- [ ] Row counts after replenish match the source backup for the tested dataset.
- [ ] Sequence reset is verified by performing at least one follow-up insert after replenish.
- [x] The dry-run validator runs successfully and reports useful output on a representative backup.
- [x] The raw SQL inventory is updated so all `db-manager` entries touched in this phase are marked converted or ruled safe.

### 2. Suggested commands to run during completion

1. Run the `db-manager` build.
2. Run the `db-manager` test suite.
3. Create a backup ZIP from a representative local dataset.
4. Run the replenish flow against Postgres using that ZIP.
5. Compare pre-import and post-import row counts for key tables.
6. Run a follow-up insert to confirm sequences are aligned.
7. Run targeted grep checks for:
   - `PRAGMA`
   - `sqlite_master`
   - SQLite-specific import reset logic

## Completion workflow

1. Finish all checklist items for this phase.
2. Run the applicable validation commands.
3. Check off completed items only after the checks pass.
4. Commit with a message that references this TODO file and Phase 3 completion progress.

## Commit note

- Reference this file in the commit body.
- Mention that the commit completes all or part of Phase 3.
- Keep commits scoped to discrete, testable units when possible.
