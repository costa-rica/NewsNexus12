---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V01 Safe-Removal Report

## 1. Report Status

- Purpose: pre-implementation dependency inventory
- Scope: existing AI Approver V01
- Related PRD: `20260723_ai_approver_v02_prd_v02.md`
- Related plan: `20260723_ai_approver_v02_plan_v02.md`
- Removal authorized: no
- V01 data deletion authorized: no
- Archive review included: no

This report identifies the dependencies that must be handled before V01 could be removed in a future project. The current V02 release may hide selected portal entry points, but it must preserve V01 source, data, routes, and direct backend behavior.

## 2. Current V01 Boundaries

V01 is the existing multi-prompt article-scoring and gatekeeper workflow.

Its durable database objects are:

- `AiApproverPromptVersions`
- `AiApproverArticleScores`

Its primary worker namespace is:

- `/ai-approver`

Its primary API namespaces are:

- `/automations/ai-approver`
- `/analysis/ai-approver`

Its portal surfaces include:

- the current AI Approver automation card
- the current weekly orchestrator card
- the V01 prompt-management page
- the V01 article-review column
- the V01 details and one-off scoring modals

## 3. Portal Dependencies

### 3.1 Automations page

- `portal/src/app/(dashboard)/articles/automations/page.tsx`
  - Imports and renders `AiApproverSection`.
  - Imports and renders `OrchestratorSection`.
- `portal/src/components/automations/AiApproverSection.tsx`
  - Starts `/automations/ai-approver/start-job`.
  - Reads generic worker-python latest-job and status routes.
  - Cancels through the generic worker-python cancel route.
  - Links to the V01 prompt-management page.
- `portal/src/components/automations/OrchestratorSection.tsx`
  - Presents the weekly orchestrator.
  - Lets the operator enable or disable its `ai_approver` step.
  - Displays V01 as step four in run history.

### 3.2 Prompt pages and navigation

- `portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx`
  - Lists, creates, copies, activates, and deletes V01 prompts.
  - Supports category and gatekeeper prompt fields.
  - Calls `/analysis/ai-approver` prompt routes.
- `portal/src/app/(dashboard)/analysis/ai-approver-prompts/page.tsx`
  - Redirects the older analysis URL to the current V01 prompt page.
- `portal/src/components/automations/AiApproverSection.tsx`
  - Contains the visible link to prompt management.

### 3.3 Article review

- `portal/src/app/(dashboard)/articles/review/page.tsx`
  - Fetches V01 category scores and gatekeeper results in article-ID batches.
  - Merges V01 fields into each article.
  - Refreshes V01 data after modal actions.
  - Opens the V01 details modal.
- `portal/src/components/tables/TableReviewArticles.tsx`
  - Sorts and renders the current AI Approver column.
  - Displays category scores, gatekeeper badges, and unavailable states.
  - Opens V01 details through `onAiApproverClick`.
- `portal/src/components/ui/modal/ModalAiApproverDetails.tsx`
  - Loads V01 article details.
  - Groups category and gatekeeper results.
  - Writes V01 human-verification state.
- `portal/src/components/ui/modal/ModalReviewArticleContent.tsx`
  - Loads V01 prompts and article content.
  - Starts one-off V01 review-page jobs.
- `portal/src/types/article.ts`
  - Defines V01 category-score and gatekeeper fields on article objects.

### 3.4 Current-release portal treatment

The V02 release may:

- stop rendering the V01 automation card
- stop rendering the weekly orchestrator card
- remove navigation to the V01 prompt page
- return the standard not-found page from the V01 prompt URL
- rename the review label to include V01
- make the V01 review column hidden by default

The V02 release must preserve:

- V01 component and page source
- V01 article data loading
- the V01 review column and details modal
- direct V01 backend calls

## 4. API Dependencies

### 4.1 Route mounting

- `api/src/app.ts`
  - Mounts `api/src/routes/newsOrgs/automations.ts` at `/automations`.
  - Mounts `api/src/routes/analysis/ai-approver.ts` at `/analysis/ai-approver`.

### 4.2 Automation proxy

- `api/src/routes/newsOrgs/automations.ts`
  - Provides authenticated `/ai-approver/start-job`.
  - Proxies the request to worker-python `/ai-approver/start-job`.
  - Provides generic worker-python latest-job, status, and cancel routes used by V01.
  - Owns worker-python base-URL and Axios error-forwarding helpers.

### 4.3 Analysis and review routes

- `api/src/routes/analysis/ai-approver.ts`
  - Lists and creates V01 prompts.
  - Copies prompts and changes active state.
  - Deletes prompts when no score rows reference them.
  - Loads article content for one-off review.
  - Starts one-off V01 worker jobs.
  - Reads article details and batch top scores.
  - Writes V01 human-verification fields.
  - Reads `AiApproverPromptVersion` and `AiApproverArticleScore`.

### 4.4 Admin database routes

- `api/src/routes/adminDb.ts`
  - Includes both V01 models in its explicit table registry.
- `api/src/modules/adminDb.ts`
  - Discovers exported models dynamically for backup and import operations.

### 4.5 API tests

- `api/tests/analysis/ai-approver.routes.test.ts`
- `api/tests/news-orgs/automations.routes.test.ts`
- `api/tests/admin/adminDb.routes.test.ts`
- `api/tests/modules/adminDb.module.test.ts`

These suites protect route behavior, proxying, prompt and score operations, and database administration coverage.

## 5. Worker-Python Dependencies

### 5.1 Startup and routing

- `worker-python/src/main.py`
  - Imports V01 startup validation.
  - Runs V01 validation in the fatal startup block.
  - Mounts the V01 router.
- `worker-python/src/routes/ai_approver.py`
  - Mounts `/ai-approver`.
  - Provides batch and review-page job entry points.
  - Enqueues V01 work in the shared queue.
  - Creates V01 configuration, repository, client, and orchestrator objects.

### 5.2 V01 workflow module

- `worker-python/src/modules/ai_approver/config.py`
  - Reads V01 database, backend, model, batch, mode, threshold, and timeout settings.
  - Validates the Codex CLI or OpenAI API backend.
- `worker-python/src/modules/ai_approver/repository.py`
  - Reads active V01 prompts and eligible articles.
  - Reads V01 score history.
  - Writes V01 score and failure rows.
- `worker-python/src/modules/ai_approver/orchestrator.py`
  - Runs category and gatekeeper prompt flows.
  - Applies V01 eligibility and mode behavior.
  - Persists V01 outcomes.
- `worker-python/src/modules/ai_approver/client.py`
  - Implements Codex CLI and OpenAI API model clients.
  - Parses category and gatekeeper response contracts.
- `worker-python/src/modules/ai_approver/errors.py`
  - Defines V01 configuration errors.

### 5.3 Prompt setup

- `worker-python/src/standalone/setup_ai_approver_prompt.py`
  - Reads and writes `AiApproverPromptVersions`.
  - Supports category and gatekeeper prompt roles.
- `worker-python/docs/prompts/AI_APPROVER_GATEKEEPER_CONSUMER_PRODUCT_V1.md`
  - Supplies an operator-managed gatekeeper prompt.

### 5.4 Shared queue dependencies

V01 uses the shared worker-python queue for:

- durable job IDs
- queued, running, completed, failed, and canceled statuses
- latest-job lookup by `/ai-approver/start-job`
- cooperative cancellation
- JSON-backed queue history

Removing V01 must not remove or change the shared queue behavior used by other workflows.

### 5.5 Worker tests

- `worker-python/tests/contracts/ai_approver_contract_spec.json`
- `worker-python/tests/contracts/test_ai_approver_contract.py`
- `worker-python/tests/integration/test_ai_approver_routes.py`
- `worker-python/tests/unit/ai_approver/test_client.py`
- `worker-python/tests/unit/ai_approver/test_config.py`
- `worker-python/tests/unit/ai_approver/test_orchestrator.py`
- `worker-python/tests/unit/ai_approver/test_repository.py`

## 6. Worker-Node and Weekly-Orchestrator Dependencies

### 6.1 Weekly execution

- `worker-node/src/modules/orchestrator/types.ts`
  - Defines `ai_approver` as step four.
  - Targets worker-python `/ai-approver/start-job`.
- `worker-node/src/modules/orchestrator/coordinator.ts`
  - Enables or disables the V01 step from run configuration.
  - Builds V01 request bodies and article bounds.
  - Treats V01 as a downstream article-processing step.
  - Skips V01 when ingestion adds no new articles.
- `worker-node/src/routes/orchestrator.ts`
  - Accepts orchestrator configuration that includes the V01 step.
- `worker-node/src/modules/orchestrator/repository.ts`
  - Persists orchestrator runs and steps containing the `ai_approver` name.

### 6.2 Continuation behavior

- `worker-node/src/modules/orchestrator/continuationAssessment.ts`
  - Assesses whether the V01 step may be replayed.
- `worker-node/src/modules/orchestrator/continuationCreation.ts`
  - Creates continuation steps and V01 retry policy.
- `worker-node/src/modules/orchestrator/types.ts`
  - Defines V01 continuation configuration and step types.

### 6.3 Report generation

- `worker-node/src/modules/orchestrator/reportWriter.ts`
  - Reads V01 category scores from `AiApproverArticleScores`.
  - Joins `AiApproverPromptVersions` to identify prompt roles.
  - Reads V01 gatekeeper decision, confidence, and reason code.
  - Writes V01-derived values into weekly report output.

### 6.4 Worker-node tests

- `worker-node/tests/modules/orchestratorCoordinator.test.ts`
- `worker-node/tests/modules/orchestratorRepository.test.ts`
- `worker-node/tests/routes/orchestrator.test.ts`
- `worker-node/tests/modules/orchestrator/continuationAssessment.test.ts`
- `worker-node/tests/modules/orchestrator/continuationCreation.test.ts`
- `worker-node/tests/modules/orchestrator/reportWriter.test.ts`

## 7. Database Dependencies

### 7.1 Models

- `db-models/src/models/AiApproverPromptVersion.ts`
  - Defines `AiApproverPromptVersions`.
  - Stores category and gatekeeper prompt configuration.
- `db-models/src/models/AiApproverArticleScore.ts`
  - Defines `AiApproverArticleScores`.
  - Stores model outcomes, errors, roles, metadata, and human review.

### 7.2 Initialization and associations

- `db-models/src/models/_index.ts`
  - Initializes and exports both V01 models.
- `db-models/src/models/_associations.ts`
  - Links prompts to score rows.
  - Links articles to score rows.
- `db-models/src/models/_loadOrder.ts`
  - Loads prompts before articles scores during import.
- `db-models/src/models/OrchestratorRunStep.ts`
  - Defines `ai_approver` as a member of the persisted orchestrator step-name union.
- `db-models/src/utils/resetSequences.ts`
  - Resets serial sequences for all initialized models.

### 7.3 Backup, import, and administration

- `db-manager/src/modules/backup.ts`
  - Discovers exported models and backs up nonempty V01 tables.
- `db-manager/src/modules/zipImport.ts`
  - Imports V01 tables according to `MODEL_LOAD_ORDER`.
  - Resets sequences after import.
- `api/src/routes/adminDb.ts`
  - Registers V01 tables explicitly for admin database operations.
- `api/src/modules/adminDb.ts`
  - Discovers V01 exports for API-managed backup and import.

### 7.4 Historical database coupling

- `OrchestratorRunStep` rows may retain `stepName = ai_approver`.
- V01 score rows may contain human-verification decisions.
- Weekly reports may already contain values derived from V01 rows.
- Queue JSON may retain V01 endpoint names and job outcomes.

These records remain meaningful even after new V01 executions eventually stop.

## 8. Environment and Operational Dependencies

### 8.1 Worker-python environment

V01 uses:

- `PG_HOST`
- `PG_PORT`
- `PG_DATABASE`
- `PG_USER`
- `PG_PASSWORD`
- `USE_OPEN_AI_API`
- `OPENAI_API_KEY`
- `AI_APPROVER_MODEL_NAME`
- `AI_APPROVER_CODEX_TIMEOUT_SECONDS`
- `AI_APPROVER_BATCH_SIZE`
- `AI_APPROVER_MODE`
- `AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD`

Shared PostgreSQL and backend variables may also be used by V02 or other workflows. A future V01 removal must prove each variable is unused before deleting it.

### 8.2 Active operational documentation

- `README.md`
- `AGENTS.md`
- `worker-python/README.md`
- `worker-python/AGENTS.md`
- `worker-python/docs/20260502_HOW_TO_USE_AI_APPROVER.md`
- `worker-python/docs/20260502_ai_approver_flow_report.md`
- `worker-python/docs/20260502_ai_approver_gatekeeper_implementation_plan.md`
- `worker-python/docs/20260502_codex_gatekeeper_prompt_seed_handoff.md`
- `worker-python/docs/20260502_prompt_engineer_ai_approver_gatekeeper_report.md`
- `worker-python/docs/20260502_software_architect_ai_approver_gatekeeper_report.md`
- `docs/20260524_NN12PROD_DEPLOYMENT_HERMES_INSTRUCTIONS.md`
- `docs/20260704_ai_approver_score_legend.md`
- `docs/CPO_ONBOARDING.md`
- `docs/CTO_ONBOARDING.md`
- `docs/db-models/TABLE_REFERENCE.md`

Archived documents are reference-only and were not reviewed for this implementation inventory.

## 9. Current V02 Release Decisions

### 9.1 Hidden in the portal

- V01 automation card
- weekly orchestrator card
- navigation to the V01 prompt-management page
- direct rendering of the V01 prompt-management URL
- default visibility of the V01 review column

### 9.2 Preserved and reachable

- worker-python V01 routes
- API V01 routes
- weekly-orchestrator backend code
- V01 worker module and prompt setup script
- V01 database models, tables, associations, and data
- V01 backup and import behavior
- V01 article-review data, column, and modal
- V01 tests and operational documentation

### 9.3 Startup behavior changed without removal

The V02 release may make invalid V01-only configuration nonfatal during worker startup.

It must:

- log a V01 availability warning
- validate V01 configuration when a V01 job is requested
- fail that requested V01 job clearly when configuration remains invalid
- keep shared queue, database, other workflow, and V02 validation fatal

## 10. Data-Retention and Backup Concerns

Before any future removal:

1. Export both V01 tables through a verified backup.
2. Verify prompt-to-score and article-to-score relationships in the backup.
3. Preserve human-verification values and rejection reasons.
4. Decide how long V01 queue records and orchestrator steps must remain queryable.
5. Confirm weekly reports remain understandable without live V01 tables.
6. Confirm old ZIP backups can still be restored or migrated.
7. Decide whether the V01 review UI remains available as a read-only archive.
8. Obtain separate approval before dropping either V01 table.

Normal V02 deployment and rollback must not drop or rewrite V01 tables.

## 11. Safe Future Removal Sequence

A future V01 removal project should use this order:

1. Confirm V02 has replaced every intended operator use case.
2. Inventory external callers and production traffic to V01 routes.
3. Disable new V01 weekly-orchestrator executions.
4. Replace or freeze V01-derived weekly report fields.
5. Remove V01 portal controls while retaining read-only historical review.
6. Deprecate direct API and worker routes with an announced cutoff.
7. Remove V01 route callers, route mounts, and workflow modules.
8. Remove V01 tests only after their protected behavior is gone.
9. Create and verify a final V01 database backup.
10. Update backup and import compatibility for historical archives.
11. Remove model exports, associations, and load-order entries.
12. Drop V01 tables only through a separate destructive procedure.
13. Remove V01-only environment variables and active documentation.
14. Retain or archive this report according to operator direction.

Each step requires fresh repository and production-usage evidence. The sequence is guidance, not authorization.

## 12. Verification Summary

The inventory was checked against active repository references in:

- portal
- API
- worker-python
- worker-node
- db-models
- db-manager
- root and package documentation

The highest-risk dependencies are:

- worker-node weekly execution of `/ai-approver/start-job`
- report queries against both V01 tables
- portal article review and one-off scoring
- backup and import model discovery
- explicit admin database registration
- fatal V01 startup validation

No V01 source, configuration, table, data, route, or behavior was modified while preparing this report.

## 13. Operator Approval

- Status: approved by the operator on 2026-07-23
- Approval scope: permission to begin AI Approver V02 product-code implementation
- Approval does not authorize V01 removal or data deletion
