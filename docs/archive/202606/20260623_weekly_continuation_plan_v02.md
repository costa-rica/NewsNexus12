---
created_at: 2026-06-23
updated_at: 2026-06-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Weekly continuation plan v02

## Requirement summary

This plan covers a portal-driven weekly orchestration continuation workflow for incomplete runs.

The desired behavior is:

1. Show a `continue` button only when the backend can deterministically decide that a run has a cheap eligible signal.
2. Re-run the full backend assessment before the operator confirms continuation and again inside `POST /continue`.
3. Preserve the incomplete source run as historical data.
4. Create a new linked continuation run.
5. Avoid repeating expensive completed work.
6. Allow limited Google RSS replay only when the last in-flight request was not persisted in `NewsApiRequests`.
7. Use the source run's `articleIdMinExclusive` for downstream continuation.
8. For steps after Google RSS, use the current global max article id at continuation time, even if newer articles were added after the source run began by unrelated runs or manual ingestion.
9. Keep AI Approver in `gatekeeper` mode.
10. Allow semantic scorer to rerun or naturally skip already-scored rows because it is low cost.
11. Keep report-only continuation out of the first implementation.

One plan should cover the work. Splitting the plan would make the eligibility contract harder to keep consistent across `db-models`, `worker-node`, `api`, `portal`, and `worker-python`.

## Current implementation anchors

1. Weekly orchestration runs are stored in:
   - `OrchestratorRuns`
   - `OrchestratorRunSteps`

2. The coordinator currently captures article bounds around Google RSS.
   - `articleIdMinExclusive` is captured immediately before Google RSS starts.
   - `articleIdMaxInclusive` is captured only after Google RSS completes normally.
   - These run-level bounds are the primary continuation failure-location signal.

3. Google RSS persists successful or errored request records in `NewsApiRequests`.
   - Useful columns include `url`, `andString`, `orString`, `status`, `countOfArticlesReceivedFromRequest`, `countOfArticlesSavedToDbFromRequest`, `isFromAutomation`, `createdAt`, and `updatedAt`.
   - The current Google RSS job creates the `NewsApiRequests` row after the RSS fetch returns and storage begins.
   - A hard shutdown can therefore leave one in-flight request unrecorded.

4. Downstream workers already accept article id cursor bounds.
   - State assigner accepts `articleIdMinExclusive` and `articleIdMaxInclusive`.
   - AI Approver accepts `articleIdMinExclusive` and `articleIdMaxInclusive`.
   - Semantic scorer accepts `articleIdMinExclusive` and `articleIdMaxInclusive`.

5. AI Approver currently skips any article and prompt-version pair that already has a score row.
   - This prevents duplicate successful work.
   - It also means retrying a failed row needs explicit retry selection and update semantics.

## Prerequisite: orphan reconciliation

Fix orphan reconciliation before relying on continuation assessment for operator decisions.

Correct reconciliation behavior:

1. Identify the affected run ids first.
2. Mark only those affected running runs as failed.
3. Update only steps belonging to the affected run ids.
4. Preserve the distinction between an in-flight step and a never-started step.
   - A step that was `running` at restart can be marked `failed` with `endingReason: "worker_restart"`.
   - A step that was `pending` should remain `pending`, or receive a distinct terminal marker that clearly means `never_started_after_worker_restart`.
5. Do not update every `running` or `pending` step globally.

Assessment must not depend on corrupted step state to locate where a run stopped. The primary signal is:

1. `articleIdMinExclusive` is `NULL`.
   - The run never reached Google RSS.
   - Continuation is not needed; the operator can start a normal weekly run.

2. `articleIdMinExclusive` is set and `articleIdMaxInclusive` is `NULL`.
   - Google RSS started but did not complete normally.
   - Treat this as a Google RSS interruption unless stronger evidence blocks it.

3. Both `articleIdMinExclusive` and `articleIdMaxInclusive` are set.
   - Google RSS completed.
   - Locate the downstream continuation point using step details, child job state, and report metadata as advisory signals.

Per-step status remains useful for inherited-step display and diagnostics, but it is not the source of truth for the Google RSS boundary.

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
   - Postgres `JSONB`.
   - Stores the immutable plan used when the continuation run was created.
   - Includes source run id, eligibility decision, inherited steps, runnable steps, article bounds, Google RSS resume marker, retry policy, and warning messages.

The existing `OrchestratorRunSteps.result`, `endingReason`, and `endingMessage` fields are enough to mark inherited steps without adding new step columns. For example, inherited steps can have status `skipped`, `endingReason` set to `inherited_from_source_run`, and `result` containing the source step id and source child job id.

### NewsApiRequests continuation metadata

Add only the metadata that is clearly justified for future runs:

1. `orchestratorRunId`
   - Nullable integer.
   - Links a Google RSS request to the weekly orchestration run that created it.
   - Existing production data will have `NULL`, so run 14 must still use fallback matching.
   - Thread the run id into the Google RSS job and into the request persistence path.

Defer `queryRowId` unless implementation proves it is needed. The resume planner can recover the query row by re-reading the configured spreadsheet, rebuilding each expected RSS URL, and matching persisted request rows. If `queryRowId` is added later, justify it as a performance or audit column and define its type from the spreadsheet row id contract.

For run 14 and other historical rows, fallback matching should use:

1. Exact `url` match first.
2. Then `andString`, `orString`, `isFromAutomation`, status, counts, and timestamps.

Do not include `notString` in fallback matching unless the Google RSS job first persists a meaningful value for it. Current automation rows do not make `notString` discriminating evidence.

### Schema delivery

The repo does not appear to use a formal migration runner for normal runtime startup. The implementation should therefore include:

1. Updated Sequelize model definitions in `db-models`.
2. Any association updates needed for the new nullable relationships.
3. An explicit idempotent schema upgrade path, such as a documented SQL script or controlled db-manager command.
4. No hidden `ALTER TABLE` behavior in API or worker startup.

Database backup and replenish workflows should include the new columns automatically once the models and table export/import registry include them.

## Eligibility model

Eligibility should be decided by the worker-node backend, not the portal.

Use two eligibility tiers.

### Cheap list-level signal

The runs-list response should include a cheap continuation signal for each recent run, or the API should expose a cheap batched endpoint. This signal is for table rendering only.

The cheap signal should use:

1. Source run status.
2. Run mode.
3. Presence of `articleIdMinExclusive`.
4. Presence of `articleIdMaxInclusive`.
5. Whether any orchestration run is active.
6. Whether the source already has an active continuation run.

The cheap signal should not read the Google RSS query spreadsheet and should not scan `NewsApiRequests`.

Suggested fields:

1. `canRequestContinuationAssessment`
2. `continuationSignalReasonCode`
3. `continuationSignalWarnings`

The portal can render `continue` from this cheap signal, but clicking it must fetch the full assessment before confirmation.

### Full assessment

The main full-assessment endpoint should be:

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
10. `retryPolicy`
11. `warnings`
12. `blockingReasons`

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
   - Eligible when `articleIdMinExclusive` exists and `articleIdMaxInclusive` is `NULL`.
   - The continuation resumes Google RSS after the last persisted matching request.
   - If no persisted request is found, it starts from the first spreadsheet query row.
   - The last in-flight request can rerun if it was never recorded.

3. Cut off after Google RSS.
   - Eligible when both article bounds exist and downstream status indicates an incomplete step.
   - The continuation skips Google RSS.
   - The continuation uses the current global max article id as `plannedArticleIdMaxInclusive`.
   - This intentionally includes all articles in the id range, even if some were added by unrelated later runs.

4. Timed out or failed during AI Approver.
   - Eligible when article bounds can be planned.
   - Continue with AI Approver in `gatekeeper` mode, then semantic scorer, then report.

5. Failed during semantic scorer.
   - Eligible when article bounds can be planned.
   - Continue with semantic scorer and report.

6. Failed only during report generation.
   - Defer from the first implementation.
   - The first implementation should report it as a recognized but unsupported shape, or route the operator to manual report regeneration if one already exists.

## Continuation creation flow

The main mutation endpoint should be:

1. `POST /orchestrator/runs/:id/continue`

The continue endpoint should:

1. Re-run the full assessment immediately.
2. Reject the request if assessment is no longer eligible.
3. Create a new `OrchestratorRun` with:
   - `runMode`: `continuation`
   - `sourceOrchestratorRunId`: source run id
   - `continuationPlan`: the exact full assessment plan used to create the run
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
5. Build the database strings used for `andString` and `orString`.

For a source run interrupted during Google RSS, the full assessment should:

1. Read the same query spreadsheet configured for weekly automation.
2. Build the expected RSS URL for each row.
3. Query `NewsApiRequests` for matching automation requests.
4. Prefer exact URL matches.
5. Use `andString`, `orString`, `isFromAutomation`, status, counts, and timestamps as fallback evidence.
6. Pick the latest matching query row as the resume marker.
7. Plan to start at the next query row.
8. If no persisted match exists, plan to start at the first query row.

The Google RSS job should accept a resume plan in its request body. The simplest version is:

1. `resumeAfterRequestUrl`
2. `resumeAfterQueryRowIndex` or equivalent internal row marker from the re-read spreadsheet
3. `sourceOrchestratorRunId`
4. `continuationRunId`

The job can skip rows until it passes the resume marker, then process the remaining rows normally.

This intentionally permits one repeated Google RSS request if the worker died after starting a request but before inserting the `NewsApiRequests` row. That tradeoff is acceptable because the request was not durably recorded.

## Downstream article bounds plan

For all continuation paths after Google RSS:

1. Use the source run's `articleIdMinExclusive`.
2. Capture the current global max article id when the continuation reaches downstream processing.
3. Save that value as the continuation run's `articleIdMaxInclusive`.
4. Calculate `articlesAddedCount` as `articleIdMaxInclusive - articleIdMinExclusive`.
5. Pass both bounds to state assigner, AI Approver, and semantic scorer.

This intentionally means a continuation may process every article in that id range regardless of which run created the articles. The current max article id can include articles from unrelated later weekly runs, unrelated continuation runs, or manual ingestion. This is not a strict reconstruction of the original source run.

The system should make this visible in `continuationPlan.warnings`, the confirmation modal, and the report. The warning should state that idempotency is the safety net:

1. AI Approver score rows are unique by article and prompt version.
2. AI Approver skips existing successful rows unless a row is explicitly selected by retry policy.
3. Semantic scorer skips articles that already have semantic contracts.

Optionally surface `articlesAddedCount` with a note that some articles may belong to later runs.

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
4. Do not automatically retry `invalid_response` rows in the first implementation unless the operator explicitly expands scope.

The Python AI Approver must add two explicit paths:

1. A retry-selection query that finds existing score rows whose `resultStatus` is in the configured retryable set and whose article id is inside the continuation bounds.
2. An `update_score_row` repository method that overwrites the retryable failed row in place.

The retry path must bypass the normal skip-existing query only for rows selected by the retry-selection query. It must not re-touch successful rows, non-retryable failed rows, or rows outside the configured bounds.

Because existing score rows are unique by article and prompt version, updating retryable failed rows in place is the first implementation path. The update should preserve useful audit data in `metadata`, such as source result status, source error message, source job id, continuation job id, retry timestamp, and previous metadata. A separate score-attempt history table is out of scope for the first implementation.

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
9. Warnings, especially when the current global max article id includes articles from later or unrelated ingestion.

The source run report should not be overwritten.

Report-only continuation remains deferred. It can be planned as a separate report-regeneration workflow after run 11 and run 14 style continuations are working.

## API proxy plan

The API package should proxy the new worker-node endpoints under the existing authenticated automation route.

Suggested routes:

1. `GET /automations/orchestrator/runs/:id/continuation-assessment`
2. `POST /automations/orchestrator/runs/:id/continue`

If the runs-list endpoint is owned by worker-node, API should also proxy the cheap list-level continuation signal with the run list.

The API should preserve worker-node status codes, including:

1. `200` for assessment.
2. `202` for accepted continuation start.
3. `404` for missing source run.
4. `409` for active run or no-longer-eligible source run.
5. `422` for recognized but ineligible or unsupported run shapes if the worker-node route chooses that style.

## Portal plan

The portal should not infer full eligibility.

The weekly orchestration section should:

1. Continue fetching recent runs as it does today.
2. Use the cheap list-level continuation signal to decide whether to show `continue`.
3. Avoid row-by-row full assessment during table rendering or polling.
4. Disable the action while an active run exists.
5. Fetch the full assessment only when the user opens the confirmation modal.
6. Show a confirmation modal before starting continuation.
7. Let `POST /continue` revalidate on the server and handle a no-longer-eligible response.

The confirmation modal should show:

1. Source run id.
2. New run type: continuation.
3. Inherited steps.
4. Steps that will run.
5. Article lower bound.
6. Planned article upper bound.
7. Google RSS resume behavior if applicable.
8. Any warnings, including the global-article-range warning.

Button wording:

1. Primary visible text: `continue`
2. Secondary small text or tooltip: `from where left off`

## Run 11 expected behavior

Run 11 should be eligible.

Expected plan:

1. Source run id: `11`
2. Source status: `timed_out`
3. Source failure: AI Approver timeout
4. Primary failure-location signal:
   - source `articleIdMinExclusive` set
   - source `articleIdMaxInclusive` set
5. Inherited steps:
   - `delete_articles`
   - `google_rss`
   - `state_assigner`
6. Runnable steps:
   - `ai_approver`
   - `semantic_scorer`
   - `report`
7. Lower bound:
   - source `articleIdMinExclusive`
8. Upper bound:
   - current global max article id at continuation time
9. AI mode:
   - `gatekeeper`

The assessment should warn that the continuation will include every article in the planned id range, and that articles above the original run 11 max may come from unrelated later ingestion. Idempotent downstream processing is the safety net.

## Run 14 expected behavior

Run 14 should be eligible as a Google RSS interruption.

Expected plan:

1. Source run id: `14`
2. Source status: `failed`
3. Source failure: worker restart during Google RSS
4. Primary failure-location signal:
   - source `articleIdMinExclusive` set
   - source `articleIdMaxInclusive` `NULL`
5. Inherited steps:
   - `delete_articles`
6. Runnable steps:
   - `google_rss`
   - `state_assigner`
   - `ai_approver`
   - `semantic_scorer`
   - `report`
7. Lower bound:
   - source `articleIdMinExclusive`
8. Google RSS resume:
   - match existing `NewsApiRequests` rows against the query spreadsheet
   - prefer exact URL matches
   - fall back to `andString`, `orString`, automation flag, status, counts, and timestamps
   - start after the last persisted matching request
   - start at the first query row if no persisted match exists
9. Upper bound:
   - current global max article id after resumed Google RSS completes
10. AI mode:
   - `gatekeeper`

The assessment should include a warning that the final downstream article range may include articles added after run 14 started, including articles from unrelated ingestion.

## Test plan

Testing should focus on the new eligibility contract and continuation branching.

Recommended coverage:

1. `db-models`
   - Model initialization includes new columns.
   - Associations initialize cleanly.

2. `worker-node`
   - Orphan reconciliation only updates steps for affected run ids.
   - Orphan reconciliation preserves in-flight versus never-started step distinction.
   - Cheap list-level signal does not read spreadsheets or scan `NewsApiRequests`.
   - Full assessment rejects completed, running, missing, and pre-Google-RSS runs.
   - Full assessment accepts run shapes matching run 11 and run 14.
   - Full assessment uses run-level bounds as the primary Google RSS boundary signal.
   - Google RSS resume planner picks the last URL match.
   - Google RSS resume planner starts at the first row when no request match exists.
   - Google RSS fallback matching ignores `notString` unless it becomes persisted evidence.
   - Continuation run creation links to the source run.
   - Inherited steps are marked as skipped with continuation metadata.

3. `worker-python`
   - AI Approver continuation mode processes missing gatekeeper rows.
   - AI Approver continuation mode does not duplicate completed rows.
   - AI Approver continuation mode selects retryable failed rows with the retry-selection query.
   - AI Approver continuation mode updates retryable failed rows through `update_score_row`.
   - AI Approver continuation mode leaves successful and `invalid_response` rows alone by default.

4. `api`
   - New proxy routes require authentication.
   - Proxy routes preserve worker-node response codes.
   - Runs-list proxy preserves cheap continuation signal if implemented there.

5. `portal`
   - Past runs table shows no button when cheap signal is false.
   - Past runs table shows `continue` when cheap signal is true.
   - Past runs table does not fetch full assessment during polling.
   - Confirmation modal fetches and displays full assessment.
   - Starting continuation refreshes active-run and past-run state.
   - No-longer-eligible `POST /continue` response is surfaced clearly.

6. Integration or manual validation
   - Use restored local run 11 to verify AI Approver continuation planning.
   - Use restored local run 14 to verify Google RSS resume planning.
   - Verify normal weekly orchestration start still works.

## Implementation sequence

Recommended order:

1. Fix orphan reconciliation.
2. Add linked continuation schema on `OrchestratorRuns`.
3. Add `NewsApiRequests.orchestratorRunId` and thread it through future Google RSS request persistence.
4. Implement cheap list-level signal.
5. Implement full deterministic assessment.
6. Implement continuation run creation and coordinator branching.
7. Implement Google RSS resume planning.
8. Implement worker-python AI Approver retry selection and `update_score_row`.
9. Add API proxies.
10. Add portal button, lazy assessment modal, and POST revalidation handling.
11. Validate run 11 and run 14 flows.

## Planner recommendation

Proceed with this revised plan.

The safest first implementation is:

1. Fix orphan reconciliation before relying on historical step state.
2. Use run-level article bounds as the primary continuation boundary signal.
3. Keep the portal cheap at list level and lazy-load full assessment only for confirmation.
4. Add only `NewsApiRequests.orchestratorRunId` now; defer `queryRowId`.
5. Keep AI Approver retry conservative and update retryable failed rows in place.
6. Keep report-only continuation deferred.
