---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Product Requirements Document

## 1. Document Status

- Status: first implementation PRD
- PRD revision: V02
- Supersedes: `20260723_ai_approver_v02_prd_v01.md`
- Assessment incorporated: `20260723_ai_approver_v02_prd_v01_assessment_claude.md`
- Product name: AI Approver V02
- Worker flow name: `ai-approver-v02`
- Primary users: authenticated NewsNexus operators
- Delivery scope:
  1. V02 prediction workflow
  2. V02 prompt management
  3. V02 run management
  4. V02 review and human validation
  5. V01 portal hiding and startup isolation
  6. database deployment and documentation

This PRD is the authoritative product specification for the first AI Approver V02 release. Resolved decisions in the pre-PRD issues document override conflicting or stale language in the earlier assessments.

## 2. Source Documents

This PRD consolidates:

- `20260723_first_instructions_explore_ai_approver.md`
- `20260723_ai_approver_v02_assessment.md`
- `20260723_ai_approver_v02_assessment_claude.md`
- `20260723_first_instructions_explore_ai_approver_v02_pre_prd_issues.md`
- the behavior proven by `/Users/nick/Documents/NewsNexus12-ArticleApproverHarness02`

The harness repository is a reference implementation. Selected logic may be adapted or copied during implementation, but its folder structure and unrelated files must not be imported wholesale.

## 3. Executive Summary

AI Approver V02 will classify news articles as either `approved` or `irrelevant`. It will use one operator-managed prompt, hardcoded worker instructions, article data injected by worker-python, and the Codex CLI.

Operators will start V02 manually from `/articles/automations`. They may scan a fixed number of article positions or scan backward to the most recent approved-article boundary. V02 will write independent prompt, prediction, and run records.

V02 predictions will be advisory. They will appear in a new review-table column with a modal for reasoning, optional human validation, and optional comments.

AI Approver V01 will not be removed. Its automation controls and prompt page will be hidden, its review column will remain available but hidden by default, and its direct backend endpoints will remain callable.

## 4. Problem Statement

The current AI Approver flow combines numeric scoring, multiple prompt roles, gatekeeper behavior, orchestration dependencies, and legacy review behavior. It does not match the simpler binary classifier validated by ArticleApproverHarness02.

The new workflow must:

1. provide a predictable binary decision
2. preserve prompt and prediction integrity
3. keep V01 and V02 data isolated
4. allow controlled manual runs
5. recover safely from failures without duplicating article rows
6. collect human validation without affecting downstream article decisions

## 5. Goals

### 5.1 Product goals

- Classify eligible articles as `approved` or `irrelevant`.
- Give operators two understandable article-selection modes.
- Let operators manage one active V02 prompt.
- Preserve the prompt version used for each prediction.
- Expose predictions and reasoning in the article review table.
- Capture optional human validation and comments.
- Keep every V02 run observable and cancellable.
- Prevent concurrent V02 runs.
- Hide V01 portal entry points without deleting V01 code or data.

### 5.2 Safety goals

- Never convert an execution failure into an `irrelevant` prediction.
- Never create multiple V02 prediction rows for one article.
- Never automatically rerun a completed prediction.
- Allow no more than one later retry for a failed or invalid response.
- Stop a run after defined consecutive-failure thresholds.
- Prevent used prompts from being edited.
- Prevent V01 configuration problems from stopping worker-python startup.

## 6. Non-Goals

The first release will not:

- remove V01 code, routes, tables, or historical data
- rename V01 source files, routes, models, tables, or orchestration step names
- add V02 to the weekly orchestrator
- automatically approve or reject articles
- change reports, filtering, or downstream workflows based on V02 predictions
- add a third prediction such as `needs_review`
- delete V02 prompts
- automatically reprocess completed articles after a prompt change
- provide arbitrary article-ID ranges
- create a general database migration framework
- store the complete rendered prompt in each prediction row

## 7. Terminology

### 7.1 AI Approver V01

`AI Approver V01` is the reference name for the existing AI Approver implementation. This label is for documentation and portal clarity only.

### 7.2 AI Approver V02

`AI Approver V02` is the new binary-prediction workflow implemented under separate routes, modules, models, tables, environment variables, portal components, and tests.

### 7.3 Prediction

A prediction is one of:

- `approved`
- `irrelevant`

Operational outcomes such as `failed` and `invalid_response` are result statuses, not predictions. Cancellation is a run status.

### 7.4 Article position count

The count-mode input describes how many article records to scan backward in descending `articleId` order. It does not promise the same number of eligible model calls.

### 7.5 Approved boundary

The approved boundary is the highest `ArticleApproveds.articleId` whose row has `isApproved = true`. The boundary article is excluded, and scanning stops before it unless the operator explicitly enables scanning past it.

When no approved boundary exists:

- Mode A proceeds across its requested article positions without boundary truncation.
- Mode A displays that no approved boundary was found.
- Mode A's past-boundary checkbox is disabled because it has no effect.
- Mode B is unavailable and must not scan to the oldest article.
- Mode B preview and start requests return a clear boundary-unavailable error.

### 7.6 No continuation watermark

V02 has no last-processed watermark. Every run resolves its range from current article data and skips articles according to stored V02 results.

## 8. User Experience

### 8.1 Automations page

Add a visible `AI Approver V02` section to `/articles/automations`.

The section must include:

- a control to open the run-configuration modal
- the active prompt name or fallback label
- the latest V02 job status
- a manual refresh control matching the existing worker-python pattern
- a cancel action for queued or running V02 jobs
- a link to the V02 prompt-management page

The start control must be disabled when:

- another V02 run is queued or running
- no prompt is active
- more than one prompt is active
- required preview or configuration data cannot be loaded

### 8.2 Run-configuration modal

The modal must present two mutually exclusive modes.

#### Mode A: article position count

- The operator enters a positive article count.
- The default count should be `25`.
- No product-level maximum is required.
- The system scans that many article records backward from the highest current `articleId`.
- Eligibility filters may reduce the number of model calls.
- By default, the range is truncated before the approved boundary.
- A checkbox allows the range to continue past the approved boundary.
- Approved articles remain excluded even when scanning past the boundary.
- When no boundary exists, the requested positional range proceeds without truncation.

#### Mode B: until last approved article

- The system scans backward from the highest current `articleId`.
- The scan stops before the approved boundary.
- The modal displays the number of eligible model calls.
- The boundary is based only on rows where `isApproved = true`.
- When no boundary exists, the mode is disabled with a clear explanation.

#### Shared controls

Both modes must include:

- a default-on requirement for usable scraped content
- an explicit checkbox allowing description-only articles
- a preview of the resolved range
- a preview count after all eligibility and retry filters
- a confirmation action
- a cancel or close action that starts no job

The modal must label the preview as planned eligible model calls. Cancellation, a circuit breaker, or a runtime failure may cause the final attempted count to be lower.

When a preview resolves zero eligible model calls:

- show a clear no-eligible-articles message
- disable confirmation
- do not create a no-op run

### 8.3 Preview consistency

The confirmed run must use the selection resolved for the displayed preview.

Implementation may satisfy this with:

- a short-lived selection token
- a draft run containing a selection snapshot
- another mechanism that prevents selection from being silently recalculated

If the preview expires or becomes invalid, the portal must require a refreshed preview before starting the run.

### 8.4 Run status

The automation section must show:

- run ID or queue job ID
- run status
- selection mode
- planned eligible count
- attempted count
- completed count
- failed count
- invalid-response count
- skipped count
- cancellation or circuit-breaker reason
- start and end timestamps when available

Status refresh may use the existing manual refresh pattern. Automatic polling is optional for the first release.

### 8.5 Concurrent runs

- Only one V02 run may be queued or running at a time.
- The portal must block duplicate submissions.
- Worker-python must independently enforce the rule.
- A race or direct API call must receive a clear conflict response.
- V01 jobs do not count as V02 runs for this rule.

## 9. Article Selection and Eligibility

### 9.1 Ordering

- Resolve the highest current `Articles.id` when the preview is created.
- Process selected articles in descending `articleId` order.
- Do not use a continuation watermark.
- Reopening the same range is allowed so interrupted work can be recovered.

### 9.2 Approval filter

An article is excluded when:

- an `ArticleApproveds` row exists for the article
- that row has `isApproved = true`

Rows with `isApproved = false` do not exclude the article.

### 9.3 State-assignment filter

An article is eligible only when its latest `ArticleStateContracts02` row:

- has an integer `stateId`
- has `isDeterminedToBeError` set to false

Resolve the latest state row by highest row ID.

An older valid row does not qualify an article when the latest row is invalid.

Runtime repository review confirms that worker-node's state assigner creates `ArticleStateContracts02` rows. Existing API routes may update those rows, so no additional source column is required for this release.

### 9.4 Scraped-content filter

By default, an article is eligible only when its latest successful `ArticleContents02` row:

- has `status = 'success'`
- has nonblank `content`

When multiple usable rows exist:

- use the row with the highest row ID
- take content from that row
- take the title from `Articles.title`

### 9.5 Description-only override

When the operator explicitly enables description-only processing:

- an article with no usable scraped-content row may use a nonblank `Articles.description`
- the content source must be recorded in prediction metadata
- blank descriptions remain ineligible

This override must be off by default for every new run.

### 9.6 Prior V02 result filter

- An article with a completed V02 prediction is ineligible.
- A new active prompt does not make a completed article eligible again.
- An article with `attemptCount >= 2` is ineligible.
- An article with a first-attempt `failed` or `invalid_response` status is eligible for one later retry.
- An article without a V02 row is eligible when all other filters pass.

### 9.7 Positional range behavior

Count mode scans the chosen number of article positions, not a target number of attempts.

Example:

1. The operator chooses 100 article positions.
2. The selected range contains 100 article records.
3. Sixty records fail eligibility filters.
4. The run plans at most 40 model calls.
5. The run does not expand the range to find another 60 eligible articles.

## 10. Model Execution

### 10.1 Codex CLI

- Use the Codex CLI.
- Use `gpt-5.4-mini` by default.
- Allow the model to be changed through a V02-specific environment variable.
- Run Codex with an isolated, read-only, ephemeral invocation.
- Use a neutral working directory so repository context is not added.
- Capture only the final model response needed for parsing.

Recommended environment variables:

- `AI_APPROVER_V02_MODEL_NAME`
- `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`

V02 must not depend on V01 environment-variable names.

### 10.2 Single-prompt workflow

Each logical article attempt uses:

1. one stored operator prompt
2. one hardcoded article wrapper
3. one injected article title
4. one injected article content value
5. one hardcoded response instruction

The operator-managed prompt must not contain title or content placeholders that users are expected to maintain.

### 10.3 Response contract

Worker-python must instruct Codex to return only a JSON object equivalent to:

```json
{
  "decision": "approved",
  "reason": "One short sentence."
}
```

The parser must require:

- exactly one supported decision
- a nonblank reasoning string
- a JSON object

Any unsupported or malformed payload becomes `invalid_response` with a null prediction.

### 10.4 Pipeline version

- Worker-python must define a hardcoded `pipelineVersion`.
- Each prediction row must store the version used.
- Increment the version whenever the article wrapper or response instructions change.
- Changing only the operator prompt creates or edits a prompt version; it does not change `pipelineVersion`.

### 10.5 Same-run retries

- Do not rerun a failed or invalid article within the same V02 run.
- Persist the first outcome and continue to the next eligible article.
- A later run may perform the one permitted retry.

### 10.6 Cross-run retry

- A retry is allowed only when the existing row is `failed` or `invalid_response`.
- The retry must reuse the original prompt version associated with the row.
- The retry updates the existing prediction row.
- Increment `attemptCount` from 1 to 2.
- Update every attempt-derived field.
- No third attempt is allowed automatically.

Attempt-derived fields include:

- latest run reference
- model name
- pipeline version
- content source
- metadata
- result status
- prediction
- reasoning
- error code
- error message

The retry must preserve:

- row ID
- article ID
- original prompt-version relationship
- creation timestamp
- human-validation value
- human comment

A run may therefore use its active prompt for new articles while retrying an older row with that row's original prompt version.

### 10.7 Circuit breakers

Track two independent failure counters since the most recent completed prediction:

1. final Codex CLI failures
2. `invalid_response` outcomes

Rules:

- A Codex CLI failure increments only the CLI-failure counter.
- An invalid response increments only the invalid-response counter.
- Neither failure type resets the other failure counter.
- A completed prediction resets both counters.
- Stop when the CLI-failure counter reaches three.
- Stop when the invalid-response counter reaches five.
- Alternating failure types can therefore still trigger either breaker.
- The counters apply to final article outcomes, not internal parsing steps.
- The run must persist the circuit-breaker reason and all counts collected before stopping.

## 11. Prompt Management

### 11.1 Route

Create:

- `/articles/automations/ai-approver-v02-prompts`

This page must use only V02 APIs and V02 tables.

### 11.2 Prompt form

The prompt form contains:

- optional title
- required prompt text

The form must not expose:

- article title placeholders
- article content placeholders
- response-schema instructions
- model selection
- pipeline-version controls

### 11.3 Title rules

- Trim titles before persistence.
- Store a blank title as null.
- Multiple null titles may coexist.
- Non-null titles must be unique.
- Reject a duplicate non-null title with a clear validation error.
- Display a null title as `Prompt_id_{id}`.

### 11.4 Active prompt rules

- Zero active prompts are allowed outside a run.
- At most one prompt may be active.
- Starting a run requires exactly one active prompt.
- Activating one prompt must deactivate the previously active prompt transactionally.
- A previously used prompt may be reactivated without modification.

### 11.5 Editing and immutability

- An unused prompt may be edited.
- A used prompt may not be edited.
- A prompt becomes used when a run using it is accepted.
- Mark the prompt used in the run-acceptance transaction before article selection.
- Failed or empty runs do not make the prompt editable again.
- The portal and API must provide a clear immutable-prompt error.

### 11.6 Deletion

- Prompt deletion is not supported.
- The API must expose no V02 prompt-deletion operation.
- The portal must expose no delete control.

## 12. Database Requirements

### 12.1 Models and tables

Add three Sequelize models:

1. `AiApproverPromptVersionV02`
2. `AiApproverArticlePredictionV02`
3. `AiApproverRunV02`

Use these physical table names:

1. `AiApproverPromptVersionsV02`
2. `AiApproverArticlePredictionsV02`
3. `AiApproverRunsV02`

Register all three through the normal `db-models` initialization, export, association, load-order, backup, and import paths.

### 12.2 Prompt-version fields

`AiApproverPromptVersionsV02` must include at least:

- `id`
- `title`, nullable
- `promptInMarkdown`
- `isActive`
- `firstUsedAt`, nullable
- `createdAt`
- `updatedAt`

Constraints and indexes:

- partial uniqueness for non-null titles
- an index supporting active-prompt lookup
- database or transactional protection against more than one active prompt

### 12.3 Run fields

`AiApproverRunsV02` must include at least:

- `id`
- `jobId`
- `activePromptVersionId`
- `selectionMode`
- `requestedArticleCount`, nullable
- `allowPastApprovedBoundary`
- `allowDescriptionFallback`
- `highestArticleIdAtStart`
- `approvedBoundaryArticleId`, nullable
- `plannedEligibleCount`
- `attemptedCount`
- `completedCount`
- `failedCount`
- `invalidResponseCount`
- `skippedCount`
- `status`
- `endingReason`, nullable
- `modelName`
- `selectionSnapshot` or equivalent
- `startedAt`, nullable
- `endedAt`, nullable
- `createdAt`
- `updatedAt`

`activePromptVersionId` identifies the prompt used for new prediction rows. Retried rows retain their original prompt-version relationship.

Run statuses must distinguish at least:

- `queued`
- `running`
- `completed`
- `canceled`
- `failed`
- `circuit_breaker`

### 12.4 Prediction fields

`AiApproverArticlePredictionsV02` must include at least:

- `id`
- `articleId`
- `promptVersionId`
- `runId`, referencing the latest attempt's run
- `resultStatus`
- `prediction`, nullable
- `reasoning`, nullable
- `errorCode`, nullable
- `errorMessage`, nullable
- `attemptCount`
- `modelName`
- `pipelineVersion`
- `contentSource`
- `metadata`, nullable
- `humanValidation`, nullable
- `humanComment`, nullable
- `createdAt`
- `updatedAt`

### 12.5 Prediction constraints

- `prediction` may contain only `approved`, `irrelevant`, or null.
- `resultStatus` may contain only `completed`, `failed`, or `invalid_response`.
- `completed` rows require a non-null prediction and nonblank reasoning.
- Non-completed rows require a null prediction.
- `attemptCount` starts at 1 and may not exceed 2.
- `humanValidation` is nullable boolean.
- `humanComment` is nullable text.
- Metadata must not contain the complete rendered prompt or duplicate article content.

### 12.6 One row per article

The product rule is one V02 prediction row per `articleId`.

The first release will not use a database unique constraint for this rule. Instead:

- only one V02 run may execute at once
- all prediction writers must use centralized create-or-update logic
- retries must update the existing row
- no writer may insert a second row for an existing article
- tests must verify that duplicate starts and retries do not create duplicate rows

### 12.7 Relationships and indexes

Required relationships:

- prompt version has many predictions
- prompt version has many runs
- article has one V02 prediction
- run has many predictions

Required indexes:

- prediction `articleId`
- prediction `promptVersionId`
- prediction `runId`
- prediction `resultStatus`
- prediction `prediction`
- run `jobId`
- run `status`
- run `createdAt`
- prompt `isActive`

## 13. API Requirements

### 13.1 Authentication

All portal-facing V02 routes require the existing authenticated-user middleware.

### 13.2 Automation routes

Provide distinct V02 routes for:

- previewing a run selection
- starting a run
- fetching latest run status
- fetching a run by ID
- canceling a queued or running run

Required API namespace:

- `/automations/ai-approver-v02`

Required worker-python namespace:

- `/ai-approver-v02`

Do not reuse V01 `/ai-approver` routes.

### 13.3 Prompt routes

Provide V02 routes for:

- listing prompts
- creating a prompt
- editing an unused prompt
- activating a prompt
- deactivating the active prompt

Do not provide a delete route.

Required namespace:

- `/analysis/ai-approver-v02/prompts`

### 13.4 Review routes

Provide V02 routes for:

- fetching predictions for review-table article IDs
- fetching one article's V02 prediction details
- updating `humanValidation`
- updating `humanComment`
- clearing `humanValidation`
- clearing `humanComment`

Human validation and comments may be saved independently.

### 13.5 Error responses

Return clear errors for:

- no active prompt
- multiple active prompts
- prompt already used
- duplicate non-null title
- V02 run already active
- expired preview
- invalid count
- unavailable approved boundary
- zero eligible articles
- missing eligible content
- prediction row not found
- invalid human-validation value
- V02 configuration failure

## 14. Worker-Python Requirements

### 14.1 Module isolation

Create a separate V02 module and route package. Do not rename or repurpose the V01 `ai_approver` module.

Recommended Python namespace:

- `src.modules.ai_approver_v02`
- `src.routes.ai_approver_v02`

### 14.2 Repository responsibilities

The V02 repository must:

- resolve previews
- perform range and eligibility filtering in SQL
- avoid loading the complete Mode B article range into application memory
- apply all eligibility filters
- create and update run rows
- resolve and freeze prompts
- create first-attempt prediction rows
- update retry rows
- persist human-review-independent prediction data
- prevent a second active V02 run

### 14.3 Orchestrator responsibilities

The V02 orchestrator must:

- process the frozen selection in descending `articleId` order
- respect cancellation
- enforce circuit breakers
- perform no same-run article retry
- update counts after each outcome
- close the run with a terminal status
- leave unattempted articles without prediction rows

### 14.4 Client responsibilities

The Codex client must:

- invoke the configured model
- enforce a configurable timeout
- read the final response from a temporary output file
- remove temporary files
- parse a JSON object
- redact article text from surfaced error messages
- return a normalized completed, failed, or invalid-response outcome

## 15. Article Review Experience

### 15.1 V02 column

Add a new column to `TableReviewArticles`.

Requirements:

- The label must include `V02`.
- The column is visible by default.
- A completed row displays `approved` or `irrelevant`.
- An article without a completed prediction displays `N/A`.
- A displayed prediction is clickable.
- The column must use only V02 data.

### 15.2 Details modal

Clicking a V02 prediction opens a modal containing:

1. prediction
2. reasoning
3. prompt display name
4. model name
5. pipeline version
6. prediction timestamp
7. human-validation form
8. optional human-comment field

### 15.3 Human validation

The modal asks:

- `Was AI Approver V02 correct?`

Controls:

- `Yes` stores `humanValidation = true`.
- `No` stores `humanValidation = false`.
- Clearing the selection stores `humanValidation = null`.
- A comment may be saved with or without validation.
- Validation may be saved with or without a comment.
- Clearing either field must not clear the other.

### 15.4 Advisory behavior

V02 predictions and human validation must not:

- create an `ArticleApproveds` row
- change article relevance
- hide an article
- change reports
- alter orchestration
- trigger another workflow

## 16. V01 Coexistence Requirements

### 16.1 Terminology

Update repository guidance so coding agents understand:

- the existing flow is AI Approver V01
- the new binary-prediction flow is AI Approver V02
- V01 source names remain unchanged

### 16.2 Automations page

- Rename the existing portal labels to `Weekly Orchestrator V01` and `AI Approver V01`.
- Remove both V01 sections from `/articles/automations`.
- Do not delete their component files.
- Do not mount hidden controls in a way that remains keyboard-accessible.

### 16.3 V01 prompt page

- Remove navigation to `/articles/automations/ai-approver-prompts`.
- Requests to the V01 prompt page must render the portal's standard not-found page.
- Do not redirect to V02.
- Do not delete the V01 page file.

### 16.4 V01 review data

- Keep the existing V01 review column and modal behavior.
- Rename the visible label to include `V01` where needed for clarity.
- Make the V01 review column hidden by default.
- Do not modify or migrate V01 score data.

### 16.5 Direct backend access

- Existing V01 API and worker-python endpoints remain directly callable.
- V01 backend code remains installed.
- Existing integrations are not renamed.

### 16.6 V01 startup validation

- V01 configuration errors must not prevent worker-python from starting.
- Validate V01 configuration when a V01 job is requested.
- Return a clear V01 job error when its configuration is invalid.
- Log a nonfatal startup warning when V01 is unavailable.
- Keep shared database, queue, and V02 validation mandatory.

## 17. Deployment Requirements

### 17.1 Schema creation

Create a standalone db-manager script that:

- creates only the three V02 tables and their constraints
- is committed to the repository
- can be run manually against production
- does not require a general migration framework
- fails safely when prerequisites are missing
- reports whether each schema operation succeeded

The implementation plan must specify the exact command and rollback procedure.

### 17.2 Environment

Document:

- V02 model environment variable
- V02 timeout environment variable
- Codex CLI installation requirement
- Codex CLI authentication requirement
- production model availability

`gpt-5.4-mini` availability has been confirmed by the operator.

### 17.3 Deployment order

Use this order:

1. create the pre-implementation V01 removal report
2. deploy database models and schema script
3. run the schema script
4. deploy worker-python V02
5. deploy API V02
6. deploy portal V02 and V01 visibility changes
7. verify direct V01 backend behavior
8. perform a small V02 production run
9. verify review and human-validation writes

## 18. Documentation Requirements

### 18.1 Location

Store all V02 and V01-removal documentation in:

- `docs/ai-appover-v02`

Preserve the existing folder spelling.

### 18.2 Pre-implementation V01 removal report

Before V02 code is written, create a separate report that:

- inventories all V01 portal, API, worker, database, report, test, and documentation dependencies
- explains how V01 could later be removed safely
- identifies data-retention and backup concerns
- does not remove or modify V01

### 18.3 Post-implementation report

After V02 implementation:

- create a new or updated follow-up report
- identify naming or workflow confusion introduced by V02
- clarify the final V01 and V02 boundaries
- preserve the original pre-implementation report

### 18.4 Archiving

After the feature is complete, the operator may:

- archive the entire folder
- create a corresponding archive subfolder

Agents must not archive these documents without operator direction.

## 19. Testing Requirements

### 19.1 Database tests

Test:

- model initialization and exports
- associations and load order
- nullable and check constraints
- title uniqueness behavior
- zero or one active prompt
- prompt immutability
- one-row-per-article application behavior
- retry updates and `attemptCount`
- backup and import inclusion

### 19.2 Worker-python tests

Test:

- both selection modes
- approved-boundary resolution
- Mode A behavior when no approved boundary exists
- Mode B rejection when no approved boundary exists
- past-boundary override
- zero-eligible-preview blocking
- latest-state-row eligibility
- state error exclusion
- latest successful content selection
- description-only override
- completed prediction skipping
- one later retry
- retry updates every attempt-derived field
- retry preserves prompt and human-review fields
- no same-run retry
- both circuit breakers
- alternating failure-type circuit-breaker behavior
- cancellation
- single-run enforcement
- prompt freeze at run acceptance
- pipeline-version persistence
- JSON response validation
- temporary-file cleanup
- article-text error redaction

### 19.3 API tests

Test:

- authentication
- preview and frozen selection
- SQL-side preview filtering
- zero-eligible-preview rejection
- start conflict
- prompt create, edit, activate, and deactivate
- duplicate-title rejection
- used-prompt edit rejection
- absence of prompt deletion
- status and cancel routes
- prediction reads
- independent human-validation and comment updates
- clear error responses

### 19.4 Portal validation

Verify:

- V02 automation section
- modal mode switching
- preview counts
- boundary and description checkboxes
- active-run button states
- status refresh and cancellation
- V02 prompt page
- V02 review column visible by default
- V01 review column hidden by default
- V02 details and validation modal
- V01 automation sections absent
- V01 prompt URL returns not found
- strict TypeScript and ESLint compliance

### 19.5 Regression tests

Verify:

- V01 direct API remains callable
- V01 worker endpoint remains callable
- invalid V01 configuration no longer stops worker startup
- V01 invalid jobs fail clearly on demand
- unrelated worker-python jobs still start
- existing review data remains readable

## 20. Acceptance Criteria

The release is acceptable when all conditions below are met.

### 20.1 Workflow

- An authenticated operator can preview and start either V02 run mode.
- Preview selection applies every documented filter.
- Mode A proceeds safely when no approved boundary exists.
- Mode B is blocked when no approved boundary exists.
- A zero-eligible preview cannot start a run.
- Only one V02 run can be active.
- The run can be refreshed and canceled.
- Results are processed newest to oldest.

### 20.2 Predictions

- Completed outputs contain only `approved` or `irrelevant`.
- Failures never become predictions.
- Every article has at most one V02 prediction row through application behavior.
- Completed predictions are skipped in later runs.
- Failed or invalid rows receive at most one later retry.
- The retry updates the existing row and increments `attemptCount`.
- The retry refreshes all attempt-derived audit fields.
- Alternating failure types cannot bypass both circuit breakers.

### 20.3 Prompt integrity

- A run cannot start without exactly one active prompt.
- Used prompts cannot be edited.
- Used prompts can be reactivated unchanged.
- Blank titles use fallback labels.
- Nonblank duplicate titles are rejected.
- No prompt can be deleted.
- Every prediction references a prompt and pipeline version.

### 20.4 Review

- The V02 column is visible by default.
- The V01 column is hidden by default.
- Prediction reasoning opens in a modal.
- Human validation can be true, false, or null.
- Human comments are optional and independent.
- V02 remains advisory.

### 20.5 V01 isolation

- V01 automation controls are absent.
- The V01 prompt URL returns the standard not-found page.
- V01 source files and backend endpoints remain.
- V01 configuration cannot stop worker-python startup.
- Invalid direct V01 jobs return clear failures.

### 20.6 Deployment and documentation

- All three V02 tables exist in production.
- Schema deployment has a documented command and rollback.
- V02 environment variables are documented.
- The pre-implementation V01 removal report exists before coding begins.
- The post-implementation report is created after delivery.

## 21. Success Measures

Initial success is operational and qualitative.

Track:

- runs started and completed
- planned versus attempted calls
- completed, failed, and invalid-response counts
- circuit-breaker occurrences
- cancellation occurrences
- approved versus irrelevant predictions
- human-validation completion rate
- human-confirmed accuracy
- duplicate-row incidents
- V01 startup warnings and on-demand failures

Targets:

- zero duplicate V02 prediction rows
- zero completed predictions automatically rerun
- zero V02 decisions applied automatically downstream
- zero worker-python startup failures caused only by V01 configuration

## 22. Risks and Mitigations

### 22.1 Application-only uniqueness

Risk:

- A future writer could bypass centralized update logic.

Mitigations:

- one active V02 run
- centralized repository writes
- duplicate-row tests
- documentation for every writer
- reconsider a database constraint in a later version

### 22.2 Preview drift

Risk:

- Article or eligibility data may change between preview and confirmation.

Mitigation:

- freeze or tokenize the preview selection

### 22.3 Prompt race

Risk:

- An active prompt could be edited while a run begins.

Mitigation:

- mark the prompt used in the run-acceptance transaction

### 22.4 Model instability

Risk:

- Codex may fail, time out, or return malformed JSON.

Mitigations:

- strict parsing
- null predictions for errors
- one later retry
- circuit breakers
- configurable timeout

### 22.5 V01 and V02 confusion

Risk:

- Shared labels could cause operators or agents to use the wrong flow.

Mitigations:

- explicit V01 and V02 labels
- separate routes and tables
- repository guidance
- V01 portal hiding
- post-implementation clarification report

## 23. Future Considerations

The following require separate approval and are not part of this PRD:

- V02 weekly-orchestrator integration
- automatic downstream action from predictions
- completed-article reprocessing
- arbitrary article-ID targeting
- more than one prediction per article
- more than one active V02 prompt
- model abstention or `needs_review`
- V01 backend or table removal
- database-enforced article uniqueness
- prediction-attempt history rather than row replacement
