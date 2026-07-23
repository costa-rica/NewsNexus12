---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Implementation Todo V01

## 1. Todo Status

- [x] Treat `20260723_ai_approver_v02_prd_v02.md` as the product source of truth.
- [x] Treat `20260723_ai_approver_v02_plan_v02.md` as the accepted implementation plan.
- [x] Complete phases in order unless a dependency is explicitly documented.
- [x] Keep V01 code, routes, tables, data, and direct backend access intact.
- [x] Stop and consult the operator before expanding an implementation boundary.

Use one todo file for the first release. The database, worker, API, and portal share one run lifecycle, so separate checklists would make cross-package completion harder to verify.

## 2. Completion Rules

- [x] Check off a task only after its implementation and focused verification pass.
- [x] Add or update tests in the same phase as the behavior they protect.
- [x] Fix regressions before completing a phase.
- [x] Run the listed type, lint, test, and build checks at each phase gate.
- [x] Record any unavailable check and its reason before committing.
- [x] Review the staged diff for unrelated or destructive changes.
- [x] Commit only the completed phase after its checks pass.
- [x] Use lowercase commit messages and the repository co-author format.
- [x] Do not deploy or run a live Codex smoke test without operator approval.

## 3. Implementation Boundaries

- [x] Do not add V02 weekly orchestration.
- [x] Do not automatically approve articles.
- [x] Do not add arbitrary article-ID targeting.
- [x] Do not reprocess completed V02 predictions.
- [x] Do not allow prompt deletion.
- [x] Do not add a third automatic prediction attempt.
- [x] Do not persist rendered prompts or duplicate article content.
- [x] Do not build a general migration framework.
- [x] Do not delete or rename V01 source, routes, tables, or data.
- [x] Do not weaken shared PostgreSQL, queue, or V02 startup validation.
- [x] Do not archive feature documentation without operator direction.

## 4. Phase 0: Pre-implementation Documentation Gate

No product code begins until this phase is complete and the operator approves the report.

### 4.1 V01 inventory

- [x] Create `docs/ai-appover-v02/20260723_ai_approver_v01_safe_removal_report.md`.
- [x] Give the report the required four-key YAML frontmatter.
- [x] Inventory V01 portal pages, components, navigation, review fields, and data requests.
- [x] Inventory V01 API routes, modules, authentication, and database access.
- [x] Inventory V01 worker-python routes, configuration, repository, client, and orchestrator.
- [x] Inventory worker-node and weekly-orchestrator dependencies on V01 behavior.
- [x] Inventory V01 models, associations, indexes, backup, restore, and import paths.
- [x] Inventory V01 tests, operational documentation, environment variables, and production procedures.
- [x] Identify which V01 elements are hidden in this release and which remain directly callable.
- [x] Describe safe future removal steps without authorizing removal.
- [x] Confirm the report remains separate from the post-implementation clarification report.

### 4.2 Phase 0 validation and commit

- [x] Compare the inventory against repository-wide V01 references.
- [x] Confirm every referenced path exists or explain why it is historical.
- [x] Confirm the report proposes no V01 deletion in this release.
- [x] Obtain operator approval for the pre-implementation report.
- [x] Check off completed Phase 0 tasks.
- [x] Stage only the Phase 0 documentation.
- [x] Commit Phase 0 after approval.

## 5. Phase 1: Database Schema Foundation

### 5.1 Prompt model

- [x] Add `AiApproverPromptVersionV02` in `db-models/src/models`.
- [x] Use physical table name `AiApproverPromptVersionsV02`.
- [x] Add `id`, nullable `title`, `promptInMarkdown`, `isActive`, and nullable `firstUsedAt`.
- [x] Add standard `createdAt` and `updatedAt` timestamps.
- [x] Normalize blank prompt titles to null at the write boundary.
- [x] Add partial uniqueness for non-null titles.
- [x] Add an index supporting active-prompt lookup.
- [x] Add database or transactional protection against multiple active prompts.

### 5.2 Run model

- [x] Add `AiApproverRunV02` in `db-models/src/models`.
- [x] Use physical table name `AiApproverRunsV02`.
- [x] Add prompt, queue-job, selection-mode, option, boundary, count, model, status, reason, and timestamp fields from PRD section 12.3.
- [x] Add preview token and expiration fields required by the accepted plan.
- [x] Add `draft` and `expired` as preview lifecycle statuses alongside the required execution statuses.
- [x] Store selection snapshots as bounded metadata without article content or rendered prompts.
- [x] Define each selection object with `articleId`, `contentSource`, and nullable `articleContents02Id`.
- [x] Add indexes for `jobId`, `status`, `createdAt`, and status-plus-preview-expiration.
- [x] Ensure counter defaults are valid for both preview and accepted runs.

### 5.3 Prediction model

- [x] Add `AiApproverArticlePredictionV02` in `db-models/src/models`.
- [x] Use physical table name `AiApproverArticlePredictionsV02`.
- [x] Add every field required by PRD section 12.4.
- [x] Restrict `prediction` to `approved`, `irrelevant`, or null.
- [x] Restrict `resultStatus` to `completed`, `failed`, or `invalid_response`.
- [x] Require completed rows to have a prediction and nonblank reasoning.
- [x] Require non-completed rows to have a null prediction.
- [x] Restrict `attemptCount` to 1 or 2.
- [x] Keep `humanValidation` nullable boolean and `humanComment` nullable text.
- [x] Add indexes for article, prompt, latest run, result status, and prediction.
- [x] Do not add a database unique constraint on `articleId` in this release.

### 5.4 Registration and associations

- [x] Register all three models in `db-models/src/models/_index.ts`.
- [x] Add their dependency order to `db-models/src/models/_loadOrder.ts`.
- [x] Add prompt-to-run and prompt-to-prediction associations.
- [x] Add article-to-prediction and run-to-prediction associations.
- [x] Confirm model exports reach API, db-manager, backup, restore, and test initialization.
- [x] Verify existing V01 model names, exports, and associations remain unchanged.

### 5.5 Dedicated schema installer

- [x] Add a db-manager command that installs only the three V02 tables.
- [x] Initialize shared models before inspecting or creating V02 tables.
- [x] Use `queryInterface.describeTable` to inspect existing tables.
- [x] Inspect required indexes and foreign keys through query-interface metadata.
- [x] Validate columns, types, nullability, indexes, and references before mutation.
- [x] Treat a complete compatible installation as a successful no-op.
- [x] Fail before mutation when an existing V02 table is partial or incompatible.
- [x] Call `sync` only for absent V02 models in dependency order.
- [x] Never pass `force` or `alter`.
- [x] Print created, retained, and rejected schema outcomes clearly.
- [x] Return a nonzero exit code on installer failure.
- [x] Add the workstation and production package commands.

### 5.6 Database tests and documentation

- [x] Add Phase 1 model and installer coverage to the db-manager Jest suite.
- [x] Test model initialization and associations.
- [x] Test field constraints and required indexes.
- [x] Test partial non-null title uniqueness.
- [x] Test active-prompt protection.
- [x] Test an empty V02 schema installation.
- [x] Test an already-installed compatible schema.
- [x] Test a partial or incompatible existing table.
- [x] Test a compatible table missing a required index or foreign key.
- [x] Test that the installer does not modify unrelated or V01 tables.
- [x] Document backup prerequisites, verification queries, and destructive rollback order.
- [x] State that normal application rollback retains the V02 tables.

### 5.7 Phase 1 validation and commit

- [x] Run `cd db-models && npm run build`.
- [x] Run `cd db-manager && npm run build`.
- [x] Run `cd db-manager && npm test -- --runInBand`.
- [x] Fix all Phase 1 failures and rerun affected checks.
- [x] Check off completed Phase 1 tasks.
- [x] Review and stage only Phase 1 changes.
- [x] Commit Phase 1 after every required check passes.

## 6. Phase 2: Worker-Python V02 Core

### 6.1 Module and route isolation

- [x] Create a separate `worker-python/src/modules/ai_approver_v02` package.
- [x] Create a separate `worker-python/src/routes/ai_approver_v02.py` route module.
- [x] Mount worker routes under `/ai-approver-v02`.
- [x] Leave V01 `/ai-approver` routes and module names unchanged.
- [x] Reuse the global queue engine without mixing V01 and V02 product state.
- [x] Use the V02 database run ID as the queue handler input.

### 6.2 V02 configuration

- [x] Add V02-only configuration for PostgreSQL settings.
- [x] Add `AI_APPROVER_V02_MODEL_NAME` with default `gpt-5.4-mini`.
- [x] Add `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`.
- [x] Add `AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS` with default seven.
- [x] Validate positive timeout and retention values.
- [x] Validate Codex CLI availability.
- [x] Do not depend on V01 environment-variable names.
- [x] Return clear V02 configuration errors from V02 routes.

### 6.3 SQL-side preview selection

- [x] Implement selection in PostgreSQL instead of loading a broad Mode B range into Python.
- [x] Resolve the highest current `Articles.id` at preview time.
- [x] Resolve the highest approved article ID using only `isApproved = true`.
- [x] Implement Mode A as an article-position range with default count 25.
- [x] Reject non-integer or non-positive Mode A counts.
- [x] Truncate Mode A before the approved boundary by default.
- [x] Allow Mode A to cross the boundary only when explicitly requested.
- [x] Continue Mode A without truncation when no approved boundary exists.
- [x] Make Mode B unavailable when no approved boundary exists.
- [x] Stop Mode B before the approved boundary.
- [x] Exclude every approved article even when Mode A crosses the boundary.
- [x] Resolve the latest state row by highest `ArticleStateContracts02.id`.
- [x] Require an integer state ID and `isDeterminedToBeError = false`.
- [x] Resolve the latest usable successful content row by highest `ArticleContents02.id`.
- [x] Require nonblank scraped content by default.
- [x] Use nonblank article description only when fallback is enabled and scraped content is unusable.
- [x] Record the selected source and nullable content-row ID.
- [x] Exclude completed V02 predictions.
- [x] Include first-attempt `failed` and `invalid_response` rows for one retry.
- [x] Exclude rows with `attemptCount >= 2`.
- [x] Return selections in descending article-ID order.
- [x] Do not expand Mode A to compensate for ineligible articles.
- [x] Return no draft when the resolved eligible count is zero.

### 6.4 Draft preview lifecycle

- [x] Create a draft run only for a nonempty eligible preview.
- [x] Store selection mode, options, boundaries, counts, model, and frozen selection objects.
- [x] Generate a short-lived, unguessable preview token.
- [x] Return the draft run ID, token, resolved bounds, and planned count.
- [x] Centralize stale-preview maintenance in one repository operation.
- [x] Change past-expiration drafts to `expired` atomically.
- [x] Set `endingReason = preview_expired` and `endedAt`.
- [x] Delete only expired, unaccepted previews older than the retention period.
- [x] Invoke maintenance before preview, acceptance, and preview-administration reads.
- [x] Reject acceptance of an expired or invalid preview.
- [x] Exclude `draft` and `expired` from latest-run, execution-history, and metric queries.

### 6.5 Transactional acceptance

- [x] Take a PostgreSQL transaction-scoped advisory lock during acceptance.
- [x] Lock and reload the draft run inside the transaction.
- [x] Verify the preview token and expiration.
- [x] Verify no V02 run is `queued` or `running`.
- [x] Verify exactly one active prompt exists.
- [x] Mark the active prompt used before accepting the run.
- [x] Promote the draft to `queued` and commit before queue submission.
- [x] Submit the accepted run ID to the existing queue engine.
- [x] Persist the returned queue job ID.
- [x] Mark the run failed with a clear reason when enqueueing fails.
- [x] Return a conflict for duplicate or racing acceptance attempts.
- [x] Keep V01 jobs outside the V02 active-run restriction.

### 6.6 Prompt renderer and Codex client

- [x] Keep the operator prompt separate from the hardcoded article wrapper.
- [x] Inject the article title and selected content as values.
- [x] Add a hardcoded JSON-only response instruction.
- [x] Define a hardcoded `pipelineVersion`.
- [x] Document when the pipeline version must increment.
- [x] Invoke Codex in an isolated read-only process.
- [x] Use a neutral temporary working directory.
- [x] Enforce the configured model and timeout.
- [x] Capture the final response through a temporary output file.
- [x] Clean temporary files after success, failure, cancellation, and timeout.
- [x] Extract exactly one JSON object.
- [x] Accept only `approved` or `irrelevant` with nonblank reasoning.
- [x] Normalize malformed model output to `invalid_response`.
- [x] Normalize CLI, timeout, and process failures to `failed`.
- [x] Redact article title, content, and rendered prompts from stored errors and logs.
- [x] Perform one logical invocation per article in a run.

### 6.7 Prediction repository

- [x] Centralize all V02 prediction writes in one repository.
- [x] Insert a first-attempt row only when no row exists for the article.
- [x] Reject or safely resolve a duplicate first-attempt insert.
- [x] Update the existing row for an allowed retry.
- [x] Increment retry `attemptCount` from 1 to 2.
- [x] Reuse the existing row's original prompt version for a retry.
- [x] Refresh every attempt-derived field listed in PRD section 10.6.
- [x] Preserve row ID, article ID, prompt relationship, creation time, and human-review fields.
- [x] Prevent a third automatic attempt.
- [x] Store bounded metadata without rendered prompts or duplicated content.
- [x] Keep model execution outside database transactions.

### 6.8 Frozen-selection execution

- [x] Process frozen selection objects in descending article-ID order.
- [x] Reload the exact recorded `ArticleContents02` row for scraped-content selections.
- [x] Reload the same article's description for description selections.
- [x] Never switch to a newer content row or another source during execution.
- [x] Skip a missing, unsuccessful, or blank frozen source.
- [x] Increment `skippedCount` without creating a prediction row.
- [x] Use the run's active prompt for new prediction rows.
- [x] Use the existing row's original prompt for retries.
- [x] Leave every unattempted article without a prediction row.

### 6.9 Counts, circuit breakers, cancellation, and reconciliation

- [x] Change accepted runs from `queued` to `running` when execution starts.
- [x] Update attempted and outcome counters after each final article outcome.
- [x] Track CLI failures and invalid responses independently.
- [x] Increment only the matching breaker counter.
- [x] Reset both breaker counters after a completed prediction.
- [x] Stop after three CLI failures since the last completion.
- [x] Stop after five invalid responses since the last completion.
- [x] Persist the breaker type and partial counts before terminal completion.
- [x] Check the queue cancellation event before every article.
- [x] Finish canceled runs with `canceled` and retain completed results.
- [x] Finish successful runs with `completed`.
- [x] Use `failed` only for accepted execution or enqueue failures.
- [x] Reconcile stale `queued` and `running` database rows after restart.
- [x] Expose database-run detail alongside generic queue status.

### 6.10 V01 startup isolation

- [x] Remove V01-only configuration from fatal startup validation.
- [x] Log a nonfatal startup warning when V01 configuration is invalid.
- [x] Keep V01 validation in the V01 job request or runner path.
- [x] Make a directly requested invalid V01 job fail clearly.
- [x] Keep shared database, queue, and V02 validation fatal.
- [x] Verify unrelated worker routes still start.

### 6.11 Worker tests

- [x] Add focused config, preview, repository, renderer, client, and orchestrator unit tests.
- [x] Add V02 route and queue integration tests.
- [x] Test both selection modes and missing-boundary behavior.
- [x] Test every eligibility filter and description fallback.
- [x] Test zero-result preview behavior.
- [x] Test concurrent acceptance and advisory locking.
- [x] Test stale draft expiration, history exclusion, and retention.
- [x] Test exact content-row reuse after a newer row appears.
- [x] Test skipping when the frozen source becomes unusable.
- [x] Test one-row-per-article behavior and one permitted retry.
- [x] Test original-prompt retention during retries.
- [x] Test pipeline-version persistence.
- [x] Test temporary-file cleanup and article-text error redaction.
- [x] Test independent circuit breakers and alternating failures.
- [x] Test cancellation and restart reconciliation.
- [x] Test V01 nonfatal startup and direct-request failure behavior.
- [x] Mock Codex execution in automated tests.

### 6.12 Phase 2 validation and commit

- [x] Run focused V02 worker unit tests.
- [x] Run V02 worker route integration tests.
- [x] Run `cd worker-python && pytest`.
- [x] Record that no Python type checker or linter is configured for worker-python.
- [x] Fix all Phase 2 failures and rerun affected checks.
- [x] Check off completed Phase 2 tasks.
- [x] Review and stage only Phase 2 changes.
- [x] Commit Phase 2 after every required check passes.

## 7. Phase 3: API Surface

### 7.1 Shared worker proxy support

- [x] Extract worker-python base-URL handling into a shared API module.
- [x] Extract Axios error forwarding into the same shared API support.
- [x] Update the existing automation router to use the shared helpers without behavior changes.
- [x] Preserve existing authentication, status codes, and V01 route paths.

### 7.2 V02 automation router

- [x] Create `api/src/routes/automations/ai-approver-v02.ts`.
- [x] Mount it at `/automations/ai-approver-v02`.
- [x] Require existing authenticated-user middleware.
- [x] Add preview and start proxy routes.
- [x] Add latest accepted-run and run-by-ID routes.
- [x] Add queued-or-running cancel behavior.
- [x] Combine generic queue status with the V02 database-run summary where required.
- [x] Exclude draft and expired previews from operator execution status.
- [x] Return clear validation, conflict, expired-preview, and worker configuration errors.

### 7.3 V02 analysis router

- [x] Create `api/src/routes/analysis/ai-approver-v02.ts`.
- [x] Mount it at `/analysis/ai-approver-v02`.
- [x] Require existing authenticated-user middleware.
- [x] Add prompt list, create, edit-unused, activate, and deactivate routes.
- [x] Do not add a prompt delete route.
- [x] Normalize blank titles to null.
- [x] Return a clear conflict for duplicate non-null titles.
- [x] Reject edits when `firstUsedAt` is set.
- [x] Allow a used prompt to be reactivated without changing it.
- [x] Switch active prompts transactionally.
- [x] Protect against multiple active prompts.
- [x] Add batch prediction reads for review-table article IDs.
- [x] Add one-article prediction-detail reads.
- [x] Add independent human-validation and human-comment writes.
- [x] Support clearing either review field without clearing the other.
- [x] Prevent review routes from modifying prediction or audit fields.
- [x] Return clear not-found and invalid-validation errors.

### 7.4 API tests

- [x] Test authentication on every portal-facing V02 route.
- [x] Test worker proxy success and normalized failures.
- [x] Test preview, start, status, detail, and cancellation routes.
- [x] Test duplicate-run and expired-preview responses.
- [x] Test prompt creation, title normalization, activation, deactivation, and immutability.
- [x] Test reactivation of a used prompt without editing it.
- [x] Test that no prompt deletion route exists.
- [x] Test multiple-active-prompt protection.
- [x] Test batch and detail prediction reads.
- [x] Test true, false, null, comment-only, and independent-clear review writes.
- [x] Test that V01 API routes remain directly callable.
- [x] Test that V02 review writes have no article-approval side effects.

### 7.5 Phase 3 validation and commit

- [x] Run `cd db-models && npm run build`.
- [x] Run `cd api && npm run build`.
- [x] Run `cd api && npm test -- --runInBand`.
- [x] Fix all Phase 3 failures and rerun affected checks.
- [x] Check off completed Phase 3 tasks.
- [x] Review and stage only Phase 3 changes.
- [x] Commit Phase 3 after every required check passes.

## 8. Phase 4: Portal Experience

### 8.1 V02 automation section

- [x] Create a dedicated `AiApproverV02Section`.
- [x] Reuse `CollapsibleAutomationSection` where appropriate.
- [x] Display the active prompt title or fallback label.
- [x] Link to the V02 prompt-management page.
- [x] Add a control that opens the V02 run-configuration modal.
- [x] Show the latest accepted V02 run and queue status.
- [x] Add manual refresh and queued-or-running cancellation.
- [x] Disable start for an active V02 run, no prompt, multiple prompts, or required-load failure.
- [x] Keep V01 jobs independent from the V02 disabled state.

### 8.2 Run-configuration modal

- [x] Add mutually exclusive Mode A and Mode B controls.
- [x] Default Mode A count to 25.
- [x] Require a positive integer without adding a product maximum.
- [x] Default approved-boundary crossing off.
- [x] Default description fallback off.
- [x] Explain and disable Mode B when no approved boundary exists.
- [x] Request a fresh preview after relevant options change.
- [x] Display resolved bounds and planned eligible model calls.
- [x] Explain that final attempts may be lower than the preview count.
- [x] Disable confirmation for zero eligible articles.
- [x] Close or cancel without starting a job.
- [x] Confirm using the preview run ID and token without recalculation.
- [x] Require a refreshed preview after expiration.
- [x] Prevent duplicate confirmation submissions.

### 8.3 V02 run status

- [x] Compose the generic worker status panel with a V02 run-summary panel.
- [x] Show run or queue-job ID and selection mode.
- [x] Show planned, attempted, completed, failed, invalid, and skipped counts.
- [x] Show cancellation or circuit-breaker reason.
- [x] Show start and end timestamps when present.
- [x] Avoid showing draft or expired previews as failed executions.
- [x] Preserve generic status-panel behavior for existing consumers.

### 8.4 V02 prompt-management page

- [x] Add `/articles/automations/ai-approver-v02-prompts`.
- [x] Add list, create, edit-unused, activate, and deactivate interactions.
- [x] Provide title and Markdown prompt fields.
- [x] Explain that title and content are injected by the worker.
- [x] Do not expose model, placeholder, response-schema, or delete controls.
- [x] Show active and used states clearly.
- [x] Show the defined fallback label for a blank prompt title.
- [x] Disable editing for a used prompt.
- [x] Handle duplicate-title and multiple-active errors clearly.

### 8.5 Article review V02 data

- [x] Fetch V02 predictions in article-ID batches.
- [x] Merge V02 fields without overwriting V01 fields.
- [x] Add a review-table column labeled with `V02`.
- [x] Make the V02 column visible by default.
- [x] Show `approved` or `irrelevant` only for completed predictions.
- [x] Show `N/A` when no completed V02 prediction exists.
- [x] Make displayed predictions open the V02 details modal.
- [x] Keep the column advisory with no approval, relevance, report, or workflow side effects.

### 8.6 V02 details and human review

- [x] Show prediction, reasoning, prompt display name, model, pipeline version, and timestamp.
- [x] Ask whether AI Approver V02 was correct.
- [x] Save Yes as true and No as false.
- [x] Clear validation to null.
- [x] Save a comment with or without validation.
- [x] Save validation with or without a comment.
- [x] Clear either field without clearing the other.
- [x] Refresh local review state after a successful save.
- [x] Surface API validation and save errors.

### 8.7 V01 portal hiding

- [x] Rename visible terminology to `Weekly Orchestrator V01` and `AI Approver V01` where retained.
- [x] Remove the V01 automation sections from the rendered automations page.
- [x] Do not mount hidden V01 controls that remain keyboard-accessible.
- [x] Remove navigation to `/articles/automations/ai-approver-prompts`.
- [x] Make the direct V01 prompt page render the standard not-found page.
- [x] Do not redirect the V01 prompt page to V02.
- [x] Preserve the V01 page and component source files.
- [x] Rename the V01 review label for clarity.
- [x] Make the V01 review column hidden by default.
- [x] Preserve V01 review loading and modal behavior.

### 8.8 Phase 4 validation and commit

- [x] Run `cd portal && npm run lint`.
- [x] Run `cd portal && npm run build`.
- [x] Manually verify both preview modes and zero-result behavior.
- [x] Manually verify expired preview and active-run blocking behavior.
- [x] Manually verify status refresh and cancellation.
- [x] Manually verify prompt creation, activation, and used-prompt locking.
- [x] Manually verify V01 not-found routing and review-column defaults.
- [x] Manually verify V02 validation and comment clearing.
- [x] Fix all Phase 4 failures and rerun affected checks.
- [x] Check off completed Phase 4 tasks.
- [x] Review and stage only Phase 4 changes.
- [x] Commit Phase 4 after every required check passes.

## 9. Phase 5: Cross-Package Integration and Regression

### 9.1 End-to-end scenarios

- [x] Verify preview, confirmation, queueing, execution, persistence, status, and review for a new prediction.
- [x] Verify a failed first attempt updates the same row on one later retry.
- [x] Verify no automatic third attempt is selected or written.
- [x] Verify a used prompt becomes immutable.
- [x] Verify a new prompt affects new predictions but not completed or retry prompt relationships.
- [x] Verify cancellation leaves unattempted articles without prediction rows.
- [x] Verify reopening the same range selects eligible unattempted and retryable articles.
- [x] Verify Mode A behavior with and without an approved boundary.
- [x] Verify Mode B rejects a missing approved boundary.
- [x] Verify alternating failure types cannot evade either circuit breaker.
- [x] Verify an abandoned preview expires without appearing as a failed run.
- [x] Verify a newer content row does not replace the frozen row.
- [x] Verify an unusable frozen source increments skipped count without a prediction row.
- [x] Verify two acceptance requests cannot create two active V02 runs.

### 9.2 V01 and product-side-effect regression

- [x] Verify V01 automation cards and prompt navigation are inaccessible in the portal.
- [x] Verify the V01 review column remains available but hidden by default.
- [x] Verify direct V01 API and worker-python calls remain available.
- [x] Verify invalid V01 configuration does not stop worker startup.
- [x] Verify a direct invalid V01 request fails clearly.
- [x] Verify V02 predictions never create `ArticleApproveds` rows.
- [x] Verify V02 review writes do not change relevance, reports, or orchestration.
- [x] Verify existing non-approver worker and API routes still function.
- [x] Verify backup and import paths include the new models without altering old data.

### 9.3 Full validation matrix

- [x] Run `cd db-models && npm run build`.
- [x] Run `cd db-manager && npm run build`.
- [x] Run `cd db-manager && npm test -- --runInBand`.
- [x] Run `cd worker-python && pytest`.
- [x] Run `cd api && npm run build`.
- [x] Run `cd api && npm test -- --runInBand`.
- [x] Run `cd portal && npm run lint`.
- [x] Run `cd portal && npm run build`.
- [x] Record test counts and any intentionally unavailable checks.
- [x] Fix every regression and rerun the affected package and integration checks.

### 9.4 Phase 5 commit

- [x] Check off completed Phase 5 tasks.
- [x] Review the complete implementation diff against PRD V02 and Plan V02.
- [x] Confirm no implementation-boundary item was added.
- [x] Review and stage only Phase 5 changes.
- [x] Commit Phase 5 after every required check passes.

## 10. Phase 6: Documentation and Deployment Preparation

### 10.1 Repository guidance

- [x] Update root and relevant package guidance to define the existing flow as V01.
- [x] Define the new binary-prediction workflow as V02.
- [x] Document that V01 source names remain unchanged.
- [x] Document distinct V01 and V02 route and table namespaces.
- [x] Document that V02 is manual-only in this release.
- [x] Update each modified Markdown file's frontmatter.

### 10.2 Environment and operations

- [x] Document every V02 environment variable and default.
- [x] Document Codex CLI authentication and model-access prerequisites.
- [x] Document the workstation schema-install command.
- [x] Document the production schema-install command.
- [x] Document schema verification queries.
- [x] Document database backup as a deployment prerequisite.
- [x] Document service deployment order: worker-python, API, then portal.
- [x] Document V02 health checks before portal exposure.
- [x] Document application rollback without dropping V02 tables.
- [x] Put destructive table removal in a separate operator-approved procedure.
- [x] Document how to derive every PRD success measure from persisted run, prediction, review, and warning data.
- [x] Confirm draft and expired previews are excluded from execution success measures.

### 10.3 Post-implementation report

- [x] Create the required post-implementation clarification report in `docs/ai-appover-v02`.
- [x] Summarize final V01 and V02 boundaries.
- [x] Record naming confusion discovered during implementation.
- [x] Record any changes needed before a future V01 removal plan.
- [x] Keep the report separate from the pre-implementation V01 inventory.

### 10.4 Production readiness review

- [ ] Confirm the production backup completed before schema installation.
- [ ] Confirm Codex CLI authentication and `gpt-5.4-mini` access.
- [x] Confirm the schema installer is repeatable and non-destructive.
- [x] Confirm all three V02 tables, indexes, and foreign keys.
- [x] Confirm worker-python and API V02 health checks.
- [x] Prepare a small Mode A production smoke-test procedure.
- [x] Require operator approval before deployment.
- [x] Require operator approval before a live Codex smoke test.
- [x] Verify the smoke test checks persistence, status, review, validation, and V01 startup behavior.

### 10.5 Phase 6 validation and commit

- [x] Re-run checks affected by documentation or deployment-script changes.
- [x] Validate every documented command against actual package scripts.
- [x] Validate frontmatter and internal document references.
- [x] Confirm rollback instructions do not drop data during normal rollback.
- [x] Check off completed Phase 6 tasks.
- [x] Review and stage only Phase 6 changes.
- [x] Commit Phase 6 after every required check passes.

## 11. Final Acceptance Checklist

- [x] An authenticated operator can preview and start both V02 modes.
- [x] Every preview applies the documented range and eligibility rules.
- [x] A confirmed run executes its frozen selection and source choices.
- [x] Zero-eligible, expired, invalid, and conflicting starts are blocked clearly.
- [x] Only one V02 run can be queued or running.
- [x] Each article has at most one application-managed V02 prediction row.
- [x] Failed and invalid outcomes receive at most one later retry.
- [x] Completed predictions cannot be automatically reprocessed.
- [x] Independent circuit breakers and cancellation preserve partial results.
- [x] Prompt activation, first-use locking, and retry relationships are correct.
- [x] Human validation and comments work independently.
- [x] V02 remains advisory and causes no article workflow side effects.
- [x] V01 portal entry points are hidden while V01 backend compatibility remains.
- [x] V01 configuration cannot prevent worker startup.
- [x] The dedicated schema installer is safe, repeatable, and documented.
- [x] All automated and manual checks pass.
- [x] Pre-implementation and post-implementation reports are complete.
- [ ] The operator has approved the production procedure.

## 12. Todo Completion

- [x] Confirm every checked task has supporting code, tests, documentation, or verification evidence.
- [x] Confirm every phase has its own passing validation and commit.
- [x] Confirm the working tree contains no unintended changes.
- [x] Confirm the final implementation matches PRD V02 and Plan V02.
- [x] Submit this todo for assessing-agent review before implementation begins.
