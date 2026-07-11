# State Assigner API

This router creates queued jobs for the state-assigner workflow.

All endpoints are prefixed with `/state-assigner`.

## POST /state-assigner/start-job

Creates a queued job for the state-assigner process.

- Does not require authentication
- Resolves the AI backend from environment variables
- Validates `PATH_TO_STATE_ASSIGNER_FILES` is configured
- Validates required request body fields are positive integers
- Returns `202` when job is accepted into the queue

Backend selection:

- Codex CLI is the default backend when `USE_OPEN_AI_API` is unset or false-like.
- `USE_OPEN_AI_API=true` with a non-empty `KEY_OPEN_AI` selects the OpenAI API backend.
- `USE_OPEN_AI_API=true` without a key falls back to Codex CLI and logs a warning.
- `KEY_OPEN_AI` alone no longer selects the OpenAI API backend.
- When Codex CLI is selected, the route validates that `codex` is executable on the service user's `PATH`.

Pre-processing behavior:

- Before AI classification begins, the job selects the same bounded candidate article window it will analyze
- It runs article-content enrichment for only that candidate set
- Scrape failures are logged and the state assigner continues
- Articles still fall back to `article.description` when durable content remains unavailable

At runtime, this job also ensures these directories exist:

1. `PATH_TO_STATE_ASSIGNER_FILES/chatgpt_responses`
2. `PATH_TO_STATE_ASSIGNER_FILES/prompts`

Prompt behavior:

- Markdown files in `prompts/` are read at job start
- New prompt content is appended to the `Prompts` table if not already present
- The latest prompt in the database is used for article analysis

Model response behavior:

- Responses are parsed in memory and are not persisted to `chatgpt_responses/`
- Codex CLI responses are read from a temporary `--output-last-message` file under the OS temp directory, then cleaned up

### Parameters

Body fields:

1. `targetArticleThresholdDaysOld` (required, positive integer)
2. `targetArticleStateReviewCount` (required, positive integer)

Runtime dependencies:

1. `PATH_TO_STATE_ASSIGNER_FILES` (required env var)
2. `USE_OPEN_AI_API` (optional; true-like values opt into the OpenAI API backend)
3. `KEY_OPEN_AI` (optional; required only when using the OpenAI API backend)
4. `STATE_ASSIGNER_MODEL_NAME` (optional; defaults to `gpt-4o-mini` for OpenAI API and `gpt-5.4-mini` for Codex CLI)
5. `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` (optional positive integer; default `180`)
6. `codex` executable on `PATH` when the Codex CLI backend is selected

Migration note:

- Existing deployments that set `KEY_OPEN_AI` but not `USE_OPEN_AI_API=true` now use Codex CLI by default.
- To stay on the OpenAI API, set `USE_OPEN_AI_API=true` alongside `KEY_OPEN_AI`.
- Missing `KEY_OPEN_AI` alone is no longer a validation error.

### Sample Request

```bash
curl --location --request POST 'http://localhost:3002/state-assigner/start-job' \
--header 'Content-Type: application/json' \
--data '{
  "targetArticleThresholdDaysOld": 30,
  "targetArticleStateReviewCount": 100
}'
```

### Sample Response

```json
{
  "jobId": "job-14",
  "status": "queued",
  "endpointName": "/state-assigner/start-job"
}
```

### Error responses

1. Codex CLI missing while Codex backend is selected (400)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "status": 400,
    "details": [
      {
        "field": "codex",
        "message": "codex CLI not found on PATH; install the Codex CLI (docs/CODEX_CLI_SERVER_SETUP.md) or set USE_OPEN_AI_API=true with KEY_OPEN_AI"
      }
    ]
  }
}
```

2. Missing state assigner files env var (400)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "status": 400,
    "details": [
      {
        "field": "PATH_TO_STATE_ASSIGNER_FILES",
        "message": "PATH_TO_STATE_ASSIGNER_FILES env var is required"
      }
    ]
  }
}
```

3. Invalid body fields (400)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "status": 400,
    "details": [
      {
        "field": "targetArticleThresholdDaysOld",
        "message": "targetArticleThresholdDaysOld must be a positive integer"
      },
      {
        "field": "targetArticleStateReviewCount",
        "message": "targetArticleStateReviewCount must be a positive integer"
      }
    ]
  }
}
```
