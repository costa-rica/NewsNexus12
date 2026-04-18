# AGENTS.md

This file provides guidance to engineers and AI agents working in `worker-node`.

## Purpose

`worker-node` is the internal Express + TypeScript execution service for absorbed NewsNexus Node workflows.

In NewsNexus10, several workflows lived as separate Node microservices. In NewsNexus12, those workflows are being absorbed into this one service and exposed as queue-backed HTTP job starters.

Today, `worker-node` is responsible for:

1. request-google-rss
2. semantic-scorer
3. state-assigner
4. article-content-scraper-02
5. queue inspection and cancellation

The most important thing to understand is that this project is not a general-purpose API. It is a worker runtime with thin HTTP routes in front of a single shared queue.

## Runtime architecture

The service is organized so routes stay thin and workflow logic lives in modules.

1. Application bootstrap

- `src/server.ts`
- `src/app.ts`
- Loads configuration, initializes logging, ensures startup tasks run, and mounts routes.

2. Shared infrastructure

- `src/modules/logger.ts`
- `src/modules/errors/`
- `src/modules/middleware/`
- `src/modules/startup/`
- `src/modules/db/`

3. Shared queue engine

- `src/modules/queue/jobStore.ts`
- `src/modules/queue/jobIds.ts`
- `src/modules/queue/queueEngine.ts`
- `src/modules/queue/queueStatus.ts`
- `src/modules/queue/types.ts`
- `src/modules/queue/globalQueue.ts`

4. Shared article targeting and scraping helpers

- `src/modules/articleTargeting.ts`
- `src/modules/article-content-02/config.ts`
- `src/modules/article-content-02/types.ts`
- `src/modules/article-content-02/googleNavigator.ts`
- `src/modules/article-content-02/publisherFetcher.ts`
- `src/modules/article-content-02/repository.ts`
- `src/modules/article-content-02/enrichment.ts`

5. Job modules

- `src/modules/jobs/requestGoogleRssJob.ts`
- `src/modules/jobs/semanticScorerJob.ts`
- `src/modules/jobs/stateAssignerJob.ts`
- `src/modules/jobs/articleContentScraper02Job.ts`

6. Route modules

- `src/routes/health.ts`
- `src/routes/queueInfo.ts`
- `src/routes/requestGoogleRss.ts`
- `src/routes/semanticScorer.ts`
- `src/routes/stateAssigner.ts`
- `src/routes/articleContentScraper02.ts`

## Queue model

The queue is the backbone of the project. The portal automations UI and API proxy routes depend on this queue behavior being stable.

1. Global queue

- There is one shared queue engine for the entire service.
- Concurrency is global and fixed at `1`.
- Jobs run in FIFO order.

2. Persistence

- Queue state is stored in JSON through `src/modules/queue/jobStore.ts`.
- Jobs are durable enough for status inspection across requests.
- Startup reconciliation marks stale `queued` or `running` jobs as failed after worker restart.

3. Job states

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

4. Cancellation

- Queued jobs can be canceled immediately.
- Running jobs are canceled cooperatively.
- For child-process style jobs, the engine uses `SIGTERM`, waits, then `SIGKILL` if needed.
- For in-process workflows, handlers should respect `AbortSignal` and return promptly when canceled.

5. Status routes

- `GET /queue-info/check-status/:jobId`
- `GET /queue-info/latest-job?endpointName=...`
- `GET /queue-info/queue_status`
- `POST /queue-info/cancel_job/:jobId`

When adding a workflow, reuse the existing queue engine. Do not create a second queue store or an isolated job runner unless the requirements explicitly change.

## Active workflows

### request-google-rss

Summary:

- Reads spreadsheet-driven query definitions.
- Requests Google News RSS feeds.
- Stores new `Articles` through `@newsnexus/db-models`.
- Seeds `ArticleContents02` directly when RSS provides usable content.
- Triggers the same Google-to-publisher scraping flow immediately when RSS content is missing or too short.
- Does not overwrite an existing canonical `ArticleContents02` row for an article.

Key files:

1. `src/routes/requestGoogleRss.ts`
2. `src/modules/jobs/requestGoogleRssJob.ts`
3. Supporting modules under `src/modules/google-rss/` if present

### semantic-scorer

Summary:

- Loads keyword workbook data from `PATH_TO_SEMANTIC_SCORER_DIR`.
- Scores candidate articles using embeddings.
- Persists keyword score output through `@newsnexus/db-models`.

Key files:

1. `src/routes/semanticScorer.ts`
2. `src/modules/jobs/semanticScorerJob.ts`

### state-assigner

Summary:

- Selects recent candidate articles that do not already have state assignments.
- Loads the latest prompt from DB after syncing prompt markdown files from disk.
- Sends article content to OpenAI.
- Persists `ArticleStateContract02` rows.

Key files:

1. `src/routes/stateAssigner.ts`
2. `src/modules/jobs/stateAssignerJob.ts`
3. `src/modules/startup/stateAssignerFiles.ts`

Important behavior:

1. The request body controls:

- `targetArticleThresholdDaysOld`
- `targetArticleStateReviewCount`

2. `PATH_TO_STATE_ASSIGNER_FILES` must contain:

- `prompts/`
- `chatgpt_responses/`

3. The state assigner now performs bounded pre-scrape enrichment before AI analysis.

- It enriches only the exact candidate set it is already about to process.
- If scraping fails, the job logs that failure and continues.
- If durable article content is still unavailable, it falls back to `article.description`.

### article-content-scraper-02

Summary:

- Selects the same bounded article window shape used by state assigner or accepts explicit `articleIds`.
- Scrapes article content into `ArticleContents02`.
- Reuses the same enrichment logic that state assigner and Google RSS follow-up scraping call internally.

Key files:

1. `src/routes/articleContentScraper02.ts`
2. `src/modules/jobs/articleContentScraper02Job.ts`
3. `src/modules/article-content-02/`

Current implementation details:

1. Direct HTTP first with Playwright fallback

- Direct HTTP runs first.
- If direct HTTP fails or returns weak publisher content, Playwright fallback is attempted.
- `details`, `bodySource`, and `failureType` should reflect which layers were attempted and which one succeeded.

2. Playwright runtime requirement

- Playwright fallback requires a browser binary in the runtime environment.
- Use `npx playwright install chromium` in `worker-node/` to install the managed browser binary.
- On Ubuntu or other multi-user servers, run that install command as the same user that runs the `worker-node` process.
  use this command:

```bash
sudo -u limited_user bash -c "cd /home/limited_user/applications/NewsNexus12/worker-node && npx playwright install chromium"
```

3. HTTP policy

- Platform `fetch`
- `15000ms` timeout
- Redirect policy `follow`
- Browser-style worker User-Agent

4. Content rules

- Content shorter than `200` characters is treated as failed scrape.
- New follow-up scraping from `requestGoogleRss` is only allowed during the same first-run ingestion path when a temporary seed row was just created.

5. Persistence rules

- Persist into `ArticleContents02`.
- Skip portal and state-assigner re-scrapes when any canonical `ArticleContents02` row already exists.
- Update an existing non-success canonical row when present.
- Duplicate rows are handled defensively with deterministic canonical-row selection.

## Database expectations

`worker-node` uses `@newsnexus/db-models` directly. This means workflow code is tightly coupled to the shared SQLite-backed Sequelize model package and should respect that package’s initialization patterns.

1. Database location is environment-driven

- Do not assume the live database is stored inside the `worker-node/` repo folder.
- The actual SQLite file location is resolved from environment variables, primarily `PATH_DATABASE` and `NAME_DB`.
- A repo-local file such as `worker-node/database.sqlite` may exist, but it is not a reliable indicator of the database currently used by the running service.
- When investigating live data issues, confirm the resolved database path from the active environment before drawing conclusions from any local SQLite file.

2. DB initialization

- Use `src/modules/db/ensureDbReady.ts` when a workflow needs models ready.
- Avoid scattering ad hoc `initModels()` and `sequelize.sync()` calls through unrelated files.

3. Model usage

- Keep direct model reads and writes inside workflow modules and repositories/helpers.
- Prefer explicit behavior over “magic” convenience calls.

4. Article content caveat

- `ArticleContents02` may contain multiple attempt rows for one `articleId`.
- Do not assume a schema-level uniqueness guarantee unless future schema work adds it.
- Use the canonical-row helper logic already present in `src/modules/article-content-02/repository.ts`.
- Current scraper policy is conservative: once a canonical row exists, later standalone or state-assigner scraping should skip that article.

## Environment variables

Common required variables:

1. `PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED`
2. `PATH_TO_SEMANTIC_SCORER_DIR`
3. `PATH_TO_LOGS`
4. `NODE_ENV`
5. `KEY_OPEN_AI`
6. `PATH_TO_STATE_ASSIGNER_FILES`
7. `NAME_APP`
8. `NAME_DB`
9. `PATH_DATABASE`
10. `PATH_UTILTIES`

Common optional variables:

1. `PORT`
2. `LOG_MAX_SIZE`
3. `LOG_MAX_FILES`

If a route depends on a workflow-specific path or key, validate it at the route boundary and fail with a consistent `AppError.validation(...)` response.

## Design rules for maintainers

These rules matter more than style preferences because they preserve the project’s current architecture.

1. Keep routes thin

- Validate input.
- Resolve required env vars.
- Enqueue the job.
- Return queue metadata.

2. Keep workflow logic in job or module files

- Do not move major business logic into route handlers.
- Prefer helper modules for reusable workflow pieces.

3. Reuse shared targeting and enrichment logic

- If two workflows need the same candidate article selection, centralize it.
- If two workflows need the same article-content behavior, reuse `src/modules/article-content-02/`.

4. Respect cooperative cancellation

- Long-running work should check `AbortSignal`.
- Iteration timeouts should skip the current unit of work and continue when appropriate.
- External request failures should not crash the whole workflow unless the workflow truly cannot continue.

5. Use the existing error contract

- Validation errors should go through `AppError`.
- Let `errorHandler` shape final HTTP error responses.

6. Use the project logger

- Prefer structured logging through `src/modules/logger.ts`.
- Avoid `console.log` in workflow code and routes.

7. Keep queue behavior consistent

- New starter routes should return `202` plus `jobId`, `status`, and `endpointName`.
- New automations should expose status through the existing latest-job queue routes.

8. Keep tests behavior-focused

- Follow `docs/TEST_IMPLEMENTATION_NODE.md`.
- Mock network and DB boundaries explicitly.
- Keep internal business logic real where practical.

## Testing guidance

Important test locations:

1. Route tests

- `tests/routes/`

2. Module and job tests

- `tests/modules/`

3. Smoke tests

- `tests/smoke/`

Useful commands:

```bash
npm test
npx tsc -p tsconfig.json --noEmit
```

When adding a new workflow:

1. Add a route contract test.
2. Add a job/module test for the core behavior.
3. Verify queue metadata shape.
4. Verify at least one failure path.

## Operational notes

1. This service is usually called indirectly.

- The `api/` project proxies requests into `worker-node`.
- The `portal/` automations UI depends on those API proxy routes.

2. The queue contract is user-facing.

- Changes to `endpointName`, status semantics, or cancellation behavior can break the automations UI.

3. State assigner and scraper are coupled on purpose.

- The standalone scraper route exists for automation use.
- The state assigner also reuses that logic as a bounded pre-step.
- Do not fork those paths into separate implementations unless requirements demand it.

4. Build for absorption, not for one-off scripts.

- The long-term direction of this project is to absorb legacy microservices into stable in-process modules.

## Common pitfalls

1. Importing models before DB initialization assumptions are understood.
2. Creating duplicate queue patterns instead of using `globalQueueEngine`.
3. Putting validation or env resolution deep inside workflow code instead of the route boundary.
4. Forgetting that `ArticleContents02` may have multiple attempt rows.
5. Assuming failed `ArticleContents02` rows are still eligible for rescrape from portal or state assigner. They are not, unless the code is intentionally changed.
6. Making state-assigner changes without considering the pre-scrape step.
6. Changing endpoint names that the portal latest-job panels depend on.

## Recommended first-read files

If you are new to `worker-node`, start here:

1. `README.md`
2. `src/app.ts`
3. `src/modules/queue/queueEngine.ts`
4. `src/routes/stateAssigner.ts`
5. `src/modules/jobs/stateAssignerJob.ts`
6. `src/routes/articleContentScraper02.ts`
7. `src/modules/article-content-02/enrichment.ts`
8. `docs/worker-node-api-documentation/API_REFERENCE.md`
9. `docs/requirements/REQUIREMENTS.md`
10. `docs/requirements/REQUIREMENTS_TODO.md`
