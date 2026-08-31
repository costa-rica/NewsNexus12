---
created_at: 2026-08-31T22:26:39Z
updated_at: 2026-08-31T22:38:49Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Processing Cron PRD V03

## Implementation Status

- Status: active product and technical requirements
- Supersedes: `docs/20260829_weekly_article_processing_cron_prd_v02.md`
- Assessment incorporated: `docs/20260829_weekly_article_processing_cron_prd_v02_assessment_claude.md`
- AI Approver version: V02 only
- Legacy orchestrator: removed and not restored by this PRD
- Development approach: plan and review on macOS; implement and validate on an Ubuntu dev server
- Development scheduling: manual execution only; no enabled cron job or systemd timer
- Production scheduling: one systemd timer after dev acceptance and production rollout approval

V03 preserves the operator decisions in V02 and resolves assessment concerns C1 through C9. All open questions are answered.

## 1. Summary

NewsNexus12 needs one completion-driven weekly production flow:

1. Run preflight checks.
2. Clear all rows from `ArticleDuplicateAnalyses` while preserving the table and schema.
3. Create and verify a db-manager database backup.
4. Delete old articles with the db-manager default `--delete_articles` flow.
5. Run worker-node Google News RSS collection.
6. Run worker-node semantic scoring across its normal eligible backlog.
7. Run worker-node AI state assignment for the exact weekly cohort.
8. Run worker-python AI Approver V02 in portal Mode A.
9. Reconcile results, write JSONL, and publish any operator alert.

The Ubuntu dev server must support manual execution without installing or enabling a schedule. Production later runs the same source-controlled coordinator through systemd.

## 2. Operator Decisions Incorporated

1. The production schedule is Friday at 5:00 AM Pacific.
2. `ArticleDuplicateAnalyses` rows are cleared before backup.
3. Backup uses `npm start -- --create_backup`.
4. Old-article deletion uses the default `npm start -- --delete_articles` behavior.
5. Semantic scorer terminal skips are allowed when an article lacks usable text, and every skipped ID is reported.
6. Semantic scoring may process all articles eligible under its normal filter. It is intentionally not restricted to the weekly cohort.
7. State assignment continues through isolated article failures and stops after five consecutive failures.
8. AI Approver V02 starts like a portal Mode A request:

   - count equals Google RSS `articlesAddedCount`
   - description fallback is enabled
   - approved-boundary crossing is enabled

9. Individually approved articles retain the current V02 exclusion.
10. A V02 terminal failure uses `failure_ai_approver_v02`.
11. Failure alerts are written to `ALERT-newsnexus12-weekly-cron.md` at the configured Obsidian vault root and then synced.
12. Postgres is authoritative for run and cohort state.
13. JSONL is an operator-facing run journal under `project_resources/NewsNexus12/weekly-flow/`.
14. Cohort tracking uses a new run table plus a nullable field on `NewsApiRequests`.
15. No junction table or per-article weekly-flow table is added.

## 3. Goals

1. Run the full production sequence once per week without overlap.
2. Keep the coordinator and operational assets source-controlled.
3. Preserve manual RSS and unrelated article-ingestion behavior.
4. Associate Google RSS requests and added articles with one weekly run.
5. Use the RSS-added count to size state assignment and V02 work.
6. Use exact cohort IDs to reconcile RSS, state assignment, and V02 overlap.
7. Wait for actual worker completion instead of treating HTTP `202` as completion.
8. Expose structured results from semantic scoring and state assignment.
9. Recover after interruption without blindly repeating destructive stages.
10. Provide operator-readable JSONL summaries and Obsidian failure alerts.
11. Validate destructive-stage recovery against the Ubuntu development database before production.

## 4. Non-goals

- Restoring the removed legacy worker-node orchestrator.
- Restoring AI Approver V01.
- Adding multiple dependent cron entries.
- Making JSONL authoritative workflow state.
- Adding a weekly-flow junction table.
- Adding a per-article weekly-flow tracking table.
- Restricting semantic scoring to the weekly cohort.
- Adding explicit-ID targeting to the semantic scorer.
- Changing manual Google RSS behavior.
- Changing unrelated article-ingestion paths.
- Changing db-manager article-retention defaults.
- Dropping or truncating `ArticleDuplicateAnalyses`.
- Automatically approving articles.

## 5. Definitions

- Weekly run: One execution represented by a `WeeklyArticleFlowRuns` row.
- Weekly cohort: Distinct articles inserted by Google RSS requests carrying that weekly run ID.
- Added count: Google RSS `articlesAddedCount` reconciled against the exact cohort count.
- Normal scorer eligibility: The semantic scorer's existing selection of articles without its persisted score contract. The weekly flow supplies no cohort or ID-range restriction.
- Consecutive failure: A failed or timed-out state-assignment attempt immediately following another failure or timeout, without a successful assignment between them.
- Accepted completion: A terminal result satisfying the mode-specific and stage-specific checks in this PRD.
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
│   ├── run-dev-canary
│   └── run-dev-destructive-recovery
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

Shell handles `flock` and process startup. TypeScript handles database state, HTTP calls, polling, validation, reconciliation, JSONL, and alerts.

### 6.2 Package ownership

- `ops/weekly-article-flow`: sequence, recovery, reporting, alerting, terminal-reason classification, and systemd templates.
- `db-models`: `WeeklyArticleFlowRun` model and nullable `NewsApiRequest` association.
- `db-manager`: duplicate-analysis cleanup, backup manifest creation, and existing backup and deletion commands.
- `worker-node`: weekly RSS run input plus structured result reporting for RSS, semantic scoring, and state assignment.
- `worker-node`: state-assigner circuit-breaker enforcement and existing exact-ID state targeting.
- `worker-python`: existing AI Approver V02 preview, start, status, and cancellation behavior.

The root `scripts/` directory may contain small supporting utilities, but it must not own the coordinator.

### 6.3 Worker result contract

Every worker-node stage used by the coordinator must persist a structured queue result through `updateResult`.

Every result includes:

- `schemaVersion`
- `endingReason`
- selected, attempted, successful, skipped, failed, and unattempted counts where applicable
- matching ID arrays or `{ articleId, reason }` arrays
- a terminal message safe for logs

Counts must be derived from the arrays. The coordinator rejects a malformed result or inconsistent counts as `failed_worker_result_contract`.

Semantic scorer results include:

- `selectedArticleIds`
- `scoredArticleIds`
- `skippedArticles` with `no_usable_text` or another defined deterministic skip reason
- `failedArticles` with `timeout`, `scoring_error`, or `persistence_error`
- `unattemptedArticleIds`

State assigner results include:

- `selectedArticleIds`
- `attemptedArticleIds`
- `successfulArticleIds`
- `skippedArticles` with a defined non-attempt reason
- `failedArticles` with `timeout`, `analysis_error`, or `persistence_error`
- `unattemptedArticleIds`
- `maximumConsecutiveFailures`
- `circuitBreakerTripped`

## 7. Additive Database Design

### 7.1 WeeklyArticleFlowRuns

Add `WeeklyArticleFlowRuns` as the authoritative weekly-run record.

Required fields:

- `id`
- `mode`: `dev_canary`, `dev_destructive_recovery`, `manual_production`, or `scheduled_production`
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
- Deletion policy: restrict deletion of referenced weekly-run rows.
- Existing rows remain `null`.
- Manual RSS calls omit the field and behave as before.
- Other article-ingestion paths remain unchanged.

The RSS start request may accept `weeklyArticleFlowRunId`. It must validate that the run exists and is active before associating new `NewsApiRequests` rows.

Do not reuse the removed `orchestratorRunId` name, request header, or legacy tables.

### 7.3 Cohort query

The authoritative cohort is derived through:

```text
WeeklyArticleFlowRuns.id
→ NewsApiRequests.weeklyArticleFlowRunId
→ Articles.newsApiRequestId
```

The coordinator queries distinct article IDs after RSS finishes. The count must equal `articlesAddedCount`.

If the counts differ, downstream stages stop with `failure_rss_cohort_mismatch`.

### 7.4 Compatibility rules

1. The new request field is optional at every boundary.
2. Existing RSS calls require no changes.
3. Existing repeat-window and URL-deduplication behavior remains unchanged.
4. `Articles.newsApiRequestId` remains unchanged.
5. Direct or unrelated article inserts remain unchanged.
6. The migration is additive and does not rewrite historical rows.
7. Tests cover weekly, manual RSS, and unrelated ingestion paths.

## 8. Execution Modes

### 8.1 Dev canary

The Ubuntu dev server runs the coordinator manually:

- No cron entry or systemd timer is created.
- The database must be a confirmed development database.
- Cleanup, backup, and deletion default to disabled.
- RSS uses a small operator-configured target.
- Semantic scoring runs across its normal eligible backlog.
- State assignment targets the canary cohort.
- V02 uses a small approved count and requires permission for live AI calls.

### 8.2 Dev destructive recovery

This explicit manual mode validates destructive-stage restart safety:

- It runs only against an allowlisted development database and host.
- It enables duplicate cleanup, backup, and old-article deletion.
- It requires an operator confirmation flag naming the expected development database.
- Tests interrupt after each destructive stage and resume the same run.
- A successful completed stage must not execute again during recovery.
- No cron entry or systemd timer is created.

### 8.3 Manual production

A manual production run uses the full sequence and production safeguards. It is required once before enabling the timer.

### 8.4 Scheduled production

The systemd timer starts the same coordinator every Friday at 5:00 AM Pacific. Only production installs and enables the timer.

## 9. Plan and Vet Environments

### 9.1 macOS workstation

Use the Mac workstation for requirements, code changes, review, static analysis, unit tests, migration review, and systemd template review.

macOS does not prove Linux permissions, Playwright, service-account authentication, systemd, or long-running behavior.

### 9.2 Ubuntu dev server

Use the Ubuntu dev server for:

- application installation and builds
- permissions and environment paths
- Playwright and Codex CLI validation
- manual RSS, semantic scorer, state assigner, and V02 canaries
- destructive-stage interruption and recovery
- JSONL and alert-helper validation

### 9.3 Ubuntu production server

Use production for final preflight, one supervised manual production run, systemd installation, timer activation, and monitoring validation.

## 10. Stage Requirements

### 10.1 Lock and preflight

- Obtain a nonblocking host `flock` before mutation.
- Refuse a second active `WeeklyArticleFlowRuns` row.
- Validate database host and name against an allowlist.
- Require idle worker queues and no active V02 run.
- Validate RSS spreadsheet, scorer workbook, state files, active V02 prompt, disk space, and output paths.
- Validate Playwright and Codex CLI under the service account.
- Record host, source revision, mode, and start time.

### 10.2 Clear ArticleDuplicateAnalyses

Add:

```bash
npm start -- --clear_duplicate_analyses
```

Requirements:

- Count rows before deletion.
- Delete in bounded, resumable primary-key batches.
- Verify zero rows remain.
- Preserve the table, indexes, constraints, and identity sequence.
- Do not use `DROP TABLE`, `TRUNCATE`, or `VACUUM FULL`.
- Stop if cleanup fails or rows remain.

The rows are intentionally not preserved by the weekly backup. They are regenerable scratch data and are expected to be recreated by later deduper runs.

This stage is disabled in `dev_canary` and enabled in `dev_destructive_recovery`.

### 10.3 Backup

Run:

```bash
npm start -- --create_backup
```

The backup command must include a versioned `manifest.json` in the ZIP. The manifest lists every registered db-model, including empty tables, with row count and CSV filename, byte size, and SHA-256 when a CSV exists.

Verification requires:

- the ZIP opens without an archive error
- one valid manifest entry exists for every registered model
- every manifest entry with a positive row count has exactly one matching CSV
- each CSV size and SHA-256 matches its manifest entry
- no unlisted CSV exists
- `ArticleDuplicateAnalysis` has row count zero and no data CSV
- at least one nonempty table exists

Record archive path, size, checksum, duration, manifest version, and exit code. Stop before deletion if verification fails.

This stage is disabled in `dev_canary` and enabled in `dev_destructive_recovery`.

### 10.4 Delete old articles

Run:

```bash
npm start -- --delete_articles
```

- Do not provide a custom day count.
- Record deletion count, duration, and exit code.
- Require exit code `0` before RSS.
- Never repeat a recorded successful deletion during recovery.

This stage is disabled in `dev_canary` and enabled in `dev_destructive_recovery`.

### 10.5 Google RSS

- Submit the worker-node RSS job with `weeklyArticleFlowRunId`.
- Record the queue job ID.
- Poll until the queue job reaches a terminal state.
- Treat HTTP `202` only as job acceptance.
- Require a structured `GoogleRssJobResult`.
- Reconcile `articlesAddedCount` with the exact cohort count after an accepted RSS ending.
- Finish as `completed_no_new_articles` when both counts are zero.

Terminal-reason rules:

| Ending reason | Dev canary | Dev destructive recovery | Manual or scheduled production |
| --- | --- | --- | --- |
| `queries_exhausted` | accepted | accepted | accepted |
| `target_articles_collected` | accepted | accepted only when an explicit small target is configured | configuration failure; production must not set a target |
| `rate_limited` | stop with `failure_rss_rate_limited` | stop with `failure_rss_rate_limited` | stop with `failure_rss_rate_limited` |
| `error` | stop as `failed` | stop as `failed` | stop as `failed` |
| `canceled` | stop as `canceled` | stop as `canceled` | stop as `canceled` |
| `aborted` | stop as `canceled` and record the abort reason | stop as `canceled` and record the abort reason | stop as `canceled` and record the abort reason |

Rate limiting never permits downstream analysis. A later operator-approved resume or new run must re-evaluate RSS state and repeat-window behavior before resubmission.

### 10.6 Semantic scorer

- Invoke the scorer without cohort IDs or ID-range bounds.
- Process all articles selected by the scorer's normal eligibility filter.
- Do not add explicit `articleIds` support for this flow.
- Return the structured result defined in Section 6.3.
- Classify no usable text as a deterministic skip.
- Classify per-article timeout, scoring error, or persistence error as a failure.
- Record and journal every selected, scored, skipped, failed, and unattempted ID.
- Require result counts to reconcile with result arrays.
- Stop only for a queue failure, malformed result, stage timeout, or scorer-level failure that prevents completion.

Isolated per-article failures do not fail the weekly flow. They remain operator-visible in Postgres and JSONL.

### 10.7 AI state assigner

- Target exact cohort IDs through existing explicit-ID support.
- Set requested capacity to at least `articlesAddedCount`.
- Return the structured result defined in Section 6.3.
- Implement the consecutive-failure counter inside worker-node's per-article processing loop.
- Increment the counter for analysis errors, persistence errors, and iteration timeouts.
- Reset the counter only after a successful persisted assignment.
- Stop worker-node processing immediately when the counter reaches five.
- Mark remaining selected articles as unattempted.
- Use `failure_state_assigner_circuit_breaker` for that terminal condition.
- Allow one to four isolated failures remaining at the end and report their exact IDs.

The coordinator validates the result but does not implement a post-hoc circuit breaker.

### 10.8 AI Approver V02 preview

Create the preview using portal Mode A behavior:

- `selectionMode = article_position_count`
- `requestedArticleCount = articlesAddedCount`
- `allowDescriptionFallback = true`
- `allowPastApprovedBoundary = true`

Preserve existing eligibility behavior:

- individually approved articles remain excluded
- valid existing completed predictions are not duplicated
- state-assignment requirements remain enforced
- preview token and expiry checks remain enforced

Record `plannedEligibleCount`, frozen selected IDs, weekly cohort IDs, overlap IDs, overlap count, and overlap percentage. Do not increase the requested count to compensate for exclusions.

The overlap is visibility-only and never gates execution. The requirement is to submit the Google RSS `articlesAddedCount` as the Mode A requested count. AI Approver V02 may select different articles because its normal eligibility queue remains authoritative.

### 10.9 AI Approver V02 execution

- Accept the preview and record V02 run and queue job IDs.
- Never write the preview token to logs or JSONL.
- Poll the queue and V02 run until both are terminal.
- Record attempted, completed, failed, invalid-response, skipped, and unattempted counts.
- Preserve V02 circuit breakers and no-same-run retry behavior.
- Use `failure_ai_approver_v02` when V02 does not reach accepted completion.

## 11. Failure and Recovery

Weekly-run statuses are:

- `pending`
- `running`
- `completed`
- `completed_no_new_articles`
- `failed`
- `failed_worker_result_contract`
- `failure_rss_rate_limited`
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
8. JSONL or alert-sync failure does not rewrite successful workflow state, but creates an operator-visible reporting failure.
9. The internal 72-hour run cap sets `timed_out`, records the active stage, and attempts child cancellation even when the stage timeout has not elapsed.
10. The systemd service timeout is 73 hours, allowing the coordinator to persist its internal timeout before systemd intervenes.

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

Write append-only JSONL under:

```text
/home/limited_user/project_resources/NewsNexus12/weekly-flow/
```

Recommended filename:

```text
weekly-flow-YYYYMMDD.jsonl
```

Each record includes:

- schema version and UTC timestamp
- weekly run ID, mode, host, and source revision
- stage and event type
- queue or V02 run ID when applicable
- RSS added count and cohort count
- selected, attempted, completed, skipped, failed, and unattempted counts
- unresolved article IDs when useful
- ending reason
- report and alert paths

Never use JSONL for recovery or retry decisions. Never include secrets, preview tokens, or article content. Flush every record and keep generated files outside Git.

## 13. Obsidian Alerts

On failure or an overdue run, create or update:

```text
ALERT-newsnexus12-weekly-cron.md
```

Requirements:

- Stage a fixed-name alert under the weekly-flow resources directory.
- Start the narrowly scoped root-installed alert helper.
- The helper runs as `nick`, syncs `/home/nick/NickVault`, atomically publishes the alert, and syncs again.
- `limited_user` may start only this helper and receives no general vault access.
- Include run ID, host, failed stage, ending reason, counts, timestamps, unresolved IDs, log path, JSONL path, and first recovery action.
- Preserve the alert until the operator resolves or archives it.
- Fail loudly when the helper, vault, or sync is unavailable.

## 14. Security and Permissions

- Run the coordinator as `limited_user`, not root.
- Use root only to install or manage systemd units and the scoped alert helper.
- Run vault synchronization and alert publication as `nick`.
- Keep secrets outside Git.
- Allowlist database host and name before mutation.
- Hard-code or allowlist the duplicate-analysis table target.
- Do not accept arbitrary commands, SQL, paths, or endpoint URLs.
- Use absolute server paths.
- Restrict JSONL, staging files, and alerts to intended accounts.

## 15. Testing Requirements

### 15.1 Database and backup compatibility

- Add `WeeklyArticleFlowRuns` without rewriting existing data.
- Default `NewsApiRequests.weeklyArticleFlowRunId` to `null`.
- Preserve manual RSS and unrelated insertion behavior.
- Test weekly request association, foreign keys, deletion restrictions, and cohort queries.
- Test backup manifests with empty tables, nonempty tables, missing CSVs, extra CSVs, bad checksums, and zero duplicate-analysis rows.

### 15.2 Worker-node contracts

- Test every Google RSS ending reason in every execution mode.
- Test semantic result arrays and derived counts for score, skip, timeout, scoring error, persistence error, cancellation, and stage failure.
- Test state results for success, timeout, analysis error, persistence error, cancellation, and breaker termination.
- Verify a timeout increments the state breaker.
- Verify success resets the breaker.
- Verify the fifth consecutive failure stops processing and marks remaining IDs unattempted.
- Verify queue persistence exposes both result contracts to the coordinator.

### 15.3 Coordinator behavior

- Correct stage order and both active-run locks.
- Actual queue-completion polling.
- RSS count reconciliation.
- Structured-result validation.
- Semantic terminal skips and isolated failures.
- V02 Mode A request and overlap reporting.
- Clear V02 failure status.
- Restart without destructive repetition.
- Internal 72-hour timeout before systemd's 73-hour timeout.
- JSONL append and redaction.
- Obsidian helper failure and sync handling.

### 15.4 Ubuntu dev canary

1. Confirm the dev database target.
2. Run manually with destructive stages disabled.
3. Collect a small RSS cohort using a target count.
4. Accept `target_articles_collected` and reconcile the cohort.
5. Run semantic scoring across its normal eligible backlog.
6. Run state assignment on the exact cohort.
7. Test isolated failures and the five-failure breaker with controlled failures.
8. Run an approved V02 canary.
9. Verify Postgres, worker results, JSONL, and report counts.
10. Confirm no timer or cron entry exists.

### 15.5 Ubuntu destructive recovery

1. Use `dev_destructive_recovery` against the confirmed development database.
2. Seed disposable duplicate-analysis and old-article data.
3. Interrupt after cleanup, resume, and verify cleanup is not repeated.
4. Interrupt after backup, resume, and verify backup is not repeated.
5. Interrupt after old-article deletion, resume, and verify deletion is not repeated.
6. Verify backup manifest and checksum failures block deletion.
7. Confirm no production database or schedule is touched.

## 16. Production Scheduling

Install only after Ubuntu dev acceptance:

- `newsnexus12-weekly-article-flow.service`
- `newsnexus12-weekly-article-flow.timer`

Production rules:

- Timer: Friday at 5:00 AM `America/Los_Angeles`.
- Persistence: catch up after downtime without overlap.
- Coordinator timeout: 72 hours.
- Systemd service timeout: 73 hours.
- Host lock: nonblocking `flock`.
- Application lock: active `WeeklyArticleFlowRuns` query.
- Logs: journald plus JSONL.
- Disable the old standalone RSS schedule only after a successful supervised production run.

## 17. Acceptance Criteria

1. The coordinator resides under `ops/weekly-article-flow/`.
2. Ubuntu dev can run RSS and analysis manually without a schedule.
3. Dev canary accepts `target_articles_collected`; production accepts only `queries_exhausted` as RSS success.
4. Destructive stages default off in dev canary.
5. Destructive recovery is proven against the development database before production.
6. The additive migration preserves manual RSS and unrelated ingestion behavior.
7. The exact cohort is recoverable and matches RSS `articlesAddedCount`.
8. Semantic scoring uses normal eligibility, returns structured results, and reports all terminal outcomes.
9. State assignment uses cohort IDs, returns structured results, and stops inside worker-node after five consecutive failures or timeouts.
10. V02 uses Mode A, RSS-added count, description fallback, and boundary crossing.
11. V02 selection-to-cohort overlap is recorded and follows the resolved Open Question 4 policy.
12. Individual approval and existing prediction exclusions remain intact.
13. V02 failure produces `failure_ai_approver_v02`.
14. Backup verification uses the versioned manifest before article deletion.
15. JSONL is operator-readable but never authoritative.
16. Failure alerts use the scoped NickVault helper.
17. One supervised production run succeeds before timer activation.
18. Only production enables the Friday systemd timer.

## 18. Rollout Plan

1. Approve V03 and use its resolved operator decisions as planning authority.
2. Create and assess an implementation plan through plan-and-vet.
3. Add the database migration and compatibility tests.
4. Add duplicate cleanup and the backup manifest.
5. Add weekly run input to Google RSS.
6. Add semantic and state job result contracts.
7. Add the worker-node state circuit breaker.
8. Build the coordinator under `ops/weekly-article-flow/`.
9. Add JSONL and scoped alert-helper integration.
10. Run package tests and builds on macOS where appropriate.
11. Deploy to Ubuntu dev without scheduling.
12. Complete the manual dev canary.
13. Complete destructive recovery testing on the dev database.
14. Deploy production service and timer files disabled.
15. Run one supervised manual production flow.
16. Disable the existing standalone RSS schedule.
17. Enable and verify the new timer.
18. Review results after four successful scheduled runs.

## Open Questions

### 1. Ubuntu dev paths

What are the absolute NewsNexus12 repository path and service-account name on the Ubuntu dev server?

#### Operator Response

Dev and production use `/home/limited_user/applications/NewsNexus12`. The application and weekly-flow service account is `limited_user`, with group `limited_user`.

### 2. Project resources path

What absolute Ubuntu path should represent `project_resources/NewsNexus12/weekly-flow/` on dev and production?

#### Operator Response

Use `/home/limited_user/project_resources/NewsNexus12/weekly-flow/` on both dev and production. Create `weekly-flow` as `limited_user:limited_user`; the parent already uses that ownership.

### 3. Ubuntu vault sync

What is the Ubuntu Obsidian vault root, and which command or service should sync it before and after writing the alert?

#### Operator Response

Use `/home/nick/NickVault` on both Ubuntu servers. Sync with:

```bash
/home/nick/.npm-global/bin/ob sync --path "/home/nick/NickVault"
```

Run sync and alert publication as `nick`. Add a narrowly scoped root-installed oneshot helper. It must sync, atomically publish the fixed alert from a fixed staging path, and sync again. Permit `limited_user` to start only this helper.

### 4. V02 cohort overlap

Should the measured overlap between the Mode A V02 frozen selection and the weekly RSS cohort gate execution, or is it visibility-only?

#### Operator Response

Use the Google RSS cohort count as the Mode A requested count. The overlap is visibility-only and does not gate the run. AI Approver V02 may select different articles through its normal eligibility queue.

### 5. Semantic scorer timeout

Should the semantic scorer retain its four-hour stage timeout when it runs across all normally eligible unscored articles?

#### Operator Response

Use a four-hour semantic-scorer stage timeout.
