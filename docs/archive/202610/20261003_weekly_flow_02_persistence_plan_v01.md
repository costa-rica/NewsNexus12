---
created_at: 2026-10-03T18:23:00Z
updated_at: 2026-10-03T18:23:00Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Persistence Plan V01

## Purpose

Add durable run progress before Phase 4. The design supports continuation, preserves important phase outputs, and rejects overlapping triggers without queueing them.

## Basis

- Requirements: [Weekly Combined Flow PRD V06](20261003_weekly_combined_flow_prd_v06.md).
- Phase contracts: [Weekly Flow 02 Phase Inputs and Outputs V01](20261003_weekly_flow_02_phase_inputs_outputs_v01.md).
- Existing direction: [Weekly Pipeline Ops Plan V01](20261001_weekly_pipeline_ops_plan_v01.md).

## Decisions

1. Add one table named `WeeklyArticleFlowRuns02`.
2. Keep stable recovery values in typed columns.
3. Keep evolving phase results in `phaseData` JSONB.
4. Do not add queue, lease, lock-version, or active-run columns.
5. Reject concurrent triggers immediately through one non-blocking PostgreSQL advisory lock.
6. Hold the advisory lock for the coordinator process lifetime. PostgreSQL releases it if the connection or process ends.
7. Do not retry or queue a rejected trigger.
8. Add a separate phase-attempt table only if future requirements become one-to-many.

## Proposed Columns

### Run identity and completion

- `id`: auto-incrementing integer primary key
- `runStartedAt`: non-null timestamp
- `runCompleted`: non-null boolean, default `false`
- `runCompletedAt`: nullable timestamp
- `createdAt`, `updatedAt`: Sequelize timestamps

### Phase progress

- `lastPhaseStarted`: nullable small integer from 1 through 7
- `lastPhaseCompleted`: nullable small integer from 1 through 7
- `phaseData`: non-null JSONB object, default `{}`
- `lastError`: nullable JSONB object

`phaseData` stores per-phase start and completion timestamps, validated outputs, and provisional details that may change while Phases 4–7 are designed.

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

1. Acquire the non-blocking advisory lock before selecting or creating a run.
2. Reject the trigger immediately when the lock is unavailable.
3. Create or select the run using the PRD decision table.
4. Persist phase start before invoking external work.
5. Persist only validated phase output before advancing.
6. Save failures in `lastError`; leave `runCompleted=false`.
7. Set `runCompleted=true` and `runCompletedAt` only at an accepted terminal outcome.
8. Release the advisory-lock connection when the coordinator exits.

## Database Integration

- Add the model, initializer, and export in `db-models`.
- Add an `ops` dependency on `@newsnexus/db-models` and initialize it after ops configuration loads.
- Use focused repository functions for latest-run lookup, creation, phase-start recording, verified completion, and failure recording.
- Keep coordinator control flow explicit; do not build a generic workflow framework.
- Include the new table in future db-manager backups by its V02 name.
- Never import the legacy `WeeklyArticleFlowRuns` CSV into this table.

## Schema Evolution

1. Start with the proposed typed columns and JSONB fields.
2. Use isolated test-database rows while implementing persistence.
3. Add nullable columns when later phase contracts require stable queryable values.
4. During early development, drop and recreate only `WeeklyArticleFlowRuns02` when necessary.
5. Do not drop, recreate, or replenish the entire database for routine table changes.
6. Once the table contains meaningful run history, use explicit additive migrations instead of dropping it.

## Verification

- Test model initialization and constraints against the isolated PostgreSQL test database.
- Test new-run, continuation, failure, and completion writes.
- Test that a second advisory-lock attempt is rejected immediately.
- Test that rejection creates no run row and starts no phase.
- Test that releasing or losing the lock permits a later manual trigger.
- Test backup and restore handling without legacy-table import.
- Verify the development schema and one controlled persisted run before Phase 4 work begins.

## Implementation Order

1. Model and schema tests
2. Persistence repository
3. Non-blocking advisory-lock guard
4. Coordinator persistence for Phases 1–3
5. Local failure and continuation harnesses
6. Development-server schema verification
7. Phase 4 planning
