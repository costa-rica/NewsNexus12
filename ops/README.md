---
created_at: 2026-10-01T23:56:40Z
updated_at: 2026-10-04T19:56:05Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# NewsNexus12 Operations

This workspace holds operational processes for NewsNexus12. Weekly-flow-02 records durable progress, clears duplicate analyses, creates and verifies a database backup, deletes old unprotected articles, and stops before Phase 4.

---

## Project Overview

- Available now: a guarded coordinator, durable run selection, console/file logging, and the first three weekly-flow-02 phases.
- Phase 1 calls `DELETE /deduper/clear-db-table` and continues only after validating the success response.
- Phase 2 starts only after Phase 1 succeeds. It runs the fixed compiled entry point at `db-manager/dist/index.js --create_backup` with Node and verifies the reported ZIP size and SHA-256.
- Phase 3 starts only after Phase 2 succeeds. It runs the fixed compiled entry point at `db-manager/dist/index.js --delete_articles` with Node.
- `WeeklyArticleFlowRuns02` stores run identity, phase progress, validated outputs, and errors. It does not determine whether a process is active.
- Ubuntu execution uses a non-blocking kernel file lock. A second trigger exits immediately instead of queueing.
- Pending: later phases and scheduled execution.

Stack: Node.js, TypeScript, dotenv, Winston, npm workspaces.

---

## Setup

Prerequisites:

- Node.js 20 or newer and npm, following the repository's declared runtime requirement.
- Run commands from the NewsNexus12 repository root.
- No Python virtual environment, database, or running worker is needed for the automated tests.

1. Install dependencies if this checkout has not already been installed:

```bash
npm install
```

2. Build db-models and db-manager before building ops. The compiled weekly flow requires the db-manager compiled entry point.

```bash
npm run build --workspace @newsnexus/db-models
npm run build --workspace @newsnexus/db-manager
npm run build --workspace newsnexus12-ops
```

3. Run ops tests and type checking:

```bash
npm test --workspace newsnexus12-ops
npm run typecheck --workspace newsnexus12-ops
```

- Local configuration: copy the example without replacing an existing file before using the normal run commands.

```bash
if [ ! -e ops/.env ]; then
  cp ops/.env.example ops/.env
fi
```

Required worker settings:

- `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`: worker-python base URL using HTTP or HTTPS.
- `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS`: positive integer overall request timeout in seconds.

The example timeout is 90 seconds. Keep it longer than worker-python's `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS`, which defaults to 30 seconds, plus expected database deletion and response time.

Phase 1 uses these values for its DELETE request. The request has no body or query parameters.

Required backup setting:

- `DB_MANAGER_BACKUP_TIMEOUT_SECONDS`: positive integer overall child-process timeout in seconds.

The example is 1800 seconds. Db-manager loads its own `db-manager/.env` because the child runs from the db-manager directory. Its database target, backup path, and logging identity remain separate from ops configuration.

Required deletion setting:

- `DB_MANAGER_DELETE_ARTICLES_TIMEOUT_SECONDS`: positive integer overall timeout for the Phase 3 child process.

The example is 1800 seconds. Phase 3 uses db-manager's bare `--delete_articles` command, which keeps the db-manager default threshold of 180 days.

Required persistence settings:

- `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_PASSWORD`, and `PG_SCHEMA`: PostgreSQL connection details used by ops persistence.
- `PG_USER`: the application role. Use `newsnexus_app` on the NewsNexus12 servers.

Do not copy the db-manager bootstrap-owner credentials into `ops/.env`. Db-manager needs the owner role for schema rebuilds, while the standing ops process needs only application-role table and sequence access.

Ops loads these values before dynamically loading `db-models`. Phase 2 and Phase 3 child commands remove every inherited `PG_*` value and continue loading their separate db-manager configuration.

When `WeeklyArticleFlowRun02` changes, take the replenish backup with the old model build. Then build the new model, drop, create, and replenish with the bootstrap owner role. Verify the new table and application-role grants before starting ops or either backup path.

---

## Usage

Run from the repository root after setup. The supported Ubuntu command acquires `ops/.runtime/weekly-flow-02.lock` before starting Node:

These normal entry points perform real deletion against the database configured in `worker-python/.env` and `db-manager/.env`. Use them only when clearing duplicate analyses, creating a full backup, and deleting eligible old articles are intended.

```bash
# Run guarded compiled JavaScript; rebuild after source changes.
npm run build --workspace newsnexus12-ops
npm run weekly-flow-02:start --workspace newsnexus12-ops

# If your terminal is already inside ops/, use:
# npm run build && npm run weekly-flow-02:start
```

The macOS development command is unguarded and is only for isolated local development. It must not target a shared server database:

```bash
npm run weekly-flow-02:dev --workspace newsnexus12-ops
```

Directly running `node ops/dist/weekly-flow-02/index.js` bypasses the lock and is unsupported for operational use.

### Run selection controls

- No arguments: inspect only the latest run and apply the 72-hour recovery rule.
- `--new-run`: create a new run even when the latest run is eligible for continuation.
- `--continue-run`: continue the latest eligible incomplete run.
- `--continue-run ID`: continue that exact eligible incomplete run.

Pass options through npm after `--`:

```bash
npm run weekly-flow-02:start --workspace newsnexus12-ops -- --new-run
npm run weekly-flow-02:start --workspace newsnexus12-ops -- --continue-run
npm run weekly-flow-02:start --workspace newsnexus12-ops -- --continue-run 5
```

Runs stopped during Phases 1–3 are replaced by a new run. A run that completed Phase 3 can continue for 72 hours from `runStartedAt`; exactly 72 hours remains eligible. Explicit continuation cannot resume a run stopped during Phases 1–3.

Phase 4 is not implemented. Every current run remains incomplete after Phase 3. A repeat within 72 hours reaches the Phase 4 boundary without rerunning Phases 1–3 and exits 0. A default trigger after 72 hours creates a new run and repeats the destructive phases.

### Single-execution behavior

- The launcher keeps the kernel lock for the coordinator process lifetime.
- A second trigger prints an explanation and exits 75 without creating a run row or starting a phase.
- Missing `flock` or another guard failure uses a different nonzero exit and never starts unguarded.
- A leftover lock file does not indicate activity. Only the kernel-held lock does.
- A future systemd service must use `SuccessExitStatus=75` and process-group termination.
- After forcibly terminating a manual run, confirm its db-manager child has ended before triggering another run.

- Expected sequence: startup header, Phase 1 completion, Phase 2 completion, Phase 3 completion, and a message that execution stopped before unimplemented Phase 4.
- The named commands run only weekly-flow-02; future processes can have separate commands in this workspace.
- Each command runs once and exits. The persisted run decision determines whether it starts at Phase 1 or continues at the Phase 4 boundary.
- The example configuration logs to the console in development. Testing writes to console and file; production writes to file only.
- File logs use the configured directory and application name. Relative log directories resolve from the ops workspace.
- A successful Phase 1 log includes `rowsDeleted`, `cancelledJobs`, `cancellationRequestedJobs`, and the worker timestamp.
- A Phase 1 request rejection, invalid response, connection failure, or timeout stops the flow before Phase 2.
- A Phase 2 spawn, timeout, exit, output-contract, or artifact-verification failure stops the flow before the Phase 3 boundary.
- Phase 2 completion logs the absolute backup path, byte size, SHA-256, and `reportedManifestVersion`.
- The db-manager success result reports the same metadata. Ops independently verifies the external ZIP size and SHA-256 but does not read `manifest.json` during routine execution.
- A timeout leaves the backup outcome unverified. A possible artifact is retained for investigation; the coordinator does not delete it.
- Phase 3 excludes Articles referenced by the approved and relevant tables using a protection snapshot taken before deletion.
- Phase 3 reports `eligibleCount` from its initial count, `processedCount` for IDs submitted to deletion, and `deletedCount` from the database deletion results.
- An all-zero Phase 3 result is a successful completion. Concurrent changes can also produce `deletedCount <= processedCount <= eligibleCount`.
- The protection snapshot can become stale while Phase 3 runs. Concurrent approval or relevance changes are not a transactionally consistent guard for the whole pass.
- A Phase 3 timeout, process exit, or signal can occur after partial deletion. The outcome is unverified, and the coordinator does not retry or restore automatically.
- The verified Phase 2 ZIP is the recovery artifact for investigating a Phase 3 failure.
- The backup reads tables sequentially. An Article inserted after its table is exported but before Phase 3 can be deleted without appearing in that backup.
- A replacement run begins again at Phase 1 and creates another full backup before retrying Phase 3. There is no automatic retry.
- A manual operator sees failure in terminal output, the nonzero process exit status, and the configured coordinator log.
- Persistence failures keep a concise terminal message and write the complete nested Sequelize/PostgreSQL diagnostic to the protected coordinator log, including stack, SQL, parameters, and database metadata when supplied by the driver.
- If any nested database error references the `Users` table through table metadata or SQL, the coordinator suppresses the entire database diagnostic. The log records that `Users` details were suppressed.
- A Phase 1 timeout leaves the worker outcome unverified. Check worker and database state before rerunning.

### Safe verification

Use the automated tests for local verification. Their injected request, backup artifact, and deletion command do not contact worker-python, PostgreSQL, or package `.env` files.

```bash
npm test --workspace newsnexus12-ops
```

- Do not use the development or compiled entry point as a smoke test unless clearing the configured database and creating a real backup are intended.
- Runtime fixture checks must supply every configuration value explicitly and inject controlled Phase 1, Phase 2, and Phase 3 dependencies. They must not fall back to package `.env` files.
- Default tests inject persistence and never connect to PostgreSQL.
- Future systemd execution must expose guard rejection, actual failure, journal, and application-log behavior before unattended rollout.
- This increment does not add systemd units or notification behavior.

Rebuild after source changes before running the compiled entry point.

---

## Project Structure

```text
ops/
├── .env.example     # Local configuration template
├── .runtime/        # Ignored host-lock files created at runtime
├── package.json     # Workspace test, build, and type-check commands
├── scripts/
│   └── runWeeklyFlow02.sh # Ubuntu flock launcher
├── tsconfig.test.json # Isolated test build settings
├── tsconfig.json    # TypeScript build settings
├── README.md        # Operator setup and safe verification
├── tests/
│   ├── config.test.ts # Pure configuration tests
│   └── weekly-flow-02/
│       ├── 01_clearDuplicateAnalyses.test.ts # Request and coordinator tests
│       ├── 02_createDatabaseBackup.test.ts # Process and artifact tests
│       ├── 03_deleteOldArticles.test.ts # Deletion command and result tests
│       ├── entrypoint.test.ts # Configuration-before-database loading tests
│       ├── launcher.test.ts # Portable launcher branch tests
│       ├── persistence.test.ts # Mocked Sequelize adapter tests
│       └── runSelection.test.ts # CLI and recovery decision tests
└── src/
    ├── config.ts    # Shared configuration loading
    ├── logger.ts    # Shared console/file logging
    └── weekly-flow-02/
        ├── index.ts       # Weekly flow executable entry
        ├── entrypoint.ts  # Configuration and persistence lifecycle
        ├── cli.ts         # Explicit run-selection arguments
        ├── coordinator.ts # Selects a run and executes Phases 1–3
        ├── dbManagerCommandRunner.ts # Shared child-process runner
        ├── persistence.ts # Database-free persistence contracts
        ├── runSelection.ts # Pure recovery decision table
        ├── sequelizePersistence.ts # Dynamically loaded database adapter
        └── phases/
            ├── 01_clearDuplicateAnalyses.ts # Phase 1 entry
            ├── 01_clearDuplicateAnalysesRequest.ts # Worker request and validation
            ├── 02_createDatabaseBackup.ts # Phase 2 entry
            ├── 02_createDatabaseBackupCommand.ts # Backup result and artifact verification
            ├── 03_deleteOldArticles.ts # Phase 3 entry
            └── 03_deleteOldArticlesCommand.ts # Deletion command and result validation
```

---

## References

- [Weekly pipeline requirements](../docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v09.md)
- [Persistence plan](../docs/weekly-article-pipeline-v02/20261003_weekly_flow_02_persistence_plan_v03.md)
- [Persistence implementation todo](../docs/weekly-article-pipeline-v02/20261003_weekly_flow_02_persistence_todo_v02.md)
- [Ops implementation plan](../docs/weekly-article-pipeline-v02/20261001_weekly_pipeline_ops_plan_v01.md)
- [Phase 1 plan](../docs/weekly-article-pipeline-v02/20261002_weekly_flow_02_phase_1_plan_v04.md)
- [Phase 1 implementation todo](../docs/weekly-article-pipeline-v02/20261002_weekly_flow_02_phase_1_todo_v02.md)
- [Phase 2 plan](../docs/weekly-article-pipeline-v02/20261002_weekly_flow_02_phase_2_plan_v03.md)
- [Phase 2 implementation todo](../docs/weekly-article-pipeline-v02/20261002_weekly_flow_02_phase_2_todo_v01.md)
- [Phase 3 plan](../docs/weekly-article-pipeline-v02/20261002_weekly_flow_02_phase_3_plan_v02.md)
- [Phase 3 implementation todo](../docs/weekly-article-pipeline-v02/20261002_weekly_flow_02_phase_3_todo_v01.md)
- [Archived coordinator scaffold checklist](../docs/archive/202610/20261001_ops_coordinator_scaffold_todo_v01.md)
