---
created_at: 2026-10-03T18:53:49Z
updated_at: 2026-10-03T18:53:49Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Persistence Plan V02

## Purpose

Add durable run progress before Phase 4. The design supports continuation, preserves important phase outputs, and rejects overlapping triggers without queueing them.

V02 replaces the PostgreSQL advisory lock with a same-host operating-system file lock. It also defines the development schema workflow and keeps database imports out of coordinator unit tests.

## Basis

- Requirements: [Weekly Combined Flow PRD V07](20261003_weekly_combined_flow_prd_v07.md).
- Phase contracts: [Weekly Flow 02 Phase Inputs and Outputs V01](20261003_weekly_flow_02_phase_inputs_outputs_v01.md).
- Previous plan: [Weekly Flow 02 Persistence Plan V01](20261003_weekly_flow_02_persistence_plan_v01.md).
- Assessment: [Persistence Plan V01 Assessment](20261003_weekly_flow_02_persistence_plan_v01_assessment_claude.md).

## Decisions

1. Add one table named `WeeklyArticleFlowRuns02`.
2. Keep stable recovery values in typed columns.
3. Keep evolving phase results in `phaseData` JSONB.
4. Do not add queue, lease, lock-version, or active-run columns.
5. Reject overlapping triggers with one non-blocking `flock` held for the coordinator process lifetime.
6. Treat the Ubuntu host as the single execution location. Cross-host coordination is outside the current requirement.
7. Do not infer activity from a database row, PID, or lock-file existence.
8. Do not retry or queue a rejected trigger.
9. Create the table through the established drop, create, and replenish workflow for every `db-models` schema change.
10. Load database code at the executable boundary and inject persistence functions into the coordinator.
11. Add a phase-attempt table only if a future one-to-many requirement warrants it.

## Single-Execution Guard

1. Use one stable lock path shared by manual and systemd invocations on the same host.
2. Acquire `flock` atomically and without waiting before selecting or creating a run.
3. Keep the lock file descriptor open for the coordinator's full lifetime.
4. If the lock is held, log the rejection and exit without creating a run row or starting a phase.
5. Log the acquired coordinator PID for operator visibility. The PID does not determine lock ownership.
6. Rely on the operating system to release the lock after normal exit, handled failure, crash, or shutdown.
7. Treat an inability to acquire or evaluate the lock as a rejected trigger. Never run unguarded.

The lock file may remain on disk after execution. Its existence is harmless; only the kernel-held lock means a coordinator is active.

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

1. Add the proposed table to `db-models`.
2. Build `db-models` before dependent packages.
3. Before running code that exports the new model, use the established drop, create, and replenish workflow in that environment.
4. Run schema work with the bootstrap owner role and restore application-role grants through the existing db-manager workflow.
5. Run ops with the application role after the rebuilt schema is ready.
6. Verify the table and grants before running Weekly Flow 02 or either backup path.
7. Repeat the rebuild workflow when the model changes during early development.

No standalone table installer is required for this development increment. If an environment later must preserve its existing database during deployment, add an idempotent migration or installer before deploying the model export.

## Testing Boundary

- Coordinator unit tests use fake in-memory persistence dependencies.
- Default ops tests do not load `db-models`, require PostgreSQL variables, or connect to a database.
- Entry-point tests mock the persistence factory and verify configuration loads before database code.
- Do not point automated tests at `newsnexus_dev` or `newsnexus_prod`.
- Use the rebuilt development database only during an explicit operator-run server checkpoint.

## Verification

1. Run the default ops tests without PostgreSQL environment variables.
2. Test new-run, continuation, failure, and completion behavior with in-memory persistence fakes.
3. Test that a held file lock rejects a second invocation immediately and starts no phase.
4. Test that ending or killing the guarded process permits a later invocation.
5. Verify real `flock` behavior on the Ubuntu development server.
6. Rebuild and replenish the development database before deploying the new model export.
7. Verify the new table and application-role access.
8. Run db-manager backup and API backup checks after schema creation.
9. Run one controlled persisted Weekly Flow 02 execution before Phase 4 implementation.

## Implementation Order

1. Model and exports
2. Development database rebuild and grant verification
3. Persistence repository
4. Entry-point database loading and dependency injection
5. Non-blocking host file-lock guard
6. Coordinator persistence for Phases 1–3
7. Local unit and failure harnesses
8. Ubuntu development-server lock, backup, and persisted-run checkpoint
9. Phase 4 planning and implementation
