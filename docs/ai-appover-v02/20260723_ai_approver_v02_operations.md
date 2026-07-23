---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Operations

## 1. Release boundary

- V01 remains the existing score and gatekeeper workflow.
- V01 backend route, table, model, and source names remain unchanged.
- V01 portal automation cards and prompt pages are hidden.
- V01 review data remains available in a column hidden by default.
- V02 produces advisory `approved` or `irrelevant` predictions.
- V02 never changes approval, relevance, reports, or orchestration.
- V02 is manual-only in this release.

## 2. Namespaces

1. Worker routes

   - V01: `/ai-approver`
   - V02: `/ai-approver-v02`

2. API routes

   - V01: existing `/automations/ai-approver` and analysis routes
   - V02 worker proxy: `/automations/ai-approver-v02`
   - V02 data and review: `/analysis/ai-approver-v02`

3. Database tables

   - V01: existing `AiApproverPromptVersions` and `AiApproverArticleScores`
   - V02: `AiApproverPromptVersionsV02`
   - V02: `AiApproverRunsV02`
   - V02: `AiApproverArticlePredictionsV02`

## 3. Environment

### 3.1 V02 settings

- `AI_APPROVER_V02_MODEL_NAME`
  - Default: `gpt-5.4-mini`
  - Purpose: model passed to `codex exec`
- `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`
  - Default: `180`
  - Purpose: maximum seconds for one article evaluation
- `AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS`
  - Default: `7`
  - Purpose: retention period for expired preview records
- `AI_APPROVER_V02_PREVIEW_TTL_MINUTES`
  - Default: `15`
  - Purpose: time before an unaccepted preview expires

All numeric values must be positive integers.

### 3.2 Shared required settings

- `PG_HOST`
- `PG_PORT`
- `PG_DATABASE`
- `PG_USER`
- `PG_PASSWORD`, which may be blank
- `PATH_UTILTIES`, used by the shared worker queue
- `RUN_ENVIRONMENT`
- `NAME_APP`
- `PATH_TO_LOGS`

V02 always uses Codex CLI. It does not read `USE_OPEN_AI_API`, `OPENAI_API_KEY`, or V01 `AI_APPROVER_*` model settings.

## 4. Codex prerequisites

1. Confirm the executable is available:

   ```bash
   command -v codex
   codex --version
   ```

2. Confirm authentication:

   ```bash
   codex login status
   ```

3. Confirm the service account can read the application directory and write to its configured temporary and log locations.

4. Confirm `gpt-5.4-mini` access with a live call only after separate operator approval.

5. Do not substitute an API key backend for this release. V02 intentionally requires an authenticated Codex CLI.

## 5. Pre-deployment checklist

- [ ] Operator approved the deployment procedure.
- [ ] Production database target was independently verified.
- [ ] A production backup completed and its archive was verified.
- [ ] Codex CLI authentication was confirmed under the worker service account.
- [ ] `gpt-5.4-mini` access was approved and confirmed.
- [ ] Current db-models, db-manager, worker-python, API, and portal builds passed.
- [ ] No V02 run is queued or running.

Create the required backup with the reviewed production db-manager environment:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --create_backup
```

Record the backup path, size, timestamp, and restore-test evidence before schema installation.

## 6. Schema installation

Use the commands and verification queries in:

- `20260723_ai_approver_v02_schema_operations.md`

The installer is repeatable and non-destructive for a compatible installation. It stops before mutation when an existing V02 table is partial or incompatible.

## 7. Deployment order

1. Deploy and restart worker-python.
2. Complete the worker health checks.
3. Deploy and restart the API.
4. Complete the API and proxy health checks.
5. Deploy and restart the portal.
6. Expose V02 controls only after the preceding checks pass.

Do not place V02 in the weekly orchestrator. This release is manual-only.

## 8. Health checks

### 8.1 Worker

```bash
curl --fail http://127.0.0.1:5000/
curl --fail http://127.0.0.1:5000/queue-info/queue-status
curl --fail http://127.0.0.1:5000/ai-approver-v02/runs/latest
```

Expected results:

- worker root returns HTTP 200
- queue status returns HTTP 200
- latest run returns HTTP 200 with a run or `null`
- worker logs contain `event=startup_complete`
- worker logs contain no `event=ai_approver_v02_startup_database_failed`

A V01 configuration warning may appear. It must not prevent `event=startup_complete`.

### 8.2 API

Set an authenticated operator JWT without writing it into shell history:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail \
  -H "Authorization: Bearer ${OPERATOR_JWT}" \
  http://127.0.0.1:3000/automations/ai-approver-v02/runs/latest
curl --fail \
  -H "Authorization: Bearer ${OPERATOR_JWT}" \
  http://127.0.0.1:3000/analysis/ai-approver-v02/prompts
```

Expected results:

- API health returns HTTP 200
- the worker proxy returns a run or `null`
- prompt listing returns HTTP 200

### 8.3 Portal

- Sign in as an operator.
- Confirm only the V02 approver card is rendered on automations.
- Confirm the V01 prompt URL renders the standard not-found page.
- Confirm the V02 review column is visible.
- Confirm the V01 review column can be enabled from Columns.

## 9. Production smoke test

This procedure requires separate approval for a live Codex call.

1. Create or activate exactly one V02 prompt.
2. Open the V02 automation card.
3. Choose Mode A with a count of `1`.
4. Keep approved-boundary crossing off.
5. Keep description fallback off.
6. Preview and record the frozen bounds and eligible count.
7. Stop if the eligible count is zero or the selected article is unsuitable.
8. Confirm the preview once.
9. Verify one queued run and refresh until terminal.
10. Verify the persisted prediction and run counters.
11. Open the review modal.
12. Save validation without a comment.
13. Save a comment without changing validation.
14. Clear each field independently.
15. Confirm no approval, relevance, report, or orchestration row changed.
16. Confirm a V01 startup warning, if present, did not stop worker startup.

## 10. Normal rollback

1. Remove or roll back the portal V02 entry points.
2. Roll back the API V02 routes.
3. Roll back worker-python V02 runtime access.
4. Leave all V02 tables and data intact.
5. Confirm V01 backend routes still respond.
6. Record the rollback version and reason.

Normal rollback must not drop V02 tables. Destructive removal is a separate operator-approved procedure.

## 11. Success measures

All run metrics exclude `draft` and `expired`.

### 11.1 Run and call totals

```sql
SELECT
  COUNT(*) AS execution_runs,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_runs,
  SUM("plannedEligibleCount") AS planned_calls,
  SUM("attemptedCount") AS attempted_calls,
  SUM("completedCount") AS completed_predictions,
  SUM("failedCount") AS failed_predictions,
  SUM("invalidResponseCount") AS invalid_predictions,
  COUNT(*) FILTER (WHERE status = 'canceled') AS canceled_runs,
  COUNT(*) FILTER (WHERE status = 'circuit_breaker') AS breaker_runs
FROM "AiApproverRunsV02"
WHERE status NOT IN ('draft', 'expired');
```

### 11.2 Prediction and review totals

```sql
SELECT
  COUNT(*) AS prediction_rows,
  COUNT(*) FILTER (WHERE prediction = 'approved') AS approved_predictions,
  COUNT(*) FILTER (WHERE prediction = 'irrelevant') AS irrelevant_predictions,
  COUNT(*) FILTER (WHERE "humanValidation" IS NOT NULL) AS reviewed_predictions,
  COUNT(*) FILTER (WHERE "humanValidation" = TRUE) AS confirmed_correct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE "humanValidation" = TRUE)
    / NULLIF(COUNT(*) FILTER (WHERE "humanValidation" IS NOT NULL), 0),
    2
  ) AS human_confirmed_accuracy_percent
FROM "AiApproverArticlePredictionsV02";
```

### 11.3 Duplicate-row incidents

```sql
SELECT "articleId", COUNT(*) AS row_count
FROM "AiApproverArticlePredictionsV02"
GROUP BY "articleId"
HAVING COUNT(*) > 1;
```

The success target is zero rows returned.

### 11.4 Retry audit

```sql
SELECT
  id,
  "articleId",
  "runId",
  "promptVersionId",
  "attemptCount",
  "resultStatus"
FROM "AiApproverArticlePredictionsV02"
WHERE "attemptCount" = 2
ORDER BY "updatedAt" DESC;
```

Every listed row must represent the one permitted retry of a first `failed` or `invalid_response` outcome. Completed rows are ineligible in worker tests and repository write guards.

### 11.5 Advisory isolation

- Review all writers to `ArticleApproveds`, `ArticleIsRelevants`, report contracts, and orchestrator tables.
- Confirm no V02 route or repository appears among those writers.
- Compare the smoke-test article before and after the run.
- Treat any downstream change caused by V02 as a release-blocking incident.

### 11.6 V01 startup isolation

Count worker log records containing:

- `event=ai_approver_v01_startup_validation_failed`
- `event=startup_complete`
- `event=startup_fatal`

The success target is zero startup failures caused only by V01 configuration. Direct V01 requests may still fail and should record a clear configuration error.

## 12. Draft and expired previews

- Draft and expired previews are preview states, not execution outcomes.
- Latest execution status excludes both states.
- Execution success measures exclude both states.
- Expired previews are retained for the configured period, then pruned.

## 13. Destructive removal

The separate procedure is:

- `20260723_ai_approver_v02_destructive_removal_procedure.md`

Do not run it during normal rollback.
