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
- [ ] Complete phases in order unless a dependency is explicitly documented.
- [ ] Keep V01 code, routes, tables, data, and direct backend access intact.
- [ ] Stop and consult the operator before expanding an implementation boundary.

Use one todo file for the first release. The database, worker, API, and portal share one run lifecycle, so separate checklists would make cross-package completion harder to verify.

## 2. Completion Rules

- [ ] Check off a task only after its implementation and focused verification pass.
- [ ] Add or update tests in the same phase as the behavior they protect.
- [ ] Fix regressions before completing a phase.
- [ ] Run the listed type, lint, test, and build checks at each phase gate.
- [ ] Record any unavailable check and its reason before committing.
- [ ] Review the staged diff for unrelated or destructive changes.
- [ ] Commit only the completed phase after its checks pass.
- [ ] Use lowercase commit messages and the repository co-author format.
- [ ] Do not deploy or run a live Codex smoke test without operator approval.

## 3. Implementation Boundaries

- [ ] Do not add V02 weekly orchestration.
- [ ] Do not automatically approve articles.
- [ ] Do not add arbitrary article-ID targeting.
- [ ] Do not reprocess completed V02 predictions.
- [ ] Do not allow prompt deletion.
- [ ] Do not add a third automatic prediction attempt.
- [ ] Do not persist rendered prompts or duplicate article content.
- [ ] Do not build a general migration framework.
- [ ] Do not delete or rename V01 source, routes, tables, or data.
- [ ] Do not weaken shared PostgreSQL, queue, or V02 startup validation.
- [ ] Do not archive feature documentation without operator direction.

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

- [ ] Add `AiApproverPromptVersionV02` in `db-models/src/models`.
- [ ] Use physical table name `AiApproverPromptVersionsV02`.
- [ ] Add `id`, nullable `title`, `promptInMarkdown`, `isActive`, and nullable `firstUsedAt`.
- [ ] Add standard `createdAt` and `updatedAt` timestamps.
- [ ] Normalize blank prompt titles to null at the write boundary.
- [ ] Add partial uniqueness for non-null titles.
- [ ] Add an index supporting active-prompt lookup.
- [ ] Add database or transactional protection against multiple active prompts.

### 5.2 Run model

- [ ] Add `AiApproverRunV02` in `db-models/src/models`.
- [ ] Use physical table name `AiApproverRunsV02`.
- [ ] Add prompt, queue-job, selection-mode, option, boundary, count, model, status, reason, and timestamp fields from PRD section 12.3.
- [ ] Add preview token and expiration fields required by the accepted plan.
- [ ] Add `draft` and `expired` as preview lifecycle statuses alongside the required execution statuses.
- [ ] Store selection snapshots as bounded metadata without article content or rendered prompts.
- [ ] Define each selection object with `articleId`, `contentSource`, and nullable `articleContents02Id`.
- [ ] Add indexes for `jobId`, `status`, `createdAt`, and status-plus-preview-expiration.
- [ ] Ensure counter defaults are valid for both preview and accepted runs.

### 5.3 Prediction model

- [ ] Add `AiApproverArticlePredictionV02` in `db-models/src/models`.
- [ ] Use physical table name `AiApproverArticlePredictionsV02`.
- [ ] Add every field required by PRD section 12.4.
- [ ] Restrict `prediction` to `approved`, `irrelevant`, or null.
- [ ] Restrict `resultStatus` to `completed`, `failed`, or `invalid_response`.
- [ ] Require completed rows to have a prediction and nonblank reasoning.
- [ ] Require non-completed rows to have a null prediction.
- [ ] Restrict `attemptCount` to 1 or 2.
- [ ] Keep `humanValidation` nullable boolean and `humanComment` nullable text.
- [ ] Add indexes for article, prompt, latest run, result status, and prediction.
- [ ] Do not add a database unique constraint on `articleId` in this release.

### 5.4 Registration and associations

- [ ] Register all three models in `db-models/src/models/_index.ts`.
- [ ] Add their dependency order to `db-models/src/models/_loadOrder.ts`.
- [ ] Add prompt-to-run and prompt-to-prediction associations.
- [ ] Add article-to-prediction and run-to-prediction associations.
- [ ] Confirm model exports reach API, db-manager, backup, restore, and test initialization.
- [ ] Verify existing V01 model names, exports, and associations remain unchanged.

### 5.5 Dedicated schema installer

- [ ] Add a db-manager command that installs only the three V02 tables.
- [ ] Initialize shared models before inspecting or creating V02 tables.
- [ ] Use `queryInterface.describeTable` to inspect existing tables.
- [ ] Inspect required indexes and foreign keys through query-interface metadata.
- [ ] Validate columns, types, nullability, indexes, and references before mutation.
- [ ] Treat a complete compatible installation as a successful no-op.
- [ ] Fail before mutation when an existing V02 table is partial or incompatible.
- [ ] Call `sync` only for absent V02 models in dependency order.
- [ ] Never pass `force` or `alter`.
- [ ] Print created, retained, and rejected schema outcomes clearly.
- [ ] Return a nonzero exit code on installer failure.
- [ ] Add the workstation and production package commands.

### 5.6 Database tests and documentation

- [ ] Add Phase 1 model and installer coverage to the db-manager Jest suite.
- [ ] Test model initialization and associations.
- [ ] Test field constraints and required indexes.
- [ ] Test partial non-null title uniqueness.
- [ ] Test active-prompt protection.
- [ ] Test an empty V02 schema installation.
- [ ] Test an already-installed compatible schema.
- [ ] Test a partial or incompatible existing table.
- [ ] Test a compatible table missing a required index or foreign key.
- [ ] Test that the installer does not modify unrelated or V01 tables.
- [ ] Document backup prerequisites, verification queries, and destructive rollback order.
- [ ] State that normal application rollback retains the V02 tables.

### 5.7 Phase 1 validation and commit

- [ ] Run `cd db-models && npm run build`.
- [ ] Run `cd db-manager && npm run build`.
- [ ] Run `cd db-manager && npm test -- --runInBand`.
- [ ] Fix all Phase 1 failures and rerun affected checks.
- [ ] Check off completed Phase 1 tasks.
- [ ] Review and stage only Phase 1 changes.
- [ ] Commit Phase 1 after every required check passes.

## 6. Phase 2: Worker-Python V02 Core

### 6.1 Module and route isolation

- [ ] Create a separate `worker-python/src/modules/ai_approver_v02` package.
- [ ] Create a separate `worker-python/src/routes/ai_approver_v02.py` route module.
- [ ] Mount worker routes under `/ai-approver-v02`.
- [ ] Leave V01 `/ai-approver` routes and module names unchanged.
- [ ] Reuse the global queue engine without mixing V01 and V02 product state.
- [ ] Use the V02 database run ID as the queue handler input.

### 6.2 V02 configuration

- [ ] Add V02-only configuration for PostgreSQL settings.
- [ ] Add `AI_APPROVER_V02_MODEL_NAME` with default `gpt-5.4-mini`.
- [ ] Add `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`.
- [ ] Add `AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS` with default seven.
- [ ] Validate positive timeout and retention values.
- [ ] Validate Codex CLI availability.
- [ ] Do not depend on V01 environment-variable names.
- [ ] Return clear V02 configuration errors from V02 routes.

### 6.3 SQL-side preview selection

- [ ] Implement selection in PostgreSQL instead of loading a broad Mode B range into Python.
- [ ] Resolve the highest current `Articles.id` at preview time.
- [ ] Resolve the highest approved article ID using only `isApproved = true`.
- [ ] Implement Mode A as an article-position range with default count 25.
- [ ] Reject non-integer or non-positive Mode A counts.
- [ ] Truncate Mode A before the approved boundary by default.
- [ ] Allow Mode A to cross the boundary only when explicitly requested.
- [ ] Continue Mode A without truncation when no approved boundary exists.
- [ ] Make Mode B unavailable when no approved boundary exists.
- [ ] Stop Mode B before the approved boundary.
- [ ] Exclude every approved article even when Mode A crosses the boundary.
- [ ] Resolve the latest state row by highest `ArticleStateContracts02.id`.
- [ ] Require an integer state ID and `isDeterminedToBeError = false`.
- [ ] Resolve the latest usable successful content row by highest `ArticleContents02.id`.
- [ ] Require nonblank scraped content by default.
- [ ] Use nonblank article description only when fallback is enabled and scraped content is unusable.
- [ ] Record the selected source and nullable content-row ID.
- [ ] Exclude completed V02 predictions.
- [ ] Include first-attempt `failed` and `invalid_response` rows for one retry.
- [ ] Exclude rows with `attemptCount >= 2`.
- [ ] Return selections in descending article-ID order.
- [ ] Do not expand Mode A to compensate for ineligible articles.
- [ ] Return no draft when the resolved eligible count is zero.

### 6.4 Draft preview lifecycle

- [ ] Create a draft run only for a nonempty eligible preview.
- [ ] Store selection mode, options, boundaries, counts, model, and frozen selection objects.
- [ ] Generate a short-lived, unguessable preview token.
- [ ] Return the draft run ID, token, resolved bounds, and planned count.
- [ ] Centralize stale-preview maintenance in one repository operation.
- [ ] Change past-expiration drafts to `expired` atomically.
- [ ] Set `endingReason = preview_expired` and `endedAt`.
- [ ] Delete only expired, unaccepted previews older than the retention period.
- [ ] Invoke maintenance before preview, acceptance, and preview-administration reads.
- [ ] Reject acceptance of an expired or invalid preview.
- [ ] Exclude `draft` and `expired` from latest-run, execution-history, and metric queries.

### 6.5 Transactional acceptance

- [ ] Take a PostgreSQL transaction-scoped advisory lock during acceptance.
- [ ] Lock and reload the draft run inside the transaction.
- [ ] Verify the preview token and expiration.
- [ ] Verify no V02 run is `queued` or `running`.
- [ ] Verify exactly one active prompt exists.
- [ ] Mark the active prompt used before accepting the run.
- [ ] Promote the draft to `queued` and commit before queue submission.
- [ ] Submit the accepted run ID to the existing queue engine.
- [ ] Persist the returned queue job ID.
- [ ] Mark the run failed with a clear reason when enqueueing fails.
- [ ] Return a conflict for duplicate or racing acceptance attempts.
- [ ] Keep V01 jobs outside the V02 active-run restriction.

### 6.6 Prompt renderer and Codex client

- [ ] Keep the operator prompt separate from the hardcoded article wrapper.
- [ ] Inject the article title and selected content as values.
- [ ] Add a hardcoded JSON-only response instruction.
- [ ] Define a hardcoded `pipelineVersion`.
- [ ] Document when the pipeline version must increment.
- [ ] Invoke Codex in an isolated read-only process.
- [ ] Use a neutral temporary working directory.
- [ ] Enforce the configured model and timeout.
- [ ] Capture the final response through a temporary output file.
- [ ] Clean temporary files after success, failure, cancellation, and timeout.
- [ ] Extract exactly one JSON object.
- [ ] Accept only `approved` or `irrelevant` with nonblank reasoning.
- [ ] Normalize malformed model output to `invalid_response`.
- [ ] Normalize CLI, timeout, and process failures to `failed`.
- [ ] Redact article title, content, and rendered prompts from stored errors and logs.
- [ ] Perform one logical invocation per article in a run.

### 6.7 Prediction repository

- [ ] Centralize all V02 prediction writes in one repository.
- [ ] Insert a first-attempt row only when no row exists for the article.
- [ ] Reject or safely resolve a duplicate first-attempt insert.
- [ ] Update the existing row for an allowed retry.
- [ ] Increment retry `attemptCount` from 1 to 2.
- [ ] Reuse the existing row's original prompt version for a retry.
- [ ] Refresh every attempt-derived field listed in PRD section 10.6.
- [ ] Preserve row ID, article ID, prompt relationship, creation time, and human-review fields.
- [ ] Prevent a third automatic attempt.
- [ ] Store bounded metadata without rendered prompts or duplicated content.
- [ ] Keep model execution outside database transactions.

### 6.8 Frozen-selection execution

- [ ] Process frozen selection objects in descending article-ID order.
- [ ] Reload the exact recorded `ArticleContents02` row for scraped-content selections.
- [ ] Reload the same article's description for description selections.
- [ ] Never switch to a newer content row or another source during execution.
- [ ] Skip a missing, unsuccessful, or blank frozen source.
- [ ] Increment `skippedCount` without creating a prediction row.
- [ ] Use the run's active prompt for new prediction rows.
- [ ] Use the existing row's original prompt for retries.
- [ ] Leave every unattempted article without a prediction row.

### 6.9 Counts, circuit breakers, cancellation, and reconciliation

- [ ] Change accepted runs from `queued` to `running` when execution starts.
- [ ] Update attempted and outcome counters after each final article outcome.
- [ ] Track CLI failures and invalid responses independently.
- [ ] Increment only the matching breaker counter.
- [ ] Reset both breaker counters after a completed prediction.
- [ ] Stop after three CLI failures since the last completion.
- [ ] Stop after five invalid responses since the last completion.
- [ ] Persist the breaker type and partial counts before terminal completion.
- [ ] Check the queue cancellation event before every article.
- [ ] Finish canceled runs with `canceled` and retain completed results.
- [ ] Finish successful runs with `completed`.
- [ ] Use `failed` only for accepted execution or enqueue failures.
- [ ] Reconcile stale `queued` and `running` database rows after restart.
- [ ] Expose database-run detail alongside generic queue status.

### 6.10 V01 startup isolation

- [ ] Remove V01-only configuration from fatal startup validation.
- [ ] Log a nonfatal startup warning when V01 configuration is invalid.
- [ ] Keep V01 validation in the V01 job request or runner path.
- [ ] Make a directly requested invalid V01 job fail clearly.
- [ ] Keep shared database, queue, and V02 validation fatal.
- [ ] Verify unrelated worker routes still start.

### 6.11 Worker tests

- [ ] Add focused config, preview, repository, renderer, client, and orchestrator unit tests.
- [ ] Add V02 route and queue integration tests.
- [ ] Test both selection modes and missing-boundary behavior.
- [ ] Test every eligibility filter and description fallback.
- [ ] Test zero-result preview behavior.
- [ ] Test concurrent acceptance and advisory locking.
- [ ] Test stale draft expiration, history exclusion, and retention.
- [ ] Test exact content-row reuse after a newer row appears.
- [ ] Test skipping when the frozen source becomes unusable.
- [ ] Test one-row-per-article behavior and one permitted retry.
- [ ] Test original-prompt retention during retries.
- [ ] Test pipeline-version persistence.
- [ ] Test temporary-file cleanup and article-text error redaction.
- [ ] Test independent circuit breakers and alternating failures.
- [ ] Test cancellation and restart reconciliation.
- [ ] Test V01 nonfatal startup and direct-request failure behavior.
- [ ] Mock Codex execution in automated tests.

### 6.12 Phase 2 validation and commit

- [ ] Run focused V02 worker unit tests.
- [ ] Run V02 worker route integration tests.
- [ ] Run `cd worker-python && pytest`.
- [ ] Perform the available Python type or lint checks, or record that none are configured.
- [ ] Fix all Phase 2 failures and rerun affected checks.
- [ ] Check off completed Phase 2 tasks.
- [ ] Review and stage only Phase 2 changes.
- [ ] Commit Phase 2 after every required check passes.

## 7. Phase 3: API Surface

### 7.1 Shared worker proxy support

- [ ] Extract worker-python base-URL handling into a shared API module.
- [ ] Extract Axios error forwarding into the same shared API support.
- [ ] Update the existing automation router to use the shared helpers without behavior changes.
- [ ] Preserve existing authentication, status codes, and V01 route paths.

### 7.2 V02 automation router

- [ ] Create `api/src/routes/automations/ai-approver-v02.ts`.
- [ ] Mount it at `/automations/ai-approver-v02`.
- [ ] Require existing authenticated-user middleware.
- [ ] Add preview and start proxy routes.
- [ ] Add latest accepted-run and run-by-ID routes.
- [ ] Add queued-or-running cancel behavior.
- [ ] Combine generic queue status with the V02 database-run summary where required.
- [ ] Exclude draft and expired previews from operator execution status.
- [ ] Return clear validation, conflict, expired-preview, and worker configuration errors.

### 7.3 V02 analysis router

- [ ] Create `api/src/routes/analysis/ai-approver-v02.ts`.
- [ ] Mount it at `/analysis/ai-approver-v02`.
- [ ] Require existing authenticated-user middleware.
- [ ] Add prompt list, create, edit-unused, activate, and deactivate routes.
- [ ] Do not add a prompt delete route.
- [ ] Normalize blank titles to null.
- [ ] Return a clear conflict for duplicate non-null titles.
- [ ] Reject edits when `firstUsedAt` is set.
- [ ] Allow a used prompt to be reactivated without changing it.
- [ ] Switch active prompts transactionally.
- [ ] Protect against multiple active prompts.
- [ ] Add batch prediction reads for review-table article IDs.
- [ ] Add one-article prediction-detail reads.
- [ ] Add independent human-validation and human-comment writes.
- [ ] Support clearing either review field without clearing the other.
- [ ] Prevent review routes from modifying prediction or audit fields.
- [ ] Return clear not-found and invalid-validation errors.

### 7.4 API tests

- [ ] Test authentication on every portal-facing V02 route.
- [ ] Test worker proxy success and normalized failures.
- [ ] Test preview, start, status, detail, and cancellation routes.
- [ ] Test duplicate-run and expired-preview responses.
- [ ] Test prompt creation, title normalization, activation, deactivation, and immutability.
- [ ] Test reactivation of a used prompt without editing it.
- [ ] Test that no prompt deletion route exists.
- [ ] Test multiple-active-prompt protection.
- [ ] Test batch and detail prediction reads.
- [ ] Test true, false, null, comment-only, and independent-clear review writes.
- [ ] Test that V01 API routes remain directly callable.
- [ ] Test that V02 review writes have no article-approval side effects.

### 7.5 Phase 3 validation and commit

- [ ] Run `cd db-models && npm run build`.
- [ ] Run `cd api && npm run build`.
- [ ] Run `cd api && npm test -- --runInBand`.
- [ ] Fix all Phase 3 failures and rerun affected checks.
- [ ] Check off completed Phase 3 tasks.
- [ ] Review and stage only Phase 3 changes.
- [ ] Commit Phase 3 after every required check passes.

## 8. Phase 4: Portal Experience

### 8.1 V02 automation section

- [ ] Create a dedicated `AiApproverV02Section`.
- [ ] Reuse `CollapsibleAutomationSection` where appropriate.
- [ ] Display the active prompt title or fallback label.
- [ ] Link to the V02 prompt-management page.
- [ ] Add a control that opens the V02 run-configuration modal.
- [ ] Show the latest accepted V02 run and queue status.
- [ ] Add manual refresh and queued-or-running cancellation.
- [ ] Disable start for an active V02 run, no prompt, multiple prompts, or required-load failure.
- [ ] Keep V01 jobs independent from the V02 disabled state.

### 8.2 Run-configuration modal

- [ ] Add mutually exclusive Mode A and Mode B controls.
- [ ] Default Mode A count to 25.
- [ ] Require a positive integer without adding a product maximum.
- [ ] Default approved-boundary crossing off.
- [ ] Default description fallback off.
- [ ] Explain and disable Mode B when no approved boundary exists.
- [ ] Request a fresh preview after relevant options change.
- [ ] Display resolved bounds and planned eligible model calls.
- [ ] Explain that final attempts may be lower than the preview count.
- [ ] Disable confirmation for zero eligible articles.
- [ ] Close or cancel without starting a job.
- [ ] Confirm using the preview run ID and token without recalculation.
- [ ] Require a refreshed preview after expiration.
- [ ] Prevent duplicate confirmation submissions.

### 8.3 V02 run status

- [ ] Compose the generic worker status panel with a V02 run-summary panel.
- [ ] Show run or queue-job ID and selection mode.
- [ ] Show planned, attempted, completed, failed, invalid, and skipped counts.
- [ ] Show cancellation or circuit-breaker reason.
- [ ] Show start and end timestamps when present.
- [ ] Avoid showing draft or expired previews as failed executions.
- [ ] Preserve generic status-panel behavior for existing consumers.

### 8.4 V02 prompt-management page

- [ ] Add `/articles/automations/ai-approver-v02-prompts`.
- [ ] Add list, create, edit-unused, activate, and deactivate interactions.
- [ ] Provide title and Markdown prompt fields.
- [ ] Explain that title and content are injected by the worker.
- [ ] Do not expose model, placeholder, response-schema, or delete controls.
- [ ] Show active and used states clearly.
- [ ] Show the defined fallback label for a blank prompt title.
- [ ] Disable editing for a used prompt.
- [ ] Handle duplicate-title and multiple-active errors clearly.

### 8.5 Article review V02 data

- [ ] Fetch V02 predictions in article-ID batches.
- [ ] Merge V02 fields without overwriting V01 fields.
- [ ] Add a review-table column labeled with `V02`.
- [ ] Make the V02 column visible by default.
- [ ] Show `approved` or `irrelevant` only for completed predictions.
- [ ] Show `N/A` when no completed V02 prediction exists.
- [ ] Make displayed predictions open the V02 details modal.
- [ ] Keep the column advisory with no approval, relevance, report, or workflow side effects.

### 8.6 V02 details and human review

- [ ] Show prediction, reasoning, prompt display name, model, pipeline version, and timestamp.
- [ ] Ask whether AI Approver V02 was correct.
- [ ] Save Yes as true and No as false.
- [ ] Clear validation to null.
- [ ] Save a comment with or without validation.
- [ ] Save validation with or without a comment.
- [ ] Clear either field without clearing the other.
- [ ] Refresh local review state after a successful save.
- [ ] Surface API validation and save errors.

### 8.7 V01 portal hiding

- [ ] Rename visible terminology to `Weekly Orchestrator V01` and `AI Approver V01` where retained.
- [ ] Remove the V01 automation sections from the rendered automations page.
- [ ] Do not mount hidden V01 controls that remain keyboard-accessible.
- [ ] Remove navigation to `/articles/automations/ai-approver-prompts`.
- [ ] Make the direct V01 prompt page render the standard not-found page.
- [ ] Do not redirect the V01 prompt page to V02.
- [ ] Preserve the V01 page and component source files.
- [ ] Rename the V01 review label for clarity.
- [ ] Make the V01 review column hidden by default.
- [ ] Preserve V01 review loading and modal behavior.

### 8.8 Phase 4 validation and commit

- [ ] Run `cd portal && npm run lint`.
- [ ] Run `cd portal && npm run build`.
- [ ] Manually verify both preview modes and zero-result behavior.
- [ ] Manually verify expired preview and active-run blocking behavior.
- [ ] Manually verify status refresh and cancellation.
- [ ] Manually verify prompt creation, activation, and used-prompt locking.
- [ ] Manually verify V01 not-found routing and review-column defaults.
- [ ] Manually verify V02 validation and comment clearing.
- [ ] Fix all Phase 4 failures and rerun affected checks.
- [ ] Check off completed Phase 4 tasks.
- [ ] Review and stage only Phase 4 changes.
- [ ] Commit Phase 4 after every required check passes.

## 9. Phase 5: Cross-Package Integration and Regression

### 9.1 End-to-end scenarios

- [ ] Verify preview, confirmation, queueing, execution, persistence, status, and review for a new prediction.
- [ ] Verify a failed first attempt updates the same row on one later retry.
- [ ] Verify no automatic third attempt is selected or written.
- [ ] Verify a used prompt becomes immutable.
- [ ] Verify a new prompt affects new predictions but not completed or retry prompt relationships.
- [ ] Verify cancellation leaves unattempted articles without prediction rows.
- [ ] Verify reopening the same range selects eligible unattempted and retryable articles.
- [ ] Verify Mode A behavior with and without an approved boundary.
- [ ] Verify Mode B rejects a missing approved boundary.
- [ ] Verify alternating failure types cannot evade either circuit breaker.
- [ ] Verify an abandoned preview expires without appearing as a failed run.
- [ ] Verify a newer content row does not replace the frozen row.
- [ ] Verify an unusable frozen source increments skipped count without a prediction row.
- [ ] Verify two acceptance requests cannot create two active V02 runs.

### 9.2 V01 and product-side-effect regression

- [ ] Verify V01 automation cards and prompt navigation are inaccessible in the portal.
- [ ] Verify the V01 review column remains available but hidden by default.
- [ ] Verify direct V01 API and worker-python calls remain available.
- [ ] Verify invalid V01 configuration does not stop worker startup.
- [ ] Verify a direct invalid V01 request fails clearly.
- [ ] Verify V02 predictions never create `ArticleApproveds` rows.
- [ ] Verify V02 review writes do not change relevance, reports, or orchestration.
- [ ] Verify existing non-approver worker and API routes still function.
- [ ] Verify backup and import paths include the new models without altering old data.

### 9.3 Full validation matrix

- [ ] Run `cd db-models && npm run build`.
- [ ] Run `cd db-manager && npm run build`.
- [ ] Run `cd db-manager && npm test -- --runInBand`.
- [ ] Run `cd worker-python && pytest`.
- [ ] Run `cd api && npm run build`.
- [ ] Run `cd api && npm test -- --runInBand`.
- [ ] Run `cd portal && npm run lint`.
- [ ] Run `cd portal && npm run build`.
- [ ] Record test counts and any intentionally unavailable checks.
- [ ] Fix every regression and rerun the affected package and integration checks.

### 9.4 Phase 5 commit

- [ ] Check off completed Phase 5 tasks.
- [ ] Review the complete implementation diff against PRD V02 and Plan V02.
- [ ] Confirm no implementation-boundary item was added.
- [ ] Review and stage only Phase 5 changes.
- [ ] Commit Phase 5 after every required check passes.

## 10. Phase 6: Documentation and Deployment Preparation

### 10.1 Repository guidance

- [ ] Update root and relevant package guidance to define the existing flow as V01.
- [ ] Define the new binary-prediction workflow as V02.
- [ ] Document that V01 source names remain unchanged.
- [ ] Document distinct V01 and V02 route and table namespaces.
- [ ] Document that V02 is manual-only in this release.
- [ ] Update each modified Markdown file's frontmatter.

### 10.2 Environment and operations

- [ ] Document every V02 environment variable and default.
- [ ] Document Codex CLI authentication and model-access prerequisites.
- [ ] Document the workstation schema-install command.
- [ ] Document the production schema-install command.
- [ ] Document schema verification queries.
- [ ] Document database backup as a deployment prerequisite.
- [ ] Document service deployment order: worker-python, API, then portal.
- [ ] Document V02 health checks before portal exposure.
- [ ] Document application rollback without dropping V02 tables.
- [ ] Put destructive table removal in a separate operator-approved procedure.
- [ ] Document how to derive every PRD success measure from persisted run, prediction, review, and warning data.
- [ ] Confirm draft and expired previews are excluded from execution success measures.

### 10.3 Post-implementation report

- [ ] Create the required post-implementation clarification report in `docs/ai-appover-v02`.
- [ ] Summarize final V01 and V02 boundaries.
- [ ] Record naming confusion discovered during implementation.
- [ ] Record any changes needed before a future V01 removal plan.
- [ ] Keep the report separate from the pre-implementation V01 inventory.

### 10.4 Production readiness review

- [ ] Confirm the production backup completed before schema installation.
- [ ] Confirm Codex CLI authentication and `gpt-5.4-mini` access.
- [ ] Confirm the schema installer is repeatable and non-destructive.
- [ ] Confirm all three V02 tables, indexes, and foreign keys.
- [ ] Confirm worker-python and API V02 health checks.
- [ ] Prepare a small Mode A production smoke-test procedure.
- [ ] Require operator approval before deployment.
- [ ] Require operator approval before a live Codex smoke test.
- [ ] Verify the smoke test checks persistence, status, review, validation, and V01 startup behavior.

### 10.5 Phase 6 validation and commit

- [ ] Re-run checks affected by documentation or deployment-script changes.
- [ ] Validate every documented command against actual package scripts.
- [ ] Validate frontmatter and internal document references.
- [ ] Confirm rollback instructions do not drop data during normal rollback.
- [ ] Check off completed Phase 6 tasks.
- [ ] Review and stage only Phase 6 changes.
- [ ] Commit Phase 6 after every required check passes.

## 11. Final Acceptance Checklist

- [ ] An authenticated operator can preview and start both V02 modes.
- [ ] Every preview applies the documented range and eligibility rules.
- [ ] A confirmed run executes its frozen selection and source choices.
- [ ] Zero-eligible, expired, invalid, and conflicting starts are blocked clearly.
- [ ] Only one V02 run can be queued or running.
- [ ] Each article has at most one application-managed V02 prediction row.
- [ ] Failed and invalid outcomes receive at most one later retry.
- [ ] Completed predictions cannot be automatically reprocessed.
- [ ] Independent circuit breakers and cancellation preserve partial results.
- [ ] Prompt activation, first-use locking, and retry relationships are correct.
- [ ] Human validation and comments work independently.
- [ ] V02 remains advisory and causes no article workflow side effects.
- [ ] V01 portal entry points are hidden while V01 backend compatibility remains.
- [ ] V01 configuration cannot prevent worker startup.
- [ ] The dedicated schema installer is safe, repeatable, and documented.
- [ ] All automated and manual checks pass.
- [ ] Pre-implementation and post-implementation reports are complete.
- [ ] The operator has approved the production procedure.

## 12. Todo Completion

- [ ] Confirm every checked task has supporting code, tests, documentation, or verification evidence.
- [ ] Confirm every phase has its own passing validation and commit.
- [ ] Confirm the working tree contains no unintended changes.
- [ ] Confirm the final implementation matches PRD V02 and Plan V02.
- [x] Submit this todo for assessing-agent review before implementation begins.
