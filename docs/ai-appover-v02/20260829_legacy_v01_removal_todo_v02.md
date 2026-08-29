---
created_at: 2026-08-29T21:50:35Z
updated_at: 2026-08-29T22:50:45Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Legacy Orchestrator and AI Approver V01 Removal Todo V02

## 1. Implementation Rules

- [ ] Work only on `dev_29_remove_v01_workflows` and preserve unrelated user changes and untracked files.
- [ ] Use `20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v03.md` and `20260829_legacy_v01_removal_plan_v02.md` as the implementation authority.
- [ ] Treat this file as superseding `20260829_legacy_v01_removal_todo_v01.md` and incorporating its assessment.
- [x] Do not implement `docs/archive/202608/20260829_weekly_article_processing_cron_prd.md`; this removal takes precedence.
- [ ] Do not add a replacement scheduler, automatic schema migration, `410` compatibility route, or V01 read-only interface.
- [ ] Preserve AI Approver V02, the generic article-content viewer, standalone Google RSS, shared queues, and unrelated automations.
- [ ] Preserve retained internal Python classes named `orchestrator.py` under AI Approver V02, deduper, and location scorer.
- [ ] Treat Ubuntu host changes and database replenish as operator-controlled gates. An implementing agent must stop and obtain the stated authorization before performing either gate.
- [ ] After every markdown modification, update `updated_at` and `modified_by` when the file is governed by repository frontmatter rules; never change immutable creation fields.
- [ ] At each phase end, fix relevant failures before proceeding, check off only tasks actually completed, update this todo's modification frontmatter, stage only phase-related changes, and commit using repository guidance with this todo filename and phase in the body.
- [ ] Never use broad cleanup such as `git clean`. Clean only exact generated directories named below so user-owned files remain safe.
- [ ] Phase 2 is one atomic consumer-provider integration phase. Do not commit its API, worker-node, or shared-model changes separately, and do not commit until db-models, db-manager, API, and worker-node all compile and their required tests pass.

## Phase 1: Baseline Inventory and Pre-removal Fixture

### Repository alignment

- [x] Confirm the branch is `dev_29_remove_v01_workflows` and record starting `git status` without altering unrelated changes.
- [x] Add a prominent notice to `docs/archive/202608/20260829_weekly_article_processing_cron_prd.md` that it is invalid for implementation, subordinate to the removal PRD, and requires redesign without the removed route, tables, header, and column.
- [x] Inventory live references to V01 models, V01 routes, `/orchestrator`, `X-Orchestrator-Run-Id`, `googleRssResumePlan`, deployment assets, and V01 settings across source, tests, scripts, and active documentation.
- [x] Classify every match as removal work, retained V02 or internal Python coordination, historical material to archive, or current removal documentation.
- [x] Create a sanitized Ubuntu retirement evidence template covering systemd, Hermes, user and root crontabs, `/etc/cron*`, active child jobs, removal results, daemon reload, and remaining triggers.

### Pre-removal ZIP baseline

- [x] Extend `db-manager/tests/modules/zipImport.test.ts` with an old-backup ZIP fixture containing the four legacy model CSVs and an old-format `NewsApiRequest.csv` with `orchestratorRunId`.
- [x] Establish the pre-removal behavior while legacy models remain registered; do not require the four model CSVs to be skipped yet.
- [x] Confirm the fixture is readable and uses only test-managed temporary directories.

### Phase 1 verification and commit

- [x] Run the focused ZIP-import test.
- [x] Run the complete db-manager test suite.
- [x] Run the db-manager TypeScript build.
- [x] Fix all Phase 1 failures before continuing.
- [x] Mark only completed Phase 1 tasks, review the staged diff, and commit with a reference to this todo Phase 1.

## Operator Gate A: Preserve the Pre-removal Database

- [x] Stop before any legacy model removal. Confirm the operator has authorized this gate and will perform or directly supervise it.
- [x] From code that still registers the legacy models, have the operator run `cd db-manager` and `npm start -- --create_backup`.
- [x] Record the absolute ZIP path and confirm it remains unchanged for forward replenish and rollback.
- [x] Do not run `--drop_db`; no schema change occurs at this gate.
- [x] Do not begin Phase 2 until the verified pre-removal ZIP exists.

Gate A evidence:

- Operator-supplied ZIP: `/Users/nick/Downloads/db_backup_202608292156564.zip`
- SHA-256: `184edcb5c4d66e41bd6c934b4e0ed22bcc563f35aac2bd6d933ab25575cf14f0`
- Readability check confirmed the four legacy model CSVs and old-format `NewsApiRequest.csv` are present.
- No database drop or import was performed at this gate.

## Phase 2: Atomic Consumer and Provider Removal

All Phase 2 edits remain in one working-tree integration unit. Remove API and worker-node consumers before deleting db-models exports, but make only one phase commit after the entire dependency graph passes verification.

### Worker-node consumers and runtime

- [x] Unmount and delete `worker-node/src/routes/orchestrator.ts` and every file under `worker-node/src/modules/orchestrator/`.
- [x] Remove `runReconciliation()` and its legacy logging from `worker-node/src/server.ts`.
- [x] Delete worker-node orchestrator lock middleware and active-run guard.
- [x] Remove the orchestrator router, global start-job lock, and `skipOrchestratorLock` app option from `worker-node/src/app.ts`.
- [x] Delete `worker-node/src/modules/google-rss/resumePlanner.ts`.
- [x] Remove the complete `googleRssResumePlan` request contract and `X-Orchestrator-Run-Id` handling.
- [x] Remove orchestrator, source-run, continuation-run, and resume-position fields from Google RSS route inputs, queue payloads, job context, result metadata, and `NewsApiRequest` persistence.
- [x] Preserve normal spreadsheet iteration, RSS requests, article insertion, content seeding, follow-up scraping, retry, cancellation, and query reporting.
- [x] Remove `OrchestratorRuns` and `OrchestratorRunSteps` from `ensureDbReady.ts` and rewrite rebuild guidance without a separate schema drop.
- [x] Delete orchestrator-, continuation-, lock-, and resume-owned tests; update Google RSS, model metadata, starter-route, and startup readiness coverage for retained behavior.

### API consumers and retained content handler

- [x] Unmount and delete `api/src/routes/automations/orchestrator.ts`.
- [x] Unmount and delete `api/src/routes/analysis/ai-approver.ts` and `api/src/modules/analysis/ai-approver.ts`.
- [x] Remove only the V01 `/automations/ai-approver/start-job` handler from the shared automations router.
- [x] Preserve all V02 routes and shared worker status, cancellation, Excel, Google RSS, scraper, state-assigner, semantic-scorer, and location-scorer proxies.
- [x] Remove the four legacy model imports and registrations from the admin database route and tests before deleting their shared exports.
- [x] Keep `GET /articles/review-selected-content/:articleId` as the sole authenticated read-only content handler and add `title: article.title` to its successful response.
- [x] Preserve numeric validation, not-found behavior, canonical `ArticleContents02` selection, success-state checks, and null-content behavior.
- [x] Expand articles-route tests for title, content states, invalid ID, missing article, and authentication.
- [x] Delete V01 and orchestrator route tests and add negative app-level tests proving removed paths return ordinary `404` without proxying.

### Shared provider and schema graph

- [x] After consumer imports are gone, delete the `AiApproverPromptVersion`, `AiApproverArticleScore`, `OrchestratorRun`, and `OrchestratorRunStep` model files.
- [x] Remove their initialization, exports, return values, type exports, associations, and `MODEL_LOAD_ORDER` entries.
- [x] Remove `orchestratorRunId` from `NewsApiRequest` attributes, creation attributes, class declaration, and Sequelize definition.
- [x] Preserve all AI Approver V02 models, types, initialization, and associations.
- [x] Confirm sequence reset remains generic over retained registered models.

### Post-removal import compatibility

- [x] Filter retained CSV records in `db-manager/src/modules/zipImport.ts` to current `rawAttributes` before sanitization and `bulkCreate`.
- [x] Convert the Phase 1 fixture to post-removal assertions.
- [x] Assert the four deleted-model CSVs are returned and logged as skipped without failing import.
- [x] Assert retained `NewsApiRequest` fields reach `bulkCreate` and `orchestratorRunId` does not.
- [x] Preserve date, number, boolean, JSON, batching, foreign-key, rebuild, and sequence-reset behavior.
- [x] Update load-order and model-metadata tests for the retained graph.

### Clean output and atomic verification

- [x] Run `npm run clean` in `db-models` and db-manager.
- [x] Remove only the exact ignored `api/dist` and `worker-node/dist` directories after confirming their paths.
- [x] Build `db-models` first so all consumers resolve the new provider contract.
- [x] Run focused and complete db-manager tests, including the old-backup fixture, then build db-manager.
- [x] Run focused API article, automation, admin, V02, and removed-route tests; run the complete API test suite and available endpoint smoke tests; build API.
- [x] Run focused worker-node startup, Google RSS, model-metadata, and retained starter-route tests; run the complete worker-node suite; build worker-node.
- [x] Search rebuilt `db-models/dist`, `api/dist`, and `worker-node/dist` for deleted filenames, exports, routes, resume contract, and header.
- [x] Fix every Phase 2 test, type, build, or stale-output failure before staging anything.
- [x] Confirm `git diff --cached` does not contain only one side of the consumer-provider transition.
- [x] Mark only completed Phase 2 tasks, stage the full atomic integration, and create one Phase 2 commit referencing this todo Phase 2.

## Phase 3: Worker-Python V01 and Lock Removal

### Runtime, configuration, and tests

- [x] Unmount and delete `worker-python/src/routes/ai_approver.py`.
- [x] Delete `worker-python/src/modules/ai_approver/`, the V01 prompt setup utility, prompt asset, contract fixture, and V01 contract, integration, and unit tests.
- [x] Remove V01 startup validation, warnings, imports, and router registration from `worker-python/src/main.py`.
- [x] Remove V01-only environment examples while preserving every `AI_APPROVER_V02_*` setting and shared credential required elsewhere.
- [x] Remove `OrchestratorLockMiddleware` registration from FastAPI startup.
- [x] Delete `worker-python/src/modules/orchestrator/active_run_guard.py` and `lock_middleware.py`.
- [x] Delete `worker-python/src/modules/orchestrator/__init__.py` and its package directory when empty.
- [x] Remove stale V01 and legacy-lock `__pycache__` files without touching retained workflow packages.
- [x] Confirm V02, deduper, location scorer, queue status, and cancellation code imports neither deleted package.

### Phase 3 verification and commit

- [x] Run worker-python V02 unit and integration suites.
- [x] Run retained deduper and location-scorer unit suites.
- [x] Run the broader worker-python suite when available.
- [x] Import or start FastAPI in a test environment without V01 settings and confirm retained routes register.
- [x] Fix all Phase 3 failures before continuing.
- [x] Mark only completed Phase 3 tasks, review the staged diff, and commit with a reference to this todo Phase 3.

## Phase 4: Portal V01 Removal and Viewer Preservation

### V01 surfaces

- [x] Delete `OrchestratorSection.tsx`, `AiApproverSection.tsx`, `ModalAiApproverDetails.tsx`, the V01 prompt implementation, and both V01 prompt page files.
- [x] Remove V01 score and gatekeeper requests, merge logic, state, callbacks, modal launch, table column, sorting, and rendering from article review.
- [x] Remove only V01 prompt, score, gatekeeper, and one-off response types from `portal/src/types/article.ts`.
- [x] Confirm the automations page retains every independent card, including AI Approver V02.

### Retained article content and V02

- [x] Preserve `ModalReviewArticleContent.tsx`, `ReviewArticleContentResponse`, `reviewArticleContentArticleId`, `onArticleContentClick`, and the content button.
- [x] Change the modal URL to `/articles/review-selected-content/:articleId`.
- [x] Add or update focused coverage proving the button remains for `hasArticleContent` rows and the modal uses the retained endpoint.
- [x] Preserve the V02 column, filter, details modal, validation, comments, and prediction refresh.
- [x] Confirm removed V01 prompt URLs use normal Next.js not-found behavior without a V02 redirect.

### Clean output, verification, and commit

- [x] Remove only the exact ignored `portal/.next` directory after confirming its path.
- [x] Run portal lint with zero warnings.
- [x] Run focused portal tests if a test runner exists for touched components.
- [x] Run the clean portal production build and inspect route output for deleted V01 pages.
- [x] Manually verify the automations page, V02 review controls, and read-only content modal.
- [x] Fix all Phase 4 failures before continuing.
- [x] Mark only completed Phase 4 tasks, review the staged diff, and commit with a reference to this todo Phase 4.

Phase 4 verification notes:

- Portal has no configured component test runner.
- Focused source assertions confirmed the content button remains conditional on `hasArticleContent`, its callback remains wired, and the modal uses the retained endpoint.
- Lint passed with zero warnings. The clean Webpack production build passed after allowing its configured Google Font download.
- Build route output contains V02 prompts and no V01 prompt route.

## Phase 5: Scripts, Documentation, and Full Repository Verification

### Executable assets

- [x] Delete the weekly and test orchestrator systemd services, weekly timer, both trigger scripts, and `scripts/schema/20260623_weekly_continuation_phase2.sql`.
- [x] Delete `scripts/ai-approver-review-legend-counts.mjs` and its output after confirming they are V01-only.
- [x] Rewrite `scripts/README.md` for retained scripts, or delete it if no retained instructions remain.
- [x] Do not archive executable trigger, unit, or schema helpers.

### Documentation

- [x] Update root and package `AGENTS.md` and README files so active guidance describes only V02 and retained independent workflows.
- [x] Update database table references, deployment guidance, and worker-python API documentation that treats either removed feature as live.
- [x] Delete V01-only operational instructions and prompt assets that could reactivate V01.
- [x] Move historical V01 reports and implementation records to `docs/archive/YYYYMM/` using each file's creation month.
- [x] Move the July safe-removal report to `docs/archive/202607/` and repair active references.
- [x] Preserve historical contents without rewriting descriptions of old behavior.
- [x] Ensure active guidance states `orchestrator` no longer names a live NewsNexus product feature while allowing retained internal Python class names.

### Clean full-repository verification and commit

- [x] Search live source and active docs for the four deleted model names, `orchestratorRunId`, `X-Orchestrator-Run-Id`, `googleRssResumePlan`, deleted routes and unit names, and V01 settings.
- [x] Classify every remaining match as retained internal code, archived history, removal documentation, or a defect to fix.
- [x] Confirm no executable schema helper can recreate removed schema.
- [x] Purge only exact generated output directories for db-models, db-manager, API, worker-node, and portal; rebuild all in dependency order.
- [x] Run complete db-manager, API, and worker-node suites, portal lint, and retained worker-python suites.
- [x] Fix all Phase 5 failures before continuing.
- [x] Mark only completed Phase 5 tasks, review the staged diff, and commit with a reference to this todo Phase 5.

Phase 5 verification notes:

- Clean builds passed for db-models, db-manager, API, worker-node, and portal in dependency order.
- Complete suites passed: db-manager 212 tests, API 158 tests, worker-node 167 tests, and worker-python 148 tests. Portal lint passed with zero warnings.
- The portal production build passed with Webpack. Turbopack stalled without reporting a build failure, so its exact build processes were stopped before the verified Webpack run.
- Remaining search matches are retained V02 names, internal Python implementation names, negative route tests, backup-compatibility fixtures, archived history, or current removal records.
- No live executable trigger, service, timer, or schema helper remains that can reactivate or recreate the removed workflows.

## Mac Workstation Database Rehearsal

- [x] Confirm no local NewsNexus application process is running before replenishment.
- [x] Reconfirm the source ZIP checksum and compressed-file integrity.
- [x] Clean and build db-models and db-manager from the removal branch.
- [x] Validate the source ZIP through db-manager's disposable scratch-database flow.
- [x] Replenish local `newsnexus_dev` with `--zip_file`, allowing that operation to rebuild `public` without a separate `--drop_db` call.
- [x] Confirm the four removed CSV files are skipped.
- [x] Confirm the four removed tables and `NewsApiRequests.orchestratorRunId` are absent.
- [x] Confirm retained V02, article, and article-content tables are present.
- [x] Create and verify a new post-removal database backup.
- [x] Restore the new post-removal backup into a disposable scratch database to prove round-trip compatibility.
- [x] Start API, worker-node, worker-python, and portal against the replenished local database.
- [x] Confirm retained health, queue, V02 history, API, article-content, and portal routes are mounted.
- [x] Confirm representative removed API, worker-node, worker-python, and portal routes return `404`.
- [x] Stop all temporary local application processes.

Mac workstation rehearsal notes:

- Source ZIP: `/Users/nick/Downloads/db_backup_202608292156564.zip`
- Source SHA-256: `184edcb5c4d66e41bd6c934b4e0ed22bcc563f35aac2bd6d933ab25575cf14f0`
- Replenish imported 1,552,287 records across 26 retained tables and restored 254,127 articles.
- Import skipped `AiApproverArticleScore.csv`, `AiApproverPromptVersion.csv`, `OrchestratorRun.csv`, and `OrchestratorRunStep.csv`.
- Post-removal backup: `/Users/nick/Documents/_testData/db_backup_202608292247058.zip`
- Post-removal SHA-256: `11e6f15ab4808e074d9c2ed6411477ad89a28b29873d7feb71cb8ec4cb8dc3ea`
- The new ZIP passed integrity testing, omits the four removed CSV files, and omits `orchestratorRunId` from `NewsApiRequest.csv`.
- The new ZIP passed db-manager's scratch restore with 1,552,279 records across 26 retained tables.
- Runtime checks returned `200` for retained public routes, `401` for retained protected API routes, and `404` for representative removed routes.
- Ubuntu was not accessed or modified during this rehearsal.

## Operator Gate B: Retire Every Existing Ubuntu Schedule

- [ ] Stop before production deployment and obtain separate operator authorization for Ubuntu host changes.
- [ ] Have the operator inventory every NewsNexus12 systemd timer and service, Hermes job, application-user crontab, root crontab, and `/etc/cron*` entry.
- [ ] Recheck Hermes job `2c4cdcc53964`, the weekly orchestrator timer and service, and the db-manager timer and service without assuming the dated inventory is complete.
- [ ] Stop or disable triggers before handling active execution; confirm child jobs reach a safe terminal state.
- [ ] Disable and remove every discovered NewsNexus12 schedule, stop associated services, remove definitions, and reload systemd where applicable.
- [ ] Verify no NewsNexus12 next trigger or active scheduled execution remains.
- [ ] Save sanitized evidence without secrets or unrelated host information.
- [ ] If an unidentified caller or schedule cannot be safely retired, stop deployment and ask the operator. Do not restore old code by default.
- [ ] If repository evidence changes, run relevant static checks, mark only completed gate tasks, and commit only sanitized evidence with a reference to Operator Gate B.

## Operator Gate C: Replenish and Validate the Database

- [ ] Stop before modifying the configured database and obtain separate operator authorization for replenish.
- [ ] Confirm the selected ZIP is the unchanged backup from Operator Gate A.
- [ ] Clean and build `db-models` and db-manager from the removal branch.
- [ ] Have the operator run `npm start -- --zip_file /absolute/path/to/pre-change-backup.zip` from db-manager.
- [ ] Do not run `--drop_db`; ZIP import already rebuilds `public`.
- [ ] Confirm the four removed model CSVs are reported as skipped.
- [ ] Confirm retained tables import and `NewsApiRequests` has no `orchestratorRunId` column.
- [ ] Confirm the four removed tables do not exist.
- [ ] If replenish fails, stop affected services and follow the documented main-branch rebuild and ZIP-import rollback.
- [ ] Do not re-enable a retired Ubuntu schedule during rollback.

## Phase 6: Post-replenish Smoke Test and Handoff

### Runtime checks

- [ ] Start API, worker-node, worker-python, and portal without V01 settings and removed schema.
- [ ] Verify standalone Google RSS, scraping, state assignment, semantic scoring, location scoring, deduplication, shared status, and cancellation.
- [ ] Verify V02 preview, start, status, cancellation, prompt management, prediction review, validation, and comments.
- [ ] Verify the article-review content button opens the retained read-only `ArticleContents02` modal.
- [ ] Verify removed portal and HTTP paths return ordinary `404`.
- [ ] Verify no live UI exposes V01 or the weekly orchestrator.
- [ ] Recheck Ubuntu evidence shows no enabled or scheduled NewsNexus12 job.

### Final verification and commit

- [ ] Run the full clean build and regression sequence again.
- [ ] Search clean generated output and source for stale deleted files or contracts.
- [ ] Review `git status`, staged changes, and deletion list for unrelated modifications.
- [ ] Write a concise implementation report including environment-limited checks and sanitized gate-evidence locations.
- [ ] Fix all Phase 6 failures before declaring completion.
- [ ] Mark only completed Phase 6 tasks, update this todo's frontmatter, and commit final verified changes with a reference to this todo Phase 6.

## Completion Criteria

- [ ] No committed phase leaves API or worker-node importing deleted db-models exports.
- [ ] AI Approver V01 and the weekly orchestrator cannot be started, queried, configured, continued, score-reviewed, or reported through live code.
- [ ] The old product meaning of `orchestrator` is absent from live routes, contracts, models, logs, UI, scripts, and deployment assets.
- [ ] The generic article-content viewer and AI Approver V02 remain functional.
- [ ] Old ZIP backups import retained data while skipping removed model CSVs and filtering removed retained-table columns.
- [ ] Clean deployment output contains no legacy compiled artifacts.
- [ ] Retained suites, lint, builds, and smoke checks pass or have operator-accepted environment limitations.
- [ ] Operator evidence confirms every prior NewsNexus12 Ubuntu schedule is retired and rebuilt schema omits legacy tables and column.
