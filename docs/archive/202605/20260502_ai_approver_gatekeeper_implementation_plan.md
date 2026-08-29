# 2026-05-02 AI Approver Gatekeeper Implementation Plan

## Executive Summary

Add a first-tier AI approver gatekeeper as an auditable routing stage before the existing category-specific AI approver prompts. The goal is to reduce OpenAI calls by rejecting clearly out-of-scope articles, while preserving recall for CPSC/product-safety candidates and preserving all legacy AI approver evidence.

The implementation should be additive and role-aware:

- Keep `AiApproverPromptVersions` and `AiApproverArticleScores`.
- Add nullable/defaulted metadata columns to distinguish gatekeeper prompts/results from category score prompts/results.
- Persist a gatekeeper result for every article that the gatekeeper analyzes, including hard rejects, invalid responses, and failures.
- Continue to display legacy category scores, but never treat gatekeeper confidence or decisions as category top scores.
- Seed gatekeeper prompt rows as inactive by default. Nick must explicitly activate them.
- Keep db-manager ZIP restore compatible with older backups by avoiding table/column renames, removals, and unsafe new `NOT NULL` columns.

The safest rollout is `legacy` -> `shadow` -> `gatekeeper_with_manual_review` -> `gatekeeper`. Start with shadow mode so Nick can measure what the gatekeeper would have skipped before category prompts are actually avoided.

## Current System Context

Current batch AI approver flow:

1. `portal` or worker-node orchestrator calls `api`.
2. `api` proxies to `worker-python` `POST /ai-approver/start-job`.
3. `worker-python/src/routes/ai_approver.py` enqueues a queue job.
4. `AiApproverOrchestrator.run_score(...)` loads all active prompt rows from `AiApproverPromptVersions`.
5. `AiApproverRepository.get_eligible_articles(...)` selects articles that do not have any `AiApproverArticleScores` row.
6. The worker runs every active prompt against every eligible article.
7. It writes one `AiApproverArticleScores` row per article/prompt attempt.

Current one-off review-page flow:

1. Portal opens `ModalReviewArticleContent`.
2. API creates a new inactive prompt row.
3. API proxies to `worker-python` `POST /ai-approver/review-page/start-job`.
4. Worker runs exactly one prompt against one article and writes one score row.

Current important blocker:

- `worker-python/src/modules/ai_approver/repository.py` excludes an article from batch work if any `AiApproverArticleScores` row exists for that article. After adding a gatekeeper, that rule would incorrectly make a gatekeeper result block all future category scoring. The implementation must replace that rule with role-aware eligibility.

## Architecture Overview Of The Gatekeeper Flow

### Roles

Use prompt/result roles to separate old and new AI evidence:

- `gatekeeper`: first-tier router that decides whether downstream category prompts should run.
- `category_score`: current tier-2/category scoring prompts.
- `legacy_category_score`: optional label for pre-gatekeeper historical scores. If implementation uses only `category_score`, null roles must still be interpreted as category/legacy in API queries.

### Batch Flow

In `legacy` mode:

1. Load active category prompts.
2. Select articles missing category score rows for the active category prompts.
3. Run category prompts exactly like the current flow.
4. Do not require or create gatekeeper rows.

In `shadow` mode:

1. Load one active gatekeeper prompt and active category prompts.
2. Select articles that need gatekeeper and/or category work.
3. Run the gatekeeper first when a current active gatekeeper row does not exist.
4. Persist the gatekeeper result.
5. Run category prompts even if the gatekeeper says reject.
6. Add queue metrics showing would-have-skipped counts and estimated calls avoided.

In `gatekeeper` mode:

1. Load one active gatekeeper prompt and active category prompts.
2. Run/persist gatekeeper when needed.
3. Run category prompts only for gatekeeper `pass`.
4. Persist hard rejects as gatekeeper result rows and skip category prompts.
5. Treat `manual_review`, `invalid_response`, and `failed` conservatively as non-pass unless Nick chooses otherwise for this mode.

In `gatekeeper_with_manual_review` mode:

1. Load one active gatekeeper prompt and active category prompts.
2. Run/persist gatekeeper when needed.
3. Run category prompts for `pass`.
4. Skip category prompts for high-confidence `reject`.
5. Do not run category prompts for `manual_review`; surface the article in portal as "manual review" so a human can inspect it.
6. Consider `invalid_response` and `failed` as visible AI analysis outcomes, not "not run".

### Decision Contract

Preferred gatekeeper JSON response:

```json
{
  "decision": "pass",
  "confidence": 0.86,
  "reasonCode": "cpsc_product_incident",
  "reason": "Article describes a consumer product involved in a fire injury incident.",
  "signals": {
    "consumerProductMentioned": true,
    "hazardOrInjuryMentioned": true,
    "deathOrInjuryMentioned": true,
    "likelyAdvertisement": false,
    "likelyCelebrityNews": false,
    "likelyGeneralCrimeOrPolitics": false
  }
}
```

Allowed `decision` values:

- `pass`
- `reject`
- `manual_review`

Initial hard-skip rule:

- Hard-skip downstream category prompts only when `decision = reject` and `confidence >= 0.85`.
- Treat lower-confidence rejects as `manual_review` during early rollout.
- Never silently skip on invalid/failed gatekeeper output.

The current category prompt response can stay as:

```json
{
  "score": 0.85,
  "reason": "Brief category-specific explanation."
}
```

## Exact Files Likely To Modify

### db-models

- `db-models/src/models/AiApproverPromptVersion.ts`
- `db-models/src/models/AiApproverArticleScore.ts`
- `db-models/src/models/_loadOrder.ts`
- `db-models/src/models/_index.ts`
- `db-models/src/models/_associations.ts`
- `docs/db-models/TABLE_REFERENCE.md`

`_loadOrder.ts` likely does not need a new table if the implementation uses existing AI approver tables, but it should be checked after model changes.

### db-manager

Likely no behavior change required if all schema changes are additive and model exports stay stable. Still inspect and test:

- `db-manager/src/modules/backup.ts`
- `db-manager/src/modules/zipImport.ts`
- `db-manager/src/modules/dryRunValidator.ts`
- `db-manager/src/index.ts`
- `db-manager/tests/modules/*`
- `api/tests/modules/adminDb.module.test.ts`

### worker-python

- `worker-python/src/routes/ai_approver.py`
- `worker-python/src/modules/ai_approver/config.py`
- `worker-python/src/modules/ai_approver/repository.py`
- `worker-python/src/modules/ai_approver/orchestrator.py`
- `worker-python/src/modules/ai_approver/client.py`
- `worker-python/src/standalone/setup_ai_approver_prompt.py`
- `worker-python/tests/unit/ai_approver/test_config.py`
- `worker-python/tests/unit/ai_approver/test_repository.py`
- `worker-python/tests/unit/ai_approver/test_orchestrator.py`
- `worker-python/tests/integration/test_ai_approver_routes.py`
- `worker-python/tests/contracts/ai_approver_contract_spec.json`
- `worker-python/tests/contracts/test_ai_approver_contract.py`
- `worker-python/AGENTS.md`
- `worker-python/docs/worker-python-api-documentation/*` if route behavior docs exist there.

### api

- `api/src/modules/analysis/ai-approver.ts`
- `api/src/routes/analysis/ai-approver.ts`
- `api/src/routes/newsOrgs/automations.ts`
- `api/tests/analysis/ai-approver.routes.test.ts`
- `api/tests/news-orgs/automations.routes.test.ts`
- `api/tests/admin/adminDb.routes.test.ts`

### portal

- `portal/src/types/article.ts`
- `portal/src/app/(dashboard)/articles/review/page.tsx`
- `portal/src/components/tables/TableReviewArticles.tsx`
- `portal/src/components/ui/modal/ModalAiApproverDetails.tsx`
- `portal/src/components/ui/modal/ModalReviewArticleContent.tsx`
- `portal/src/components/automations/AiApproverSection.tsx`
- `portal/src/components/automations/WorkerPythonJobStatusPanel.tsx` if richer job result display is desired.
- `portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx`
- `portal/src/app/(dashboard)/analysis/ai-approver-prompts/page.tsx` only if redirect behavior needs no change.

### worker-node

This was not in the user's initial "read" list except for relevant searches, but it is part of the AI approver reporting surface:

- `worker-node/src/modules/orchestrator/reportWriter.ts`
- `worker-node/src/modules/orchestrator/coordinator.ts` if AI approver mode must be sent from weekly orchestrator to worker-python.
- `worker-node/src/routes/orchestrator.ts` if orchestrator request bodies should expose AI approver mode.
- `worker-node/tests/routes/orchestrator.test.ts`

## Database Model And Schema Changes

Use additive changes only. Do not rename or remove existing AI approver tables or columns.

### `AiApproverPromptVersions`

Add nullable/defaulted columns:

| Column | Type | Nullability | Default | Purpose |
| --- | --- | --- | --- | --- |
| `promptRole` | string | nullable or NOT NULL with default | `category_score` | Distinguishes `gatekeeper` from category scoring. |
| `promptKey` | string | nullable | null | Stable machine key such as `consumer_product_gatekeeper_v1` or `residential_fire`. |
| `pipelineVersion` | string | nullable | null | Example: `legacy_ungated`, `ai_approver_gatekeeper_v1`. |
| `responseSchemaVersion` | string | nullable | null | Example: `score_reason_v1`, `gatekeeper_json_v1`. |
| `modelName` | string | nullable | null | Optional intended model override/audit field. |

Preferred Sequelize details:

- Keep existing `id`, `name`, `description`, `promptInMarkdown`, `isActive`, `endedAt`.
- `isActive` already defaults false; keep this behavior.
- Use `DataTypes.STRING` for new string fields.
- Add indexes for `promptRole`, `promptKey`, and optionally `pipelineVersion`.
- If using `allowNull: false` for `promptRole`, provide `defaultValue: "category_score"` so old ZIP imports and sync-created schemas are safe.

Backfill/interpretation rule:

- Existing prompt rows should be treated as `category_score` and `legacy_ungated`.
- Do not create fake gatekeeper decisions for existing score rows.
- Implementation may backfill old prompt rows with:
  - `promptRole = 'category_score'`
  - `pipelineVersion = 'legacy_ungated'`
  - `responseSchemaVersion = 'score_reason_v1'`
- If no formal migration/backfill is built, all API/worker queries must use `COALESCE("promptRole", 'category_score')`.

### `AiApproverArticleScores`

Add nullable/defaulted columns:

| Column | Type | Nullability | Default | Purpose |
| --- | --- | --- | --- | --- |
| `promptRole` | string | nullable or NOT NULL with default | `category_score` | Denormalized role at write time. |
| `pipelineVersion` | string | nullable | null | Pipeline that produced the row. |
| `decision` | string | nullable | null | Gatekeeper decision: `pass`, `reject`, `manual_review`, or `error`. |
| `confidence` | float | nullable | null | Gatekeeper confidence. |
| `reasonCode` | string | nullable | null | Machine-readable reject/pass reason. |
| `metadata` | JSONB | nullable | null | Structured gatekeeper signals, product terms, hazard terms, token usage, parser details. |

Preferred Sequelize details:

- Keep existing unique index on `["articleId", "promptVersionId"]`.
- Keep existing indexes on `articleId`, `promptVersionId`, `resultStatus`.
- Add indexes:
  - `["articleId", "promptRole"]`
  - `["promptRole", "decision"]`
  - optionally `["pipelineVersion"]`
- Use `DataTypes.JSONB` for `metadata` in Postgres.
- Do not make `decision` required because category score rows do not need it.
- Do not make `score` required because gatekeeper rejects may not have a category score.

Result interpretation:

- `resultStatus = 'completed'` means the AI call completed and output parsed for that prompt role.
- For gatekeeper rows:
  - `decision = 'pass'` means category prompts may run.
  - `decision = 'reject'` means category prompts can be skipped only in enforcing modes.
  - `decision = 'manual_review'` means portal should show AI analysis happened and a human should inspect.
  - `resultStatus = 'invalid_response'` or `failed` must still be visible.
- For category rows:
  - `score` and `reason` remain the primary output.
  - `decision` is normally null.

### Restore-Compatibility Notes

Existing db-manager ZIP backups contain CSVs named by model export names, such as:

- `AiApproverPromptVersion.csv`
- `AiApproverArticleScore.csv`

Old CSV files will not contain new columns. Therefore:

- New columns must be nullable or have safe defaults.
- `promptRole` can be NOT NULL only if it has a database/Sequelize default.
- Avoid new foreign keys that legacy data might violate.
- Do not split existing rows into a new required table.
- Do not rename model exports, table names, or columns.
- Do not remove the existing unique `(articleId, promptVersionId)` index unless a later explicit migration proves it is blocking a required workflow.

The additive same-table design is preferred because db-manager already discovers exported Sequelize models and imports in `MODEL_LOAD_ORDER`. Adding a brand-new table is possible, but it creates additional load-order and old-ZIP restore concerns.

## db-manager Backup/Restore Compatibility

Current db-manager behavior:

- `--create_backup` exports every Sequelize model with data to CSV, then zips the CSV files.
- `--zip_file <zip>` is destructive for the target DB because it rebuilds the public schema before import.
- `--dry_run --zip_file <zip>` creates a scratch DB, imports the ZIP there, reports warnings/errors, and drops the scratch DB.
- `zipImport.ts` imports CSVs in `MODEL_LOAD_ORDER`.
- Missing new columns in old CSVs are acceptable only if the new schema supplies nullable/default values.
- CSV files with no matching model are skipped.
- Invalid dates, SQLite-style booleans, and empty integer/float strings are sanitized.
- Orphaned FK rows can be skipped row by row.
- `resetAllSequences(sequelize)` runs after import.

Implementation guidance:

1. Keep AI approver table/model names stable.
2. Keep `AiApproverPromptVersion` before `AiApproverArticleScore` in `MODEL_LOAD_ORDER`.
3. If new AI approver tables are added despite this plan, add them to `MODEL_LOAD_ORDER` before dependent child tables.
4. Add db-manager tests or extend existing tests to prove:
   - backup exports AI approver rows with new nullable fields,
   - old-style CSV rows import into the new schema,
   - new JSONB metadata field accepts null/empty values,
   - dry-run validator succeeds against a representative ZIP.
5. Document that `--zip_file` and `--drop_db` are destructive target operations.

Non-destructive validation commands:

```bash
cd /home/limited_user/applications/NewsNexus12/db-models
npm run build

cd /home/limited_user/applications/NewsNexus12/db-manager
npm run build
npm test
npm start -- --dry_run --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

Destructive commands for runbooks only, not for Codex execution without Nick approval:

```bash
# DESTRUCTIVE: wipes target DB schema and recreates empty current schema.
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --drop_db
```

```bash
# DESTRUCTIVE: rebuilds target DB schema before importing the ZIP.
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

## Worker-Python Orchestration Design

### Request Modes

Add `mode` to `AiApproverStartRequest` in `worker-python/src/routes/ai_approver.py`.

Allowed values:

- `legacy`
- `shadow`
- `gatekeeper`
- `gatekeeper_with_manual_review`

Default:

- Use `legacy` initially to avoid a behavior change after deployment.
- After Nick approves rollout, default can move to `shadow`, then later to `gatekeeper_with_manual_review`.

Also support an environment default:

- `AI_APPROVER_MODE`, default `legacy`

Request body value should override the environment default if provided.

Optional thresholds:

- `gatekeeperRejectConfidenceThreshold`, default `0.85`
- Consider env fallback `AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD=0.85`

### Config

Update `worker-python/src/modules/ai_approver/config.py`:

- Add allowed mode parsing if using env default.
- Add reject confidence threshold parsing.
- Keep existing required startup env vars.
- Do not require a gatekeeper prompt at startup; a missing active gatekeeper should fail only gatekeeper/shadow jobs with a clear job error or produce zero gatekeeper attempts, depending on selected mode.

### Repository

Refactor `worker-python/src/modules/ai_approver/repository.py` around role-aware prompts and results.

Add methods:

- `get_active_prompt_versions_by_role(prompt_role: str)`.
- `get_active_gatekeeper_prompt_version()`.
- `get_active_category_prompt_versions()`.
- `get_existing_score_rows_for_articles(article_ids: list[int])` if useful for batching.
- `get_gatekeeper_result(article_id: int, prompt_version_id: int)`.
- `get_category_result(article_id: int, prompt_version_id: int)`.
- `insert_score_row(...)` extended with `prompt_role`, `pipeline_version`, `decision`, `confidence`, `reason_code`, `metadata`.

Replace current eligibility:

```sql
NOT EXISTS (
  SELECT 1
  FROM "AiApproverArticleScores" aas
  WHERE aas."articleId" = a.id
)
```

with mode-aware eligibility:

- `legacy`: article is eligible if it is missing at least one active category prompt result.
- `shadow`: article is eligible if it is missing gatekeeper result for the active gatekeeper prompt or missing at least one active category prompt result.
- `gatekeeper`: article is eligible if it is missing active gatekeeper result, or it has a pass gatekeeper result and is missing category prompt rows.
- `gatekeeper_with_manual_review`: article is eligible if it is missing active gatekeeper result, or it has a pass gatekeeper result and is missing category prompt rows.

Keep existing workflow filters:

- Exclude `ArticleIsRelevants.isRelevant = FALSE`.
- Exclude already approved articles.
- Honor `requireStateAssignment`.
- Honor `stateIds`.
- Honor `articleIdMinExclusive` and `articleIdMaxInclusive`.
- Order by `Articles.id DESC`.
- Use `ArticleContents02.content` fallback logic exactly as today unless intentionally improving it.

### OpenAI Client

`worker-python/src/modules/ai_approver/client.py` can stay generic. Consider renaming method internally or adding:

- `run_prompt(prompt: str) -> dict[str, Any]`
- Keep `score_article` as compatibility wrapper.

The OpenAI call can remain:

- chat completions
- configured model
- temperature `0.2`
- JSON object response format

Do not print prompts, article content, or secrets in logs.

### Orchestrator

Refactor `AiApproverOrchestrator.run_score(...)` into smaller helpers:

- `_run_gatekeeper_for_article(...)`
- `_run_category_prompt_for_article(...)`
- `_parse_gatekeeper_payload(...)`
- `_parse_category_payload(...)`
- `_should_run_categories(...)`

Gatekeeper parse behavior:

- Valid completed gatekeeper payload requires:
  - `decision` string in `pass`, `reject`, `manual_review`
  - `confidence` finite number between 0 and 1
  - `reason` non-empty string
  - `reasonCode` optional but preferred string
  - `signals` optional object stored in metadata
- Invalid shape persists `resultStatus = 'invalid_response'`, `promptRole = 'gatekeeper'`, `decision = 'error'`, and an explanatory `errorMessage`.
- Runtime exception persists `resultStatus = 'failed'`, `promptRole = 'gatekeeper'`, `decision = 'error'`.

Category parse behavior:

- Preserve current `score` plus non-empty `reason` rule.
- Persist `promptRole = 'category_score'`.
- Invalid/failed behavior remains visible and per-attempt.

Mode behavior:

- `legacy`:
  - Do not load or run gatekeeper.
  - Run category prompts.
  - Summary should preserve existing `promptCount`, `articleCount`, `attemptCount`, and usage totals.
- `shadow`:
  - Run gatekeeper, persist result.
  - Run category prompts regardless of gatekeeper decision.
  - Count `wouldSkipCategoryCount` when gatekeeper has a high-confidence reject.
- `gatekeeper`:
  - Run gatekeeper.
  - Run category prompts only when gatekeeper passes.
  - Skip high-confidence rejects.
  - Treat manual review as skipped and visible.
- `gatekeeper_with_manual_review`:
  - Run gatekeeper.
  - Run category prompts for pass.
  - Skip high-confidence reject.
  - Skip manual review, surface in portal.

Queue summary additions:

- `mode`
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
- existing token totals

Use additive queue result fields so existing portal panels continue to work.

### One-Off Review-Page Behavior

Keep one-off prompt runs possible because humans need a manual investigation path.

Implementation options:

- Default one-off created prompt role to `category_score`.
- If the source prompt being copied is a gatekeeper prompt, preserve `promptRole = 'gatekeeper'` unless the user explicitly changes it.
- Extend API/portal one-off form to show/select prompt role only if needed.

One-off gatekeeper runs should persist a visible gatekeeper result just like batch gatekeeper runs. One-off category runs should continue to persist category score rows.

## API Changes

### Prompt Management Routes

Update `api/src/modules/analysis/ai-approver.ts` validation:

- Accept `promptRole`.
- Accept `promptKey`.
- Accept `pipelineVersion`.
- Accept `responseSchemaVersion`.
- Accept `modelName`.
- Validate `promptRole` against allowed values.
- Default missing `promptRole` to `category_score`.
- Prevent activating more than one active gatekeeper prompt for the same `promptKey` or for the whole gatekeeper role, depending on final policy.

Update `api/src/routes/analysis/ai-approver.ts`:

- `GET /analysis/ai-approver/prompts` returns new prompt metadata.
- `POST /analysis/ai-approver/prompts` saves new prompt metadata.
- `POST /analysis/ai-approver/prompts/:promptVersionId/copy` preserves role/key/schema metadata but forces `isActive = false`.
- `PATCH /analysis/ai-approver/prompts/:promptVersionId/active` should require explicit activation. Gatekeeper prompts should stay inactive unless the user toggles them and confirms in the portal.
- `DELETE /analysis/ai-approver/prompts/:promptVersionId` remains blocked when score rows reference the prompt.

### Article Details

Update `GET /analysis/ai-approver/article/:articleId`:

- Include new score/result fields:
  - `promptRole`
  - `pipelineVersion`
  - `decision`
  - `confidence`
  - `reasonCode`
  - `metadata`
- Include prompt metadata inside `promptVersion`.
- Grouping can be either:
  - backward-compatible `scores` flat array plus new `gatekeeperResults` and `categoryScores`, or
  - flat `scores` only with clear role fields.
- Preferred response shape:

```json
{
  "result": true,
  "articleId": 123,
  "topEligibleScoreId": 456,
  "latestGatekeeperResultId": 455,
  "gatekeeperResults": [],
  "categoryScores": [],
  "legacyCategoryScores": [],
  "scores": []
}
```

Keep `scores` during transition so portal changes can be incremental.

### Top Scores

Update `POST /analysis/ai-approver/top-scores`:

- Return only completed category/legacy category scores as `topScores`.
- Exclude `promptRole = 'gatekeeper'`.
- Treat `NULL promptRole` as `category_score`.
- Add optional gatekeeper summary map:

```json
{
  "topScores": {
    "123": {
      "id": 456,
      "articleId": 123,
      "promptVersionId": 7,
      "score": 0.91,
      "resultStatus": "completed",
      "promptName": "Mechanical",
      "promptRole": "category_score"
    }
  },
  "gatekeeperResults": {
    "123": {
      "id": 455,
      "articleId": 123,
      "promptVersionId": 12,
      "resultStatus": "completed",
      "decision": "reject",
      "confidence": 0.94,
      "reasonCode": "celebrity_no_product",
      "reason": "Article is celebrity news with no product hazard."
    }
  }
}
```

This lets the review table show that AI analysis happened even when no category score exists.

### Human Verification

Update `PATCH /analysis/ai-approver/human-verify/:scoreId`:

- Only allow human verification for category score rows by default.
- If Nick wants gatekeeper override later, add a separate endpoint such as `PATCH /analysis/ai-approver/gatekeeper-verify/:scoreId`.
- Top eligible calculation must ignore gatekeeper rows.

### Automation Proxy

Update `api/src/routes/newsOrgs/automations.ts`:

- Pass through `mode` and threshold fields to worker-python.
- Add tests proving the body is proxied.

## Portal Article/Review Table And Modal Changes

### Types

Update `portal/src/types/article.ts`:

- Extend `AiApproverPromptVersion`.
- Extend `AiApproverScoreRow`.
- Extend `AiApproverArticleDetailsResponse`.
- Extend article table fields:
  - `aiApproverTopScore`
  - `aiApproverTopScoreId`
  - existing fields unchanged
  - add `aiApproverGatekeeperDecision`
  - add `aiApproverGatekeeperConfidence`
  - add `aiApproverGatekeeperReasonCode`
  - add `aiApproverGatekeeperResultStatus`
  - add `aiApproverGatekeeperScoreId`

### Review Page Data Merge

Update `portal/src/app/(dashboard)/articles/review/page.tsx`:

- Continue merging `topScores` into category top score fields.
- Also merge `gatekeeperResults` into gatekeeper status fields.
- Preserve existing behavior for legacy category scores.
- If an article has a gatekeeper reject and no category score, the AI Approver cell must still be clickable and not show `N/A`.

### Article Review Table

Update `portal/src/components/tables/TableReviewArticles.tsx`:

- Keep the current category top score circle for category scores.
- Add distinct visual states:
  - `N/A`: no AI approver analysis.
  - category score percent: tier-2/category score exists.
  - `GK`: gatekeeper analysis exists but no category score.
  - `Reject`: gatekeeper rejected.
  - `Review`: gatekeeper manual review.
  - `Err`: gatekeeper failed/invalid.
- The cell should open `ModalAiApproverDetails` for all non-`N/A` analysis states.
- Sort category scores by numeric score. For gatekeeper-only rows, sort after scored rows but before `N/A`, or add a separate hidden sort value.

### AI Approver Details Modal

Update `portal/src/components/ui/modal/ModalAiApproverDetails.tsx`:

- Group rows into:
  - Gatekeeper Results
  - Category Scores
  - Legacy Category Scores, if separately labeled
  - Failed/Invalid Attempts
- For gatekeeper rows, show:
  - decision
  - confidence
  - reason code
  - reason/error
  - prompt name/version
  - result status
  - metadata signals if compact enough
- For category rows, keep current score circle/reason/prompt expansion.
- Human validation section should apply only to current top eligible category score.
- If there are only gatekeeper rows, replace "No eligible score row" with a clear message that AI analysis happened but no tier-2/category score is available because the gatekeeper rejected or routed to manual review.

### Review Article Content Modal

Update `portal/src/components/ui/modal/ModalReviewArticleContent.tsx`:

- Include prompt role columns in the prompt picker.
- Filter or label gatekeeper prompts so users do not accidentally copy a gatekeeper as a category one-off.
- If source prompt role is preserved in one-off creation, include role in request body.

### Prompt Management Page

Update `portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx`:

- Add prompt role field in create form.
- Add prompt key, pipeline version, response schema version, and model name if implemented.
- Add role filter tabs or segmented control:
  - All
  - Gatekeeper
  - Category
  - Legacy
- Keep `isActive` false by default.
- Add an explicit confirmation before activating a gatekeeper prompt. The confirmation should mention that activation can affect downstream OpenAI call behavior depending on worker mode.
- Copying a prompt should create the copy inactive.

### Automation Section

Update `portal/src/components/automations/AiApproverSection.tsx`:

- Add mode selector with allowed modes.
- Default UI selection should remain `legacy` until Nick approves a new default.
- Include selected `mode` in the request body.
- Optionally expose reject confidence threshold in an advanced control.
- Job status panel can show new queue result counts if available.

## Prompt Seed/Gatekeeper Prompt Record Plan

Use existing `AiApproverPromptVersions` with prompt role metadata.

Update `worker-python/src/standalone/setup_ai_approver_prompt.py` or add a new standalone script:

- Make inserts idempotent by `promptKey` and `pipelineVersion` where available.
- If a gatekeeper prompt with the same key/version exists, print the existing ID and do not create a duplicate.
- Support CLI flags:
  - `--prompt-file`
  - `--name`
  - `--description`
  - `--prompt-role`
  - `--prompt-key`
  - `--pipeline-version`
  - `--response-schema-version`
  - `--model-name`
  - `--active`
- Default `--active` remains false.
- For gatekeeper prompts, do not allow activation by default. Require `--active --confirm-activate-gatekeeper` or similar if Nick explicitly asks for active seeding.

Suggested prompt record:

- `name`: `Consumer Product Gatekeeper v1`
- `description`: `First-pass high-recall CPSC/product-safety router. Rejects only clearly out-of-scope articles before category AI approver prompts.`
- `promptRole`: `gatekeeper`
- `promptKey`: `consumer_product_gatekeeper_v1`
- `pipelineVersion`: `ai_approver_gatekeeper_v1`
- `responseSchemaVersion`: `gatekeeper_json_v1`
- `isActive`: `false`
- `endedAt`: `NULL`

Prompt content requirements:

- High recall.
- False negatives are worse than false positives.
- Reject obvious ads, celebrity news, politics, sports scores, general crime, ordinary traffic crashes, workplace/industrial/medical/environmental/weather stories only when no consumer-product hazard angle exists.
- Pass or manual-review articles with plausible product-safety signals.
- Do not make final CPSC jurisdiction, duplicate, state, report, or approval decisions.
- Missing or short content should route to manual review unless the title is clearly out of scope.

Store the prompt markdown in a file such as:

- `worker-python/docs/prompts/AI_APPROVER_GATEKEEPER_CONSUMER_PRODUCT_V1.md`

Do not activate prompt records without Nick approval.

## Legacy Scores And New Gatekeeper-Aware Scores

Rules for implementation:

- Do not delete old rows.
- Do not backfill fake gatekeeper results from old category scores.
- Treat null prompt roles as category/legacy category evidence.
- API top-score logic must exclude gatekeeper rows.
- Portal must label gatekeeper rows separately.
- Worker-node orchestration report must not select latest raw `AiApproverArticleScores.score` without filtering by role.

Update `worker-node/src/modules/orchestrator/reportWriter.ts`:

- Replace:

```sql
SELECT score FROM "AiApproverArticleScores" WHERE "articleId" = a.id ORDER BY id DESC LIMIT 1
```

with role-aware selection:

```sql
SELECT aas.score
FROM "AiApproverArticleScores" aas
LEFT JOIN "AiApproverPromptVersions" apv ON apv.id = aas."promptVersionId"
WHERE aas."articleId" = a.id
  AND COALESCE(aas."promptRole", apv."promptRole", 'category_score') IN ('category_score', 'legacy_category_score')
  AND aas."resultStatus" = 'completed'
  AND aas.score IS NOT NULL
ORDER BY aas.score DESC, aas.id ASC
LIMIT 1
```

Add optional report columns:

- `AI Gatekeeper Decision`
- `AI Gatekeeper Confidence`
- `AI Gatekeeper Reason Code`
- `AI Approver Category Score`

## Testing Plan

### db-models

Commands:

```bash
cd /home/limited_user/applications/NewsNexus12/db-models
npm run build
```

Verify:

- TypeScript model changes compile.
- New columns appear in generated `dist`.
- Consuming packages import updated types/models.

### db-manager

Commands:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm run build
npm test
```

Dry-run command for a real backup ZIP:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --dry_run --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

Add/verify tests:

- Old AI approver prompt CSV without new columns imports.
- Old AI approver score CSV without new columns imports.
- New AI approver prompt/score rows with role and metadata export/import.
- `MODEL_LOAD_ORDER` still imports prompt rows before score rows.
- Dry-run report surfaces warnings clearly.

### worker-python

Commands:

```bash
cd /home/limited_user/applications/NewsNexus12/worker-python
pytest tests/unit/ai_approver tests/integration/test_ai_approver_routes.py tests/contracts/test_ai_approver_contract.py
```

Add/verify tests:

- `AiApproverStartRequest` accepts valid modes and rejects invalid modes.
- `legacy` mode does not require a gatekeeper prompt.
- `shadow` runs gatekeeper and category prompts.
- `gatekeeper` persists reject rows and skips category prompts.
- `gatekeeper_with_manual_review` persists manual-review rows and skips category prompts.
- Invalid gatekeeper JSON writes `invalid_response`.
- OpenAI exceptions write failed gatekeeper rows.
- Category prompts do not run twice for existing category rows.
- Gatekeeper rows do not block category scoring in shadow mode.
- Queue result contains additive gatekeeper/category counts.
- Contract JSON spec includes new optional request/response fields.

### api

Commands:

```bash
cd /home/limited_user/applications/NewsNexus12/api
npm run build
npm test
```

Focused command:

```bash
cd /home/limited_user/applications/NewsNexus12/api
npx jest tests/analysis/ai-approver.routes.test.ts tests/news-orgs/automations.routes.test.ts tests/admin/adminDb.routes.test.ts
```

Add/verify tests:

- Prompt create/copy returns and preserves new role metadata.
- Gatekeeper prompt activation validation works.
- Top scores exclude gatekeeper rows.
- Article details include gatekeeper rows and category rows distinctly.
- Human verify rejects gatekeeper rows or ignores them for top eligible selection.
- Automation route proxies `mode`.

### portal

Commands:

```bash
cd /home/limited_user/applications/NewsNexus12/portal
npm run lint
npm run build
```

Manual UI verification:

- Review table shows category score percentages.
- Review table shows gatekeeper-only analysis state instead of `N/A`.
- AI approver modal explains gatekeeper reject/manual-review/failure.
- Human validation remains available only for top category score.
- Prompt management can create/copy inactive gatekeeper prompts.
- Gatekeeper activation requires explicit confirmation.
- Automation UI sends selected mode.

### worker-node

Commands:

```bash
cd /home/limited_user/applications/NewsNexus12/worker-node
npm run build
npm test
```

Add/verify tests:

- Orchestrator report selects category scores, not gatekeeper rows.
- If orchestrator forwards AI approver mode, route validation and coordinator tests cover it.

### End-To-End Local Smoke

Start services in separate terminals:

```bash
cd /home/limited_user/applications/NewsNexus12/db-models
npm run build

cd /home/limited_user/applications/NewsNexus12/api
npm run dev

cd /home/limited_user/applications/NewsNexus12/worker-python
source venv/bin/activate
uvicorn src.main:app --reload --host 0.0.0.0 --port 5000

cd /home/limited_user/applications/NewsNexus12/portal
npm run dev
```

Non-destructive worker API examples:

```bash
curl -s -X POST http://localhost:5000/ai-approver/start-job \
  -H 'Content-Type: application/json' \
  -d '{"limit":1,"requireStateAssignment":true,"mode":"legacy"}'
```

```bash
curl -s -X POST http://localhost:5000/ai-approver/start-job \
  -H 'Content-Type: application/json' \
  -d '{"limit":1,"requireStateAssignment":true,"mode":"shadow"}'
```

Do not run large batches until Nick approves API cost exposure.

## Rollout Plan

### Phase 1: Schema And Read Compatibility

- Add nullable/defaulted schema fields.
- Build `db-models`.
- Update API top-score and article-detail queries to be role-aware.
- Update worker-node report score query to be role-aware.
- Keep worker-python default mode as `legacy`.
- Confirm legacy portal behavior still works.

Exit criteria:

- Existing category scores still display.
- Gatekeeper rows, if manually inserted, do not appear as top category scores.
- Old backup ZIP dry-run succeeds against the new schema.

### Phase 2: Worker Shadow Mode

- Implement gatekeeper prompt loading and result parsing.
- Seed inactive gatekeeper prompt.
- Nick explicitly activates gatekeeper prompt for test only.
- Run `shadow` mode for a small bounded sample.
- Compare gatekeeper reject/manual-review decisions with category prompt results.

Exit criteria:

- Gatekeeper result rows persist.
- Category scores still run in shadow mode.
- Portal can explain gatekeeper decisions.
- Queue result shows estimated calls avoided.

### Phase 3: Manual Review Mode

- Enable `gatekeeper_with_manual_review` for a limited article ID range or state set.
- Hard rejects skip category prompts.
- Manual-review decisions surface to portal.
- Review a sample of rejected/manual-review articles.

Exit criteria:

- No obvious product/hazard articles are incorrectly hard-rejected in the sample.
- Nick accepts threshold/prompt behavior.
- Operators understand what gatekeeper statuses mean.

### Phase 4: Controlled Gatekeeper Enforcement

- Run `gatekeeper` for a small bounded batch.
- Monitor OpenAI call reduction.
- Verify skipped category prompts are explained by persisted gatekeeper rows.
- Keep `legacy` mode available as fallback.

Exit criteria:

- Cost reduction is meaningful.
- False-negative risk is acceptable to Nick.
- Restore and rollback runbooks are documented.

### Phase 5: Production Default

- Change default mode only after Nick approval.
- Recommended production default is `gatekeeper_with_manual_review`, not hard `gatekeeper`, until more evidence exists.
- Keep gatekeeper prompt activation controlled in prompt management UI.

## Verification Checklist

- [ ] No existing table names changed.
- [ ] No existing column names changed.
- [ ] No existing columns removed.
- [ ] All new columns are nullable or have safe defaults.
- [ ] `db-models` builds.
- [ ] `db-manager` builds and tests pass.
- [ ] Old backup ZIP dry-run succeeds against new schema.
- [ ] API tests pass.
- [ ] Worker-python AI approver tests pass.
- [ ] Portal lint/build pass.
- [ ] Worker-node build/tests pass if report/orchestrator code changes.
- [ ] `legacy` mode produces current behavior.
- [ ] `shadow` mode runs gatekeeper and category prompts.
- [ ] Gatekeeper reject persists an analysis result row.
- [ ] Gatekeeper reject appears in article details modal.
- [ ] Gatekeeper row is not used as category top score.
- [ ] Existing legacy category scores remain visible and distinguishable.
- [ ] Prompt seed creates gatekeeper prompt inactive by default.
- [ ] Gatekeeper prompt activation requires Nick approval.
- [ ] No destructive DB commands were run during implementation.

## Hard Constraints For Implementation Codex

- no table/column renames
- no column removals
- no NOT NULL new columns without defaults
- do not run destructive DB commands
- do not activate prompt without Nick approval
- dry-run backup ZIP before target restore

Additional constraints:

- Do not run `db-manager --drop_db`.
- Do not run real target `db-manager --zip_file`.
- Do not commit unless Nick explicitly asks.
- Do not print or document secrets.
- Do not delete old `AiApproverArticleScores` rows.
- Do not reinterpret old category scores as gatekeeper decisions.
- Do not allow a gatekeeper row to block category scoring in shadow mode.
- Do not show gatekeeper confidence as the article's top category score.
