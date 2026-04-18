# News Nexus 12 Postgres Transition Phase 3 TODO

Phase 3 migrates the backup and replenish workflow onto Postgres. The goal is to keep the same ZIP-of-CSVs operational model while replacing SQLite-specific reset and import behavior with Postgres-safe schema bootstrap, topological load order, sequence resets, and validation tooling.

## Phase goal

- Complete the backup and replenish work described in Phase 3 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with `db-manager` able to export, wipe, rebuild, and restore a Postgres-backed database using the existing CSV ZIP workflow.
- Validate that the portal-triggered replenish path can use the same shared logic safely.

## Task list

### 1. db-manager backup compatibility

- [ ] Review `db-manager` backup flow for assumptions that depended on SQLite behavior.
- [ ] Replace SQLite table discovery logic in `db-manager/src/index.ts`.
- [ ] Confirm table enumeration works correctly under Postgres.
- [ ] Verify CSV generation still produces stable filenames and complete table coverage.
- [ ] Confirm CSV escaping and column ordering remain round-trip safe for import.
- [ ] Check that empty-table behavior remains intentional and clearly handled.

### 2. Postgres replenish bootstrap flow

- [ ] Replace the old file-delete reset behavior with schema bootstrap logic:
  - [ ] `DROP SCHEMA public CASCADE;`
  - [ ] `CREATE SCHEMA public;`
  - [ ] `sequelize.sync()` as a bootstrap-only operation
- [ ] Confirm this bootstrap path is only used in explicit restore or replenish flows.
- [ ] Verify schema recreation leaves the database in a clean state before CSV import starts.
- [ ] Confirm the bootstrap role assumptions from the transition plan are reflected in the implementation.

### 3. Topological CSV import

- [ ] Replace foreign-key disabling logic in `db-manager/src/modules/zipImport.ts`.
- [ ] Read `MODEL_LOAD_ORDER` from `@newsnexus/db-models`.
- [ ] Load CSV files according to topological model order instead of filesystem order.
- [ ] Match each CSV file to the intended model deterministically.
- [ ] Emit a clear warning for ZIP entries that do not map to a known model in the load order.
- [ ] Decide and enforce behavior for expected models whose CSV files are missing from the ZIP.
- [ ] Wrap each table load in its own transaction so logs and failures stay interpretable.

### 4. Data normalization during import

- [ ] Keep and verify invalid-date to `NULL` normalization behavior.
- [ ] Add boolean coercion for legacy SQLite CSV values such as `"0"` and `"1"`.
- [ ] Review numeric and null coercion paths for values SQLite previously accepted loosely.
- [ ] Confirm import errors report the failing table clearly enough to resume debugging quickly.
- [ ] Verify Postgres rejects bad rows loudly enough to catch data drift rather than silently accepting it.

### 5. Sequence reset after import

- [ ] Call `resetAllSequences(sequelize)` after all CSV data loads complete.
- [ ] Verify sequence reset runs for every table with a serial `id`.
- [ ] Confirm subsequent inserts succeed without primary key collisions.
- [ ] Add or update verification coverage for sequence-reset behavior.

### 6. Portal and api replenish path

- [ ] Confirm the portal-triggered replenish flow uses the shared Postgres-safe restore logic.
- [ ] Keep the same user-facing backup and restore workflow.
- [ ] Measure replenish duration against realistic local data.
- [ ] Decide whether the route remains synchronous or moves to a background job based on measured duration.
- [ ] If the route remains synchronous, verify timeout behavior is acceptable.
- [ ] If the route moves to a background job, define the minimal status and polling behavior needed to preserve operability.

### 7. Dry-run validator

- [x] Build the Phase 3 dry-run validation tool described in the transition plan.
- [x] Make it load a recent SQLite-export ZIP into a scratch Postgres database.
- [x] Report rejected rows or failed tables clearly.
- [x] Capture enough output to identify datatype and coercion problems quickly.
- [ ] Use the validator against a representative backup before closing the phase.

### 8. db-manager tests

- [ ] Rewrite tests that assert on literal `PRAGMA foreign_keys` statements.
- [ ] Replace those assertions with behavior-level checks:
  - [ ] rows load in topological order
  - [ ] invalid dates normalize correctly
  - [ ] `resetAllSequences` runs after import
  - [ ] skipped or unknown files are reported clearly
- [ ] Update smoke tests whose assumptions depended on SQLite file creation or `sync()` shape.
- [ ] Confirm test setup uses the package-specific Postgres test database.
- [ ] Update the raw SQL inventory for all `db-manager` entries touched in this phase.

## Validation

### 1. Required checks before marking the phase complete

- [ ] `db-manager` builds successfully.
- [ ] `db-manager` tests pass.
- [ ] Backup creation succeeds against Postgres.
- [ ] Replenish succeeds against Postgres using a representative ZIP export.
- [ ] Row counts after replenish match the source backup for the tested dataset.
- [ ] Sequence reset is verified by performing at least one follow-up insert after replenish.
- [ ] The dry-run validator runs successfully and reports useful output on a representative backup.
- [ ] The raw SQL inventory is updated so all `db-manager` entries touched in this phase are marked converted or ruled safe.

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
