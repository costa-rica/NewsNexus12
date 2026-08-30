---
created_at: 2026-08-29T20:19:07Z
updated_at: 2026-08-30T01:17:22Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Processing Cron PRD

## Implementation Status

- Status: superseded by `docs/20260829_weekly_article_processing_cron_prd_v02.md`
- Scope: the replacement weekly cron flow for Google RSS, semantic scoring, AI state assignment, deduplication preparation, and AI Approver V02
- AI Approver version: V02 only; this PRD does not restore or retain AI Approver V01
- Governing decision: the legacy V01 removal takes precedence
- Authority: `docs/ai-appover-v02/20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v03.md`
- Required next step: use V02 for implementation planning and retain V01 as the operator-decision record

Do not implement V01 as written. Its product requirements govern the replacement weekly workflow, but its proposed architecture depends on legacy orchestrator assets that have been removed. V02 must preserve the intended service sequence while defining replacement scheduling, state, monitoring, recovery, installation, and rollback.

## 1. Summary

NewsNexus12 needs one weekly, completion-driven production workflow that runs these stages in order:

1. Clear all rows from `ArticleDuplicateAnalyses` while preserving the table and schema.
2. Back up the database with db-manager:

   ```bash
   cd /home/limited_user/applications/NewsNexus12/db-manager
   npm start -- --create_backup
   ```

3. Delete old articles with the db-manager default command:

   ```bash
   cd /home/limited_user/applications/NewsNexus12/db-manager
   npm start -- --delete_articles
   ```

4. Run worker-node Google News RSS collection.
5. Run worker-node semantic scoring for the articles collected in step 4.
6. Run worker-node AI state assignment for at least the number of articles collected in step 4.
7. Run worker-python AI Approver V02 for all eligible articles collected in step 4.

AI Approver V02 must allow description fallback and scanning past the approved boundary. Each stage starts only after its predecessor reaches an accepted terminal state.

The recommended scheduler is a systemd timer whose service starts the source-controlled NewsNexus12 orchestrator. This is the production cron flow even though systemd, rather than a crontab entry, supplies the weekly trigger.

## 2. Background

The production assessment in `docs/20260808_NewsNexus12_Weekly_Cron_Flow_Assessment.md` found:

- The active weekly job starts only Google RSS.
- The active job treats HTTP `202 Accepted` as success without waiting for the queued job to finish.
- A scheduled RSS job failed after submission because Playwright Chromium was missing.
- The disabled systemd orchestrator uses the wrong stage order and AI Approver V01.
- The disabled db-manager service does not pass `--delete_articles`.
- Recent production runtimes reached about 15 hours for RSS, 12 hours for state assignment, and 8 hours for AI Approver V02.
- Count-based downstream limits did not prove article-by-article coverage.
- AI Approver V02 is currently documented as manual-only, so this PRD represents an explicit proposed change to its release policy.

The repository already contains a worker-node orchestrator, persisted run and step records, queue polling, cancellation, continuation support, and report generation. It should be enhanced rather than replaced with unrelated cron scripts.

## 3. Goals

1. Run the complete workflow once per week without overlapping weekly runs.
2. Remove disposable `ArticleDuplicateAnalyses` rows before creating the weekly backup.
3. Create and verify a database backup with `npm start -- --create_backup`.
4. Preserve the exact db-manager deletion command and its default retention behavior.
5. Wait for actual queue completion instead of treating job submission as completion.
6. Identify the exact articles inserted by the weekly RSS stage.
7. Apply semantic scoring and state assignment to that exact weekly cohort.
8. Give every cohort article a valid state-assignment outcome before AI Approver V02 selection, or fail visibly with an actionable reconciliation report.
9. Run AI Approver V02 with:

   - description fallback enabled
   - approved-boundary crossing enabled
   - a frozen selection tied to the weekly RSS cohort

10. Persist enough state to diagnose, resume, or safely retry a failed run.
11. Produce a final report with cohort and per-stage coverage counts.
12. Keep installation, configuration, and rollback reproducible from the repository.

## 4. Non-goals

- Changing the db-manager deletion rules or default age threshold.
- Dropping, truncating, or altering the `ArticleDuplicateAnalyses` table or its indexes.
- Preserving `ArticleDuplicateAnalyses` rows in the weekly backup.
- Running multiple independent time-based cron entries for dependent stages.
- Replacing worker-node or worker-python queues.
- Reintroducing AI Approver V01.
- Automatically approving articles or changing human review behavior.
- Retrying the same AI Approver V02 article within one V02 run.
- Storing secrets in the repository or the orchestration report.

## 5. Definitions

- Weekly run: One execution of the complete sequence in this PRD.
- Weekly cohort: The distinct article IDs inserted by Google RSS requests associated with the weekly orchestrator run.
- Accepted completion: A terminal result that satisfies the stage-specific checks in this PRD, not merely an HTTP response or queue status.
- Coverage: The number of distinct weekly-cohort article IDs with the required successful downstream record.
- Frozen selection: The immutable list of article IDs and content sources stored by AI Approver V02 before execution.

## 6. Authoritative Cohort

The operator approved a low-risk additive database design without a junction table or per-article tracking table:

1. Add `WeeklyArticleFlowRuns` to record each weekly run, its stage states, counts, and timestamps.
2. Add nullable `NewsApiRequests.weeklyArticleFlowRunId`, defaulting to `null`.
3. Set the field only for Google RSS requests created by the weekly flow.
4. Keep manual RSS requests and all other article-ingestion paths unchanged.
5. Derive cohort IDs through `WeeklyArticleFlowRuns` to `NewsApiRequests` to `Articles.newsApiRequestId`.

The cohort must be persisted or reproducibly queryable after RSS completes. The final cohort count must equal the RSS stage's reported `articlesAddedCount`. A mismatch fails reconciliation and blocks downstream stages.

Article ID minimum and maximum values may be recorded for diagnostics, but they must not define the cohort. Unrelated ingestion can create IDs inside the range, and duplicate RSS items can make range arithmetic inaccurate.

## 7. Proposed Architecture

### 7.1 Application orchestration

Enhance the existing worker-node orchestrator as the durable workflow state machine.

Required changes:

- Change the production order to:

  1. Google RSS
  2. semantic scorer
  3. state assigner
  4. AI Approver V02
  5. report

- Add production options that record duplicate-analysis cleanup, backup, and old-article deletion as externally executed prerequisites.
- Replace the `ai_approver` V01 step with a distinct `ai_approver_v02` step while retaining historical V01 records as readable data.
- Add persisted cohort metadata and reconciliation results to the orchestrator run or step results.
- Support restart-safe continuation from the first incomplete stage.
- Increase stage timeouts based on observed production runtimes.

The workflow must continue using the existing worker queues and status APIs. It must not create a second queue implementation.

### 7.2 Ubuntu integration

Add a source-controlled operations package under:

```text
ops/weekly-article-flow/
```

Recommended contents:

- `bin/run-weekly-flow.sh` for preflight, locking, duplicate-analysis cleanup, backup, old-article deletion, and orchestrator submission.
- `config/weekly-article-flow.env.example` for non-secret settings.
- `systemd/newsnexus12-weekly-article-flow.service`.
- `systemd/newsnexus12-weekly-article-flow.timer`.
- `install.sh` and `uninstall.sh`.
- `README.md` with deployment, canary, recovery, and rollback procedures.
- Automated tests for lock behavior, exit propagation, failed preflight, and orchestrator submission.

The Ubuntu host should use:

- systemd for the weekly calendar trigger and service supervision
- `flock` for a host-level non-overlap lock
- the database-backed active-run guard for application-level non-overlap
- journald for service logs
- existing orchestrator tables and queue stores for durable application state

Mutable runtime files may live under `/var/lib/newsnexus12-weekly-article-flow/`. Secrets must remain in protected service environment files.

### 7.3 Scheduler migration

The existing standalone Google RSS cron job must not remain active after migration because it can overlap or cause the orchestrated RSS requests to be skipped by the repeat window.

Migration must follow this order:

1. Install the new units in a disabled state.
2. Run an abbreviated end-to-end canary.
3. Run one supervised production-size execution.
4. Disable the existing standalone Google RSS cron schedule.
5. Enable the new systemd timer.
6. Confirm the next trigger time and record it in deployment evidence.

Rollback must disable the new timer before restoring the old standalone schedule.

## 8. Weekly Execution Requirements

### 8.1 Trigger and lock

- The timer runs weekly in `America/Los_Angeles` at the operator-approved day and time.
- A persistent systemd timer must catch up after downtime without starting two runs.
- The host-level service obtains a nonblocking `flock` before any mutation.
- If another run is active, the service exits without starting a second run and emits an alertable message.
- The system records scheduled time, actual start time, host, deployed Git revision, and run ID.

### 8.2 Preflight

The run stops before any database mutation unless all required checks pass:

- The production database target matches an allowlisted database name and host.
- worker-node and worker-python health endpoints return success.
- Both worker queues are idle.
- No orchestrator or AI Approver V02 run is queued or running.
- Required query spreadsheet, semantic scorer workbook, state-assigner files, and prompt are present.
- Exactly one active AI Approver V02 prompt exists.
- The worker service account has working Codex CLI authentication and access to the configured models.
- Playwright Chromium is installed for the worker-node service account.
- Available disk space is above a configured minimum.
- The configured backup destination exists, is writable, and has sufficient free space.

Preflight logs must identify checks without printing secrets.

### 8.3 Clear duplicate analyses

Add a dedicated db-manager command for this operation, recommended as:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --clear_duplicate_analyses
```

Requirements:

- Count all rows in `ArticleDuplicateAnalyses` before deletion.
- Delete rows in bounded batches ordered by primary key so a large table does not require one unbounded transaction.
- Commit each successful batch and make the command safe to resume after interruption.
- Verify the final row count is zero.
- Preserve the table, columns, indexes, constraints, and identity sequence.
- Do not use `DROP TABLE`, `TRUNCATE`, or `VACUUM FULL` in the weekly flow.
- Stop worker-python deduper writes through the idle-queue preflight and active-job checks.
- Capture the initial count, deleted count, remaining count, duration, and exit code.
- Require exit code `0` and a verified final count of zero before creating the backup.
- A partial or failed cleanup stops the weekly run before backup.
- The cleanup is intentionally destructive and is not recoverable from the backup created immediately afterward.

### 8.4 Create database backup

- Execute `npm start -- --create_backup` from the production `db-manager` directory.
- Use the db-manager production environment and service account.
- Start only after `ArticleDuplicateAnalyses` has been verified empty.
- Capture the backup path, byte size, checksum, start time, end time, and exit code.
- Verify that the archive can be opened and contains the expected manifest or table exports.
- Confirm the backup does not contain `ArticleDuplicateAnalyses` data rows.
- Require exit code `0` and successful verification before deleting old articles.
- A backup or verification failure stops the weekly run.

### 8.5 Delete old articles

- Execute the db-manager command exactly as `npm start -- --delete_articles` from the production `db-manager` directory.
- Use the db-manager production environment and service account.
- Do not supply a custom day count; preserve the CLI default.
- Capture start time, end time, exit code, and deletion summary.
- Require exit code `0` before continuing.
- A failure stops the weekly run before Google RSS.
- The orchestrator report records this as the `delete_articles` prerequisite stage even though the Ubuntu wrapper executes it.

### 8.6 Google RSS

- Submit `/request-google-rss/start-job` with the weekly orchestrator run ID.
- Record the returned worker-node job ID.
- Poll queue status until the job reaches a terminal state.
- HTTP `202` means only that the job was accepted.
- Accepted completion requires:

  - queue status `completed`
  - `endingReason = queries_exhausted`
  - no unexpected failed query rows
  - cohort reconciliation succeeds

- `rate_limited`, `error`, `canceled`, worker restart, timeout, or missing job state is a failed stage.
- A continuation may resume after the last durable query marker when existing continuation rules prove it is safe.
- After success, freeze the exact weekly cohort and its count.
- If the cohort count is zero, finish as `completed_no_new_articles` and skip all analysis stages.

### 8.7 Semantic scorer

- Process only weekly-cohort article IDs.
- Extend the semantic scorer route to accept explicit `articleIds` or a trusted `weeklyArticleFlowRunId` selector.
- Do not rely only on article ID bounds.
- Record selected, processed, successfully scored, skipped, and failed distinct article counts.
- Retry transient per-article failures according to a bounded retry policy.
- Accepted completion requires every cohort article to have either:

  - a valid semantic score written by the configured scorer, or
  - a documented terminal skip reason allowed by operator policy

- Any unexplained coverage gap blocks the state assigner.

### 8.8 AI state assigner

- Pass the exact weekly-cohort article IDs through the existing explicit `articleIds` targeting support.
- Set the requested review count to at least the RSS cohort count for reporting and capacity checks.
- Prefer exact-cohort targeting over selecting an arbitrary newest count.
- The state assigner may use `ArticleContents02` or its existing article-description fallback.
- Record requested, found, attempted, successful, failed, and skipped distinct article counts.
- Reconcile the latest `ArticleStateContracts02` row for every cohort article.
- A valid state outcome requires a latest row with a non-null `stateId` and `isDeterminedToBeError = false`, because AI Approver V02 requires that state shape.
- Retry transient state-assignment failures in a separate bounded retry attempt using only failed cohort IDs.
- Continue through one to four consecutive article failures and reset the counter after a successful article.
- Stop the weekly flow after five consecutive state-assignment failures because that pattern indicates a likely systemic problem.
- Report isolated failed or skipped IDs and allow the flow to continue when the five-failure circuit breaker is not reached.

Exact-cohort targeting ensures the state assigner attempts the newly collected articles. The circuit breaker distinguishes isolated article problems from a likely systemic failure while keeping every gap visible to the operator.

### 8.9 AI Approver V02 preview

Start V02 like an operator using the portal automation card. The preview request must use:

- `selectionMode = article_position_count`
- `requestedArticleCount = articlesAddedCount`
- `allowDescriptionFallback = true`
- `allowPastApprovedBoundary = true`

The preview must retain V02 safeguards:

- freeze the active prompt version
- freeze the content source for each selected article
- prevent duplicate active runs
- exclude an individual article that already has a disqualifying completed prediction
- exclude an individually approved article unless product policy is deliberately changed
- honor preview expiry and token validation

Approved-boundary crossing means the cohort scan may continue to article IDs below the latest approved boundary. It does not, by itself, permit rescoring an article that is already approved.

Before accepting the preview, record `plannedEligibleCount`, the frozen selection's overlap with the weekly cohort, and confirmation that description fallback and boundary crossing are enabled. Preserve current eligibility exclusions instead of increasing the count to compensate.

### 8.10 AI Approver V02 execution

- Accept the validated preview and submit it to the worker-python queue.
- Record the V02 run ID, preview token handling result, and worker-python job ID.
- Poll until both the queue job and V02 run reach consistent terminal states.
- Never persist the preview token in logs or the final report.
- Use the existing V02 descending-ID processing, circuit breakers, cancellation, and no-same-run-retry rules.
- Record planned, attempted, completed, failed, invalid-response, skipped, and unattempted counts.
- Accepted completion requires:

  - V02 run status `completed`
  - queue status `completed`
  - attempted count equals planned eligible count
  - completed count equals planned eligible count
  - zero failed, invalid-response, skipped, or unattempted cohort articles

- Failed or invalid-response articles may be retried only through a new V02 preview/run, following existing first-retry eligibility rules.
- Any terminal V02 failure ends the weekly workflow as `failure_ai_approver_v02`.

## 9. State Machine and Failure Behavior

Use persisted stage states:

- `pending`
- `running`
- `completed`
- `skipped`
- `failed`
- `timed_out`
- `canceled`

Rules:

1. Only one stage may be `running` at a time.
2. A downstream stage never starts after an unaccepted predecessor result.
3. Network polling errors use bounded exponential backoff and do not silently change stage state.
4. Stage timeouts cancel the child job when supported and stop the run.
5. Process or host restart reconciliation marks ambiguous active work for operator review before resumption.
6. Resume logic must inspect durable child-job and database results rather than blindly resubmitting.
7. Duplicate-analysis cleanup is never repeated during continuation after a verified zero-row result is recorded.
8. Backup is never repeated during continuation after a verified archive result is recorded.
9. Old-article deletion is never repeated during continuation when its original exit-zero result was recorded.
10. V02 preview creation is repeated if the prior preview expired; an accepted V02 run is never duplicated automatically.

Initial production timeout limits:

- Preflight: 15 minutes.
- Clear duplicate analyses: 60 minutes.
- Create backup: 2 hours.
- Delete articles: 30 minutes.
- Google RSS: 24 hours.
- Semantic scorer: 4 hours.
- State assigner: 18 hours.
- AI Approver V02: 12 hours.
- Report: 10 minutes.
- Entire systemd service: 72 hours.

Timeouts must be configurable and reviewed against production metrics after four successful runs.

## 10. Data and Schema Requirements

Use a new `WeeklyArticleFlowRuns` table because the legacy orchestrator tables were removed.

Required persisted data:

- weekly article flow run ID and mode
- source Git revision and host
- schedule and actual start timestamps
- duplicate-analysis initial, deleted, and remaining row counts
- verified backup path, size, checksum, and completion time
- exact cohort count and a durable cohort reference
- each stage's child job or V02 run ID
- request parameters with secrets removed
- terminal status and ending reason
- selected, attempted, successful, failed, skipped, and retry counts
- retry or continuation lineage
- final report path

Add nullable `NewsApiRequests.weeklyArticleFlowRunId` with a foreign key to `WeeklyArticleFlowRuns.id`. Existing writers may omit it, and existing rows remain `null`.

Do not add a junction table or per-article weekly-flow table. Use existing `Articles.newsApiRequestId`, state-assignment rows, semantic-score rows, and V02 prediction rows for reconciliation.

## 11. Reporting and Observability

Each weekly run must generate a human-readable report and structured logs.

The report must include:

- run ID, host, Git revision, schedule time, and duration
- preflight results
- duplicate-analysis cleanup counts, duration, and exit code
- backup path, size, checksum, verification result, duration, and exit code
- deletion exit code and deleted count
- RSS job ID, ending reason, query totals, and added count
- exact cohort count
- semantic scorer coverage
- state-assigner coverage and retry results
- V02 run ID, flags, prompt version, and coverage
- stage timeouts, failures, and continuation lineage
- exact unresolved article IDs with concise reason codes
- overall result

Overall results:

- `completed`
- `completed_no_new_articles`
- `completed_with_action_required`
- `failed`
- `timed_out`
- `canceled`

Logs must use a stable run ID and stage name. They must not include database credentials, API keys, Codex authentication material, preview tokens, or full article text.

Export append-only JSONL summaries to `project_resources/NewsNexus12/weekly-flow/`. JSONL is an operator journal, not authoritative workflow state. The workflow must query Postgres when deciding counts, cohort IDs, retries, or recovery actions.

## 12. Alerts

Send an operator alert when:

- preflight fails
- duplicate-analysis cleanup fails or leaves rows behind
- backup creation or verification fails
- deletion exits nonzero
- RSS does not end with `queries_exhausted`
- the cohort count does not match `articlesAddedCount`
- any stage times out or fails
- downstream coverage is below its required count
- V02 preview eligibility is below the expected cohort count
- a run remains active beyond its expected duration
- the systemd timer or service is disabled unexpectedly

The alert should include the run ID, failed stage, ending reason, relevant counts, and the first recovery action. It must link or point to the report and logs without embedding secrets.

Write the alert as `ALERT-newsnexus12-weekly-cron.md` at the configured Obsidian vault root and sync the vault. The Ubuntu vault path and sync mechanism must be configured explicitly.

## 13. Security and Permissions

- Run the service as `limited_user`, not root.
- Grant only the filesystem, database, and service access required by the existing workers and db-manager.
- Use root only to install, enable, disable, or remove systemd units.
- Store environment files outside Git with mode `0600` or an equivalent protected systemd credential mechanism.
- Validate the production database target before deletion.
- Require an explicit allowlisted table name in the cleanup implementation; do not accept a table name from runtime input.
- Use absolute paths in the service and wrapper.
- Do not allow arbitrary commands or arbitrary endpoint URLs through configuration.

## 14. Testing Requirements

### 14.1 Unit and integration tests

- Correct production stage order.
- Duplicate-analysis cleanup deletes rows but preserves the table, indexes, constraints, and identity sequence.
- Duplicate-analysis cleanup handles zero rows, multiple batches, interruption, and safe resumption.
- Backup starts only after duplicate-analysis cleanup verifies zero rows.
- Backup failure or invalid archive blocks old-article deletion.
- db-manager exit-code propagation.
- Cohort query returns only articles from RSS requests tagged with the run ID.
- RSS count and cohort mismatch blocks execution.
- Semantic scorer exact-ID targeting.
- State assigner exact-ID targeting and coverage reconciliation.
- V02 orchestrator-run preview with both required flags enabled.
- V02 preview refuses a partial or foreign cohort.
- V02 preview expiry and active-run conflicts.
- Stage timeout, cancellation, polling errors, and worker restart.
- Continuation does not repeat completed deletion or accepted V02 execution.
- Historical V01 orchestrator rows still deserialize and render.
- No-new-articles early completion.
- Host and application locks prevent overlap.

### 14.2 Production validation

1. Seed disposable duplicate-analysis rows in a non-production database and verify cleanup behavior.
2. Verify the post-cleanup backup contains no duplicate-analysis data rows.
3. Run an abbreviated test using a small RSS target and downstream cohort.
4. Confirm each persisted ID belongs to the canary cohort.
5. Confirm description fallback and approved-boundary crossing are enabled in the V02 run row.
6. Simulate one recoverable failure and verify continuation behavior.
7. Run one supervised full workflow.
8. Compare final database records to the report.
9. Enable the weekly timer only after operator sign-off.

Live AI calls and production deletion require explicit operator approval during validation.

## 15. Acceptance Criteria

The feature is complete when:

1. One enabled systemd timer owns the weekly sequence.
2. The prior standalone Google RSS schedule is disabled.
3. The production service clears all `ArticleDuplicateAnalyses` rows and verifies zero remain without dropping or truncating the table.
4. The verified weekly backup runs after duplicate-analysis cleanup and before old-article deletion.
5. The production service executes `npm start -- --delete_articles` with no custom deletion threshold.
6. Every stage waits for accepted terminal completion.
7. The exact RSS cohort is derived from `weeklyArticleFlowRunId` relationships and reconciles to `articlesAddedCount`.
8. Semantic scoring targets the exact cohort and reports full coverage or explicit allowed skips.
9. State assignment targets the exact cohort and stops the flow after five consecutive failures.
10. V02 uses Mode A with the RSS-added count, description fallback, and approved-boundary crossing enabled.
11. V02 failure produces `failure_ai_approver_v02` with visible IDs and reasons.
12. Overlap protection works at host and application levels.
13. Restart, timeout, and continuation paths are tested.
14. A final report and alerting path are available to the operator.
15. Installation and rollback are documented and reproducible.

## 16. Rollout Plan

1. Approve the V02 automation policy change and resolve the open questions.
2. Add and test the db-manager duplicate-analysis cleanup command.
3. Implement and verify the required db-manager backup stage.
4. Implement cohort tracking and exact-cohort targeting.
5. Update the worker-node orchestrator order, V02 integration, reconciliation, and timeouts.
6. Add the source-controlled Ubuntu wrapper and systemd units.
7. Add automated tests and run package builds and test suites.
8. Deploy units disabled.
9. Verify production prerequisites, backup destination, and browser installation.
10. Run an abbreviated canary.
11. Run one supervised full weekly flow.
12. Disable the old standalone Google RSS schedule.
13. Enable and verify the new timer.
14. Review metrics after four successful runs and adjust timeouts or retry limits.

## Open Questions

### 1. Weekly schedule

What day and Pacific time should the new full workflow start?

#### Operator Response

Friday at 5:00 AM Pacific to preserve the current RSS schedule unless the multi-day runtime conflicts with weekend operations.

### 2. Semantic coverage skips

May title-only or otherwise unscorable cohort articles count as documented semantic skips, or must every cohort article receive a stored score?

#### Operator Response

Allow explicit terminal skips because semantic scoring can lack usable text, while keeping every skipped ID visible in the report.

### 3. State assignment gaps

If state assignment still fails for some cohort articles after bounded retries, should V02 process the valid subset or should the weekly run stop?

#### Operator Response

Is the cohort the set of new articles produced by this sequence's Google News RSS flow? if yes, and one or two artilces are skipped or failed then we can keep going. But if 5 in a row fail. Then there is systemic issue, like maybe codex cli signin error. So we shoudl stop the entire flow. if one to four artilces get skipped or fail in a row but the 5th works then continue.

If my answer exposes a misunderstanding. Please explain further.

### 4. Existing V02 predictions

If a newly collected cohort article already has a completed V02 prediction, should that existing prediction satisfy weekly coverage or should the article be excluded and reported?

#### Operator Response

I'm not sure what impact this will have? Is this question related to some way of monitoring the ai-approver-v02 flow? I think we shoudl just kick off the request like a user would do in the portal app's /articles/automations page in the AI Approver V02 section - with the arguments I laid out mode A, count of new cohort articles, include description, bypass boundary.

If my answer exposes a misunderstanding. Please explain further.

### 5. Approved articles

Should an individually approved cohort article remain excluded from V02, even though scanning past the approved boundary is enabled?

#### Operator Response

Preserve the current individual-approved exclusion; boundary crossing should not override an article-level approval decision.

### 6. Partial V02 outcome

Should remaining V02 failures after a separate retry end the weekly run as `failed` or `completed_with_action_required`?

#### Operator Response

If `completed_with_action_required` is the result of an exsiting failure flow then let's keep this, but if this is creating a new failure notifiation flow, then I prefer to say somethign clearer like `failure_ai_approver_v02`.

If my answer exposes a misunderstanding. Please explain further.
### 7. Alert destination

Where should failure and overdue-run alerts be delivered?

#### Operator Response
Save the failures to the Obsidian vault root and sync the vault. Let's ahve a file called `ALERT-newsnexus12-weekly-cron.md` with the alert or failure reasons and details.

### 8. Cohort storage

Should exact cohort IDs use a new normalized orchestrator-run article table or remain reproducibly queryable through `NewsApiRequests`?

In plain language, the cohort is the list of new articles collected by this weekly Google RSS run. The system needs to remember that list so it can confirm that each article moves through semantic scoring, state assignment, and AI Approver V02.

There are two choices:

1. Create a new tracking table. This works like a checklist with one row per collected article. It makes progress, failures, retries, and missing articles easier to see, but requires a new database table and supporting code.
2. Rebuild the list from existing `NewsApiRequests` and article relationships whenever it is needed. This avoids a new table, but makes per-article progress and troubleshooting harder.

#### Operator Response

Use a new `WeeklyArticleFlowRuns` table and add nullable `NewsApiRequests.weeklyArticleFlowRunId`. Do not add a junction table or per-article tracking table. Export operator summaries to JSONL, but use Postgres for workflow decisions.
