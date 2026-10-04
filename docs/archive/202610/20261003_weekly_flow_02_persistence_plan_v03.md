---
created_at: 2026-10-03T18:59:36Z
updated_at: 2026-10-03T18:59:36Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Persistence Plan V03

## Purpose

Add durable run progress before Phase 4. The design supports continuation, preserves important phase outputs, and rejects overlapping triggers without queueing them.

V03 specifies the Linux `flock(1)` launcher, the schema rebuild order, and the test boundary. It supersedes [V02](20261003_weekly_flow_02_persistence_plan_v02.md).

## Basis

- Requirements: [Weekly Combined Flow PRD V07](20261003_weekly_combined_flow_prd_v07.md).
- Phase contracts: [Weekly Flow 02 Phase Inputs and Outputs V01](20261003_weekly_flow_02_phase_inputs_outputs_v01.md).
- Previous plan: [Weekly Flow 02 Persistence Plan V02](20261003_weekly_flow_02_persistence_plan_v02.md).
- Assessment: [Persistence Plan V02 Assessment](20261003_weekly_flow_02_persistence_plan_v02_assessment_claude.md).

## Decisions

1. Add one table named `WeeklyArticleFlowRuns02`.
2. Keep stable recovery values in typed columns.
3. Keep evolving phase results in `phaseData` JSONB.
4. Do not add queue, lease, lock-version, or active-run columns.
5. Reject overlapping server triggers with the Ubuntu `flock(1)` command in a small shell launcher.
6. Treat one Ubuntu host and one operational checkout as the execution boundary.
7. Do not infer activity from a database row, PID, or lock-file existence.
8. Do not retry or queue a rejected trigger.
9. Create the table through the established drop, create, and replenish workflow for every `db-models` schema change.
10. Load database code at the executable boundary and inject persistence functions into the coordinator.
11. Add a phase-attempt table only if a future one-to-many requirement warrants it.

## Linux Lock Launcher

1. Add one shell launcher under `ops/` for supported Ubuntu execution.
2. Use one stable lock file under an ignored runtime directory in the operational checkout.
3. Open the lock file and call `flock --nonblock` on its file descriptor.
4. If acquisition succeeds, use `exec` to replace the shell with the Node coordinator while retaining the locked descriptor.
5. If acquisition fails, print a timestamped explanation to stderr and exit with a documented conflict code.
6. The terminal displays a manual rejection. Journald records a systemd rejection.
7. Do not create a run row or initialize a phase after rejection.
8. The operating system releases the lock after normal exit, handled failure, crash, or shutdown.
9. A leftover lock file is harmless. Only the kernel-held lock means a coordinator is active.

No native Node addon or stale-lock timeout is required.

## Supported Invocation Paths

- `weekly-flow-02:start` calls the lock launcher and is the supported manual Ubuntu command.
- The systemd service calls the same lock launcher, directly or through the npm start script.
- Direct execution of `node dist/weekly-flow-02/index.js` is unsupported because it bypasses the guard.
- `weekly-flow-02:dev` remains a local code-development command on macOS. It is not an operational trigger and must not target the shared server database.
- Real lock behavior is verified on Ubuntu because macOS does not provide `flock(1)` by default.

The launcher records the coordinator PID after acquiring the lock for operator visibility. The PID does not determine whether the lock is active.

## Child-Process Boundary

- Scheduled and production runs use the systemd service.
- Keep systemd's control-group process handling so stopping the service terminates the coordinator and its child commands.
- Do not kill the coordinator process alone while db-manager or another phase child may still be running.
- During a manual development-server run, confirm that its child command has ended before starting another run after a forced termination.

This rule prevents an orphaned phase command from continuing after the coordinator lock has been released.

## Proposed Columns

### Run identity and completion

- `id`: auto-incrementing integer primary key
- `runStartedAt`: non-null timestamp used for run-age decisions
- `runCompleted`: non-null boolean, default `false`
- `runCompletedAt`: nullable timestamp
- `createdAt`, `updatedAt`: Sequelize timestamps

### Phase progress

- `lastPhaseStarted`: nullable small integer from 1 through 7
- `lastPhaseCompleted`: nullable small integer from 1 through 7
- `phaseData`: non-null JSONB object, default `{}`
- `lastError`: nullable JSONB object

`phaseData` stores per-phase start and completion timestamps, validated outputs, and provisional details that may change while Phases 4–7 are designed.

`lastError` stores the most recent recorded failure. Later continuation does not erase it. A later failure replaces it, while phase-specific details remain in `phaseData`.

### Backup result

- `backupPath`: nullable text
- `backupByteSize`: nullable bigint
- `backupSha256`: nullable 64-character string
- `backupManifestVersion`: nullable integer

### RSS recovery and shared count

- `firstRssRequestId`: nullable integer
- `firstRssArticleId`: nullable integer
- `rssArticlesAddedCount`: nullable non-negative integer
- `articleCount`: nullable non-negative integer

The first IDs are durable scalar markers. Do not add cascading foreign keys because the run record must survive later data cleanup.

### Worker job references

- `rssJobId`: nullable string
- `semanticScorerJobId`: nullable string
- `stateAssignerJobId`: nullable string
- `aiApproverV02JobId`: nullable string
- `targetArticleThresholdDaysOld`: nullable positive integer

## Write Boundaries

1. Acquire the host file lock before reading or writing run state.
2. Create or select the run using the PRD decision table.
3. Persist phase start before invoking external work.
4. Persist only validated phase output before advancing.
5. Save failures in `lastError`; leave `runCompleted=false`.
6. Set `runCompleted=true` and `runCompletedAt` only at an accepted terminal outcome.
7. Release the file lock by ending the guarded process.

Phase 3 is considered passed only when `lastPhaseCompleted >= 3`. A row with Phase 3 started and Phase 2 completed remains within the Phase 1–3 restart rule.

## Database Integration

- Add the model, initializer, and export in `db-models`.
- Add the `ops` dependency on `@newsnexus/db-models`.
- Keep model imports out of the coordinator and phase modules.
- Let the executable entry point load ops configuration before dynamically loading the persistence factory and `db-models`.
- Pass focused repository functions through the coordinator's existing dependencies object.
- Provide functions for latest-run lookup, creation, phase-start recording, verified completion, and failure recording.
- Keep coordinator control flow explicit; do not build a generic workflow framework.
- Include the new table in future db-manager backups by its V02 name.
- Never import the legacy `WeeklyArticleFlowRuns` CSV into this table.

## Schema Creation and Evolution

Use this order whenever the model is first added or changed:

1. Stop API and worker services that hold database connections.
2. Take the replenish backup with the current build, before exporting the changed model.
3. Pull the new code and build `db-models` before dependent packages.
4. Run the established drop, create, and replenish command with the bootstrap owner role.
5. Confirm that the rebuild restored application-role table and sequence grants.
6. Verify `WeeklyArticleFlowRuns02` and its constraints.
7. Restart the stopped services.
8. Run db-manager and API backup checks before Weekly Flow 02.

Repeat this workflow for model changes during early development. Never run backup code containing the new model export before the corresponding table exists.

No standalone table installer is required while an environment follows this rebuild workflow. If an environment later must retain its live database without a rebuild, add an idempotent migration or installer before deploying the model export.

## Testing Boundary

- Coordinator unit tests use fake in-memory persistence dependencies.
- Default ops tests do not load `db-models`, require PostgreSQL variables, or connect to a database.
- Entry-point tests mock the persistence factory and verify configuration loads before database code.
- Do not point automated tests at `newsnexus_dev` or `newsnexus_prod`.
- Test launcher decisions with command stubs where practical on macOS.
- Test the real `flock(1)` behavior only at the Ubuntu development-server checkpoint.
- Use the rebuilt development database only during an explicit operator-run server checkpoint.

## Verification

1. Run the default ops tests without PostgreSQL environment variables.
2. Test new-run, continuation, failure, and completion behavior with in-memory persistence fakes.
3. On Ubuntu, hold the launcher lock and verify that a second invocation exits immediately with the documented message and conflict code.
4. Verify that rejection creates no run row and starts no phase.
5. End and forcibly terminate guarded test processes, then verify a later invocation can acquire the lock.
6. Confirm the systemd unit and the npm start script use the same launcher and lock path.
7. Rebuild and replenish the development database in the documented order.
8. Verify the new table, constraints, and application-role access.
9. Run db-manager and API backup checks after schema creation.
10. Run one controlled persisted Weekly Flow 02 execution before Phase 4 implementation.

## Implementation Order

1. Model and exports
2. Development database backup, rebuild, and grant verification
3. Persistence repository
4. Entry-point database loading and dependency injection
5. Linux lock launcher and package scripts
6. Coordinator persistence for Phases 1–3
7. Local unit and failure harnesses
8. Ubuntu development-server lock, backup, and persisted-run checkpoint
9. Systemd service verification
10. Phase 4 planning and implementation
