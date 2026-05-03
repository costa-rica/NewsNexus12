# How to Use the AI Approver

Last updated: 2026-05-02

This document explains how the NewsNexus12 AI Approver works, how to configure category and gatekeeper prompts, how to choose an operating mode, and how to troubleshoot articles that show `N/A` in the portal review table.

## Runtime architecture

The AI Approver runs inside `worker-python` and writes results to Postgres.

Primary files:

- `worker-python/src/routes/ai_approver.py` — FastAPI routes and queue runner setup.
- `worker-python/src/modules/ai_approver/config.py` — environment parsing and allowed modes.
- `worker-python/src/modules/ai_approver/repository.py` — prompt/article selection SQL and score inserts.
- `worker-python/src/modules/ai_approver/orchestrator.py` — gatekeeper/category execution flow.
- `api/src/routes/analysis/ai-approver.ts` — API prompt management and portal-facing score lookups.
- `worker-node/src/modules/orchestrator/coordinator.ts` — weekly automation calls the worker-python AI approver endpoint.

The batch endpoint is:

```text
POST /ai-approver/start-job
```

The review-page one-off endpoint is:

```text
POST /ai-approver/review-page/start-job
```

The weekly worker-node orchestrator calls `/ai-approver/start-job` through worker-python. It sends an article limit based on the number of articles added during that orchestrator run plus article ID cursor bounds, but it does not explicitly send `mode`, so normal weekly automation uses the worker-python environment value `AI_APPROVER_MODE`.

## Prompt roles

Prompt rows live in `AiApproverPromptVersions`.

Supported `promptRole` values are:

- `category_score`
- `legacy_category_score`
- `gatekeeper`

Category prompts produce the numeric score shown in the portal review table. Gatekeeper prompts make a pass/reject/manual-review decision and are reported separately from category scores.

A working gatekeeper setup needs:

1. At least one active category prompt.
2. Exactly one active gatekeeper prompt when using `shadow`, `gatekeeper`, or `gatekeeper_with_manual_review` mode.
3. `AI_APPROVER_MODE` set to a gatekeeper-aware mode, or a request body that explicitly passes `mode`.

If `AI_APPROVER_MODE` is left unset, the default is `legacy`, and the gatekeeper will not run even if a gatekeeper prompt exists.

## AI approver modes

The worker supports these modes:

### `legacy`

Default mode.

Behavior:

- Runs active category prompts.
- Does not require a gatekeeper prompt.
- Does not run the gatekeeper.

Use this for the original category-score-only flow.

### `shadow`

Gatekeeper observation mode.

Behavior:

- Requires one active gatekeeper prompt.
- Runs the gatekeeper.
- Still runs category prompts regardless of the gatekeeper decision.
- Records gatekeeper pass/reject/manual-review counts in the queue result.

Use this as the safest first gatekeeper test because it shows what the gatekeeper would do without blocking category scoring.

### `gatekeeper`

Gatekeeper enforcement mode.

Behavior:

- Requires one active gatekeeper prompt.
- Runs the gatekeeper first.
- Runs category prompts only when the gatekeeper result is `completed` with `decision = "pass"`.
- Skips category prompts when the decision is `reject`, `manual_review`, `invalid_response`, or `failed`.

Use this when the gatekeeper is trusted enough to control category scoring.

### `gatekeeper_with_manual_review`

Currently behaves like `gatekeeper` for category execution.

Behavior:

- Requires one active gatekeeper prompt.
- Runs category prompts only on `decision = "pass"`.
- Does not currently run categories for `manual_review` results.

Treat this as a reserved/explicit manual-review mode name until the product flow defines different manual-review behavior.

## Environment variables

Required for AI approver startup and execution:

```env
PG_HOST=...
PG_PORT=...
PG_DATABASE=...
PG_USER=...
PG_PASSWORD=...
OPENAI_API_KEY=...
```

Optional AI approver settings:

```env
AI_APPROVER_MODEL_NAME=gpt-4o-mini
AI_APPROVER_BATCH_SIZE=10
AI_APPROVER_MODE=legacy
AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD=0.85
```

Recommended first gatekeeper test:

```env
AI_APPROVER_MODE=shadow
```

After changing `worker-python/.env`, restart worker-python so `AiApproverConfig.from_env()` reads the new mode.

## Gatekeeper prompt response shape

Gatekeeper prompts must instruct the model to return JSON only.

Valid gatekeeper JSON shape:

```json
{
  "decision": "pass",
  "confidence": 0.92,
  "reason": "The article is relevant to the review criteria.",
  "reasonCode": "relevant_article",
  "signals": {
    "isRelevant": true
  }
}
```

Allowed `decision` values:

- `pass`
- `reject`
- `manual_review`

`confidence` must be a number from `0` through `1`.

`reason` must be a non-empty string.

`reasonCode` is optional but recommended.

`signals` is optional and should be an object if present.

If the model returns another shape, the score row is stored with `resultStatus = 'invalid_response'`.

## Creating prompts

The convenience script can insert prompt rows into `AiApproverPromptVersions` using `worker-python/.env` for database connection values.

Category prompt example:

```bash
cd worker-python
python3 src/standalone/setup_ai_approver_prompt.py \
  --prompt-file docs/PROMPT_RESIDENTIAL_FIRE.md \
  --name "Residential Fire" \
  --description "Initial AI approver prompt for residential fire scoring." \
  --prompt-role category_score \
  --prompt-key residential_fire \
  --pipeline-version ai-approver-v1 \
  --active
```

Gatekeeper prompt example:

```bash
cd worker-python
python3 src/standalone/setup_ai_approver_prompt.py \
  --prompt-file docs/PROMPT_GATEKEEPER.md \
  --name "AI Approver Gatekeeper" \
  --description "Gatekeeper prompt for filtering AI approver category scoring." \
  --prompt-role gatekeeper \
  --prompt-key ai_approver_gatekeeper \
  --pipeline-version gatekeeper-v1 \
  --response-schema-version gatekeeper-json-v1 \
  --active \
  --confirm-activate-gatekeeper
```

Gatekeeper prompts are guarded intentionally:

- The API requires gatekeeper prompts to be created inactive and then explicitly activated.
- The setup script requires `--confirm-activate-gatekeeper` when `--prompt-role gatekeeper` and `--active` are used.
- The API allows only one active gatekeeper prompt at a time.

## Running the AI approver directly

Example legacy/category run:

```bash
curl -X POST http://localhost:5000/ai-approver/start-job \
  -H 'Content-Type: application/json' \
  -d '{"limit": 10, "requireStateAssignment": true}'
```

Example shadow-mode run without changing `.env`:

```bash
curl -X POST http://localhost:5000/ai-approver/start-job \
  -H 'Content-Type: application/json' \
  -d '{"limit": 10, "requireStateAssignment": true, "mode": "shadow"}'
```

Example gatekeeper enforcement run:

```bash
curl -X POST http://localhost:5000/ai-approver/start-job \
  -H 'Content-Type: application/json' \
  -d '{"limit": 10, "requireStateAssignment": true, "mode": "gatekeeper"}'
```

Poll status:

```bash
curl "http://localhost:5000/queue-info/latest-job?endpointName=/ai-approver/start-job"
curl "http://localhost:5000/queue-info/check-status/<jobId>"
```

## Weekly automation with gatekeeper

The weekly orchestrator lives in worker-node and calls worker-python. It does not currently pass `mode` in the AI approver request body, so configure the weekly AI approver mode through `worker-python/.env`:

```env
AI_APPROVER_MODE=shadow
```

Then restart worker-python and run weekly automation.

Recommended rollout path:

1. Keep one active category prompt.
2. Add and activate one gatekeeper prompt.
3. Set `AI_APPROVER_MODE=shadow`.
4. Restart worker-python.
5. Run the weekly automation.
6. Confirm the weekly run still completes and category scores still appear.
7. Confirm queue results include nonzero gatekeeper fields.
8. Review gatekeeper decisions in the portal details modal/report output.
9. Only after shadow-mode results look correct, test `AI_APPROVER_MODE=gatekeeper`.

## Queue result fields to verify

A successful AI approver job writes result fields such as:

- `mode`
- `promptCount`
- `articleCount`
- `attemptCount`
- `gatekeeperPromptVersionId`
- `gatekeeperAttemptCount`
- `gatekeeperPassCount`
- `gatekeeperRejectCount`
- `gatekeeperManualReviewCount`
- `gatekeeperInvalidResponseCount`
- `gatekeeperFailedCount`
- `categoryPromptCount`
- `categoryAttemptCount`
- `categorySkippedCount`
- `estimatedCategoryCallsAvoided`
- `usagePromptTokens`
- `usageCompletionTokens`
- `usageTotalTokens`

If `mode` is `legacy` or `gatekeeperPromptVersionId` is null, the gatekeeper did not run.

## Why the portal review table may show `N/A`

`N/A` in the AI Approver column does not necessarily mean the article failed scraping or that a gatekeeper is missing. The table score comes from eligible completed category score rows, not from scrape status alone.

Common reasons for `N/A`:

1. The article was scraped but the AI approver did not process it.
2. The AI approver processed only a limited batch and did not reach that article.
3. The article was outside the weekly automation article ID cursor bounds.
4. The article lacked a valid state assignment while `requireStateAssignment` was true.
5. The article was already approved or marked not relevant.
6. No active category prompt existed.
7. Category prompt output was `invalid_response` or `failed`.
8. In `gatekeeper` mode, the gatekeeper did not return `decision = "pass"`, so category scoring was skipped.

To troubleshoot, check:

- `AiApproverPromptVersions` for active category and gatekeeper prompts.
- `AiApproverArticleScores` for rows for the article.
- `resultStatus`, `promptRole`, `decision`, `confidence`, `errorCode`, and `errorMessage` on score rows.
- `ArticleStateContracts02` for valid non-error state assignment.
- `ArticleIsRelevants` and `ArticleApproveds` filters.
- The latest `/queue-info/check-status/<jobId>` result payload.

## Recommended gatekeeper test sequence

1. Confirm root build and service startup are healthy.
2. Create or verify one active category prompt.
3. Create or verify one active gatekeeper prompt.
4. Set `AI_APPROVER_MODE=shadow` in `worker-python/.env`.
5. Restart worker-python.
6. Run weekly automation or a bounded direct AI approver job.
7. Verify:
   - job status is `completed`
   - `mode = shadow`
   - `gatekeeperAttemptCount > 0`
   - category scores still appear in the portal review table
   - gatekeeper decisions appear in article details/report output
8. If shadow mode looks correct, test `AI_APPROVER_MODE=gatekeeper`.
9. In gatekeeper mode, expect some articles to have gatekeeper results but no category score when the decision is not `pass`.
