---
created_at: 2026-08-29T21:48:03Z
updated_at: 2026-08-29T21:48:03Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Legacy Orchestrator and AI Approver V01 Removal Todo V01

## 1. Implementation Rules

- [ ] Work only on `dev_29_remove_v01_workflows` and preserve unrelated user changes and untracked files.
- [ ] Use `20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v03.md` and `20260829_legacy_v01_removal_plan_v02.md` as the implementation authority.
- [ ] Do not implement `docs/20260829_weekly_article_processing_cron_prd.md`; this removal takes precedence.
- [ ] Do not add a replacement scheduler, automatic schema migration, `410` compatibility route, or V01 read-only interface.
- [ ] Preserve AI Approver V02, the generic article-content viewer, standalone Google RSS, shared queues, and unrelated automations.
- [ ] Preserve retained internal Python classes named `orchestrator.py` under AI Approver V02, deduper, and location scorer.
- [ ] Treat Ubuntu host changes and database replenish as operator-controlled gates. An implementing agent must stop and obtain the stated authorization before performing either gate.
- [ ] After every file modification, update that markdown file's `updated_at` and `modified_by` frontmatter when the file is governed by the repository markdown rules; never change immutable creation fields.
- [ ] At each phase end, fix relevant failures before proceeding, check off only tasks actually completed, update this todo's modification frontmatter, stage only phase-related changes, and commit using the repository commit-message guidance with the todo filename and phase in the body.
- [ ] Never use a broad cleanup such as `git clean`. Clean only the exact generated directories named in this todo so user-owned files remain safe.

## Phase 1: Baseline Inventory and Compatibility Fixture

### Repository alignment

- [ ] Confirm the current branch is `dev_29_remove_v01_workflows` and record the starting `git status` without altering unrelated changes.
- [ ] Add a prominent notice to `docs/20260829_weekly_article_processing_cron_prd.md` that it is invalid for implementation, is subordinate to the removal PRD, and requires redesign without the removed route, tables, header, and column.
- [ ] Inventory live references to V01 models, V01 routes, `/orchestrator`, `X-Orchestrator-Run-Id`, `googleRssResumePlan`, legacy deployment assets, and V01 settings across source, tests, scripts, and active documentation.
- [ ] Classify every match as removal work, retained V02 or internal Python coordination, historical material to archive, or current removal documentation.
- [ ] Create a sanitized Ubuntu schedule-retirement evidence template covering systemd timers and services, Hermes jobs, application-user and root crontabs, `/etc/cron*`, active child jobs, removal results, daemon reload, and remaining next triggers.

### Pre-removal ZIP baseline

- [ ] Extend `db-manager/tests/modules/zipImport.test.ts` with an old-backup ZIP fixture containing `AiApproverPromptVersion.csv`, `AiApproverArticleScore.csv`, `OrchestratorRun.csv`, `OrchestratorRunStep.csv`, and an old-format `NewsApiRequest.csv` with `orchestratorRunId`.
- [ ] Establish and document the pre-removal baseline while the legacy models remain registered; do not yet require those four model CSVs to be skipped.
- [ ] Confirm the fixture is readable and isolates all filesystem work to test-managed temporary directories.

### Phase 1 verification and commit

- [ ] Run the focused ZIP-import test.
- [ ] Run the complete db-manager test suite.
- [ ] Run the db-manager TypeScript build.
- [ ] Fix all Phase 1 regressions before continuing.
- [ ] Mark only completed Phase 1 tasks checked, review the staged diff, and commit the Phase 1 changes with a reference to `20260829_legacy_v01_removal_todo_v01.md` Phase 1.

## Operator Gate A: Preserve the Pre-removal Database

- [ ] Stop before any database replenish. Confirm the operator has authorized this gate and will perform or directly supervise it.
- [ ] From a code version that still registers the legacy models, have the operator run `cd db-manager` and `npm start -- --create_backup`.
- [ ] Record the absolute ZIP path and confirm the archive is retained unchanged for both forward replenish and rollback.
- [ ] Do not run `--drop_db`; no schema change occurs at this gate.
- [ ] Do not proceed to the final replenish gate without a verified backup. Repository source work may continue after the backup is confirmed.

## Phase 2: Shared Models and Old-backup Import

### Legacy schema model removal

- [ ] Delete `AiApproverPromptVersion.ts`, `AiApproverArticleScore.ts`, `OrchestratorRun.ts`, and `OrchestratorRunStep.ts` from `db-models/src/models/`.
- [ ] Remove their initialization, exports, returned model entries, type exports, associations, and `MODEL_LOAD_ORDER` entries.
- [ ] Remove `orchestratorRunId` from the `NewsApiRequest` attributes, creation attributes, class declaration, and Sequelize definition.
- [ ] Preserve all AI Approver V02 models, types, initialization, and associations.
- [ ] Confirm `resetAllSequences()` continues to operate through the retained registered-model collection and remove only obsolete model-specific tests or references.

### Import compatibility

- [ ] Update `db-manager/src/modules/zipImport.ts` to filter retained CSV records to the current model's `rawAttributes` before sanitization and `bulkCreate`.
- [ ] Convert the Phase 1 old-backup fixture to its post-removal assertions.
- [ ] Assert the four deleted-model CSVs are returned and logged as skipped without failing import.
- [ ] Assert retained `NewsApiRequest` fields reach `bulkCreate` and `orchestratorRunId` does not.
- [ ] Preserve date, number, boolean, JSON, batch, foreign-key, rebuild, and sequence-reset behavior.
- [ ] Update model load-order and metadata tests for the retained graph.

### Clean build requirement

- [ ] Run `npm run clean` in `db-models` before rebuilding so deleted models cannot survive in ignored `dist/` output.
- [ ] Run `npm run clean` in `db-manager` before rebuilding so stale compiled imports cannot survive.
- [ ] Inspect the rebuilt `db-models/dist` for deleted model filenames and legacy exports; remove the exact stale artifact if any remains and rebuild again.

### Phase 2 verification and commit

- [ ] Build `db-models` first.
- [ ] Run the focused old-backup ZIP-import test and the complete db-manager test suite.
- [ ] Build db-manager.
- [ ] Fix all Phase 2 regressions before continuing.
- [ ] Mark only completed Phase 2 tasks checked, review the staged diff, and commit the Phase 2 changes with a reference to this todo Phase 2.

## Phase 3: Worker-Node Orchestrator and Continuation Removal

### Runtime removal

- [ ] Unmount and delete `worker-node/src/routes/orchestrator.ts`.
- [ ] Delete all files under `worker-node/src/modules/orchestrator/`.
- [ ] Remove `runReconciliation()` and its legacy logging from `worker-node/src/server.ts`.
- [ ] Delete the worker-node orchestrator lock middleware and active-run guard.
- [ ] Remove the orchestrator router, global start-job lock, and `skipOrchestratorLock` app option from `worker-node/src/app.ts`.
- [ ] Confirm retained starter routes still use the existing global queue at concurrency one without an active-run lookup.

### Google RSS narrowing

- [ ] Delete `worker-node/src/modules/google-rss/resumePlanner.ts`.
- [ ] Remove the entire `googleRssResumePlan` parser and request contract from `requestGoogleRss.ts`.
- [ ] Remove `X-Orchestrator-Run-Id` parsing and propagation.
- [ ] Remove orchestrator, source-run, continuation-run, and resume-position fields from Google RSS route inputs, queue payloads, job context, result metadata, and `NewsApiRequest` persistence.
- [ ] Preserve normal spreadsheet query iteration, RSS requests, article insertion, content seeding, follow-up scraping, retry, cancellation, and query-result reporting.

### Startup and tests

- [ ] Remove `OrchestratorRuns` and `OrchestratorRunSteps` from `ensureDbReady.ts` required tables.
- [ ] Rewrite `REBUILD_INSTRUCTIONS` to use backup, dependency build, and `--zip_file` without a separate schema drop.
- [ ] Add focused readiness coverage proving startup succeeds when the removed tables are absent.
- [ ] Delete tests owned solely by the orchestrator, continuation planner, report writer, repository, coordinator, active-run guard, and lock.
- [ ] Update Google RSS route, input, job, and model-metadata tests for the standalone contract.
- [ ] Verify each retained worker-node starter can enqueue without an active-run lookup, run ID header, or legacy table.

### Clean build requirement

- [ ] Remove only the exact ignored `worker-node/dist` directory after confirming its path, then run a clean build so deleted JavaScript and declaration files cannot survive locally or enter deployment output.
- [ ] Search the rebuilt `worker-node/dist` for the deleted orchestrator route, modules, resume planner, header, and request contract.

### Phase 3 verification and commit

- [ ] Run worker-node type checking through its TypeScript build.
- [ ] Run the focused startup and Google RSS suites.
- [ ] Run the complete worker-node test suite.
- [ ] Build worker-node from the cleaned output directory.
- [ ] Fix all Phase 3 regressions before continuing.
- [ ] Mark only completed Phase 3 tasks checked, review the staged diff, and commit the Phase 3 changes with a reference to this todo Phase 3.

## Phase 4: Worker-Python V01 and Lock Removal

### V01 runtime and configuration

- [ ] Unmount and delete `worker-python/src/routes/ai_approver.py`.
- [ ] Delete `worker-python/src/modules/ai_approver/` and the V01 prompt setup utility.
- [ ] Remove V01 startup validation, warnings, imports, and router registration from `worker-python/src/main.py`.
- [ ] Remove V01-only environment examples while preserving all `AI_APPROVER_V02_*` settings and shared credentials required elsewhere.
- [ ] Delete the V01 prompt asset, contract fixture, contract tests, integration tests, and unit tests.

### Legacy lock package

- [ ] Remove `OrchestratorLockMiddleware` registration from FastAPI startup.
- [ ] Delete `worker-python/src/modules/orchestrator/active_run_guard.py` and `lock_middleware.py`.
- [ ] Delete `worker-python/src/modules/orchestrator/__init__.py` and the package directory when it is empty.
- [ ] Remove stale V01 and legacy-lock `__pycache__` files without touching retained workflow packages.
- [ ] Confirm retained V02, deduper, location scorer, queue status, and cancellation code has no import from either deleted package.

### Phase 4 verification and commit

- [ ] Run worker-python V02 unit and integration suites.
- [ ] Run retained deduper and location-scorer unit suites.
- [ ] Run the broader worker-python test suite if available in the environment.
- [ ] Start or import the FastAPI application in a test environment without V01 settings and confirm route registration succeeds.
- [ ] Fix all Phase 4 regressions before continuing.
- [ ] Mark only completed Phase 4 tasks checked, review the staged diff, and commit the Phase 4 changes with a reference to this todo Phase 4.

## Phase 5: API Route Removal and Article-content Consolidation

### Route and model-registration cleanup

- [ ] Unmount and delete `api/src/routes/automations/orchestrator.ts`.
- [ ] Unmount and delete `api/src/routes/analysis/ai-approver.ts` and `api/src/modules/analysis/ai-approver.ts`.
- [ ] Remove only the V01 `/automations/ai-approver/start-job` handler from the shared automations router.
- [ ] Preserve V02 routes and shared worker status, latest-job, cancellation, Excel, Google RSS, scraper, state-assigner, semantic-scorer, and location-scorer proxies.
- [ ] Remove the four deleted legacy models from the admin database route and its tests.

### Retained article-content viewer

- [ ] Keep `GET /articles/review-selected-content/:articleId` in `api/src/routes/articles.ts` as the single authenticated read-only content handler.
- [ ] Add `title: article.title` to its successful response while preserving validation, not-found handling, canonical `ArticleContents02` selection, success checks, and null-content behavior.
- [ ] Expand `api/tests/articles/articles.routes.test.ts` for title, successful content, missing or unusable content, invalid IDs, missing articles, and authentication.
- [ ] Add negative app-level tests proving representative removed V01 and orchestrator API paths return ordinary `404` and never proxy.
- [ ] Delete the obsolete V01 and orchestrator route test suites.

### Clean build requirement

- [ ] Remove only the exact ignored `api/dist` directory after confirming its path, then build from clean output.
- [ ] Search rebuilt `api/dist` for deleted V01 and orchestrator route or module files and fix any stale-output cause.

### Phase 5 verification and commit

- [ ] Build `db-models` before testing API so its local dependency is current.
- [ ] Run focused article, automations, admin database, V02, and removed-route tests.
- [ ] Run the complete API test suite and endpoint smoke suite where its required services or mocks are available.
- [ ] Run the API TypeScript build from clean output.
- [ ] Fix all Phase 5 regressions before continuing.
- [ ] Mark only completed Phase 5 tasks checked, review the staged diff, and commit the Phase 5 changes with a reference to this todo Phase 5.

## Phase 6: Portal V01 UI Removal and Viewer Preservation

### V01 surfaces

- [ ] Delete `OrchestratorSection.tsx`, `AiApproverSection.tsx`, `ModalAiApproverDetails.tsx`, the V01 prompt implementation, and both V01 prompt page files.
- [ ] Remove V01 score and gatekeeper requests, merge logic, state, callbacks, modal launch, table column, sorting, and rendering from the article review flow.
- [ ] Remove only V01 prompt, score, gatekeeper, and one-off response types from `portal/src/types/article.ts`.
- [ ] Confirm the automations page still renders every retained card, including AI Approver V02.

### Retained article-content and V02 behavior

- [ ] Preserve `ModalReviewArticleContent.tsx`, `ReviewArticleContentResponse`, `reviewArticleContentArticleId`, `onArticleContentClick`, and the `Open article content` table button.
- [ ] Change the modal request URL to `/articles/review-selected-content/:articleId`.
- [ ] Add or update focused portal coverage proving the button remains for `hasArticleContent` rows and the modal uses the retained endpoint.
- [ ] Preserve the V02 column, filter, details modal, validation, comments, and prediction refresh.
- [ ] Confirm removed V01 prompt URLs resolve through normal Next.js not-found behavior and do not redirect to V02.

### Clean build requirement

- [ ] Remove only the exact ignored `portal/.next` directory after confirming its path, then run a clean production build so deleted route output cannot survive.
- [ ] Inspect the clean route output for the deleted V01 pages.

### Phase 6 verification and commit

- [ ] Run portal lint with zero warnings.
- [ ] Run focused portal tests if a test runner exists for the touched components.
- [ ] Run the clean portal production build.
- [ ] Manually verify the automations page, V02 article-review controls, and the read-only article-content modal.
- [ ] Fix all Phase 6 regressions before continuing.
- [ ] Mark only completed Phase 6 tasks checked, review the staged diff, and commit the Phase 6 changes with a reference to this todo Phase 6.

## Phase 7: Scripts and Documentation Cleanup

### Executable assets

- [ ] Delete the weekly and test orchestrator systemd service files, weekly timer, both trigger scripts, and `scripts/schema/20260623_weekly_continuation_phase2.sql`.
- [ ] Delete `scripts/ai-approver-review-legend-counts.mjs` and its generated output after confirming they are V01-only.
- [ ] Rewrite `scripts/README.md` for retained scripts, or delete it if no retained instructions remain.
- [ ] Do not archive executable trigger, unit, or schema helpers.

### Active and historical documentation

- [ ] Update root and package `AGENTS.md` and README files so active guidance describes only V02 and retained independent workflows.
- [ ] Update database table references, deployment guidance, and worker-python API documentation that treats V01 or the legacy weekly flow as live.
- [ ] Delete V01-only active operational instructions and prompt assets that could reactivate the removed feature.
- [ ] Move historical V01 reports and implementation records into `docs/archive/YYYYMM/` based on each file's creation month.
- [ ] Move the July safe-removal report to `docs/archive/202607/` and repair active references.
- [ ] Preserve historical contents without rewriting their descriptions of old behavior.
- [ ] Ensure active guidance states that `orchestrator` no longer names a live NewsNexus product feature while allowing retained internal Python class names.

### Static and full-repository verification

- [ ] Search live source and active documentation for `AiApproverArticleScore`, `AiApproverPromptVersion`, `OrchestratorRun`, `OrchestratorRunStep`, `orchestratorRunId`, `X-Orchestrator-Run-Id`, `googleRssResumePlan`, deleted routes, deleted unit names, and V01 environment variables.
- [ ] Classify every remaining match as retained V02 or internal Python code, archived history, current removal documentation, or a defect to fix.
- [ ] Confirm no executable schema helper can recreate the removed tables or column.
- [ ] Re-run clean builds for `db-models`, db-manager, API, worker-node, and portal, purging only their exact generated output directories first.
- [ ] Run db-manager, API, and worker-node complete test suites, portal lint, and retained worker-python suites.
- [ ] Fix all Phase 7 regressions before continuing.
- [ ] Mark only completed Phase 7 tasks checked, review the staged diff, and commit the Phase 7 changes with a reference to this todo Phase 7.

## Operator Gate B: Retire Every Existing Ubuntu Schedule

- [ ] Stop before production deployment. Confirm the operator has separately authorized Ubuntu host changes.
- [ ] Have the operator inventory every NewsNexus12 systemd timer and service, Hermes job, application-user crontab, root crontab, and `/etc/cron*` entry.
- [ ] Recheck the known Hermes job `2c4cdcc53964`, weekly orchestrator timer and service, and db-manager timer and service without assuming the dated inventory is complete.
- [ ] Stop or disable triggers before handling an active execution; confirm child jobs reach a safe terminal state.
- [ ] Disable and remove every discovered NewsNexus12 schedule, stop associated services, remove obsolete definitions, and reload systemd where applicable.
- [ ] Verify no NewsNexus12 next trigger or active scheduled execution remains.
- [ ] Save sanitized retirement evidence without credentials, tokens, environment secrets, or unrelated host information.
- [ ] If an unidentified external caller or schedule cannot be safely retired, stop deployment and ask the operator for direction. Do not restore the removed implementation by default.
- [ ] If repository evidence documentation changes, run relevant markdown/static checks, mark only completed gate tasks, and commit only the sanitized evidence with a reference to this todo Operator Gate B.

## Operator Gate C: Replenish and Validate the Database

- [ ] Stop before modifying the configured database. Confirm the operator has separately authorized replenish and selected the verified pre-removal ZIP from Operator Gate A.
- [ ] Build `db-models` and db-manager from the removal branch using clean output.
- [ ] Have the operator run `npm start -- --zip_file /absolute/path/to/pre-change-backup.zip` from db-manager.
- [ ] Do not run `--drop_db`; ZIP import already drops and recreates `public` from current models.
- [ ] Confirm the four removed model CSVs are reported as skipped.
- [ ] Confirm retained tables import successfully and `NewsApiRequests` has no `orchestratorRunId` column.
- [ ] Confirm the database has no `AiApproverPromptVersions`, `AiApproverArticleScores`, `OrchestratorRuns`, or `OrchestratorRunSteps` tables.
- [ ] If replenish fails, stop affected services and use the documented rollback: switch to `main`, rebuild main's `db-models` and db-manager, then import the unchanged ZIP with main's db-manager.
- [ ] Do not re-enable any retired Ubuntu schedule during rollback.

## Phase 8: Post-replenish Smoke Test and Handoff

### Runtime smoke checks

- [ ] Start API, worker-node, worker-python, and portal without V01 settings and without the removed schema.
- [ ] Verify standalone Google RSS, article-content scraping, state assignment, semantic scoring, location scoring, deduplication, shared status, and cancellation paths.
- [ ] Verify AI Approver V02 preview, start, status, cancellation, prompt management, prediction review, validation, and comments.
- [ ] Verify the article-review content button opens the retained read-only `ArticleContents02` modal.
- [ ] Verify removed portal URLs and representative API, worker-node, and worker-python endpoints return ordinary `404` responses.
- [ ] Verify no live UI exposes V01 or the legacy weekly feature.
- [ ] Recheck Ubuntu retirement evidence shows no enabled or scheduled NewsNexus12 job.

### Final repository state

- [ ] Run the full clean build and regression sequence one final time.
- [ ] Search clean generated output as well as source for stale deleted route and module files.
- [ ] Review `git status`, staged changes, and deletion list for unrelated modifications.
- [ ] Write a concise implementation and verification report, including any environment-limited checks and the sanitized gate evidence locations.
- [ ] Fix all Phase 8 regressions before declaring the implementation complete.
- [ ] Mark only completed Phase 8 tasks checked, update this todo's frontmatter, and commit the final verified changes with a reference to this todo Phase 8.

## Completion Criteria

- [ ] AI Approver V01 and the legacy weekly orchestrator cannot be started, queried, configured, continued, reviewed for scores, or reported through live code.
- [ ] The old product meaning of `orchestrator` is absent from live routes, contracts, models, logs, UI, scripts, and deployment assets.
- [ ] The generic article-content viewer and all AI Approver V02 behavior remain functional.
- [ ] Old ZIP backups import retained data while skipping removed model CSVs and ignoring removed retained-table columns.
- [ ] Clean deployment output contains no legacy compiled artifacts.
- [ ] Every retained automated suite, lint check, build, and required smoke test passes or has an explicitly documented environment limitation accepted by the operator.
- [ ] Operator evidence confirms every pre-existing NewsNexus12 Ubuntu schedule is retired and the rebuilt schema omits the legacy tables and column.
