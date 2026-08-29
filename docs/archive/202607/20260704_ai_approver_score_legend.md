---
created_at: 2026-07-04
updated_at: 2026-07-04
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI approver score legend

## Short answer

1. The LLM does not return portal display percentages.
2. Category prompts are expected to return a raw decimal `score` from `0.0` to `1.0`.
   - Example: `0.85` is stored as `0.85`.
   - The portal displays it as `85%`.
3. Gatekeeper prompts do not write a category `score`.
   - They write `decision`, `confidence`, `reason`, `reasonCode`, and optional `signals`.
   - `confidence` is also a raw decimal from `0.0` to `1.0`.
4. The portal converts decimals to percentages only for display.
   - `Math.round(score * 100)` becomes the score badge.
   - `Math.round(confidence * 100)` appears in gatekeeper titles/details.
5. Category scores rely on the prompt contract to stay in the `0` to `1` range.
   - The current category parser accepts any numeric score and stores it.
   - The portal clamps category score display to `0` through `100%`.
   - Gatekeeper confidence is stricter: values outside `0` through `1` become `invalid_response`.

## Gatekeeper method legend

1. Gatekeeper purpose:
   - The gatekeeper is a first-pass router.
   - It decides whether an article should continue to downstream category scoring.
   - It is not final article approval, duplicate review, state assignment, report inclusion, or CPSC jurisdiction judgment.

2. Gatekeeper output fields:
   - `decision`: one of `pass`, `reject`, or `manual_review`.
   - `confidence`: decimal confidence from `0.0` to `1.0`.
   - `reason`: short explanation.
   - `reasonCode`: optional short machine-readable reason.
   - `signals`: optional structured evidence such as product, hazard, injury, ad, celebrity, crime, or politics signals.

3. `pass`:
   - Meaning: the article plausibly belongs in the consumer-product-safety review stream.
   - In `gatekeeper` mode: category prompts run.
   - In `gatekeeper_with_manual_review` mode: category prompts run.
   - In `shadow` mode: category prompts run no matter what, so `pass` is observational.
   - Portal review table fallback badge: `GK` when there is a gatekeeper result but no eligible category score yet.

4. `manual_review`:
   - Meaning: the article is ambiguous, incomplete, missing enough content, or the model is unsure.
   - The prompt is designed for high recall, so uncertain consumer-product cases should go here instead of being rejected.
   - In `gatekeeper` mode: category prompts are skipped.
   - In `gatekeeper_with_manual_review` mode: currently the same as `gatekeeper`; category prompts are skipped.
   - In `shadow` mode: category prompts still run.
   - Portal review table fallback badge: `Review`.

5. `reject`:
   - Meaning: the article is clearly outside the consumer-product-safety review stream.
   - Strong reject examples include ads, coupons, product reviews with no incident, product launches with no incident, celebrity news, politics, finance, ordinary crime, ordinary traffic crashes, workplace-only incidents, medical-only stories, environmental stories, or weather stories with no consumer-product angle.
   - In `gatekeeper` mode: category prompts are skipped.
   - In `gatekeeper_with_manual_review` mode: category prompts are skipped.
   - In `shadow` mode: category prompts still run.
   - Portal review table fallback badge: `Reject`.

6. Reject confidence threshold:
   - Default threshold: `0.85`.
   - Config value: `AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD`.
   - Batch request override: `gatekeeperRejectConfidenceThreshold`.
   - If the model returns `decision = "reject"` with confidence below the threshold, the worker changes it to `manual_review`.
   - This keeps low-confidence rejects from blocking category scoring as hard rejects.

7. `invalid_response`:
   - Meaning: the LLM returned JSON, but not the required gatekeeper shape.
   - Common causes: missing `decision`, unsupported decision value, missing `confidence`, confidence outside `0` through `1`, missing non-empty `reason`, or malformed field types.
   - Portal review table fallback badge: `Err` if no eligible category score exists.

8. `failed`:
   - Meaning: the worker hit an execution error while calling or parsing the LLM response.
   - Portal review table fallback badge: `Err` if no eligible category score exists.

## Latest operating modes

1. Prompt role options:
   - `gatekeeper`: router prompt that writes decision/confidence, not category score.
   - `category_score`: current normal scoring prompt that writes a numeric `score`.
   - `legacy_category_score`: older scoring prompt role that is still treated as category scoring.
   - Only one gatekeeper prompt should be active at a time.
   - Gatekeeper prompts are created inactive first, then explicitly activated.

2. `legacy`:
   - Default if `AI_APPROVER_MODE` and request `mode` are not set.
   - Runs active category prompts only.
   - Does not require or run a gatekeeper prompt.

3. `shadow`:
   - Runs the active gatekeeper prompt.
   - Runs category prompts regardless of the gatekeeper decision.
   - Best mode for observing gatekeeper behavior without changing category score coverage.

4. `gatekeeper`:
   - Runs the active gatekeeper prompt first.
   - Runs category prompts only when the gatekeeper completed with `decision = "pass"`.
   - Skips category prompts for `reject`, `manual_review`, `invalid_response`, and `failed`.

5. `gatekeeper_with_manual_review`:
   - Currently behaves like `gatekeeper`.
   - Despite the name, `manual_review` does not currently run category prompts.
   - Treat it as a reserved mode name until a separate manual-review workflow is implemented.

6. Weekly automation:
   - Worker-node does not currently send a mode override when it calls worker-python.
   - Weekly runs use `AI_APPROVER_MODE` from `worker-python/.env`.

## Portal review page legend

1. Percent badge, such as `85%`:
   - The API found an eligible non-gatekeeper category score.
   - Eligible means `resultStatus = "completed"`, numeric `score`, and not human-rejected.
   - The table uses the top eligible category score, ordered by highest score.
   - Gatekeeper results may still exist, but the table shows the category percent first.

2. `N/A`:
   - No eligible category score was returned.
   - No gatekeeper result was returned for the article.
   - This does not prove the article is bad or unscreened; it only means the review table has no displayable AI approver row.
   - Common causes include:
     1. The AI approver did not process the article yet.
     2. A batch limit or article ID cursor did not reach the article.
     3. `requireStateAssignment` was true and the article lacked a valid AI state assignment.
     4. The article was already approved or marked not relevant, so batch selection skipped it.
     5. No active category prompt existed.
     6. A category run failed or returned `invalid_response`.
     7. In gatekeeper mode, the gatekeeper did not pass, so no category score was created.

3. `Review`:
   - A gatekeeper row exists.
   - The latest gatekeeper decision is `manual_review`.
   - There is no eligible category score for the table to show.

4. `Reject`:
   - A gatekeeper row exists.
   - The latest gatekeeper decision is `reject`.
   - There is no eligible category score for the table to show.

5. `GK`:
   - A gatekeeper row exists.
   - There is no eligible category score for the table to show.
   - Most often this means the gatekeeper decision was `pass`, or the table only knows that gatekeeper analysis exists.
   - Open the AI Approver details modal to see the exact decision, confidence, reason, and prompt row.

6. `Err`:
   - A gatekeeper row exists.
   - The gatekeeper status is `failed` or `invalid_response`, or the decision is `error`.
   - There is no eligible category score for the table to show.

7. `0`:
   - Possible table fallback when a category analysis ID exists but no numeric score is present.
   - This should be uncommon with the current top-score API, because that API filters for completed numeric category scores.
   - Treat it as a reason to open the details modal and inspect `resultStatus`, `score`, `errorCode`, and `errorMessage`.

## Details modal legend

1. Gatekeeper Results:
   - Gatekeeper rows are separated from category score rows.
   - Gatekeeper rows normally show `GK` instead of a percent because `score` is `null`.
   - The decision and confidence appear beside the prompt/status details.

2. Category Scores:
   - Category rows show percent badges when `score` is numeric.
   - Category rows show `N/A` in the modal when the category score is missing.
   - Human-rejected category scores are not eligible for the review table top-score badge.

3. Failed or invalid rows:
   - These rows remain visible in details.
   - Check `resultStatus`, `errorCode`, and `errorMessage` before assuming the article was never processed.

## Legacy inputs and imported data

1. `legacy_category_score`:
   - Old category prompts or restored prompt rows may use this role.
   - The worker still treats `legacy_category_score` as a category prompt.
   - The portal top-score API can still use it if the row is completed, numeric, and not human-rejected.

2. Missing prompt role:
   - Older rows without `promptRole` are treated as `category_score` by repository/API fallbacks.

3. Old gatekeeper score fallback:
   - Older planning notes mentioned mapping score ranges to gatekeeper outcomes.
   - The current gatekeeper parser expects `decision` and `confidence`.
   - A gatekeeper prompt that only returns `score` and `reason` will now be `invalid_response`.

4. Suspicious 100% scores:
   - Category score rows should be decimals like `0.85`, not whole percentages like `85`.
   - If old/imported data contains `85`, the portal clamps display to `100%`.
   - Audit the raw `AiApproverArticleScores.score` value when a legacy row looks too high.

## Source files checked

1. `worker-python/src/modules/ai_approver/orchestrator.py`
2. `worker-python/src/modules/ai_approver/config.py`
3. `worker-python/src/routes/ai_approver.py`
4. `worker-python/docs/prompts/AI_APPROVER_GATEKEEPER_CONSUMER_PRODUCT_V1.md`
5. `api/src/routes/analysis/ai-approver.ts`
6. `portal/src/app/(dashboard)/articles/review/page.tsx`
7. `portal/src/components/tables/TableReviewArticles.tsx`
8. `portal/src/components/ui/modal/ModalAiApproverDetails.tsx`
