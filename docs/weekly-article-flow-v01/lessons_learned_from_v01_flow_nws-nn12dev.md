---
created_at: 2026-09-30T21:38:54Z
updated_at: 2026-09-30T21:38:54Z
created_by: hermes (gpt-5.6-sol) nws-nn12dev
modified_by: hermes (gpt-5.6-sol) nws-nn12dev
---

# Lessons Learned from V01 Flow on nws-nn12dev

## Host and evidence scope

- Host: `nws-nn12dev`.
- Inspection time: `2026-09-30T21:36:55Z` through `2026-09-30T21:38:54Z`.
- Checked-out revision: `61a5ec02653c7ffc2d1c25c731efaff138ab23c3`.
- Fetched branch revision: `origin/dev_32_weekly_cron_fix_02` at `ac47503692fb02883d15fe3da45bb9b700de1ce6`.
- The checked-out branch was three commits behind after fetch. It was not pulled or reset for this documentation task.
- The worktree already contained a modified `package-lock.json` and an untracked `ops/weekly-article-flow/systemd/nws-nn12dev-drill/` directory. Neither was changed.

Local evidence inspected read-only:

- `WeeklyArticleFlowRuns` and `ArticleDuplicateAnalyses` in the development `newsnexus_prod` database.
- Durable run `4`, jobs `0020`, `0021`, and `0022`.
- The development drill service and timer definitions and journal.
- Installed NewsNexus12 unit states and timer states.
- Weekly-flow environment variable names and nonsecret paths.
- Backup, JSONL, alert, lock, and operator-log locations.
- Git history for the weekly run model and `ops/weekly-article-flow`.

Retained reports supplied cross-host and earlier development evidence:

- [Production run 4 failure report](20260929_weekly_article_flow_run_4_failure_report.md)
- [Run 4 connection reset investigation](20260929_run_4_connection_reset_investigation.md)
- [Development run 4 resume reproduction](20260929_nws-nn12dev_weekly_article_flow_run_4_resume_reproduction_report.md)
- [Production run 5 success report](20260930_weekly_article_flow_run_5_success_report.md)

Evidence limitations:

- The precise producer and socket path of production run 4's TCP reset remain unproven.
- The `limited_user` crontab could not be read without additional authorization.
- No packet capture, Undici socket trace, historical GC trace, or historical PostgreSQL statement timing exists for the production reset.
- Current database run IDs cannot be treated as globally unique across database replacement or restoration.

## What worked

### Durable stage evidence

Durable records preserved stage timing, source revision, job IDs, counts, paths, and nested failures. This was substantially more useful than relying on systemd exit status or queue lifecycle status alone.

The current development run `4` recorded:

| Stage | Result |
|---|---|
| Duplicate cleanup | Completed; zero rows found or deleted |
| Backup | Completed; ZIP path, size, and SHA-256 retained |
| Old-article deletion | Completed; 3,731 rows deleted |
| Google RSS | Job `0020` completed; three articles added |
| Semantic scorer | Job `0021` completed; 143 selected, 10 scored, 133 skipped, zero failed |
| State assigner | Job `0022` queue completed; three selected, zero successful, three failed |
| AI Approver V02 preview | Failed with `no_eligible_articles` |
| Reporting | Failed while publishing the alert |

### Interruption protection and resume

The retained development report showed that interrupting a run during backup left a durable active run. A fresh invocation was rejected with `active_run_exists`, and `--resume-run-id 4` reattached to the existing run.

This behavior prevented a second authoritative run from starting. It should be preserved, but resume must revalidate completed side effects and current external state before continuing.

### Semantic execution could complete

Development exercised the same global semantic-selection path without reproducing the production `ECONNRESET`. The retained report observed materialization of 257,061 Articles rows and 256,927 semantic contract rows before filtering.

The current development run also completed its semantic queue job. These successes show that the scorer can complete, not that the global query or transport behavior is reliable.

### Backups and stage ordering

The coordinator created a verifiable database backup before deletion. The current run retained the archive path, byte size, SHA-256, and manifest version.

The intended order was enforced: cleanup, backup, old-article deletion, RSS, semantic scoring, state assignment, AI Approver V02, and reporting.

### Failure evidence remained inspectable

The current failed run remained terminal and retained its originating AI Approver preview error. The journal independently confirmed the drill service failed rather than silently succeeding.

The retained production reports similarly preserved run 4 as failed instead of rewriting it after a later manual semantic job succeeded.

## Problems and causes

### Semantic work was not limited to the weekly cohort

Trigger:

- The coordinator started semantic scoring without explicit article IDs or ID bounds.

Observed behavior:

- A weekly cohort of three still caused global contract and Article loading.
- The current development run selected 143 semantic candidates while RSS added only three articles.

Operator impact:

- Runtime, memory, and transport risk were driven by global backlog rather than the new weekly cohort.
- Counts could look plausible without proving that the intended articles were processed.

Cause:

- Eligibility filtering occurred after broad ORM materialization in worker-node instead of through an exact cohort query or database anti-join.

Evidence:

- The retained development report traced the source path and measured the global row counts.
- Production run 5 measured event-loop delay above six seconds during semantic selection.

### One observation failure canceled active work

Trigger:

- Production run 4 received one `ECONNRESET` while polling semantic job `0267`.

Observed behavior:

- The coordinator immediately canceled the job.
- All 1,705 selected articles remained unattempted.

Operator impact:

- A transient inability to observe status became a business-stage failure.
- The resulting canceled queue record could be mistaken for an algorithm failure.

Confirmed cause:

- V01 polling had no bounded retry policy for transient transport failures. Its worker-stage error handler canceled after the first failed status request.

Unresolved mechanism:

- Large ORM materialization strongly correlates with event-loop delay.
- A keep-alive or pooled-socket race is plausible, but the endpoint that emitted the reset was not proven.

### Queue completion did not mean business success

The current development state-assigner job reached queue status `completed`, but all three selected articles recorded `analysis_error`. It produced zero successful state assignments.

The retained report linked those failures to unsupported model `gpt-5.4-mini` under the configured Codex ChatGPT account. AI Approver V02 then found no eligible articles.

A replacement must validate result counters and accepted outcomes, not only queue state.

### Count-based targeting was insufficient

The proposed state-assignment requirement says to process at least the number of articles collected. A count does not establish identity.

Processing three old backlog articles would satisfy a numeric limit while leaving the three newly collected articles untouched. Every downstream stage needs explicit article-ID cohort evidence.

### Partial outcomes were easy to misread

The current semantic job completed while scoring only 10 of 143 selected articles. The other 133 were explicit `no_score_result` skips.

Production run 5 similarly completed with four scored and 136 skipped. A terminal `completed` state therefore needs stage-specific acceptance thresholds and skip-reason review.

### Failure attribution was obscured

Durable `currentStage` became `reporting` during failure finalization. That did not identify the business stage that failed.

Operators had to inspect nested stage evidence to distinguish semantic, state, AI Approver, and alert failures. A separate immutable `failedStage` or terminal-origin field is needed.

### Alert publication conflicted with service security

The drill service used `NoNewPrivileges=true`, while the application attempted `sudo systemctl start` for a root-owned publisher.

The journal recorded the no-new-privileges failure. Another development invocation recorded `sudo: a password is required` outside that service context.

The installed publisher unit points to `/usr/local/libexec/newsnexus12-publish-weekly-alert`, but that executable was absent during inspection. Alert staging was therefore not equivalent to alert delivery.

### Run IDs were not durable global identities

The retained development report described run `4` beginning at `2026-09-29T20:37:11Z` in `manual_production` mode.

Current database row `4` began at `2026-09-30T01:29:35Z` in `dev_destructive_recovery` mode. The development drill journal also recorded another run `4` at `2026-09-29T22:18Z`.

Database replacement or restoration can reuse numeric IDs. Evidence should identify a run by host, database lineage, run ID, start time, mode, and source revision.

### Git rollback would leave host and data state behind

A Git revert does not remove installed units, timers, environment files, backups, JSONL evidence, locks, database tables, or data mutations.

The development host still has V01-specific drill and alert units, a protected weekly environment file, durable run rows, backup archives, and external evidence paths.

### Scheduler state was non-obvious

The one-time drill timer was disabled as a unit file but remained `active (elapsed)`. It had no future trigger.

The drill service was disabled and failed. The standard production weekly service and timer were not installed on this host.

Enabled, active, elapsed, failed, and next-trigger state must be reported separately.

## Fixes and remaining uncertainty

### Verified behavior

- Active-run protection and resume worked in the retained development exercise.
- Backup metadata and hashes were durably recorded.
- Semantic diagnostics later measured substantial event-loop delay.
- Production run 5 completed end to end once, including alert reporting.
- Development semantic jobs completed without reproducing the production reset.

### Attempted or deployed diagnostics

Revision `61a5ec02653c7ffc2d1c25c731efaff138ab23c3` aligned worker diagnostics with queue cancellation. Production run 5 used the same revision and recorded event-loop delay, process memory, model initialization time, and status latency.

These diagnostics support an event-loop-stall hypothesis. They do not identify the sender of the earlier TCP reset or prove the keep-alive race.

### Not verified as fixed

- Transient status polling still needs a demonstrated bounded retry and reconciliation policy.
- Exact semantic cohort targeting was not demonstrated.
- State assignment completed with zero successful analyses on development.
- AI Approver eligibility failed for the three-article cohort.
- Alert delivery remained broken on development.
- The current alert helper executable was absent.
- One successful production run does not establish scheduler reliability.

### Historical evidence boundary

Recommendations in the retained reports are not completed fixes. Any future implementation should prove each change through focused tests and a supervised nonproduction run before scheduling production.

## Requirements for the Weekly Combined Flow

### Preserve the business order

The replacement should preserve this order:

1. Clear `ArticleDuplicateAnalyses` rows while retaining the schema.
2. Create and verify a database backup.
3. Delete old articles under the approved policy.
4. Collect Google RSS articles.
5. Semantically score the exact collected cohort.
6. Assign state to the exact eligible collected cohort.
7. Run AI Approver V02 for all eligible collected articles.
8. Reconcile exact IDs and publish a verified report.

### Add an operator-controlled destructive gate

Before duplicate cleanup or article deletion, present a concise preview containing:

- host, database, schema, and source revision;
- active prompt and model configuration names;
- delete cutoff and estimated row count;
- backup destination and available disk;
- RSS workbook identity and query count;
- installed schedule state;
- expected stage timeouts and stop conditions.

The operator should explicitly approve the first real production cycle after reviewing this preview. `manual_production` must not be described as a dry run.

### Use exact cohort identity

Persist the RSS-added article IDs as the authoritative cohort. Pass those IDs, or a durable cohort identifier resolving to those IDs, to every downstream stage.

Do not use a numeric limit as a substitute for identity. Reconciliation should compare selected, attempted, successful, skipped, failed, and unattempted ID sets against the authoritative cohort.

### Define stage acceptance contracts

Each stage should define:

- accepted terminal queue states;
- required business-result fields;
- allowed skip reasons and thresholds;
- allowed failure and unattempted counts;
- no-work behavior;
- timeout and cancellation policy;
- exact evidence needed before advancing.

A queue status of `completed` must not automatically satisfy the stage contract.

### Make observation resilient

Retry safe status `GET` requests for bounded transient transport failures and retryable HTTP status codes. Use exponential backoff with jitter inside the stage deadline.

After connectivity returns, reconcile the same job ID. Do not resubmit ambiguous start requests automatically. Cancel only for an expired deadline, explicit operator cancellation, or another documented terminal policy.

### Make interruption and resume explicit

Persist stage input, exact job ID, output, and side-effect evidence before advancing. On resume, verify prior side effects rather than repeating backup, deletion, ingestion, or model work blindly.

A continuation should link to its source run. Terminal historical runs should remain immutable.

### Control semantic resource use

Move semantic eligibility filtering into PostgreSQL or use an exact cohort query. Avoid loading all Article and contract rows into Node.js.

Cache shared keyword embeddings per job. Record query, hydration, filtering, model initialization, scoring, event-loop delay, memory, and GC timing separately.

### Validate runtime model compatibility

Preflight should test that the configured state-assignment and AI Approver models are available to the actual systemd service users and authentication modes.

A successful CLI invocation as `nick` does not prove that `limited_user` can run the same model noninteractively.

### Treat alert delivery as a stage

Use a privileged handoff compatible with `NoNewPrivileges=true`, or adopt another reviewed mechanism that does not depend on in-service privilege escalation.

Success requires delivery confirmation, not only staging a file or starting a helper unit. Alert failure should never overwrite the originating business failure.

### Separate failure origin from reporting

Persist `failedStage`, failure class, and original error separately from final reporting status. Distinguish coordinator, transport, worker lifecycle, per-article analysis, configuration, reconciliation, and alert failures.

### Define no-new-article and partial-success behavior

Specify whether zero new articles ends as `completed_no_new_articles` and which later stages are skipped.

Specify whether semantic skips, state-analysis failures, or zero AI Approver eligibility are accepted, partial, or failed outcomes. The report should explain the business meaning, not only lifecycle state.

### Verify backup and recovery

Require a completed archive, byte size, SHA-256, manifest validation, and a documented restore test policy before destructive steps are considered protected.

A created ZIP is not sufficient evidence that restoration will work.

### Separate code rollback from host cleanup

Before reverting, create an operator-approved disposition list for:

- V01 database schema and durable rows;
- installed services and timers;
- protected environment files;
- sudoers and helper executables;
- locks, alerts, logs, JSONL, and backups;
- source-controlled and untracked drill assets.

Do not remove evidence needed to interpret historical runs.

### Gate scheduler activation

Install and statically verify the replacement timer separately from running the first production cycle. Confirm the next trigger is in the future and in the intended timezone before enabling it.

Avoid accidental immediate runs from persistent timers after a missed schedule. Require several successful supervised cycles before treating scheduling as reliable.

## Host Inventory

### Services and schedules

| Item | State at inspection | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `newsnexus12-weekly-article-flow-nws-nn12dev-drill.service` | Installed at `/etc/systemd/system`; disabled; failed; user `limited_user`; no drop-ins | V01 development drill | Yes | Retain until evidence collection and operator review finish, then remove or archive through a separately approved host-cleanup task |
| `newsnexus12-weekly-article-flow-nws-nn12dev-drill.timer` | Installed; disabled; `active (elapsed)`; last trigger `2026-09-29T22:18:09Z`; no next trigger | V01 development drill | Yes | Review and remove with the drill service after preservation; it is not a recurring production schedule |
| `newsnexus12-publish-weekly-alert.service` | Static, inactive; root-owned execution context; no drop-ins | V01 alert handoff | Yes | Review before reuse; its configured executable was absent |
| `/usr/local/libexec/newsnexus12-publish-weekly-alert` | Missing | V01 alert helper | N/A | Do not claim alert publication is deployable until the helper and permission model are verified |
| Standard weekly service and timer | `newsnexus12-weekly-article-flow.service` and `.timer` not installed | Production-style V01 schedule | N/A on this host | Do not install during rollback or documentation work |
| Runtime app services | API, portal, worker-node, and worker-python active but unit files disabled; all run as `limited_user` | Shared application runtime | Yes | Retain; do not treat them as V01-only |
| `newsnexus12-db-manager.timer` | Unit file enabled but timer inactive; no next trigger shown | Older/shared maintenance, ownership uncertain | Yes | Review separately; do not remove merely because V01 is reverted |
| Nick crontab | No crontab | Host user | Yes | No action |
| `limited_user` crontab | Unverified because reading it required a password | Host user | Yes | Verify during an authorized host-cleanup review |
| Relevant `/etc` search | Weekly references found in systemd units and `/etc/newsnexus12/weekly-article-flow.env`; no cron entry was found by the readable search | Host configuration | Yes | Recheck with root access before declaring cron empty |

### Configuration and permissions

| Item | Observation | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `/etc/newsnexus12/weekly-article-flow.env` | `root:limited_user`, mode `0640` | V01 host configuration | Yes | Retain through preservation, then review for secure archival or removal |
| Repository `ops/weekly-article-flow/.env` | `nick:limited_user`, mode `0640` | V01 repository-local configuration | Removed only if the chosen Git history removes it | Never copy secrets into preserved documentation |
| Drill service unit | `nick:limited_user`, mode `0644`; `NoNewPrivileges=true`; 73-hour timeout | V01 host configuration | Yes | Review and remove separately after evidence preservation |
| Drill timer unit | `nick:limited_user`, mode `0644`; one-time UTC trigger; `Persistent=false` | V01 host configuration | Yes | Remove separately after operator approval |
| Alert publisher unit | `nick:limited_user`, mode `0644`; runs as root | V01 host configuration | Yes | Redesign privilege handoff before reuse |
| Worker endpoints | Node `127.0.0.1:8003`; Python `127.0.0.1:8004` | Shared runtime contract | Yes | Revalidate from the actual service identity in any replacement flow |
| Database target | `localhost:5432/newsnexus_prod`, schema `public`, app role `newsnexus_app` | Shared development database | Yes | Treat as real mutable development data, not a disposable test database |
| Weekly environment variables | Paths, endpoints, timeouts, poll settings, disk floor, RSS target, PostgreSQL names, and AI preview TTL are present | V01 configuration schema | Yes | Build a reviewed replacement schema; fail closed on placeholders or missing values |
| Nick systemctl permissions | No weekly-flow or publisher entries were found in `/home/nick/nick-systemctl.csv` | Host operator permissions | Yes | Define least-privilege replacement permissions only after the service design is approved |

### Files and retained evidence

| Item | Observation | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `/home/limited_user/project_resources/NewsNexus12/weekly-flow/` | JSONL files for September 3, 4, 29, and 30 were observed; directory is group-controlled | V01 evidence | Yes | Preserve with host metadata before cleanup |
| Alert staging path | Durable evidence points to `ALERT-newsnexus12-weekly-cron.md`; direct observations of current presence were inconsistent | V01 evidence | Yes when present | Recheck and archive if present; do not rely on it as delivery proof |
| `/home/limited_user/project_resources/NewsNexus12/db_backups/` | Five observed ZIP backups, including three from September 29-30; recent files owned by `limited_user:limited_user`, mode `0660` | Shared backups containing V01 pre-delete evidence | Yes | Preserve until restore value and retention policy are reviewed |
| `/var/lock/newsnexus12-weekly-article-flow.lock` | Present, zero bytes, owned by `limited_user:limited_user`, mode `0664` | V01 runtime artifact | Yes | Remove only when no V01 process can use it and cleanup is approved |
| `/home/nick/weekly-flow-20260929-203909.log` | Present, owner `nick:nick`, mode `0664` | V01 development evidence | Yes | Preserve with the reports |
| `/home/nick/weekly-flow-resume-4-20260929-204219.log` | Present, owner `nick:nick`, mode `0664` | V01 development evidence | Yes | Preserve with the reports |
| Journald | Drill journal retained the AI Approver and alert failures | Host evidence | Yes until journal rotation | Export required excerpts before retention expires |
| Untracked drill source directory | Present before this task under `ops/weekly-article-flow/systemd/nws-nn12dev-drill/` | V01 source artifact | Not protected by Git | Decide whether to preserve it before any clean, reset, or checkout operation |

### Database state

| Item | Observation | Scope | Survives Git revert | Recommendation |
|---|---|---|---|---|
| `WeeklyArticleFlowRuns` | Four current rows; introduced by commit `d78e2557509787a0506cb8e55f51b634e9fef538` | V01-specific durable schema and evidence | Yes | Preserve or export before deciding whether to remove the model or table |
| `ArticleDuplicateAnalyses` | Existing shared table; zero rows during inspection | Pre-existing shared schema used destructively by V01 | Yes | Retain the table; require explicit approval before clearing rows |
| Sequelize migration metadata | No `public."SequelizeMeta"` table was found | Shared schema-management characteristic | Yes | Do not assume a Git revert automatically migrates schema backward |
| Current run `4` | `dev_destructive_recovery`; failed at AI Approver preview; source revision `61a5ec0`; three RSS cohort articles | V01 durable evidence | Yes | Preserve with timestamp and revision because numeric ID alone is ambiguous |
| Historical V01 data effects | Duplicate cleanup, backups, old-article deletion, RSS insertion, semantic contracts, state attempts, and AI results can persist | Mixed shared and V01 effects | Yes | Do not attempt automatic reversal without a separately vetted data plan |

## Open Questions

### 1. Exact semantic cohort

Should semantic scoring process only the RSS-added article IDs, or may it also drain an older backlog under a separately named and reported operation?

#### Operator Response

### 2. Partial-success thresholds

Which semantic skip reasons, state failures, and zero-eligibility outcomes should permit the flow to advance, and which should require operator intervention?

#### Operator Response

### 3. Destructive approval gate

Should every production cycle require operator approval before cleanup and deletion, or only the first cycle and configuration changes?

#### Operator Response

### 4. V01 host cleanup

After both lessons files are preserved, which V01 services, timers, environment files, locks, helpers, and external evidence should be retained, archived, disabled, or removed?

#### Operator Response

### 5. V01 database schema

Should `WeeklyArticleFlowRuns` remain as historical evidence after the code revert, be exported and removed, or be migrated into the replacement flow's durable run model?

#### Operator Response
