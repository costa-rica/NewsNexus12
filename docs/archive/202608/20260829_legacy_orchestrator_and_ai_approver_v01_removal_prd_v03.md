---
created_at: 2026-08-29T21:31:54Z
updated_at: 2026-08-30T00:51:09Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Legacy Orchestrator and AI Approver V01 Removal PRD V03

Difficulty: high. Risk: medium-high. The portal card is already hidden, but the legacy weekly orchestrator and AI Approver V01 span four apps, shared models, locks, reports, backups, and historical data. Safe removal requires staged traffic verification, compatibility decisions, database backups, and regression testing; careless deletion could block unrelated automation jobs.

## 1. Document Status

- Status: draft V03 for assessment
- Active implementation branch: `dev_29_remove_v01_workflows`
- Product change: remove AI Approver V01 and the legacy Weekly Orchestrator V01
- Supersedes: `20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v02.md`
- Primary inventory: `docs/archive/202607/20260723_ai_approver_v01_safe_removal_report.md`
- Assessment incorporated: `20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd_v02_assessment_claude.md`
- Repository evidence reviewed: 2026-08-29
- Legacy application-code removal authorized: yes
- Local legacy schema removal authorized: yes, through the operator-controlled backup and replenish workflow
- Existing NewsNexus12 Ubuntu schedules considered obsolete: yes
- Automatic schema migration required: no
- Production deployment authorized by this PRD: no
- Open questions: none

### 1.1 Precedence over the weekly cron PRD

This removal PRD takes precedence over the technical design in `docs/20260829_weekly_article_processing_cron_prd_v01.md`. The weekly PRD remains the active source of product requirements for a replacement flow using AI Approver V02.

The weekly cron PRD must not be implemented in its current form because it depends on assets this PRD removes:

- the worker-node `/orchestrator` feature
- `OrchestratorRuns`
- `OrchestratorRunSteps`
- `NewsApiRequests.orchestratorRunId`
- legacy active-run locks and continuation behavior
- the old Ubuntu orchestrator scripts and systemd units

The desired future weekly workflow remains valid product input, but it requires a new PRD version with a new name and persistence design. That redesign must not depend on the removed legacy orchestrator.

This removal does not build the replacement weekly workflow. Existing NewsNexus12 Ubuntu-level cron jobs, timers, and scheduler jobs must be retired before new scheduling is installed.

## 2. Incorporated Operator Decisions

1. Work will continue on `dev_29_remove_v01_workflows`.
2. AI Approver V01 and the legacy weekly workflow will be deleted, not retained as read-only features.
3. Their legacy tables and the legacy `NewsApiRequests` column will be absent from the rebuilt database schema.
4. The operator will create a ZIP backup before using the new branch to replenish the database.
5. No schema migration will be added for this removal.
6. Old ZIP backups will remain usable by skipping CSV files whose models no longer exist.
7. Removed endpoints will return normal `404` responses.
8. Unrelated classes and files named `orchestrator` will not be renamed.
9. No live V01 history interface will remain.
10. Historical V01 reports will be archived by creation month.
11. Instructions, prompt assets, scripts, and schema helpers that could reactivate the old flow will be deleted.
12. The removal PRD takes precedence over the existing weekly cron PRD.
13. Every existing NewsNexus12 Ubuntu schedule is considered obsolete and must be disabled and removed through an operator-controlled deployment task.
14. A future weekly workflow will be designed and installed separately.

## 3. Important Backup and Branch Clarifications

### 3.1 ZIP imports already rebuild the schema

The current db-manager ZIP import:

1. Reads the ZIP file.
2. Runs `rebuildSchema()`.
3. Drops and recreates the PostgreSQL `public` schema from the checked-out models.
4. Imports CSV files in `MODEL_LOAD_ORDER`.
5. Skips and reports CSV files absent from the current model load order.
6. Resets database sequences.

Do not run `--drop_db` before `--zip_file`. The import already performs the destructive rebuild.

### 3.2 A Git branch does not isolate PostgreSQL

Changing branches changes repository files but does not restore or switch database data. After this branch rebuilds the shared local database, switching back to `main` alone does not restore the removed schema.

A full rollback requires:

1. Switch to `main`.
2. Rebuild `db-models` and db-manager from `main`.
3. Import the unchanged pre-removal ZIP using the main-branch db-manager.

### 3.3 Old backup compatibility

After model cleanup, the importer must skip and report:

- `AiApproverPromptVersion.csv`
- `AiApproverArticleScore.csv`
- `OrchestratorRun.csv`
- `OrchestratorRunStep.csv`

`NewsApiRequest.csv` remains a recognized file but an old backup may include `orchestratorRunId`. A compatibility test must prove retained fields import without recreating or requiring the removed column.

If Sequelize does not safely ignore the removed field, the importer must filter rows to current model attributes before `bulkCreate`.

## 4. Problem

AI Approver V01 and the legacy weekly workflow remain implemented even though their portal automation cards are hidden.

The weekly feature uses `orchestrator` as a product name, route, source namespace, database model prefix, request header, log term, deployment unit name, and schema helper name. This conflicts with the operator's goal of removing the old meaning and creates a foundation that newer automation designs could accidentally reuse.

Deleting only the portal component would leave callable routes, active-run locks, execution and continuation logic, scheduled callers, report generation, database coupling, tests, and V01 review behavior in place.

## 5. Goals

1. Remove AI Approver V01 as an executable, queryable, configurable, and visible feature.
2. Remove the legacy weekly workflow and all code used only by it.
3. Remove the old product meaning of `orchestrator` from live routes, headers, models, logs, UI, scripts, and deployment assets.
4. Retire all current NewsNexus12 Ubuntu schedules before route removal is deployed.
5. Remove the legacy schema through the operator's backup and replenish process.
6. Keep old ZIP backups usable by skipping removed model CSV files.
7. Preserve AI Approver V02 and unrelated automations.
8. Preserve standalone Google RSS while deleting its unreachable legacy continuation contract.
9. Protect retained jobs from regressions caused by removing global locks and startup requirements.
10. Leave a clean foundation for a separately designed weekly workflow.

## 6. Non-Goals

- Do not remove or rename AI Approver V02.
- Do not add a replacement AI scoring flow.
- Do not implement a replacement weekly scheduler in this project.
- Do not preserve the architecture from the current weekly cron PRD.
- Do not remove the worker-python shared queue.
- Do not remove standalone Google RSS, article scraping, state assignment, semantic scoring, location scoring, or deduplication.
- Do not rename retained V02, deduper, or location-scorer `orchestrator.py` files.
- Do not add a schema migration for this removal.
- Do not retain a read-only V01 UI.
- Do not rewrite generated historical report contents.
- Do not enable or install any new Ubuntu schedule as part of removal.

## 7. Removal Boundary

### 7.1 AI Approver V01

Remove:

- portal V01 automation, prompt, article-review, modal, and one-off scoring code
- API `/automations/ai-approver` and `/analysis/ai-approver` behavior
- worker-python `/ai-approver` routes
- `worker-python/src/modules/ai_approver`
- V01 startup validation, prompt setup utility, and prompt asset
- V01 configuration and environment reads
- V01 models, associations, load-order entries, tests, and active instructions

### 7.2 Legacy weekly workflow

Remove:

- `portal/src/components/automations/OrchestratorSection.tsx`
- API `/automations/orchestrator` proxy routes
- worker-node `/orchestrator` routes
- `worker-node/src/modules/orchestrator`
- startup reconciliation and active-run caching
- worker-node and worker-python active-run locks
- `X-Orchestrator-Run-Id`
- continuation and weekly report-generation code
- legacy models, associations, load-order entries, tests, and active instructions
- Google RSS fields, planners, and request behavior used only by legacy continuation

### 7.3 Retained coordination code

Preserve:

- `worker-python/src/modules/ai_approver_v02/orchestrator.py`
- `worker-python/src/modules/deduper/orchestrator.py`
- `worker-python/src/modules/location_scorer/orchestrator.py`
- local variables referring only to those retained single-workflow classes

Do not rename or delete these solely because they contain `orchestrator`.

## 8. Ubuntu Schedule and Deployment Retirement

### 8.1 Operational retirement gate

Before deploying removed endpoints, the operator-controlled retirement task must:

1. Inventory all NewsNexus12 schedules on the Ubuntu host.
2. Include systemd timers and services, Hermes scheduler jobs, the application user's crontab, root's crontab, and `/etc/cron*` entries.
3. Stop any active scheduled NewsNexus12 execution and confirm child jobs have reached a safe terminal state.
4. Disable every discovered NewsNexus12 timer or scheduler job.
5. Stop associated services.
6. Remove installed obsolete unit files and reload systemd.
7. Remove obsolete scheduler definitions where applicable.
8. Verify no next trigger remains for NewsNexus12.
9. Record the retired names and final status as deployment evidence.

The dated production assessment identified these known items, which must be rechecked rather than assumed current:

- Hermes job `2c4cdcc53964`, named `NewsNexus12 weekly Google RSS — Friday 5am Pacific`
- `newsnexus12-worker-node-orchestrator-weekly.timer`
- `newsnexus12-worker-node-orchestrator-weekly.service`
- `newsnexus12-db-manager.timer`
- `newsnexus12-db-manager.service`

Any additional NewsNexus12 schedule found during the host audit is also obsolete under this PRD.

### 8.2 Repository deployment assets

Delete:

- `scripts/newsnexus12-worker-node-orchestrator-weekly.service`
- `scripts/newsnexus12-worker-node-orchestrator-weekly.timer`
- `scripts/newsnexus12-worker-node-orchestrator-test.service`
- `scripts/trigger-worker-node-orchestrator-weekly.sh`
- `scripts/trigger-worker-node-orchestrator-test.sh`
- `scripts/schema/20260623_weekly_continuation_phase2.sql`

Delete `scripts/README.md` if it contains no retained instructions after these assets are removed. Otherwise rewrite it to cover only retained scripts.

The SQL file must not be archived as an executable helper because it can recreate removed columns and constraints.

### 8.3 Future schedules

- Do not restore an old standalone schedule during rollback from this removal.
- Do not retain old unit templates as the basis for the next workflow.
- A future cron PRD must define new names, state ownership, installation, verification, and rollback behavior.
- The future scheduler must not use the removed route, models, request header, or database column.

## 9. Portal Requirements

### 9.1 Automations and prompt pages

- Delete `OrchestratorSection.tsx`.
- Delete the hidden AI Approver V01 automation component.
- Delete the V01 prompt-management implementation.
- Remove the articles-path V01 prompt route and the older analysis-path redirect or wrapper.
- Return the normal application not-found result for removed V01 portal URLs.
- Do not redirect V01 prompt URLs to V02.
- Preserve independent automation cards and V02 prompt management.

### 9.2 Article review

- Stop fetching V01 top scores and gatekeeper results.
- Remove V01 row merges, state, refresh handlers, sorting, and rendering.
- Remove the hidden AI Approver V01 column.
- Remove the V01 details modal and one-off review flow.
- Remove V01-only TypeScript fields and response types.
- Preserve the V02 column, filters, modal, validation, and comments.

## 10. API Requirements

### 10.1 Routes

- Unmount and delete `api/src/routes/automations/orchestrator.ts`.
- Unmount and delete `api/src/routes/analysis/ai-approver.ts`.
- Remove only the V01 `/automations/ai-approver/start-job` handler from the shared automations router.
- Preserve shared worker status, latest-job, and cancel routes used by retained workflows.
- Preserve all V02 automation and analysis routes.

### 10.2 Endpoint retirement

- Removed portal, API, and worker paths must use normal `404` behavior.
- Do not implement a `410 Gone` compatibility route in this project.
- Known repository and Ubuntu callers must be retired before route removal is deployed.
- If an unidentified external caller is discovered, stop deployment and obtain separate operator direction. Do not retain the old implementation by default.
- Removed routes must never proxy to a worker or return successful compatibility responses.

### 10.3 Tests

- Delete V01 route and legacy weekly proxy tests.
- Update shared route tests to prove retained proxies still work.
- Add negative tests proving removed endpoints return `404`.
- Update admin database tests after removing legacy models.

## 11. Worker-Node Requirements

### 11.1 Legacy runtime

- Unmount and delete the `/orchestrator` router.
- Delete the coordinator, repository, child-job client, active-run guard, continuation modules, types, and report writer.
- Remove server startup reconciliation and cache invalidation.
- Remove the global middleware that blocks independent start-job requests during a legacy run.
- Remove legacy configuration, errors, logs, and response shapes.

### 11.2 Startup schema readiness

Update `worker-node/src/modules/db/ensureDbReady.ts`:

- remove `OrchestratorRuns` from `REQUIRED_TABLES`
- remove `OrchestratorRunSteps` from `REQUIRED_TABLES`
- keep only tables needed by retained worker-node routes
- rewrite `REBUILD_INSTRUCTIONS` so it does not instruct the operator to drop the schema before `--zip_file`
- add a focused test proving worker-node schema readiness succeeds without the removed tables

### 11.3 Google RSS legacy continuation

Delete `worker-node/src/modules/google-rss/resumePlanner.ts`. Its only live caller belongs to the removed legacy continuation flow.

Delete the entire `googleRssResumePlan` request contract from `worker-node/src/routes/requestGoogleRss.ts`, including:

- `resumeAfterQueryRowIndex`
- `resumeAfterQueryRowId`
- `sourceOrchestratorRunId`
- `continuationRunId`
- `resumeAfterRequestUrl`

Also remove:

- `X-Orchestrator-Run-Id` parsing and propagation
- `orchestratorRunId` from job inputs, contexts, and persisted requests
- legacy resume-plan types and job fields
- resume-planner and request-contract tests

Preserve normal standalone Google RSS submission, queue processing, query iteration, and non-legacy retry behavior.

### 11.4 Tests

- Delete tests owned by the weekly workflow and its continuation planner.
- Update request-Google-RSS route, job, and model-metadata tests.
- Test standalone Google RSS without legacy body fields, headers, locks, or run records.
- Test that each retained worker-node job can start without an active-run lookup.
- Verify worker-node startup has no old route, table, model, or reconciliation dependency.

## 12. Worker-Python Requirements

### 12.1 AI Approver V01

- Unmount and delete `src/routes/ai_approver.py`.
- Delete `src/modules/ai_approver`.
- Delete the V01 prompt setup script and V01-only prompt assets.
- Remove V01 startup validation, warnings, configuration, and environment reads.
- Delete V01 contract, integration, and unit tests.

### 12.2 Legacy lock

- Remove `OrchestratorLockMiddleware` from FastAPI startup.
- Delete the associated active-run guard package when no caller remains.
- Confirm retained routes use their own queue and concurrency behavior.
- Preserve the shared queue, cancellation, status, deduper, location scorer, and V02 behavior.
- Verify startup succeeds without V01 environment variables or legacy tables.

## 13. Database and Import Requirements

### 13.1 Remove from the rebuilt schema

- `AiApproverPromptVersions`
- `AiApproverArticleScores`
- `OrchestratorRuns`
- `OrchestratorRunSteps`
- `NewsApiRequests.orchestratorRunId`

### 13.2 Model cleanup

- Delete the four legacy model files.
- Remove their initialization and exports.
- Remove their associations and `MODEL_LOAD_ORDER` entries.
- Remove explicit admin database registration.
- Remove legacy sequence-reset and compile-time references.
- Keep V02 models and associations unchanged.

### 13.3 Old-backup fixture lifecycle

Before model removal:

1. Create a test ZIP containing the four legacy model CSV files.
2. Add an old-format `NewsApiRequest.csv` containing `orchestratorRunId`.
3. Confirm the fixture is readable and establish the current import baseline.
4. Do not require the legacy files to be skipped while their models still exist.

After model removal:

1. Assert the four legacy CSVs are skipped and reported.
2. Assert retained `NewsApiRequest` fields import successfully.
3. Assert `orchestratorRunId` is ignored and not recreated.
4. Filter rows to current model attributes if required.
5. Assert expected skipped legacy files do not fail the import.

## 14. Operator Database Workflow

### 14.1 Before replenishment

From the code version that still contains legacy models, the operator will:

1. Run `cd db-manager`.
2. Run `npm start -- --create_backup`.
3. Confirm the created ZIP path.
4. Keep the ZIP unchanged for forward replenish and rollback.

### 14.2 Replenish from the removal branch

After the implementation is ready:

1. Build `db-models`.
2. Build db-manager if required by its normal workflow.
3. Run `npm start -- --zip_file /absolute/path/to/pre-change-backup.zip`.
4. Confirm the importer rebuilt the schema.
5. Confirm the four removed model CSVs were skipped.
6. Confirm retained tables imported successfully.
7. Confirm `NewsApiRequests` imported without `orchestratorRunId`.

Do not run `--drop_db` first.

### 14.3 Database rollback

If the branch cannot produce a clean working system:

1. Stop affected services.
2. Switch to `main`.
3. Rebuild `db-models` and db-manager from `main`.
4. Import the unchanged pre-removal ZIP using main's db-manager.
5. Verify the legacy schema and retained data were restored.

Database rollback does not authorize re-enabling obsolete Ubuntu schedules.

## 15. Documentation Requirements

- Mark the current weekly cron PRD as invalid for implementation and requiring a new version.
- Preserve its valid product goals as input to the future redesign.
- Remove V01-only environment examples after confirming they are not shared with V02.
- Remove legacy weekly configuration and examples.
- Update root and package guidance that describes V01 or the weekly workflow as callable.
- Move historical V01 reports into `docs/archive/YYYYMM/` using each report's creation month.
- Move the safe-removal report to `docs/archive/202607/` and update active references.
- Delete active V01 instructions and prompt assets that could incorrectly guide operations.
- Delete deployment instructions that could reinstall obsolete schedules.
- State in active guidance that `orchestrator` no longer names a live NewsNexus product feature.

## 16. Implementation Phases

### Phase 1: inventory, alignment, and fixtures

1. Mark the current weekly cron PRD as blocked by this removal and requiring redesign.
2. Inventory all source, tests, models, scripts, documents, and known Ubuntu callers.
3. Create the old-backup ZIP fixture and verify its current baseline behavior.
4. Prepare the Ubuntu schedule-retirement checklist and evidence template.

Exit criterion: the deletion inventory is complete, the fixture is valid under current models, and the operational retirement targets are documented.

### Phase 2: Ubuntu schedule retirement

1. Obtain the operator's deployment authorization for host changes.
2. Audit all systemd, Hermes, user crontab, root crontab, and `/etc/cron*` NewsNexus12 schedules.
3. Disable and remove every NewsNexus12 schedule.
4. Verify no next trigger or active scheduled execution remains.
5. Save retirement evidence.

Exit criterion: no existing NewsNexus12 Ubuntu-level schedule can call a route that will be removed.

### Phase 3: application and repository removal

1. Remove portal V01 and legacy weekly code.
2. Remove API routes and modules.
3. Remove worker-node legacy runtime, continuation planner, startup dependencies, and request contracts.
4. Remove worker-python V01 code and the legacy lock.
5. Remove runtime legacy models.
6. Delete obsolete deployment and schema scripts.
7. Update documentation and tests.
8. Change the old-backup fixture to assert the required post-removal skip behavior.

Exit criterion: all builds and retained regression suites pass, removed routes return `404`, and the old-backup fixture passes under the new models.

### Phase 4: operator replenish

1. Create or confirm the pre-removal backup before rebuilding the local schema.
2. Run the removal-branch ZIP import.
3. Verify skipped legacy CSVs and retained row imports.
4. Run application smoke tests.

Exit criterion: the rebuilt database contains no legacy schema and retained features work.

## 17. Verification Requirements

### 17.1 Static checks

- No live portal source references V01 fields, modals, or components.
- No API or worker route exposes a removed namespace.
- No runtime code uses `X-Orchestrator-Run-Id` or `googleRssResumePlan`.
- No runtime model exports the four deleted models or removed column.
- No startup table check requires the removed tables.
- No scripts or active documents call `/orchestrator` or reinstall its units.
- No executable schema helper can recreate the removed legacy fields.
- Remaining `orchestrator` matches belong only to retained single-workflow classes, their tests, historical documents, or the removal record.

### 17.2 Automated checks

- Build `db-models` first.
- Build and test API.
- Build and test worker-node.
- Run retained worker-python unit and integration suites.
- Run portal lint and build.
- Run db-manager import and backup tests.
- Run the post-removal old-backup fixture.
- Run focused V02 regression tests.
- Run worker-node startup readiness without legacy tables.
- Run standalone Google RSS route and job tests without legacy fields.

### 17.3 Manual smoke checks

- Start all services without V01 environment variables or legacy tables.
- Run every retained automation independently.
- Run V02 preview, start, status, cancellation, prompt management, and article review.
- Run Google RSS without legacy body fields, headers, or run IDs.
- Confirm removed portal URLs and endpoints return `404`.
- Confirm no live UI presents the legacy weekly feature or V01.
- Confirm no Ubuntu schedule remains enabled for NewsNexus12.

## 18. Acceptance Criteria

1. AI Approver V01 cannot be started, queried, configured, or reviewed through live code.
2. The legacy weekly workflow cannot be started, continued, canceled, queried, or reported through live code.
3. `OrchestratorSection.tsx` and the worker-node orchestrator namespace are deleted.
4. The old product meaning of `orchestrator` is absent from live routes, contracts, models, logs, UI, and deployment assets.
5. All pre-existing NewsNexus12 Ubuntu schedules are disabled and removed before endpoint removal is deployed.
6. Repository assets cannot reinstall or trigger the old schedules.
7. The rebuilt schema omits all four legacy tables and `NewsApiRequests.orchestratorRunId`.
8. An old backup imports retained tables while reporting removed model CSVs as skipped.
9. Worker-node starts without the removed tables.
10. Standalone Google RSS works without the legacy resume contract, run ID, or locks.
11. AI Approver V02 behavior and data remain intact.
12. Unrelated automations and shared queue behavior pass regression checks.
13. Removed portal, API, and worker URLs return `404`.
14. Database rollback restores old data but does not re-enable obsolete schedules.
15. The current weekly cron PRD is not implemented until it is redesigned without legacy dependencies.

## 19. Risks and Mitigations

- Risk: the current weekly cron PRD is implemented after its foundation is deleted.
  - Mitigation: make this PRD authoritative and require a new cron PRD version.
- Risk: an installed Ubuntu schedule calls a removed endpoint.
  - Mitigation: require host inventory, retirement, and evidence before endpoint deployment.
- Risk: the operator expects a Git branch switch to restore PostgreSQL.
  - Mitigation: require the separate main-branch ZIP restore.
- Risk: an old `NewsApiRequest.csv` fails because it contains a removed column.
  - Mitigation: add a versioned old-format fixture and filter to known attributes if required.
- Risk: worker-node refuses to start after table removal.
  - Mitigation: update and test `ensureDbReady.ts` explicitly.
- Risk: unreachable Google RSS continuation code survives and preserves deleted terminology.
  - Mitigation: delete the planner and its entire route body contract.
- Risk: removing shared routes or locks breaks retained workflows.
  - Mitigation: audit ownership and run retained route, queue, and concurrency tests.
- Risk: V01 removal affects V02 through overlapping names or settings.
  - Mitigation: use explicit inventories and focused V02 regressions.
- Risk: destructive schema SQL is run after removal.
  - Mitigation: delete the legacy SQL helper rather than archive it as executable material.
- Risk: future scheduling silently reuses the legacy architecture.
  - Mitigation: require new names and persistence boundaries in a separately assessed cron PRD.
