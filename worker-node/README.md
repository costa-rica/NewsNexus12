# worker-node

worker-node is an internal Express + TypeScript service that runs NewsNexus background workflows behind a single global queue.

## Role in the monorepo

In NewsNexus10 these were separate Node microservices. In NewsNexus12 they are grouped into one worker service with route-based job starters.

1. request-google-rss workflow
2. semantic-scorer workflow
3. state-assigner workflow
4. queue inspection and cancellation endpoints

## Workflow names and what they do

### request-google-rss workflow

Route group: `/request-google-rss`

Summary:

- reads query rows from spreadsheet path in `PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED`
- builds Google News RSS requests
- stores request metadata and new articles through `@newsnexus/db-models`

### semantic-scorer workflow

Route group: `/semantic-scorer`

Summary:

- loads keywords from `NewsNexusSemanticScorerKeywords.xlsx` in `PATH_TO_SEMANTIC_SCORER_DIR`
- scores unprocessed articles using embedding similarity (`Xenova/paraphrase-MiniLM-L6-v2`)
- writes keyword scores through `@newsnexus/db-models`

### state-assigner workflow

Route group: `/state-assigner`

Summary:

- selects candidate articles without state assignments
- sends article content to Codex CLI by default, or to the OpenAI API when opted in
- writes `ArticleStateContract02` records through `@newsnexus/db-models`

State assigner file layout (`PATH_TO_STATE_ASSIGNER_FILES`):

1. `chatgpt_responses/`
2. `prompts/`

Behavior:

- startup ensures both subdirectories exist
- prompt `.md` files in `prompts/` are loaded and appended to DB if new
- model responses are parsed in memory and are not written to `chatgpt_responses/`

Backend selection:

- Codex CLI is the default backend
- set `USE_OPEN_AI_API=true` with `KEY_OPEN_AI` to stay on the OpenAI API
- `KEY_OPEN_AI` alone no longer selects the OpenAI API backend
- `STATE_ASSIGNER_MODEL_NAME` overrides the backend-specific default model
- `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` controls the Codex per-article timeout, default `180`
- Codex-backed jobs can take up to the Codex timeout per article and hold the global queue while they run

## Service routes

### service health routes

1. `GET /`
2. `GET /health`

Purpose:

- smoke check and uptime checks

### queue control routes

Base path: `/queue-info`

1. `GET /queue-info/check-status/:jobId`
2. `GET /queue-info/queue_status`
3. `POST /queue-info/cancel_job/:jobId`

Purpose:

- check one job status
- view queue summary
- cancel queued or active jobs

### workflow job starter routes

All starter routes enqueue work and return `202` with a `jobId`.

1. `POST /request-google-rss/start-job`
2. `POST /semantic-scorer/start-job`
3. `POST /state-assigner/start-job`

Purpose:

- start each workflow through the same queue engine

## Queue model

Queue characteristics:

1. single process queue engine
2. global concurrency = 1
3. FIFO ordering
4. no retries

Job state persistence:

- JSON file at `PATH_UTILTIES/worker-node/queue-jobs.json`
- atomic writes (temp file + rename)
- serialized in-process access

Cancellation behavior:

1. queued job: canceled immediately
2. running job: `SIGTERM`, wait 10 seconds, then `SIGKILL` if still running

## Required environment variables

1. `PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED`
2. `PATH_TO_SEMANTIC_SCORER_DIR`
3. `PATH_TO_LOGS`
4. `NODE_ENV`
5. `PATH_TO_STATE_ASSIGNER_FILES`
6. `NAME_APP`
7. `PATH_UTILTIES`
8. `PG_HOST`
9. `PG_PORT`
10. `PG_DATABASE`
11. `PG_USER`

Optional:

1. `PORT` (default `3002`)
2. `LOG_MAX_SIZE` (default `5` MB)
3. `LOG_MAX_FILES` (default `5`)
4. `PG_PASSWORD` (default empty for local trust-auth setups)
5. `PG_SCHEMA` (default `public`)
6. `DELETE_ARTICLES_BATCH_SIZE` (default `1000`)
7. `USE_OPEN_AI_API` (default `false`; set true-like to use OpenAI API)
8. `KEY_OPEN_AI` (required only with `USE_OPEN_AI_API=true`)
9. `STATE_ASSIGNER_MODEL_NAME` (backend-specific default)
10. `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` (default `180`)

## Database

- Type: Postgres 16 via Sequelize 6 in `@newsnexus/db-models`
- Runtime workers do not run `sequelize.sync()` on startup or inside jobs
- Expected local development database: `newsnexus_dev`
- Expected worker test database: `newsnexus_test_worker_node`

## Scripts

1. `npm run dev`
2. `npm run build`
3. `npm run playwright:browsers:install`
4. `npm start`
5. `npm test`
6. `npm run test:watch`

## Playwright browser install

The article-content scraper uses Playwright, which requires a Chromium binary in the runtime environment.

Typical setup:

1. `npm install`
2. `npm run build`
3. `npm run playwright:browsers:install`

On Ubuntu servers, install the browser as the same user that runs `worker-node`. For example:

```bash
sudo -u limited_user npm run playwright:browsers:install
```

## Documentation

1. endpoint reference: `worker-node/docs/worker-node-api-documentation/API_REFERENCE.md`
2. requirements: `worker-node/docs/requirements/REQUIREMENTS.md`
3. requirements todo/phases: `worker-node/docs/requirements/REQUIREMENTS_TODO.md`
