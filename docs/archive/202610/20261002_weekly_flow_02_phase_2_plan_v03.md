---
created_at: 2026-10-02T22:30:25Z
updated_at: 2026-10-02T22:30:25Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Phase 2 Plan V03

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
- Prior plan: [Weekly Flow 02 Phase 2 Plan V02](20261002_weekly_flow_02_phase_2_plan_v02.md).
- Assessment: [V02 Assessment by Claude](20261002_weekly_flow_02_phase_2_plan_v02_assessment_claude.md).
- Planning workflow: [Plan and Vet](../PLAN_AND_VET.md).

The operator reports that Phase 1 passed on `nws-nn12dev`. The validated response recorded zero rows deleted, empty cancellation collections, a worker timestamp, and the expected Phase 2 boundary.

This plan covers the db-manager backup contract, the Phase 2 module, coordinator integration, focused tests, local fixture verification, and one real development-server backup.

It does not implement old-article deletion, `WeeklyArticleFlowRuns02`, continuation, automatic retries, systemd units, notifications, or production rollout.

## Changes from V02

1. Add a code-only command dependency for tests and local harnesses.
2. Keep the production command fixed to the compiled db-manager entry point.
3. Do not add a db-manager path environment variable or CLI override.
4. Replace fixture runs through the real weekly-flow entry point with source and compiled harness runs.
5. Keep the real `weekly-flow-02:dev` and `weekly-flow-02:start` commands for the development-server backup.
6. Describe `/usr/bin/time -v` output as the combined peak resident memory of the coordinator and waited-for child.

V03 retains V02's continuous stream draining, incremental line parsing, bounded diagnostics, absolute backup path, explicit environment isolation, artifact preservation, and explicit test-path requirements.

## Decisions

1. Run the compiled db-manager CLI as a child process rather than importing its runtime into ops.
2. Use `node db-manager/dist/index.js --create_backup` with `db-manager/` as the child working directory.
3. Add a stable JSON success line to db-manager stdout so ops receives completed artifact metadata in every logging environment.
4. Restore the generic version 1 backup manifest behavior previously proven in db-manager without restoring the removed V01 workflow.
5. Verify the ZIP path, size, archive SHA-256, and reported manifest version before Phase 2 completes.
6. Use a required `DB_MANAGER_BACKUP_TIMEOUT_SECONDS` setting with an example value of 1800 seconds.
7. Stop the flow after every command, timeout, output-contract, or artifact-verification failure.
8. Keep rerun behavior simple: a new invocation begins again at Phase 1 and creates another timestamped backup.
9. Use one operator checkpoint before the real development-server backup. Do not pause between internal implementation slices.

## Inside-out implementation direction

Build the module from the success contract outward to process execution.

1. Define the typed backup result used by the coordinator.
2. Parse and validate one db-manager success line as unknown input.
3. Verify a reported artifact before treating the result as complete.
4. Add continuously drained child streams, incremental line parsing, timeout handling, and bounded diagnostics.
5. Add the db-manager success-output and manifest contract.
6. Connect Phase 2 after the validated Phase 1 result.
7. Verify failure boundaries with injected code dependencies and controlled local harnesses.
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

Resolve `PATH_DB_BACKUPS` with `path.resolve()` before creating the temporary directory or ZIP. A relative value remains supported but becomes absolute relative to the db-manager working directory.

After the ZIP closes successfully, db-manager calculates the archive size and SHA-256. It logs the human-readable path and writes one JSON line to stdout:

```json
{"event":"database_backup_created","backupPath":"/absolute/path/db_backup_timestamp.zip","byteSize":123,"sha256":"64 lowercase hexadecimal characters","manifestVersion":1}
```

The JSON line is the machine-readable boundary between db-manager and ops. It appears only after archive creation and result calculation succeed.

Other stdout lines may exist, including the shared model package's database-target message and Winston console output. Ops does not infer success from human-readable logs.

Db-manager still queries database status after creating the backup. Ops accepts the success record only when the child later exits with status 0. If the status query fails, Phase 2 fails and leaves the already-completed ZIP in place for inspection.

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

The existing ZIP importer collects CSV entries and ignores `manifest.json`, so the added file remains backward compatible.

On a handled backup error, db-manager removes its temporary directory and incomplete ZIP. A forced timeout may interrupt normal cleanup, so timeout handling preserves any remaining artifact for operator inspection rather than declaring it valid or deleting it automatically.

## Production child-process execution

The default Phase 2 command is fixed as:

```text
<current Node executable> <repository>/db-manager/dist/index.js --create_backup
```

Use `process.execPath` for Node and resolve the db-manager directory from the known monorepo layout. Do not invoke a shell and do not interpolate a command string.

Set the child working directory to `db-manager/` so its existing `dotenv.config()` reads `db-manager/.env`.

The production entry point always uses this default command. Do not add `DB_MANAGER_ENTRY_PATH`, a CLI command override, or another production setting that can select an arbitrary script.

## Code-only command seam

Define a small command specification or launcher interface beside the Phase 2 command module. It contains only the executable, argument list, working directory, and child environment needed by the runner.

- Production constructs the fixed db-manager specification internally.
- Unit tests pass an in-memory launcher or controlled specification directly.
- Temporary local harnesses pass a fixture specification through function arguments.
- `index.ts` does not read or accept a command override.
- `OpsConfig` does not contain a db-manager entry path.

The coordinator may accept a small dependencies object with defaults for the Phase 1 request and Phase 2 command. This is a code seam for tests, not a user-facing configuration surface.

The source harness imports the source coordinator or Phase 2 module and passes the fixture command through this seam. The compiled harness imports the built module and does the same. Neither harness changes tracked production output or replaces `db-manager/dist/index.js`.

## Child environment isolation

Copy the parent environment, then remove these exact ops keys before spawning:

- `NODE_ENV`
- `NAME_APP`
- `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`
- `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`
- `DB_MANAGER_BACKUP_TIMEOUT_SECONDS`
- `PATH_TO_LOGS`
- `LOG_MAX_SIZE`
- `LOG_MAX_FILES`

Also remove db-manager-owned keys that could have been inherited:

- `NEXT_PUBLIC_MODE`
- `PATH_DB_BACKUPS`
- Every key beginning with `PG_`

This keeps ordinary values such as `PATH`, `HOME`, locale, temporary-directory settings, and Node runtime settings while forcing db-manager application configuration to come from `db-manager/.env`.

The child remains responsible for its database credentials, backup destination, and db-manager log settings. Ops does not read, copy, or log those secrets.

The code-only fixture specification may provide its own minimal environment. It does not weaken or bypass environment isolation for the production db-manager specification.

## Continuous stream handling

Read stdout and stderr continuously until both streams end and the child closes. Never pause, detach, or stop reading when retained diagnostic output reaches its cap.

Process stdout incrementally:

1. Decode chunks as UTF-8 without corrupting a character split across chunks.
2. Retain the incomplete final fragment between chunks.
3. Parse each complete line as it arrives.
4. Record valid `database_backup_created` candidates and their count separately from diagnostic text.
5. Process the final unterminated fragment when stdout ends.

Bound the incomplete-line buffer. A line exceeding the documented limit is an output-contract failure, but ops continues draining the stream until the child exits.

Use a rolling tail buffer for diagnostic excerpts, such as the last 32 KiB from each stream. The cap applies only to text retained for an error. It never controls whether the underlying stream continues to drain.

Do not write complete child output into the coordinator log. On failure, include only the safe, bounded diagnostic needed to identify the problem.

## Timeout behavior

Add `DB_MANAGER_BACKUP_TIMEOUT_SECONDS` to ops configuration and `.env.example`.

- Require a positive integer.
- Use 1800 seconds in the tracked example.
- Apply the conversion to milliseconds only at the child-process boundary.
- Terminate the direct Node child if the timeout expires.
- Treat timeout as an unverified Phase 2 failure.
- Do not start Phase 3 after timeout.

The timeout is a coordinator limit. It does not change db-manager's database or archive behavior.

If normal termination does not close the child within a short bounded grace period, force termination. Continue draining stdout and stderr through process close. Log the timeout and signal outcome without dumping environment data or complete command output.

## Phase result and artifact verification

The public Phase 2 function returns:

- `backupPath`.
- `byteSize`.
- `sha256`.
- `manifestVersion`.

Phase 2 succeeds only when all conditions are true:

1. The child exits normally with status 0.
2. Exactly one valid success candidate was recorded while stdout was drained.
3. The reported path is absolute.
4. The path exists and is a regular file.
5. The observed file size is positive and matches `byteSize`.
6. The independently calculated archive SHA-256 matches `sha256`.
7. The reported manifest version is exactly 1.

The db-manager tests verify the manifest contents, CSV sizes, CSV hashes, empty-model entries, and cleanup behavior. The ops boundary verifies external metadata without loading a potentially large ZIP into memory.

Ops does not independently read `manifest.json` during routine execution. Its completion log therefore says `reportedManifestVersion`, not that archive contents were independently validated.

The development-server check inspects `manifest.json` from the created ZIP. Restore rehearsal remains a separate recovery check using a disposable database.

## Failure and rerun behavior

Treat these outcomes as Phase 2 failures:

- Spawn failure or missing compiled entry point.
- Timeout or signal termination.
- Nonzero child exit, even if a success candidate was seen earlier.
- Missing, duplicate, oversized, malformed, or invalid success output.
- Missing artifact, non-file path, empty archive, size mismatch, or checksum mismatch.
- Unsupported reported manifest version.

On failure:

1. Log a concise category and safe message.
2. Preserve the original error as the cause when wrapping it.
3. Return a nonzero weekly-flow process exit status.
4. Do not log Phase 2 completion.
5. Do not log or start Phase 3.
6. Do not retry automatically.
7. Do not delete a reported, completed, or partial artifact automatically.

A later invocation repeats Phase 1 and then runs a new backup. Existing successful archives remain untouched. The coordinator has no durable run state in this increment.

## Coordinator behavior

The coordinator sequence becomes:

1. Start the weekly pipeline.
2. Run and validate Phase 1.
3. Log Phase 1 completion.
4. Log Phase 2 start.
5. Run db-manager and verify the backup result.
6. Log Phase 2 completion with path, byte size, SHA-256, and reported manifest version.
7. Stop before unimplemented Phase 3.

Any Phase 1 failure still prevents Phase 2 from starting. Any Phase 2 failure prevents its completion log and the Phase 3 boundary.

Keep the result available as a typed return value for future persistence. Do not introduce a run ID, database table, JSONL record, or recovery state yet.

## Code structure

Use the shared `02_` prefix for Phase 2 files:

- `ops/src/weekly-flow-02/phases/02_createDatabaseBackup.ts` owns the readable public phase function.
- `ops/src/weekly-flow-02/phases/02_createDatabaseBackupCommand.ts` owns the fixed production command, code-only seam, execution, streaming output parsing, timeout handling, and artifact verification.
- `ops/tests/weekly-flow-02/02_createDatabaseBackup.test.ts` covers the Phase 2 contract and coordinator boundary.
- `db-manager/src/modules/backup.ts` owns manifest generation and the typed backup result.
- `db-manager/src/index.ts` emits the stable success line after backup completion.
- Existing db-manager backup tests cover the expanded artifact contract.

Temporary source and compiled harness files stay outside the tracked source tree and are removed after verification.

Keep dependencies explicit through small function parameters. Do not add a generic command framework until another phase demonstrates the same requirements.

## Testing approach

### Db-manager tests

- Verify the result contains an absolute ZIP path, positive size, archive SHA-256, and manifest version 1.
- Verify a relative `PATH_DB_BACKUPS` produces an absolute reported path.
- Verify `manifest.json` exists and contains every registered model.
- Verify nonempty CSV entries have matching row counts, sizes, and hashes.
- Verify empty model entries have null file metadata.
- Verify temporary directories and partial ZIPs are removed after handled failures.
- Verify the CLI success formatter produces the stable JSON line.

### Ops unit tests

- Parse one valid success line among unrelated stdout lines.
- Parse a success line split across multiple stream chunks.
- Preserve a success candidate surrounded by output larger than the diagnostic retention cap.
- Drain a child that writes past the cap and confirm it exits without blocking.
- Reject missing, duplicate, oversized, malformed, and incorrectly typed results.
- Reject invalid paths, sizes, hashes, and manifest versions.
- Verify the fixed production executable, arguments, and working directory.
- Verify the code-only seam accepts a controlled fixture without adding configuration.
- Set sentinel values for every removed key and representative `PG_*` keys, then confirm none reaches the production child.
- Verify ordinary operating-system values still reach the production child.
- Verify success only after exit status and artifact checks pass.
- Cover spawn failure, nonzero exit after a candidate, signal exit, timeout, missing file, empty file, size mismatch, and checksum mismatch.
- Confirm errors retain only bounded diagnostics and do not expose environment values.

### Coordinator tests

- Confirm Phase 2 starts only after Phase 1 completes.
- Confirm Phase 2 success metadata is logged before the Phase 3 boundary.
- Confirm every Phase 2 failure prevents completion and later work.
- Confirm the production coordinator defaults to the fixed db-manager command.
- Preserve all existing Phase 1 success and failure coverage.

### Test command

Create `ops/tests/weekly-flow-02/02_createDatabaseBackup.test.ts` before changing the explicit ops test command.

After the source file exists, append this compiled path:

```text
dist-test/tests/weekly-flow-02/02_createDatabaseBackup.test.js
```

Confirm all expected compiled files exist before running `node --test`, and record the file list and test count.

## Local runtime harnesses

Create a temporary fixture command outside the tracked tree. It writes a controlled ZIP-like artifact and stable success line without accessing PostgreSQL.

Create temporary source and compiled harnesses outside the tracked tree:

- The source harness imports the source coordinator or Phase 2 module and passes the fixture command through the code-only seam.
- The compiled harness imports the built coordinator or Phase 2 module and passes the same fixture command.
- Both harnesses construct configuration explicitly and do not load `ops/.env` or `db-manager/.env`.
- If the coordinator is used, both harnesses inject a successful Phase 1 request so worker-python is not contacted.

Exercise successful, failed, malformed-output, oversized-output, checksum-mismatch, and delayed fixture modes. Remove the harnesses, fixture, artifacts, and logs afterward.

Do not run `weekly-flow-02:dev` or `weekly-flow-02:start` against the fixture. Those production entry points retain the fixed real db-manager command and are first exercised end to end during development-server verification.

## Build and verification

1. Build `db-models`, then db-manager, then ops.
2. Run the complete db-manager test suite.
3. Run the complete ops test suite and confirm every explicit compiled test file executes.
4. Run ops type checking and clean production compilation.
5. Confirm test output is ignored and absent from production output.
6. Confirm no `.env`, backup ZIP, CSV, temporary directory, harness, fixture, or log is committed.
7. Verify source and compiled behavior through the controlled local harnesses.
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

Run the real weekly-flow entry point as `limited_user`. Use `/usr/bin/time -v` when available to record the combined peak resident memory of the coordinator and its waited-for child process.

If separate child memory is later required, measure db-manager directly or sample its PID. Separate figures are not required for this increment.

Confirm:

- Phase 1 completes first.
- Phase 2 creates one new ZIP.
- The coordinator records the path, positive byte size, SHA-256, and reported manifest version 1.
- The ZIP exists under the intended backup directory with the expected owner and permissions.
- The db-manager log and coordinator log agree on the backup location.
- The process exits successfully at the Phase 3 boundary.
- Combined peak memory is recorded for later production-capacity review.

Inspect `manifest.json` from the development artifact without restoring it. Confirm version 1 and the expected zero-row duplicate-analysis entry.

Record the current lack of a shared database snapshot as a known limitation. Do not run a restore against the active development database.

## Review cadence

- Claude assesses this plan under `plan-and-vet`.
- After the plan passes, create and assess one implementation todo.
- Once implementation starts, proceed through code, tests, and local harnesses without operator pauses between internal slices.
- Use one operator checkpoint before the real development-server backup.
- Report final development evidence after the run without adding another mandatory checkpoint inside this module.

## Completion boundary

Phase 2 is ready when:

- A validated Phase 1 result is always required before backup starts.
- Db-manager emits a stable machine-readable backup result.
- Child output is continuously drained and the success record cannot be lost to diagnostic truncation.
- Local fixtures run only through the code-only seam and cannot replace the production command through configuration.
- The backup includes and reports manifest version 1.
- Ops verifies the completed path, size, and SHA-256 before Phase 2 completes.
- Every failure stops the flow with a nonzero exit and no Phase 3 work.
- Reruns create new backups without deleting prior successful artifacts.
- Db-manager and ops tests, type checks, builds, and local harness checks pass.
- One development-server run creates and verifies the expected backup under `limited_user`.

Implementation requires a task-style todo after this plan is accepted under [Plan and Vet](../PLAN_AND_VET.md).
