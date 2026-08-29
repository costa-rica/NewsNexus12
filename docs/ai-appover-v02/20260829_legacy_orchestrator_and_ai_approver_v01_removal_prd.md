---
created_at: 2026-08-29T20:51:33Z
updated_at: 2026-08-29T20:51:33Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Legacy Orchestrator and AI Approver V01 Removal PRD

Difficulty: high. Risk: medium-high. The portal card is already hidden, but the legacy weekly orchestrator and AI Approver V01 span four apps, shared models, locks, reports, backups, and historical data. Safe removal requires staged traffic verification, compatibility decisions, database backups, and regression testing; careless deletion could block unrelated automation jobs.

## 1. Document Status

- Status: draft for operator review
- Product change: remove AI Approver V01 and the legacy Weekly Orchestrator V01
- Primary reference: `20260723_ai_approver_v01_safe_removal_report.md`
- Repository evidence reviewed: 2026-08-29
- Data deletion authorized by this PRD: no
- Production deployment authorized by this PRD: no

This PRD turns the earlier safe-removal inventory into requirements for a future implementation. Approval of the PRD authorizes planning and code work only. Dropping production tables or deleting retained data requires separate approval.

## 2. Problem

AI Approver V01 and the legacy weekly workflow remain implemented even though their automation cards are no longer rendered on the portal automations page.

The old weekly feature uses `orchestrator` as a product name, route namespace, source namespace, database model prefix, request header, log term, and portal component name. This creates ambiguity with newer coordination systems and with ordinary internal classes that orchestrate one workflow.

The hidden code also retains:

- callable API and worker routes
- worker startup behavior and cross-worker locks
- article-review requests and a hidden review column
- prompt-management source and routes
- weekly execution, continuation, reporting, and recovery logic
- database models, associations, backup behavior, and historical records
- tests and active operational documentation

Removing only `OrchestratorSection.tsx` would leave nearly all of this behavior in place.

## 3. Goals

1. Remove AI Approver V01 as an executable and operator-visible feature.
2. Remove the legacy weekly workflow and all code that exists only to support it.
3. Remove the old product meaning of `orchestrator` from live routes, headers, models, logs, UI, and runtime source.
4. Preserve AI Approver V02 and unrelated automation workflows.
5. Protect unrelated jobs from regressions caused by removing shared locks, queue routes, or request metadata.
6. Preserve required historical data before any destructive database migration.
7. Leave active documentation and repository guidance with unambiguous current terminology.

## 4. Non-Goals

- Do not remove or rename AI Approver V02.
- Do not replace AI Approver V01 with a new scoring workflow.
- Do not create a new weekly scheduler or coordination service in this project.
- Do not remove the worker-python shared queue.
- Do not remove Google RSS, article scraping, state assignment, semantic scoring, location scoring, or deduplication.
- Do not rewrite old generated weekly report files.
- Do not rewrite archived or historical design documents merely to erase old terminology.
- Do not automatically rename unrelated implementation classes such as the V02, deduper, or location-scorer `orchestrator.py` modules.

## 5. Feature Boundary

### 5.1 Remove AI Approver V01

The V01 boundary includes:

- portal automation, prompt-management, review-column, review-modal, and one-off scoring code
- API `/automations/ai-approver` and `/analysis/ai-approver` behavior
- worker-python `/ai-approver` routes and `src/modules/ai_approver`
- the V01 prompt setup utility and V01 prompt asset
- V01 startup validation and environment settings
- V01 tests and live operational instructions
- `AiApproverPromptVersion` and `AiApproverArticleScore` runtime models

### 5.2 Remove the legacy weekly workflow

The legacy weekly boundary includes:

- `portal/src/components/automations/OrchestratorSection.tsx`
- API `/automations/orchestrator` proxy routes
- worker-node `/orchestrator` routes
- `worker-node/src/modules/orchestrator`
- worker-node startup reconciliation for old runs
- worker-node and worker-python active-run locks
- the `X-Orchestrator-Run-Id` request contract
- continuation assessment, continuation creation, and report generation owned by the old workflow
- `OrchestratorRun` and `OrchestratorRunStep` runtime models
- `NewsApiRequest.orchestratorRunId` and related Google RSS resume metadata
- tests dedicated to these behaviors

### 5.3 Preserve unrelated coordination code

The following uses of the word `orchestrator` are not part of the legacy weekly feature unless dependency tracing proves otherwise:

- `worker-python/src/modules/ai_approver_v02/orchestrator.py`
- `worker-python/src/modules/deduper/orchestrator.py`
- `worker-python/src/modules/location_scorer/orchestrator.py`
- local variables that refer only to those single-workflow classes

These names may be handled in a separate terminology cleanup. They must not be deleted as part of this removal.

## 6. User Experience Requirements

### 6.1 Portal automations

- Delete `OrchestratorSection.tsx` and the hidden AI Approver V01 automation component.
- Confirm neither component is imported, rendered, lazily loaded, or linked.
- Keep the current independent automation cards working.
- Keep AI Approver V02 and its prompt-management link working.

### 6.2 Prompt pages

- Delete the V01 prompt-management implementation.
- Remove both the articles-path route and the older analysis-path redirect or not-found wrapper.
- A direct request to either former V01 prompt URL must resolve through the normal application not-found behavior.
- Do not redirect a V01 URL to V02 because the prompt and output contracts differ.

### 6.3 Article review

- Stop fetching `/analysis/ai-approver/top-scores`.
- Remove V01 score and gatekeeper merges from article rows.
- Remove the hidden AI Approver V01 column, sorting behavior, click handler, and details modal.
- Remove the V01 one-off review action and its prompt/content flow.
- Remove V01-only TypeScript fields and response types.
- Preserve the AI Approver V02 column, filtering, modal, and human review behavior.

## 7. API Requirements

### 7.1 Route removal

- Unmount and delete `api/src/routes/automations/orchestrator.ts`.
- Unmount and delete `api/src/routes/analysis/ai-approver.ts`.
- Remove only the V01 `/automations/ai-approver/start-job` handler from the shared automation router.
- Preserve generic worker job status, latest-job, and cancel endpoints used by retained automations.
- Preserve all `/automations/ai-approver-v02` and `/analysis/ai-approver-v02` routes.

### 7.2 API modules and tests

- Delete V01-only analysis modules, validation, helpers, and route tests.
- Delete the legacy weekly proxy tests.
- Update shared automation tests to prove retained routes still proxy correctly.
- Update admin database tests to match the approved model-retention phase.

### 7.3 Removed endpoint behavior

- Removed internal endpoints must not proxy to either worker.
- They must not return a successful compatibility response.
- The chosen retirement response must be consistent across the old API namespaces.
- Authentication middleware must not conceal an accidentally retained route during verification.

## 8. Worker-Node Requirements

### 8.1 Runtime removal

- Unmount and delete the `/orchestrator` router.
- Delete the old coordinator, repository, child-job client, active-run guard, continuation, type, and report-writer modules.
- Remove startup reconciliation and cache invalidation for old runs.
- Remove the global lock that blocks independent `start-job` requests while an old run is active.
- Remove old log events, configuration shapes, and error messages.

### 8.2 Google RSS decoupling

- Remove the `X-Orchestrator-Run-Id` header parser and propagation.
- Remove `orchestratorRunId` from request-job inputs, contexts, and persisted request creation.
- Remove `sourceOrchestratorRunId` from Google RSS resume plans.
- Preserve standalone Google RSS execution and its non-legacy retry or resume behavior.
- Replace any query that uses the old run ID to identify resumable requests with a retained, explicitly named correlation mechanism only if that behavior is still required.

### 8.3 Tests

- Delete tests whose subject is the removed weekly workflow.
- Update Google RSS route, job, resume-planner, and model-metadata tests.
- Add regression coverage proving each retained worker-node job can start without a legacy header or active-run lookup.
- Verify worker-node starts with no old route, model, or reconciliation dependency.

## 9. Worker-Python Requirements

### 9.1 AI Approver V01

- Unmount and delete `src/routes/ai_approver.py`.
- Delete `src/modules/ai_approver`.
- Delete the V01 prompt setup script and V01-only prompt assets.
- Remove V01 startup validation, warning logs, and environment reads.
- Delete V01 contract, integration, and unit tests.

### 9.2 Legacy lock removal

- Remove `OrchestratorLockMiddleware` from the FastAPI application.
- Delete its active-run database guard and supporting package if no retained caller remains.
- Confirm every retained worker-python start route remains protected by its own concurrency and queue rules.
- Preserve the shared queue, cancellation, and status behavior.

### 9.3 Retained workflows

- Preserve AI Approver V02 configuration, reconciliation, routes, runner, repository, and tests.
- Preserve deduper and location-scorer workflow classes even where their internal filename is `orchestrator.py`.
- Verify the worker starts when no V01 environment variables are present.

## 10. Database and Data Requirements

### 10.1 Affected schema

The removal affects these legacy tables or columns:

- `AiApproverPromptVersions`
- `AiApproverArticleScores`
- `OrchestratorRuns`
- `OrchestratorRunSteps`
- `NewsApiRequests.orchestratorRunId`

### 10.2 Runtime model cleanup

- Remove legacy model initialization and exports from `db-models`.
- Remove legacy associations from `_associations.ts`.
- Remove legacy entries from `_loadOrder.ts` and sequence-reset behavior.
- Remove explicit API admin table registration.
- Update dynamically discovered backup and import behavior.
- Remove worker and API compile-time imports of the legacy models.

### 10.3 Data safety gate

Before a destructive migration:

1. Stop all new V01 and legacy weekly writes.
2. Verify no active or queued jobs target removed endpoints.
3. Export all affected tables in a dated, restorable artifact.
4. Record row counts, checksums, schema definitions, and foreign-key relationships.
5. Verify a restoration into an isolated database.
6. Preserve V01 human-verification fields and prompt-to-score relationships.
7. Record how old ZIP backups can be inspected after runtime models are removed.
8. Obtain separate operator approval for the exact tables and column to drop.

The code-removal release must not rely on `sequelize.sync()` to perform destructive schema changes.

### 10.4 Historical behavior

- Previously generated weekly report files remain valid static artifacts.
- No live UI is required for historical V01 data unless the operator selects read-only retention.
- Old queue records may retain legacy endpoint strings; they are historical data, not live product terminology.
- Old backups must not be silently accepted and partially restored after model removal.

## 11. Configuration and Documentation

- Remove V01-only environment variables only after repository-wide usage verification.
- Preserve shared PostgreSQL, OpenAI, and Codex settings used by V02 or other workflows.
- Remove legacy weekly settings and example values.
- Update root and package README or AGENTS guidance that describes V01 as callable.
- Mark active V01 operations documents as retired or move them to the appropriate archive through a separate documentation pass.
- Preserve the 2026-07-23 safe-removal report as historical evidence.
- State that `orchestrator` no longer names a live NewsNexus product feature.

## 12. Rollout Plan

### Phase 0: usage and data gate

1. Search production access logs for all old API and worker endpoints.
2. Inspect shared queue data for queued or running V01 jobs.
3. Inspect `OrchestratorRuns` for active or recoverable runs.
4. Record affected table row counts and backup requirements.
5. Resolve the open questions in this PRD.

Exit criterion: no unknown caller or active job remains.

### Phase 1: execution shutdown

1. Disable old start routes and legacy continuation creation.
2. Remove cross-worker locks after old active runs are impossible.
3. Monitor retained automations for unexpected concurrency or request failures.

Exit criterion: old executions cannot start and retained jobs operate normally.

### Phase 2: application removal

1. Remove portal V01 and legacy weekly code.
2. Remove API routes and modules.
3. Remove worker-node legacy weekly code and coupling.
4. Remove worker-python V01 code.
5. Remove runtime model references and update tests and documentation.

Exit criterion: builds and regression suites pass with legacy tables still safely retained if required.

### Phase 3: destructive schema cleanup

1. Verify the final backup and isolated restore.
2. Apply a reviewed migration for approved tables, foreign keys, indexes, sequences, and columns.
3. Validate row counts and retained application behavior after migration.

Exit criterion: the approved legacy schema is absent and all retained services pass smoke tests.

## 13. Verification Requirements

### 13.1 Static checks

- No live portal source references `OrchestratorSection`, V01 modals, or V01 article fields.
- No live API route exposes `/automations/orchestrator`, `/automations/ai-approver`, or `/analysis/ai-approver`.
- No worker route exposes `/orchestrator` or `/ai-approver`.
- No runtime code uses `X-Orchestrator-Run-Id`.
- No runtime model exports the V01 or legacy weekly models after the approved model-removal phase.
- Remaining `orchestrator` matches are limited to unrelated single-workflow implementation names, tests for those workflows, or historical documentation.

### 13.2 Automated checks

- Build `db-models` first.
- Build and test `api`.
- Build and test `worker-node`.
- Run the worker-python retained unit and integration suites.
- Run portal lint and build.
- Run focused negative-route tests for removed endpoints.
- Run retained AI Approver V02 route, repository, runner, and portal checks.

### 13.3 Manual smoke checks

- Start all services without V01 environment variables.
- Run each retained automation independently.
- Run AI Approver V02 preview, start, status, cancellation, prompt management, and article review.
- Run Google RSS without legacy headers or run IDs.
- Confirm old portal URLs return not found.
- Confirm old API and worker URLs return the selected retirement response.
- Confirm no portal label presents a legacy weekly orchestrator feature.

## 14. Acceptance Criteria

1. AI Approver V01 cannot be started, queried, configured, or reviewed through live application code.
2. The legacy weekly workflow cannot be started, continued, canceled, queried, or reported through live application code.
3. `OrchestratorSection.tsx` and the old worker-node workflow namespace are deleted.
4. The old product meaning of `orchestrator` is absent from live routes, request contracts, database model names, and UI labels.
5. AI Approver V02 behavior and data are unchanged.
6. All unrelated automation routes and shared queue behavior pass regression checks.
7. Google RSS no longer depends on legacy run IDs or locks.
8. Historical data is backed up and restore-tested before any approved destructive migration.
9. No schema object is dropped without separate operator approval.
10. Active documentation identifies the removed features as retired and does not instruct operators to call them.

## 15. Risks and Mitigations

- Risk: removing a shared queue endpoint breaks retained automations.
  - Mitigation: remove only V01-specific handlers and add retained-route proxy tests.
- Risk: removing the global lock introduces overlapping jobs.
  - Mitigation: audit each retained job's own queue and concurrency controls before lock removal.
- Risk: Google RSS resume behavior depends on old run IDs.
  - Mitigation: test standalone resume behavior and introduce a narrowly scoped correlation ID only if required.
- Risk: model removal breaks old backup imports.
  - Mitigation: create and test a final archive and document a versioned restoration procedure.
- Risk: V01 removal accidentally affects V02 because names and configuration overlap.
  - Mitigation: use explicit V01 inventories and run all V02 regression checks.
- Risk: a hidden or external caller still uses an old route.
  - Mitigation: require production traffic evidence before route removal.
- Risk: broad terminology cleanup deletes unrelated workflow coordinators.
  - Mitigation: use the feature boundary in section 5 and review every remaining match by ownership.

## 16. Open Questions

### 1. Legacy data disposition

After a verified archive, should the four legacy tables and `NewsApiRequests.orchestratorRunId` be dropped, or retained without runtime models for a defined period?

#### Operator Response
This change will be a new branch in the monorepo. Teh operator will make a db backup (using db-manger `npm start -- --create_backup `) before switching to this new branch.

There is no migration needed. We will drop the db and then run the backup. If there is any failure to repleshing the db we'll fix the issues locally. Worst case scenario we cannot make this deletion and we go back to the main branch. and back up the data.

I don't want to over engineer safety to the point where I, the operator, is confused as to what stage we're on and what data. We're making a new brnach `dev_29_remove_orchestrator_v01` and in this branch we're deleting the old flow and db tables. In an extreme case, where we cannot make a clean workign deletion, we'll come back to main. If the ai agent decides some test branches could be useful, continue with this branch name pattern using `dev_##_{descriptive_name}`.

### 2. Removed endpoint response

Should retired internal endpoints return the normal `404`, or a temporary authenticated `410 Gone` response during a sunset window?

#### Operator Response

Use `404` if production logs show no external callers; otherwise use a short `410` sunset period.

### 3. Unrelated orchestrator names

Should a separate cleanup rename unrelated Python files and classes that use `orchestrator` for a single workflow?

#### Operator Response

No renaming stuff we'll still use. Only delete old stuff. If there are some existing fiels or classes that are severly misnamed due to this deleting make a separate file in docs with the renaming recommendation. But only if this is so severe that the naming pattern coudl lead to critial errors now or futher along.

### 4. Historical backup restore

Must current application code continue importing backups that contain removed V01 and legacy weekly tables?

#### Operator Response

Our current importing backups process uses a .zip file. IN the .zip file there .csv files for each table. My hope is hte current process allows for .csv files that don't match to a table to be skipped. This woudl make it so old db backkup versions could still be used, but not cause any problem or create new tables in the database.


If this is not hte case, can we do this safely. If my response, exposes a misunderstanding - explain in the next prd version.

### 5. Read-only V01 history

Is a read-only interface required for old V01 prompt, score, and human-verification records?

#### Operator Response

No, all old V01 stuff gets removed. If my response, exposes a misunderstanding - explain in the next prd version.
