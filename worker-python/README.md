# NewsNexus Python Queuer (FastAPI)

This is the FastAPI-based Python worker service for NewsNexus12. It runs absorbed
Python workflows in-process and reports status through a shared JSON-backed queue.

## Current status

- Worker API, deduper, location scorer, and AI approver pipeline run in-process.
- Queue state is persisted under `PATH_UTILTIES/worker-python/queue-jobs.json`.
- Implementation and maintenance guidance is in `AGENTS.md`.

## Quick start

Create or reuse a virtual environment, install dependencies, ensure
`worker-python/.env` is populated, then run Uvicorn:

```bash
cd worker-python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --host 0.0.0.0 --port 5000
```

## Test setup

Install dev dependencies:

```bash
pip install -r requirements-dev.txt
```

Run tests:

```bash
make test
make test-fast
make test-contract
```

Focused AI approver tests:

```bash
pytest tests/integration/test_ai_approver_routes.py tests/unit/ai_approver
```

## Queue status endpoints

All queued workflows share these status routes:

- `GET /queue-info/check-status/{job_id}`
- `GET /queue-info/latest-job?endpointName=/ai-approver/start-job`
- `GET /queue-info/queue-status`
- `POST /queue-info/cancel-job/{job_id}`

The queue runs one job at a time. Cancellation is cooperative, so long-running
workflow code must check the queue execution context between units of work.

## AI Approver flow

The AI approver has two worker-python entry points:

- `POST /ai-approver/start-job`
- `POST /ai-approver/review-page/start-job`

`POST /ai-approver/start-job` queues a batch scoring run. Request body:

```json
{
  "limit": 10,
  "requireStateAssignment": true,
  "stateIds": [1, 2],
  "articleIdMinExclusive": 1000,
  "articleIdMaxInclusive": 2000
}
```

Fields:

- `limit`: positive integer, default `10`.
- `requireStateAssignment`: boolean, default `true`.
- `stateIds`: optional list of state IDs to require from `ArticleStateContracts02`.
- `articleIdMinExclusive`: optional lower article ID cursor.
- `articleIdMaxInclusive`: optional upper article ID cursor.

The route returns HTTP `202` with:

```json
{
  "jobId": "0001",
  "status": "queued",
  "endpointName": "/ai-approver/start-job"
}
```

`POST /ai-approver/review-page/start-job` queues a one-off score from the review
modal. Request body:

```json
{
  "articleId": 77,
  "promptVersionId": 456
}
```

It returns the same queued job shape with endpoint name
`/ai-approver/review-page/start-job`.

### AI Approver execution

`src/routes/ai_approver.py` keeps route handlers thin and creates a queued
runner. The runner:

1. Loads `AiApproverConfig.from_env()`.
2. Opens `AiApproverRepository`.
3. Creates `AiApproverOpenAIClient`.
4. Calls `AiApproverOrchestrator`.
5. Writes queue result fields such as `promptCount`, `articleCount`,
   `attemptCount`, token usage, and `statusText`.
6. Closes the repository connection pool.

Batch runs call `AiApproverOrchestrator.run_score(...)`:

- Loads active prompt versions from `AiApproverPromptVersions` where
  `"isActive" = TRUE`.
- Loads eligible articles from `Articles`.
- Uses `ArticleContents02.content` when present, preferring successful and
  longest content rows, then falls back to `Articles.description`.
- Skips articles that already have any `AiApproverArticleScores` row.
- Skips articles marked not relevant in `ArticleIsRelevants`.
- Skips articles that already have an `ArticleApproveds` row.
- Optionally requires valid state rows in `ArticleStateContracts02`.
- Builds each prompt by replacing `{articleTitle}` and `{articleContent}`.
- Calls OpenAI chat completions with JSON object response format.
- Inserts one result row per article/prompt attempt into
  `AiApproverArticleScores`.

Review-page runs call `AiApproverOrchestrator.run_single_score(...)` for one
article and one prompt version. This path does not require the prompt to be
active and reports `contentSource` in the queue job result.

### AI Approver result rows

Successful model payloads must include:

```json
{
  "score": 0.85,
  "reason": "Brief explanation"
}
```

Rows are written to `AiApproverArticleScores` with:

- `resultStatus = 'completed'` when `score` is numeric and `reason` is non-empty.
- `resultStatus = 'invalid_response'` when the model returns JSON that does not
  match the expected shape.
- `resultStatus = 'failed'` when the OpenAI call or response parsing raises.
- `jobId` set to the queue job ID.

## AI Approver prompt setup

The AI Approver flow can use prompt rows from `AiApproverPromptVersions` before the portal prompt-management page exists.

Use the one-time setup script to insert a prompt row from a markdown file:

```bash
cd worker-python
python3 src/standalone/setup_ai_approver_prompt.py --active
```

Default behavior:

- loads environment variables from `worker-python/.env`
- reads `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, and optional `PG_PASSWORD`
- reads `worker-python/docs/PROMPT_RESIDENTIAL_FIRE.md`
- inserts a row into `AiApproverPromptVersions`
- marks the row active when `--active` is provided

Optional arguments:

- `--prompt-file` to load a different markdown file
- `--name` to override the prompt row name
- `--description` to override the prompt row description

Example:

```bash
cd worker-python
python3 src/standalone/setup_ai_approver_prompt.py \
  --prompt-file docs/PROMPT_RESIDENTIAL_FIRE.md \
  --name "Residential Fire" \
  --description "Initial AI approver prompt for residential fire scoring." \
  --active
```

The prompt setup script is a convenience tool. If it fails with a relation or
column error, verify the Postgres table and quoted column names created by
`db-models` before relying on the inserted prompt.

## AI Approver environment

Required at startup:

- `PG_HOST`
- `PG_PORT`
- `PG_DATABASE`
- `PG_USER`
- `OPENAI_API_KEY`

Optional:

- `PG_PASSWORD`
- `AI_APPROVER_MODEL_NAME`, default `gpt-4o-mini`
- `AI_APPROVER_BATCH_SIZE`, default `10`

The batch size setting is parsed and validated by config, but the current batch
orchestrator uses the request `limit` as the article count.

## Endpoints currently implemented

- `GET /`
- `GET /test`
- `POST /ai-approver/start-job`
- `POST /ai-approver/review-page/start-job`
- `GET /deduper/jobs`
- `GET /deduper/jobs/reportId/{report_id}`
- `GET /deduper/jobs/{job_id}`
- `POST /deduper/jobs/{job_id}/cancel`
- `GET /deduper/jobs/list`
- `GET /deduper/health`
- `DELETE /deduper/clear-db-table`
- `POST /location-scorer/start-job`
- `GET /queue-info/check-status/{job_id}`
- `GET /queue-info/latest-job`
- `GET /queue-info/queue-status`
- `POST /queue-info/cancel-job/{job_id}`

## Next work

- Finalize deployment checklist and rollout safeguards.
- Continue endpoint and operations documentation maintenance.
