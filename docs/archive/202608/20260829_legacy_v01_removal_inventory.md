---
created_at: 2026-08-29T22:03:49Z
updated_at: 2026-08-30T00:51:09Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Legacy V01 Removal Inventory

## 1. Purpose

- Branch: `dev_29_remove_v01_workflows`
- Phase: `20260829_legacy_v01_removal_todo_v02.md` Phase 1
- Scope: live V01 models and routes, the weekly orchestrator, its Google RSS continuation contract, deployment assets, tests, settings, and active documentation
- Archive folders excluded from the scan: yes
- Generated output and dependency folders excluded from the scan: yes

This is the pre-removal file-level classification. Shared files contain both removed and retained behavior and must be edited rather than deleted.

## 2. Removal Work

### 2.1 API

- Delete:
  - `api/src/routes/analysis/ai-approver.ts`
  - `api/src/routes/automations/orchestrator.ts`
  - `api/tests/analysis/ai-approver.routes.test.ts`
  - `api/tests/automations/orchestrator.routes.test.ts`
- Edit shared files:
  - `api/src/app.ts`
  - `api/src/routes/adminDb.ts`
  - `api/src/routes/newsOrgs/automations.ts`
  - `api/tests/admin/adminDb.routes.test.ts`
  - `api/tests/modules/adminDb.module.test.ts`
  - `api/tests/news-orgs/automations.routes.test.ts`
- Preserve and extend the generic content handler in:
  - `api/src/routes/articles.ts`
  - its focused route tests

### 2.2 Database models and manager

- Delete models:
  - `db-models/src/models/AiApproverPromptVersion.ts`
  - `db-models/src/models/AiApproverArticleScore.ts`
  - `db-models/src/models/OrchestratorRun.ts`
  - `db-models/src/models/OrchestratorRunStep.ts`
- Edit shared graph files:
  - `db-models/src/models/NewsApiRequest.ts`
  - `db-models/src/models/_associations.ts`
  - `db-models/src/models/_index.ts`
  - `db-models/src/models/_loadOrder.ts`
  - `db-models/src/utils/resetSequences.ts`
- Edit compatibility and metadata coverage:
  - `db-manager/src/modules/zipImport.ts`
  - `db-manager/tests/modules/zipImport.test.ts`
  - `db-manager/tests/modules/backup.test.ts`
  - `worker-node/tests/modules/modelMetadata.test.ts`

### 2.3 Worker-node

- Delete routes and runtime packages:
  - `worker-node/src/routes/orchestrator.ts`
  - every file in `worker-node/src/modules/orchestrator/`
  - `worker-node/src/modules/middleware/orchestratorLock.ts`
  - `worker-node/src/modules/google-rss/resumePlanner.ts`
- Edit shared runtime:
  - `worker-node/src/app.ts`
  - `worker-node/src/server.ts`
  - `worker-node/src/modules/db/ensureDbReady.ts`
  - `worker-node/src/routes/requestGoogleRss.ts`
  - `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
- Delete owned tests:
  - `worker-node/tests/routes/orchestrator.test.ts`
  - `worker-node/tests/modules/activeRunGuard.test.ts`
  - `worker-node/tests/modules/googleRssResumePlanner.test.ts`
  - `worker-node/tests/modules/orchestratorCoordinator.test.ts`
  - `worker-node/tests/modules/orchestratorLock.test.ts`
  - `worker-node/tests/modules/orchestratorRepository.test.ts`
  - every test in `worker-node/tests/modules/orchestrator/`
- Edit retained Google RSS and startup tests:
  - `worker-node/tests/modules/requestGoogleRssJob.test.ts`
  - `worker-node/tests/modules/requestGoogleRssRouteInputs.test.ts`
  - retained app and readiness coverage

### 2.4 Worker-python

- Delete V01 runtime and tests:
  - `worker-python/src/routes/ai_approver.py`
  - `worker-python/src/modules/ai_approver/`
  - `worker-python/src/standalone/setup_ai_approver_prompt.py`
  - `worker-python/tests/contracts/ai_approver_contract_spec.json`
  - `worker-python/tests/contracts/test_ai_approver_contract.py`
  - `worker-python/tests/integration/test_ai_approver_routes.py`
  - `worker-python/tests/unit/ai_approver/`
- Delete the legacy cross-worker lock:
  - `worker-python/src/modules/orchestrator/active_run_guard.py`
  - `worker-python/src/modules/orchestrator/lock_middleware.py`
  - the package initializer when the directory becomes empty
- Edit shared startup:
  - `worker-python/src/main.py`

### 2.5 Portal

- Delete V01 and weekly workflow surfaces:
  - `portal/src/components/automations/AiApproverSection.tsx`
  - `portal/src/components/automations/OrchestratorSection.tsx`
  - `portal/src/components/legacy/AiApproverPromptsV01Page.tsx`
  - `portal/src/components/ui/modal/ModalAiApproverDetails.tsx`
  - both V01 prompt route files
- Edit shared review files:
  - `portal/src/app/(dashboard)/articles/review/page.tsx`
  - `portal/src/components/tables/TableReviewArticles.tsx`
  - `portal/src/types/article.ts`
- Preserve and rehome the request used by:
  - `portal/src/components/ui/modal/ModalReviewArticleContent.tsx`

### 2.6 Scripts and deployment assets

- Delete:
  - `scripts/newsnexus12-worker-node-orchestrator-weekly.service`
  - `scripts/newsnexus12-worker-node-orchestrator-weekly.timer`
  - `scripts/newsnexus12-worker-node-orchestrator-test.service`
  - `scripts/trigger-worker-node-orchestrator-weekly.sh`
  - `scripts/trigger-worker-node-orchestrator-test.sh`
  - `scripts/schema/20260623_weekly_continuation_phase2.sql`
  - `scripts/ai-approver-review-legend-counts.mjs` after confirming it is V01-only
- Edit or delete after retained-content review:
  - `scripts/README.md`

## 3. Retained Runtime Matches

### 3.1 AI Approver V02

- Preserve the V02 API routes, models, portal components, worker-python module, tests, schema installer, and configuration.
- Preserve files matching:
  - `api/**/ai-approver-v02*`
  - `db-models/src/models/*V02.ts`
  - `portal/**/*AiApproverV02*`
  - `worker-python/src/modules/ai_approver_v02/`
  - `worker-python/src/routes/ai_approver_v02.py`
  - V02 tests in each package

### 3.2 Internal Python coordination names

- Preserve:
  - `worker-python/src/modules/ai_approver_v02/orchestrator.py`
  - `worker-python/src/modules/deduper/orchestrator.py`
  - `worker-python/src/modules/location_scorer/orchestrator.py`
- These are single-workflow implementation classes, not the removed weekly product feature.

### 3.3 Generic article content

- Preserve `ArticleContents02`, the table content button, `ModalReviewArticleContent.tsx`, and `ReviewArticleContentResponse`.
- Move the modal request to the retained authenticated articles handler during implementation.

## 4. Documentation Classification

### 4.1 Active documents to edit

- `AGENTS.md`
- `README.md`
- package README and AGENTS files returned by the scan
- `docs/db-models/TABLE_REFERENCE.md`
- active deployment and score-legend guidance that presents V01 or the weekly workflow as live
- `docs/20260829_weekly_article_processing_cron_prd_v01.md`, restored as the active replacement-flow product requirements; its V01 technical design remains invalid for implementation

### 4.2 Historical material to archive

- Archive V01 reports and implementation records by their creation month.
- `docs/archive/202607/20260723_ai_approver_v01_safe_removal_report.md` contains the archived safe-removal report.
- Classify the May 2026 worker-python V01 reports and plans for `docs/archive/202605/` during the final documentation pass.
- Preserve historical wording; update only frontmatter and active references required by the move.

### 4.3 Current removal records to retain

- Retain the 2026-08-29 removal PRDs, assessments, plans, todos, this inventory, and the Ubuntu evidence template.
- These documents may contain legacy identifiers as removal evidence.

### 4.4 V02 documentation to retain

- Retain V02 operations, schema, prompt, implementation, and test documentation unless a file contains an independently obsolete V01-only instruction.
- Edit mixed documents rather than archiving valid V02 guidance.

## 5. Scan Method

The Phase 1 scan used file-level matches for:

- `AiApproverPromptVersion`
- `AiApproverArticleScore`
- `/ai-approver`
- `ai_approver`
- `/orchestrator`
- `OrchestratorRun`
- `orchestratorRunId`
- `X-Orchestrator-Run-Id`
- `googleRssResumePlan`
- V01-only AI Approver environment names

The final implementation phase must repeat this scan after clean builds and classify every remaining match as retained code, archived history, current removal documentation, or a defect.
