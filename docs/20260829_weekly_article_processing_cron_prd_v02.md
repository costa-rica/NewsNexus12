---
created_at: 2026-08-30T01:17:22Z
updated_at: 2026-08-30T01:26:05Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: hermes (gpt-5.6-sol) nws-nn12dev
---

# Weekly Article Processing Cron PRD V02

## Implementation Status

- Status: active product and technical requirements
- Supersedes: `docs/20260829_weekly_article_processing_cron_prd_v01.md`
- AI Approver version: V02 only
- Legacy orchestrator: removed and not restored by this PRD
- Development approach: plan and review on macOS; implement and validate on an Ubuntu dev server
- Development scheduling: manual execution only; no enabled cron job or systemd timer
- Production scheduling: one systemd timer after dev-server acceptance and production rollout approval

V02 preserves the operator decisions recorded in V01 while replacing its removed orchestrator dependencies. The new flow is a self-contained operational subsystem in the NewsNexus12 repository.

## 1. Summary

NewsNexus12 needs one completion-driven weekly production flow:

1. Run preflight checks.
2. Clear all rows from `ArticleDuplicateAnalyses` while preserving the table and schema.
3. Create and verify a db-manager database backup.
4. Delete old articles with the db-manager default `--delete_articles` flow.
5. Run worker-node Google News RSS collection.
6. Run worker-node semantic scoring.
7. Run worker-node AI state assignment.
8. Run worker-python AI Approver V02.
9. Reconcile results, write JSONL, and publish any operator alert.

The Ubuntu dev server must support manual execution of the RSS and analysis stages without installing or enabling a schedule. The production server later runs the same source-controlled coordinator through systemd.

## 2. Operator Decisions Incorporated

1. The production schedule is Friday at 5:00 AM Pacific.
2. `ArticleDuplicateAnalyses` rows are cleared before backup.
3. Backup uses `npm start -- --create_backup`.
4. Old-article deletion uses the default `npm start -- --delete_articles` behavior.
5. Semantic scorer terminal skips are allowed when the article lacks usable text, but every skipped ID is reported.
6. State assignment continues through isolated article failures and stops after five consecutive failures.
7. V02 starts like a portal Mode A request:

   - count equals the Google RSS `articlesAddedCount`
   - description fallback is enabled
   - approved-boundary crossing is enabled

8. Individually approved articles retain the current V02 exclusion.
9. A V02 terminal failure uses the weekly-flow status `failure_ai_approver_v02` rather than introducing an unclear completed-with-action-required status.
10. Failure alerts are written to `ALERT-newsnexus12-weekly-cron.md` at the configured Obsidian vault root and then synced.
11. Postgres is authoritative for run and cohort state.
12. JSONL is an operator-facing run journal under `project_resources/NewsNexus12/weekly-flow/`.
13. Cohort tracking uses a new run table plus a nullable field on `NewsApiRequests`.
14. No junction table or per-article weekly-flow table is added.

## 3. Goals

1. Run the full production sequence once per week without overlap.
2. Keep the coordinator and its operational assets source-controlled.
3. Preserve current manual RSS and unrelated article-ingestion behavior.
4. Reliably associate Google RSS requests and added articles with one weekly run.
5. Use the RSS-added count to size downstream work.
6. Use exact cohort IDs to reconcile which articles were processed.
7. Wait for actual worker completion instead of treating HTTP `202` as completion.
8. Recover safely after interruption without blindly repeating destructive stages.
9. Provide operator-readable JSONL summaries and Obsidian failure alerts.
10. Test collection and scoring on Ubuntu without creating a development schedule.

## 4. Non-goals

- Restoring the removed legacy worker-node orchestrator.
- Restoring AI Approver V01.
- Adding multiple dependent cron entries.
- Making JSONL authoritative workflow state.
- Adding a weekly-flow junction table.
- Adding a per-article weekly-flow tracking table.
- Changing manual Google RSS behavior.
- Changing unrelated article-ingestion paths.
- Changing db-manager article-retention defaults.
- Dropping or truncating `ArticleDuplicateAnalyses`.
- Automatically approving articles.

## 5. Definitions

- Weekly run: One execution represented by a `WeeklyArticleFlowRuns` row.
- Weekly cohort: Distinct articles inserted by Google RSS requests carrying that weekly run ID.
- Added count: Google RSS `articlesAddedCount` reconciled against the exact cohort count.
- Consecutive failure: A failed state-assignment attempt immediately following another failure without a successful article between them.
- Accepted completion: A terminal result satisfying this PRD's stage checks.
- Manual dev run: An operator-started Ubuntu dev execution with no timer.
- JSONL journal: Append-only operator output derived from authoritative database and worker state.

## 6. Source-Controlled Implementation

### 6.1 Repository location

Add the operational subsystem under:

```text
ops/weekly-article-flow/
```

Recommended layout:

```text
ops/weekly-article-flow/
├── bin/
│   ├── run-weekly-flow
│   └── run-dev-canary
├── src/
│   ├── coordinator
│   ├── database
│   ├── stages
│   ├── reporting
│   └── alerts
├── config/
│   └── weekly-article-flow.env.example
├── systemd/
│   ├── newsnexus12-weekly-article-flow.service
│   └── newsnexus12-weekly-article-flow.timer
├── tests/
├── install.sh
├── uninstall.sh
├── package.json
├── tsconfig.json
└── README.md
```

The coordinator should be TypeScript with a small shell entrypoint. Shell handles `flock` and process startup. TypeScript handles database state, HTTP calls, polling, validation, reconciliation, JSONL, and alerts.

### 6.2 Package ownership

- `ops/weekly-article-flow`: sequence, recovery, reporting, alerting, and systemd templates.
- `db-models`: `WeeklyArticleFlowRun` model and nullable `NewsApiRequest` association.
- `db-manager`: duplicate-analysis cleanup command and existing backup and deletion commands.
- `worker-node`: optional weekly run input for RSS and exact-ID targeting needed by downstream stages.
- `worker-python`: existing AI Approver V02 preview, start, status, and cancellation behavior.

The root `scripts/` directory may contain small supporting utilities, but it must not own the coordinator.

## 7. Additive Database Design

### 7.1 WeeklyArticleFlowRuns

Add `WeeklyArticleFlowRuns` as the authoritative weekly-run record.

Required fields:

- `id`
- `mode`: `dev_canary`, `manual_production`, or `scheduled_production`
- `status`
- `currentStage`
- `scheduledFor`, nullable
- `startedAt`
- `endedAt`, nullable
- `host`
- `sourceRevision`
- `rssArticlesAddedCount`, nullable
- `cohortArticleCount`, nullable
- `stageResults`, JSONB or an equivalent structured field
- `failureReason`, nullable
- `jsonlFilePath`, nullable
- standard creation and update timestamps

The table stores stage-level state and counts. It does not duplicate every article ID.

### 7.2 NewsApiRequests addition

Add nullable `NewsApiRequests.weeklyArticleFlowRunId`:

- Default: `null`.
- Foreign key: `WeeklyArticleFlowRuns.id`.
- Indexed for cohort queries.
- Deletion policy: restrict deletion of referenced weekly run rows.
- Existing rows remain `null`.
- Manual RSS calls omit the field and behave exactly as before.
- Other article-ingestion paths remain unchanged.

The worker-node RSS start request may accept `weeklyArticleFlowRunId`. It must validate that the run exists and is active before associating new `NewsApiRequests` rows.

Do not reuse the removed `orchestratorRunId` name, request header, or legacy tables.

### 7.3 Cohort query

The authoritative cohort is derived through:

```text
WeeklyArticleFlowRuns.id
→ NewsApiRequests.weeklyArticleFlowRunId
→ Articles.newsApiRequestId
```

The coordinator queries distinct article IDs from this relationship after RSS finishes. The count must equal `articlesAddedCount`.

If the counts differ, downstream stages stop with `failure_rss_cohort_mismatch`.

### 7.4 Low-risk compatibility rules

1. The new request field is optional at every application boundary.
2. Existing RSS calls require no changes.
3. Existing repeat-window and URL deduplication behavior remains unchanged.
4. `Articles.newsApiRequestId` remains unchanged.
5. Direct or unrelated article inserts remain unchanged.
6. The migration is additive and must not rewrite historical request or article rows.
7. Tests must cover weekly, manual RSS, and unrelated ingestion paths.

## 8. Execution Modes

### 8.1 Dev canary

The Ubuntu dev server runs the project coordinator manually:

- No cron entry is created.
- The systemd timer is not installed or enabled.
- The systemd service may remain uninstalled; the manual command uses the same coordinator entrypoint.
- The database must be a confirmed development database.
- Destructive cleanup, backup, and old-article deletion default to disabled.
- RSS uses a small operator-configured target.
- Semantic scoring and state assignment target the canary cohort.
- V02 uses a small approved count and requires explicit permission for live AI calls.

### 8.2 Manual production

A manual production run uses the full sequence and all production safeguards. It is required once before enabling the timer.

### 8.3 Scheduled production

The systemd timer starts the same coordinator every Friday at 5:00 AM Pacific. Only production installs and enables the timer.

## 9. Plan and Vet Environments

### 9.1 macOS workstation

Use the Mac workstation for:

- product requirements
- code changes and review
- static analysis
- unit tests that do not depend on Ubuntu
- database migration review
- systemd template review

Do not treat macOS as proof that systemd, Linux permissions, Playwright, service-account Codex authentication, or long-running process behavior will work in production.

### 9.2 Ubuntu dev server

Use the Ubuntu dev server for:

- application installation and builds
- service-account permissions
- environment-path validation
- Playwright Chromium validation
- Codex CLI authentication validation
- manual RSS collection
- semantic scoring
- state assignment
- V02 canary execution
- interruption and recovery testing
- JSONL path and permissions

### 9.3 Ubuntu production server

Use production for final preflight, one supervised manual production run, systemd installation, timer activation, and monitoring validation.

## 10. Stage Requirements

### 10.1 Lock and preflight

- Obtain a nonblocking host `flock` before mutation.
- Refuse a second active `WeeklyArticleFlowRuns` row.
- Validate database host and name against an allowlist.
- Require idle worker-node and worker-python queues.
- Require no active V02 run.
- Validate RSS spreadsheet, scorer workbook, state files, active V02 prompt, disk space, and output paths.
- Validate Playwright and Codex CLI under the service account.
- Record host, source revision, mode, and start time.

### 10.2 Clear ArticleDuplicateAnalyses

Add a db-manager command:

```bash
npm start -- --clear_duplicate_analyses
```

Requirements:

- Count rows before deletion.
- Delete in bounded, resumable primary-key batches.
- Verify zero rows remain.
- Preserve the table, indexes, constraints, and identity sequence.
- Do not use `DROP TABLE`, `TRUNCATE`, or `VACUUM FULL`.
- Stop the flow if cleanup fails or rows remain.

This stage is disabled by default in `dev_canary` mode.

### 10.3 Backup

Run:

```bash
npm start -- --create_backup
```

- Start only after duplicate analyses are verified empty.
- Record archive path, size, checksum, duration, and exit code.
- Verify that the archive opens and contains expected exports.
- Verify no `ArticleDuplicateAnalyses` data rows are present.
- Stop before article deletion if verification fails.

This stage is disabled by default in `dev_canary` mode.

### 10.4 Delete old articles

Run:

```bash
npm start -- --delete_articles
```

- Do not provide a custom day count.
- Record deletion count, duration, and exit code.
- Require exit code `0` before RSS.
- Never repeat a recorded successful deletion during recovery.

This stage is disabled by default in `dev_canary` mode.

### 10.5 Google RSS

- Submit the worker-node RSS job with `weeklyArticleFlowRunId`.
- Record the queue job ID.
- Poll until the queue job reaches a terminal state.
- Require queue status `completed` and `endingReason = queries_exhausted`.
- Treat HTTP `202` only as job acceptance.
- Reconcile `articlesAddedCount` with the exact cohort count.
- Finish as `completed_no_new_articles` when both counts are zero.

### 10.6 Semantic scorer

- Target exact cohort article IDs, not only an arbitrary newest count.
- Extend the route to accept validated explicit `articleIds` if required.
- Allow documented terminal skips for articles without usable scoring text.
- Record selected, scored, skipped, and failed IDs and counts.
- Report every terminal skip in JSONL.
- Stop only for a stage-level failure or an unexplained reconciliation gap.

### 10.7 AI state assigner

- Target the exact cohort IDs through existing explicit-ID support.
- Set requested capacity to at least `articlesAddedCount`.
- Record attempted, successful, skipped, and failed IDs and counts.
- Continue after one to four consecutive article failures.
- Reset the consecutive-failure counter after a successful article.
- Stop the entire weekly flow when five consecutive articles fail.
- Use `failure_state_assigner_circuit_breaker` for that terminal condition.
- Allow isolated failures remaining at the end and report their exact IDs.

The cohort is specifically the set of new articles produced by this run's Google RSS stage.

### 10.8 AI Approver V02 preview

Create the preview using the same behavior exposed in the portal automation card:

- `selectionMode = article_position_count`
- `requestedArticleCount = articlesAddedCount`
- `allowDescriptionFallback = true`
- `allowPastApprovedBoundary = true`

Preserve existing V02 eligibility behavior:

- individually approved articles remain excluded
- valid existing completed predictions are not duplicated
- state-assignment requirements remain enforced
- preview token and expiry checks remain enforced

Record `plannedEligibleCount` and the overlap between the frozen V02 selection and the weekly cohort. Do not silently increase the requested count to compensate for exclusions.

### 10.9 AI Approver V02 execution

- Accept the preview and record the V02 run and queue job IDs.
- Never write the preview token to logs or JSONL.
- Poll the queue and V02 run until both are terminal.
- Record attempted, completed, failed, invalid-response, skipped, and unattempted counts.
- Preserve V02 circuit breakers and no-same-run retry behavior.
- Use `failure_ai_approver_v02` when V02 does not reach accepted completion.

## 11. Failure and Recovery

Use these weekly-run statuses:

- `pending`
- `running`
- `completed`
- `completed_no_new_articles`
- `failed`
- `failure_rss_cohort_mismatch`
- `failure_state_assigner_circuit_breaker`
- `failure_ai_approver_v02`
- `timed_out`
- `canceled`

Rules:

1. Only one stage runs at a time.
2. Completed destructive stages are not automatically repeated.
3. Polling errors use bounded exponential backoff.
4. Timeouts cancel child jobs when supported.
5. Recovery reads Postgres and worker queues, not JSONL.
6. Ambiguous state after restart requires reconciliation before resubmission.
7. An accepted V02 run is never duplicated automatically.
8. JSONL write or Obsidian sync failure does not rewrite successful workflow state, but it creates an operator-visible reporting failure.

Initial timeouts:

- Preflight: 15 minutes.
- Duplicate cleanup: 60 minutes.
- Backup: 2 hours.
- Old-article deletion: 30 minutes.
- RSS: 24 hours.
- Semantic scorer: 4 hours.
- State assigner: 18 hours.
- V02: 12 hours.
- Reporting: 10 minutes.
- Entire production run: 72 hours.

## 12. JSONL Run Journal

Write append-only JSONL under the configured absolute equivalent of:

```text
project_resources/NewsNexus12/weekly-flow/
```

Recommended filename:

```text
weekly-flow-YYYYMMDD.jsonl
```

Each record includes:

- schema version
- UTC timestamp
- weekly run ID
- mode, host, and source revision
- stage and event type
- queue or V02 run ID when applicable
- RSS added count and cohort count
- selected, attempted, completed, skipped, and failed counts
- unresolved article IDs when useful
- ending reason
- report and alert paths

JSONL rules:

- Never use JSONL to decide stage counts, recovery, or retries.
- Never include secrets, preview tokens, or article content.
- Flush each record after writing.
- Treat malformed or missing JSONL as a reporting problem, not database-state loss.
- Keep generated JSONL outside Git.

## 13. Obsidian Alerts

On failure or an overdue run, create or update:

```text
ALERT-newsnexus12-weekly-cron.md
```

Requirements:

- Write at the configured Ubuntu Obsidian vault root.
- Sync the vault before writing when the configured sync mechanism requires it.
- Sync after writing.
- Include run ID, host, failed stage, ending reason, counts, timestamps, unresolved IDs, log path, JSONL path, and first recovery action.
- Preserve the alert until the operator resolves or archives it.
- Fail loudly when the vault or sync mechanism is unavailable.
- Do not invent an alternate vault path.

The macOS NickVault path is workstation-specific and must not be copied into Ubuntu configuration.

## 14. Security and Permissions

- Run as `limited_user`, not root.
- Use root only to install or manage systemd units.
- Keep secrets outside Git in protected environment configuration.
- Allowlist database host and database name before mutation.
- Hard-code or allowlist the duplicate-analysis table target.
- Do not accept arbitrary commands, SQL, paths, or endpoint URLs from runtime requests.
- Use absolute server paths.
- Restrict JSONL and alert files to the operator and service account.

## 15. Testing Requirements

### 15.1 Database compatibility

- Migration adds `WeeklyArticleFlowRuns` without rewriting existing data.
- `NewsApiRequests.weeklyArticleFlowRunId` is nullable and defaults to `null`.
- Existing manual RSS requests work without the field.
- Weekly RSS requests associate all created `NewsApiRequests` rows.
- Unrelated article insertion remains unchanged.
- Foreign-key and deletion behavior is tested.
- Cohort query returns only articles from the selected weekly run.

### 15.2 Coordinator behavior

- Correct stage order.
- Host and database active-run locks.
- Actual queue completion polling.
- RSS count reconciliation.
- Semantic terminal skips.
- Five-consecutive-failure state circuit breaker.
- V02 Mode A request with the operator-selected flags.
- Clear failure status for V02.
- Restart and recovery without destructive repetition.
- JSONL append and redaction.
- Obsidian alert failure and sync handling.

### 15.3 Ubuntu dev canary

1. Confirm the dev database target.
2. Run the coordinator manually with destructive stages disabled.
3. Collect a small new RSS cohort.
4. Verify the run-to-request-to-article relationship.
5. Run semantic scoring on the cohort.
6. Run state assignment and test isolated failures.
7. Test the five-consecutive-failure circuit breaker with mocked or controlled failures.
8. Run an approved V02 canary.
9. Verify Postgres, JSONL, and report counts agree.
10. Confirm no timer or cron entry was created.

## 16. Production Scheduling

Install these templates only after Ubuntu dev acceptance:

- `newsnexus12-weekly-article-flow.service`
- `newsnexus12-weekly-article-flow.timer`

Production rules:

- Timer: Friday at 5:00 AM `America/Los_Angeles`.
- Persistence: catch up after downtime without overlapping another run.
- Service timeout: 72 hours.
- Host lock: nonblocking `flock`.
- Application lock: active `WeeklyArticleFlowRuns` query.
- Logs: journald plus JSONL summary.
- The old standalone Google RSS schedule is disabled only after a successful supervised production run.

## 17. Acceptance Criteria

1. The coordinator resides under `ops/weekly-article-flow/`.
2. Ubuntu dev can run RSS and analysis manually without any schedule.
3. Destructive stages default off in dev-canary mode.
4. The additive migration does not change manual RSS or unrelated ingestion behavior.
5. The exact cohort is recoverable from Postgres.
6. RSS `articlesAddedCount` equals the reconciled cohort count.
7. Semantic scoring targets the cohort and reports terminal skips.
8. State assignment uses cohort IDs and stops after five consecutive failures.
9. V02 uses Mode A, the RSS-added count, description fallback, and boundary crossing.
10. Individual approval and existing V02 prediction exclusions remain intact.
11. V02 failure produces `failure_ai_approver_v02`.
12. JSONL contains operator details but is never authoritative.
13. Failure alerts are written and synced through the configured vault integration.
14. One supervised production run succeeds before timer activation.
15. Only production enables the Friday systemd timer.

## 18. Rollout Plan

1. Approve V02 and resolve its remaining open questions.
2. Add the additive database migration and compatibility tests.
3. Add db-manager duplicate cleanup.
4. Add weekly run input to Google RSS.
5. Add or verify exact-ID downstream targeting.
6. Build the coordinator under `ops/weekly-article-flow/`.
7. Add JSONL and alert integrations.
8. Run package tests and builds on macOS where appropriate.
9. Deploy to Ubuntu dev without systemd scheduling.
10. Complete the manual dev canary.
11. Test interruption and recovery.
12. Deploy production service and timer files disabled.
13. Run one supervised manual production flow.
14. Disable the existing standalone RSS schedule.
15. Enable and verify the new timer.
16. Review results after four successful scheduled runs.

## Open Questions

### 1. Ubuntu dev paths

What are the absolute NewsNexus12 repository path and service-account name on the Ubuntu dev server?

#### Operator Response

Dev and production use `/home/limited_user/applications/NewsNexus12`. The application and weekly-flow service account is `limited_user`, with group `limited_user`.

### 2. Project resources path

What absolute Ubuntu path should represent `project_resources/NewsNexus12/weekly-flow/` on dev and production?

#### Operator Response

Use `/home/limited_user/project_resources/NewsNexus12/weekly-flow/` on both dev and production. Create the `weekly-flow` directory as `limited_user:limited_user`; the parent `/home/limited_user/project_resources/NewsNexus12` already uses that ownership.

### 3. Ubuntu vault sync

What is the Ubuntu Obsidian vault root, and which command or service should sync it before and after writing the alert?

#### Operator Response

Use `/home/nick/NickVault` as the vault root on both Ubuntu servers. The sync command is:

```bash
/home/nick/.npm-global/bin/ob sync --path "/home/nick/NickVault"
```

Run vault sync and alert-file writes as `nick`, not `limited_user`. The vault, CLI, and Obsidian authentication are Nick-owned, and `limited_user` cannot traverse `/home/nick` or use Nick's protected sync credentials.

Add a narrowly scoped root-installed oneshot helper service that runs as `User=nick`. It must sync before writing, atomically publish the fixed `ALERT-newsnexus12-weekly-cron.md` file from a fixed weekly-flow staging path, and sync again afterward. Permit the `limited_user` coordinator to start only this helper service; do not copy Nick's Obsidian token to `limited_user` or grant it general vault access.
