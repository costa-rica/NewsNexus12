---
created_at: 2026-10-02T22:33:54Z
updated_at: 2026-10-02T22:59:34Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Phase 2 Todo V01

## Basis and scope

- Accepted plan: [Weekly Flow 02 Phase 2 Plan V03](20261002_weekly_flow_02_phase_2_plan_v03.md).
- V02 assessment: [Assessment by Claude](20261002_weekly_flow_02_phase_2_plan_v02_assessment_claude.md).
- V01 assessment: [Assessment by Claude](20261002_weekly_flow_02_phase_2_plan_v01_assessment_claude.md).
- Product requirements: [Weekly Combined Flow PRD V05](20261001_weekly_combined_flow_prd_v05.md).
- Overall technical direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).
- Phase 1 implementation record: [Weekly Flow 02 Phase 1 Todo V02](20261002_weekly_flow_02_phase_1_todo_v02.md).
- Review process: [Plan and Vet](../PLAN_AND_VET.md).

Codex is the todo creator. Claude is the assessor unless the operator changes either role.

This todo adds the Phase 2 database backup, verifies its artifact, and connects it after Phase 1. It includes db-manager changes, ops changes, local harness verification, and one real development-server backup.

This increment does not add Phase 3 article deletion, run persistence, continuation, retries, systemd units, notifications, or production rollout.

## Working agreement

1. Complete the implementation phases in order.
2. Continue between internal phases after tests and commits pass. Do not stop for operator review between them.
3. Use one operator checkpoint immediately before the real development-server backup.
4. Keep control flow direct and names descriptive.
5. Preserve unrelated operator changes in the worktree.
6. Check off only completed work and record actual verification results.
7. Do not run a real database backup from automated tests or local fixtures.
8. Do not run the production weekly-flow entry point locally against db-manager.
9. Do not advance to Phase 3 unless Phase 2 has a verified result.
10. Confirm every expected compiled test file exists before running `node --test`.

## Existing planning files

These uncommitted documents are part of the accepted planning history:

- `20261002_weekly_flow_02_phase_2_plan_v01.md`
- `20261002_weekly_flow_02_phase_2_plan_v01_assessment_claude.md`
- `20261002_weekly_flow_02_phase_2_plan_v02.md`
- `20261002_weekly_flow_02_phase_2_plan_v02_assessment_claude.md`
- `20261002_weekly_flow_02_phase_2_plan_v03.md`
- This todo.

Preserve each version. Do not replace or rename earlier plan and assessment files.

## Implementation phase 0: Baseline and Phase 1 closeout

- [x] Review the planning files and confirm they contain no environment secrets or generated output.
- [x] Update the Phase 1 todo with the development-server evidence supplied by the operator.
- [x] Distinguish the directly supplied coordinator log from checks reported by the operator.
- [x] Record that the integrated run completed Phase 1 with `rowsDeleted=0`, empty cancellation collections, a worker timestamp, and the Phase 2 boundary.
- [x] Record the operator's confirmation that the command exit, server tests, typecheck, table preservation, zero-row result, unrelated-data check, timeout configuration, and failure visibility passed.
- [x] Do not invent unreported version numbers, row counts, paths, or command output.
- [x] Commit the accepted Phase 2 planning history, this todo, and the Phase 1 closeout before changing runtime code.
- [x] Continue directly to implementation phase 1 after the baseline commit.

### Phase 0 verification record

- Reviewed all Phase 2 planning files for secrets and generated output; none were present.
- Updated the Phase 1 todo with the supplied coordinator log and separately labeled operator-reported checks.
- Preserved unavailable server versions, counts, and transcripts as limitations instead of reconstructing values.
- The baseline contains documentation only and makes no runtime changes.

## Implementation phase 1: Db-manager artifact contract

- [x] Record the current db-manager test count before changing code.
- [x] Add `BACKUP_MANIFEST_VERSION = 1` to `db-manager/src/modules/backup.ts`.
- [x] Define typed backup-manifest and backup-result structures.
- [x] Change `createDatabaseBackupZipFile()` to return the typed result instead of only a path.
- [x] Resolve `PATH_DB_BACKUPS` with `path.resolve()` before constructing temporary or ZIP paths.
- [x] Preserve support for relative values by resolving them from the db-manager working directory.
- [x] Add one manifest entry for every model discovered by the existing model registry.
- [x] Record model name, CSV filename, row count, byte size, and SHA-256 for every nonempty model.
- [x] Record zero rows and null file metadata for empty models.
- [x] Write `manifest.json` before archiving the temporary directory.
- [x] Preserve the existing ZIP compression behavior.
- [x] After archive close, confirm the ZIP is a regular file with a positive size.
- [x] Calculate the completed archive SHA-256 without converting it to a text representation first.
- [x] Return the absolute path, byte size, archive SHA-256, and manifest version.
- [x] Remove the temporary directory and incomplete ZIP after every handled backup failure.
- [x] Preserve the completed ZIP after successful archive creation.
- [x] Add a pure formatter for the stable `database_backup_created` JSON line.
- [x] Update `db-manager/src/index.ts` to log the human-readable path and write the stable JSON line to stdout.
- [x] Emit the success line only after archive metadata calculation succeeds.
- [x] Keep the later database-status query and final exit behavior unchanged.
- [x] If the later status query fails, return exit status 1 and leave the completed ZIP in place.
- [x] Confirm the ZIP importer continues selecting CSV entries and ignoring `manifest.json`.

### Db-manager tests

- [x] Update existing backup tests for the typed result.
- [x] Test absolute and relative backup-root values.
- [x] Test positive archive size and matching archive SHA-256.
- [x] Test manifest version and ISO creation timestamp.
- [x] Test nonempty model row counts, CSV filenames, byte sizes, and hashes.
- [x] Test empty-model entries with null file metadata.
- [x] Test that every registered model has one manifest entry.
- [x] Test temporary-directory cleanup after success.
- [x] Test temporary-directory and incomplete-ZIP cleanup after handled failure.
- [x] Test the stable JSON formatter without depending on Winston output.
- [x] Update affected index-routing mocks or expectations for the typed result.
- [x] Do not add a real database dependency to the db-manager tests.

### Phase 1 verification and closeout

- [x] Run the focused db-manager backup and routing tests.
- [x] Run the complete db-manager test suite.
- [x] Build db-models before building db-manager.
- [x] Run the db-manager TypeScript build.
- [x] Inspect one test ZIP and confirm its manifest matches the generated CSV files.
- [x] Confirm no test ZIP, CSV, temporary directory, log, or `.env` is staged.
- [x] Record commands, Node and npm versions, executed test files, test count, and results below.
- [x] Commit only the db-manager contract changes, tests, and this todo update.
- [x] Continue directly to implementation phase 2.

### Phase 1 verification record

- Baseline: 214 tests passed across 13 db-manager suites before implementation.
- Environment: macOS, Node v24.11.0, npm 11.6.1.
- Focused backup and index-routing result: 24 tests passed across two suites.
- Complete db-manager result: 219 tests passed across 13 suites.
- `npm run build --workspace @newsnexus/db-models`: passed.
- `npm run build --workspace @newsnexus/db-manager`: passed.
- The focused test required approved access to the disposable local PostgreSQL test database after the sandbox blocked its first setup attempt.
- Tests opened the generated ZIP, compared manifest CSV metadata and hashes, verified empty entries, and removed temporary artifacts afterward.
- Git status contained only the four intended db-manager source and test files plus this todo update. No ZIP, CSV, log, `.env`, or generated build output was staged.

## Implementation phase 2: Ops configuration and command runner

### Configuration

- [x] Extend `OpsConfig` with `dbManagerBackupTimeoutSeconds`.
- [x] Parse required `DB_MANAGER_BACKUP_TIMEOUT_SECONDS` as a positive integer.
- [x] Add configuration tests for missing, zero, negative, fractional, and nonnumeric values.
- [x] Add `DB_MANAGER_BACKUP_TIMEOUT_SECONDS=1800` to `ops/.env.example`.
- [x] Document the setting as an overall child-process timeout in seconds.
- [x] Keep db-manager entry-path selection out of `OpsConfig` and `.env.example`.

### Result parsing and artifact verification

- [x] Define the Phase 2 result with `backupPath`, `byteSize`, `sha256`, and `manifestVersion`.
- [x] Keep parsed JSON typed as `unknown` until validation succeeds.
- [x] Require `event` to equal `database_backup_created`.
- [x] Require an absolute, nonempty backup path.
- [x] Require a positive safe-integer byte size.
- [x] Require a lowercase 64-character hexadecimal SHA-256.
- [x] Require reported manifest version 1.
- [x] Verify the path exists and is a regular file.
- [x] Verify the observed size matches the reported positive size.
- [x] Calculate the archive SHA-256 with a stream and compare it to the reported value.
- [x] Do not load the complete ZIP into memory.
- [x] Name the coordinator field `reportedManifestVersion` when logging it.

### Fixed production command and code-only seam

- [x] Add `02_createDatabaseBackup.ts` as the public Phase 2 function.
- [x] Add `02_createDatabaseBackupCommand.ts` for command construction and execution.
- [x] Define a small command specification or launcher interface used only through function arguments.
- [x] Build the production command with `process.execPath`.
- [x] Resolve the fixed compiled entry point at `db-manager/dist/index.js` from the monorepo layout.
- [x] Set the production working directory to `db-manager/`.
- [x] Pass `--create_backup` as an argument without invoking a shell.
- [x] Do not add an environment, CLI, or file-based command-path override.
- [x] Allow tests and temporary harnesses to pass a controlled command through the code-only seam.

### Environment isolation

- [x] Start with a copy of the parent environment.
- [x] Remove `NODE_ENV`, `NAME_APP`, and `NEXT_PUBLIC_MODE`.
- [x] Remove `PATH_TO_LOGS`, `LOG_MAX_SIZE`, and `LOG_MAX_FILES`.
- [x] Remove `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` and `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`.
- [x] Remove `DB_MANAGER_BACKUP_TIMEOUT_SECONDS` and `PATH_DB_BACKUPS`.
- [x] Remove every inherited key whose name begins with `PG_`.
- [x] Preserve ordinary values such as `PATH`, `HOME`, locale, temporary-directory settings, and Node runtime settings.
- [x] Never log the child environment or database credentials.
- [x] Confirm the production child loads its application settings from `db-manager/.env` through its working directory.

### Continuous output handling

- [x] Drain child stdout and stderr continuously until both streams end and the child closes.
- [x] Never pause, detach, or stop reading a stream when diagnostic retention reaches its cap.
- [x] Decode stdout chunks with Node's `StringDecoder` or equivalent split-character-safe behavior.
- [x] Retain an incomplete line fragment between chunks.
- [x] Process every complete stdout line as it arrives.
- [x] Process the final unterminated fragment when stdout ends.
- [x] Store valid success candidates and their count separately from retained diagnostics.
- [x] Require exactly one valid success candidate.
- [x] Set the maximum incomplete-line size to 64 KiB.
- [x] Mark an oversized line as an output-contract failure while continuing to drain the process.
- [x] Keep only the last 32 KiB from stdout and the last 32 KiB from stderr for diagnostics.
- [x] Apply the caps only to diagnostic tails, never to success-candidate storage or stream consumption.

### Process completion and timeout

- [x] Require a normal child exit with code 0 after both output streams are drained.
- [x] Reject signal exits and every nonzero exit, even if a success candidate appeared earlier.
- [x] Apply the configured timeout at the child-process boundary.
- [x] On timeout, send the normal termination signal and begin a five-second grace period.
- [x] Force termination if the child remains open after the grace period.
- [x] Continue draining both streams until process close.
- [x] Treat timeout as an unverified result and do not delete possible artifacts.
- [x] Categorize spawn, timeout, exit, output-contract, and artifact-verification failures.
- [x] Preserve original errors as causes when wrapping them.
- [x] Include only concise, bounded, safe diagnostics in errors.

### Ops tests

- [x] Add `ops/tests/weekly-flow-02/02_createDatabaseBackup.test.ts` before changing the test script.
- [x] Parse one valid result among unrelated stdout lines.
- [x] Parse a result line split across multiple chunks and UTF-8 boundaries.
- [x] Preserve a result surrounded by output larger than both diagnostic caps.
- [x] Confirm a child writing past the cap exits without blocking.
- [x] Reject missing, duplicate, oversized, malformed, and incorrectly typed results.
- [x] Test the fixed executable, arguments, and working directory.
- [x] Test the code-only fixture seam without adding configuration.
- [x] Set sentinel values for every named removed key and representative `PG_*` keys.
- [x] Confirm removed sentinels do not reach the production child.
- [x] Confirm ordinary operating-system sentinels remain present.
- [x] Cover spawn failure, nonzero exit after a candidate, signal exit, timeout, and forced termination.
- [x] Cover missing file, directory path, empty file, size mismatch, and checksum mismatch.
- [x] Confirm failure text is bounded and excludes environment values.
- [x] Append `dist-test/tests/weekly-flow-02/02_createDatabaseBackup.test.js` to the explicit test script only after the source exists.

### Phase 2 verification and closeout

- [x] Confirm all three expected compiled ops test files exist before running `node --test`.
- [x] Run the complete ops test command and record every executed file and the total count.
- [x] Run ops type checking and the clean production build.
- [x] Confirm `dist-test/` remains ignored and production output contains no tests or stale modules.
- [x] Confirm no command-path configuration was added.
- [x] Confirm no `.env`, artifact, fixture, temporary directory, or log is staged.
- [x] Record commands, versions, test count, and results below.
- [x] Commit only the ops configuration, command module, tests, documentation, and this todo update.
- [x] Continue directly to implementation phase 3.

### Phase 2 verification record

- Environment: macOS on nicksmacbookair, Node v24.11.0, npm 11.6.1.
- The explicit ops test command ran config, Phase 1, and Phase 2 compiled test files. All 41 tests passed before coordinator integration.
- Ops type checking and the clean production build passed.
- Production output contained no test files or stale modules. `dist-test/` and `dist/` remained ignored.
- The fixed command path stayed in code. No command-path configuration, environment file, artifact, fixture, temporary directory, or log was staged.

## Implementation phase 3: Coordinator integration and local harnesses

### Coordinator integration

- [x] Replace the Phase 2 scaffold boundary with a Phase 2 start log.
- [x] Run Phase 2 only after Phase 1 returns its validated result.
- [x] Await the verified backup result.
- [x] Log Phase 2 completion with path, byte size, SHA-256, and `reportedManifestVersion`.
- [x] Replace the stop message with the boundary before unimplemented Phase 3.
- [x] Add a small coordinator dependencies object with production defaults.
- [x] Preserve the default `globalThis.fetch` request for Phase 1.
- [x] Preserve the fixed db-manager command as the Phase 2 production default.
- [x] Keep command overrides available only through code arguments used by tests and harnesses.
- [x] Allow every Phase 2 error to reach the top-level handler and produce a nonzero exit.
- [x] Confirm Phase 2 failure never logs completion or the Phase 3 boundary.
- [x] Confirm Phase 1 failure still prevents Phase 2 start.
- [x] Keep reruns starting again at Phase 1 without retry or durable state.

### Coordinator tests

- [x] Update existing coordinator tests for the dependencies object.
- [x] Confirm the call order is Phase 1, then Phase 2, then the Phase 3 boundary.
- [x] Confirm Phase 2 receives the configured timeout and fixed production command by default.
- [x] Confirm completion logs contain verified backup metadata.
- [x] Test every Phase 2 failure category and confirm no later work is logged.
- [x] Preserve every existing Phase 1 success and failure assertion.

### Operator documentation

- [x] Update `ops/README.md` with the Phase 2 call sequence and 1800-second timeout.
- [x] Document the fixed compiled db-manager entry point and build-order prerequisite.
- [x] Document that db-manager uses its own `.env`, logging identity, database target, and backup path.
- [x] Document the stable result metadata and coordinator log fields.
- [x] Document failure, timeout, retained-artifact, and rerun behavior.
- [x] State that routine execution verifies external metadata but does not independently read the manifest.
- [x] State that the backup is not one transactionally consistent cross-table snapshot.
- [x] Warn that the normal weekly-flow entry point performs a real database backup.

### Local source and compiled harnesses

- [x] Create the fixture command and harnesses outside the tracked tree.
- [x] Make the fixture write a controlled ZIP-like artifact and stable result line without accessing PostgreSQL.
- [x] Make the source harness import source modules and pass the fixture command through the code-only seam.
- [x] Make the compiled harness import built modules and pass the same fixture command.
- [x] Construct every config value explicitly; do not load either package's `.env`.
- [x] Inject a successful Phase 1 request if exercising the full coordinator.
- [x] Exercise successful, nonzero-exit, malformed-output, oversized-output, checksum-mismatch, and delayed modes.
- [x] Confirm successful source and compiled runs log both phase completions and the Phase 3 boundary.
- [x] Confirm every failure run exits unsuccessfully without Phase 2 completion or the Phase 3 boundary.
- [x] Confirm output beyond the diagnostic cap does not block or hide the success result.
- [x] Do not replace or edit `db-manager/dist/index.js` for fixture testing.
- [x] Do not run `weekly-flow-02:dev` or `weekly-flow-02:start` against local package configuration.
- [x] Remove all temporary harnesses, fixtures, artifacts, and logs.

### Phase 3 verification and closeout

- [x] Run the complete db-manager suite and build after integration.
- [x] Run the complete ops suite, typecheck, and clean build after integration.
- [x] Confirm all expected compiled test paths exist and record the test count.
- [x] Confirm generated output remains ignored and no temporary runtime files remain.
- [x] Inspect the scoped diff for secrets, backup files, logs, and unrelated changes.
- [x] Record commands, versions, test counts, harness behavior, and results below.
- [x] Commit only coordinator integration, tests, documentation, fixes, and this todo update.
- [x] Stop at the single operator checkpoint before implementation phase 4.

### Phase 3 verification record

- Environment: macOS on nicksmacbookair, Node v24.11.0, npm 11.6.1.
- The complete db-manager suite passed: 219 tests across 13 suites.
- The final explicit ops test command ran config, Phase 1, and Phase 2 compiled test files. All 42 tests across eight suites passed.
- Db-models, db-manager, and ops production builds passed. Ops type checking passed.
- Source and compiled harnesses used explicit configuration, an injected successful Phase 1 response, and a temporary Phase 2 command outside the repository.
- Success mode produced output beyond the diagnostic caps, completed both phases, logged verified metadata, and reached the Phase 3 boundary.
- Nonzero-exit, malformed-output, oversized-output, checksum-mismatch, and delayed timeout modes exited unsuccessfully without Phase 2 completion or the Phase 3 boundary in both harnesses.
- The source harness required approved execution because tsx creates a temporary IPC socket blocked by the sandbox.
- All temporary harnesses, fixtures, artifacts, and logs were removed. Generated build and test output remained ignored.

## Operator checkpoint: Development backup readiness

- [x] Present the completed local implementation, tests, builds, and harness evidence.
- [x] Present the exact branch and commit intended for `nws-nn12dev`.
- [x] Ask the operator to confirm the development database and backup destination before the real backup.
- [x] Do not contact the development worker or run db-manager against its database until this checkpoint is approved.

## Implementation phase 4: Development-server verification

### Server preflight

- [ ] Confirm `nws-nn12dev` has the approved branch and commit.
- [ ] Record server Node and npm versions.
- [x] Confirm the command runs as `limited_user` from the intended repository path.
- [x] Confirm worker-python targets the intended development database.
- [x] Confirm db-manager targets the same intended development database.
- [x] Confirm `PATH_DB_BACKUPS` is the intended directory without displaying credentials.
- [x] Confirm `limited_user` can read db-manager configuration and write the backup directory.
- [ ] Record available disk space before the backup.
- [ ] Confirm `DB_MANAGER_BACKUP_TIMEOUT_SECONDS=1800` in ops configuration.

### Server build and tests

- [x] Build db-models, then db-manager, then ops.
- [ ] Run the complete db-manager test suite and record its test count.
- [ ] Run the complete ops test suite and record its files and test count.
- [ ] Run ops type checking.
- [ ] Confirm generated tests remain ignored and production builds contain no tests or stale modules.

### Real development backup

- [ ] Record the backup directory contents before the run.
- [x] Run the real compiled weekly-flow entry point as `limited_user`.
- [ ] Use `/usr/bin/time -v` when available and record its combined peak resident memory.
- [x] Record the process exit status.
- [x] Confirm Phase 1 completes before Phase 2 starts.
- [ ] Confirm exactly one new ZIP is created for the run.
- [x] Confirm the coordinator logs path, positive byte size, SHA-256, and `reportedManifestVersion=1`.
- [x] Confirm the ZIP path, size, and SHA-256 match independent server commands.
- [x] Confirm the ZIP owner and permissions are appropriate for operations and recovery.
- [ ] Confirm the db-manager and coordinator logs agree on the backup location.
- [x] Confirm the process exits successfully at the Phase 3 boundary.
- [x] Inspect `manifest.json` without restoring the ZIP.
- [x] Confirm manifest version 1.
- [x] Confirm the `ArticleDuplicateAnalysis` entry reports zero rows and null file metadata when no new analysis rows appeared.
- [x] Record the sequential-read, non-snapshot limitation.
- [x] Do not restore the ZIP into the active development database.

### Phase 4 verification and closeout

- [x] Record commands, versions, commit, database target description, backup path, size, SHA-256, manifest result, exit status, memory result, and limitations below.
- [x] Distinguish operator-reported evidence from commands observed directly by the implementing agent.
- [x] Record unavailable measurements as limitations rather than successes.
- [x] Run final local tests, typechecks, and builds only if server validation causes code changes.
- [x] Confirm the final diff contains no secrets, `.env`, ZIP, CSV, log, generated output, or temporary files.
- [x] Commit only server-verification documentation or fixes and this todo update.
- [x] Do not push additional changes unless the operator requests it.

### Phase 4 verification record

- All evidence in this record was supplied by the operator from `nws-nn12dev`; Codex did not execute commands on the server.
- Intended code: branch `dev_35_weekly_combined_flow_02`, commit `ef86217`.
- The operator ran the compiled flow from `/home/limited_user/applications/NewsNexus12` as `limited_user` against the intended development database and configured backup destination.
- The first run created a backup but failed the coordinator output contract because only ops had been rebuilt and the db-manager compiled output was stale.
- After rebuilding db-models, db-manager, and ops in order, the operator reported no terminal error. The coordinator log showed Phase 1, Phase 2, and the Phase 3 boundary in order.
- Phase 1 completed with zero deleted rows, empty cancellation collections, and worker timestamp `2026-10-02T22:55:04.845650+00:00`.
- Verified backup: `/home/limited_user/project_resources/NewsNexus12/db_backups/db_backup_202610022255062.zip`.
- The coordinator reported 221180992 bytes, SHA-256 `02f38ed4334eb25acd25d47f79c7dea230b1b858111d2bca48f0d744dd14888c`, and manifest version 1.
- Independent `stat` and `sha256sum` output matched the coordinator metadata exactly. Ownership was `limited_user:limited_user` with mode `660`.
- The server did not have the `unzip` command. The operator used the installed `adm-zip` dependency to read `manifest.json` without restoring the archive.
- The manifest reported version 1. Its `ArticleDuplicateAnalysis` entry had zero rows and null CSV filename, byte size, and SHA-256.
- The terminal showed no error on the successful rerun, and the coordinator stopped at the unimplemented Phase 3 boundary.
- The archive remains a sequential table read rather than one transactionally consistent cross-table snapshot.
- Server Node and npm versions, available disk space, peak resident memory, server test counts, exact server commit output, timeout-setting output, pre-run directory listing, and db-manager log comparison were not supplied.
- Because no pre-run directory listing was supplied, creation of exactly one new ZIP during the successful run was not independently confirmed.
- No code changed after server validation, so local tests and builds were not repeated.

## Shared phase closeout

At the end of every implementation phase:

1. Run the tests, type checks, builds, and focused runtime checks applicable to that phase.
2. Fix failures without weakening required behavior or deleting meaningful tests.
3. Check `git status` and inspect the scoped diff before staging anything.
4. Confirm no `.env`, credential, generated output, backup artifact, temporary fixture, or unrelated operator change is staged.
5. Confirm every expected compiled test path exists before relying on the test result.
6. Record the executed test files and count, comparing them with the prior phase when applicable.
7. Update this todo's completed checkboxes, verification record, `updated_at`, and `modified_by`.
8. Commit only the completed phase using the repository commit-message guidance.
9. Continue to the next internal phase without an operator pause unless the development-backup checkpoint has been reached.
10. Do not push unless the operator separately requests it.
