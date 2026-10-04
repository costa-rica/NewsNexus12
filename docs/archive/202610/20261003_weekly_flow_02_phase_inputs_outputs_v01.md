---
created_at: 2026-10-03T17:12:04Z
updated_at: 2026-10-03T18:23:00Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Flow 02 Phase Inputs and Outputs

- Phases 1–3 are implemented; Phases 4–7 remain provisional.

## Phase 1: Clear Duplicate Analyses

### Inputs

- Worker URL and timeout

### Outputs

- Deleted-row count, cancelled/requested job IDs, timestamp

## Phase 2: Create Database Backup

### Inputs

- Db-manager environment and timeout

### Outputs

- Backup path, size, SHA-256, manifest version

## Phase 3: Delete Old Articles

### Inputs

- Db-manager environment, 180-day threshold, timeout

### Outputs

- Cutoff, threshold, eligible/processed/deleted counts

## Phase 4: Collect Google News RSS

### Inputs

- Run ID, RSS configuration, and queries

### Outputs

- First request/Article IDs, progress, outcome, added count, `articleCount`

## Phase 5: Run Semantic Scoring

### Inputs

- Unscored backlog and worker configuration

### Outputs

- Job ID, outcome, counts, and errors

## Phase 6: Assign Article States

### Inputs

- `articleCount` and reviewed age threshold

### Outputs

- Job ID, outcome, selected/completed/skipped/failed counts

## Phase 7: Run AI Approver V02

### Inputs

- `articleCount` and required selection settings

### Outputs

- Preview, job ID, result, completion decision

## Proposed `WeeklyArticleFlowRuns02` Columns

- Identity: `id`, `createdAt`, `updatedAt`, `runStartedAt`
- Completion: `runCompleted`, `runCompletedAt`
- Progress: `lastPhaseStarted`, `lastPhaseCompleted`, `phaseData` JSONB
- Backup: `backupPath`, `backupByteSize`, `backupSha256`, `backupManifestVersion`
- RSS: `firstRssRequestId`, `firstRssArticleId`, `rssArticlesAddedCount`, `articleCount`
- Jobs: `rssJobId`, `semanticScorerJobId`, `stateAssignerJobId`, `aiApproverV02JobId`
- Phase 6: `targetArticleThresholdDaysOld`
- Diagnostics: `lastError` JSONB

## Implementation Recommendation

One table is enough for the current fixed pipeline. Keep recovery-critical values as typed columns and provisional phase details in `phaseData` JSONB.

1. Plan and add the model before Phase 4.
2. Test persistence with isolated test-database rows.
3. Add nullable columns or migrations as requirements settle.
4. Avoid repeatedly dropping the whole database. During early development, drop only this new table when necessary, then recreate it through the approved schema process.
5. Add a separate phase-attempt table only if retries or history become one-to-many.
6. Reject overlapping triggers with a non-blocking guard outside this table; never queue runs.
