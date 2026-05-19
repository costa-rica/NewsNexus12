# News Nexus 12 Postgres Transition Phase 4 TODO

Phase 4 finishes the test and CI migration so the repo validates against Postgres by default. The goal is to move every supported package test suite onto package-specific Postgres databases, replace SQLite-specific assertions, and make CI provision and use the correct test databases reliably.

## Phase goal

- Complete the tests and CI work described in Phase 4 of `docs/20260418_POSTGRES_TRANSITION_PLAN.md`.
- Finish with `api`, `db-manager`, `worker-node`, and `worker-python` validating against Postgres in local test runs and CI.
- Eliminate false-green test coverage caused by lingering SQLite-based fixtures or assumptions.

## Task list

### 1. Package-specific test database setup

- [ ] Confirm package-specific Postgres test databases are used consistently:
  - [ ] `newsnexus_test_api`
  - [ ] `newsnexus_test_db_manager`
  - [ ] `newsnexus_test_worker_node`
  - [ ] `newsnexus_test_worker_python`
- [ ] Ensure test runners do not inherit the normal development database by mistake.
- [ ] Verify each package has a stable test env configuration for its own database.

### 2. TypeScript package test bootstrap

- [ ] Add or finalize Jest database bootstrap for `api`.
- [ ] Add or finalize Jest database bootstrap for `db-manager`.
- [ ] Add or finalize Jest database bootstrap for `worker-node`.
- [ ] Ensure each TS package test setup:
  - [ ] reads the package-specific `PG_DATABASE`
  - [ ] drops and recreates the package test database
  - [ ] runs `sequelize.sync()` as a test-only bootstrap step
- [ ] Confirm setup runs reliably in repeat local runs.

### 3. Python test bootstrap

- [ ] Finalize `worker-python` Postgres test setup in `tests/conftest.py`.
- [ ] Ensure Python tests no longer depend on temp SQLite files.
- [ ] Verify Python test setup can recreate a clean package-specific Postgres test database safely.

### 4. Replace SQLite-specific test assertions

- [ ] Rewrite `db-manager` tests that assert on literal `PRAGMA` statements.
- [ ] Rewrite tests that assert on old SQLite file-existence or file-creation behavior.
- [ ] Rewrite tests that depended on runtime `sequelize.sync()` being called in normal service or job startup.
- [ ] Update fixture SQL snippets still using SQLite syntax such as:
  - [ ] `?` placeholders
  - [ ] `datetime('now')`
  - [ ] `INSERT OR IGNORE`
- [ ] Replace assertion style where needed with behavior-level checks rather than dialect-specific SQL text.

### 5. Postgres-focused test coverage gaps

- [ ] Add or strengthen coverage for sequence reset behavior after import.
- [ ] Add or strengthen coverage for topological load ordering during restore.
- [ ] Add or strengthen coverage for startup behavior when schema is missing.
- [ ] Add or strengthen coverage for package-specific DB isolation so tests do not collide.
- [ ] Add or strengthen coverage for worker and api runtime paths that were previously shielded by SQLite permissiveness.

### 6. CI provisioning and execution

- [ ] Update CI to install or provision Postgres natively on the runner.
- [ ] Ensure each package test job provisions only the package-specific database it needs.
- [ ] Verify CI jobs do not share a single Postgres test database.
- [ ] Confirm environment variables in CI point to package-specific test databases.
- [ ] Verify CI runs pass without SQLite fallback behavior.

### 7. Final SQLite test cleanup

- [ ] Grep the test tree for leftover SQLite-specific constructs.
- [ ] Remove or update remaining `sqlite3` imports in tests where Postgres should now be used.
- [ ] Remove or update remaining `PRAGMA`, `sqlite_master`, and temp `.db` assumptions in tests.
- [ ] Update the raw SQL inventory for any entries closed during test migration work.

## Validation

### 1. Required checks before marking the phase complete

- [ ] `api` tests pass against `newsnexus_test_api`.
- [ ] `db-manager` tests pass against `newsnexus_test_db_manager`.
- [ ] `worker-node` tests pass against `newsnexus_test_worker_node`.
- [ ] `worker-python` tests pass against `newsnexus_test_worker_python`.
- [ ] CI passes using Postgres-backed test execution.
- [ ] Grep confirms no supported package test suite still relies on SQLite by default.

### 2. Suggested commands to run during completion

1. Run the `api` test suite.
2. Run the `db-manager` test suite.
3. Run the `worker-node` test suite.
4. Verify the Python runtime with `which python` and `python --version`.
5. Run the `worker-python` tests.
6. Run targeted grep checks for:
   - `sqlite3`
   - `PRAGMA`
   - `sqlite_master`
   - temp `.db` test setup
   - `sequelize.sync()` assertions in runtime-path tests
7. Run the CI workflow or the closest local equivalent and confirm green status.

## Completion workflow

1. Finish all checklist items for this phase.
2. Run the applicable validation commands.
3. Check off completed items only after the checks pass.
4. Commit with a message that references this TODO file and Phase 4 completion progress.

## Commit note

- Reference this file in the commit body.
- Mention that the commit completes all or part of Phase 4.
- Keep commits scoped to discrete, testable units when possible.
