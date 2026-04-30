# Weekly Orchestrator Plan Assessment

Reviewed source:

- `docs/20260429weeklyOrchestratorAutomation.md`
- `docs/20260429_ORCHESTRATOR_PLAN.md`
- current `worker-node`, `worker-python`, `api`, `portal`, and `db-models` implementation patterns

## 1. Short verdict

The plan does not have a fatal architectural flaw. The best overall direction is still to put the orchestrator inside `worker-node`, run the coordinator outside the global queue, enqueue child jobs normally, persist orchestration state in Postgres, and proxy it through `api` to the portal.

The plan does have several implementation assumptions that should be corrected before coding. None require a new service or new infrastructure, but ignoring them would add risk or make the first implementation slower than necessary.

The biggest changes I would make are:

1. Add a real schema/bootstrap path for the new Postgres tables instead of assuming runtime `sequelize.sync()` creates them.
2. Target downstream article work by an explicit article id range, preferably both lower and upper bounds, not only a count.
3. Extend worker-node queue records to support child job `result` payloads before relying on descriptive RSS completion reasons.
4. Use `exceljs`, which is already installed, instead of adding or switching to `xlsx`.
5. Narrow the locking design for v1 so it protects this workflow without turning into a cross-service distributed-lock project.

## 2. Fatal flaw assessment

No fatal flaw found. The plan is feasible with the current repo structure.

The current building blocks line up well:

- `worker-node` already has queue-backed routes for Google RSS, state assigner, semantic scorer, and article-content-scraper-02.
- `worker-python` already has queue-backed routes and status endpoints for AI approver.
- Both workers expose job status and cancellation endpoints.
- `api` already proxies automation routes from the portal to the workers.
- The portal already has an automations page with worker job panels that can be reused conceptually.
- `db-manager` delete logic is TypeScript using `@newsnexus/db-models`, so moving that workflow into `worker-node` is realistic.

The plan should not become a separate orchestrator service unless there is a deployment reason outside this repo. A fourth service would add operational overhead without solving the main problem.

## 3. Critical corrections

1. Database table creation is under-specified

   The plan says worker-node runs `sequelize.sync()` on startup. In the current code, worker-node calls `ensureSchemaReady(sequelize)`, which authenticates and checks required tables. It does not create new tables.

   This matters because adding `OrchestratorRun` and `OrchestratorRunStep` models to `db-models` is not enough. The deployment needs a real way to create those tables.

   Recommended change:

   - Add the Sequelize models to `db-models`.
   - Add a checked-in SQL bootstrap/migration document or a db-manager schema task for the two new tables.
   - Make startup fail clearly if those tables are missing.
   - Do not rely on runtime sync silently changing production schema.

2. The mandatory-step numbering is inconsistent

   The plan has one row that says "Steps 1, 5, 6 (delete / google-rss / state-assigner)" are mandatory. Those names are actually steps 1, 2, and 3.

   Later the plan correctly says mandatory steps are delete_articles, google-rss, and state-assigner.

   Recommended change:

   - Fix every reference to say steps 1, 2, and 3 are mandatory.
   - Keep report generation effectively always on, even if the UI shows it as a step. A run without a report weakens the main value of the orchestrator.

3. Cursor support should use a range, not just a minimum

   Capturing `maxArticleIdBefore` and passing it downstream is a good improvement over passing a count. I would make it slightly stronger:

   - Capture `maxArticleIdBefore` immediately before Google RSS.
   - Capture `maxArticleIdAfter` immediately after Google RSS.
   - Pass both as `articleIdMinExclusive` and `articleIdMaxInclusive`.
   - Query articles with `id > before AND id <= after`.

   This makes the workflow stable even if a future path inserts articles while the orchestrator is active or if lock coverage is imperfect. It also gives the report an exact bounded article set.

4. Downstream targeting is more work than the plan implies

   The shared `worker-node/src/modules/articleTargeting.ts` is a good place to add article range support, but current route and job behavior is uneven:

   - `state-assigner` validates targeting input but only passes `targetArticleThresholdDaysOld` and `targetArticleStateReviewCount` into the job handler. It currently drops fields like `articleIds` and `includeArticlesThatMightHaveBeenStateAssigned`.
   - `semantic-scorer` currently accepts no targeting body and scans all articles that have not already been semantically scored.
   - `ai-approver` accepts `limit`, `requireStateAssignment`, and `stateIds`, but not article ids or an article id range.

   Recommended change:

   - Add `articleIdMinExclusive` and `articleIdMaxInclusive` to worker-node article targeting.
   - Pass the full validated targeting object into state-assigner instead of reconstructing only count and threshold.
   - Add equivalent range filtering to worker-python AI approver.
   - Add semantic-scorer request-body targeting, because without it the orchestrator may score unrelated backlog articles.

5. Worker-node queue status does not currently support result payloads

   Worker-python queue records already include `parameters`, `result`, and logs. Worker-node queue records currently only include job id, endpoint, status, timestamps, and failure reason.

   The plan wants the orchestrator to read a descriptive Google RSS ending reason such as rate-limited, spreadsheet exhausted, or 0 articles added. Today worker-node does not have a structured result channel for that.

   Recommended change:

   - Extend worker-node `QueueJobRecord` with optional `parameters`, `result`, and possibly `logs`.
   - Add a queue execution helper that lets jobs update their own result.
   - Have Google RSS write totals and ending reason into the queue result.
   - Have delete, state-assigner, semantic-scorer, and scraper jobs write concise summaries too.

   This will make the portal and Excel report much easier to implement and debug.

6. Google RSS has no explicit 24-hour timeout yet

   The original requirement says Google RSS should run until it stops, but no more than 24 hours. The implementation plan mentions polling but does not make timeout handling a first-class step requirement.

   Recommended change:

   - Add per-step timeout fields to the orchestrator coordinator.
   - Default Google RSS to 24 hours.
   - On timeout, call the worker's cancel endpoint, mark the step `timed_out`, write the report, and fail-fast unless a future policy says otherwise.

7. Locking may be overbuilt for v1

   The plan's lock concept is directionally right, but file locks plus worker-python lock replication plus bypass tokens can become its own project.

   The important v1 behavior is:

   - Only one orchestrator run can be active.
   - While it is active, users cannot start conflicting manual automation jobs from the portal/api.
   - The orchestrator can still start its own child jobs.
   - The currently active child job can be canceled if the orchestrator is canceled.

   Recommended change:

   - Enforce "one active orchestrator" in Postgres.
   - Add a lightweight worker-node middleware that blocks external `/start-job` routes while an orchestrator is active, except requests with a signed internal orchestrator header.
   - Add the same guard only to worker-python routes that can conflict with the orchestrator, starting with `/ai-approver/start-job`.
   - Keep lock files out of v1 unless there is a concrete cross-process need that Postgres plus route guards cannot handle.

## 4. Changes that would expedite implementation

1. Build the platform primitives first

   I would reorder the early phases slightly:

   1. Add worker-node queue `result` support.
   2. Add article range targeting to state-assigner, semantic-scorer, and AI approver.
   3. Add the delete-articles worker-node job.
   4. Add orchestrator DB tables and repository.
   5. Build the coordinator.

   This sequence reduces guesswork. Once every child job can be targeted and can report structured output, the coordinator becomes mostly glue.

2. Use `exceljs`

   The plan mentions `xlsx`, but `worker-node` and `api` already depend on `exceljs`, and existing report/export code already uses it.

   Recommended change:

   - Use `exceljs` for the orchestrator report.
   - Avoid adding another Excel library.

3. Add a dedicated report step but do not make it optional

   The UI can show the report as the sixth visible step, but the backend should always write the report on completion, early exit, failure, timeout, or cancellation.

   This removes a class of "the run failed and there is no report" support problems.

4. Keep cancellation cooperative and bounded

   Existing cancellation is cooperative. That is fine, but the orchestrator should make the behavior explicit:

   - Mark the orchestrator run as cancel requested immediately.
   - Send cancellation to the active child job.
   - Poll until the child reaches a terminal state or a cancellation grace timeout is reached.
   - Mark the step and run canceled.
   - Write the report with partial status.

5. Prefer a small API proxy over a new API shape

   The current `api/src/routes/newsOrgs/automations.ts` already proxies automation actions. For v1, adding orchestrator endpoints under the same `/automations` surface is likely faster than introducing a separate API route family.

   A clean shape would be:

   - `POST /automations/orchestrator/start`
   - `GET /automations/orchestrator/runs`
   - `GET /automations/orchestrator/runs/:id`
   - `POST /automations/orchestrator/runs/:id/cancel`
   - `GET /automations/orchestrator/runs/:id/report`

## 5. Recommended implementation shape

1. `db-models`

   - Add `OrchestratorRun`.
   - Add `OrchestratorRunStep`.
   - Add associations to `User` and between run and steps.
   - Add a migration/bootstrap SQL path for production.

2. `worker-node`

   - Add queue result support.
   - Add delete-articles as a queued job.
   - Add article range targeting to shared automation targeting.
   - Add semantic-scorer targeting support.
   - Add `src/modules/orchestrator/` with coordinator, repository, step runners, report writer, and active-run guard.
   - Add `src/routes/orchestrator.ts`.

3. `worker-python`

   - Add article range fields to AI approver request schema.
   - Add SQL filters for the article id range.
   - Add lightweight orchestrator guard for external AI approver starts while a run is active.

4. `api`

   - Add proxy endpoints under `/automations/orchestrator`.
   - Reuse existing auth behavior unless you decide this should be admin-only.
   - Forward 409 and locked/conflict responses clearly to the portal.

5. `portal`

   - Add an orchestrator section near the top of the automations page.
   - Show delete, Google RSS, and state assigner as checked and disabled.
   - Default AI approver and semantic scorer on.
   - Show live run status from the orchestrator run endpoint, not only latest child job status.
   - Include report download links in the past-runs table.

## 6. Residual risks

1. Article id ordering is practical but not a perfect business concept

   Using article id range is the right v1 choice because the database already uses increasing ids and the workflow is based on newly inserted rows. If the ingestion model changes later, the better long-term marker would be an explicit `orchestratorRunId` or ingestion batch id on articles created by Google RSS.

2. Google RSS completion reasons may require modest refactoring

   The current Google RSS job throws on HTTP 503 and logs saved article counts per request. It does not return a final structured summary. The orchestrator can still detect zero new articles from the id range, but high-quality report reasons need structured job result support.

3. Semantic scorer targeting is the widest behavioral change

   Adding targeting to semantic scorer is necessary for correctness, but it changes an endpoint that currently scores all unprocessed articles. Tests should cover both default behavior and range-limited orchestrator behavior.

4. Production schema change needs an operator-friendly path

   Because runtime services currently validate schema rather than create it, the rollout needs clear instructions for adding the two orchestrator tables before enabling the new UI.

## 7. Bottom line

Proceed with the plan, but revise it before implementation.

The core design is right: `worker-node` should own the coordinator, child jobs should remain queue-backed, Postgres should store orchestrator runs, and the portal should trigger and monitor through `api`.

The changes most likely to increase the chance of success are adding real table creation guidance, strengthening article targeting to a bounded id range, giving worker-node queue jobs structured result payloads, and trimming the v1 locking scheme to the smallest guard that prevents conflicting starts.
