# AI Approver Flow Report - 2026-05-02

## Scope

This report documents the current `worker-python` AI approver flow on branch
`dev_06_ai_approver`, with emphasis on the worker route, queue behavior,
database reads/writes, active prompt scoring agents, and a proposed future
discussion direction for a consumer-product gatekeeper prompt.

No application logic was changed for this report.

## Worker routes

The AI approver worker routes live in `worker-python/src/routes/ai_approver.py`
and are mounted by `worker-python/src/main.py`.

### `POST /ai-approver/start-job`

Queues the batch AI approver workflow. The endpoint name persisted to queue
state is:

```text
/ai-approver/start-job
```

Request body fields:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | positive integer | `10` | Maximum number of eligible articles to score. |
| `requireStateAssignment` | boolean | `true` | Requires a valid `ArticleStateContracts02` row when true. |
| `stateIds` | integer array or null | `null` | Optional state filter. |
| `articleIdMinExclusive` | positive integer or null | `null` | Optional lower article ID cursor. |
| `articleIdMaxInclusive` | positive integer or null | `null` | Optional upper article ID cursor. |

Response shape:

```json
{
  "jobId": "0001",
  "status": "queued",
  "endpointName": "/ai-approver/start-job"
}
```

### `POST /ai-approver/review-page/start-job`

Queues a one-off score from the review-page modal. The endpoint name persisted
to queue state is:

```text
/ai-approver/review-page/start-job
```

Request body fields:

| Field | Type | Notes |
| --- | --- | --- |
| `articleId` | positive integer | Article to score. |
| `promptVersionId` | positive integer | Prompt row to use. This path does not require the prompt to be active. |

Response shape:

```json
{
  "jobId": "0002",
  "status": "queued",
  "endpointName": "/ai-approver/review-page/start-job"
}
```

## Queue and job manager behavior

The AI approver does not use `src/services/job_manager.py`; that service is
part of the deduper route path. AI approver routes enqueue directly into the
shared queue engine from `src/modules/queue/global_queue.py`.

The queue implementation is in:

- `src/modules/queue/engine.py`
- `src/modules/queue/store.py`
- `src/modules/queue/types.py`
- `src/modules/queue/status.py`

Important behavior:

- Jobs are persisted in `PATH_UTILTIES/worker-python/queue-jobs.json`.
- `jobId` values are strings such as `0001`.
- Only one job runs at a time.
- Status values are `queued`, `running`, `completed`, `failed`, and `canceled`.
- Cancellation is cooperative through `QueueExecutionContext.is_cancel_requested`.
- On startup, persisted `queued` and `running` jobs are reconciled to `failed`
  with failure reason `worker_restarted_before_completion`.
- Route runners append simple log lines such as `event=job_started`,
  `event=job_completed`, `event=job_failed`, and `event=job_cancelled`.

Status and cancellation routes:

```text
GET  /queue-info/check-status/{job_id}
GET  /queue-info/latest-job?endpointName=/ai-approver/start-job
GET  /queue-info/queue-status
POST /queue-info/cancel-job/{job_id}
```

Batch job result fields include `exitCode`, `statusText`, `promptCount`,
`articleCount`, `attemptCount`, and token usage totals. Review-page one-off jobs
also include `contentSource`.

## Config and environment

AI approver config is loaded by `AiApproverConfig.from_env()` in
`src/modules/ai_approver/config.py`.

Required startup env vars:

- `PG_HOST`
- `PG_PORT`
- `PG_DATABASE`
- `PG_USER`
- `OPENAI_API_KEY`

Optional env vars:

- `PG_PASSWORD`, default empty
- `AI_APPROVER_MODEL_NAME`, default `gpt-4o-mini`
- `AI_APPROVER_BATCH_SIZE`, default `10`

`AI_APPROVER_BATCH_SIZE` is parsed and validated but is not currently used to
page through articles; the batch route's request `limit` controls selected
article count.

The worker app loads `worker-python/.env` in `src/main.py`. The `.env` file
must not be copied into documentation because it may include secrets.

## Database tables and models used

The shared Sequelize models live in `db-models/src/models/`.

Primary AI approver models:

- `AiApproverPromptVersion` -> table `AiApproverPromptVersions`
- `AiApproverArticleScore` -> table `AiApproverArticleScores`

Batch article selection reads:

- `Articles`
- `ArticleContents02`
- `ArticleIsRelevants`
- `ArticleApproveds`
- `ArticleStateContracts02`
- `AiApproverArticleScores`

Review-page one-off selection reads:

- `Articles`
- `ArticleContents02`
- `AiApproverPromptVersions`

Result writes:

- `AiApproverArticleScores`

`AiApproverArticleScores` fields written by worker-python:

- `articleId`
- `promptVersionId`
- `resultStatus`
- `score`
- `reason`
- `errorCode`
- `errorMessage`
- `isHumanApproved` as `NULL`
- `reasonHumanRejected` as `NULL`
- `jobId`
- `createdAt`
- `updatedAt`

## Batch scoring flow

`POST /ai-approver/start-job` creates a runner with
`create_ai_approver_runner(...)`. The runner creates config, repository,
OpenAI client, and orchestrator, then calls:

```python
AiApproverOrchestrator.run_score(...)
```

The orchestrator:

1. Calls `AiApproverRepository.get_active_prompt_versions()`.
2. Calls `AiApproverRepository.get_eligible_articles(...)`.
3. For every article and every active prompt, replaces `{articleTitle}` and
   `{articleContent}` in `promptInMarkdown`.
4. Calls `AiApproverOpenAIClient.score_article(prompt)`.
5. Inserts a score row with `insert_score_row(...)`.

Eligible articles are selected from `Articles` ordered by `a.id DESC` and
limited by request `limit`.

Batch eligibility excludes an article when:

- any `AiApproverArticleScores` row already exists for the article
- an `ArticleIsRelevants` row marks it as not relevant
- any `ArticleApproveds` row exists for it
- `requireStateAssignment` is true and there is no non-error
  `ArticleStateContracts02` row
- `stateIds` is provided and there is no matching non-error
  `ArticleStateContracts02.stateId`
- the article ID is outside the optional cursor bounds

Article content comes from the best `ArticleContents02` row when available.
Ordering prefers successful content rows, then longer trimmed content, then
higher content row ID. If no content row is available, the worker falls back to
`Articles.description`, then an empty string.

## Review-page one-off scoring flow

`POST /ai-approver/review-page/start-job` creates a runner with
`create_review_page_ai_approver_runner(...)`. The runner calls:

```python
AiApproverOrchestrator.run_single_score(...)
```

The single-score path:

1. Loads one prompt by ID from `AiApproverPromptVersions`.
2. Loads one article by ID from `Articles`, with the same `ArticleContents02`
   preference and `Articles.description` fallback.
3. Builds one prompt.
4. Calls OpenAI once.
5. Inserts one `AiApproverArticleScores` row.

This path reports `contentSource` as:

- `article-contents-02`
- `article-description`
- `none`

## OpenAI client and result handling

The OpenAI wrapper is `src/modules/ai_approver/client.py`.

Current request behavior:

- Client: `OpenAI(api_key=config.openai_api_key)`
- Endpoint: chat completions
- Model: `AI_APPROVER_MODEL_NAME`, default `gpt-4o-mini`
- Message shape: one user message containing the fully rendered prompt
- Temperature: `0.2`
- Response format: JSON object

Expected successful model payload:

```json
{
  "score": 0.85,
  "reason": "Brief explanation for the score."
}
```

Result handling:

- Numeric `score` plus non-empty string `reason` writes
  `resultStatus = 'completed'`.
- Any other JSON shape writes `resultStatus = 'invalid_response'`.
- Runtime exceptions, OpenAI failures, and JSON parse exceptions write
  `resultStatus = 'failed'`.

The orchestrator catches per-attempt exceptions, writes a failed score row, and
continues to the next article/prompt attempt. Config errors and outer runner
errors fail the queue job.

## Current active prompt scoring agents

Database querying was possible on 2026-05-02. I first attempted to query through
Python using the project environment, but the default interpreter did not have
`psycopg` installed. I then queried successfully with `psql`, using values from
`worker-python/.env` only as connection inputs.

Reproducible prompt query, without secrets:

```sql
SELECT
  id,
  name,
  description,
  "isActive",
  "endedAt",
  "createdAt",
  "updatedAt",
  length("promptInMarkdown") AS prompt_length,
  left(regexp_replace("promptInMarkdown", '\s+', ' ', 'g'), 400) AS prompt_excerpt
FROM "AiApproverPromptVersions"
WHERE "isActive" = TRUE
ORDER BY id ASC;
```

Reproducible score count query:

```sql
SELECT
  p.id,
  p.name,
  p.description,
  COALESCE(s.completed, 0) AS completed,
  COALESCE(s.invalid_response, 0) AS invalid_response,
  COALESCE(s.failed, 0) AS failed,
  COALESCE(s.total, 0) AS total
FROM "AiApproverPromptVersions" p
LEFT JOIN (
  SELECT
    "promptVersionId",
    count(*) AS total,
    count(*) FILTER (WHERE "resultStatus" = 'completed') AS completed,
    count(*) FILTER (WHERE "resultStatus" = 'invalid_response') AS invalid_response,
    count(*) FILTER (WHERE "resultStatus" = 'failed') AS failed
  FROM "AiApproverArticleScores"
  GROUP BY "promptVersionId"
) s ON s."promptVersionId" = p.id
WHERE p."isActive" = TRUE
ORDER BY p.id ASC;
```

Active prompts found:

| id | name | description | prompt length | completed | invalid response | failed | total |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Residential Fire | version01 | 1430 | 1002 | 774 | 0 | 1776 |
| 2 | Electrical Shock | version02 | 1894 | 592 | 1184 | 0 | 1776 |
| 3 | Electrical Shock | version01 | 1431 | 766 | 1009 | 0 | 1775 |
| 4 | Fire and burn | version01 | 1423 | 1362 | 413 | 0 | 1775 |
| 5 | Fire and Burn | version02 | 2120 | 634 | 1141 | 0 | 1775 |
| 6 | Mechanical | version01 | 1568 | 983 | 792 | 0 | 1775 |
| 7 | Mechanical | version02 | 1999 | 1150 | 625 | 0 | 1775 |
| 8 | Household | version02 | 2005 | 900 | 875 | 0 | 1775 |
| 9 | Chemical Hazards | version02 | 1990 | 768 | 1005 | 2 | 1775 |
| 10 | Sports and Recreation | version02 | 2150 | 606 | 1169 | 0 | 1775 |
| 11 | Children's Products | version02 | 2077 | 359 | 1416 | 0 | 1775 |

Overall result statuses in `AiApproverArticleScores` at query time:

| resultStatus | row count |
| --- | ---: |
| completed | 9122 |
| failed | 2 |
| invalid_response | 10403 |

Interpretation:

- Each active prompt row currently functions as one scoring agent.
- The batch worker runs all 11 active agents against every eligible article.
- Several active prompts are version02 prompts with stricter CPSC-oriented
  approval criteria around real incidents, injury or death, consumer products,
  and category-specific hazards.
- Version01 prompts are simpler threshold prompts that tend to assign scores
  based on broader event category matches and higher scores when a consumer
  product is identified.
- The high `invalid_response` counts indicate prompt/output-shape reliability
  should be reviewed before depending on these scores as an automated gate.

## Running the flow locally

Install dependencies:

```bash
cd worker-python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Ensure `worker-python/.env` has the required `PG_*`, `OPENAI_API_KEY`,
`PATH_UTILTIES`, and other startup variables used by the service.

Start the worker:

```bash
uvicorn src.main:app --reload --host 0.0.0.0 --port 5000
```

Queue a small batch:

```bash
curl -s -X POST http://localhost:5000/ai-approver/start-job \
  -H 'Content-Type: application/json' \
  -d '{"limit": 1, "requireStateAssignment": true}'
```

Poll status:

```bash
curl -s http://localhost:5000/queue-info/check-status/0001
curl -s 'http://localhost:5000/queue-info/latest-job?endpointName=/ai-approver/start-job'
```

Queue a review-page one-off score:

```bash
curl -s -X POST http://localhost:5000/ai-approver/review-page/start-job \
  -H 'Content-Type: application/json' \
  -d '{"articleId": 77, "promptVersionId": 1}'
```

## Testing

Focused test command:

```bash
cd worker-python
pytest tests/integration/test_ai_approver_routes.py tests/unit/ai_approver
```

Relevant coverage:

- `tests/integration/test_ai_approver_routes.py`
- `tests/unit/ai_approver/test_config.py`
- `tests/unit/ai_approver/test_orchestrator.py`
- `tests/unit/ai_approver/test_repository.py`
- `tests/contracts/test_ai_approver_contract.py`
- `tests/contracts/ai_approver_contract_spec.json`

Repository tests require a Postgres test database matching the test utilities.
Route and orchestrator tests use fakes or monkeypatches for lightweight coverage.

## Troubleshooting

Worker fails at startup:

- Confirm `worker-python/.env` exists.
- Confirm `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, and `OPENAI_API_KEY`
  are present.
- Confirm non-AI startup requirements such as `PATH_UTILTIES` and
  `NAME_AI_ENTITY_LOCATION_SCORER` are also present.

Queued job has zero articles:

- Confirm at least one prompt is active in `AiApproverPromptVersions`.
- Confirm target articles do not already have `AiApproverArticleScores` rows.
- Confirm target articles are not rejected by `ArticleIsRelevants`.
- Confirm target articles do not already have `ArticleApproveds` rows.
- Confirm state assignment filters in `ArticleStateContracts02`.
- Confirm request cursor bounds and `stateIds`.

Rows are `invalid_response`:

- Inspect `AiApproverPromptVersions.promptInMarkdown`.
- Confirm the prompt explicitly requires JSON only.
- Confirm the prompt asks for numeric `score` and non-empty `reason`.
- Compare version01 and version02 prompts for stricter instructions that may
  produce the documented error shape instead of a score.

Rows are `failed`:

- Inspect `AiApproverArticleScores.errorCode` and `errorMessage`.
- Check OpenAI key, model name, connectivity, and quota.
- Check whether the model returned non-JSON content that raised during parsing.

Prompt setup script:

- `src/standalone/setup_ai_approver_prompt.py` loads `PG_*` env vars and reads a
  markdown prompt file.
- The current script is intended as a convenience inserter for
  `AiApproverPromptVersions`.
- If it fails with relation or column errors, verify identifier quoting against
  the Postgres schema created by `db-models`.

## Proposed discussion direction: consumer-product gatekeeper

Nick wants to explore a future flow where one gatekeeping prompt or AI agent
first verifies whether an article has anything to do with a consumer product
before the worker invokes the more specific approval scoring prompts.

Do not implement this yet. The current architecture runs every active prompt for
every eligible article. A gatekeeper would change that behavior.

Likely code areas that would change:

- `AiApproverPromptVersions`: decide whether gatekeeper prompts are stored in
  the same table with a new type/role field, or in a separate table.
- `AiApproverRepository.get_active_prompt_versions()`: likely split into
  gatekeeper prompt lookup and scoring prompt lookup.
- `AiApproverOrchestrator.run_score(...)`: run the gatekeeper first per
  article, then conditionally run the existing category-specific prompts.
- `AiApproverOrchestrator.run_single_score(...)`: decide whether review-page
  one-off scoring bypasses the gatekeeper or can explicitly run it.
- `AiApproverArticleScores`: decide whether gatekeeper outputs should be stored
  in the same table, a new table, or the same table with a prompt role.
- API/portal prompt management: expose prompt role/type so active gatekeepers
  are not mixed with category scoring agents.
- Queue result payload: optionally add counts such as `gatekeeperPassCount`,
  `gatekeeperRejectCount`, and skipped scoring attempts.

Open product and engineering questions:

- Should the gatekeeper only detect consumer-product relevance, or should it
  also detect CPSC relevance?
- Should low-confidence gatekeeper decisions skip scoring, continue scoring, or
  be routed for manual review?
- What threshold should trigger the downstream scoring agents?
- Should the existing category prompts still be allowed to approve non-product
  incident categories for discovery, or should consumer-product relevance be a
  hard precondition?
- How should historical score rows be interpreted after introducing a gatekeeper?

The cleanest incremental implementation would likely add an explicit prompt
role, keep current scoring prompts unchanged, write gatekeeper results in a
reviewable way, and add a feature flag or inactive prompt setup before using it
as a hard production gate.
