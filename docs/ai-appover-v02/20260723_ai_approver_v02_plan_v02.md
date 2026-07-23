---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Implementation Plan V02

## 1. Plan Status

- Role: planner in the plan-and-vet workflow
- Source of truth: `20260723_ai_approver_v02_prd_v02.md`
- PRD status: accepted by the assessing agent
- Plan version: V02
- Supersedes: `20260723_ai_approver_v02_plan_v01.md`
- Incorporates: `20260723_ai_approver_v02_plan_v01_assessment_claude.md`
- Scope: first AI Approver V02 release
- Repository: NewsNexus12 monorepo

This plan describes the implementation architecture, major components, data flow, sequencing, validation, and rollout. It is not the task-style todo list used during implementation.

## 2. Planning Decision

Use one plan rather than separate package plans.

The database, preview snapshot, prompt freeze, queue job, prediction retry, and portal status all share one run lifecycle. Separate plans would risk incompatible assumptions at package boundaries.

The later todo should divide implementation into package-aware phases while preserving the dependency order in this plan.

## 3. Required Precondition

Before any V02 code is written, create the separate V01 safe-removal report required by the PRD.

The report will:

- inventory V01 portal, API, worker-python, worker-node orchestration, database, report, test, backup, and documentation dependencies
- identify safe future removal steps
- preserve V01 code and data
- remain separate from the post-implementation clarification report

This documentation gate does not authorize V01 removal.

## 4. Existing Architecture to Reuse

### 4.1 Database models

Reuse the Sequelize model pattern in `db-models/src/models`.

Each V02 model will provide:

- a typed attribute interface
- creation attributes
- a model class
- an initialization function
- an explicit physical table name
- timestamps, indexes, and constraints

Register the models through:

- `db-models/src/models/_index.ts`
- `db-models/src/models/_associations.ts`
- `db-models/src/models/_loadOrder.ts`

The existing dynamic model exports will then make the tables available to API, db-manager backup, restore, and test setup.

### 4.2 Worker-python queue

Reuse the existing global queue engine for:

- job IDs
- durable JSON queue records
- queued and running statuses
- cancellation events
- latest-job lookup
- restart reconciliation

V02 will add its own database run record. The queue record remains the operational job record, while `AiApproverRunsV02` becomes the durable product and audit record.

### 4.3 API proxy

Reuse authenticated worker-python proxy patterns in:

- `api/src/routes/newsOrgs/automations.ts`

Reuse authenticated analysis-route patterns from:

- `api/src/routes/analysis/ai-approver.ts`
- `api/src/app.ts`

V02 receives separate namespaces and never reuses V01 route paths.

### 4.4 Portal automation controls

Reuse:

- `CollapsibleAutomationSection`
- `WorkerPythonJobStatusPanel`
- existing modal and alert components
- the authenticated fetch pattern

Create an `AiApproverV02RunStatusPanel` that composes the existing generic panel with a V02 database-run summary. Leave existing generic consumers unchanged.

### 4.5 Article review

Reuse the current review-page pattern:

1. load article rows
2. fetch AI data in article-ID batches
3. merge AI fields into portal article objects
4. render a table column
5. open a details modal
6. refresh one article after a modal update

V02 types, fields, endpoints, column, and modal remain independent from V01.

## 5. Target Architecture

### 5.1 Component flow

The first-release flow will be:

1. Portal requests a V02 preview through the API.
2. API proxies the request to worker-python.
3. Worker-python resolves the eligible article IDs in PostgreSQL.
4. Worker-python stores a draft run and frozen selection snapshot.
5. Portal displays the planned eligible count and resolved boundaries.
6. Portal confirms the draft run.
7. Worker-python accepts the run transactionally and enqueues it.
8. The queue runner processes the frozen IDs newest to oldest.
9. Worker-python updates prediction and run rows after each attempt.
10. Portal refreshes queue and V02 run status.
11. The review page reads V02 predictions through the API.
12. Human validation writes directly through authenticated V02 API routes.

### 5.2 Data ownership

- db-models owns schema definitions and associations.
- db-manager owns production schema installation.
- worker-python owns selection, model execution, prediction writes, retries, circuit breakers, run status, and cancellation reconciliation.
- API owns authenticated proxying, prompt management, prediction reads, and human-review writes.
- Portal owns operator configuration, status presentation, prompt forms, review display, and V01 visibility.

### 5.3 Namespace isolation

Use:

- Python module: `src.modules.ai_approver_v02`
- Python route: `src.routes.ai_approver_v02`
- Worker prefix: `/ai-approver-v02`
- API automation prefix: `/automations/ai-approver-v02`
- API analysis prefix: `/analysis/ai-approver-v02`
- Portal prompt path: `/articles/automations/ai-approver-v02-prompts`
- Environment prefix: `AI_APPROVER_V02_`

Do not rename existing V01 modules, routes, models, tables, or environment variables.

## 6. Database Design

### 6.1 Prompt model

Add:

- model `AiApproverPromptVersionV02`
- table `AiApproverPromptVersionsV02`

Core fields:

- `id`
- `title`
- `promptInMarkdown`
- `isActive`
- `firstUsedAt`
- timestamps

Use a partial unique index for non-null titles. Normalize blank titles to null before persistence.

Protect the single-active-prompt rule with a transaction and a partial unique active index where practical. API activation will deactivate the current prompt and activate the target in one transaction.

### 6.2 Run model

Add:

- model `AiApproverRunV02`
- table `AiApproverRunsV02`

The run model supports:

- draft previews
- accepted queue jobs
- frozen article selections
- active-run enforcement
- run counters
- cancellation and circuit-breaker reasons
- operator-visible history

Add `draft` as an internal status in addition to the PRD terminal and queue statuses. Draft rows have a preview token and selection snapshot but no queue job ID.

Add `expired` as a terminal preview status. It represents a preview that was never accepted and must not be reported as an execution failure.

Core fields include:

- prompt and queue references
- selection mode and options
- resolved highest and boundary article IDs
- selection snapshot
- planned and actual counts
- model name
- status and ending reason
- preview expiration
- run timestamps

Store one selection object per article:

- `articleId`
- `contentSource`
- nullable `articleContents02Id`

Do not duplicate article content or rendered prompts. The snapshot freezes the selected article and content source, not the source text.

Add an index covering status and preview expiration so stale drafts can be expired efficiently.

Define run readers consistently:

- active-run queries include only `queued` and `running`
- execution history and latest-run queries exclude `draft` and `expired`
- success, failure, cancellation, and circuit-breaker metrics exclude `draft` and `expired`
- preview administration may query every status

### 6.3 Prediction model

Add:

- model `AiApproverArticlePredictionV02`
- table `AiApproverArticlePredictionsV02`

The table keeps one application-managed row per article.

Core fields include:

- article, prompt, and latest-run references
- result status and nullable prediction
- reasoning and error fields
- `attemptCount`
- model and pipeline versions
- content source and bounded metadata
- nullable human validation and comment
- timestamps

Do not add a database unique constraint on `articleId`. Centralize every create or update through the worker repository and enforce only one active V02 run.

### 6.4 Associations and load order

Define:

- prompt has many runs
- prompt has many predictions
- article has one V02 prediction
- run has many predictions
- each run and prediction belongs to its referenced parent

Load prompts before runs, articles before predictions, and runs before predictions.

### 6.5 Production schema installer

Add a standalone db-manager script and package command dedicated to V02 schema creation.

The installer will:

- initialize the shared models
- inspect existing tables with `queryInterface.describeTable`
- inspect indexes and foreign keys with query-interface metadata methods
- validate complete existing V02 tables against required columns, types, nullability, indexes, and references
- call `sync` only for absent V02 models in dependency order
- use no `force` or `alter` option
- create only the three V02 tables, indexes, and foreign keys
- treat a complete compatible installation as a no-op
- fail before mutation when an existing V02 table is partial or incompatible
- print a concise operation summary
- return a nonzero exit code on failure

Document:

- workstation command
- production command
- required environment
- backup precondition
- verification query
- rollback order

Rollback remains an explicit operator-run procedure because dropping the V02 tables destroys V02 data.

## 7. Preview and Run Acceptance

### 7.1 SQL-side preview

Resolve selection in PostgreSQL rather than loading a broad Mode B range into Python memory.

The query design will use CTEs, lateral joins, or `DISTINCT ON` to resolve:

- highest current article
- approved boundary
- positional Mode A range
- unbounded-to-boundary Mode B range
- latest state row by highest ID
- latest usable content row by highest ID
- approved exclusion
- existing V02 result and retry eligibility
- description fallback

Return eligible IDs in descending order with the chosen content source.

### 7.2 Boundary behavior

Mode A:

- uses the requested article-position count
- truncates at the approved boundary by default
- continues through the positional range when no boundary exists
- may cross an existing boundary only when explicitly enabled

Mode B:

- requires an approved boundary
- fails preview clearly when no boundary exists
- never silently scans to the oldest article

### 7.3 Draft preview

When the preview has eligible articles:

- create a draft run
- store the resolved article IDs, chosen content sources, chosen content-row IDs, and options
- generate a short-lived preview token
- return the run ID, token, bounds, and counts

When the preview has zero eligible articles:

- return a clear no-eligible result
- create no draft or queue job

Expired drafts cannot be started.

Centralize preview maintenance in one repository operation. Before preview creation, acceptance, and preview-administration reads, it will:

1. atomically change past-expiration `draft` rows to `expired`
2. set `endingReason = preview_expired` and the end timestamp
3. remove expired preview rows after a configurable retention period

Use `AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS` with a default of seven days. It applies only to unaccepted previews. Accepted run history is never removed by this maintenance operation.

### 7.4 Transactional acceptance

Run acceptance will:

1. take a PostgreSQL transaction-scoped advisory lock for V02 acceptance
2. lock and validate the draft run
3. verify the preview token and expiration
4. verify no V02 run is queued or running
5. verify the prompt still exists and is active
6. mark the prompt used
7. promote the draft to queued
8. commit before enqueueing

After commit:

- enqueue the existing queue handler with the V02 run ID
- write the returned queue job ID to the run
- mark the run failed if enqueueing fails

The queued database status blocks another acceptance during the short enqueue window.

## 8. Worker-Python V02 Module

### 8.1 Configuration

Create a V02 configuration object that validates:

- PostgreSQL connection settings
- `AI_APPROVER_V02_MODEL_NAME`
- `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`
- `AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS`
- Codex CLI availability

Default the model to `gpt-5.4-mini`.

V02 validation remains mandatory. V01 validation becomes nonfatal and on demand only after V02 validation exists.

### 8.2 Prompt renderer

Keep three layers separate:

1. stored operator prompt
2. hardcoded article title and content wrapper
3. hardcoded JSON response contract

Define a hardcoded `pipelineVersion`. Increment it whenever either hardcoded layer changes.

The renderer takes title and selected content as values. It does not perform user-managed placeholder replacement.

### 8.3 Codex client

Adapt the proven Harness02 behavior:

- ephemeral `codex exec`
- read-only sandbox
- neutral temporary working directory
- configured model and timeout
- final-message output file
- temporary-file cleanup
- JSON-object extraction
- normalized failure and invalid-response outcomes

Do not carry over harness report, Excel, source-file, or dataset code.

Each article receives one logical Codex invocation per run. The runner does not retry that article again during the same run.

### 8.4 Repository

The repository will provide focused operations for:

- preview SQL
- draft creation and lookup
- stale-draft expiration and expired-preview retention
- acceptance locking
- active-run lookup
- prompt resolution and first-use marking
- article hydration from frozen selection objects
- first-attempt insert
- retry update
- per-result run-counter updates
- cancellation and terminal status

Use transactions for acceptance and any multi-row state transition. Keep model execution outside database transactions.

### 8.5 Orchestrator

The orchestrator reads the frozen selection and processes IDs in order.

The snapshot contract is:

- a scraped-content selection reloads the exact `ArticleContents02` row recorded by ID
- a description selection reloads the same article's description
- execution never chooses a newer content row or changes to another source
- a missing, unsuccessful, or blank recorded source is skipped
- a skipped source increments the run's skipped count and creates no prediction row

For each selection object:

1. stop if cancellation is requested
2. load and validate the exact recorded content source
3. determine whether the row is a first attempt or permitted retry
4. resolve the active prompt for a new article or original prompt for a retry
5. render and invoke Codex
6. validate the payload
7. persist the outcome
8. update run counters
9. update circuit-breaker counters

Unattempted articles receive no prediction row.

### 8.6 Retry updates

A retry updates the existing row and increments `attemptCount` to 2.

Refresh:

- latest run reference
- model and pipeline versions
- content source and metadata
- status, prediction, and reasoning
- error code and message
- update timestamp

Preserve:

- row and article IDs
- original prompt relationship
- creation timestamp
- human validation and comment

### 8.7 Circuit breakers

Maintain two independent counters since the most recent completed prediction:

- CLI failures
- invalid responses

A failure of one type does not reset the other counter. A completed prediction resets both.

Stop when:

- CLI failures reach three
- invalid responses reach five

Persist the breaker type and partial counts before ending the run with `circuit_breaker`.

### 8.8 Cancellation and status

Reuse the queue cancellation event.

The runner will:

- check cancellation before every article
- stop without creating rows for remaining IDs
- persist the run as canceled
- retain completed attempt results

Expose V02 run details alongside existing queue status so the portal can show product counts without replacing generic queue behavior.

## 9. API Integration

### 9.1 Automation proxy

Create `api/src/routes/automations/ai-approver-v02.ts` and mount it at:

- `/automations/ai-approver-v02`

Provide authenticated routes for:

- preview
- start
- latest run
- run details
- cancel

Proxy preview and start to worker-python. Extract the worker-python base-URL and Axios error-forwarding helpers into a shared API module, then use it from both the existing router and the V02 router without changing V01 behavior.

Generic queue status and cancel routes remain available. V02-specific status responses should include the database run summary.

### 9.2 Analysis router

Create `api/src/routes/analysis/ai-approver-v02.ts` and mount it at:

- `/analysis/ai-approver-v02`

Group:

- prompt CRUD without deletion
- prompt activation
- batch prediction reads
- article detail reads
- human-validation updates
- human-comment updates

Use strict request validation, authenticated routes, Sequelize transactions, and specific error statuses.

### 9.3 Prompt integrity

Create and edit routes normalize titles.

Edit checks `firstUsedAt` before updating. Activation changes the active prompt transactionally and never edits a used prompt.

The worker acceptance transaction independently marks first use. This protects integrity even when the worker is called directly.

### 9.4 Review writes

Human validation and comment endpoints update only their requested fields.

Support:

- true
- false
- null
- comment text
- null comment

Clearing one field does not clear the other. Prediction and audit fields are never writable through review endpoints.

## 10. Portal Integration

### 10.1 V02 automation section

Create a dedicated V02 component rather than extending the V01 component.

The section will:

- display the active prompt
- open the configuration modal
- request and render previews
- confirm a frozen preview
- block while another V02 run is active
- refresh status
- cancel the queue job
- link to V02 prompt management

The V02 status wrapper renders the generic queue panel and a separate V02 run-summary panel. Preserve existing behavior for location scorer, V01, and other consumers.

### 10.2 Configuration modal

The modal owns:

- Mode A and Mode B radio selection
- count input with default 25
- past-boundary checkbox
- description-fallback checkbox
- preview request
- boundary state
- eligible count
- preview expiration
- confirm and close actions

Mode B is disabled when no approved boundary exists. Confirmation is disabled for zero eligible results or expired previews.

### 10.3 Prompt page

Create:

- `/articles/automations/ai-approver-v02-prompts`

The page supports:

- prompt list
- optional unique title
- required prompt text
- creation
- editing unused prompts
- activation and deactivation
- used and active status
- fallback labels for blank titles

Do not include delete controls, model controls, article placeholders, or response-schema fields.

### 10.4 Review data loading

Add a V02 batch fetch beside the existing V01 top-score fetch.

Use the current chunked article-ID pattern to avoid oversized requests. Merge V02 fields into typed portal article rows without reusing V01 field names.

### 10.5 Review column and modal

Add an `AI Approver V02` column that is visible by default.

The cell shows:

- `approved`
- `irrelevant`
- `N/A`

Completed predictions open a new V02 modal. The modal shows reasoning and audit details, then provides independent validation and comment controls.

After a save, refresh only the affected article's V02 data.

### 10.6 V01 portal changes

On `/articles/automations`:

- remove the V01 orchestrator and V01 approver components from the rendered page
- keep their source files
- rename their internal visible titles to include V01

For the V01 prompt route:

- add a server layout that calls Next.js `notFound()`
- leave the existing client page file in place
- remove navigation links
- do not redirect to V02

For review:

- label the V01 column clearly
- initialize it as hidden
- preserve its modal and data requests

## 11. V01 Worker Startup Isolation

After V02 configuration is wired:

- remove V01 validation from the fatal startup validation block
- run V01 validation in a nonfatal warning path
- keep shared queue, database, other worker, and V02 validation fatal
- preserve V01 runner-level `AiApproverConfig.from_env()` checks
- ensure invalid direct V01 jobs end with a clear configuration failure

Do not weaken shared PostgreSQL or Codex requirements needed by V02.

Regression tests will prove:

- worker-python starts when only V01 configuration is invalid
- V02 still rejects invalid V02 configuration
- direct V01 requests still queue and fail clearly
- unrelated routes continue to start

## 12. Documentation and Repository Guidance

Update root and package guidance to define:

- existing AI Approver as V01
- binary prediction workflow as V02
- unchanged V01 source naming
- distinct V02 namespaces
- manual-only V02 release behavior

Keep all feature documents in `docs/ai-appover-v02`.

After implementation, create the required follow-up report covering:

- final V01 and V02 boundaries
- naming confusion found during delivery
- any changes needed for a future V01 removal plan

Preserve the pre-implementation report.

## 13. Implementation Phases

### Phase 0: documentation gate

Produce and approve the V01 safe-removal report. No product code begins before this gate.

### Phase 1: schema foundation

Add the three models, associations, load order, schema installer, and database tests. This phase establishes the types and tables required by every other package.

Build db-models before installing its local dependency into consumers.

### Phase 2: worker core

Add V02 configuration, rendering, Codex client, repository, preview SQL, run acceptance, orchestrator, routes, status, cancellation, and worker tests.

Keep worker work isolated from V01 except for the deliberate startup-validation change.

### Phase 3: API surface

Add V02 proxy and analysis routes, prompt management, review reads and writes, error handling, route mounting, and API tests.

### Phase 4: portal experience

Add automation controls, preview modal, status, prompt page, review column, details modal, and V01 visibility changes.

Run portal lint and build before considering this phase complete.

### Phase 5: integration and regression

Exercise the complete preview-to-review flow against a test database. Verify cancellation, circuit breakers, retries, prompt locking, one-row behavior, V01 startup isolation, and direct V01 access.

### Phase 6: deployment preparation

Finalize:

- production schema command
- backup and rollback procedure
- environment documentation
- smoke-test instructions
- post-implementation report template

Implementation remains unshipped until the operator approves the production procedure.

## 14. Validation Strategy

### 14.1 db-models

Run:

```bash
cd db-models
npm run build
```

Validate model initialization through API and db-manager test database setup.

### 14.2 db-manager

Run:

```bash
cd db-manager
npm run build
npm test -- --runInBand
```

Test the schema installer against:

- empty V02 schema
- already-installed compatible schema
- intentionally partial incompatible schema
- compatible tables with a missing required index or foreign key

### 14.3 worker-python

Run the focused V02 unit and integration suites, then the complete worker suite:

```bash
cd worker-python
pytest tests/unit/ai_approver_v02 tests/integration/test_ai_approver_v02_routes.py
pytest
```

Use mocked Codex execution for automated tests. A live Codex smoke test requires explicit operator approval.

Cover:

- stale draft expiration and retention
- exclusion of draft and expired previews from history, latest-run, and metrics
- exact content-row reuse after a newer content row appears
- skipped accounting when the frozen source becomes unusable
- rejection of expired preview acceptance

### 14.4 API

Build db-models first, then run:

```bash
cd api
npm run build
npm test -- --runInBand
```

Add focused route and module tests for V02.

### 14.5 Portal

Run:

```bash
cd portal
npm run lint
npm run build
```

Perform manual browser verification for:

- both preview modes
- no-boundary behavior
- zero-result behavior
- start conflict
- cancellation
- prompt editing and activation
- V01 not-found route
- V01 and V02 review-column defaults
- validation clearing and comment-only saves

## 15. Integration Scenarios

The implementation must demonstrate these end-to-end scenarios.

### 15.1 New prediction

An eligible article receives a completed prediction, appears in review, and accepts independent human validation and comment updates.

### 15.2 Failed prediction retry

A first attempt fails, a later run updates the same row with `attemptCount = 2`, and no later automatic retry occurs.

### 15.3 Prompt transition

A used prompt becomes immutable, a new prompt activates, completed articles remain skipped, and eligible new articles use the new prompt.

### 15.4 Interrupted run recovery

A canceled run leaves unattempted articles without rows. Reopening the same positional range skips completed rows and selects eligible unattempted or retryable rows.

### 15.5 Missing approved boundary

Mode A previews its requested range without truncation. Mode B returns a clear unavailable-boundary result and creates no run.

### 15.6 Circuit breaker

Alternating CLI failures and invalid responses cannot evade both independent counters. The run stops at the first reached threshold and persists partial counts.

### 15.7 V01 isolation

V01 cards and prompt navigation are inaccessible, its review data remains available in a hidden column, direct backend calls remain possible, and invalid V01 configuration does not stop startup.

### 15.8 Abandoned preview

An unaccepted preview becomes expired, never appears as a failed execution, is excluded from run metrics and latest-run status, and becomes eligible for retention cleanup.

### 15.9 Frozen content source

A newer content row created after preview does not replace the frozen row. If the frozen source becomes unusable, the article is skipped without creating a prediction row.

## 16. Rollout Plan

### 16.1 Pre-deployment

- back up the production database
- confirm Codex CLI authentication and `gpt-5.4-mini` access
- deploy and build db-models
- run the dedicated schema installer
- verify the three tables and indexes

### 16.2 Service deployment

Deploy in this order:

1. worker-python
2. API
3. portal

Do not expose the portal before API and worker V02 health checks pass.

### 16.3 Production smoke test

Use a small Mode A range.

Verify:

- preview count
- one queued run
- one or more persisted predictions
- status refresh
- review modal
- human validation
- no V01 startup regression

### 16.4 Rollback

Portal rollback restores V01 visibility behavior and removes V02 entry points without deleting data.

API and worker rollback remove V02 runtime access while leaving the V02 tables intact.

Do not drop V02 tables during normal application rollback. Table removal requires a separate operator-approved destructive procedure after backup.

## 17. Risk Controls

### 17.1 Duplicate prediction rows

Control with:

- single active V02 run
- transaction-scoped acceptance lock
- centralized worker writes
- existing-row lookup before insert
- retry-by-update
- duplicate-row integration tests

### 17.2 Preview drift

Control with:

- database draft run
- frozen article, content-source, and content-row selection
- preview token and expiration
- no silent recalculation at start
- no content-source re-resolution during execution
- skip accounting when a frozen source becomes unusable

### 17.3 Large Mode B selection

Control with:

- SQL-side eligibility filtering
- bounded selection metadata without duplicated content
- incremental article hydration during execution
- no full article-content collection in Python memory

### 17.4 Prompt race

Control with:

- acceptance transaction
- first-use timestamp set before enqueue
- API and worker immutability checks

### 17.5 Queue and database divergence

Control with:

- accepted run ID passed into the queue job
- failed status when enqueueing fails
- terminal run update in runner cleanup
- startup or status reconciliation for stale queued and running V02 rows

### 17.6 V01 regression

Control with:

- no V01 source renames
- portal-only access changes
- direct endpoint regression tests
- on-demand V01 validation
- retained historical tables and review modal

## 18. Implementation Boundaries

Do not add:

- V02 weekly orchestration
- automatic article approval
- arbitrary article-ID targeting
- completed-article reprocessing
- prompt deletion
- a third prediction
- rendered-prompt persistence
- a general migration framework
- V01 code or table deletion

If implementation reveals a need for any boundary change, stop and return to the operator rather than expanding scope.

## 19. Plan Completion Criteria

The plan is ready for assessment when it:

- maps every accepted PRD component to an implementation area
- identifies package boundaries and ownership
- defines preview freezing and run locking
- defines retry and circuit-breaker behavior
- preserves V01 backend compatibility
- names validation and rollout gates
- leaves no moderate implementation ambiguity

After the assessing agent accepts the latest plan, this planner becomes the default todo creator under the plan-and-vet workflow.
