---
created_at: 2026-08-29T21:15:27Z
updated_at: 2026-08-29T21:18:57Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Legacy Orchestrator and AI Approver V01 Removal PRD V02

Difficulty: high. Risk: medium-high. The portal card is already hidden, but the legacy weekly orchestrator and AI Approver V01 span four apps, shared models, locks, reports, backups, and historical data. Safe removal requires staged traffic verification, compatibility decisions, database backups, and regression testing; careless deletion could block unrelated automation jobs.

## 1. Document Status

- Status: ready for implementation
- Active implementation branch: `dev_29_remove_v01_workflows`
- Product change: remove AI Approver V01 and the legacy Weekly Orchestrator V01
- Supersedes: `20260829_legacy_orchestrator_and_ai_approver_v01_removal_prd.md`
- Primary inventory: `20260723_ai_approver_v01_safe_removal_report.md`
- Repository evidence reviewed: 2026-08-29
- Legacy application-code removal authorized: yes
- Local legacy schema removal authorized: yes, through the operator-controlled backup and replenish workflow
- Automatic migration required: no
- Production deployment authorized by this PRD: no

This version incorporates all operator responses from the first PRD and its V02 review. No open questions remain.

## 2. Incorporated Operator Decisions

1. Work will continue on `dev_29_remove_v01_workflows`.
2. AI Approver V01 and the legacy weekly workflow will be deleted, not retained as read-only features.
3. Their legacy tables and the legacy `NewsApiRequests` column will be absent from the rebuilt database schema.
4. The operator will create a ZIP backup before using the new branch to replenish the database.
5. No schema migration will be added for this removal.
6. The ZIP importer should skip CSV files whose models no longer exist.
7. Removed endpoints will default to `404`; a short `410 Gone` sunset period will be used only when a real caller is identified.
8. Unrelated classes and files named `orchestrator` will not be renamed by this project.
9. A separate naming-recommendation document will be created only if a retained name presents a serious risk of critical future errors.
10. No live V01 history interface will remain.
11. Historical V01 reports will be archived. Instructions and prompt assets that could incorrectly guide current operations will be deleted.

## 3. Important Backup and Branch Clarifications

### 3.1 ZIP imports already rebuild the schema

The current db-manager ZIP import does the following:

1. Reads the ZIP file.
2. Runs `rebuildSchema()`.
3. Drops and recreates the PostgreSQL `public` schema from the models in the checked-out branch.
4. Imports CSV files in `MODEL_LOAD_ORDER`.
5. Skips and reports CSV files that are not in the current model load order.
6. Resets database sequences.

The operator does not need to run `--drop_db` before `--zip_file`. The import command already performs the destructive rebuild.

### 3.2 A Git branch does not isolate the database

Changing branches changes repository files, but it does not restore or switch PostgreSQL data. After the new branch rebuilds the shared local database, switching back to `main` alone will not restore the removed tables.

To roll back fully:

1. Switch back to `main`.
2. Rebuild the `db-models` and db-manager packages from `main`.
3. Import the pre-change ZIP backup using the db-manager from `main`.

That import recreates the old schema and restores the legacy CSV files.

### 3.3 Old backup compatibility is mostly present

The current importer already skips CSV filenames missing from `MODEL_LOAD_ORDER`. After model cleanup, these old backup files should be skipped and reported:

- `AiApproverPromptVersion.csv`
- `AiApproverArticleScore.csv`
- `OrchestratorRun.csv`
- `OrchestratorRunStep.csv`

`NewsApiRequest.csv` will still match a retained model but may contain the removed `orchestratorRunId` column. The implementation must add a compatibility test using this old CSV shape.

If Sequelize does not safely ignore that removed column, the importer must filter each row to the current model's known attributes before `bulkCreate`. It must not fail the replenish or recreate the removed column.

## 4. Problem

AI Approver V01 and the legacy weekly workflow remain implemented even though their automation cards are no longer rendered on the portal automations page.

The weekly feature also uses `orchestrator` as a product name, route, source namespace, database model prefix, request header, and log term. This creates ambiguity with newer coordination systems and ordinary internal workflow classes.

Deleting only `OrchestratorSection.tsx` would leave callable routes, worker locks, execution logic, report generation, database coupling, tests, and V01 article-review behavior in place.

## 5. Goals

1. Remove AI Approver V01 as an executable, queryable, configurable, and visible feature.
2. Remove the legacy weekly workflow and all code used only by it.
3. Remove the old product meaning of `orchestrator` from live routes, headers, models, logs, UI, and runtime source.
4. Remove the legacy schema through the operator's backup and replenish process.
5. Keep old ZIP backups usable by skipping removed model CSV files.
6. Preserve AI Approver V02 and all unrelated automations.
7. Protect standalone jobs from regressions caused by removing global locks and request metadata.
8. Keep the implementation and rollback process simple enough for the operator to follow.

## 6. Non-Goals

- Do not remove or rename AI Approver V02.
- Do not add a replacement scoring flow.
- Do not create a replacement weekly scheduler in this project.
- Do not remove the worker-python shared queue.
- Do not remove Google RSS, article scraping, state assignment, semantic scoring, location scoring, or deduplication.
- Do not rename retained V02, deduper, or location-scorer `orchestrator.py` files.
- Do not add a schema migration for this removal.
- Do not retain a read-only V01 UI.
- Do not rewrite generated historical reports.

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
- Google RSS fields and behavior used only to correlate legacy weekly runs

### 7.3 Retained coordination code

Preserve:

- `worker-python/src/modules/ai_approver_v02/orchestrator.py`
- `worker-python/src/modules/deduper/orchestrator.py`
- `worker-python/src/modules/location_scorer/orchestrator.py`
- local variables that refer only to those retained single-workflow classes

Review these references for dependency ownership, but do not rename or delete them solely because they contain `orchestrator`.

## 8. Portal Requirements

### 8.1 Automations and prompt pages

- Delete `OrchestratorSection.tsx`.
- Delete the hidden AI Approver V01 automation component.
- Delete the V01 prompt-management implementation.
- Remove the articles-path V01 prompt route and the older analysis-path redirect or wrapper.
- Return the normal application not-found result for removed V01 portal URLs.
- Do not redirect V01 prompt URLs to V02.
- Preserve all current independent automation cards and AI Approver V02 prompt management.

### 8.2 Article review

- Stop fetching V01 top scores and gatekeeper results.
- Remove V01 row merges, state, refresh handlers, sorting, and rendering.
- Remove the hidden AI Approver V01 table column.
- Remove the V01 details modal and one-off review flow.
- Remove V01-only TypeScript fields and response types.
- Preserve the V02 column, filters, modal, validation, and comments.

## 9. API Requirements

### 9.1 Routes

- Unmount and delete `api/src/routes/automations/orchestrator.ts`.
- Unmount and delete `api/src/routes/analysis/ai-approver.ts`.
- Remove only the V01 `/automations/ai-approver/start-job` handler from the shared automations router.
- Preserve shared worker status, latest-job, and cancel routes used by retained workflows.
- Preserve all V02 automation and analysis routes.

### 9.2 Endpoint retirement

- Review available production access logs before choosing the final response.
- Use normal `404` behavior if no external caller is found or available logs are inconclusive.
- If an external caller is found, use an authenticated `410 Gone` response for a short documented sunset window, then remove it to `404`.
- Removed routes must never proxy to a worker or return a successful compatibility response.

### 9.3 Tests

- Delete V01 route and legacy weekly proxy tests.
- Update shared route tests to prove retained proxies still work.
- Add negative tests for the selected retirement behavior.
- Update admin database tests after removing the legacy models.

## 10. Worker-Node Requirements

### 10.1 Runtime

- Unmount and delete the `/orchestrator` router.
- Delete the old coordinator, repository, child-job client, active-run guard, continuation, types, and report writer.
- Remove startup reconciliation and cache invalidation.
- Remove the global middleware that blocks independent start-job requests during a legacy run.
- Remove legacy configuration, errors, logs, and response shapes.

### 10.2 Google RSS

- Remove `X-Orchestrator-Run-Id` parsing and propagation.
- Remove `orchestratorRunId` from job inputs, contexts, and persisted requests.
- Remove `sourceOrchestratorRunId` from resume plans.
- Preserve standalone Google RSS execution and retained resume behavior.
- Add regression tests proving Google RSS works without legacy headers, locks, or run records.

### 10.3 Tests

- Delete tests owned by the removed weekly feature.
- Update request-Google-RSS route, job, resume-planner, and metadata tests.
- Test that each retained worker-node job can start without an active-run lookup.
- Verify worker-node startup has no old route, model, or reconciliation dependency.

## 11. Worker-Python Requirements

### 11.1 AI Approver V01

- Unmount and delete `src/routes/ai_approver.py`.
- Delete `src/modules/ai_approver`.
- Delete the V01 prompt setup script and V01-only prompt assets.
- Remove V01 startup validation, warnings, configuration, and environment reads.
- Delete V01 contract, integration, and unit tests.

### 11.2 Legacy lock

- Remove `OrchestratorLockMiddleware` from FastAPI startup.
- Delete the associated active-run guard package when no caller remains.
- Confirm retained routes use their own queue and concurrency behavior.
- Preserve shared queue, cancellation, status, deduper, location scorer, and V02 behavior.
- Verify startup succeeds without V01 environment variables.

## 12. Database and Import Requirements

### 12.1 Remove from the rebuilt schema

- `AiApproverPromptVersions`
- `AiApproverArticleScores`
- `OrchestratorRuns`
- `OrchestratorRunSteps`
- `NewsApiRequests.orchestratorRunId`

### 12.2 Model cleanup

- Delete the four legacy model files.
- Remove their initialization and exports.
- Remove their associations and `MODEL_LOAD_ORDER` entries.
- Remove explicit admin database registration.
- Remove legacy sequence-reset and compile-time references.
- Keep V02 models and associations unchanged.

### 12.3 Import compatibility

- Keep the existing behavior that reports and skips CSV files missing from `MODEL_LOAD_ORDER`.
- Add a test ZIP containing all four removed model CSV files and confirm they are skipped.
- Add an old-format `NewsApiRequest.csv` containing `orchestratorRunId`.
- Confirm recognized `NewsApiRequest` fields import successfully without recreating the removed column.
- If needed, filter imported records to model attributes before insertion.
- Ensure skipped legacy files appear clearly in the final db-manager output.
- Do not treat these expected legacy files as a failed import.

## 13. Operator Database Workflow

### 13.1 Before the new branch rebuild

From the code version that still contains the legacy models, the operator will:

1. Run `cd db-manager`.
2. Run `npm start -- --create_backup`.
3. Confirm the command reports the created ZIP path.
4. Keep that ZIP unchanged for both forward replenish and rollback.

### 13.2 Replenish from the removal branch

After the implementation is ready on `dev_29_remove_v01_workflows`, the operator will:

1. Build `db-models`.
2. Build db-manager if required by its normal workflow.
3. Run `npm start -- --zip_file /absolute/path/to/pre-change-backup.zip` from db-manager.
4. Confirm the importer rebuilt the schema.
5. Confirm the four removed model CSV files were reported as skipped.
6. Confirm retained tables imported successfully.
7. Confirm `NewsApiRequests` imported without `orchestratorRunId`.

Do not run `--drop_db` first. It is redundant because `--zip_file` rebuilds the schema.

### 13.3 Rollback

If the removal branch cannot produce a clean working system:

1. Stop the affected services.
2. Switch the repository back to `main`.
3. Rebuild `db-models` and db-manager from `main`.
4. Run the main-branch db-manager with `--zip_file` and the unchanged pre-change backup.
5. Verify the four legacy tables, the old column, and retained data were restored.

The Git branch switch and the database restore are both required.

## 14. Documentation Requirements

- Remove V01-only environment examples after confirming they are not shared with V02.
- Remove legacy weekly configuration and examples.
- Update root and package guidance that describes V01 or the weekly workflow as callable.
- Move historical V01 reports, including the safe-removal report, into the applicable `docs/archive/YYYYMM/` folder and update active references.
- Delete active V01 instructions and prompt assets that could incorrectly guide current operations.
- Preserve the 2026-07-23 safe-removal report as archived historical evidence.
- State in active guidance that `orchestrator` no longer names a live NewsNexus product feature.
- Do not create a terminology recommendation document unless a retained name presents a severe critical-error risk.

## 15. Implementation Phases

### Phase 1: evidence and fixture preparation

1. Review available access logs for callers of removed endpoints.
2. Add old-backup ZIP import compatibility tests.
3. Record the final file and symbol inventory.

Exit criterion: endpoint behavior is selected and the old-backup fixture imports as required.

### Phase 2: application removal

1. Remove portal V01 and legacy weekly code.
2. Remove API routes and modules.
3. Remove worker-node legacy weekly code and coupling.
4. Remove worker-python V01 code and the legacy lock.
5. Remove runtime legacy models and update documentation.

Exit criterion: builds and retained regression suites pass.

### Phase 3: operator replenish

1. Create the pre-change backup before rebuilding the local schema.
2. Run the removal-branch ZIP import.
3. Verify expected skipped CSVs and retained row imports.
4. Run application smoke tests.

Exit criterion: the rebuilt database contains no legacy schema and retained features work.

## 16. Verification Requirements

### 16.1 Static checks

- No live portal source references V01 article fields, modals, or components.
- No live API route exposes the retired namespaces after the selected sunset behavior ends.
- No worker route exposes `/orchestrator` or `/ai-approver`.
- No runtime code uses `X-Orchestrator-Run-Id`.
- No runtime model exports the four deleted models or the removed column.
- Remaining `orchestrator` matches belong only to retained single-workflow classes, their tests, or historical documents.

### 16.2 Automated checks

- Build `db-models` first.
- Build and test API.
- Build and test worker-node.
- Run retained worker-python unit and integration suites.
- Run portal lint and build.
- Run db-manager import and backup tests.
- Run the old-backup compatibility fixture.
- Run focused V02 regression tests.

### 16.3 Manual smoke checks

- Start all services without V01 environment variables.
- Run every retained automation independently.
- Run V02 preview, start, status, cancellation, prompt management, and article review.
- Run Google RSS without legacy headers or run IDs.
- Confirm removed portal URLs return not found.
- Confirm removed endpoints return the selected response.
- Confirm no live UI presents the legacy weekly feature or V01.

## 17. Acceptance Criteria

1. AI Approver V01 cannot be started, queried, configured, or reviewed through live code.
2. The legacy weekly workflow cannot be started, continued, canceled, queried, or reported through live code.
3. `OrchestratorSection.tsx` and the old worker-node namespace are deleted.
4. The old product meaning of `orchestrator` is absent from live routes, request contracts, models, logs, and UI.
5. The rebuilt schema omits all four legacy tables and `NewsApiRequests.orchestratorRunId`.
6. An old backup imports retained tables while reporting removed model CSVs as skipped.
7. AI Approver V02 behavior and data remain intact.
8. Unrelated automations and shared queue behavior pass regression checks.
9. Google RSS no longer depends on legacy run IDs or locks.
10. The rollback steps restore the old schema and data when run from `main`.

## 18. Risks and Mitigations

- Risk: the operator expects a branch switch to restore the database.
  - Mitigation: document and test the separate main-branch ZIP restore.
- Risk: an old `NewsApiRequest.csv` fails because it includes a removed column.
  - Mitigation: add an old-format import fixture and filter to known attributes if required.
- Risk: removing shared queue routes breaks retained workflows.
  - Mitigation: remove only V01-specific handlers and test retained proxies.
- Risk: removing global locks permits unsafe overlapping jobs.
  - Mitigation: verify each retained workflow's queue and concurrency behavior.
- Risk: Google RSS resume behavior still depends on legacy IDs.
  - Mitigation: update and test standalone resume behavior before deletion.
- Risk: V01 removal affects V02 through overlapping names or settings.
  - Mitigation: use explicit inventories and run focused V02 regressions.
- Risk: a caller still uses an old endpoint.
  - Mitigation: apply the operator's log-based `404` or temporary `410` rule.
- Risk: broad terminology cleanup changes retained code.
  - Mitigation: do not rename retained code in this project.
