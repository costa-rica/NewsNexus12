---
created_at: 2026-08-31T22:46:56Z
updated_at: 2026-09-01T02:11:37Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Todo V02

## 1. Authority and Working Rules

This checklist implements:

- `docs/20260829_weekly_article_processing_cron_prd_v03.md`
- `docs/20260831_weekly_article_flow_plan_v01.md`

This version supersedes `docs/20260831_weekly_article_flow_todo_v01.md` and incorporates `docs/20260831_weekly_article_flow_todo_v01_assessment_codex.md`.

The new flow uses AI Approver V02 only. Do not restore AI Approver V01, the removed legacy orchestrator, its routes, headers, tables, locks, continuation code, or naming.

Implementation rules:

- [ ] Preserve unrelated working-tree changes and inspect the diff before staging each phase.
- [ ] Build `db-models` before testing or building packages that consume it.
- [ ] Fix every regression introduced by the phase before committing.
- [ ] Update this todo's `updated_at` and `modified_by` whenever checking tasks.
- [ ] Stage only the files belonging to the completed phase.
- [ ] Use a lowercase commit title of 50 characters or fewer.
- [ ] Give each phase commit a concise body referencing this todo and phase.
- [ ] Append `co-authored-by: codex (gpt-5.6-sol)` to commits produced from this work.
- [ ] Do not install a development schedule or enable any production timer without the explicit operator gate in the relevant phase.

## Phase 1: Shared Run and Cohort Schema

### Model contract

- [x] Add `db-models/src/models/WeeklyArticleFlowRun.ts`.
- [x] Define typed modes: `dev_canary`, `dev_destructive_recovery`, `manual_production`, and `scheduled_production`.
- [x] Define every V03 weekly-run status.
- [x] Add all required run fields, JSONB `stageResults`, nullable fields, validation, and timestamps.
- [x] Add nullable `weeklyArticleFlowRunId` to `NewsApiRequest` attributes, creation attributes, class fields, and Sequelize definition.
- [x] Keep the request-field default `null` so existing creation calls remain valid.
- [x] Register the new model in `_index.ts` initialization, return object, exports, and type exports.
- [x] Add weekly-run-to-request associations in `_associations.ts` with restrictive deletion behavior.
- [x] Place `WeeklyArticleFlowRun` before `NewsApiRequest` in `_loadOrder.ts`.

### Additive installation

- [x] Add an idempotent weekly-flow schema installer in db-manager using the existing V02 installer pattern.
- [x] Create the run table only when absent.
- [x] Add the request column only when absent without rewriting historical rows.
- [x] Install status, scheduled-time, creation-time, and request foreign-key indexes.
- [x] Install a PostgreSQL partial unique index allowing only one `pending` or `running` weekly run.
- [x] Add the restrictive foreign key from `NewsApiRequests.weeklyArticleFlowRunId` to `WeeklyArticleFlowRuns.id`.
- [x] Verify compatible existing columns, indexes, and constraints and refuse incompatible definitions.
- [x] Add a standalone installer entry point and db-manager package script.
- [x] Add mocked installer tests for fresh installation, idempotency, incompatibility, foreign keys, indexes, and the active-run uniqueness rule.
- [x] Add a disposable-Postgres integration harness that creates an isolated database, runs the real weekly-flow installer, and always tears the database down.
- [x] Add a dedicated db-manager integration-test script for the installed weekly-flow schema.
- [x] Prove the partial unique index rejects a second `pending` or `running` weekly run.
- [x] Prove terminal weekly runs do not block creation of a new active run.
- [x] Prove `NewsApiRequests` rows with a null `weeklyArticleFlowRunId` remain valid.
- [x] Prove deleting a referenced weekly run is rejected by `ON DELETE RESTRICT`.
- [x] Prove the exact cohort join returns only articles associated through requests carrying the selected weekly run ID.
- [x] Add load-order and ZIP-import compatibility coverage for the new table and nullable field.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Run the focused mocked db-manager installer and ZIP-import tests.
- [x] Run the disposable-Postgres weekly-flow schema integration suite against an explicitly confirmed test database.
- [x] Verify the integration harness removed its disposable database after both passing and intentionally failing cases.
- [x] Run `npm -C db-manager test`.
- [x] Run `npm -C db-manager run build`.
- [x] Fix failures, rerun the affected checks, and confirm no legacy V01 or orchestrator schema was reintroduced.
- [x] Check off completed Phase 1 tasks and update this document's modification metadata.
- [x] Stage only Phase 1 files and inspect `git diff --cached`.
- [x] Commit Phase 1 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 1.

## Phase 2: Db-Manager Maintenance Safety

### Duplicate-analysis cleanup

- [x] Add `--clear_duplicate_analyses` to the known CLI flags, parsed options, help documentation, and execution order before backup.
- [x] Implement a cleanup module that counts `ArticleDuplicateAnalysis` rows before deletion.
- [x] Select and delete primary keys in bounded batches.
- [x] Verify zero rows remain and return before, deleted, remaining, and batch counts.
- [x] Preserve the table, constraints, indexes, and identity sequence.
- [x] Ensure the implementation never issues `DROP TABLE`, `TRUNCATE`, or `VACUUM FULL`.
- [x] Emit one stable machine-readable JSON summary after successful CLI completion.
- [x] Add tests for empty data, multiple batches, partial batch failure, final verification failure, and JSON summary output.

### Verifiable backup manifest

- [x] Define a versioned backup manifest schema.
- [x] Enumerate every registered db-model, including models with zero rows.
- [x] Write one CSV for each positive-row model.
- [x] Store model name, CSV filename, row count, byte size, and SHA-256 in each positive-row entry.
- [x] Store explicit zero-row entries without data CSV files.
- [x] Include `manifest.json` in the ZIP.
- [x] Preserve the existing error when the entire database has no data.
- [x] Return the archive path and manifest version in the final machine-readable command summary.
- [x] Update backup and ZIP-import code where necessary to recognize the manifest without treating it as an unknown model CSV.
- [x] Add tests for empty tables, nonempty tables, expected membership, byte sizes, hashes, and cleanup of temporary files.

### Old-article deletion result

- [x] Preserve default `--delete_articles` behavior at 180 days.
- [x] Emit found count, deleted count, cutoff date, success, and command type in the stable final JSON summary.
- [x] Keep normal Winston logging compatible and exclude credentials or article content from summaries.
- [x] Add tests for success, failure, exit code, and result formatting.
- [x] Update db-manager README and package guidance for the new cleanup flag, manifest, and machine-readable terminal result.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Run focused db-manager CLI, cleanup, backup, and ZIP-import tests.
- [x] Run `npm -C db-manager test`.
- [x] Run `npm -C db-manager run build`.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 2 tasks and update this document's modification metadata.
- [x] Stage only Phase 2 files and inspect `git diff --cached`.
- [x] Commit Phase 2 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 2.

## Phase 3: Google RSS Cohort Ownership

### Optional run input

- [x] Extend `POST /request-google-rss/start-job` with optional `weeklyArticleFlowRunId`.
- [x] Reject booleans, strings with trailing content, zero, negatives, non-integers, and unknown run IDs.
- [x] Require the referenced weekly run to be `pending` or `running`.
- [x] Keep existing request bodies valid when the field is absent.
- [x] Propagate the validated run ID through route input, queue handler input, and RSS job context.
- [x] Include the run ID in queue parameters where safe for recovery inspection.

### Request association

- [x] Set `NewsApiRequest.weeklyArticleFlowRunId` on every request row created by that RSS job.
- [x] Leave the field `null` for manual RSS and unrelated ingestion paths.
- [x] Preserve repeat-window, URL deduplication, article-content seeding, follow-up scraping, cancellation, and query-result behavior.
- [x] Do not add a header or reuse `orchestratorRunId`.

### RSS result contract

- [x] Add `schemaVersion`, safe terminal message, and compatible common result fields to `GoogleRssJobResult`.
- [x] Preserve `articlesAddedCount`, query results, and all existing ending reasons.
- [x] Derive result counts from arrays where the contract includes arrays.
- [x] Persist the result through the existing `updateResult` path on accepted terminal completion.
- [x] Preserve partial diagnostic results on cancellation and failure when available.

### Compatibility tests

- [x] Test missing, valid, malformed, inactive, terminal, and nonexistent weekly run IDs.
- [x] Test weekly request association across multiple RSS query rows.
- [x] Test manual RSS without a run ID.
- [x] Test unrelated article-ingestion paths still create valid request rows.
- [x] Test all six RSS ending reasons and existing target-count behavior.
- [x] Test that removed legacy headers and field names remain absent.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Refresh the worker-node local db-model dependency if the package manager requires it.
- [x] Run focused request-google-rss route and job tests.
- [x] Run `npm -C worker-node test`.
- [x] Run `npm -C worker-node run build`.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 3 tasks and update this document's modification metadata.
- [x] Stage only Phase 3 files and inspect `git diff --cached`.
- [x] Commit Phase 3 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 3.

## Phase 4: Semantic Scorer Result Contract

### Processing outcomes

- [x] Define `SemanticScorerJobResult` with `schemaVersion`, `endingReason`, terminal message, arrays, and derived counts.
- [x] Return selected, scored, skipped, failed, and unattempted article outcomes from the processing loop.
- [x] Use deterministic `no_usable_text` skips when no scoring input exists.
- [x] Classify per-article timeout, scoring error, and persistence error separately.
- [x] Ensure each selected article appears in exactly one terminal outcome.
- [x] Mark remaining selected IDs unattempted after cancellation or a stage-level stop.
- [x] Preserve existing progress files for compatibility without using them as the result authority.

### Queue integration

- [x] Refactor the semantic workflow runner to return its structured result.
- [x] Call queue `updateResult` before normal return.
- [x] Persist partial results before propagating a stage-level exception when possible.
- [x] Keep the normal scorer eligibility filter unchanged.
- [x] Keep existing optional ID-range behavior for existing callers.
- [x] Confirm the weekly flow can call the route without cohort IDs or ID bounds.

### Tests

- [x] Test score success and persistence.
- [x] Test no-usable-text skip behavior.
- [x] Test scoring timeout, scoring error, and persistence error.
- [x] Test isolated failures continuing through the selected set.
- [x] Test cancellation and unattempted IDs.
- [x] Test array/count reconciliation and queue result persistence.
- [x] Test that normal eligibility and existing range callers remain compatible.

### Phase verification and commit

- [x] Run focused semantic-scorer tests.
- [x] Run `npm -C worker-node test`.
- [x] Run `npm -C worker-node run build`.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 4 tasks and update this document's modification metadata.
- [x] Stage only Phase 4 files and inspect `git diff --cached`.
- [x] Commit Phase 4 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 4.

## Phase 5: State Assigner Result and Breaker

### Structured processor result

- [x] Define `StateAssignerJobResult` with common fields and state-specific breaker fields.
- [x] Change `processStateAssignmentsWithTimeout` to return attempted, successful, skipped, failed, and unattempted outcomes.
- [x] Distinguish analysis errors, persistence errors, and iteration timeouts.
- [x] Ensure each selected article has exactly one terminal outcome.
- [x] Preserve exact-ID targeting and existing bounded pre-scrape enrichment.

### Consecutive-failure breaker

- [x] Maintain the counter inside worker-node's per-article loop.
- [x] Increment it for analysis errors, persistence errors, and iteration timeouts.
- [x] Reset it only after a successfully persisted assignment.
- [x] Do not count operator cancellation as an article failure.
- [x] Stop processing immediately on the fifth consecutive failure.
- [x] Mark every remaining selected article unattempted.
- [x] Record `maximumConsecutiveFailures` and `circuitBreakerTripped`.
- [x] Permit one to four isolated terminal failures without falsely tripping the breaker.

### Queue integration and tests

- [x] Return and persist the result through queue `updateResult`.
- [x] Preserve partial results on cancellation or stage failure where possible.
- [x] Test all-success processing.
- [x] Test timeout, analysis error, and persistence error classification.
- [x] Test that a success resets the counter.
- [x] Test five consecutive mixed failure types trip the breaker.
- [x] Test remaining IDs become unattempted at the breaker.
- [x] Test cancellation does not increment the breaker.
- [x] Test exact cohort IDs and capacity are preserved through the route and job.
- [x] Test result array/count reconciliation and queue persistence.

### Phase verification and commit

- [x] Run focused state-assigner route, targeting, and job tests.
- [x] Run `npm -C worker-node test`.
- [x] Run `npm -C worker-node run build`.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 5 tasks and update this document's modification metadata.
- [x] Stage only Phase 5 files and inspect `git diff --cached`.
- [x] Commit Phase 5 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 5.

## Phase 6: Coordinator Foundation

### Package and typed configuration

- [x] Create the private `ops/weekly-article-flow` TypeScript package, lockfile, TypeScript config, Jest config, and build scripts.
- [x] Add the planned `src/config`, `src/database`, `src/http`, `src/contracts`, `src/stages`, `src/coordinator`, `src/reporting`, and `src/alerts` module boundaries.
- [x] Depend on local `@newsnexus/db-models` and avoid a second database model definition.
- [x] Add `.env.example` with no secrets.
- [x] Parse modes, absolute paths, allowlisted worker URLs, database identities, stage timeouts, run timeout, polling, backoff, disk threshold, and canary target.
- [x] Reject unknown modes, relative paths, malformed URLs, unsafe timeout ranges, and overlapping dev/production identities.
- [x] Limit CLI options to mode, resume run ID, expected dev database confirmation, canary target, and live-AI permission.
- [x] Reject production target-count configuration and arbitrary command, SQL, path, credential, or URL overrides.

### Database repository

- [x] Implement atomic new-run creation backed by the partial unique index.
- [x] Map active-run uniqueness conflicts to `active_run_exists`.
- [x] Implement allowed run and stage transitions.
- [x] Persist `running` stage evidence before external work and terminal evidence after postcondition validation.
- [x] Implement exact cohort queries through weekly run, news API requests, and articles.
- [x] Implement V02 selection and prediction queries needed for reconciliation.
- [x] Implement resume loading without creating a replacement run.
- [x] Validate resume host, database, mode, revision, stage state, and conflicts.

### HTTP and result contracts

- [x] Implement allowlisted worker-node and worker-python clients.
- [x] Implement queue start, status, idle check, and cancellation calls using the workers' existing route spelling.
- [x] Add bounded request timeouts, exponential polling backoff, and safe error bodies.
- [x] Implement independent RSS, semantic, and state result validators.
- [x] Reject unknown schema versions, inconsistent counts, duplicate mutually exclusive IDs, and missing terminal outcomes as `failed_worker_result_contract`.
- [x] Ensure clients never log request secrets, preview tokens, article content, or environment values.

### Shell entry points

- [x] Add `bin/run-weekly-flow` with fixed nonblocking `flock` behavior.
- [x] Add `bin/run-dev-canary` and `bin/run-dev-destructive-recovery` wrappers.
- [x] Use absolute resolved paths and safe argument passing.
- [x] Ensure development wrappers cannot install or enable a schedule.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Install coordinator dependencies and inspect lockfile changes.
- [x] Run coordinator config, repository, HTTP-client, contract, and shell-wrapper tests.
- [x] Run `npm -C ops/weekly-article-flow test`.
- [x] Run `npm -C ops/weekly-article-flow run build`.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 6 tasks and update this document's modification metadata.
- [x] Stage only Phase 6 files and inspect `git diff --cached`.
- [x] Commit Phase 6 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 6.

## Phase 7: Maintenance and Worker Stages

### Preflight and locks

- [x] Validate host and database against mode-specific allowlists before creating a run.
- [x] Verify the `limited_user` runtime identity where required.
- [x] Verify repository revision, worker health, idle queues, and absence of an active V02 execution.
- [x] Verify spreadsheet, semantic workbook, state files, active V02 prompt, Playwright, Codex CLI, disk space, and writable output paths.
- [x] Apply the 15-minute preflight timeout.
- [x] Record mode, host, source revision, schedule time, and start time.

### Maintenance stages

- [x] Run duplicate cleanup with its 60-minute timeout only in enabled modes.
- [x] Parse the db-manager JSON summary and independently verify zero duplicate-analysis rows.
- [x] Run backup with its two-hour timeout only in enabled modes.
- [x] Verify ZIP integrity, manifest version, complete model membership, CSV membership, sizes, hashes, zero duplicate-analysis rows, and at least one nonempty model.
- [x] Persist archive path, archive size, archive SHA-256, duration, manifest version, and exit code.
- [x] Block deletion when any backup check fails.
- [x] Run the unchanged default `npm start -- --delete_articles` command with its 30-minute timeout.
- [x] Parse and persist its found count, deleted count, cutoff, duration, and exit code.
- [x] Mark maintenance stages skipped in `dev_canary`.
- [x] Require exact development database confirmation before enabling them in `dev_destructive_recovery`.

### RSS, semantic, and state stages

- [x] Submit RSS with `weeklyArticleFlowRunId` and a small target only in permitted development modes.
- [x] Poll the queue job to terminal status rather than treating HTTP `202` as completion.
- [x] Implement the V03 per-mode RSS ending-reason matrix.
- [x] Map rate limiting, cancellation, abort, error, and invalid production target behavior to the named statuses.
- [x] Query the exact cohort and require its distinct count to equal `articlesAddedCount`.
- [x] Complete as `completed_no_new_articles` when both counts are zero.
- [x] Start semantic scoring without cohort IDs or ID bounds.
- [x] Apply the four-hour semantic stage timeout.
- [x] Accept isolated semantic failures while recording every outcome.
- [x] Submit state assignment with exact cohort IDs and capacity at least equal to the RSS-added count.
- [x] Apply the 18-hour state stage timeout.
- [x] Map a tripped worker breaker to `failure_state_assigner_circuit_breaker`.
- [x] Accept and record one to four isolated state failures.

### Recovery and timeout behavior

- [x] Skip completed stages from authoritative persisted evidence.
- [x] Reattach a running or terminal worker job through its stored ID.
- [x] Reconcile duplicate cleanup through its zero-row postcondition.
- [x] Reconcile backup only from one uniquely identified valid archive created after stage start.
- [x] Require explicit reconciliation when old-article deletion lacks a trustworthy result or postcondition.
- [x] Stop instead of blindly resubmitting ambiguous work.
- [x] Cap every stage deadline by the remaining 72-hour run budget.
- [x] On timeout, cancel the child job or terminate the owned process group, record the outcome, and set `timed_out`.

### Phase verification and commit

- [x] Add tests for stage order, mode skips, preflight failures, and both locks.
- [x] Add tests for db-manager command parsing, backup verification failures, and deletion blocking.
- [x] Add tests for all RSS modes, cohort reconciliation, semantic handling, state breaker mapping, cancellation, and no-new-articles completion.
- [x] Add tests for resume attachment, destructive non-repetition, ambiguous evidence, and 72-hour timeout handling.
- [x] Run `npm -C ops/weekly-article-flow test`.
- [x] Run `npm -C ops/weekly-article-flow run build`.
- [x] Run `npm -C worker-node test` and `npm -C worker-node run build` as integration regressions.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 7 tasks and update this document's modification metadata.
- [x] Stage only Phase 7 files and inspect `git diff --cached`.
- [x] Commit Phase 7 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 7.

## Phase 8: AI Approver V02 and Reporting

### V02 preview and execution

- [x] Submit the preview directly to the allowlisted worker-python URL.
- [x] Set `selectionMode` to `article_position_count`.
- [x] Set `requestedArticleCount` to the Google RSS `articlesAddedCount` without increasing it.
- [x] Enable description fallback and approved-boundary crossing.
- [x] Persist draft ID, expiry, planned eligible count, frozen selected IDs, cohort IDs, overlap IDs, overlap count, and overlap percentage.
- [x] Treat overlap as visibility-only at every percentage.
- [x] Keep the preview token in memory only until acceptance.
- [x] Redact the preview token from logs, errors, Postgres stage results, and JSONL.
- [x] Accept the preview and persist V02 run and queue job IDs.
- [x] Poll both the V02 run and worker-python queue record to terminal state.
- [x] Reconcile attempted, completed, failed, invalid-response, skipped, and unattempted IDs and counts from the frozen selection and predictions.
- [x] Apply the 12-hour V02 stage timeout.
- [x] Map unacceptable terminal results to `failure_ai_approver_v02`.
- [x] Preserve explicit cancellation and run-wide timeout statuses.
- [x] Reattach any accepted V02 run during recovery and never automatically duplicate it.
- [x] Treat a pre-acceptance draft whose in-memory token was lost as unaccepted work; wait for or verify expiry before creating another preview for the same weekly run.

### JSONL journal

- [x] Write versioned UTC JSONL events to `/home/limited_user/project_resources/NewsNexus12/weekly-flow/`.
- [x] Use `weekly-flow-YYYYMMDD.jsonl` and append one flushed complete line per event.
- [x] Include run, stage, job, count, reason, path, mode, host, and revision fields from the PRD.
- [x] Exclude secrets, preview tokens, credentials, environment values, and article content.
- [x] Keep JSONL non-authoritative for recovery and retries.
- [x] Record reporting failure without rewriting an otherwise successful run status.

### Alert staging and invocation

- [x] Render the fixed-name `ALERT-newsnexus12-weekly-cron.md` with the required failure and recovery details.
- [x] Atomically stage it under the weekly-flow resources path.
- [x] Invoke only the fixed alert-publisher oneshot service.
- [x] Record helper start, completion, and failure without granting vault access to `limited_user`.
- [x] Keep the alert present until operator resolution or archival.

### Phase verification and commit

- [x] Add tests for exact Mode A body construction and no count compensation.
- [x] Add tests for zero, partial, and full cohort overlap all proceeding.
- [x] Add tests for token redaction, expiry recovery, dual-terminal reconciliation, every V02 terminal state, cancellation, and timeout.
- [x] Add tests for JSONL append, flushing, schemas, redaction, and write failures.
- [x] Add tests for alert content, atomic staging, helper success, helper failure, and sync failure reporting.
- [x] Run `npm -C ops/weekly-article-flow test`.
- [x] Run `npm -C ops/weekly-article-flow run build`.
- [x] Run `worker-python/venv/bin/pytest worker-python/tests/unit/ai_approver_v02 worker-python/tests/integration/test_ai_approver_v02_routes.py`.
- [x] Fix failures and rerun all affected checks.
- [x] Check off completed Phase 8 tasks and update this document's modification metadata.
- [x] Stage only Phase 8 files and inspect `git diff --cached`.
- [x] Commit Phase 8 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 8.

## Phase 9: Operational Assets and Documentation

### Systemd and scoped helper

- [ ] Add the production weekly service with `User=limited_user`, `Group=limited_user`, absolute paths, journald output, and `TimeoutStartSec=73h`.
- [ ] Add the Friday 5:00 AM `America/Los_Angeles` timer with persistence and the fixed service target.
- [ ] Add a root-owned alert-publisher oneshot service.
- [ ] Add a fixed root-owned helper that runs sync and publication as `nick`.
- [ ] Use `/home/nick/.npm-global/bin/ob sync --path "/home/nick/NickVault"` before and after publication.
- [ ] Validate the fixed staging file and atomically publish to `/home/nick/NickVault/ALERT-newsnexus12-weekly-cron.md`.
- [ ] Add a narrow sudoers template allowing `limited_user` to start only the fixed alert service with no arguments.
- [ ] Ensure no helper accepts arbitrary commands, SQL, paths, URLs, or environment overrides.

### Installation boundaries

- [ ] Add an installer that builds or verifies the coordinator and copies source-controlled assets.
- [ ] Support a development helper-only installation path for the alert helper, oneshot service, and scoped sudoers rule without installing the weekly service or timer.
- [ ] Make timer activation a separate explicit installer action.
- [ ] Default production installation to timer disabled.
- [ ] Refuse schedule installation from development wrappers or development mode.
- [ ] Add an uninstaller that disables and removes only this subsystem's installed units and helper assets.
- [ ] Preserve JSONL, alerts, database records, and unrelated schedules during uninstall.
- [ ] Add `systemd-analyze verify` instructions for Ubuntu validation.

### Documentation

- [ ] Add `ops/weekly-article-flow/README.md` covering modes, commands, paths, configuration, recovery, failure reasons, and operator gates.
- [ ] Document the additive schema installation command.
- [ ] Document dev canary and destructive-recovery commands without a schedule.
- [ ] Document manual production, timer installation, supervised-run gate, activation, monitoring, and rollback.
- [ ] Update root and relevant package guidance to identify the new weekly article flow and AI Approver V02.
- [ ] State clearly that internal Python files named `orchestrator.py` are not the removed cross-service product feature.
- [ ] Search active code and documentation for accidental use of removed V01 and legacy orchestrator contracts.

### Phase verification and commit

- [ ] Run shell syntax checks for wrappers, installer, uninstaller, and alert helper.
- [ ] Run coordinator tests and build.
- [ ] Review systemd units for absolute paths, user/group, timeout, timezone, persistence, environment loading, and disabled-by-default behavior.
- [ ] Verify installers cannot enable schedules in development mode.
- [ ] Verify uninstall scope cannot delete data or unrelated units.
- [ ] Fix failures and rerun all affected checks.
- [ ] Check off completed Phase 9 tasks and update this document's modification metadata.
- [ ] Stage only Phase 9 files and inspect `git diff --cached`.
- [ ] Commit Phase 9 with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 9.

## Phase 10: macOS Integrated Verification

### Full repository checks

- [ ] Build db-models first.
- [ ] Run the full db-manager test suite and build.
- [ ] Run the full worker-node test suite and build.
- [ ] Run the coordinator test suite and build.
- [ ] Run focused retained worker-python AI Approver V02 unit and integration suites.
- [ ] Run broader API, portal, or worker-python regression checks if implementation changes touched those packages.
- [ ] Fix all introduced failures and rerun the full affected suite.

### Static and contract review

- [ ] Confirm manual RSS requests still work without a weekly run ID.
- [ ] Confirm unrelated ingestion remains unchanged.
- [ ] Confirm semantic scorer normal eligibility remains authoritative.
- [ ] Confirm state assignment alone owns the five-consecutive-failure breaker.
- [ ] Confirm V02 receives RSS count and never uses overlap as a gate.
- [ ] Confirm all stage timeouts match V03, including semantic at four hours and run/service at 72/73 hours.
- [ ] Confirm production RSS cannot use a target count.
- [ ] Confirm the timer remains disabled by default.
- [ ] Confirm no secret, token, article content, credential, or production database value is committed.
- [ ] Confirm no V01 or removed legacy orchestrator runtime was restored.

### Local safety exercises

- [ ] Exercise coordinator dry dependencies with fake workers and a disposable local database.
- [ ] Verify malformed worker results become `failed_worker_result_contract`.
- [ ] Verify backup validation blocks deletion.
- [ ] Verify resume cannot duplicate completed stages or an accepted V02 run.
- [ ] Verify JSONL remains non-authoritative when its file is missing or corrupt.

### Phase verification and commit

- [ ] Record exact commands, results, and any accepted environment limitations in this todo or a linked active verification record.
- [ ] Check off completed Phase 10 tasks and update this document's modification metadata.
- [ ] Stage only verification fixes and documentation produced by Phase 10, then inspect `git diff --cached`.
- [ ] Commit Phase 10 if it produced tracked changes, referencing `20260831_weekly_article_flow_todo_v02.md` Phase 10.
- [ ] If Phase 10 produced no tracked changes, record that no commit was required.

## Phase 11: Ubuntu Dev Canary

### Operator gate

- [ ] Stop before any Ubuntu connection, deployment, schema write, or live AI call until the operator authorizes Ubuntu dev work.
- [ ] Confirm the target is the Ubuntu development host and a disposable development database.
- [ ] Confirm live AI use and the small RSS target with the operator before starting the canary.

### Deployment without scheduling

- [ ] Deploy the agreed revision to `/home/limited_user/applications/NewsNexus12`.
- [ ] Build db-models, db-manager, worker-node, and the coordinator as `limited_user`.
- [ ] Install the additive weekly-flow schema against the confirmed dev database.
- [ ] Create `/home/limited_user/project_resources/NewsNexus12/weekly-flow/` as `limited_user:limited_user`.
- [ ] Configure development allowlists, worker URLs, paths, and timeouts without committing secrets.
- [ ] Validate Playwright, Codex CLI, workbook, spreadsheet, state files, V02 prompt, queues, disk, JSONL, and helper prerequisites.
- [ ] Install the root-owned alert helper, alert-publisher oneshot service, and scoped sudoers rule on Ubuntu dev.
- [ ] Confirm the dev installation does not copy, install, or enable the weekly service or timer.

### Canary execution

- [ ] Start the flow manually in `dev_canary` mode with destructive stages disabled.
- [ ] Verify `target_articles_collected` is accepted for the configured small target.
- [ ] Verify RSS added count equals the exact persisted cohort count.
- [ ] Verify semantic scoring covers its normal eligible backlog and reports terminal outcomes.
- [ ] Verify state assignment targets the exact cohort.
- [ ] Use controlled failures to verify timeout counting, success reset, and the fifth-failure breaker.
- [ ] Run the approved V02 canary with RSS count as the Mode A request count.
- [ ] Verify overlap is reported but never gates execution.
- [ ] Verify Postgres run state, worker results, V02 results, JSONL, journald, and alert staging.
- [ ] Stage a fixed-path test alert and invoke the exact oneshot start path available to `limited_user`.
- [ ] Verify the helper executes both real Obsidian sync calls as `nick` and atomically publishes the fixed alert at `/home/nick/NickVault/ALERT-newsnexus12-weekly-cron.md`.
- [ ] Verify `limited_user` cannot start arbitrary services or pass alternate commands, arguments, source paths, destination paths, or environment overrides through the scoped sudoers rule.
- [ ] Induce a controlled helper failure and a controlled sync failure without risking the vault, then verify both are visible in journald and the weekly-flow JSONL.
- [ ] Restore successful helper operation after failure testing and verify the fixed alert remains operator-visible.
- [ ] Record whether the dev helper, oneshot, and sudoers assets are retained for future canaries or removed after validation.
- [ ] If removed, verify all three helper assets are gone; if retained, verify their ownership and narrow permissions remain correct.
- [ ] Confirm there is no weekly timer, cron entry, or next scheduled execution.

### Phase closeout

- [ ] Record commands, host, revision, database identity, run ID, job IDs, counts, results, and evidence paths.
- [ ] Fix code defects discovered by the canary and repeat relevant macOS and Ubuntu checks.
- [ ] Check off completed Phase 11 tasks and update this document's modification metadata.
- [ ] Commit any repository fixes and evidence with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 11.
- [ ] Stop and obtain operator approval before Phase 12 destructive dev testing.

## Phase 12: Ubuntu Dev Destructive Recovery

### Operator gate and preparation

- [ ] Obtain explicit operator approval for destructive testing against the confirmed disposable Ubuntu dev database.
- [ ] Record the expected database name used by the confirmation flag.
- [ ] Confirm no production database, worker, schedule, path, or credential is in scope.
- [ ] Create a fresh restorable backup before seeding destructive-test data.
- [ ] Seed disposable duplicate-analysis rows and old deletable articles.

### Recovery exercises

- [ ] Run `dev_destructive_recovery` with the exact expected database confirmation.
- [ ] Interrupt after successful duplicate cleanup, resume the same run, and prove cleanup is not repeated.
- [ ] Restore or reseed as required for the next isolated exercise.
- [ ] Interrupt after successful verified backup, resume the same run, and prove backup is not repeated.
- [ ] Restore or reseed as required for the next isolated exercise.
- [ ] Interrupt after successful old-article deletion, resume the same run, and prove deletion is not repeated.
- [ ] Test a missing manifest, extra CSV, missing CSV, wrong size, wrong SHA-256, corrupt ZIP, and nonzero duplicate-analysis manifest entry.
- [ ] Verify every backup validation failure blocks old-article deletion.
- [ ] Verify ambiguous `running` evidence stops for reconciliation rather than resubmitting work.
- [ ] Verify Postgres remains authoritative when JSONL is absent or corrupted.
- [ ] Confirm no production target or schedule was touched.

### Phase closeout

- [ ] Record run IDs, seeded data, interruption points, resume evidence, manifest failures, database checks, and logs.
- [ ] Fix defects and repeat each failed recovery exercise until it passes.
- [ ] Rerun affected package tests and builds after fixes.
- [ ] Check off completed Phase 12 tasks and update this document's modification metadata.
- [ ] Commit repository fixes and evidence with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 12.
- [ ] Stop after dev acceptance. Do not begin production deployment without explicit operator approval.

## Phase 13: Production Rollout

### Production deployment gate

- [ ] Obtain explicit operator approval before any production connection, schema installation, service installation, manual run, schedule retirement, or timer activation.
- [ ] Confirm the approved revision and successful Phase 11 and Phase 12 evidence.
- [ ] Create and verify a fresh production backup using the pre-change production state.
- [ ] Inventory the existing standalone RSS schedule and any remaining NewsNexus12 schedule without modifying them yet.

### Disabled installation and preflight

- [ ] Deploy the approved revision to `/home/limited_user/applications/NewsNexus12`.
- [ ] Build packages as `limited_user`.
- [ ] Install the additive weekly-flow schema.
- [ ] Install the weekly service, timer, alert helper, oneshot service, and scoped sudoers entry with the timer disabled.
- [ ] Run `systemd-analyze verify` on installed units.
- [ ] Validate production database and host allowlists, permissions, paths, worker health, idle queues, V02 state, disk space, Playwright, Codex, JSONL, NickVault sync, alert publication, and Pacific schedule interpretation.
- [ ] Confirm no new next trigger exists while the timer is disabled.

### Supervised manual production run

- [ ] Obtain operator approval immediately before the destructive manual production run.
- [ ] Run `manual_production` with no RSS target count.
- [ ] Supervise cleanup, verified backup, deletion, RSS, semantic scoring, state assignment, V02, reconciliation, JSONL, and alerts.
- [ ] Verify production RSS completes with `queries_exhausted`.
- [ ] Verify exact cohort and all persisted counts.
- [ ] Verify the V02 request count equals RSS added count and overlap remains visibility-only.
- [ ] Verify no stage was duplicated and all terminal state is internally consistent.
- [ ] Exercise a non-destructive alert test and confirm both Obsidian sync operations.

### Schedule transition gate

- [ ] Present supervised-run evidence to the operator.
- [ ] Obtain explicit approval before disabling the old standalone RSS schedule.
- [ ] Disable and remove the old standalone RSS schedule and record proof that it has no next trigger.
- [ ] Obtain explicit approval before enabling the new timer.
- [ ] Enable and start the new timer.
- [ ] Verify Friday 5:00 AM `America/Los_Angeles`, persistence, 73-hour service timeout, and nonoverlap behavior.
- [ ] Record the next trigger and unit status.

### Monitoring and rollback readiness

- [ ] Monitor the first scheduled execution and confirm Postgres, journald, JSONL, V02, and alert results.
- [ ] Review four successful scheduled runs before considering rollout fully complete.
- [ ] Keep rollback instructions ready to disable the new timer and restore the prior code without removing additive schema.
- [ ] Never re-enable the retired standalone RSS schedule automatically during rollback.
- [ ] Treat schema removal as a separate destructive change requiring new approval.

### Final closeout

- [ ] Record production host, revision, schema result, manual run ID, schedule retirement evidence, timer status, next trigger, and monitoring evidence.
- [ ] Update active operational documentation with verified production details.
- [ ] Check off completed Phase 13 tasks and update this document's modification metadata.
- [ ] Commit repository documentation or evidence with a message referencing `20260831_weekly_article_flow_todo_v02.md` Phase 13.
- [ ] Confirm all PRD V03 acceptance criteria are satisfied.
