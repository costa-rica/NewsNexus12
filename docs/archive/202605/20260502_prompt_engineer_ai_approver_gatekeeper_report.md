# 2026-05-02 Prompt Engineer Report - AI Approver Gatekeeper

## Executive recommendation

Nick should add a gatekeeper step before the existing category-specific AI approver prompts, but the gatekeeper should be a high-recall router, not a final CPSC eligibility judge.

The current `worker-python` AI approver batch flow runs every active `AiApproverPromptVersions` row against every eligible article. As documented in `worker-python/docs/20260502_ai_approver_flow_report.md`, there were 11 active scoring agents at query time. That means one eligible article can trigger 11 OpenAI calls before a human ever sees the result. A single gatekeeper call can reduce total calls whenever it filters more than a small fraction of articles:

```text
current calls per article = 11
gatekeeper calls per article = 1 + (11 * pass_rate)
```

If the gatekeeper passes 25% of articles downstream, the system moves from 11 calls/article to 3.75 calls/article, about a 66% call-count reduction. If it passes 50%, the system still saves about 45%. The approach stops being useful only when almost every article passes or when the gatekeeper prompt is so long that token cost and latency erase the savings.

The right design is conservative:

- Use the gatekeeper to reject obvious non-product and non-incident stories.
- Pass through clear consumer-product hazard/injury/death stories.
- Route ambiguous stories to downstream prompts or manual review instead of dropping them.
- Keep final category scoring, severity interpretation, duplicate handling, state assignment, and human approval outside the gatekeeper.

The main product tradeoff is simple: API cost reduction comes from skipping downstream prompts, but contract risk comes from false negatives. For NewsNexus12/CPSC screening, the gatekeeper should be tuned to protect recall even if that means letting some weak articles through.

## Assumptions

- NewsNexus12 is supporting a CPSC-oriented clipping workflow for consumer-product-related deaths, injuries, and hazards.
- Current AI approver scores are advisory and reviewable, not authoritative final contract decisions.
- The existing batch AI approver selects eligible articles from `Articles` and `ArticleContents02`, then runs every active prompt against every selected article.
- The existing OpenAI client expects JSON with numeric `score` and non-empty `reason`; richer JSON requires a code/schema change.
- Human review remains available for uncertain or high-impact cases.
- The gatekeeper should reduce calls to category-specific prompts, not reduce article ingestion, scraping, dedupe, state assignment, or final human judgment.

## What the gatekeeper should decide

The gatekeeper should answer one narrow operational question:

> Is this article worth spending category-specific AI approver calls on because it plausibly describes a consumer product involved in a hazard, injury, death, fire, burn, poisoning, mechanical incident, electrical incident, child-product incident, sports/recreation incident, household incident, or other CPSC-relevant product safety event?

It should classify the article into one of three routing outcomes:

| Outcome | Meaning | Next action |
| --- | --- | --- |
| `pass_downstream` | Clear or plausible consumer-product safety incident | Run existing category prompts |
| `manual_review` | Ambiguous, incomplete, or potentially important but not clear enough | Either run downstream prompts or place in a human queue |
| `reject_gatekeeper` | Clearly outside product-safety screening scope | Skip category prompts |

The gatekeeper should reject only when the article is clearly outside scope. Examples:

- Advertisement, sale, coupon, buying guide, product launch, SEO shopping page, press release without incident.
- Celebrity, entertainment, sports score, finance, politics, election, opinion, or general crime story with no product hazard.
- Crime, assault, shooting, terrorism, drug trafficking, domestic violence, or police blotter story where the injury source is not a consumer product.
- General weather, wildfire, traffic, workplace, industrial, medical, or environmental story with no consumer product involvement.
- Non-incident product mentions such as "best strollers of 2026" or "company recalls earnings forecast."

It should pass or route uncertain articles when any plausible product incident exists. Examples:

- Fire, explosion, burn, smoke, or carbon monoxide story mentioning a heater, stove, appliance, battery, charger, generator, grill, candle, fireplace, furniture, toy, vehicle-adjacent consumer device, or household item.
- Child injury or death involving crib, stroller, toy, pool, high chair, furniture tip-over, button battery, magnet, or nursery product.
- Electrical shock, electrocution, battery fire, charger fire, e-bike/scooter battery fire, appliance malfunction, extension cord, or power tool incident.
- Mechanical injury involving a consumer tool, appliance, recreational equipment, sports equipment, ladder, mower, ATV/UTV, playground equipment, or similar product.
- Poisoning, chemical exposure, burn, ingestion, or inhalation involving household chemicals, cleaning products, pesticides, fuel, consumer containers, batteries, or similar products.

## What the gatekeeper should not decide

The gatekeeper should not own decisions that require deeper classification, cross-record context, or human accountability:

- Final article approval for CPSC delivery.
- Final CPSC jurisdiction determination.
- Exact category prompt selection if the current architecture still benefits from multiple category scores.
- Injury severity, death count, product taxonomy, hazard pattern, incident date, or synopsis extraction.
- State assignment or publication-state versus incident-state resolution.
- Duplicate detection.
- Whether the article satisfies the 180-day requirement.
- Whether a clip should be included in a weekly PDF/Excel report.
- Whether a human reviewer should approve, reject, or override an article.

It also should not try to be too clever about exclusions. If the article is about a house fire and the cause is unknown, the gatekeeper should not reject merely because a product is not named. Those articles are common places where downstream prompts or humans may identify a stove, appliance, heater, battery, generator, candle, or other product later.

## Recommended scope

Use a two-layer responsibility model:

1. **Gatekeeper:** broad CPSC/product-safety plausibility and obvious-trash filtering.
2. **Category prompts:** category-specific scoring and reasoning for residential fire, electrical shock, fire/burn, mechanical, household, chemical, sports/recreation, children's products, and future categories.
3. **Humans:** final acceptance, quality control, edge cases, and contract-facing decisions.

The gatekeeper should be short, stable, and recall-biased. Do not ask it to produce a full product taxonomy or extract every incident field. That increases prompt length, cognitive load, latency, and the odds of brittle decisions.

## Input design

The minimum current input is compatible with the existing prompt substitution system:

- `{articleTitle}`
- `{articleContent}`

The better future input should add fields already available or likely easy to provide:

- `articleId`
- `articleTitle`
- `articleDescription`
- `articleContent`
- `articleUrl`
- `sourceName` or publication name
- `publishedAt`
- `stateAssignment`, if available
- `contentSource` such as `article-contents-02`, `article-description`, or `none`

Recommended content handling:

- Send title and description always.
- Send article body when available, but cap body length to control latency and cost.
- Prefer a deterministic truncation strategy such as first 4,000 to 6,000 characters plus title/description.
- If content is empty or extremely short, bias to `manual_review` unless the title is clearly out of scope.

## Output schema

### Future preferred schema

Use this schema when the worker can persist richer gatekeeper results in a dedicated table or a new prompt-role-aware score shape:

```json
{
  "route": "pass_downstream",
  "confidence": 0.86,
  "consumer_product_signal": "clear",
  "incident_signal": "clear",
  "injury_or_hazard_signal": "clear",
  "primary_reason": "Article describes a child injured by a recalled stroller collapse.",
  "product_mentions": ["stroller"],
  "hazard_mentions": ["collapse", "injury"],
  "exclusion_reason": null,
  "needs_human_review": false
}
```

Field semantics:

| Field | Type | Allowed values |
| --- | --- | --- |
| `route` | string | `pass_downstream`, `manual_review`, `reject_gatekeeper` |
| `confidence` | number | 0.0 to 1.0 confidence in the route |
| `consumer_product_signal` | string | `clear`, `plausible`, `absent`, `unclear` |
| `incident_signal` | string | `clear`, `plausible`, `absent`, `unclear` |
| `injury_or_hazard_signal` | string | `clear`, `plausible`, `absent`, `unclear` |
| `primary_reason` | string | Short explanation |
| `product_mentions` | string array | Products or product-like items named in the article |
| `hazard_mentions` | string array | Injury, death, fire, burn, poisoning, shock, mechanical, chemical, or other hazard signals |
| `exclusion_reason` | string or null | Why a clear rejection was made |
| `needs_human_review` | boolean | True for ambiguous or high-risk cases |

### Current-table compatible schema

The current `AiApproverArticleScores` parser only accepts:

```json
{
  "score": 0.0,
  "reason": "Brief explanation."
}
```

If the gatekeeper must be inserted into `AiApproverPromptVersions` before code changes, use score bands as routing semantics:

| Score range | Route | Meaning |
| --- | --- | --- |
| `0.80` to `1.00` | `pass_downstream` | Strong product-safety incident signal |
| `0.45` to `0.79` | `manual_review` or pass by default | Ambiguous but plausible |
| `0.00` to `0.44` | `reject_gatekeeper` | Clearly out of scope |

The `reason` should begin with one of these route labels:

```text
route=pass_downstream
route=manual_review
route=reject_gatekeeper
```

This is not ideal because routing is encoded in text, but it can support prompt experiments before a schema migration.

## Threshold recommendation

For production gating, use conservative defaults:

- Run downstream prompts when `route = pass_downstream`.
- Run downstream prompts when `route = manual_review` during the first tuning phase.
- Skip downstream prompts only when `route = reject_gatekeeper` and `confidence >= 0.85`.
- If using current score-only output, skip only when `score <= 0.25` during initial rollout.
- Never skip when the article mentions death, child injury, fire, explosion, electrocution, carbon monoxide, poisoning, battery fire, product recall, "malfunction", "defect", "appliance", "generator", "heater", "stove", "crib", "stroller", "toy", or similar high-value terms unless the context is clearly irrelevant.

After validation, Nick can consider a stronger cost-saving threshold:

- Skip when `route = reject_gatekeeper` and `confidence >= 0.75`.
- Or skip when score-only gatekeeper output is `score <= 0.35`.

I would not start there. The first deployment should measure recall and build trust.

## Guardrails against false negatives

The prompt should explicitly state these guardrails:

- When uncertain, choose `manual_review`, not rejection.
- Missing article body is not enough to reject.
- Unknown cause of a fire, injury, or death is not enough to reject.
- Product not named in the title is not enough to reject if body hints at household, consumer, child, recreation, electrical, fire, chemical, or mechanical context.
- Crime or politics stories can be rejected only when the injury source is clearly non-product.
- Workplace or industrial stories can be rejected only when there is no ordinary consumer product or household/recreational product angle.
- Vehicle stories should usually be rejected for ordinary crashes, but battery fires, child seats, ATVs, scooters, e-bikes, recreational vehicles, chargers, or consumer accessories should pass or route to review.
- Medical stories should usually be rejected unless the article describes a consumer product, household product, toy, recreational product, chemical, battery, or appliance causing the harm.

## Draft gatekeeper prompt for future richer JSON

```markdown
# AI Approver Gatekeeper - Consumer Product Safety Router

You are the first-pass routing agent for NewsNexus12, a CPSC-oriented news screening workflow.

Your job is not to approve the article. Your job is to decide whether this article is worth sending to more expensive category-specific AI approver prompts.

## Routing goal

Route the article based on whether it plausibly describes a consumer product involved in a hazard, injury, death, fire, burn, poisoning, electrical incident, mechanical incident, child-product incident, sports/recreation incident, household incident, chemical exposure, or other product-safety event.

Use high recall. False negatives are worse than false positives. If you are unsure, choose `manual_review`.

## Strong pass signals

Pass or review articles involving:

- consumer products, household products, appliances, furniture, tools, toys, nursery products, sports/recreation products, batteries, chargers, generators, heaters, stoves, grills, candles, pools, ladders, mowers, playground equipment, scooters, e-bikes, ATVs/UTVs, household chemicals, pesticides, fuels, containers, magnets, or button batteries
- death, injury, burn, fire, explosion, smoke inhalation, carbon monoxide, poisoning, electric shock, electrocution, fall, crushing, choking, drowning, ingestion, laceration, amputation, entrapment, malfunction, defect, recall, or warning
- house fires or residential incidents where a consumer product cause is plausible even if not confirmed
- child injuries or deaths where a consumer product may be involved

## Strong rejection signals

Reject only when clearly outside scope:

- advertisement, coupon, shopping guide, product review, product launch, sponsored content, or press release with no safety incident
- celebrity, entertainment, sports score, finance, politics, election, opinion, or general community story with no product hazard
- general crime, assault, shooting, terrorism, drugs, police chase, domestic violence, or court story where the injury source is not a consumer product
- ordinary traffic crash with no consumer product, recreational product, battery, charger, child seat, or product-defect angle
- workplace, industrial, medical, environmental, or weather story with no ordinary consumer product angle

## Important guardrails

- Do not reject because the title alone lacks a product if the content suggests a plausible product incident.
- Do not reject an unknown-cause house fire, explosion, poisoning, or child injury solely because the exact product is not identified.
- Do not make a final CPSC jurisdiction decision.
- Do not classify the exact downstream category.
- Do not decide final article approval.
- If article content is missing or too short, choose `manual_review` unless the title is clearly out of scope.

## Article input

Title:
{articleTitle}

Content:
{articleContent}

## Output

Return JSON only. Do not include markdown or commentary.

Schema:

{
  "route": "pass_downstream | manual_review | reject_gatekeeper",
  "confidence": 0.0,
  "consumer_product_signal": "clear | plausible | absent | unclear",
  "incident_signal": "clear | plausible | absent | unclear",
  "injury_or_hazard_signal": "clear | plausible | absent | unclear",
  "primary_reason": "one short sentence",
  "product_mentions": ["product or product-like terms"],
  "hazard_mentions": ["hazard or injury terms"],
  "exclusion_reason": "short reason or null",
  "needs_human_review": true
}
```

## Draft gatekeeper prompt compatible with current score/reason parser

This version can be inserted into `AiApproverPromptVersions.promptInMarkdown` for offline or review-page experiments because it returns only `score` and `reason`.

```markdown
# AI Approver Gatekeeper - Current Score Schema

You are the first-pass routing agent for NewsNexus12, a CPSC-oriented news screening workflow.

Your task is to score whether this article should be sent to downstream category-specific AI approver prompts.

Use high recall. False negatives are worse than false positives. If the article might involve a consumer product safety incident, give a score high enough to keep it.

## Score meaning

- 0.80 to 1.00: clear consumer-product safety incident; send downstream
- 0.45 to 0.79: ambiguous but plausible; send downstream or manual review
- 0.00 to 0.44: clearly outside product-safety screening scope; safe to skip downstream prompts

## Keep high or medium scores for articles involving

- consumer products, household products, appliances, furniture, tools, toys, nursery products, sports/recreation products, batteries, chargers, generators, heaters, stoves, grills, candles, pools, ladders, mowers, playground equipment, scooters, e-bikes, ATVs/UTVs, household chemicals, pesticides, fuels, containers, magnets, or button batteries
- death, injury, burn, fire, explosion, smoke inhalation, carbon monoxide, poisoning, electric shock, electrocution, fall, crushing, choking, drowning, ingestion, laceration, amputation, entrapment, malfunction, defect, recall, or warning
- house fires or residential incidents where a consumer product cause is plausible even if not confirmed
- child injuries or deaths where a consumer product may be involved

## Give low scores only for articles clearly outside scope

- advertisement, coupon, shopping guide, product review, product launch, sponsored content, or press release with no safety incident
- celebrity, entertainment, sports score, finance, politics, election, opinion, or general community story with no product hazard
- general crime, assault, shooting, terrorism, drugs, police chase, domestic violence, or court story where the injury source is not a consumer product
- ordinary traffic crash with no consumer product, recreational product, battery, charger, child seat, or product-defect angle
- workplace, industrial, medical, environmental, or weather story with no ordinary consumer product angle

## Guardrails

- Do not reject because the title alone lacks a product if the content suggests a plausible product incident.
- Do not reject an unknown-cause house fire, explosion, poisoning, or child injury solely because the exact product is not identified.
- If article content is missing or too short, use a medium score unless the title is clearly out of scope.
- Do not decide final approval, exact CPSC jurisdiction, duplicate status, state, or report inclusion.

## Article

Title:
{articleTitle}

Content:
{articleContent}

## Output

Return JSON only in this exact shape:

{
  "score": 0.0,
  "reason": "route=<pass_downstream|manual_review|reject_gatekeeper>; short explanation with key product/hazard signal or exclusion reason"
}
```

## Failure modes

1. **False negatives on sparse articles.** Titles may omit the product or cause. A short article about a fatal house fire could be product-relevant later. Mitigation: short/empty content routes to `manual_review`, not rejection.

2. **False negatives on general fire/crime wording.** Articles about residential fires, child deaths, or explosions may look like general local news. Mitigation: force pass/review for high-value hazard terms unless clearly irrelevant.

3. **Over-rejection of vehicle-adjacent cases.** Ordinary traffic crashes are usually poor candidates, but e-bikes, scooters, batteries, chargers, child seats, ATVs, and recreational products may matter. Mitigation: explicit vehicle guardrail.

4. **Over-rejection of workplace stories.** Industrial incidents are often outside CPSC scope, but consumer tools or products may appear in workplace settings. Mitigation: reject workplace stories only when no ordinary consumer product angle exists.

5. **Prompt drift from broad responsibility.** If the gatekeeper is asked to determine category, severity, product taxonomy, jurisdiction, and report inclusion, it will become longer, slower, and less reliable. Mitigation: keep it to routing.

6. **Output shape failures.** The current flow has high `invalid_response` counts for existing prompts. Mitigation: use JSON-only instructions, simpler schema, lower temperature, and automated validation before gating production calls.

7. **Cost moves instead of disappears.** A long gatekeeper prompt with full article bodies can still be expensive. Mitigation: keep the prompt short and cap content length.

8. **Historical scores become incomparable.** Articles scored before and after gatekeeping have different prompt exposure. Mitigation: store gatekeeper result separately or mark prompt role/version clearly.

## Evaluation plan

Evaluate the gatekeeper offline before using it as a hard production skip.

Recommended dataset:

- Previously human-approved articles.
- Previously human-rejected articles, including CPSC rejections if available.
- Articles with high downstream AI approver scores.
- Articles with low or invalid downstream scores.
- Known advertisements, celebrity stories, general crime, politics, and non-product stories.
- Ambiguous house fire, child injury, battery, chemical, electrical, and recreation cases.

Suggested labels:

- `should_run_downstream = true`
- `should_run_downstream = false`
- `human_uncertain = true`
- optional reason tags such as `ad`, `crime_no_product`, `house_fire_unknown_cause`, `child_product`, `battery_fire`, `ordinary_vehicle_crash`

Primary metrics:

- False negative rate against human-approved articles.
- Recall on high-value categories: deaths, child injuries, fires/explosions, CO/poisoning, electrical/battery incidents.
- Downstream-call reduction.
- Manual-review volume.
- Cost per accepted clip.
- Token usage per article.

Recommended launch gates:

- At least 98-99% recall on historically approved articles before hard skipping.
- 100% recall target on death, child injury, fire/explosion, carbon monoxide, poisoning, and electrocution samples unless a human confirms a safe exclusion.
- Demonstrated call-count reduction of at least 30% on a representative batch.
- Invalid JSON rate near zero before the result controls routing.

## Tuning with historical data

1. Build a historical evaluation table or CSV with article id, title, content excerpt, human outcome, current AI scores, and final delivery/rejection status.
2. Run the gatekeeper in shadow mode. Store results, but do not skip downstream prompts.
3. Compare gatekeeper `reject_gatekeeper` results against any article that humans approved or downstream prompts strongly favored.
4. Inspect every false negative candidate manually and add prompt guardrails only for recurring patterns.
5. Track pass rate by source, state, category, and content source. A source with many empty articles may need different handling.
6. Tune thresholds before tuning prose. First adjust skip threshold; only rewrite the prompt when errors cluster around a missing rule.
7. Promote to soft gating: skip only high-confidence obvious rejects, while sending `manual_review` and `pass_downstream` to existing prompts.
8. Re-evaluate weekly for the first month because news mix changes by source and season.

## Implementation recommendations for Nick

- Start with shadow mode. Run the gatekeeper and existing prompts, then compare before skipping any calls.
- Add a prompt role or separate gatekeeper table before production routing. Reusing `AiApproverPromptVersions` without a role risks mixing the gatekeeper with category agents.
- Store gatekeeper outputs separately from category scores or make `AiApproverArticleScores` role-aware. The current unique index on `(articleId, promptVersionId)` is fine per prompt, but the meaning of `score` changes by prompt role.
- Add queue result counters: `gatekeeperPassCount`, `gatekeeperManualReviewCount`, `gatekeeperRejectCount`, `downstreamAttemptCount`, and `downstreamSkippedCount`.
- Keep review-page one-off scoring able to bypass the gatekeeper. Humans should be able to run a specific prompt on a specific article.
- Treat `manual_review` as pass-through during early rollout. After measurement, Nick can decide whether manual-review articles need all prompts, selected prompts, or a cheaper human queue.
- Fix prompt output reliability before relying on automated routing. The current historical `invalid_response` volume means strict JSON validation and simpler prompts matter.
- Prefer a shorter gatekeeper prompt plus deterministic thresholds over a long prompt that tries to imitate all downstream agents.

## Practical next step

The best next experiment is not a full architecture change. It is a 200-500 article shadow evaluation:

1. Insert or run the current-table-compatible gatekeeper prompt as inactive/manual or in a small standalone experiment.
2. Sample articles across approved, rejected, high-score, low-score, and obvious-trash groups.
3. Measure how many downstream calls would have been skipped at thresholds `0.25`, `0.35`, and `0.45`.
4. Manually inspect every article the gatekeeper would skip but humans or existing prompts considered promising.
5. Choose the first production threshold only after the false-negative review.

My recommendation is to launch with hard skipping only for `score <= 0.25` or `route = reject_gatekeeper` with confidence at least `0.85`. That should remove advertisements and clearly irrelevant stories while keeping the gatekeeper from silently discarding uncertain CPSC-relevant incidents.
