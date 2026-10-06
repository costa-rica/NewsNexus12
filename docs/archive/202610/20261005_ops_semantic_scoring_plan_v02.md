---
created_at: 2026-10-05T21:30:43Z
updated_at: 2026-10-05T21:32:34Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops Semantic Scoring Plan V02

## Goal

Implement Phase 5 of weekly-flow-02 in `ops/`. The phase starts worker-node semantic scoring with its ordinary untargeted behavior, monitors the saved queue job, records a verified outcome, and advances the incomplete run to the Phase 6 boundary.

This plan covers only Phase 5. It does not implement state assignment, AI Approver V02, systemd scheduling, a general retry framework, or a new worker-node scoring mode.

## V02 Changes

This version resolves the qualifying concerns in the V01 assessment:

1. The coordinator skips Phase 4 when it is already complete, allowing Phase 5 and Phase 6-boundary continuations to run.
2. Phase 5 receives a dedicated start operation that cannot overwrite its original start timestamp.
3. Each invocation receives a six-hour semantic-job monitoring limit. At the limit, ops requests cancellation, records an error, exits nonzero, and releases the single-execution lock.
4. Phase 5 configuration uses safe defaults so missing new settings do not prevent earlier phases from starting.
5. Start and status 404 responses have different meanings.
6. The first status check is immediate, and ops does not claim it can distinguish an empty semantic batch from another completed job.

## Sources and Constraints

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Apply the operator response in `20261005_ops_semantic_scoring_plan_v01_assessment_claude.md` requiring a six-hour last-resort monitoring limit and cancellation.
- Preserve the implemented Phase 4 high-water marks, finalized `articleCount`, zero-work completion rule, and continuation behavior.
- Follow the current coordinator, persistence, logging, configuration, dependency-injection, and test patterns in `ops/`.
- Use worker-node's existing global queue and semantic-scorer endpoints.
- Keep semantic scoring untargeted. Do not pass an Article-ID range or `articleCount` to the semantic scorer.
- Keep `articleCount` unchanged for Phases 6 and 7.
- Persist Phase 5 start before invoking worker-node and persist verified completion before advancing.
- Start at most one semantic-scorer job in one coordinator invocation.
- Keep default automated tests database-free and worker-free.
- Do not infer complete article coverage from queue completion. The current worker handles article-level skips and failures internally.

## Core Coding Principle

Continue the inside-out implementation. Add one focused Phase 5 module around the existing semantic-scorer queue contract, then extend persistence and the coordinator only where this phase needs durable recovery or orchestration.

Use descriptive names, direct control flow, and small validation functions. Keep Phase 5 policy local instead of creating a generic framework for every later worker phase.

## Existing Integration Boundary

The coordinator currently completes Phase 4 in one of two ways:

1. `articleCount = 0` completes the weekly run, so Phase 5 must not start.
2. `articleCount > 0` persists Phase 4 completion and leaves the run incomplete at the Phase 5 boundary.

The current coordinator always calls the Phase 4 module after Phases 1–3. That behavior must change because `collectGoogleNewsRss` correctly rejects a run whose Phase 4 is already complete.

Gate Phase 4 on `lastPhaseCompleted < 4`:

- If Phase 4 is incomplete, start or continue it through the existing module.
- If Phase 4 is complete, do not call `collectGoogleNewsRss`. Log that the persisted Phase 4 result is being reused.
- If the persisted Phase 4 zero-work branch completed the run, return without entering Phase 5.
- If Phase 4 is complete with a positive `articleCount`, enter or continue Phase 5.

Phase 5 replaces the nonzero boundary return with the semantic-scoring module. A verified Phase 5 completion records `lastPhaseCompleted = 5` and stops at the unimplemented Phase 6 boundary.

When a continued run already has Phase 5 completed, the coordinator must skip both Phase 4 and Phase 5, log the Phase 6 boundary, and return successfully.

## Existing Worker-Node Contract

Use the existing interfaces without changing worker-node:

- Start: `POST /semantic-scorer/start-job` with an empty JSON object.
- Status: `GET /queue-info/check-status/:jobId`.
- Cancellation: `POST /queue-info/cancel_job/:jobId`.
- Expected start response: HTTP 202 with `jobId`, `status = queued`, and `endpointName = /semantic-scorer/start-job`.
- Queue statuses: `queued`, `running`, `completed`, `failed`, and `canceled`.
- Cancellation outcomes: `canceled`, `cancel_requested`, or HTTP 404 when the job cannot be found.
- Worker restart behavior: a previously active job becomes `failed` with `failureReason = worker_restart`.
- Queue storage can prune old jobs, and job IDs can be reused if the store is replaced or emptied.

Do not send `articleIdMinExclusive`, `articleIdMaxInclusive`, or any field derived from the weekly run's `articleCount`. An empty request preserves the semantic scorer's existing unscored-backlog selection.

The semantic-scorer handler currently returns no structured queue result. A normal handler return produces `status = completed`; an uncaught workflow error produces `status = failed` with `failureReason`.

## Meaning of Phase 5 Completion

Treat only a validated queue record with `status = completed` as verified Phase 5 success.

Queue completion means the semantic-scorer handler finished under its existing rules. It does not mean every candidate received a score:

- Articles without usable text may finish without a score.
- Individual scoring timeouts and errors are logged and skipped by worker-node.
- The worker may complete with no candidates.
- Any completed Phase 5 advances to Phase 6 and does not complete the weekly run.

Ops cannot distinguish an empty candidate set from another completed semantic job because the worker returns no counts. Do not log, persist, or test a detected semantic zero-work outcome.

Persist the queue outcome and timestamps available from the job record. Keep detailed article-level diagnostics in worker-node logs.

## Phase Module Design

Add the Phase 5 files under `ops/src/weekly-flow-02/phases/`:

- `05_runSemanticScoring.ts` owns phase start or continuation, saved-job recovery, monitoring, replacement eligibility, monitoring-limit cancellation, progress persistence, and the verified completion result.
- `05_semanticScorerClient.ts` owns HTTP requests, response parsing, job identity validation, status classification, cancellation response validation, and transport error categories.

The phase-facing function accepts the persisted run, Phase 5 configuration, persistence adapter, worker client, clock, delay function, and event callback. It returns a compact verified result to the coordinator.

Use typed errors for start rejection, request timeout, connection failure, temporary server failure, permanent request failure, invalid response, unavailable saved job, unsuccessful terminal outcome, monitoring limit, cancellation failure, and unverified monitoring outcome.

## HTTP Error Classification

Classify errors according to the request being made:

- A start-request 404 is a permanent start rejection. It commonly means `PATH_TO_SEMANTIC_SCORER_DIR` or the keyword workbook is missing.
- A status-request 404 means the saved job is unavailable and may be eligible for replacement.
- A cancellation-request 404 means cancellation could not find the job. Follow it with one status lookup before deciding whether the job is inactive or cancellation is unverified.
- Authorization, validation, and other permanent 4xx responses stop immediately.
- Request timeout, connection failure, and temporary server errors use the monitoring failure policy.

## Job Identity Validation

Validate more than the saved job ID because worker-node job IDs can be reused.

1. Require `endpointName = /semantic-scorer/start-job`.
2. Require a valid `createdAt` timestamp.
3. Require `createdAt` to be at or after the original persisted Phase 5 `startedAt`.
4. Require a valid `startedAt` for `running` and terminal jobs.
5. Require a valid `endedAt` for every terminal job.
6. Require timestamps to be chronological: `createdAt <= startedAt <= endedAt` when all are present.
7. Treat a status 404, endpoint mismatch, or creation before the Phase 5 start as an unavailable saved job.
8. Treat malformed identity, status, or timestamps as an invalid and unverified response.

Preserve the first Phase 5 `startedAt` across continuation. Do not overwrite it when a later invocation resumes the phase or starts a replacement job.

A portal-triggered semantic job could theoretically reuse a saved ID after the queue store resets. If its endpoint and timestamps satisfy the checks, accepting it is harmless because it runs the same untargeted semantic backlog.

## Monitoring Policy

Use a Phase 5-specific polling and invocation-limit policy.

- Perform the first status lookup immediately after saving a new job ID or loading a saved job.
- After an active response, wait 5 minutes before the next lookup.
- Never overlap status requests.
- Use the existing 60-second worker-node request timeout.
- Allow 2 consecutive transient status-request failures and stop on the third.
- Reset the consecutive-failure count after a valid status response.
- Treat request timeouts, connection failures, and temporary server errors as transient.
- Stop immediately on permanent HTTP errors or invalid responses.
- Persist compact observations such as job ID, status, worker timestamps, and failure reason when available.
- Start the six-hour monitoring clock when the current coordinator invocation begins monitoring Phase 5.

The six-hour limit bounds how long one invocation holds the single-execution lock. It is not a claim that the worker job itself has run for six hours. A continuation gets a fresh clock only when the saved attempt has never reached the limit.

## Six-Hour Limit and Cancellation

When six hours of Phase 5 monitoring elapse while the validated job remains `queued` or `running`:

1. Send one cancellation request for the saved job ID.
2. Accept only `outcome = canceled` or `outcome = cancel_requested`.
3. For `outcome = canceled`, persist the cancellation observation and stop immediately.
4. For `outcome = cancel_requested`, wait one normal poll interval and perform one final status lookup.
5. If the final lookup shows a terminal job, persist the terminal observation.
6. If the final lookup still shows `queued` or `running`, record that cancellation was requested but not verified.
7. If cancellation returns 404, perform one status lookup. A status 404 or terminal record confirms the job is inactive; an active or unverified result does not.
8. If cancellation or its follow-up fails, record the cancellation failure.
9. In every monitoring-limit branch, raise a Phase 5 error, let the coordinator persist it, exit nonzero, and release the lock.

Persist that the monitoring limit was reached and the time cancellation was requested. Never mark Phase 5 complete from that job afterward, including when a terminal `completed` result is first observed during cancellation follow-up or a later continuation.

Do not start a replacement job in the same invocation after monitoring-limit cancellation. A later continuation applies saved-job recovery and may replace a confirmed inactive job.

## Terminal Outcome Mapping

1. `queued` or `running` before the six-hour limit: persist the observation and continue monitoring.
2. `completed` before the limit: accept only after identity and terminal timestamps validate, then persist Phase 5 completion.
3. `failed`: record the `failureReason`, stop the current attempt, and do not advance.
4. `canceled`: record the terminal outcome, stop the current attempt, and do not advance.
5. Unknown status or malformed terminal record: stop as an invalid, unverified outcome.
6. Active at the six-hour limit: cancel according to the limit policy and stop with an error.

Do not convert `failed`, `canceled`, missing, malformed, unreachable, or monitoring-limited jobs into successful zero work.

## Interrupted Coordinator Recovery

Persist `semanticScorerJobId` immediately after validating the start response. A continued run uses `lastPhaseStarted`, `lastPhaseCompleted`, the original Phase 5 `startedAt`, and the saved job ID to choose its next action.

Apply these rules:

1. If Phase 5 has not started, persist its start before sending the worker request.
2. Before ordinary saved-job handling, check whether a prior invocation persisted that the monitoring limit was reached.
3. For a monitoring-limited attempt, inspect the saved job immediately and never give it a new six-hour window.
4. If that limited job is still active, send one cancellation request immediately, perform the bounded cancellation follow-up, and exit with a Phase 5 error. Do not start a replacement while it is active.
5. If that limited job is terminal or unavailable, treat the old attempt as unsuccessful regardless of a late `completed` status. The current invocation may start one replacement.
6. Otherwise, if a saved job is active and valid, monitor it rather than starting another.
7. Otherwise, if a saved job is already completed and valid, persist Phase 5 completion without rerunning scoring.
8. Otherwise, if a saved job from an earlier invocation is failed, canceled, or unavailable, the current invocation may start one replacement job.
9. If the current invocation's new job fails or is canceled, stop. Do not start a second job in that invocation.
10. If status monitoring stops without a verified terminal state, preserve the saved job ID. A later continuation checks that same job first.
11. If Phase 5 was persisted as started but no job ID was saved, the continuation may start one job and must log the start-response persistence gap.

A replacement is safe for the workflow because semantic scoring selects the current unscored backlog and upserts score contracts. The global queue's concurrency of one also prevents two semantic jobs from executing simultaneously.

The lost-job-ID gap can still enqueue redundant work if the earlier start request succeeded. Accept that limited risk rather than adopting `latest-job`, which cannot prove that a semantic job belongs to this weekly run.

## Persistence Changes

Extend the typed persistence contract with focused Phase 5 operations.

### Phase 5 Start

Add `recordPhaseFiveStarted` rather than using the generic start operation directly.

The operation should:

- Require Phase 4 to be complete and Phase 5 to be the next phase.
- Require `runCompleted = false` and a positive persisted `articleCount`.
- Reject a second call when `lastPhaseStarted = 5` or `phaseData.phase5.startedAt` already exists.
- Persist `lastPhaseStarted = 5`, `status = started`, and the original `startedAt` together.
- Leave `articleCount` unchanged.

This persistence guard prevents a caller error or later refactor from invalidating saved-job identity checks.

### Phase 5 Progress

Add `recordPhaseFiveProgress` to:

- Require Phase 5 to be the active incomplete phase.
- Require and preserve the original Phase 5 `startedAt`.
- Save a validated non-empty `semanticScorerJobId` as soon as it is known.
- Save compact latest progress under `phaseData.phase5`.
- Record `monitoringLimitReachedAt`, cancellation request time, outcome, and verification details when applicable.
- Reject progress updates after Phase 5 or the run is completed.

The existing `semanticScorerJobId` column is sufficient. No db-models schema change is required.

### Phase 5 Completion

Use the existing generic phase-completion operation to atomically set `lastPhaseCompleted = 5`, save the final `semanticScorerJobId`, and write the compact Phase 5 result under `phaseData.phase5`.

The final result should include:

- `jobId`
- `endpointName`
- final `status`
- `createdAt`
- `startedAt`
- `endedAt`
- elapsed milliseconds derived from worker timestamps

Do not add candidate, completed, skipped, failed, or zero-work counts because worker-node does not expose trustworthy values for them.

## Coordinator Flow

1. Select or create the weekly run through the existing run-selection policy.
2. Execute Phases 1–3 only when they are not already complete.
3. Execute or continue Phase 4 only when `lastPhaseCompleted < 4`.
4. If Phase 4 was already complete, skip its module and reuse the persisted result.
5. Return immediately if Phase 4 completed the run under its zero-Article rule.
6. Require persisted Phase 4 completion and a positive immutable `articleCount` before entering Phase 5.
7. If `lastPhaseCompleted < 5`, start or continue Phase 5 through the new module.
8. Record and log only a validated completed semantic-scorer job observed before the monitoring limit as Phase 5 completion.
9. If Phase 5 is already complete, skip it.
10. Leave `runCompleted = false`, log the Phase 6 boundary, and return successfully.
11. Route Phase 5 errors through the existing failure recorder with `phase: 5`.

Refresh the in-memory run after Phase 4 when Phase 4 executes. When Phase 4 is skipped, use the selected persisted run containing its immutable `articleCount` and completion state.

## Configuration

Keep `URL_BASE_NEWS_NEXUS_WORKER_NODE` and `WORKER_NODE_REQUEST_TIMEOUT_SECONDS` as shared worker-node transport settings.

Add Phase 5 settings:

- `SEMANTIC_SCORER_STATUS_POLL_INTERVAL_SECONDS=300`
- `SEMANTIC_SCORER_TOLERATED_CONSECUTIVE_STATUS_FAILURES=2`
- `SEMANTIC_SCORER_MONITORING_LIMIT_HOURS=6`

Validate explicitly supplied values as positive safe integers. If they are absent, use the defaults above so deployment cannot break Phases 1–4 merely because a host has not yet received the new keys.

Document the values in `ops/.env.example`, `ops/README.md`, and the production deployment checklist. Update host configuration before enabling Phase 5 even though defaults exist.

## Logging and Operator Visibility

Coordinator logs should include:

- Phase 4 skip and persisted-result reuse during continuation.
- Phase 5 start or continuation with run ID and saved job ID.
- Worker job start with job ID and endpoint.
- Immediate first lookup, status transitions, consecutive transient failure count, and worker timestamps.
- Replacement eligibility and whether the invocation has already used its one start.
- Monitoring-limit arrival, cancellation request outcome, and cancellation follow-up result.
- Verified completion with elapsed time.
- Failure or unverified stop with an actionable category and message.
- The Phase 6 boundary after successful completion or when Phase 5 was already complete.

Do not log credentials, request environment values, keyword workbook contents, Article text, or database connection details.

The operator correlates coordinator and worker records with `semanticScorerJobId`. Detailed article processing remains in worker-node logs.

## Verification

Add client and phase-module tests for:

- Empty-body semantic-scorer start requests.
- Start 404 classified as a permanent rejection.
- Valid and invalid start responses.
- Immediate first status lookup followed by non-overlapping five-minute polling.
- Exact endpoint identity validation.
- Reused job IDs whose `createdAt` predates Phase 5.
- Missing, malformed, and non-chronological timestamps.
- `queued`, `running`, `completed`, `failed`, `worker_restart`, and `canceled` outcomes.
- Sixty-second request timeouts.
- Transient status failures incrementing, resetting, and stopping on the third consecutive failure.
- Permanent request failures and invalid responses stopping immediately.
- A completed job with no structured result being accepted without claiming zero work.
- Monitoring just below and exactly at six hours.
- Immediate queued cancellation.
- Running cancellation request and one final status lookup after the normal interval.
- Cancellation 404 followed by inactive, active, and unverified status results.
- Cancellation failure and unverified cancellation still causing an error exit.
- A completion first observed after cancellation begins remaining a Phase 5 error.
- Continuation never trusting a late completion from a monitoring-limited job.
- Continuation immediately retrying cancellation when a monitoring-limited job remains active.
- Continuation replacing a confirmed inactive monitoring-limited job at most once.
- No replacement starting in the monitoring-limited invocation.

Extend persistence tests for:

- Starting Phase 5 only after completed nonzero Phase 4.
- Rejecting a second Phase 5 start and preserving the original `startedAt`.
- Saving `semanticScorerJobId` before completion.
- Rejecting progress outside an active incomplete Phase 5.
- Persisting compact progress and cancellation observations without changing `articleCount`.
- Atomically recording Phase 5 completion and its job ID.

Extend coordinator tests for:

- Phase 4 zero work never starting Phase 5.
- A continued run with `lastPhaseCompleted = 4` not calling `collectRss`.
- Positive Phase 4 `articleCount` starting Phase 5 without passing that count to worker-node.
- Phase order through verified Phase 5 completion.
- Completed Phase 5 stopping at the Phase 6 boundary with `runCompleted = false`.
- A continued run with `lastPhaseCompleted = 5` calling neither Phase 4 nor Phase 5.
- Continuation monitoring a saved active semantic job.
- Continuation accepting a saved completed semantic job.
- Prior failed, canceled, or unavailable jobs allowing one replacement.
- A new job failure not causing a second start in the same invocation.
- A missing saved job ID allowing one start and logging the persistence-gap risk.
- Monitoring-limit cancellation causing a recorded Phase 5 failure and nonzero exit.
- Phase 5 failures being persisted with `phase: 5`.

Extend configuration tests for defaults and invalid explicit values for all three Phase 5 settings.

Run verification in this order:

1. Build `db-models` because ops uses its local package.
2. Run the ops type check.
3. Run the ops test suite.
4. Build ops.
5. Run worker-node build and tests only if implementation changes its contract. No worker-node change is expected.

Do not run the real weekly-flow entry point as an automated smoke test because it performs destructive earlier phases against configured services and databases.

## Documentation Alignment

Update `ops/README.md` to describe:

- Phase 4 skipping during later-phase continuation.
- Phase 5's untargeted backlog behavior.
- The semantic-scorer start, status, and cancellation endpoints.
- Job identity checks and completion meaning.
- Immediate first polling and continuation behavior.
- The six-hour per-invocation limit, cancellation, error exit, and lock release.
- Replacement and lost-job-ID boundaries.
- Phase-specific configuration and defaults.
- Logging and operator correlation.
- The Phase 6 boundary.
- Safe database-free verification commands.

Correct stale README statements that still say Phase 4 is unimplemented, while avoiding any claim that Phase 6, Phase 7, scheduling, or the complete weekly flow is implemented.

## Scope Exclusions

- Do not target semantic scoring with `articleCount` or Phase 4 Article IDs.
- Do not recalculate or modify `articleCount`.
- Do not change semantic-scoring selection or per-article error behavior.
- Do not add semantic result counts unless worker-node gains a separately reviewed contract.
- Do not claim that ops detects an empty semantic batch.
- Do not use `GET /queue-info/latest-job` as proof that a job belongs to the weekly run.
- Do not reuse the Phase 4 24-hour job-duration policy for Phase 5.
- Do not start a replacement in the same invocation after monitoring-limit cancellation.
- Do not add cross-phase worker abstractions solely for future reuse.
- Do not implement Phase 6 or Phase 7.
- Do not add or install systemd units.
