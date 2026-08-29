# 2026-05-02 Software Architect Report - AI Approver Gatekeeper

## Executive recommendation

NewsNexus12 should **keep all existing `AiApproverArticleScores` data** and add the gatekeeper as a versioned, auditable first stage in the AI approver pipeline. There is no architectural reason to delete old approval scores. The existing rows are useful historical evidence: they show what prompts ran, when they ran, what they returned, which rows failed output validation, and which scores humans later accepted or rejected.

The cleanest incremental architecture is:

1. Add a role/type field to `AiApproverPromptVersions`.
2. Add role-aware metadata to `AiApproverArticleScores`, or add a small related decision/result table if schema churn must be minimized.
3. Run one active gatekeeper prompt per article first.
4. Only run active category-specific approver prompts when the gatekeeper decision passes, or when experiment mode says to continue for comparison.
5. Preserve old category scores as legacy category-score evidence and exclude them from new gatekeeper metrics unless explicitly doing historical comparison.

Nick should not delete old scores. Old rows should be treated as **legacy ungated category prompt results**, not as proof that the new gatekeeper would have passed.

## Current architecture facts

The current worker-python AI approver flow runs from `worker-python/src/routes/ai_approver.py` through `src/modules/ai_approver/orchestrator.py` and `repository.py`.

The batch flow:

- loads every active row from `AiApproverPromptVersions`
- selects eligible articles from `Articles`
- renders `{articleTitle}` and `{articleContent}`
- calls OpenAI once per article per active prompt
- writes one row to `AiApproverArticleScores`

The current schema already has the right core audit anchors:

- `AiApproverPromptVersions.id` identifies the exact prompt version used.
- `AiApproverArticleScores.articleId` identifies the article.
- `AiApproverArticleScores.promptVersionId` identifies the prompt.
- `resultStatus`, `score`, `reason`, `errorCode`, `errorMessage`, `jobId`, timestamps, and human verification fields preserve the outcome.
- A unique index on `(articleId, promptVersionId)` prevents accidental duplicate runs of the same prompt version against the same article.

The main current blocker for a gatekeeper is behavioral, not conceptual: batch eligibility excludes an article when **any** `AiApproverArticleScores` row already exists for the article. With a gatekeeper, that rule would need to become role-aware. A gatekeeper result must not automatically mean "all category scoring is complete."

## Answer 1: can old scores be kept?

Yes. Keep old `AiApproverArticleScores`.

Deleting old data would reduce auditability and make it harder to answer operational questions such as:

- Which prompts produced high scores before the gatekeeper existed?
- Which prompts had high `invalid_response` rates?
- Did the gatekeeper reduce calls without excluding articles that old prompts scored highly?
- Which articles were manually accepted or rejected based on prior AI evidence?
- Did prompt version changes improve precision over time?

Historical scores are not harmful if the system labels and queries them correctly. The risk is not that old rows exist. The risk is that new code continues to ask vague questions like "does this article have any AI approver score?" or "what is the latest AI approver score?" without accounting for prompt role and pipeline version.

## Answer 2: how should old scores be used?

Use old scores as read-only historical category-score evidence. Do not reinterpret them as gatekeeper decisions.

Recommended interpretation:

- Existing rows where the prompt has no role should default to `category_score` or `legacy_category_score`.
- Old active prompts should be backfilled or logically treated as category prompts.
- Historical top-score displays should continue to work, but should filter to category scoring prompts, not gatekeeper prompts.
- New gatekeeper analytics should only use rows from prompts with role `gatekeeper`.
- New downstream category approval logic should use only category prompt rows from the new gated pipeline, unless Nick intentionally enables an experiment that compares old ungated and new gated behavior.

For reporting, keep two separate concepts:

- **Gatekeeper decision:** should this article proceed to expensive category-specific AI approval?
- **Category approval score:** if proceeded, which CPSC-relevant product hazard category does it match and how strongly?

## Recommended target data model

### Prompt versions

Use the same `AiApproverPromptVersions` table and add explicit classification columns.

Recommended columns:

- `promptRole`: enum/string, values such as `gatekeeper`, `category_score`
- `promptKey`: stable machine name such as `consumer_product_gatekeeper` or `residential_fire`
- `pipelineVersion`: string or integer, such as `ai_approver_gatekeeper_v1`
- `modelName`: nullable string, if Nick wants prompt audit to include the intended model
- `responseSchemaVersion`: nullable string, useful because gatekeeper JSON should differ from score JSON

Why same table:

- Prompt versioning already exists.
- Score rows already reference prompt versions.
- Portal prompt management already understands this table.
- The review-page one-off flow already accepts any prompt version ID.
- A separate prompt table would duplicate lifecycle fields and make prompt management more complicated without enough benefit.

Tradeoff: API and portal prompt-management screens need to expose or at least preserve `promptRole`, so gatekeeper prompts are not accidentally shown as category scoring agents.

### Article results

Prefer keeping `AiApproverArticleScores` as the shared attempt/audit table, with added metadata fields.

Recommended columns:

- `promptRole`: denormalized from prompt at write time, nullable for legacy rows
- `decision`: nullable string, for gatekeeper values such as `pass`, `reject`, `manual_review`, `error`
- `confidence`: nullable float
- `reasonCode`: nullable string, such as `advertisement`, `celebrity`, `crime_no_product`, `politics_no_product`, `non_product_incident`, `cpsc_product_incident`
- `metadata`: JSONB, for structured details such as product terms, hazard terms, injury/death signal, exclusion rationale, token usage, and schema version

Why same result table:

- It preserves the simple article-prompt-result audit model.
- The existing unique `(articleId, promptVersionId)` remains useful.
- It avoids splitting AI attempt history across multiple tables.
- The current API and admin database tooling already includes `AiApproverArticleScore`.

Tradeoff: the table name says "Score", while a gatekeeper emits a decision. This is acceptable short term if `promptRole` and `decision` are explicit. If NewsNexus later adds many non-scoring AI stages, rename or generalize in a larger migration, not now.

### When to use a separate gatekeeper result table

A separate table such as `AiApproverGatekeeperResults` is reasonable only if Nick wants a very strict domain boundary:

- one row per article per gatekeeper pipeline
- explicit pass/reject fields
- no overloaded score table
- simpler SQL for gatekeeper-only dashboards

I do not recommend this as the first implementation because it creates two audit surfaces immediately. It also forces the portal/API to join two result systems and increases migration scope. The same-table approach is lower risk for this project.

## Gatekeeper response contract

The gatekeeper prompt should not return only a numeric score. It should return a compact, structured decision.

Recommended JSON shape:

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

The downstream category prompts can keep their current score/reason shape initially. A later cleanup should standardize all prompt outputs to reduce the current high `invalid_response` rate.

## Orchestration design

Recommended batch flow:

1. Load active gatekeeper prompt version.
2. Load active category prompt versions.
3. Select eligible articles based on article workflow state, state assignment, and prompt-role-specific missing work.
4. For each article, run the gatekeeper if no gatekeeper result exists for the active gatekeeper prompt.
5. If gatekeeper result is `pass`, run category-specific prompts that do not already have rows for that article.
6. If gatekeeper result is `manual_review`, either skip expensive category prompts and surface for human review, or run category prompts in experiment mode only.
7. If gatekeeper result is `reject`, skip category prompts and write no category score rows for that article.
8. Return queue payload counts for pass/reject/manual-review/skipped/category attempts.

The important query change: replace "article has any `AiApproverArticleScores` row" with role-aware checks:

- "article already has the active gatekeeper result"
- "article already has all required active category score rows"
- "article has been approved or manually rejected elsewhere"

Without this change, the first gatekeeper result would block all future category scoring.

## Feature flag and experiment mode

Use a feature flag or request parameter before making the gatekeeper a hard production gate.

Recommended modes:

- `legacy`: current behavior; run all active category prompts for eligible articles.
- `shadow`: run gatekeeper and still run category prompts. Use this to measure what would have been skipped.
- `gatekeeper`: run gatekeeper and only run category prompts for pass decisions.
- `gatekeeper_with_manual_review`: reject hard rejects, run category prompts for pass, and route ambiguous results to review.

Start with `shadow` for a small batch. Move to `gatekeeper_with_manual_review` before `gatekeeper` if false negatives are operationally expensive.

## Historical score interpretation

Historical rows should be labeled as pre-gatekeeper evidence.

Recommended rules:

- Do not backfill gatekeeper decisions from old category scores.
- Do not delete old rows.
- Treat existing prompt rows without `promptRole` as `category_score` by default.
- Add a migration/backfill that sets `promptRole = 'category_score'` for known old prompts.
- Add `pipelineVersion = 'legacy_ungated'` to old prompt rows or infer it from null.
- When computing current top scores, filter to category-score prompts and `resultStatus = 'completed'`.
- When computing gatekeeper pass rate, filter to gatekeeper prompts only.

This keeps historical reports stable while letting new reports explain the new flow accurately.

## Backward compatibility implications

### API

The existing API routes under `api/src/routes/analysis/ai-approver.ts` return prompts, article score details, top scores, and human verification updates.

Required changes when implementing:

- `GET /analysis/ai-approver/prompts` should include prompt role/type fields.
- prompt create/copy/update validation should accept role fields.
- `POST /analysis/ai-approver/top-scores` should exclude gatekeeper rows from top-score selection.
- `GET /analysis/ai-approver/article/:articleId` should either group rows by role or label gatekeeper rows clearly.
- `PATCH /analysis/ai-approver/human-verify/:scoreId` should probably apply only to category-score rows, unless Nick wants a separate human override for gatekeeper decisions.

The API can remain backward compatible by defaulting missing role values to `category_score`.

### Portal

The portal review page currently merges one top AI score onto each article. If gatekeeper rows are inserted into the same score table, the portal must not display a gatekeeper confidence as the article's top approval score.

Recommended portal behavior:

- Show category top score exactly where the current top score appears.
- Add optional gatekeeper status only when useful: passed, rejected, manual review, or not run.
- On prompt-management pages, separate gatekeeper prompts from category prompts or add a role filter.
- On the review modal, group results into "gatekeeper" and "category scores" instead of one flat score list.

### Worker-node orchestrator and reporting

`worker-node/src/modules/orchestrator/reportWriter.ts` currently selects the latest `AiApproverArticleScores.score` by article. That query must become role-aware before gatekeeper rows share the score table.

Recommended report fields:

- `aiGatekeeperDecision`
- `aiGatekeeperReasonCode`
- `aiGatekeeperConfidence`
- `aiApproverTopCategoryScore`
- `aiApproverTopCategoryPrompt`

This avoids a report accidentally showing a gatekeeper confidence as the final AI approver score.

### Queue result payload

Add fields without removing existing ones:

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
- existing token usage totals

This keeps the portal automation UI compatible while giving Nick the cost-reduction signal he needs.

## Migration strategy

Recommended low-risk migration:

1. Add nullable columns to `AiApproverPromptVersions` and `AiApproverArticleScores`.
2. Backfill existing prompt rows to `promptRole = 'category_score'` and `pipelineVersion = 'legacy_ungated'`.
3. Leave existing score rows nullable for new metadata, or backfill `promptRole = 'category_score'` where possible.
4. Update API queries to default null prompt roles to category score.
5. Add the gatekeeper prompt as inactive.
6. Enable shadow mode for a very small batch.
7. Review false negatives manually against category prompt results.
8. Switch to gatekeeper mode only after measuring skip rate and false-negative risk.

Because this repository currently relies heavily on Sequelize model sync rather than formal migrations, Nick should be careful with production schema changes. For this change, explicit migration SQL or a controlled db-manager task would be safer than relying only on `sequelize.sync()`.

## Data retention and auditability

Keep AI approver prompt and score history indefinitely unless a separate retention policy is created for legal or operational reasons. The CPSC-oriented clipping workflow values auditability: article inclusion/exclusion decisions need explanations, prompt versions, timestamps, and human overrides.

Recommended retention rules:

- Never hard-delete prompt versions referenced by score rows.
- End prompts with `isActive = false` and `endedAt`, not deletion.
- Preserve failed and invalid-response rows because they explain missing AI decisions and prompt reliability.
- Preserve gatekeeper rejects because they explain why expensive category prompts did not run.
- Use cleanup jobs only for orphaned test data that Nick explicitly marks as disposable.

## Option evaluation

### Same prompt table with role/type field

Recommendation: yes.

This is the best fit. It extends the existing versioned prompt system, preserves foreign keys, and keeps prompt management in one place.

Tradeoff: prompt-management UI and validation must prevent category and gatekeeper prompts from being mixed accidentally.

### Separate gatekeeper prompt table

Recommendation: no for the first implementation.

It creates duplicate prompt lifecycle management. Use it only if gatekeeper prompts need a fundamentally different approval workflow, ownership model, or release process.

### Same score table with metadata/role

Recommendation: yes, with care.

This keeps all AI attempts in one audit table. The table needs role and decision metadata so portal/API/reporting queries do not confuse gatekeeper decisions with category approval scores.

Tradeoff: the name `AiApproverArticleScores` becomes slightly imprecise because gatekeeper output is a decision, not only a score.

### Separate gatekeeper result table

Recommendation: acceptable but second choice.

It gives cleaner gatekeeper SQL and avoids overloading a score table. It costs more implementation effort and makes audit views span multiple tables.

### Feature flag / experiment mode

Recommendation: required.

The gatekeeper is intended to reduce OpenAI calls, but a false negative could hide an article that CPSC would care about. Shadow mode is the safest way to measure that risk before enforcing skips.

### Delete old data

Recommendation: no.

Deleting old scores destroys audit trail and removes comparison data. The correct fix is role-aware interpretation, not deletion.

## Incremental rollout plan

### Phase 1 - Schema and read compatibility

- Add prompt role/pipeline metadata.
- Add score role/decision/metadata fields or decide on a separate gatekeeper result table.
- Backfill old prompts as category/legacy.
- Update API and report queries so top scores filter to category prompts only.

### Phase 2 - Gatekeeper shadow mode

- Add one inactive gatekeeper prompt.
- Implement role-aware prompt loading.
- Run gatekeeper in shadow mode for small batches.
- Continue category scoring so Nick can compare gatekeeper rejects against category scores.
- Report pass/reject/manual-review counts and estimated calls avoided.

### Phase 3 - Review and threshold tuning

- Sample rejected articles, especially celebrity, crime, politics, advertisement, and non-product stories.
- Track false negatives: articles rejected by gatekeeper but later judged CPSC-relevant by human review or high category scores.
- Adjust prompt wording and decision thresholds.
- Keep low-confidence results in `manual_review` rather than hard reject.

### Phase 4 - Controlled enforcement

- Enable gatekeeper enforcement for one bounded run, such as a limited article ID range or one state set.
- Skip category prompts only for clear gatekeeper rejects.
- Keep review-page one-off scoring able to bypass the gatekeeper for human investigation.
- Keep old legacy reports available.

### Phase 5 - Production default

- Make gatekeeper mode the default batch behavior only after Nick accepts measured precision/recall tradeoffs.
- Keep `legacy` mode available temporarily as a fallback.
- Add dashboard/report columns for calls avoided, gatekeeper reject reasons, and manual-review queue size.

## Assumptions

- The business goal is cost reduction without materially increasing missed CPSC-relevant product incidents.
- Human review remains the final authority for questionable articles.
- Gatekeeper output should be auditable because skipped category prompts are still workflow decisions.
- Existing AI approver scores may already influence portal review and reports, so backward compatibility matters.
- Historical prompt rows can be backfilled or interpreted with defaults, even if formal database migrations are still immature.

## Final architecture position

Nick can safely start the new gatekeeping structure while keeping the old `AiApproverArticleScores`. The architecture should treat the gatekeeper as a new prompt role in the existing AI approver audit system, not as a reason to purge history.

The central rule is: **every AI decision should remain explainable by article, prompt version, role, result, timestamp, job, and human override.** Once queries become role-aware, old scores remain valuable historical evidence and the new gatekeeper can reduce OpenAI calls without breaking auditability or portal review semantics.
