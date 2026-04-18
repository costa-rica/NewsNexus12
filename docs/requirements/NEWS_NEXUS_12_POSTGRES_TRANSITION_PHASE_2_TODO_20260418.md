# News Nexus 12 Postgres Transition Phase 2 TODO

Phase 2 moves the worker services onto Postgres after the Phase 1 database foundation is in place. The goal is to remove runtime schema creation from `worker-node`, convert `worker-python` from SQLite to `psycopg`, and verify that the main worker job paths run correctly against Postgres.

## Phase goal

- Complete the worker migration work described in Phase 2 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with `worker-node` and `worker-python` running against Postgres locally.
- Remove runtime `sequelize.sync()` from worker startup and job paths.

## Task list

### 1. worker-node runtime cleanup

- [ ] Rework `worker-node/src/modules/db/ensureDbReady.ts` to use `ensureSchemaReady(sequelize)` instead of `sequelize.sync()`.
- [ ] Keep the existing helper name and public behavior stable so callers do not need to change.
- [ ] Remove runtime `sequelize.sync()` from `worker-node/src/modules/jobs/requestGoogleRssJob.ts`.
- [ ] Remove runtime `sequelize.sync()` from `worker-node/src/modules/jobs/semanticScorerJob.ts`.
- [ ] Confirm worker jobs now assume schema bootstrap has already been completed.
- [ ] Verify startup and job failures are clear when the schema is missing instead of trying to create it automatically.

### 2. worker-node dialect audit

- [ ] Audit `worker-node` code paths identified by the raw SQL inventory for SQLite-specific behavior.
- [ ] Review scraper, RSS ingester, semantic scorer, and state assigner flows for SQL or data assumptions that relied on SQLite permissiveness.
- [ ] Confirm write-heavy paths use transactions appropriately so Postgres connections are not thrashed during bursts.
- [ ] Remove any remaining SQLite-specific error handling or fallback behavior discovered during the audit.

### 3. worker-python driver migration

- [ ] Replace `sqlite3` usage with `psycopg` v3 in:
  - [ ] `worker-python/src/modules/deduper/repository.py`
  - [ ] `worker-python/src/modules/location_scorer/repository.py`
  - [ ] `worker-python/src/modules/ai_approver/repository.py`
  - [ ] `worker-python/src/standalone/setup_ai_approver_prompt.py`
- [ ] Add and configure `psycopg_pool.ConnectionPool` for worker runtime usage.
- [ ] Size the worker-python connection pool according to the transition plan.
- [ ] Confirm connection lifecycle and cleanup behavior still works for long-running jobs and one-off scripts.

### 4. worker-python query conversion

- [ ] Replace SQLite parameter placeholders `?` with Postgres-compatible `%s`.
- [ ] Replace `INSERT OR IGNORE` with `INSERT ... ON CONFLICT DO NOTHING`.
- [ ] Replace `cursor.lastrowid` usage with `RETURNING id` plus fetch logic.
- [ ] Replace every `datetime('now')` call with `NOW()` or `CURRENT_TIMESTAMP`.
- [ ] Review boolean handling so values are treated as real booleans instead of SQLite integer-style truth values.
- [ ] Review limit clauses, ordering, and raw SQL expressions for any SQLite-only syntax.
- [ ] Confirm the standalone AI approver prompt setup script works correctly against Postgres.

### 5. worker-python configuration and environment

- [ ] Replace `sqlite_path`-style config with Postgres connection settings or DSN-based configuration.
- [ ] Replace `PATH_DATABASE` and `NAME_DB` usage with:
  - [ ] `PG_HOST`
  - [ ] `PG_PORT`
  - [ ] `PG_USER`
  - [ ] `PG_PASSWORD`
  - [ ] `PG_DATABASE`
- [ ] Update any `.env.example` or worker-specific setup documentation touched by this phase.
- [ ] Confirm startup validation errors are clear when required Postgres env vars are missing.

### 6. worker tests and fixtures

- [ ] Update `worker-python/tests/conftest.py` to use `newsnexus_test_worker_python`.
- [ ] Replace temp SQLite file fixtures with Postgres-backed test setup where required.
- [ ] Update worker-python unit or integration fixtures that embed SQLite-specific SQL syntax.
- [ ] Update any worker-node test assumptions affected by removing runtime `sync()` from startup or jobs.
- [ ] Confirm the raw SQL inventory statuses are updated for all worker-related entries touched in this phase.

### 7. Smoke-test critical worker flows

- [ ] Smoke-test the main `worker-node` job paths against local Postgres:
  - [ ] request Google RSS
  - [ ] semantic scorer
  - [ ] any other high-priority flow surfaced during implementation
- [ ] Smoke-test the main `worker-python` job paths against local Postgres:
  - [ ] deduper
  - [ ] location scorer
  - [ ] AI approver path if still active
- [ ] Confirm successful writes land in Postgres correctly for representative jobs.

## Validation

### 1. Required checks before marking the phase complete

- [ ] `worker-node` builds successfully.
- [ ] `worker-node` tests pass.
- [ ] `worker-python` tests pass.
- [ ] `worker-node` starts without runtime `sequelize.sync()` in startup or job paths.
- [ ] `worker-python` runs against Postgres with no remaining `sqlite3` dependency in active code paths.
- [ ] The raw SQL inventory is updated so all worker entries touched in this phase are marked converted or ruled safe.

### 2. Suggested commands to run during completion

1. Run the `worker-node` build.
2. Run the `worker-node` test suite.
3. Verify the Python runtime with `which python` and `python --version`.
4. Run the relevant `worker-python` tests against Postgres.
5. Run targeted grep checks for:
   - `sequelize.sync()` in `worker-node`
   - `sqlite3` imports in `worker-python`
   - `datetime('now')`
   - `INSERT OR IGNORE`
   - `?` placeholders in worker SQL

## Completion workflow

1. Finish all checklist items for this phase.
2. Run the applicable validation commands.
3. Check off completed items only after the checks pass.
4. Commit with a message that references this TODO file and Phase 2 completion progress.

## Commit note

- Reference this file in the commit body.
- Mention that the commit completes all or part of Phase 2.
- Keep commits scoped to discrete, testable units when possible.
