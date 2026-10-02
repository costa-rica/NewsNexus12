---
created_at: 2026-10-02T22:21:32Z
updated_at: 2026-10-02T22:21:32Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Phase 2 Plan V01

## Purpose

- Add the Phase 2 database-backup module to weekly-flow-02.
- Invoke db-manager's existing `--create_backup` operation after Phase 1 succeeds.
- Verify the completed backup artifact before the coordinator can advance.
- Preserve readable, direct control flow without adding run persistence or a general pipeline framework.

## Basis and scope

- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Completed Phase 1 design: [Weekly Flow 02 Phase 1 Plan V04](20261002_weekly_flow_02_phase_1_plan_v04.md).
- Phase 1 implementation record: [Weekly Flow 02 Phase 1 Todo V02](20261002_weekly_flow_02_phase_1_todo_v02.md).
- Planning workflow: [Plan and Vet](../PLAN_AND_VET.md).

The operator reports that Phase 1 passed on `nws-nn12dev`. The validated response recorded zero rows deleted, empty cancellation collections, a worker timestamp, and the expected Phase 2 boundary.

This plan covers the db-manager backup contract, the Phase 2 module, coordinator integration, focused tests, local fixture verification, and one real development-server backup.

It does not implement old-article deletion, `WeeklyArticleFlowRuns02`, continuation, automatic retries, systemd units, notifications, or production rollout.

## Decisions

1. Run the compiled db-manager CLI as a child process rather than importing its runtime into ops.
2. Use `node db-manager/dist/index.js --create_backup` with `db-manager/` as the child working directory.
3. Add a stable JSON success line to db-manager stdout so ops can receive the completed artifact metadata in every logging environment.
4. Restore the generic version 1 backup manifest behavior previously proven in db-manager without restoring the removed V01 workflow.
5. Verify the ZIP path, size, archive SHA-256, and manifest version before Phase 2 completes.
6. Use a required `DB_MANAGER_BACKUP_TIMEOUT_SECONDS` setting with an example value of 1800 seconds.
7. Stop the flow after every command, timeout, output-contract, or artifact-verification failure.
8. Keep rerun behavior simple: a new invocation begins again at Phase 1 and creates another timestamped backup.
9. Use one operator checkpoint before the real development-server backup. Do not pause between internal implementation slices.

## Inside-out implementation direction

Build the module from the success contract outward to process execution.

1. Define the typed backup result used by the coordinator.
2. Parse and validate the db-manager success line as unknown input.
3. Verify a reported artifact before treating the result as complete.
4. Add the child-process runner with timeout and bounded output capture.
5. Add the db-manager success-output and manifest contract.
6. Connect Phase 2 after the validated Phase 1 result.
7. Verify failure boundaries with injected dependencies and a controlled local command fixture.
8. Perform one operator-reviewed backup on the development server.

This order keeps filesystem and process details outside the coordinator while the result contract remains small and explicit.

## Existing db-manager behavior

The existing command is:

```bash
npm start -- --create_backup
```

Its underlying compiled entry point is `db-manager/dist/index.js`. It loads `db-manager/.env`, initializes shared models, validates the schema, creates the backup, logs database status, closes Sequelize, and returns exit status 0 or 1.

The backup module currently:

- Reads all registered Sequelize models sequentially.
- Writes one CSV for each nonempty model.
- Omits CSV files for empty models.
- Creates a timestamped ZIP under `PATH_DB_BACKUPS`.
- Removes the temporary CSV directory after success.
- Returns the ZIP path to the db-manager entry point.

The current production logger writes the path to the db-manager log but not reliably to stdout. Ops therefore cannot use process exit alone to record the required location.

The backup reads models sequentially without one shared database snapshot. This increment does not claim transactionally consistent cross-table state and does not redesign the backup query strategy.

## Db-manager backup result contract

Change the internal backup result from a path string to a typed object containing:

- `backupPath`: absolute ZIP path.
- `byteSize`: positive integer archive size.
- `sha256`: lowercase SHA-256 digest of the completed ZIP.
- `manifestVersion`: integer value `1`.

After the ZIP closes successfully, db-manager calculates the archive size and SHA-256. It logs the human-readable path and writes one JSON line to stdout:

```json
{"event":"database_backup_created","backupPath":"/absolute/path/db_backup_timestamp.zip","byteSize":123,"sha256":"64 lowercase hexadecimal characters","manifestVersion":1}
```

The JSON line is the machine-readable boundary between db-manager and ops. It appears only after archive creation and result calculation succeed.

Other stdout lines may exist, including the shared model package's database-target message. Ops scans complete lines and accepts exactly one valid `database_backup_created` result. It does not infer success from human-readable logs.

## Backup manifest

Restore the generic db-manager version 1 manifest without restoring any removed weekly-flow schema or runtime code.

The ZIP contains `manifest.json` with:

- `version: 1`.
- `createdAt`: an ISO timestamp.
- One entry for every registered model.
- Each model name and row count.
- CSV filename, byte size, and SHA-256 for nonempty models.
- Null file metadata for empty models.

The cleared `ArticleDuplicateAnalysis` model remains represented with zero rows and no CSV when no new analysis rows were added after Phase 1.

The existing ZIP importer continues ignoring files it does not consume, so adding `manifest.json` remains backward compatible.

On a handled backup error, db-manager removes its temporary directory and incomplete ZIP. A forced timeout may interrupt normal cleanup, so timeout handling preserves any remaining artifact for operator inspection rather than declaring it valid or deleting it automatically.

## Child-process execution

The Phase 2 module runs:

```text
<current Node executable> <repository>/db-manager/dist/index.js --create_backup
```

Use `process.execPath` for Node and resolve the db-manager directory from the known monorepo layout. Do not invoke a shell and do not interpolate a command string.

Set the child working directory to `db-manager/` so its existing `dotenv.config()` reads `db-manager/.env`.

Build a child environment that preserves ordinary operating-system values but removes application variables owned by ops or db-manager. This prevents the coordinator's `NODE_ENV`, `NAME_APP`, logging values, worker URL, future `PG_*` values, or backup path from overriding `db-manager/.env`.

The child remains responsible for its database credentials, backup destination, and db-manager log settings. Ops does not read, copy, or log those secrets.

Capture stdout and stderr with a fixed maximum retained size. Do not write complete child output into the coordinator log.

## Timeout behavior

Add `DB_MANAGER_BACKUP_TIMEOUT_SECONDS` to ops configuration and `.env.example`.

- Require a positive integer.
- Use 1800 seconds in the tracked example.
- Apply the conversion to milliseconds only at the child-process boundary.
- Terminate the direct Node child if the timeout expires.
- Treat timeout as an unverified Phase 2 failure.
- Do not start Phase 3 after timeout.

The timeout is a coordinator limit. It does not change db-manager's database or archive behavior.

If normal termination does not close the child within a short bounded grace period, force termination. Log the timeout and signal outcome without dumping environment data or complete command output.

## Phase result and artifact verification

The public Phase 2 function returns:

- `backupPath`.
- `byteSize`.
- `sha256`.
- `manifestVersion`.

Phase 2 succeeds only when all conditions are true:

1. The child exits normally with status 0.
2. Exactly one valid success line is present.
3. The reported path is absolute.
4. The path exists and is a regular file.
5. The observed file size is positive and matches `byteSize`.
6. The independently calculated archive SHA-256 matches `sha256`.
7. The manifest version is exactly 1.

The db-manager unit tests verify the manifest contents, CSV sizes, CSV hashes, empty-model entries, and cleanup behavior. The ops boundary verifies the completed archive's external metadata without loading a potentially large ZIP into memory.

Do not restore the backup during every weekly run. Restore rehearsal remains a separate deployment and recovery check using a disposable database.

## Failure and rerun behavior

Treat these outcomes as Phase 2 failures:

- Spawn failure or missing compiled entry point.
- Timeout or signal termination.
- Nonzero child exit.
- Missing, duplicate, malformed, or invalid success output.
- Missing artifact, non-file path, empty archive, size mismatch, or checksum mismatch.
- Unsupported manifest version.

On failure:

1. Log a concise category and safe message.
2. Preserve the original error as the cause when wrapping it.
3. Return a nonzero weekly-flow process exit status.
4. Do not log Phase 2 completion.
5. Do not log or start Phase 3.
6. Do not retry automatically.
7. Do not delete a reported or partial artifact automatically.

A later invocation repeats Phase 1 and then runs a new backup. Existing successful archives remain untouched. The coordinator has no durable run state in this increment.

## Coordinator behavior

The coordinator sequence becomes:

1. Start the weekly pipeline.
2. Run and validate Phase 1.
3. Log Phase 1 completion.
4. Log Phase 2 start.
5. Run db-manager and verify the backup result.
6. Log Phase 2 completion with path, byte size, SHA-256, and manifest version.
7. Stop before unimplemented Phase 3.

Any Phase 1 failure still prevents Phase 2 from starting. Any Phase 2 failure prevents its completion log and the Phase 3 boundary.

Keep the result available as a typed return value for future persistence. Do not introduce a run ID, database table, JSONL record, or recovery state yet.

## Code structure

Use the shared `02_` prefix for Phase 2 files:

- `ops/src/weekly-flow-02/phases/02_createDatabaseBackup.ts` owns the readable public phase function.
- `ops/src/weekly-flow-02/phases/02_createDatabaseBackupCommand.ts` owns child execution, output parsing, timeout handling, and artifact verification.
- `ops/tests/weekly-flow-02/02_createDatabaseBackup.test.ts` covers the Phase 2 contract and coordinator boundary.
- `db-manager/src/modules/backup.ts` owns manifest generation and the typed backup result.
- `db-manager/src/index.ts` emits the stable success line after backup completion.
- Existing db-manager backup tests cover the expanded artifact contract.

Keep dependencies explicit through small function parameters. Do not add a generic command framework until another phase demonstrates the same requirements.

## Testing approach

### Db-manager tests

- Verify the result contains an absolute ZIP path, positive size, archive SHA-256, and manifest version 1.
- Verify `manifest.json` exists and contains every registered model.
- Verify nonempty CSV entries have matching row counts, sizes, and hashes.
- Verify empty model entries have null file metadata.
- Verify temporary directories and partial ZIPs are removed after handled failures.
- Verify the CLI success formatter produces the stable JSON line.

### Ops unit tests

- Parse a valid success line among unrelated stdout lines.
- Reject missing, duplicate, malformed, and incorrectly typed results.
- Reject invalid paths, sizes, hashes, and manifest versions.
- Verify child executable, arguments, working directory, and environment isolation.
- Verify success only after exit status and artifact checks pass.
- Cover spawn failure, nonzero exit, signal exit, timeout, missing file, empty file, size mismatch, and checksum mismatch.
- Confirm captured output is bounded and errors do not expose environment values.

### Coordinator tests

- Confirm Phase 2 starts only after Phase 1 completes.
- Confirm Phase 2 success metadata is logged before the Phase 3 boundary.
- Confirm every Phase 2 failure prevents completion and later work.
- Preserve all existing Phase 1 success and failure coverage.

### Local runtime fixture

Use a temporary command fixture outside the tracked tree. It writes a controlled ZIP-like artifact and the stable success line without accessing PostgreSQL.

Run development and compiled entry points against successful, failed, malformed-output, checksum-mismatch, and delayed fixtures. Supply every required setting explicitly and remove temporary files afterward.

## Build and verification

1. Build `db-models`, then db-manager, then ops.
2. Run the complete db-manager test suite.
3. Run the complete ops test suite and confirm every explicit compiled test file executes.
4. Run ops type checking and clean production compilation.
5. Confirm test output is ignored and absent from production output.
6. Confirm no `.env`, backup ZIP, CSV, temporary directory, or log is committed.
7. Verify local runtime behavior with controlled fixtures.
8. Review readiness once before the real development-server backup.

## Development-server verification

Before running the real backup on `nws-nn12dev`:

- Confirm the intended branch and commit.
- Confirm the db-manager database target is the development database.
- Confirm `PATH_DB_BACKUPS` is the intended directory.
- Confirm `limited_user` can read db-manager configuration and write the backup directory.
- Check available disk space.
- Build db-models, db-manager, and ops in dependency order.
- Run db-manager and ops tests and the ops type check.

Run weekly-flow-02 as `limited_user`. Confirm:

- Phase 1 completes first.
- Phase 2 creates one new ZIP.
- The coordinator records the path, positive byte size, SHA-256, and manifest version 1.
- The ZIP exists under the intended backup directory with the expected owner and permissions.
- The db-manager log and coordinator log agree on the backup location.
- The process exits successfully at the Phase 3 boundary.

Inspect `manifest.json` from the development artifact without restoring it. Confirm version 1 and the expected zero-row duplicate-analysis entry.

Record the current lack of a shared database snapshot as a known limitation. Do not run a restore against the active development database.

## Review cadence

- Claude assesses this plan under `plan-and-vet`.
- After the plan passes, create and assess one implementation todo.
- Once implementation starts, proceed through code, tests, and local fixtures without operator pauses between internal slices.
- Use one operator checkpoint before the real development-server backup.
- Report final development evidence after the run without adding another mandatory checkpoint inside this module.

## Completion boundary

Phase 2 is ready when:

- A validated Phase 1 result is always required before backup starts.
- Db-manager emits a stable machine-readable backup result.
- The backup includes and reports manifest version 1.
- Ops verifies the completed path, size, and SHA-256 before Phase 2 completes.
- Every failure stops the flow with a nonzero exit and no Phase 3 work.
- Reruns create new backups without deleting prior successful artifacts.
- Db-manager and ops tests, type checks, builds, and local fixture checks pass.
- One development-server run creates and verifies the expected backup under `limited_user`.

Implementation requires a task-style todo after this plan is accepted under [Plan and Vet](../PLAN_AND_VET.md).
