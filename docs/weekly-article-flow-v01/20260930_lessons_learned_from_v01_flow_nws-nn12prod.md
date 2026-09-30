---
created_at: 2026-09-30T22:04:09Z
updated_at: 2026-09-30T22:04:09Z
created_by: hermes (gpt-5.6-sol) nws-nn12prod
modified_by: hermes (gpt-5.6-sol) nws-nn12prod
---

# Lessons Learned from V01 Flow on nws-nn12prod

## Host and evidence scope

- Host: `nws-nn12prod`.
- Inspection time: `2026-09-30T22:00:38Z` through `2026-09-30T22:04:09Z`.
- Checked-out branch: `dev_32_weekly_cron_fix_02`.
- Checked-out revision after fetching and fast-forwarding to the fetched branch: `3aa26b74cd61860b3f203b3404d8fec47a3aa89a`.
- Last completed production run revision: `61a5ec02653c7ffc2d1c25c731efaff138ab23c3`.
- No workflow job was started, resumed, canceled, or changed during this inspection.
- No service, timer, configuration, database row, or external resource was modified.

Local evidence inspected read-only:

- Installed systemd services, timers, unit properties, schedules, and journals.
- Repository and installed weekly-flow service assets.
- Durable `WeeklyArticleFlowRuns` records and related schema in `newsnexus_prod`.
- The current `ArticleDuplicateAnalyses` row count.
- Backup, JSONL, staged-alert, lock, and journal locations.
- Configuration paths, file metadata, and nonsecret variable names.
- Readable cron configuration and operator permissions.

Retained reports supplied historical and cross-host evidence:

- [Production run 4 failure report](20260929_weekly_article_flow_run_4_failure_report.md)
- [Run 4 connection reset investigation](20260929_run_4_connection_reset_investigation.md)
- [Development run 4 resume reproduction](20260929_nws-nn12dev_weekly_article_flow_run_4_resume_reproduction_report.md)
- [Production run 5 success report](20260930_weekly_article_flow_run_5_success_report.md)

Evidence limitations:

- The protected production environment file was not readable as `nick`, so its actual variable-name set was not independently confirmed.
- The `limited_user` crontab could not be read without additional authorization.
- No packet capture, socket trace, historical GC trace, or complete PostgreSQL statement timing exists for production run 4.
- The endpoint that emitted the run 4 TCP reset remains unproven.
- Journald evidence is subject to rotation.

## What worked

### Durable workflow evidence

`WeeklyArticleFlowRuns` preserved run mode, source revision, stage results, child job IDs, counts, failure details, JSONL paths, and timestamps.

This evidence was more reliable than systemd or queue lifecycle status alone. It allowed a failed observation, worker outcome, per-article result, and alert-publication outcome to be evaluated separately.

### Ordered destructive protection

V01 performed database backup before old-article deletion. Production run 5 retained the backup path, byte size, SHA-256, and stage timing.

The intended order was enforced:

1. Preflight.
2. Duplicate-analysis cleanup.
3. Database backup.
4. Old-article deletion.
5. Google RSS collection.
6. Semantic scoring.
7. State assignment.
8. AI Approver V02.
9. Reconciliation and reporting.

### Production run 5 completed end to end

Durable run `5` completed on revision `61a5ec02653c7ffc2d1c25c731efaff138ab23c3`.

Observed results:

| Stage | Result |
|---|---|
| Duplicate cleanup | Completed; zero rows found or deleted |
| Backup | Completed; 223,379,934-byte archive retained |
| Old-article deletion | Completed; 1,676 articles deleted |
| Google RSS | Job `0274` completed; three articles added |
| Semantic scorer | Job `0275` completed; 140 selected, four scored, 136 skipped, zero failed |
| State assigner | Job `0276` completed; three selected and three successful |
| AI Approver V02 | Run `40`; three requested, one eligible, one selected, execution completed |
| Reconciliation | One selected, attempted, and completed |
| Reporting | Completed with no recorded reporting failure |

This run provides a useful baseline. It does not establish reliability because it is one successful observation after earlier failures.

### Diagnostics exposed resource and responsiveness risk

Run 5 measured:

- Maximum semantic-selection event-loop delay of approximately `6,471.8 ms`.
- Diagnostic timer delay of approximately `6,183.7 ms`.
- One status request lasting approximately `7,120 ms` and returning HTTP `200`.
- Worker RSS of approximately `1.30 GB` after semantic model initialization.
- Service memory peak of `3,183,448,064` bytes, approximately `2.96 GiB`.
- Zero service swap use.

These measurements strengthened the event-loop-stall hypothesis while showing that a slow poll can survive and complete.

### Historical failure remained intact

Production run `4` remained failed after later semantic work succeeded. The manual semantic job did not rewrite the failed weekly run as successful.

Preserving immutable failure evidence is necessary for meaningful incident review and continuation design.

## Problems and causes

### Semantic processing was not limited to the weekly cohort

Trigger:

- The coordinator started semantic scoring without exact article IDs or ID bounds.

Observed behavior:

- Production run 4 added 1,562 RSS articles but semantic job `0267` selected 1,705 candidates.
- The worker loaded approximately 260,000 Article rows and related semantic-contract data before filtering in Node.js.
- Production run 5 added three articles but semantic job `0275` selected 140 candidates.

Operator impact:

- Workload size, memory, latency, and transport risk were driven by global backlog rather than the new weekly cohort.
- Successful counts did not prove that every newly collected article was processed.

Confirmed cause:

- Broad ORM materialization and application-side filtering were used instead of exact cohort selection or database-side eligibility filtering.

### One failed status observation canceled active work

Trigger:

- One coordinator status poll for semantic job `0267` failed after approximately `6,895 ms` with `read ECONNRESET`.

Observed behavior:

- The coordinator immediately requested cancellation.
- All 1,705 selected articles ended unattempted.
- State assignment, AI Approver V02, and reconciliation were never reached.

Operator impact:

- A transient inability to observe status became a business-stage failure.
- The resulting canceled queue state could be misread as proof that semantic scoring itself failed.

Confirmed cause:

- V01's fail-fast polling policy did not retry or reconcile a transient read-only status failure before canceling the child job.

Unresolved mechanism:

- Global ORM loading correlated with delayed worker responsiveness.
- Run 5 directly measured a substantial event-loop stall.
- A pooled keep-alive socket race is plausible but unproven.
- The evidence does not identify which endpoint emitted the TCP reset.

### Queue completion did not guarantee business success

Queue status represented worker-loop completion, not an accepted business result.

Examples:

- Production run 5 semantic job `0275` completed while scoring only four of 140 selected articles. The remaining 136 were `no_score_result` skips.
- The retained development state-assignment job completed at the queue level while all selected articles failed with `analysis_error`.
- An AI Approver preview can fail with `no_eligible_articles` after an upstream queue reports completion.

Each stage needs counters and acceptance criteria beyond terminal queue state.

### Count-based targeting did not prove cohort identity

The proposed replacement says state assignment should process at least the number of articles collected.

A count alone can select older backlog articles while missing newly collected articles. Downstream stages need the exact collected article IDs or a durable cohort identifier.

### Failure attribution was overwritten by reporting

All five current production durable rows record `currentStage=reporting`, including failed runs.

Reporting finalization therefore obscured the originating business stage. Operators had to inspect nested evidence to distinguish semantic polling, state assignment, AI Approver, and reporting failures.

The success text `Weekly article flow completed.` was also stored in a field named `failureReason` for run 5.

### Alert staging was not alert delivery

The weekly service runs with `NoNewPrivileges=true`. Its failure path attempted `sudo systemctl start` for the root-owned alert publisher.

That privilege escalation is incompatible with the service's hardening. The staged production alert remained present, the publisher journal showed no September execution, and the intended NickVault alert destination was absent.

Alert failure was separate from the originating business-stage failure and must remain separately visible.

### Git rollback would not reverse host or database state

A repository revert does not remove or reverse:

- The enabled production timer.
- Installed service and publisher units.
- The protected environment file.
- The sudoers rule and helper executable.
- The lock file.
- Backups, JSONL evidence, staged alerts, or journals.
- `WeeklyArticleFlowRuns` or its durable rows.
- `NewsApiRequests.weeklyArticleFlowRunId`.
- RSS-created articles or semantic, state, and AI results.
- Previous duplicate cleanup or old-article deletions.

The code revert and operational cleanup require separate operator-approved plans.

## Fixes and remaining uncertainty

### Verified behavior

- Production run 5 completed the full workflow once.
- Run 5 diagnostics measured event-loop delay, process memory, model initialization, and status latency.
- Durable records preserved the failed run and successful run separately.
- The active-run uniqueness constraint prevents multiple `pending` or `running` durable rows.
- The installed weekly service, timer, publisher unit, and publisher executable matched their repository copies at inspection.

### Recovery evidence that was not a durable fix

Manual semantic job `0272` completed after production run 4, but it was not a resume or exact replay.

Its candidate set had changed from 1,705 to 871. It did not continue the durable weekly run through the remaining stages.

### Not verified as fixed

- Transient polling resilience was not demonstrated under a repeated transport failure.
- Exact semantic cohort targeting was not demonstrated.
- The root cause of run 4's TCP reset was not proven.
- Alert publication from the hardened weekly service remained unresolved.
- `currentStage` still did not identify the originating failed stage.
- A restore test for the produced backup was not part of the retained evidence.
- One successful production run did not establish schedule or workflow reliability.

### Historical evidence boundary

Recommendations in the retained reports are not deployed fixes. The replacement should verify each accepted design change with focused tests and supervised nonproduction evidence before production scheduling.

## Requirements for the Weekly Combined Flow

### Preserve the business order

The replacement should preserve this order:

1. Clear rows from `ArticleDuplicateAnalyses` while retaining its table and schema.
2. Create and verify a database backup.
3. Delete old articles under the approved policy.
4. Collect Google RSS articles.
5. Semantically score the exact collected cohort.
6. Assign state to the exact eligible collected cohort.
7. Run AI Approver V02 for all eligible collected articles.
8. Reconcile exact article IDs and publish a verified report.

### Add an operator-controlled destructive gate

Before duplicate cleanup or old-article deletion, show the operator:

- Host, database, schema, and source revision.
- Backup destination, available disk, and restore-validation status.
- Delete cutoff and estimated row count.
- RSS source identity and expected query count.
- Prompt and model configuration names.
- Installed schedule state and next trigger.
- Stage deadlines, cancellation rules, and no-work behavior.

The first real production cycle should require explicit operator approval. `manual_production` must not be described as a dry run.

### Use exact cohort identity

Persist RSS-added article IDs as the authoritative cohort. Pass those IDs, or a durable cohort ID resolving to them, to semantic scoring, state assignment, AI Approver, and reconciliation.

Record selected, attempted, successful, skipped, failed, and unattempted ID sets against the authoritative cohort.

Do not use a numeric limit as a substitute for identity.

### Define stage acceptance contracts

Each stage should define:

- Accepted lifecycle states.
- Required business-result fields.
- Allowed skip reasons and thresholds.
- Allowed failure and unattempted counts.
- No-work behavior.
- Deadline and cancellation policy.
- Evidence required before advancing.

Queue status `completed` must not automatically satisfy a stage contract.

### Make observation resilient

Retry safe status requests for bounded transient network errors and retryable HTTP responses. Use backoff and jitter within the stage deadline.

After connectivity returns, reconcile the same child job ID. Do not automatically resubmit an ambiguous start request.

Cancel only after an approved terminal condition, such as deadline expiry or explicit operator cancellation.

### Make interruption and continuation explicit

Persist exact stage inputs, child job IDs, outputs, and side-effect evidence before advancing.

On restart, revalidate completed side effects. Do not repeat backup, deletion, ingestion, or model work blindly.

Keep terminal historical runs immutable. If a continuation creates a new run, link it to the original and record changed eligibility.

### Control semantic resource use

Use database-side eligibility filtering or an exact cohort query. Avoid loading the global Article and semantic-contract populations into Node.js.

Record query, hydration, filtering, model initialization, scoring, event-loop delay, memory, and garbage-collection timing separately.

### Validate runtime identity and model access

Preflight should test worker endpoints and configured models from the actual service-user contexts.

A successful command as `nick` does not prove that `limited_user` can use the same model, authentication, filesystem path, or environment noninteractively.

### Preserve AI Approver semantics explicitly

The replacement must verify both independent requirements:

- Description fallback is allowed when required.
- Selection can scan past the approved boundary when required.

Preview and execution should record requested cohort size, eligible overlap, selected IDs, mode, boundary, fallback setting, and final per-item outcomes.

### Treat alert delivery as a separate stage

Use a reviewed handoff compatible with `NoNewPrivileges=true`, or another mechanism that does not require impossible in-service privilege escalation.

Success requires delivery confirmation, not merely staging a file. Alert failure must not overwrite the originating business failure.

### Separate business failure from reporting

Persist an immutable `failedStage`, failure class, and original error separately from final reporting status.

Distinguish coordinator, transport, queue lifecycle, worker, per-article, configuration, reconciliation, and alert failures.

### Verify backup recoverability

Require archive completion, byte size, SHA-256, manifest validation, and a documented restore-test policy before destructive operations are considered protected.

A created ZIP alone is not proof that restoration will succeed.

### Separate rollback, host cleanup, and data disposition

Before reverting or enabling the replacement, obtain an operator decision for:

- V01 services and timers.
- The alert publisher, helper, and sudoers rule.
- Protected environment files.
- Locks, staged alerts, JSONL, journals, and backups.
- V01 durable schema and rows.
- Historical data mutations that cannot be automatically reversed.

Do not remove evidence needed to interpret historical runs.

### Gate scheduler activation

Install and inspect the replacement timer separately from the first real production cycle.

Verify timezone, next trigger, persistent-timer catch-up behavior, runtime user, environment path, and command before enabling it.

Require supervised successful cycles and alert-delivery evidence before treating the schedule as reliable.

## Host Inventory

### Services and schedules

| Item | State at inspection | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `newsnexus12-weekly-article-flow.timer` | Installed at `/etc/systemd/system`; enabled; active and waiting; Friday `05:00 America/Los_Angeles`; `Persistent=true`; next trigger `2026-10-02T12:00:00Z`; no drop-ins | V01 production schedule | Yes | Disable before any revert or replacement work if the operator does not want another V01 run; removal requires separate approval |
| `newsnexus12-weekly-article-flow.service` | Installed; disabled; inactive; last result success; user `limited_user`; workdir repository root; no drop-ins | V01 production orchestrator | Yes | Retain until evidence collection is complete, then review for archival or removal |
| `newsnexus12-publish-weekly-alert.service` | Static and inactive; runs as root; no drop-ins | V01 alert handoff | Yes | Do not reuse until privilege and delivery design are corrected and tested |
| `/usr/local/libexec/newsnexus12-publish-weekly-alert` | Present; `root:root`, mode `0755`; matched repository copy | V01 alert helper | Yes | Retain for evidence, then review with the publisher unit and sudoers rule |
| Publisher sudoers rule | `/etc/sudoers.d/newsnexus12-publish-weekly-alert`; `root:root`, mode `0440` | V01 host permission | Yes | Review separately; it does not overcome the coordinator's `NoNewPrivileges=true` restriction |
| API, portal, worker-node, and worker-python services | Enabled and active; run as `limited_user` | Shared application runtime | Yes | Retain; do not classify as V01-only |
| `newsnexus12-db-manager.timer` | Installed, disabled, inactive, no next trigger | Older/shared maintenance; ownership uncertain | Yes | Review separately; do not remove as part of V01 rollback without confirming purpose |
| `newsnexus12-db-manager.service` | Installed, disabled, inactive | Older/shared maintenance | Yes | Keep job-style/on-demand unless separately authorized |
| Nick crontab | No crontab | Host user | Yes | No action |
| `limited_user` crontab | Unverified because read access required additional authorization | Host user | Yes | Verify during authorized host-cleanup review |
| Readable system cron files | No NewsNexus weekly entry found | Host configuration | Yes | Recheck with complete privilege before declaring cron empty |

The timer and target service states must be interpreted separately. A waiting enabled timer normally leaves its oneshot target service inactive.

### Configuration and permissions

| Item | Observation | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `/etc/newsnexus12/weekly-article-flow.env` | Referenced by the service; `root:root`, mode `0600`; unreadable as `nick` | V01 production configuration | Yes | Preserve through evidence collection, then review for secure archive or removal |
| Weekly service hardening | `NoNewPrivileges=true`; `PrivateTmp=true`; 73-hour timeout | V01 service configuration | Yes | Preserve hardening unless a security review approves a different design |
| Weekly service identity | `limited_user:limited_user`; workdir `/home/limited_user/applications/NewsNexus12` | V01 runtime contract | Yes | Test replacement preflight and models as this identity |
| Repository `.env` files | Present with group-readable operational access; values not inspected or recorded | Shared/V01 configuration | Depends on selected revert | Never copy secrets into preserved documentation |
| Worker endpoints | Local worker-node and worker-python endpoints are configuration dependencies | Shared runtime contract | Yes | Discover and verify through preflight rather than assuming fixed ports |
| Weekly configuration names | Repository schema includes repository/resources paths, host/database allowlists, endpoints, lock/backup/journal/alert paths, stage timeouts, poll settings, disk floor, RSS target, AI preview TTL, and PostgreSQL names | V01 configuration schema | Yes when installed | Build a smaller reviewed replacement schema and fail closed on placeholders |
| Model configuration names | Worker configuration includes state-assigner and AI Approver model names, Codex timeout, semantic paths, and diagnostics settings | Shared runtime/model configuration | Yes | Validate availability from the actual service account before destructive stages |

The protected production environment could not be read, so the installed variable set remains unverified rather than assumed complete.

### Files and retained evidence

| Item | Observation | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `/home/limited_user/project_resources/NewsNexus12/weekly-flow/` | `limited_user:limited_user`, mode `2770`; contains dated JSONL evidence and the staged alert | V01 evidence | Yes | Preserve and archive with host metadata before cleanup |
| Dated JSONL files | Files observed for September 4, 11, 19, 25, and 30; mode `0600` | V01 run evidence | Yes | Preserve; export critical facts before retention or ownership changes |
| `ALERT-newsnexus12-weekly-cron.md` staging file | Present from the September 25 failure; mode `0600` | V01 alert evidence | Yes | Preserve as evidence; do not treat it as delivery confirmation |
| NickVault alert destination | Expected destination absent at inspection | V01 alert delivery | N/A | Record alert publication as unverified/failed until delivery is proven |
| `/home/limited_user/project_resources/NewsNexus12/db_backups/` | `nick:limited_user`, mode `2770`; includes run 4 and run 5 archives | Shared backups with V01 evidence | Yes | Preserve until retention and restore-test policy are approved |
| Run 5 backup | `db_backup_202609300317539.zip`; 223,379,934 bytes; `limited_user:limited_user`, mode `0660` | V01 pre-delete evidence | Yes | Retain as the successful-run baseline backup |
| `/var/lock/newsnexus12-weekly-article-flow.lock` | Empty regular file; `limited_user:limited_user`, mode `0644` | V01 runtime artifact | Yes | Remove only after the timer/service cannot use it and cleanup is approved |
| Journald | Retains weekly and worker milestones, failures, and run 5 evidence | Host evidence | Until rotation | Export required excerpts before cleanup or retention expiry |

### Database state

Read-only queries were performed inside a read-only transaction and rolled back.

| Item | Observation | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| Database identity | `newsnexus_prod`, schema `public`; inspected with read-only access | Shared production database | Yes | Treat every cleanup and deletion as production mutation requiring approval |
| `WeeklyArticleFlowRuns` | Exists with 16 columns and five durable rows | V01-specific durable schema and evidence | Yes | Preserve or export before deciding whether to retain, migrate, or remove it |
| Active-run constraint | Partial unique index permits at most one `pending` or `running` row | V01 safety control | Yes | Preserve equivalent protection in the replacement |
| `NewsApiRequests.weeklyArticleFlowRunId` | Nullable foreign key to `WeeklyArticleFlowRuns.id` | V01 linkage in shared schema | Yes | Include in schema-disposition and replacement-migration planning |
| Sequelize migration metadata | No `public."SequelizeMeta"` relation found | Schema-management characteristic | Yes | Do not assume Git revert automatically removes additive schema |
| `ArticleDuplicateAnalyses` | Shared pre-existing table; zero rows at inspection | Shared schema used destructively by V01 | Yes | Preserve the table; clearing rows must remain explicit and approved |
| Run 1 | `manual_production`; `completed_no_new_articles`; zero RSS/cohort articles | V01 evidence | Yes | Preserve for no-work behavior analysis |
| Run 2 | `scheduled_production`; `failure_state_assigner_circuit_breaker`; cohort 1,584 | V01 evidence | Yes | Preserve for stage-contract design |
| Run 3 | `scheduled_production`; failed during semantic status polling; cohort 1,657 | V01 evidence | Yes | Preserve for transport-failure analysis |
| Run 4 | `scheduled_production`; failed after `ECONNRESET` and cancellation; cohort 1,562 | V01 evidence | Yes | Preserve with job IDs and source revision |
| Run 5 | `scheduled_production`; completed; cohort three | V01 evidence | Yes | Preserve as a baseline, not proof of reliability |
| Current-stage field | Every row records `reporting`, including failures | V01 reporting defect | Yes | Add immutable failure-origin data in the replacement |
| Historical data effects | Cleanup, deletion, ingestion, semantic contracts, state attempts, and AI results may persist | Mixed shared and V01 effects | Yes | Do not attempt automatic reversal without a vetted data plan |

Numeric run IDs are not sufficient global identities. Evidence should include host, database lineage, start time, mode, and source revision.

### Operator disposition summary

| Group | Recommended disposition before revert | Reason |
|---|---|---|
| Enabled V01 production timer | Disable before the next trigger if no further V01 run is desired | A Git revert does not stop the installed schedule |
| V01 service, timer, publisher, helper, sudoers, and environment | Retain until evidence is copied; then review for archival or removal | These survive Git and can invoke removed or reverted source |
| Shared API, portal, workers, and database | Retain | They are not V01-only assets |
| V01 durable schema and rows | Export or preserve until the replacement migration decision is approved | They contain incident and baseline evidence |
| Backups, JSONL, staged alert, and journal excerpts | Preserve under an explicit retention policy | They are required to interpret historical effects and failures |
| Lock file | Review after V01 schedule and service are retired | It survives Git and is safe to remove only when unused |
| Older db-manager units | Review separately | Their purpose and lifecycle are not established by V01 evidence |

## Open Questions

### 1. Exact semantic cohort

Should semantic scoring process only RSS-added article IDs, or may a separately named backlog operation process older eligible articles?

#### Operator Response

### 2. Partial-success thresholds

Which semantic skips, state failures, and zero-eligibility outcomes may advance automatically, and which require operator intervention?

#### Operator Response

### 3. Destructive approval gate

Should every production cycle require operator approval before cleanup and deletion, or only the first cycle and configuration changes?

#### Operator Response

### 4. V01 timer disposition

Should the enabled V01 production timer be disabled immediately after preservation to prevent another run before the revert?

#### Operator Response

### 5. V01 database schema

Should `WeeklyArticleFlowRuns` remain as historical evidence, be exported and removed, or migrate into the replacement flow's durable model?

#### Operator Response

### 6. Backup restore policy

What restore test and retention policy must be satisfied before destructive production stages are approved?

#### Operator Response
