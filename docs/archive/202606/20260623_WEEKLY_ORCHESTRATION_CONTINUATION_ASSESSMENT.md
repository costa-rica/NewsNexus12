---
created_at: 2026-06-23
updated_at: 2026-06-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Weekly orchestration continuation assessment

## Purpose

This report assesses whether incomplete weekly orchestration runs can benefit from the linked-run continuation workflow described in `docs/20260607_RESTART_WEEKLY_ORCHESTRATION_ASSESSMENT.md`, especially:

### Option 4: Add portal-driven continuation as a new linked run

The requested continuation behavior is:

1. Let a portal user continue an incomplete weekly orchestration run.
2. Pick up where the source run left off.
3. Avoid repeating completed steps, queries, API requests, or other expensive work.
4. Allow semantic scorer to be rerun completely because it is comparatively low cost.
5. Preserve the original run as historical evidence.
6. Create a new linked run for the continuation attempt.

Summary: Option 4 is still the cleanest user-facing and data-model direction. It is especially suitable for run 11. Run 14 can also benefit from the same workflow, but it needs stronger Google RSS recovery rules because the interruption happened before the original run reached a stable final article upper bound.

## Local verification

The local Mac environment now has enough production-like data to assess both runs at the database and queue-artifact level.

1. Orchestrator run tables are present and populated.
   - `OrchestratorRuns`
   - `OrchestratorRunSteps`

2. Local orchestration report files exist for the two runs.
   - Run 11 report exists locally at:
     - `/Users/nick/Documents/_project_resources/NewsNexus12/utilities/orchestrator/reports/2026-06-05-140740-orchestration-report.xlsx`
   - Run 14 report exists locally at:
     - `/Users/nick/Documents/_project_resources/NewsNexus12/utilities/orchestrator/reports/2026-06-19-125747-orchestration-report.xlsx`

3. Local queue job state exists for the important child jobs.
   - Run 11 AI approver child job:
     - worker-python job `0054`
     - status `canceled`
     - cancellation happened after the weekly orchestration timeout requested cancellation
   - Run 14 Google RSS child job:
     - worker-node job `0141`
     - status `failed`
     - failure reason `worker_restart`

4. The restored data is enough to build a continuation assessment endpoint for these cases.
   - Run metadata exists.
   - Step metadata exists.
   - Child job ids exist for failed or timed-out steps.
   - Article id bounds exist for run 11.
   - A partial article range can be inferred for run 14, but that inference is less safe than run 11 because run 14 has no final `articleIdMaxInclusive`.

## Run 11 assessment

### Source run shape

Run 11 is the best fit for portal-driven continuation.

1. Source run:
   - id: `11`
   - status: `timed_out`
   - failure reason: `Step ai_approver timed out`
   - started at: `2026-06-05 07:07:40.566-07`
   - ended at: `2026-06-05 21:57:42.426-07`
   - `articleIdMinExclusive`: `376320`
   - `articleIdMaxInclusive`: `378564`
   - `aiApproverEnabled`: `true`
   - `semanticScorerEnabled`: `true`

2. Completed source-run steps:
   - `delete_articles`
   - `google_rss`
   - `state_assigner`
   - `report`

3. Incomplete or retryable source-run steps:
   - `ai_approver` timed out.
   - `semantic_scorer` should be treated as not meaningfully completed for this source run.

4. Important data caveat:
   - The restored step row for run 11 currently shows `semantic_scorer` as `failed` with `worker_restart` at the same time run 14 was reconciled.
   - This appears to come from the current orphan-reconciliation behavior updating pending steps globally, rather than only steps for the affected active run.
   - For continuation planning, run 11 should be understood as having reached `ai_approver`, timed out there, and not meaningfully completed semantic scoring.

### Local evidence

1. Run 11 has stable article bounds.
   - Articles in the run range:
     - `id > 376320`
     - `id <= 378564`
     - count: `2243`

2. State assignment appears essentially complete for the run range.
   - Distinct articles with state contracts in the range: `2242`

3. AI approver made partial progress.
   - Worker-python job `0054`
   - Requested limit: `2242`
   - Article bounds:
     - `articleIdMinExclusive`: `376320`
     - `articleIdMaxInclusive`: `378564`
   - Job result:
     - status `canceled`
     - error text indicates the AI approver pipeline was cancelled

4. Gatekeeper rows exist for most, but not all, articles in the range.
   - Distinct articles with gatekeeper rows: `1985`
   - Missing gatekeeper articles: `258`
   - Gatekeeper completed outcomes:
     - `pass`: `1030`
     - `reject`: `429`
     - `manual_review`: `525`
   - Gatekeeper failed outcomes:
     - `error`: `1`

5. Category scoring rows also exist for many articles.
   - Category score completed rows: `9804`
   - Category score failed rows: `40`
   - Category score invalid-response rows: `4237`

6. Failed AI rows are mostly rate-limit failures.
   - The observed failed rows are tied to OpenAI daily request limit errors.
   - These are good candidates for explicit retry behavior, because the failure was external and temporary.

### Continuation fit

Run 11 aligns well with Option 4.

1. The source run has a clear stopping point.
   - Continue after completed Google RSS and state assignment.
   - Resume at AI approver.
   - Then run semantic scorer.
   - Then generate a continuation report.

2. The article range is stable.
   - The continuation run can reuse the original source bounds.
   - This avoids accidentally processing newer articles.

3. Completed expensive work can be skipped safely.
   - Do not rerun `delete_articles`.
   - Do not rerun `google_rss`.
   - Do not rerun `state_assigner` unless the assessment endpoint detects missing state rows and the user explicitly chooses repair.

4. AI approver can be continued, but the current AI approver implementation needs one important enhancement.
   - Existing logic skips an article/prompt pair if any score row already exists.
   - That means existing `failed` and `invalid_response` rows are treated as already handled.
   - A true continuation should process missing gatekeeper rows and retry selected transient failures.

5. Semantic scorer can be handled as a normal continuation step.
   - The user has stated semantic scorer can rerun completely.
   - Current semantic scorer implementation naturally skips articles that already have semantic entity contracts.
   - If a true full rerun is desired, add an explicit rerun mode or cleanup/upsert policy for the continuation run.

### Recommended continuation plan for run 11

1. Create a new linked continuation run.
   - `sourceOrchestratorRunId`: `11`
   - run kind or mode: `continuation`
   - source article bounds:
     - `articleIdMinExclusive`: `376320`
     - `articleIdMaxInclusive`: `378564`

2. Mark inherited completed steps as skipped or inherited in the continuation run.
   - `delete_articles`: inherited
   - `google_rss`: inherited
   - `state_assigner`: inherited

3. Run AI approver in continuation mode.
   - Process articles missing gatekeeper scores.
   - Retry transient `failed` rows caused by rate limits.
   - Decide whether `invalid_response` rows should be retried automatically or left for a separate repair option.
   - Keep gatekeeper as the only portal-exposed mode.

4. Run semantic scorer.
   - Safe default: run for the same article bounds and let the existing scorer skip already-processed articles.
   - Optional stronger behavior: add `forceRerun` if the goal is to fully rescore the whole range.

5. Generate a continuation report.
   - Include the source run id.
   - Include inherited/skipped steps.
   - Include counts for missing, retried, completed, failed, and still-invalid AI approver records.

### Run 11 verdict

Run 11 is highly suitable for Option 4.

The restored local data is sufficient to continue this run safely if we add continuation-specific orchestration code and AI approver retry semantics. The risk is moderate, not high, because the run has stable bounds and completed upstream steps. The biggest implementation risk is not the portal button; it is making AI approver continuation correctly distinguish already-successful work from retryable failed or missing work.

## Run 14 assessment

### Source run shape

Run 14 is also a continuation candidate, but it is less straightforward than run 11.

1. Source run:
   - id: `14`
   - status: `failed`
   - failure reason: `Worker restarted unexpectedly`
   - started at: `2026-06-19 05:57:47.564-07`
   - ended at: `2026-06-19 12:05:53.802-07`
   - `articleIdMinExclusive`: `388558`
   - `articleIdMaxInclusive`: `NULL`
   - `aiApproverEnabled`: `true`
   - `semanticScorerEnabled`: `true`

2. Completed source-run steps:
   - `delete_articles`

3. Failed source-run step:
   - `google_rss`
   - child job `0141`
   - failure reason `worker_restart`

4. Not reached:
   - `state_assigner`
   - `ai_approver`
   - `semantic_scorer`
   - final useful report generation

5. External failure context:
   - The failure was caused by server or worker shutdown.
   - It was not caused by a NewsNexus12 workflow decision.

### Local evidence

1. The Google RSS step made real progress before the restart.
   - Articles created during the run window:
     - min id: `388559`
     - max id: `391626`
     - count: `3068`

2. The run did not persist a final upper article bound.
   - `articleIdMaxInclusive` is `NULL`.
   - This is expected because the failed Google RSS step never returned normally to the coordinator.

3. State assignment appears to have happened for many articles after the run.
   - Distinct articles with state contracts where `id > 388558`: `3055`
   - This likely reflects later manual or repaired workflow activity, not a clean completed run 14 state.

4. Semantic scorer did not meaningfully run for the new range.
   - Distinct semantic scorer contracts where `id > 388558`: `0`

5. The report file is not useful for a final continuation boundary.
   - The local Excel file exists.
   - It is small and incomplete compared with the run 11 report.
   - The separate failure report says it only has limited job information.

### Continuation fit

Run 14 can benefit from Option 4, but only after adding safer Google RSS continuation rules.

1. The linked-run model is still appropriate.
   - Keep run 14 immutable as the failed source run.
   - Create a new continuation run linked to run 14.
   - Record inherited source metadata and any inferred boundaries.

2. The stopping point is earlier and less stable than run 11.
   - Run 14 failed inside `google_rss`.
   - The system cannot simply skip Google RSS unless it can prove which RSS queries completed and which article range belongs to the source run.

3. Avoiding repeated RSS queries requires more than a button.
   - The continuation should know which RSS query rows were already requested.
   - It should avoid repeating completed query requests where reliable request records exist.
   - It should resume only unfinished or failed RSS units.

4. The article upper bound must be explicitly derived and saved.
   - Possible source:
     - articles created during the run window
     - queue job evidence
     - RSS request records
     - current article max at reconciliation time
   - This inferred bound should be shown in the assessment response before a user continues.

5. Downstream steps can then use the derived bounds.
   - Once the continuation has a safe `articleIdMaxInclusive`, it can run:
     - state assigner
     - AI approver in gatekeeper mode
     - semantic scorer
     - continuation report

### Recommended continuation plan for run 14

1. Create an assessment endpoint that classifies run 14 as `google_rss_interrupted`.

2. Reconstruct Google RSS progress before offering continuation.
   - Identify completed RSS query units.
   - Identify unfinished or failed query units.
   - Derive an article upper bound for already-created articles.
   - Persist the derived bound in the continuation plan.

3. Continue Google RSS only for missing query units.
   - Do not replay completed queries.
   - If exact per-query progress is not available, require a conservative fallback mode.

4. Run downstream steps after RSS completion.
   - State assigner over the final continuation article bounds.
   - AI approver in gatekeeper mode.
   - Semantic scorer over the same bounds.
   - Continuation report.

5. Include a stronger report for run 14 continuation.
   - Source run id.
   - Reconstructed RSS progress.
   - Inferred and final article bounds.
   - Any queries skipped as already completed.
   - Any queries rerun because status could not be trusted.

### Run 14 verdict

Run 14 can benefit from Option 4, but it is not as immediately safe as run 11.

The linked continuation concept is correct for run 14. However, because run 14 stopped inside Google RSS and did not persist `articleIdMaxInclusive`, the continuation workflow needs durable RSS progress assessment before it can honestly claim to avoid repeated queries and requests. This is feasible, but it should be implemented after or separately from the simpler run 11 continuation path.

## Portal user experience

The portal should expose continuation only when the backend assessment says a run is eligible.

1. Button placement:
   - Add a continuation action to the weekly orchestration past-runs table.
   - Show it next to incomplete runs only when eligible.

2. Button wording:
   - Primary text: `continue`
   - Secondary text: `from where left off`

3. Presentation options:
   - In a wider table cell, render the secondary text smaller below the primary text.
   - In a tighter table cell, show only `continue` and place `from where left off` in a tooltip.

4. Confirmation modal:
   - Show which source run will be continued.
   - Show which steps will be inherited or skipped.
   - Show which steps will run.
   - Show expected article bounds.
   - For run 14, show whether any Google RSS progress had to be inferred.

## Feasibility and safety

### Overall feasibility

Option 4 is feasible and is the safest of the restart strategies because it avoids mutating the original run in place.

The implementation should be considered medium complexity. The portal change is small. The orchestration and AI approver continuation logic is the real work.

### Why it can be implemented safely

1. Original runs stay immutable.
   - The continuation creates a new run.
   - The original run remains available for audit and comparison.

2. Continuation can be guarded by an assessment endpoint.
   - The backend decides eligibility.
   - The portal does not infer safety from status text alone.

3. Completed expensive steps can be inherited.
   - Run 11 can inherit completed `delete_articles`, `google_rss`, and `state_assigner`.
   - Run 14 can inherit only `delete_articles` until RSS progress can be verified.

4. Existing start behavior can remain unchanged.
   - The normal weekly orchestration start endpoint can keep its current behavior.
   - Continuation can use separate endpoints and mode flags.

5. The continuation report can make the behavior auditable.
   - Every inherited step and retried step should be visible.
   - This makes continuation safer than an opaque manual rerun.

### Main implementation risks

1. AI approver retry semantics.
   - Current AI approver logic treats any existing score row as already processed.
   - Continuation needs to retry selected failed or invalid rows without duplicating successful rows.
   - The unique index on article and prompt version means retry behavior needs an update, replace, or attempt-history design.

2. Google RSS progress recovery for run 14.
   - Run 14 lacks a final article upper bound.
   - Continuing without durable query-level progress could repeat requests.
   - This should be solved before presenting run 14 as a clean continuation.

3. Orphan reconciliation behavior.
   - Current reconciliation appears capable of marking pending steps from older runs as failed during a later worker restart.
   - This should be tightened so reconciliation only updates the affected active run or genuinely active steps.
   - Fixing this improves confidence in future continuation assessments.

4. Report path portability.
   - Restored DB paths point to production filesystem locations.
   - Local Mac report files exist under `/Users/nick/Documents/_project_resources/...`.
   - Continuation code should not depend on the original report path being directly readable on every machine.

5. Semantic scorer rerun mode.
   - Existing code skips articles that already have semantic contracts.
   - That is safe and cheap, but it is not a full rerun.
   - If full rerun is required, add an explicit mode and make its behavior visible in the continuation plan.

### Recommended implementation sequence

1. Add data model support for linked continuation runs.
   - `sourceOrchestratorRunId`
   - run kind or mode, such as `standard` and `continuation`
   - continuation plan snapshot, preferably JSON

2. Add backend assessment endpoint.
   - `GET /orchestrator/runs/:id/continuation-assessment`
   - Return eligibility, inherited steps, runnable steps, article bounds, warnings, and estimated remaining work.

3. Add backend continue endpoint.
   - `POST /orchestrator/runs/:id/continue`
   - Create the linked run.
   - Persist the continuation plan used at creation time.
   - Start only the selected continuation steps.

4. Implement run 11 continuation first.
   - Skip completed upstream steps.
   - Continue AI approver in gatekeeper mode.
   - Run semantic scorer.
   - Generate continuation report.

5. Add AI approver retry rules.
   - Process missing gatekeeper rows.
   - Retry transient failed rows.
   - Decide and document handling for invalid responses.

6. Tighten orphan reconciliation.
   - Avoid globally failing pending steps from unrelated historical runs.

7. Implement run 14 continuation after RSS progress recovery is reliable.
   - Reconstruct or persist query-level RSS progress.
   - Derive and store a safe article upper bound.
   - Resume only unfinished RSS units.

8. Add portal action.
   - Show `continue` only for eligible runs.
   - Use smaller or tooltip text for `from where left off`.
   - Show the backend-generated continuation plan before starting.

## Final recommendation

1. Implement Option 4.
   - It matches the desired user experience and keeps historical runs intact.

2. Start with run 11.
   - It has stable article bounds and a clear failed step.
   - It is the safest proof of concept.

3. Treat run 14 as the next phase.
   - It should use the same linked-run foundation.
   - It needs additional Google RSS progress recovery before it can safely avoid repeated queries.

4. Do not expose a generic retry button.
   - The button should be backed by a backend assessment.
   - It should only appear when the system can explain what will be skipped, what will run, and what may be retried.
