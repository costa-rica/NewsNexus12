# Orchestrator Abbreviated Test Run Plan

Date: 2026-05-01

## Goal

Add a development/testing-only portal button that starts an abbreviated orchestrator run:

1. Delete 100 eligible articles.
2. Run Google RSS ingestion only until at least 10 new articles are collected.
3. Run downstream orchestration steps against that abbreviated article set.
4. Preserve the normal weekly orchestrator behavior unchanged for production runs.

This is meant as an end-to-end shakedown for obvious orchestration errors without spending the hours a full weekly run can take.

## Feasibility

This is feasible and fits the current implementation.

The current orchestrator already has:

- a `worker-node` coordinator in `worker-node/src/modules/orchestrator/coordinator.ts`
- start/list/detail/cancel/report routes in `worker-node/src/routes/orchestrator.ts`
- an API proxy in `api/src/routes/automations/orchestrator.ts`
- a portal section in `portal/src/components/automations/OrchestratorSection.tsx`
- a queue-backed delete job that already accepts `trimCount`
- state-assigner targeting by article ID range and count
- semantic-scorer targeting by article ID range
- run-level article ID cursors captured around the Google RSS step

The main missing capability is that Google RSS currently runs through the spreadsheet until completion, cancellation, error, or rate limiting. It reports `articlesAddedCount`, but it does not accept a target such as "stop once at least 10 articles have been added."

## Difficulty

Estimated difficulty: moderate.

Expected scope is roughly 1-2 focused engineering days, assuming the recent orchestration fix is stable and worker-python AI approver accepts or can be made to accept the same article range/count contract. The worker-node pieces are straightforward; the riskiest part is making sure all child job request bodies receive the abbreviated targeting config consistently.

## Important Current-Code Notes

- `DeleteArticlesJobInput.trimCount` already supports deleting a fixed number of eligible articles. The abbreviated run can pass `{ trimCount: 100 }` to `/delete-articles/start-job`.
- `RequestGoogleRssJobInput` currently only contains `spreadsheetPath` and `doNotRepeatRequestsWithinHours`. Add a `targetArticlesAddedCount?: number` or `stopAfterArticlesAdded?: number` field.
- `runLegacyWorkflow` in `requestGoogleRssJob.ts` increments `articlesAddedCount` after each RSS query. The stop check should happen immediately after incrementing the count so a run can finish after the request that crosses 10 articles.
- The orchestrator currently starts every child with an empty body in `startChildJob`. That needs to become step-aware so abbreviated mode can pass per-step bodies.
- State assigner should receive:
  - `articleIdMinExclusive`
  - `articleIdMaxInclusive`
  - `targetArticleStateReviewCount: 10`
  - normal threshold/default fields
- Semantic scorer should receive the same article ID range.
- AI approver needs the same article ID range and/or article count if it is included in the abbreviated flow.

## Proposed API Shape

Keep the existing production start body working:

```json
{
  "aiApproverEnabled": true,
  "semanticScorerEnabled": true
}
```

Add a run mode and optional test config:

```json
{
  "mode": "abbreviated_test",
  "aiApproverEnabled": true,
  "semanticScorerEnabled": true,
  "testConfig": {
    "deleteTrimCount": 100,
    "targetArticlesAddedCount": 10,
    "downstreamArticleCount": 10,
    "doNotRepeatRequestsWithinHours": 0
  }
}
```

Defaults for `abbreviated_test` should be server-side:

- `deleteTrimCount: 100`
- `targetArticlesAddedCount: 10`
- `downstreamArticleCount: 10`
- shorter step timeouts than production
- `doNotRepeatRequestsWithinHours: 0` only if we intentionally want fresh test runs to re-query spreadsheet rows; otherwise keep the production default

Production mode should ignore these fields unless `mode === "abbreviated_test"`.

## Implementation Plan

### Phase 1 - Extend Orchestrator Config

- Add `mode?: "weekly" | "abbreviated_test"` to `OrchestratorConfig`.
- Add `testConfig` with validated numeric fields.
- Persist the mode/config in existing run metadata if the db model already supports it, or at minimum include the mode in step result JSON so past runs are distinguishable.
- Validate that `abbreviated_test` can only start when server environment permits it. Suggested condition:
  - `NODE_ENV !== "production"`, or
  - explicit worker env flag such as `ALLOW_ORCHESTRATOR_TEST_RUNS=true`

Do not rely only on `NEXT_PUBLIC_MODE`; portal hiding is UX, not access control.

### Phase 2 - Add RSS Stop Condition

- Extend `RequestGoogleRssJobInput` and route validation with `targetArticlesAddedCount?: number`.
- Add result ending reason such as `target_articles_collected`.
- In `runLegacyWorkflow`, after `articlesAddedCount += savedThisRequest`, check:

```ts
if (
  context.targetArticlesAddedCount !== undefined &&
  articlesAddedCount >= context.targetArticlesAddedCount
) {
  endingReason = "target_articles_collected";
  endingMessage = `Collected ${articlesAddedCount} articles, meeting target ${context.targetArticlesAddedCount}.`;
  break;
}
```

- Add route and job tests for:
  - valid target count is passed into the job handler
  - workflow stops after target is met
  - result includes the new ending reason and count

### Phase 3 - Make Child Step Bodies Configurable

- Replace the current empty-body behavior in `startChildJob`/coordinator with a helper such as `buildStepRequestBody(stepConfig, runContext)`.
- For abbreviated mode:
  - delete step body: `{ trimCount: 100 }`
  - Google RSS body: `{ targetArticlesAddedCount: 10, doNotRepeatRequestsWithinHours: ... }`
  - state assigner body: article ID cursor range plus `targetArticleStateReviewCount: 10`
  - semantic scorer body: article ID cursor range
  - AI approver body: article ID cursor range/count if supported
- For weekly mode, keep current behavior except for already-required downstream cursor propagation if that is part of the recent fix.

### Phase 4 - Portal Test Button

- In `OrchestratorSection.tsx`, compute:

```ts
const canShowTestRun =
  process.env.NEXT_PUBLIC_MODE === "development" ||
  process.env.NEXT_PUBLIC_MODE === "testing";
```

- Add a secondary button next to `Start Orchestrator`, visible only when `canShowTestRun`.
- Button label: `Start Test Run`
- POST the abbreviated body to `/automations/orchestrator/start`.
- Disable it while starting or while a run is active, same as the production start button.
- Surface mode in the active run panel/past runs if the API exposes it.

### Phase 5 - API Proxy

- The API proxy can mostly pass the body through unchanged.
- Add tests only if existing API tests cover orchestrator start bodies; otherwise worker-node route tests are the higher-value coverage.

### Phase 6 - Verification

Run targeted tests:

```bash
cd worker-node && npm test -- requestGoogleRssJob
cd worker-node && npm test -- orchestrator
cd worker-node && npm test -- requestGoogleRss
cd portal && npm run lint
```

Then run one manual dev/test orchestration:

1. Start db-models, api, portal, worker-node, and worker-python.
2. Set portal `NEXT_PUBLIC_MODE=development` or `testing`.
3. Click `Start Test Run`.
4. Confirm delete step deletes up to 100 eligible articles.
5. Confirm Google RSS exits after reaching at least 10 new articles, not after the full spreadsheet.
6. Confirm downstream steps target only the new article cursor range/count.
7. Confirm the run report is generated.

## Open Questions

- Should `doNotRepeatRequestsWithinHours` be forced to `0` in abbreviated test mode, or should it keep the production default to avoid repeatedly hitting Google RSS?
- Should the AI approver be enabled by default for the test run? It may be useful for end-to-end coverage, but it can consume external API time/cost.
- Does worker-python AI approver already support article ID cursor/count? If not, this plan needs a worker-python subtask before the button can exercise the full flow.
- Should production servers ever allow abbreviated test runs through an explicit env flag, or should they be hard-blocked outside non-production environments?

## Recommendation

Implement this as a first-class orchestrator mode, not as a portal-only shortcut. The portal button should only reveal the mode in development/testing, but worker-node should own the validation and step-specific limits so the behavior remains testable and safe from direct API calls.
