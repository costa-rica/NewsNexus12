---
created_at: 2026-06-23
updated_at: 2026-06-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Weekly continuation plan v01

## Requirement summary

This plan covers a portal-driven weekly orchestration continuation workflow for incomplete runs.

The desired behavior is:

1. Show a `continue` button only when the backend can deterministically decide that a run is eligible.
2. Preserve the incomplete source run as historical data.
3. Create a new linked continuation run.
4. Avoid repeating expensive completed work.
5. Allow limited Google RSS replay only when the last in-flight request was not persisted in `NewsApiRequests`.
6. Use the source run's `articleIdMinExclusive` for downstream continuation.
7. For steps after Google RSS, use the current max article id at continuation time, even if newer articles were added after the source run began.
8. Keep AI Approver in `gatekeeper` mode.
9. Allow semantic scorer to rerun or naturally skip already-scored rows because it is low cost.

One plan should cover the work. Splitting the plan would make the eligibility contract harder to keep consistent across `db-models`, `worker-node`, `api`, `portal`, and `worker-python`.

## Current implementation anchors

1. Weekly orchestration runs are stored in:
   - `OrchestratorRuns`
   - `OrchestratorRunSteps`

2. The coordinator currently captures article bounds around Google RSS.
   - `articleIdMinExclusive` is captured immediately before Google RSS starts.
   - `articleIdMaxInclusive` is captured after Google RSS completes normally.

3. Google RSS persists successful or errored request records in `NewsApiRequests`.
   - Useful columns include `url`, `andString`, `orString`, `notString`, `status`, `countOfArticlesReceivedFromRequest`, `countOfArticlesSavedToDbFromRequest`, `isFromAutomation`, `createdAt`, and `updatedAt`.
   - The current Google RSS job creates the `NewsApiRequests` row after the RSS fetch returns and storage begins.
   - A hard shutdown can therefore leave one in-flight request unrecorded.

4. Downstream workers already accept article id cursor bounds.
   - State assigner accepts `articleIdMinExclusive` and `articleIdMaxInclusive`.
   - AI Approver accepts `articleIdMinExclusive` and `articleIdMaxInclusive`.
   - Semantic scorer accepts `articleIdMinExclusive` and `articleIdMaxInclusive`.

5. AI Approver currently skips any article and prompt-version pair that already has a score row.
   - This prevents duplicate successful work.
   - It also means retrying a failed row needs explicit retry semantics.

## Data model plan

### Orchestrator run linkage

Extend `OrchestratorRuns` so continuation runs are first-class and auditable.

Recommended columns:

1. `sourceOrchestratorRunId`
   - Nullable integer.
   - Self-reference to the source run.
   - `NULL` means a normal weekly run.

2. `runMode`
   - String.
   - Suggested values:
     - `standard`
     - `continuation`
   - Default `standard`.

3. `continuationPlan`
   - JSONB.
   - Stores the immutable plan used when the continuation run was created.
   - Includes source run id, eligibility decision, inherited steps, runnable steps, article bounds, Google RSS resume marker, and warning messages.

The existing `OrchestratorRunSteps.result`, `endingReason`, and `endingMessage` fields are enough to mark inherited steps without adding new step columns. For example, inherited steps can have status `skipped`, `endingReason` set to `inherited_from_source_run`, and `result` containing the source step id and source child job id.

### NewsApiRequests continuation metadata

Add lightweight nullable metadata to `NewsApiRequests` for future runs.

Recommended columns:

1. `orchestratorRunId`
   - Nullable integer.
   - Links a Google RSS request to the weekly orchestration run that created it.
   - Existing production data will have `NULL`, so run 14 must still use fallback matching.

2. `queryRowId`
   - Nullable string or integer, depending on the spreadsheet row id format.
   - Stores the query row id from the Google RSS query spreadsheet.
   - This avoids reconstructing row identity only from query text.

These columns are not strictly required for recovering run 14, but they make future continuation safer and cheaper. For run 14, the implementation should match existing request rows using the built RSS URL first, then fall back to `andString`, `orString`, `notString`, automation flag, status, and timestamps.

### Schema delivery

The repo does not appear to use a formal migration runner for normal runtime startup. The implementation should therefore include:

1. Updated Sequelize model definitions in `db-models`.
2. Any association updates needed for the new nullable relationships.
3. An explicit idempotent schema upgrade path, such as a documented SQL script or controlled db-manager command.
4. No hidden `ALTER TABLE` behavior in API or worker startup.

Database backup and replenish workflows should include the new columns automatically once the models and table export/import registry include them.

## Continuation eligibility model

Eligibility should be decided by the worker-node backend, not the portal.

The main endpoint should be:

1. `GET /orchestrator/runs/:id/continuation-assessment`

The response should include:

1. `eligible`
2. `reasonCode`
3. `sourceRunId`
4. `runMode`
5. `articleIdMinExclusive`
6. `plannedArticleIdMaxInclusive`
7. `inheritedSteps`
8. `runnableSteps`
9. `googleRssResumePlan`
10. `warnings`
11. `blockingReasons`

Common blocking rules:

1. The source run does not exist.
2. Another orchestration run is active.
3. The source run is `running`.
4. The source run is `completed` or `completed_no_new_articles`.
5. The source run has no `articleIdMinExclusive` and did not reach Google RSS.
6. The source run already has an active continuation run.
7. The source run has a failure shape the assessment code does not recognize.

Eligible or intentionally ineligible shapes:

1. Stopped before Google RSS started.
   - Not eligible.
   - No continuation is needed.
   - User can start a normal weekly run.

2. Cut off during Google RSS.
   - Eligible when `articleIdMinExclusive` exists and Google RSS has a running, failed, timed-out, or canceled step.
   - The continuation resumes Google RSS after the last persisted matching request.
   - If no persisted request is found, it starts from the first spreadsheet query row.
   - The last in-flight request can rerun if it was never recorded.

3. Cut off after Google RSS.
   - Eligible when `articleIdMinExclusive` exists.
   - The continuation skips Google RSS.
   - The continuation uses the current max article id as `plannedArticleIdMaxInclusive`.
   - This intentionally includes articles added after the source run started.

4. Timed out or failed during AI Approver.
   - Eligible when article bounds can be planned.
   - Continue with AI Approver in `gatekeeper` mode, then semantic scorer, then report.

5. Failed during semantic scorer.
   - Eligible when article bounds can be planned.
   - Continue with semantic scorer and report.

6. Failed only during report generation.
   - Eligible for a report-only continuation or report regeneration path.
   - This can be implemented as part of the same endpoint but should be low priority.

## Continuation creation flow

The main mutation endpoint should be:

1. `POST /orchestrator/runs/:id/continue`

The continue endpoint should:

1. Re-run the assessment immediately.
2. Reject the request if assessment is no longer eligible.
3. Create a new `OrchestratorRun` with:
   - `runMode`: `continuation`
   - `sourceOrchestratorRunId`: source run id
   - `continuationPlan`: the exact assessment plan used to create the run
   - copied `aiApproverEnabled` and `semanticScorerEnabled` settings from the source run
4. Create the normal step rows.
5. Mark inherited steps as skipped with `endingReason` `inherited_from_source_run`.
6. Start the coordinator in continuation mode.
7. Return the new continuation run id.

The continuation run should not mutate the source run except through ordinary read-only relationships.

## Coordinator plan

The existing coordinator should be extended rather than replaced.

Add a continuation-aware config shape that can describe:

1. Source run id.
2. Inherited steps.
3. First runnable step.
4. Article lower bound.
5. Planned article upper bound.
6. Google RSS resume plan.
7. AI Approver retry policy.

The coordinator should support two broad execution paths:

1. Normal weekly run.
   - Current behavior remains the default.

2. Continuation run.
   - Uses the saved `continuationPlan`.
   - Skips inherited steps.
   - Starts at the first runnable step.
   - Writes step snapshots and final reports the same way normal runs do.

The active-run guard should treat continuation runs exactly like normal runs. Only one standard or continuation orchestration run should be active at a time.

## Google RSS continuation plan

Google RSS continuation should reuse the existing query spreadsheet and query-building logic.

The implementation should extract reusable helpers from the current Google RSS job:

1. Read query spreadsheet.
2. Normalize query row fields.
3. Build the Google RSS query.
4. Build the final RSS URL.
5. Build the database strings used for `andString`, `orString`, and `notString`.

For a source run interrupted during Google RSS, the assessment should:

1. Read the same query spreadsheet configured for weekly automation.
2. Build the expected RSS URL for each row.
3. Query `NewsApiRequests` for matching automation requests.
4. Prefer exact URL matches.
5. Use `andString`, `orString`, `notString`, `isFromAutomation`, status, counts, and timestamps as fallback evidence.
6. Pick the latest matching query row as the resume marker.
7. Plan to start at the next query row.
8. If no persisted match exists, plan to start at the first query row.

The Google RSS job should accept a resume plan in its request body. The simplest version is:

1. `resumeAfterQueryRowId`
2. `resumeAfterRequestUrl`
3. `sourceOrchestratorRunId`
4. `continuationRunId`

The job can skip rows until it passes the resume marker, then process the remaining rows normally.

This intentionally permits one repeated Google RSS request if the worker died after starting a request but before inserting the `NewsApiRequests` row. That tradeoff is acceptable because the request was not durably recorded.

## Downstream article bounds plan

For all continuation paths after Google RSS:

1. Use the source run's `articleIdMinExclusive`.
2. Capture the current max article id when the continuation reaches downstream processing.
3. Save that value as the continuation run's `articleIdMaxInclusive`.
4. Calculate `articlesAddedCount` as `articleIdMaxInclusive - articleIdMinExclusive`.
5. Pass both bounds to state assigner, AI Approver, and semantic scorer.

This intentionally means a continuation may process newer articles added after the source run began. The system should make this visible in `continuationPlan.warnings`, because it is a deliberate simplification rather than a strict reconstruction of the original source run.

The existing downstream jobs order targeted articles by descending id, so this plan naturally works from the newest article backward toward `articleIdMinExclusive`.

## AI Approver continuation plan

AI Approver continuation should be explicit and gatekeeper-only.

The coordinator should pass:

1. `mode: "gatekeeper"`
2. `requireStateAssignment: true`
3. `articleIdMinExclusive`
4. `articleIdMaxInclusive`
5. `limit` based on the planned article count
6. a continuation retry policy

The retry policy should initially be conservative:

1. Process missing gatekeeper rows.
2. Process missing category rows only for articles with completed gatekeeper `pass`.
3. Retry transient failed rows when the error is consistent with rate limit, cancellation, timeout, or worker interruption.
4. Do not automatically retry `invalid_response` rows in v01 unless the operator explicitly expands scope.

The Python AI Approver should add repository methods that can identify retryable failed rows without duplicating successful rows. Because existing score rows are unique by article and prompt version, retrying a failed row should either:

1. Update the existing failed row in place while preserving retry metadata, or
2. Introduce a separate score-attempt history table.

For this feature, updating retryable failed rows in place is the simpler path. The update should preserve useful audit data in `metadata`, such as source result status, source error message, source job id, continuation job id, and retry timestamp.

## Semantic scorer plan

Semantic scorer can run over the planned article bounds.

The first implementation can keep current semantic scorer behavior:

1. It receives the lower and upper article id bounds.
2. It skips articles that already have semantic contracts.
3. It scores missing rows.

If a true full rerun is later required, add an explicit `forceRerun` mode. That should not be part of the first continuation implementation unless the assessor decides the current skip behavior fails the requirement.

## Report plan

Continuation reports should be generated as normal run reports with additional continuation context.

The report should include:

1. Continuation run id.
2. Source run id.
3. Run mode.
4. Inherited steps.
5. Runnable steps.
6. Article bounds used.
7. Google RSS resume marker if applicable.
8. AI Approver missing, retried, completed, failed, and skipped counts.
9. Warnings, especially when the current max article id includes newer articles.

The source run report should not be overwritten.

## API proxy plan

The API package should proxy the new worker-node endpoints under the existing authenticated automation route.

Suggested routes:

1. `GET /automations/orchestrator/runs/:id/continuation-assessment`
2. `POST /automations/orchestrator/runs/:id/continue`

The API should preserve worker-node status codes, including:

1. `200` for assessment.
2. `202` for accepted continuation start.
3. `404` for missing source run.
4. `409` for active run or no-longer-eligible source run.
5. `422` for recognized but ineligible run shapes if the worker-node route chooses that style.

## Portal plan

The portal should not infer eligibility.

The weekly orchestration section should:

1. Continue fetching recent runs as it does today.
2. Request continuation assessments for incomplete runs shown in the table.
3. Show `continue` only when assessment returns `eligible: true`.
4. Use secondary text or a tooltip for `from where left off`.
5. Disable the action while an active run exists.
6. Show a confirmation modal before starting continuation.

The confirmation modal should show:

1. Source run id.
2. New run type: continuation.
3. Inherited steps.
4. Steps that will run.
5. Article lower bound.
6. Planned article upper bound.
7. Google RSS resume behavior if applicable.
8. Any warnings.

Button wording:

1. Primary visible text: `continue`
2. Secondary small text or tooltip: `from where left off`

## Run 11 expected behavior

Run 11 should be eligible.

Expected plan:

1. Source run id: `11`
2. Source status: `timed_out`
3. Source failure: AI Approver timeout
4. Inherited steps:
   - `delete_articles`
   - `google_rss`
   - `state_assigner`
5. Runnable steps:
   - `ai_approver`
   - `semantic_scorer`
   - `report`
6. Lower bound:
   - source `articleIdMinExclusive`
7. Upper bound:
   - current max article id at continuation time
8. AI mode:
   - `gatekeeper`

The assessment should include a warning that the continuation will include newer articles above the original run 11 max if such articles exist.

## Run 14 expected behavior

Run 14 should be eligible as a Google RSS interruption.

Expected plan:

1. Source run id: `14`
2. Source status: `failed`
3. Source failure: worker restart during Google RSS
4. Inherited steps:
   - `delete_articles`
5. Runnable steps:
   - `google_rss`
   - `state_assigner`
   - `ai_approver`
   - `semantic_scorer`
   - `report`
6. Lower bound:
   - source `articleIdMinExclusive`
7. Google RSS resume:
   - match existing `NewsApiRequests` rows against the query spreadsheet
   - start after the last persisted matching request
   - start at the first query row if no persisted match exists
8. Upper bound:
   - current max article id after resumed Google RSS completes
9. AI mode:
   - `gatekeeper`

The assessment should include a warning that the final downstream article range may include articles added after run 14 started.

## Test plan

Testing should focus on the new eligibility contract and continuation branching.

Recommended coverage:

1. `db-models`
   - Model initialization includes new columns.
   - Associations initialize cleanly.

2. `worker-node`
   - Assessment rejects completed, running, missing, and pre-Google-RSS runs.
   - Assessment accepts run shapes matching run 11 and run 14.
   - Google RSS resume planner picks the last URL match.
   - Google RSS resume planner starts at the first row when no request match exists.
   - Continuation run creation links to the source run.
   - Inherited steps are marked as skipped with continuation metadata.
   - Reconciliation only updates steps for affected runs.

3. `worker-python`
   - AI Approver continuation mode processes missing gatekeeper rows.
   - AI Approver continuation mode does not duplicate completed rows.
   - AI Approver continuation mode retries only configured transient failed rows.
   - AI Approver continuation mode leaves `invalid_response` rows alone by default.

4. `api`
   - New proxy routes require authentication.
   - Proxy routes preserve worker-node response codes.

5. `portal`
   - Past runs table shows no button when assessment is ineligible.
   - Past runs table shows `continue` when assessment is eligible.
   - Confirmation modal shows inherited and runnable steps.
   - Starting continuation refreshes active-run and past-run state.

6. Integration or manual validation
   - Use restored local run 11 to verify AI Approver continuation planning.
   - Use restored local run 14 to verify Google RSS resume planning.
   - Verify normal weekly orchestration start still works.

## Assessment focus for vetting agent

The assessing agent should pay special attention to:

1. Whether adding `NewsApiRequests.orchestratorRunId` and `queryRowId` is worth the schema cost.
2. Whether updating retryable AI score rows in place is acceptable, or whether an attempt-history table is needed.
3. Whether using current max article id for downstream continuation could surprise users even with warnings.
4. Whether the portal should fetch assessments row-by-row or receive eligibility as part of the runs list.
5. Whether report-only continuation should be included now or deferred.
6. Whether the orphan-reconciliation fix should be a prerequisite before continuation ships.

## Planner recommendation

Proceed with this as one implementation plan after assessment.

The safest version is:

1. Add linked continuation schema on `OrchestratorRuns`.
2. Add lightweight Google RSS request metadata for future runs.
3. Implement deterministic assessment before any portal button appears.
4. Implement run 11 and run 14 continuation under the same linked-run coordinator flow.
5. Keep AI Approver retry conservative.
6. Fix orphan reconciliation before relying on historical step state.
