---
created_at: 2026-08-29T21:45:20Z
updated_at: 2026-08-29T21:45:20Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Legacy Orchestrator and AI Approver V01 Removal Plan V02

## 1. Plan Basis

This plan implements `20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v03.md` on `dev_29_remove_v01_workflows`.

It supersedes `20260829_legacy_v01_removal_plan_v01.md` and incorporates `20260829_legacy_v01_removal_plan_v01_assessment_codex.md`. The V01 assessment correctly identified the read-only `ArticleContents02` viewer as retained article-review functionality despite its duplicate handler being placed in the V01 API namespace.

The removal PRD takes precedence over `docs/20260829_weekly_article_processing_cron_prd.md`. The existing weekly PRD will receive a visible blocked or superseded notice and will not supply architecture to this implementation. Its product goals remain input for a separately planned replacement.

The change removes two connected legacy systems:

1. AI Approver V01, including its scoring runtime, prompt management, V01 score review, models, and operator material.
2. The worker-node weekly orchestrator, including its routes, state tables, active-run locks, continuation mechanism, reporting, and Ubuntu launch assets.

AI Approver V02, the generic read-only article-content viewer, and independently queued jobs remain in place. Retained Python files named `orchestrator.py` describe internal single-workflow classes and are outside the deletion boundary.

## 2. Implementation Shape

The work has two linked tracks.

1. Repository removal changes application code, shared models, imports, tests, scripts, and active documentation.
2. Operational retirement removes all existing NewsNexus12 schedules from Ubuntu before deleted endpoints are deployed.

Repository work can be developed and tested locally while the operational inventory is prepared. Deployment cannot cross the route-removal gate until the operator confirms that every NewsNexus12 systemd timer, service, Hermes job, user or root crontab entry, and `/etc/cron*` entry is disabled or removed.

The database transition uses the existing db-manager rebuild-on-import behavior. It does not add a migration and does not run `--drop_db` before `--zip_file`.

## 3. Portal Removal and Preservation

### 3.1 Automation and prompt surfaces

Delete the unused `OrchestratorSection.tsx` and `AiApproverSection.tsx` components. Keep the current automations page composition and all retained cards, including `AiApproverV02Section.tsx`.

Delete the V01 prompt implementation under `components/legacy/` and both V01 App Router page files. Removing the page files lets Next.js provide its normal not-found behavior for `/analysis/ai-approver-prompts` and `/articles/automations/ai-approver-prompts`; the old paths will not redirect to V02.

### 3.2 Article review

Refactor the article review page and `TableReviewArticles.tsx` around V02 prediction data while preserving the independent article-content viewer:

- Remove V01 top-score and gatekeeper fetches, response maps, merge functions, refresh callbacks, state, and concurrent loading work.
- Remove the V01 score column, sorting helper, click callback, cell status rendering, and `ModalAiApproverDetails.tsx`.
- Preserve `ModalReviewArticleContent.tsx`, `reviewArticleContentArticleId`, `onArticleContentClick`, the `Open article content` button, and `ReviewArticleContentResponse`.
- Change the modal fetch from the deleted V01 endpoint to the retained `GET /articles/review-selected-content/:articleId` endpoint.
- Remove only V01 score, prompt, gatekeeper, and one-off scoring properties and response interfaces from `types/article.ts`; preserve all `AiApprover*V02` types and `ReviewArticleContentResponse`.
- Preserve V02 table filtering, details, human validation, comments, prediction refresh, and generic article-content viewing.

The existing articles endpoint is preferable to adding another route. It already authenticates requests and reads the canonical retained `ArticleContents02` row. The API change adds `title` to its response so it fully supplies the existing modal contract.

Focused portal coverage will verify that a row with `hasArticleContent` still exposes the content button and that the modal requests `/articles/review-selected-content/:articleId`. The old `/analysis/ai-approver/review-article-content/:articleId` URL is not retained or redirected.

## 4. API Removal and Article Content Route

Remove the V01 and weekly route mounts from `api/src/app.ts`, then delete:

- `routes/analysis/ai-approver.ts`
- `modules/analysis/ai-approver.ts`
- `routes/automations/orchestrator.ts`

Remove only `/ai-approver/start-job` from `routes/newsOrgs/automations.ts`. Shared Excel-file routes, worker-node status and cancellation, worker-python status and cancellation, location scoring, Google RSS, scraper, state assignment, and semantic scoring remain mounted.

Keep the authenticated handler already implemented at `GET /articles/review-selected-content/:articleId` in `api/src/routes/articles.ts`. It remains backed only by `Article`, `getCanonicalArticleContents02Row()`, and `isSuccessfulArticleContents02Row()`.

Consolidate the two current content handlers as follows:

- Add `title: article.title` to the retained articles-route response.
- Preserve its numeric-ID validation, article-not-found response, canonical-row selection, success-state check, null content behavior, and authentication.
- Delete the duplicate handler with the rest of `routes/analysis/ai-approver.ts`.
- Preserve and expand `api/tests/articles/articles.routes.test.ts` for successful content, missing or unusable content, invalid IDs, missing articles, title inclusion, and authentication.
- Remove the duplicate content tests from the deleted V01 route suite.
- Add app-level negative coverage showing the old analysis URL returns normal `404`.

The admin database route will stop importing and enumerating `AiApproverArticleScore`, `AiApproverPromptVersion`, `OrchestratorRun`, and `OrchestratorRunStep`. Its route and module tests will be updated to verify the retained model list.

Route tests for deleted routers will be removed. Retained shared-router tests will prove that V02 and independent automation proxies still forward correctly. App-level negative route tests will establish ordinary `404` behavior for representative removed paths without installing compatibility handlers.

## 5. Worker-Node Removal

### 5.1 Weekly runtime and global lock

Delete the `/orchestrator` route and the complete `src/modules/orchestrator/` implementation. This removes persisted run coordination, child-job polling, continuation assessment and creation, report writing, active-run caching, and restart reconciliation.

Simplify startup and app construction:

- Remove `runReconciliation()` from `server.ts`.
- Remove the orchestrator router and `skipOrchestratorLock` application option from `app.ts`.
- Delete `modules/middleware/orchestratorLock.ts` and its dependency on `activeRunGuard.ts`.
- Mount retained queue-backed starter routes directly. Their existing global queue with concurrency one remains the only execution coordination mechanism.

Tests owned by the deleted route, repository, coordinator, report, continuation, active-run guard, and lock will be deleted. Retained starter-route tests will verify that jobs enqueue without an active-run lookup or orchestrator header.

### 5.2 Google RSS contract cleanup

Delete `modules/google-rss/resumePlanner.ts`; its only production caller is the removed continuation flow.

Narrow `routes/requestGoogleRss.ts` and `modules/jobs/requestGoogleRssJob.ts` to the standalone contract:

- Remove parsing and validation for the entire `googleRssResumePlan` body object.
- Remove `X-Orchestrator-Run-Id` parsing and propagation.
- Remove `orchestratorRunId`, source-run, continuation-run, and resume-position fields from route inputs, queue payloads, job context, result metadata, and `NewsApiRequest` creation.
- Preserve spreadsheet parsing, query iteration, RSS requests, article insertion, direct content seeding, follow-up scraping, ordinary retry behavior, cancellation, and query-result reporting used by the standalone job.

Delete resume-planner and legacy request-contract tests. Update Google RSS route, input, job, and model-metadata tests to demonstrate the narrower request shape and the absence of run-record writes.

### 5.3 Startup schema readiness

Update `modules/db/ensureDbReady.ts` so required tables describe only retained worker-node workflows. Remove `OrchestratorRuns` and `OrchestratorRunSteps`; retain `Articles`, `Users`, and `States` unless the focused test identifies another currently required retained table.

Rewrite the recovery message to describe backup, build, and `--zip_file` import without a separate schema-drop instruction. Add a focused readiness test with the retained table set so worker-node startup cannot regress when the legacy tables are absent.

## 6. Worker-Python Removal

Delete the V01 route, `src/modules/ai_approver/`, its prompt setup script, V01 contract fixture, and V01 unit and integration suites.

Update `src/main.py` to remove:

- The V01 router registration.
- V01 startup-environment validation and warnings.
- `OrchestratorLockMiddleware` registration.

Delete `src/modules/orchestrator/active_run_guard.py` and `lock_middleware.py`. The shared queue, queue inspection, cancellation, deduper, location scorer, and V02 route continue unchanged.

Remove V01-only settings from `.env.example`. In particular, remove `AI_APPROVER_MODEL_NAME` and `AI_APPROVER_CODEX_TIMEOUT_SECONDS` while retaining every `AI_APPROVER_V02_*` value and any generic credential used by another workflow. Startup and focused regression tests will prove V02 does not import V01 configuration or require a removed table.

## 7. Shared Models and Database Import

### 7.1 Model graph

Delete these Sequelize models:

- `AiApproverPromptVersion`
- `AiApproverArticleScore`
- `OrchestratorRun`
- `OrchestratorRunStep`

Remove their initialization, exports, return values, type exports, associations, and `MODEL_LOAD_ORDER` entries. Remove `orchestratorRunId` from the `NewsApiRequest` TypeScript attributes, creation attributes, class declaration, and Sequelize column definition.

Retain all three V02 models and their associations. The model cleanup will also update database table references in package guidance and API administration code. Sequence reset needs no special replacement because it iterates the models that remain registered with Sequelize.

### 7.2 Old backup compatibility

Extend `db-manager/tests/modules/zipImport.test.ts` with a generated ZIP fixture representing an old backup. The fixture includes the four removed model CSVs and a `NewsApiRequest.csv` with an `orchestratorRunId` header.

Before deletion, the fixture establishes that the legacy-shaped archive is readable. In the post-removal suite, it must prove:

- The four CSVs whose model names are no longer in `MODEL_LOAD_ORDER` are returned in `skippedFiles` and logged as skipped.
- Retained `NewsApiRequest` fields reach `bulkCreate`.
- `orchestratorRunId` does not reach `bulkCreate` and cannot recreate the column.
- Expected legacy skips do not turn the import into a failure.

The importer currently sends parsed CSV objects to `bulkCreate`, so it should filter every retained model's records to keys in `model.rawAttributes` before sanitization and insertion. Applying this generically makes old backups safe when any removed column survives in a retained CSV, rather than introducing a one-column exception.

The existing date, integer, float, boolean, JSON, foreign-key, batching, rebuild, and sequence-reset behavior remains unchanged and covered by the db-manager suite.

## 8. Scripts and Operational Assets

Delete the repository assets that can invoke or recreate the legacy system:

- The weekly and test systemd service files.
- The weekly systemd timer.
- Both orchestrator trigger scripts.
- `scripts/schema/20260623_weekly_continuation_phase2.sql`.
- `scripts/ai-approver-review-legend-counts.mjs` and its generated V01 legend-count output if neither serves V02.

Rewrite `scripts/README.md` around retained scripts. Do not archive executable service, trigger, or schema helpers because an archived copy could still be mistaken for an installation source.

The Ubuntu retirement record will capture discovered schedule names, prior state, stop or disable result, removed unit or scheduler definition, daemon reload result, active child-job disposition, and proof that no next trigger remains. Known names from the PRD are starting points, not a complete inventory.

If a schedule is still running, the operator first stops its trigger and lets the underlying application job reach a safe terminal state. Route deployment waits for that evidence. This operational action requires separate host authorization and is not performed by the repository test suite.

## 9. Documentation Disposition

Update active guidance so it describes V02 and retained independent jobs only:

- Root `AGENTS.md` and relevant package `AGENTS.md` files.
- Root, API, portal, worker-node, worker-python, db-models, and db-manager README material where the legacy flow is presented as live.
- Database table references and production deployment instructions.
- Worker-python API documentation that lists removed routes.

Delete the V01 gatekeeper prompt asset and active instructions that could seed or operate V01. Move historical V01 reports and implementation records to `docs/archive/YYYYMM/` using each document's creation month. Move the July safe-removal report to `docs/archive/202607/` and update links from the current PRD and plan-and-vet records as needed.

Add a prominent invalid-for-implementation notice to `docs/20260829_weekly_article_processing_cron_prd.md`. The notice will state that the removal PRD is authoritative and that a new version must define new workflow naming, persisted state, cohort ownership, installation, verification, and rollback without the deleted route, tables, header, or column.

Historical documents that merely describe prior behavior may keep the old terminology after archiving. Active documentation may use `orchestrator` only for retained internal Python classes or when explaining that the removed product feature no longer exists.

## 10. Integration and Verification Flow

Verification follows dependency order so consumers always compile against the current shared model package:

1. Build `db-models` and confirm generated exports no longer expose legacy models or types.
2. Run db-manager tests, including the old-backup compatibility fixture, then build db-manager.
3. Test and build API, including the retained article-content route, retained proxy regressions, and removed-route `404` coverage.
4. Test and build worker-node, including Google RSS standalone behavior and schema readiness without legacy tables.
5. Run worker-python retained unit and integration suites, with focused V02 startup, preview, start, status, cancellation, and persistence coverage.
6. Run portal lint and build, then manually inspect the automations and article review pages, including opening retained article content.
7. Search live source, scripts, and active documentation for removed routes, headers, models, body contracts, and product-name usages. Remaining matches must be retained Python workflow classes, archived history, or current removal records.

After repository suites pass, the operator creates or confirms an unchanged pre-removal ZIP from code that still knows the legacy models. The removal branch then imports that ZIP, allowing db-manager to rebuild `public` from retained models and skip legacy CSVs.

The post-import smoke test starts each service without V01 environment settings and without the four tables or removed column. It exercises standalone Google RSS, scraper, state assigner, semantic scorer, location scorer, deduper, the V02 preview-to-review path, and the read-only article-content viewer. Removed portal and HTTP paths must produce ordinary `404` responses.

## 11. Rollback Boundary

Code rollback and database rollback are separate.

To restore the pre-removal database, stop affected services, switch to `main`, rebuild `db-models` and db-manager from `main`, and import the unchanged pre-removal ZIP with main's db-manager. Switching branches alone does not restore PostgreSQL.

Rollback does not re-enable any retired Ubuntu schedule. Reintroducing a schedule requires the future weekly workflow design and separate operator authorization.

## 12. Completion State

Implementation is complete when live code cannot start, query, configure, review scores for, continue, or report either legacy feature; the generic read-only article-content viewer still works through the retained articles API; old backups restore retained data without rebuilding legacy schema; all retained workflows pass their regression paths; repository assets cannot reinstall the old schedule; and operator evidence shows no pre-existing NewsNexus12 Ubuntu schedule remains enabled.

This change is large and multi-package, so it requires a task-style todo after the plan reaches agreement under `plan-and-vet`.
