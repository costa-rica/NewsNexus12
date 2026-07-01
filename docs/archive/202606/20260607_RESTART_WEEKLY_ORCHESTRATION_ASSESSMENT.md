---
created_at: 2026-06-07
updated_at: 2026-06-07
created_by: hermes nws-nn12prod (gpt-5.5)
modified_by: hermes nws-nn12prod (gpt-5.5)
---

# Restart Weekly Orchestration Assessment

## Purpose

This document assesses weekly orchestrator run `#11`, why it ended as `timed_out`, and product/engineering options for safely continuing a partially completed orchestration from the `/articles/automations` page without corrupting existing reports or breaking existing automation behavior.

No implementation code is included in this branch. This is an assessment and remedies proposal only.

## Executive summary

Run `#11` did not appear to fail because the NewsNexus12 app or workers crashed. The recorded terminal condition was an orchestrator-level timeout on the `ai_approver` step.

The deeper cause was likely capacity exhaustion against the OpenAI daily request limit while processing a large weekly batch:

- `google_rss` saved `2,242` articles in the run's article range.
- The AI approver was asked to evaluate those articles against the active AI approver prompts.
- With `12` active prompts, the rough maximum scoring workload was `2,242 × 12 = 26,904` scoring attempts.
- The AI approver persisted `11,549` score rows before it was canceled by the orchestrator timeout.
- The failed score rows observed for job `0054` were OpenAI `429` daily request limit errors for `gpt-4o-mini`, specifically an RPD limit of `10,000` requests already used.
- The orchestrator step timeout was `28,800s` / `8h`; when the deadline elapsed, worker-node canceled Python child job `0054`.
- `semantic_scorer` never ran because the orchestrator stops the sequence when a step times out.
- A final run report was still generated for run `#11` at `/home/limited_user/project_resources/NewsNexus12/utilities/orchestrator/reports/2026-06-05-140740-orchestration-report.xlsx`.

This pattern is likely to recur if weekly article volume and prompt count regularly exceed the available daily model request budget.

## Evidence from run #11

### Run metadata

- Run ID: `11`
- Status: `timed_out`
- Started: `2026-06-05T14:07:40.566Z`
- Ended: `2026-06-06T04:57:42.426Z`
- Duration: about `14h 50m`
- Article range: `376321` through `378564`
- Article ID lower bound: `376320` exclusive
- Article ID upper bound: `378564` inclusive
- Failure reason: `Step ai_approver timed out`
- AI approver enabled: `true`
- Semantic scorer enabled: `true`
- Active run after investigation: none (`runId: null`)

### Step timeline

- `delete_articles`
  - Status: `completed`
  - Child job: `0127`
  - Duration: about `1m`
- `google_rss`
  - Status: `completed`
  - Child job: `0128`
  - Duration: about `5h 45m`
  - Saved articles: `2,242`
  - Ending behavior included Google RSS rate-limit pressure, but the step completed.
- `state_assigner`
  - Status: `completed`
  - Child job: `0129`
  - Duration: about `1h 4m`
- `ai_approver`
  - Status: `timed_out`
  - Child job: Python job `0054`
  - Duration: about `8h`
  - Ending reason: `timeout`
  - Ending message: `Step exceeded 28800s timeout`
- `semantic_scorer`
  - Status: `pending`
  - It was not reached.
- `report`
  - Status: `completed`
  - A timeout report was generated.

### AI approver job #0054 observations

The child AI approver job was canceled after the orchestrator timeout. Its final queue state was `canceled` with `cancel_requested`, which is consistent with worker-node canceling the child job after the timeout rather than the Python worker failing independently.

Observed persisted score output for job `0054`:

- Total score rows: `11,549`
- Completed score rows: `9,466`
- Invalid response rows: `2,070`
- Failed rows: `13`
- Failed rows showed OpenAI `429` daily request-limit messages for `gpt-4o-mini`.

Important interpretation: the `timed_out` status is accurate at the orchestrator layer, while the underlying operational issue is request-budget exhaustion plus insufficient resume behavior for a step that may need more than one day to finish.

## Current architecture relevant to restartability

### Orchestrator run tracking

The current orchestrator records run-level and step-level state in database models:

- `OrchestratorRuns`
  - `status`
  - `startedAt`
  - `endedAt`
  - `articleIdMinExclusive`
  - `articleIdMaxInclusive`
  - `reportFilePath`
  - `failureReason`
  - `aiApproverEnabled`
  - `semanticScorerEnabled`
  - `userId`
- `OrchestratorRunSteps`
  - `orchestratorRunId`
  - `stepName`
  - `stepOrder`
  - `enabled`
  - `status`
  - `childJobId`
  - `startedAt`
  - `endedAt`
  - `result`
  - `endingReason`
  - `endingMessage`

The sequence is currently:

1. `delete_articles`
2. `google_rss`
3. `state_assigner`
4. `ai_approver`
5. `semantic_scorer`
6. `report`

`ai_approver` has an `8h` timeout. `semantic_scorer` has a `4h` timeout.

### Portal behavior

The `/articles/automations` page already has a `Weekly Orchestrator` section that lists recent runs and report download links. This is the natural place to add a conditional action next to a `timed_out` run, such as `Continue` or `Resume Run`, because the table already shows status and report availability.

### AI approver output model

AI approver rows live in `AiApproverArticleScores` and include:

- `articleId`
- `promptVersionId`
- `resultStatus`
- `errorCode`
- `errorMessage`
- `jobId`
- `promptRole`
- `pipelineVersion`
- gatekeeper fields such as `decision`, `confidence`, `reasonCode`, and `metadata`

There is a unique index over `(articleId, promptVersionId)`. This is important because it gives the system a natural way to identify already-attempted article/prompt pairs and avoid duplicate score rows during a continuation, provided continuation logic is explicit about which statuses count as finished and whether failed or invalid rows should be retried.

### State assigner output model

State assignment output lives in `ArticleStateContracts02` and includes `articleId`, `stateId`, `entityWhoCategorizesId`, `promptId`, and related review fields. It has an index on `articleId`.

For restart/progress assessment, an article in the run range can be considered state-assigned if it has the expected current state assignment contract row. The exact definition should match the state assigner's current article-targeting SQL and prompt-selection behavior, not merely any historical state row.

## Desired behavior

When a weekly orchestrator run times out, operators should be able to see:

1. What step timed out.
2. Why it likely timed out, including child-job and rate-limit indicators where available.
3. How much work remains for restartable steps:
   - State assigner: articles in the run range that still need state assignment.
   - AI approver: article/prompt pairs in the run range that still need completed AI approver results.
   - Semantic scorer: no detailed progress requirement; it can simply run over the target article set again.
4. A safe action to continue the orchestration without rerunning already completed expensive work unnecessarily.
5. A safe reporting strategy that does not corrupt the existing timeout report.

## Progress assessment recommendations

### State assigner remaining count

Expose a progress endpoint that computes state assigner completion for a run's article range.

Conceptual inputs:

- `orchestratorRunId`
- run article bounds: `articleIdMinExclusive`, `articleIdMaxInclusive`
- the state assigner's current candidate-selection settings, such as threshold-days-old and review-count behavior
- the active/current state assigner prompt identity, if the existing workflow relies on prompt-specific output

Conceptual output:

- total candidate articles for state assignment in this run range
- completed article count
- remaining article count
- optional sample article IDs still missing
- caveat flags if prompt or selection rules have changed since the original run

Risk: If this check only looks for any `ArticleStateContracts02` row by `articleId`, it may over-count completion when historical or prompt-mismatched rows exist. The safer design is to reuse or centralize the same targeting/query logic as the state assigner job.

### AI approver remaining count

Expose a progress endpoint that computes AI approver completion for article/prompt pairs.

Conceptual inputs:

- `orchestratorRunId`
- run article bounds
- active prompt versions that would be used by the current AI approver mode
- AI approver mode (`legacy`, `shadow`, `gatekeeper`, or `gatekeeper_with_manual_review`)
- policy for retryable statuses

Conceptual output:

- total target articles
- active prompts considered
- total required article/prompt pairs
- completed pair count
- invalid-response pair count
- failed pair count
- missing pair count
- retryable pair count
- estimated request budget needed for continuation

Recommended status policy:

- Treat `completed` rows as done.
- Treat `failed` rows caused by provider rate limits as retryable.
- Treat `invalid_response` rows as retryable only if product wants the continuation to attempt to repair bad model output; otherwise report them separately.
- Treat missing article/prompt pairs as definitely remaining.

Risk: Prompt activation changes after the original run can alter the expected pair count. The safest approach is to snapshot prompt version IDs used by the original run, or at minimum record the active prompt set at step start in `OrchestratorRunSteps.result`. Without that, a continuation may target today's prompts rather than the original run's prompts.

### Semantic scorer remaining count

No detailed progress tracking is necessary for the desired restart flow. The semantic scorer can be rerun for the run's article range after the state assigner and AI approver finish. The implementation should still preserve the existing semantic scorer's idempotency assumptions and report clearly that semantic scoring was rerun as part of continuation.

## Restart/remedy options

### Option 1: Manual operator runbook only

Add documentation for operators to manually restart incomplete downstream jobs using existing endpoints and article bounds.

Flow:

1. Identify the timed-out run and article range.
2. Check state assigner remaining count via database query or a one-off script.
3. Check AI approver remaining count via database query or a one-off script.
4. Manually start AI approver with the same article bounds and a remaining-work-only selection policy if supported.
5. Manually start semantic scorer for the run article range.
6. Generate or archive a follow-up report manually.

Benefits:

- Lowest implementation effort.
- Minimal code-change risk.
- Useful as a near-term fallback while product behavior is designed.

Risks:

- High operator error risk.
- Easy to rerun the wrong article range.
- Hard to make the portal show a trustworthy status.
- Does not solve the product need for a clear button next to a timed-out run.
- Does not by itself prevent duplicate work or report confusion.

Risk to existing functionality: Low technically, high operationally.

Recommendation: Use only as a temporary runbook, not as the main remedy.

### Option 2: Increase AI approver timeout only

Increase the orchestrator `ai_approver` timeout beyond `8h`, for example to `24h`.

Benefits:

- Very small implementation.
- May reduce false timeouts when the daily quota is not hit and processing is merely slow.

Risks:

- Does not fix daily request limit exhaustion.
- If the provider rejects requests for the rest of the day, the worker may continue spending time retrying or writing failures rather than making progress.
- Keeps the orchestrator active for a long time and may block subsequent runs or manual starts.
- Does not provide a controlled continuation UX.

Risk to existing functionality: Low-to-medium. The change is simple, but longer-running active orchestrators can create scheduling and queue-lock side effects.

Recommendation: Not sufficient alone. Consider only as a supporting change after rate-limit-aware behavior is added.

### Option 3: Add rate-limit-aware pausing and automatic resume

Teach AI approver/orchestrator handling to detect provider daily-limit errors and pause rather than fail or spin until timeout. The run could remain in a resumable state and automatically continue after the daily quota resets.

Benefits:

- Directly addresses the recurring RPD limit scenario.
- Reduces operator burden.
- More accurate semantics than a generic timeout.

Risks:

- Requires reliable parsing/classification of provider rate-limit errors.
- Requires knowing or estimating quota reset time.
- Long-paused runs can conflict with weekly schedules and manual starts.
- More complex state machine: `paused_rate_limit` or similar may be needed.
- Needs careful active-run locking so a paused run does not block all useful work forever, but also does not allow conflicting work.

Risk to existing functionality: Medium-to-high. The orchestration lifecycle changes, and incorrect lock handling could block or overlap jobs.

Recommendation: Valuable longer-term, but likely more complex than the first safe continuation feature.

### Option 4: Add portal-driven continuation as a new linked run

Add a `Continue` button beside eligible `timed_out` runs in `/articles/automations`. When clicked, the backend creates a new orchestrator run linked to the original run and executes only the unfinished/retryable downstream work needed to complete the weekly processing.

Suggested flow:

1. Operator sees run `#11` with status `timed_out`.
2. Portal calls a new assessment endpoint for run `#11`.
3. UI displays remaining counts:
   - state assigner remaining articles
   - AI approver missing/retryable pairs
   - semantic scorer will run after prerequisites
4. Operator clicks `Continue`.
5. Backend validates no active conflicting run exists.
6. Backend creates a new continuation run with fields such as:
   - `sourceOrchestratorRunId = 11`
   - `mode = continuation`
   - original article bounds copied from run `#11`
   - original report path recorded as source artifact
7. Continuation skips completed upstream steps by marking them `skipped` with explanatory messages:
   - `delete_articles`: skipped, inherited from source run
   - `google_rss`: skipped, inherited from source run
   - `state_assigner`: run only if remaining count is greater than zero; otherwise skipped/completed
   - `ai_approver`: run only missing/retryable article/prompt pairs
   - `semantic_scorer`: run normally over the run article range
   - `report`: generate a new continuation report
8. Portal shows the continuation run as its own row, with a link back to the source timed-out run.

Benefits:

- Strong report safety: the existing timeout report remains immutable.
- Strong auditability: the original run and continuation run are separate records.
- Avoids mutating a historical run from `timed_out` to `completed`, which could obscure what happened.
- Fits the portal request for a button next to a timed-out run.
- Allows gradual implementation: first add assessment, then continuation.

Risks:

- Requires schema/API changes to represent parent/continuation relationship cleanly.
- Requires worker jobs to support run-range and remaining-work-only semantics accurately.
- The UI must make it clear that the continuation completes the same weekly batch but is a new run artifact.
- Existing report consumers may need to understand that a weekly batch can have multiple related reports.

Risk to existing functionality: Medium. This is a meaningful feature, but it can be isolated behind new endpoints and optional UI actions, avoiding changes to normal weekly start behavior.

Recommendation: Best primary option.

### Option 5: Resume and mutate the original timed-out run in place

Add a `Resume` action that reopens the timed-out run, updates pending/timed-out steps, continues execution, and overwrites or updates the original Excel report.

Benefits:

- Simple user mental model: run `#11` eventually becomes complete.
- One run ID and one report link.

Risks:

- Audit risk: the original timeout history may be hidden or confusing.
- Report corruption risk if the existing workbook is modified in place and the process fails mid-write.
- More complicated rollback semantics.
- Concurrent report downloads could observe a partially updated file if write handling is not atomic.
- It is harder to prove that old and new outputs were merged correctly.

Risk to existing functionality: Medium-to-high, especially around historical reporting and auditability.

Recommendation: Avoid as the first implementation. If in-place report update is ever used, write to a temporary file and atomically rename it only after successful workbook generation.

### Option 6: Keep one logical run but create versioned report artifacts

Resume the same run ID but never overwrite report files. Instead, produce versioned report files such as:

- initial timeout report
- continuation report
- final combined report

Benefits:

- Preserves one logical run ID.
- Avoids direct workbook corruption from in-place writes.
- Gives operators access to all historical report states.

Risks:

- Requires report artifact model changes or a structured report-history field.
- Portal report UI becomes more complex.
- Still mutates the original run state unless carefully represented.

Risk to existing functionality: Medium.

Recommendation: Better than overwriting in place, but less clean than a linked continuation run.

## Recommended product design

The safest design is a linked continuation run with immutable report artifacts.

### Portal UX

In the `Past Runs` table on `/articles/automations`:

- For `timed_out` runs, show a `Assess` or `Continue` action next to `Download`.
- The button should be disabled if another orchestrator run is active.
- The button should open a confirmation modal before starting work.
- The modal should display:
  - original run ID and status
  - failed/timed-out step
  - article range
  - original report link
  - state assigner remaining count
  - AI approver remaining/missing/retryable count
  - semantic scorer note: will run after prerequisites
  - estimated request count for AI continuation
  - warning if prompt configuration changed since original run

Suggested labels:

- `Assess continuation` for the first click if counts are computed on demand.
- `Continue run` after the assessment is loaded and the user confirms.

### Backend API shape

Proposed endpoints:

- `GET /orchestrator/runs/:id/continuation-assessment`
  - Computes whether a run is eligible for continuation and what remains.
- `POST /orchestrator/runs/:id/continue`
  - Starts a new linked continuation run.

The API proxy under `api/src/routes/automations/orchestrator.ts` would pass these through to worker-node, matching existing orchestrator proxy patterns.

### Eligibility rules

A run should be eligible for continuation only when:

- Status is `timed_out` or possibly `failed` for selected recoverable reasons.
- It has valid article bounds.
- No active orchestrator run exists.
- The failed/timed-out step is one of the restartable downstream steps, likely `state_assigner`, `ai_approver`, or `semantic_scorer`.
- The original run's upstream article-ingestion work is complete enough to define the article range.
- The source report file exists or the missing source report is explicitly acknowledged.

A run should not be eligible when:

- It is still `running`.
- It was `canceled` by user intent, unless an explicit `continue canceled run` policy is added.
- It lacks article bounds.
- It failed before `google_rss` established the target article range.
- A continuation has already completed and no remaining work exists.

### Data model additions to consider

For linked continuation runs:

- Add `sourceOrchestratorRunId` nullable column to `OrchestratorRuns`.
- Consider `runKind` or `mode` values such as `weekly`, `abbreviated_test`, and `continuation`.
- Consider storing a `continuationPlan` or `sourceRunSnapshot` JSON field to preserve:
  - original article bounds
  - source failed step
  - prompt version IDs used for AI approver
  - state assigner prompt/version identity
  - report file source path

If avoiding schema changes initially, `OrchestratorRunSteps.result` could hold some continuation metadata, but a first-class source-run link is cleaner and easier to query in the portal.

### Report strategy

Do not overwrite the original timeout report.

Recommended approach:

1. Preserve run `#11` report exactly as generated.
2. Generate a new continuation report for the continuation run.
3. Include source-run metadata in the continuation report:
   - source run ID
   - source report path
   - source failure reason
   - source article bounds
   - continuation started/ended timestamps
   - steps skipped as inherited from source
   - steps rerun and their child job IDs
4. Optionally add a combined summary sheet to the continuation report that says: `This report completes source run #11 via continuation run #N`.

This avoids corruption risk and makes audit history clearer. If the product later wants a single final report, generate it as a separate new file after all continuation work completes, never by editing the source workbook in place.

## Implementation considerations by step

### State assigner continuation

The state assigner completed in run `#11`, but future timeout scenarios could happen during `state_assigner`, so the restart design should handle it.

Desired behavior:

- Identify articles in the source run range that still need state assignment.
- Run state assigner only for those articles or with selection logic that naturally skips already assigned articles.
- Preserve existing behavior for normal manual state assigner jobs.

Key design point:

- The safest implementation reuses state assigner's existing target query and adds explicit run-range constraints plus skip-already-assigned semantics. Avoid duplicating business logic in the continuation assessment endpoint.

### AI approver continuation

This is the critical path for run `#11`.

Desired behavior:

- Identify required article/prompt pairs in the run range.
- Skip pairs with completed rows.
- Retry missing pairs.
- Retry provider-rate-limit failures.
- Decide whether to retry invalid responses.
- Maintain unique `(articleId, promptVersionId)` behavior safely.

Key risk:

- Because of the unique index, a retry of an existing `failed` or `invalid_response` pair cannot blindly insert a duplicate row. The implementation must either update retryable existing rows, delete/recreate them intentionally, or add versioned attempt tracking. Updating retryable rows is simpler but loses detailed attempt history unless metadata records prior attempts. Versioned attempts are more auditable but require a larger schema change.

Recommended initial policy:

- Missing pairs: create new rows.
- Failed rate-limit pairs: update existing row to the new attempt result, appending retry metadata if available.
- Invalid-response pairs: make retry behavior configurable; default to count/report them separately unless product explicitly wants auto-retry.

### Semantic scorer continuation

Desired behavior:

- Run after state assigner and AI approver continuation completes.
- Use the source run's article range.
- Treat as idempotent/re-runnable for the relevant articles.
- Record child job ID and result in the continuation run.

The semantic scorer does not need detailed restart progress tracking for this product request.

## Rate-limit mitigation beyond restart

Continuation solves recovery but does not reduce the chance of timeouts. Consider adding one or more of these after the continuation feature:

1. Request-budget estimator before AI approver starts
   - Estimate `article_count × active_prompt_count`.
   - Warn if estimate exceeds known daily budget.
2. Prompt count visibility in the portal
   - Show active AI approver prompt count before starting weekly orchestration.
3. Provider error classification
   - Distinguish `rate_limit_daily`, `rate_limit_minute`, `quota_exceeded`, `network_error`, `invalid_response`, and application errors.
4. Rate-limit-aware stop condition
   - Stop cleanly with `paused_rate_limit` or `needs_continuation` rather than running until generic timeout.
5. Configurable AI approver batch sizing/throttling
   - Reduce burst pressure, though daily limit still needs continuation or scheduling.
6. Quota reset scheduling
   - If daily limit is hit, create an operator-visible continuation reminder or automatically resume after reset.

## Risk assessment summary

### Lowest technical risk

Manual runbook and progress SQL/script checks. This is not enough for the requested product UX and carries operator risk.

### Lowest product/report risk

Linked continuation run with immutable reports. This preserves source run history and avoids workbook overwrite risk.

### Highest report risk

Mutating the original timed-out run and overwriting the existing Excel file. Avoid this unless atomic file-write and audit-history protections are added.

### Highest orchestration lifecycle risk

Automatic pause/resume across daily quota reset. Valuable, but it changes active-run semantics and should be implemented after explicit continuation is stable.

## Recommended phased plan

### Phase 1: Assessment and safe continuation design

- Add continuation assessment endpoint.
- Add remaining-count logic for state assigner and AI approver.
- Add portal `Assess continuation` button for `timed_out` runs.
- Do not start any jobs yet.

### Phase 2: Linked continuation run

- Add source-run linkage to orchestrator runs.
- Add `POST continue` endpoint.
- Create a new continuation run that skips inherited completed steps and only runs needed downstream work.
- Generate a new continuation report rather than editing the old report.

### Phase 3: AI approver retry policy hardening

- Explicitly classify retryable provider failures.
- Decide invalid-response retry policy.
- Capture prompt-version snapshots so continuation targets the original intended prompt set.
- Add request-count estimation to the confirmation modal.

### Phase 4: Rate-limit-aware orchestration

- Detect daily request limit exhaustion during AI approver execution.
- End the step as `needs_continuation` or `paused_rate_limit` instead of generic timeout when possible.
- Optionally add auto-resume scheduling or reminders.

## Proposed acceptance criteria for a future implementation

1. A `timed_out` run appears in `/articles/automations` with a continuation action.
2. The continuation modal shows remaining state assigner and AI approver work counts before starting.
3. The system refuses continuation if another orchestrator run is active.
4. Starting continuation creates a new linked run rather than mutating the source run in place.
5. Completed source steps are shown as inherited/skipped in the continuation run.
6. AI approver continuation does not duplicate already completed article/prompt pairs.
7. Rate-limit failed AI approver pairs can be retried safely.
8. Semantic scorer runs after prerequisite continuation work finishes.
9. The original timeout Excel report remains unchanged.
10. The continuation run creates a new report with source-run linkage.
11. The portal exposes both source and continuation report downloads.
12. Normal weekly orchestrator starts continue to work exactly as before.

## Open questions

1. Should `invalid_response` AI approver rows be retried automatically during continuation, or should they remain visible as invalid output requiring prompt/model tuning?
2. Should a continuation target the prompt set that was active during the original run, or the prompt set active when the continuation starts?
3. Should a user-canceled run ever be eligible for continuation, or only timed-out/failed runs?
4. Should continuation be allowed more than once for the same source run if the first continuation also hits the daily limit?
5. Should the UI say `Continue`, `Resume`, or `Create continuation run` to make the new-run behavior clear?
6. Does the final combined report need to be a separate artifact, or is a continuation report with source-run metadata enough?

## Bottom line

Run `#11` timed out because the `ai_approver` step exceeded the orchestrator's `8h` step timeout. The best evidence points to OpenAI daily request-limit exhaustion as the underlying contributor, not an app crash. The most reliable remedy is not simply a longer timeout; it is a resumable continuation workflow.

The recommended implementation is a portal-driven, linked continuation run that:

- assesses remaining state assigner and AI approver work,
- retries only unfinished/retryable work,
- runs semantic scorer after prerequisites,
- preserves the original timeout report,
- writes a new continuation report,
- and keeps normal weekly orchestration behavior isolated from the new recovery path.
