# NewsNexus12 Weekly Orchestrator TODO

Implementation of the weekly orchestrator described in `docs/20260429_ORCHESTRATOR_PLAN_V02.md`.

## Phase 1: Worker-node queue result support

- [ ] Extend `QueueJobRecord` with optional `parameters`, `result`, and `logs` fields.
- [ ] Update `jobStore.ts` read/write to round-trip the new fields.
- [ ] Add a queue execution helper that lets a running job update its own `result`.
- [ ] Confirm existing jobs continue to function with the new fields absent.
- [ ] Add tests for read/write of new queue record fields.
- [ ] Add tests confirming backwards compatibility with prior records.
- [ ] Run `npm -C worker-node test`.
- [ ] Run `npm -C worker-node run build`.
- [ ] Commit referencing this TODO and Phase 1.

## Phase 2: Article range targeting end-to-end

- [ ] Add `articleIdMinExclusive` and `articleIdMaxInclusive` to `worker-node/src/modules/articleTargeting.ts`.
- [ ] Update state-assigner route to pass the full validated targeting object into the job (stop dropping `articleIds`, `includeArticlesThatMightHaveBeenStateAssigned`, etc.).
- [ ] Wire range filter into state-assigner candidate-selection SQL.
- [ ] Add request-body targeting to semantic-scorer route.
- [ ] Wire range filter into semantic-scorer candidate-selection SQL.
- [ ] Preserve current default behavior for semantic-scorer when targeting is absent.
- [ ] Extend worker-python ai-approver request schema with `articleIdMinExclusive` and `articleIdMaxInclusive`.
- [ ] Add SQL filter for the article id range to ai-approver.
- [ ] Add tests for state-assigner default and range-limited paths.
- [ ] Add tests for semantic-scorer default and range-limited paths.
- [ ] Add tests for ai-approver default and range-limited paths.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Run worker-python test suite (if present) and verify it starts cleanly.
- [ ] Commit referencing this TODO and Phase 2.

## Phase 3: Absorb delete_articles into worker-node

- [ ] Lift `db-manager/src/modules/deleteArticles.ts` into `worker-node/src/modules/jobs/deleteArticlesJob.ts` using the project logger and `ensureDbReady`.
- [ ] Add `worker-node/src/routes/deleteArticles.ts` exposing `POST /delete-articles/start-job` accepting `daysOld` and `trimCount` arguments.
- [ ] Job writes a structured `result` (`deletedCount`, `daysOldThreshold`, `trimCount`).
- [ ] Mount the route in `app.ts`.
- [ ] Add route contract tests.
- [ ] Add module test exercising the deletion logic.
- [ ] Run a parity check against db-manager CLI on a snapshot DB.
- [ ] Update `worker-node/AGENTS.md` and the worker-node API reference.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Commit referencing this TODO and Phase 3.

## Phase 4: Google-RSS structured completion result

- [ ] Update `requestGoogleRssJob` to write `result.endingReason` and `result.endingMessage` on every terminal path (queries exhausted, error, rate-limited, abort, completed).
- [ ] Track and persist `result.articlesAddedCount` (best-effort tally).
- [ ] Add tests confirming each terminal path writes a recognizable ending reason.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Commit referencing this TODO and Phase 4.

## Phase 5: Orchestrator DB models and active-run guard

- [ ] Add `OrchestratorRun` model to `db-models/src/models/`.
- [ ] Add `OrchestratorRunStep` model to `db-models/src/models/`.
- [ ] Register both models in `_index.ts`.
- [ ] Declare associations in `_associations.ts` (User → run, run → steps).
- [ ] Update `db-models` build output and verify consumers pick up the new package.
- [ ] Add the two new tables to worker-node's `ensureSchemaReady` required-table list.
- [ ] Make the missing-table failure message reference the DB rebuild path.
- [ ] Add `worker-node/src/modules/orchestrator/activeRunGuard.ts` with a ~2s in-memory cache.
- [ ] Add tests for the guard's hit/miss/cache behavior.
- [ ] Document the rebuild rollout (backup → drop → rebuild from db-models → db-manager restore) in worker-node docs.
- [ ] Run `npm -C db-models run build` and `npm -C worker-node run build`.
- [ ] Run `npm -C worker-node test`.
- [ ] Commit referencing this TODO and Phase 5.

## Phase 6: Worker-side lock middleware

- [ ] Add worker-node middleware that rejects external `/start-job` requests with 423 when a run is `running` and the request lacks a matching `X-Orchestrator-Run-Id` header.
- [ ] Apply the middleware to all worker-node start-job routes except `/orchestrator/*`.
- [ ] Add equivalent middleware in worker-python applied to **every** start-job route.
- [ ] Worker-python middleware queries Postgres directly with a short cache.
- [ ] 423 response body includes `orchestratorRunId` and human message.
- [ ] Add tests covering blocked external request, allowed orchestrator-headed request, and unblocked state when no run is active.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Run worker-python tests (if present).
- [ ] Commit referencing this TODO and Phase 6.

## Phase 7: Coordinator and step runners

- [ ] Add `worker-node/src/modules/orchestrator/types.ts`.
- [ ] Add `repository.ts` for OrchestratorRun(Step) DB I/O.
- [ ] Add `childJobClient.ts` with in-process and HTTP flavors returning a uniform `{ jobId, poll, cancel }` shape.
- [ ] Add per-step runner files (`steps/deleteArticles.ts`, `googleRss.ts`, `stateAssigner.ts`, `aiApprover.ts`, `semanticScorer.ts`).
- [ ] Add `coordinator.ts` running outside the global queue:
  - [ ] Insert run row and all six step rows on start.
  - [ ] Force the mandatory three steps to `enabled=true`.
  - [ ] Apply per-step timeouts (defaults: delete 30m, google-rss 24h, state-assigner 8h, ai-approver 8h, semantic-scorer 4h).
  - [ ] Capture `articleIdMinExclusive` before step 2 and `articleIdMaxInclusive` after step 2.
  - [ ] Poll children every 60s and honor abort signal between polls.
  - [ ] On timeout, cancel child, mark step `timed_out`, fail-fast.
  - [ ] On child failure, mark step `failed`, fail-fast.
  - [ ] On success, mirror the child's structured result onto the step row.
  - [ ] If `articleIdMaxInclusive == articleIdMinExclusive` after step 2, mark run `completed_no_new_articles` and skip steps 3–5.
  - [ ] Always invoke the report writer at every terminal state.
  - [ ] Persist final run status.
- [ ] Add cancellation flow with a ~60s child grace window.
- [ ] Reconcile orphaned `running` runs and steps to `failed` on worker-node startup.
- [ ] Add coordinator tests: happy path, early-exit (zero new articles), child failure, timeout, cancel, worker-restart reconciliation.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Commit referencing this TODO and Phase 7.

## Phase 8: Excel report writer

- [ ] Add `worker-node/src/modules/orchestrator/reportWriter.ts` using `exceljs`.
- [ ] Sheet 1 "Articles": one row per article in `(articleIdMinExclusive, articleIdMaxInclusive]` with `articleId`, `title`, `scrapeStatus`, `aiAssignedState`, `aiApproverScore`, `semanticRating`.
- [ ] Sheet 2 "Jobs": one row per `OrchestratorRunStep` with `jobName`, `startTime`, `endTime`, `duration`, `status`, `reasonForEnding`. Google-RSS row reads `result.endingMessage`.
- [ ] Write to `PATH_UTILTIES/orchestrator/reports/YYYYMMDD-HHMMSS-orchestration-report.xlsx` (use run `startedAt`).
- [ ] mkdir-on-demand for the output directory.
- [ ] Atomic write: `*.tmp` then rename on each incremental update.
- [ ] Update sheet 2 after every step transition; write sheet 1 at terminal state.
- [ ] Persist final path on `OrchestratorRun.reportFilePath`.
- [ ] Add tests covering happy-path, early-exit, failure, timeout, and cancel report contents.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Commit referencing this TODO and Phase 8.

## Phase 9: Worker-node orchestrator HTTP routes

- [ ] Add `worker-node/src/routes/orchestrator.ts`.
- [ ] `POST /orchestrator/start` accepts only `aiApprover` and `semanticScorer` toggles in the body. Returns 202 + `runId`. 409 if a run is already active.
- [ ] `GET /orchestrator/runs` (paged list).
- [ ] `GET /orchestrator/runs/:id` (run + steps).
- [ ] `GET /orchestrator/active-run` for worker-python lock middleware.
- [ ] `POST /orchestrator/runs/:id/cancel`.
- [ ] `GET /orchestrator/runs/:id/report` streams the xlsx.
- [ ] Mount routes in `app.ts`.
- [ ] Add route contract tests for all endpoints.
- [ ] Add an end-to-end coordinator test using mocked child workers.
- [ ] Run `npm -C worker-node test` and `npm -C worker-node run build`.
- [ ] Commit referencing this TODO and Phase 9.

## Phase 10: API proxy

- [ ] Add `api/src/routes/automations/orchestrator.ts` proxying under `/automations/orchestrator/*`.
- [ ] Apply standard logged-in authentication middleware.
- [ ] Forward 423 / 409 / timeout statuses unchanged.
- [ ] Mount in `api/src/routes/index.ts`.
- [ ] Add route tests.
- [ ] Run `npm -C api test` and `npm -C api run build`.
- [ ] Commit referencing this TODO and Phase 10.

## Phase 11: Portal UI

- [ ] Add `portal/src/components/automations/OrchestratorSection.tsx`.
- [ ] Render six step rows: delete, google-rss, state-assigner shown checked + disabled.
- [ ] ai-approver and semantic-scorer toggleable, default on.
- [ ] Report row shown checked + disabled (informational).
- [ ] Add a "Start Orchestrator" button calling the api proxy.
- [ ] Show live status panel polling `/automations/orchestrator/runs/:id` every 5s while a run is active.
- [ ] Display current step, child job id, elapsed time, descriptive ending reason on completion.
- [ ] Past-runs table with download-report links.
- [ ] Surface 423 and 409 with plain-language messages.
- [ ] Add the section near the top of `src/app/(dashboard)/articles/automations/page.tsx`.
- [ ] Run `npm -C portal run lint` and `npm -C portal run build`.
- [ ] Commit referencing this TODO and Phase 11.

## Phase 12: End-to-end shakedown

- [ ] Run a full orchestrator run on a non-production dataset.
- [ ] Verify Excel report contents (both sheets).
- [ ] Verify lock behavior blocks manual portal automation jobs while running.
- [ ] Verify cancellation marks run and active step `canceled` and writes a partial report.
- [ ] Verify per-step timeout path (force a short timeout for a non-mandatory step).
- [ ] Verify early-exit by forcing google-rss to add zero articles.
- [ ] Verify worker-restart reconciliation marks in-flight runs as `failed`.
- [ ] Add operational runbook to `worker-node/docs/`.
- [ ] Commit referencing this TODO and Phase 12.
