---
created_at: 2026-08-31T22:39:54Z
updated_at: 2026-08-31T22:39:54Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Plan V01

## 1. Plan Basis

This plan implements `docs/20260829_weekly_article_processing_cron_prd_v03.md`.

The implementation creates a new completion-driven weekly article flow. It does not restore the removed legacy orchestrator or AI Approver V01. AI Approver V02 remains the only approver workflow.

The flow spans these packages:

1. `db-models` owns authoritative run and cohort relationships.
2. `db-manager` owns destructive maintenance and verifiable backups.
3. `worker-node` owns RSS, semantic scoring, and state assignment jobs.
4. `worker-python` continues to own AI Approver V02.
5. `ops/weekly-article-flow` owns sequencing, recovery, reporting, alerts, and production scheduling assets.

Development and review begin on macOS. Runtime validation occurs manually on Ubuntu dev. No schedule is installed or enabled outside production.

## 2. Implementation Architecture

Add a private TypeScript package at `ops/weekly-article-flow`. Its compiled coordinator runs as `limited_user` and imports `@newsnexus/db-models` for authoritative state.

The coordinator communicates with worker-node and worker-python through their existing internal HTTP routes. It starts jobs, stores returned IDs, polls existing queue-status routes, validates terminal results, and requests cancellation when a timeout or run-wide stop occurs.

Shell remains limited to:

- acquiring a nonblocking `flock`
- loading an allowlisted environment file
- starting the compiled coordinator
- wrapping manual development modes
- installing or removing source-controlled systemd assets

The subsystem uses focused modules:

- `src/config`: typed environment and mode resolution
- `src/database`: run creation, transitions, cohort queries, and recovery reads
- `src/http`: bounded worker clients and response validation
- `src/contracts`: result schemas and terminal-reason classification
- `src/stages`: one stage implementation per workflow step
- `src/coordinator`: ordered execution, timeout control, and recovery
- `src/reporting`: JSONL event creation and redaction
- `src/alerts`: fixed-path staging and helper invocation

The package uses Jest with dependency-injected clocks, process runners, HTTP clients, and repositories. Tests do not call live AI services or production databases.

## 3. Authoritative Database State

### 3.1 WeeklyArticleFlowRun model

Add `db-models/src/models/WeeklyArticleFlowRun.ts` with the V03 fields and typed unions for mode and status. Store `stageResults` as JSONB with an empty-object default.

Register the model in:

- `_index.ts`
- `_associations.ts`
- `_loadOrder.ts`

Add these indexes:

- status
- scheduled time
- creation time
- a PostgreSQL partial unique index permitting only one `pending` or `running` row

The database uniqueness rule closes the race between the application active-run query and run creation. A uniqueness conflict becomes a normal `active_run_exists` refusal.

### 3.2 NewsApiRequest cohort field

Add nullable `weeklyArticleFlowRunId` to `NewsApiRequest` with a default of `null`.

Create both associations:

- one weekly run has many news API requests
- each news API request optionally belongs to one weekly run

The foreign key uses `ON DELETE RESTRICT`, and its indexed nullable column preserves all existing manual and unrelated ingestion paths.

Place `WeeklyArticleFlowRun` before `NewsApiRequest` in backup and restore load order. This allows a future restore to satisfy the new relationship without disabling foreign keys.

### 3.3 Additive schema installer

Follow the existing AI Approver V02 installer pattern with an idempotent weekly-flow schema installer in db-manager.

The installer:

- initializes current models
- creates the run table when absent
- adds the nullable request column when absent
- installs indexes and the restrictive foreign key
- verifies existing definitions before retaining them
- refuses incompatible tables, columns, indexes, or constraints
- never rewrites historical `NewsApiRequests` rows

Expose a dedicated db-manager package script. Schema installation remains a separately invoked deployment step rather than an implicit `sync({ alter: true })` operation.

## 4. Persisted Run and Recovery Contract

### 4.1 Stage state

Each `stageResults` entry has a stable schema:

- stage status: `not_started`, `running`, `completed`, `skipped`, or `failed`
- attempt number
- start and end timestamps
- worker job or V02 run ID when applicable
- accepted ending reason
- counts and unresolved IDs
- command output summary or verified artifact metadata
- recovery evidence when completion was reconstructed

The coordinator writes `running` before starting external work and writes the terminal stage result only after validating its postconditions.

### 4.2 New run and resume

A normal invocation creates a new `pending` row after preflight and moves it to `running` before the first mutation.

A resume invocation names an existing run ID. It never creates a replacement run. It verifies host, database, source revision compatibility, mode, current stage, and the absence of a conflicting worker job before proceeding.

Recovery behavior is stage-specific:

- completed stages are skipped from persisted evidence
- a running worker stage is reattached through its stored job ID
- a terminal worker job is validated and recorded before continuing
- duplicate cleanup is reconciled by its zero-row postcondition
- backup is reconciled only from one uniquely identified, valid post-start archive
- old-article deletion uses its recorded result or an explicit database postcondition before continuation
- an accepted V02 preview or run is reattached and never automatically duplicated
- unresolved evidence stops the run for operator reconciliation

The destructive-recovery test mode injects interruption points immediately after each destructive stage has persisted successful evidence. Separate tests cover ambiguous `running` records and prove that they cannot be treated as successful without reconciliation.

### 4.3 Timeouts and cancellation

One run-level deadline is calculated from `startedAt`. Every stage deadline is capped by the remaining 72-hour run budget.

When a deadline expires, the coordinator:

1. requests cancellation through the correct worker route when supported
2. terminates a coordinator-owned child process group when applicable
3. waits a bounded cancellation grace period
4. records the active stage and cancellation outcome
5. transitions the run to `timed_out`

The semantic scorer retains its four-hour stage timeout. The systemd service uses 73 hours, leaving one hour for the coordinator to persist its own terminal state first.

## 5. Db-Manager Maintenance Contracts

### 5.1 Duplicate-analysis cleanup

Add `--clear_duplicate_analyses` to db-manager's parser and execution order before backup.

The cleanup module:

- counts rows first
- selects primary keys in bounded batches
- deletes only those keys
- records each batch result
- verifies the final count is zero
- preserves the table, schema, indexes, constraints, and sequence

The command emits a final machine-readable JSON summary to stdout while keeping normal Winston logs. The coordinator parses only that final contract and independently verifies the zero-row postcondition.

### 5.2 Backup manifest

Extend `createDatabaseBackupZipFile` to build a versioned `manifest.json` before archiving.

The manifest enumerates every registered Sequelize model, including empty models. Each entry contains:

- model and CSV filename
- row count
- byte size when a CSV exists
- SHA-256 when a CSV exists

Positive-row models have exactly one CSV. Zero-row models have no data CSV. The backup command returns a machine-readable summary containing the archive path and manifest version.

The coordinator verifies the ZIP, manifest membership, row-count rules, file sizes, per-file hashes, absence of extra CSV files, zero duplicate-analysis rows, and at least one nonempty model. It then computes and persists the ZIP checksum.

### 5.3 Old-article deletion

Keep the existing default 180-day behavior and invoke exactly:

```bash
npm start -- --delete_articles
```

Extend the command's final machine-readable summary to expose found count, deleted count, cutoff date, and success. The coordinator stores the summary and requires exit code `0` before RSS.

The JSON summary contains no credentials or article content. Existing interactive and logged behavior remains compatible.

## 6. Worker-Node Result Contracts

### 6.1 Shared result validation

Add typed result contracts near each job and reusable count helpers under worker-node's job modules.

Every result contains `schemaVersion`, `endingReason`, arrays representing each outcome, counts derived from those arrays, and a safe terminal message.

The coordinator validates responses independently. Unknown schema versions, duplicate IDs across mutually exclusive outcomes, inconsistent counts, or selected IDs missing from all terminal categories produce `failed_worker_result_contract`.

Partial results are persisted before a handler returns or throws. This preserves diagnostic evidence when a job is canceled or fails after selecting articles.

### 6.2 Google RSS cohort propagation

Extend `POST /request-google-rss/start-job` with optional `weeklyArticleFlowRunId`.

At the route boundary:

- accept only a positive integer
- load the run from Postgres
- require `pending` or `running` status
- reject a missing or terminal run
- omit the field entirely for existing callers

Propagate the validated ID through the RSS job context into every `NewsApiRequest` created for that job. Do not introduce headers or reuse any removed legacy name.

Preserve the existing `GoogleRssJobResult` and add the common schema fields without removing current query reporting. Route and job tests cover every V03 ending reason by execution mode.

After accepted completion, the coordinator queries distinct article IDs through `NewsApiRequests.weeklyArticleFlowRunId` and `Articles.newsApiRequestId`. The distinct count must equal `articlesAddedCount` before downstream work.

### 6.3 Semantic scorer results

Refactor semantic processing to return `SemanticScorerJobResult` while preserving its normal eligibility query and optional range behavior for existing callers.

The weekly coordinator supplies no ID range. The result separates:

- selected article IDs
- successfully scored article IDs
- deterministic skips such as `no_usable_text`
- failures from timeout, scoring, or persistence
- unattempted IDs after cancellation or stage failure

One article belongs to exactly one terminal outcome. Per-article failures remain accepted stage completion when the queue itself finishes normally.

The handler calls `updateResult` with the derived result. File-based progress markers remain for compatibility but are not coordinator authority.

### 6.4 State assigner results and breaker

Change `processStateAssignmentsWithTimeout` to return a structured processing result rather than `void`.

The processor maintains a consecutive-failure counter inside its article loop:

- timeout, analysis error, and persistence error increment it
- a persisted assignment resets it to zero
- cancellation does not masquerade as an article failure
- the fifth consecutive failure stops selection processing
- all remaining selected IDs become unattempted

The result reports `maximumConsecutiveFailures` and `circuitBreakerTripped`. The queue handler persists it through `updateResult`.

The coordinator supplies exact cohort IDs through existing `articleIds` targeting and a capacity at least equal to `articlesAddedCount`. A tripped breaker maps to `failure_state_assigner_circuit_breaker`; one to four isolated terminal failures remain visible but do not stop the weekly flow.

## 7. Coordinator Execution Flow

### 7.1 Lock and preflight

`bin/run-weekly-flow` acquires a fixed absolute lock file with nonblocking `flock`. The TypeScript coordinator then checks the partial database lock before creating or resuming a run.

Preflight validates:

- mode-specific database and host allowlists
- repository path and source revision
- required service account and writable paths
- worker-node and worker-python health and idle queues
- absence of an active V02 execution
- RSS spreadsheet, semantic workbook, state files, and active V02 prompt
- Playwright and Codex availability
- disk space for backup and JSONL output
- fixed worker base URLs and timeout configuration
- mode-specific confirmation and live-AI permission

Development modes refuse production database identities. Production modes refuse development identities.

### 7.2 Ordered stages

The coordinator executes one stage at a time:

1. duplicate-analysis cleanup
2. verified database backup
3. default old-article deletion
4. Google RSS
5. semantic scorer
6. state assigner
7. AI Approver V02 preview
8. AI Approver V02 execution
9. reconciliation and reporting

`dev_canary` persists the first three stages as skipped. `dev_destructive_recovery` enables them only after the expected development database name is supplied through the explicit confirmation option.

If accepted RSS completion produces zero added and zero cohort articles, the coordinator records `completed_no_new_articles` and does not enqueue analysis jobs.

### 7.3 RSS ending reasons

Implement the V03 mode matrix as code rather than scattered conditional checks.

- `queries_exhausted` is accepted everywhere.
- `target_articles_collected` is accepted in canary and only in destructive development when a small target was configured.
- production rejects any configured target.
- `rate_limited` maps to `failure_rss_rate_limited` with no downstream analysis.
- `error` maps to `failed`.
- `canceled` and `aborted` map to `canceled` with the reason retained.

Resume after rate limiting is operator initiated. The coordinator rechecks the RSS job, cohort, and repeat-window implications before any resubmission.

### 7.4 AI Approver V02

Call worker-python directly over its allowlisted internal URL.

Create the preview with:

- `selectionMode = article_position_count`
- `requestedArticleCount = articlesAddedCount`
- `allowDescriptionFallback = true`
- `allowPastApprovedBoundary = true`

Persist the V02 draft ID, expiry, planned count, frozen selected IDs, cohort overlap IDs, overlap count, and overlap percentage. The preview token remains only in coordinator memory long enough to accept the draft and is never placed in Postgres stage results, JSONL, or logs.

Overlap is visibility-only. Any overlap percentage may proceed because the RSS-added count sizes the request while V02's normal eligibility queue determines the frozen selection.

After acceptance, persist the V02 run and queue IDs. Poll both the queue record and V02 run until their states agree on a terminal result. Query V02 predictions by run ID to derive exact terminal article IDs and unattempted frozen IDs.

Only accepted V02 completion allows the weekly run to complete. Any other V02 terminal failure maps to `failure_ai_approver_v02`, except explicit cancellation and the run-wide timeout.

## 8. Reporting and Alerts

### 8.1 JSONL journal

Append one schema-versioned JSON object per state transition under:

```text
/home/limited_user/project_resources/NewsNexus12/weekly-flow/
```

Use UTC timestamps and the V03 filename. Open in append mode, write one complete line, flush, and close for every event.

A central redaction function rejects known secret keys and preview tokens. Records contain identifiers, counts, reasons, and paths but no article content or environment values.

JSONL failures are recorded as reporting failures without rewriting a successful authoritative workflow result.

### 8.2 Scoped NickVault helper

Install a root-owned oneshot systemd service and root-owned helper with fixed source and destination paths.

The helper runs its operational body as `nick`:

1. sync `/home/nick/NickVault`
2. validate the fixed staged alert is a regular file
3. atomically publish `ALERT-newsnexus12-weekly-cron.md` at the vault root
4. sync again

Allow `limited_user` to start only that exact oneshot service through a narrow sudoers rule. It cannot supply command, path, or environment arguments.

The coordinator writes alerts atomically to the fixed staging location. Helper or sync failure becomes an operator-visible reporting failure and remains in journald and JSONL.

## 9. Systemd and Installation

Source-control these production assets:

- `newsnexus12-weekly-article-flow.service`
- `newsnexus12-weekly-article-flow.timer`
- the alert-publisher oneshot service
- the fixed alert helper
- installer and uninstaller scripts

The weekly service:

- runs as `limited_user:limited_user`
- uses `/home/limited_user/applications/NewsNexus12`
- invokes the production wrapper with absolute paths
- uses `TimeoutStartSec=73h`
- sends output to journald
- receives secrets only from a root-managed environment file

The timer uses `OnCalendar=Fri *-*-* 05:00:00 America/Los_Angeles`, `Persistent=true`, and the fixed service name. The installer can copy and validate the unit without enabling it.

Development wrappers refuse timer installation. Production installation leaves the timer disabled until the supervised production run succeeds and the operator authorizes activation.

The uninstaller disables only units owned by this subsystem and removes their installed copies. It does not delete JSONL, alerts, database records, or unrelated schedules.

## 10. Configuration Contract

Provide a committed `.env.example` with no secrets.

Configuration includes:

- execution mode
- repository and resources paths
- development and production host/database allowlists
- worker-node and worker-python base URLs
- lock path
- backup directory
- alert staging path and helper service name
- stage and run timeouts
- polling interval and bounded backoff
- development RSS target
- minimum free disk space

The parser rejects unknown modes, relative paths, malformed URLs, overlapping development and production database identities, and timeout values outside documented safety ranges.

Command-line options select only mode, resume run ID, development confirmation, small canary target, and explicit live-AI permission. They cannot override service URLs, database credentials, SQL, or arbitrary paths.

## 11. Verification Strategy

### 11.1 Shared models and db-manager

Build db-models first and verify exports, associations, load order, nullable defaults, foreign-key restrictions, and the single-active-run index through installer tests.

Db-manager tests cover:

- CLI parsing and ordering
- bounded duplicate cleanup and zero-row verification
- preservation of table structure and sequence
- manifest entries for every registered model
- empty and nonempty model behavior
- missing, extra, corrupt, and mismatched CSV files
- manifest and ZIP checksums
- structured command summaries
- backup import compatibility with the new run table and request field

### 11.2 Worker-node

Extend existing Jest suites for route compatibility and job processing.

Coverage includes:

- optional RSS run ID validation and propagation
- unchanged manual RSS behavior
- every RSS ending reason
- semantic score, deterministic skip, timeout, scoring failure, persistence failure, cancellation, and unattempted outcomes
- state success, timeout, analysis failure, persistence failure, cancellation, and unattempted outcomes
- success resetting the breaker
- the fifth consecutive failure stopping processing
- result persistence and count reconciliation

Run worker-node tests and build after db-models is rebuilt and its local package dependency is refreshed.

### 11.3 Coordinator

Unit and integration-style tests use fake workers and a disposable Postgres database where database behavior matters.

Coverage includes:

- mode and preflight safety
- both active-run locks
- stage order and skip rules
- queue polling and cancellation
- mode-specific RSS classification
- cohort reconciliation
- malformed result rejection
- four-hour semantic timeout
- Mode A request construction and visibility-only overlap
- V02 dual-terminal reconciliation
- restart attachment and destructive non-repetition
- 72-hour timeout preceding the service timeout
- JSONL redaction and atomic alert staging
- unavailable alert helper and sync failures

### 11.4 Ubuntu development

Deploy source and install schema on Ubuntu dev without copying or enabling timer units.

Run `dev_canary` manually with destructive stages disabled, a small RSS target, and separately approved live AI access. Verify the exact cohort, normal semantic backlog, cohort-scoped state assignment, Mode A V02 request, Postgres state, queue results, and JSONL.

Run controlled state-assigner failures to prove timeout counting, counter reset, and the five-failure breaker.

Run `dev_destructive_recovery` against the confirmed disposable database. Interrupt and resume after cleanup, backup, and deletion. Corrupt backup fixtures to prove verification blocks deletion.

Confirm there is no weekly timer, service trigger, cron entry, or next scheduled execution on the development host.

## 12. Production Rollout and Rollback

Production rollout remains operator gated:

1. install the additive schema
2. install service and timer files without enabling the timer
3. validate permissions, environment, worker health, paths, helper, and timezones
4. run one supervised `manual_production` flow
5. verify Postgres, manifest, JSONL, journald, V02 results, and alert handling
6. disable the old standalone RSS schedule
7. enable the new timer after explicit approval
8. monitor four successful scheduled runs

Application rollback disables the new timer and service, restores the prior code revision, and leaves additive database columns and run records in place. The nullable field and new table do not affect old callers.

If the schema itself must be removed later, that is a separately approved destructive migration after confirming no retained backups or code depend on it.

Rollback never re-enables the retired standalone RSS schedule automatically.

## 13. Completion State

The implementation is complete when one source-controlled coordinator safely executes the V03 sequence, recovery never blindly repeats accepted work, exact RSS cohorts are queryable, worker outcomes are structured and reconcilable, V02 uses the RSS-added count without overlap gating, and Ubuntu dev proves both canary and destructive recovery behavior.

Production completion additionally requires a successful supervised manual run, retirement of the standalone RSS schedule, explicit timer activation, and verified Friday 5:00 AM Pacific scheduling.

This is a multi-package, operationally sensitive change. It requires a phased task-style todo after this plan reaches agreement under `plan-and-vet`.
