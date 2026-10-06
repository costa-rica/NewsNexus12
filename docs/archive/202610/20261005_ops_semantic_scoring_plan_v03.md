---
created_at: 2026-10-05T21:34:51Z
updated_at: 2026-10-05T21:34:51Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops Semantic Scoring Plan V03

## Goal

Implement Phase 5 of weekly-flow-02 in `ops/`. The phase starts worker-node semantic scoring with its ordinary untargeted behavior, monitors the saved queue job, records a verified outcome, and advances the incomplete run to the Phase 6 boundary.

This plan covers only Phase 5. It does not implement state assignment, AI Approver V02, systemd scheduling, a general retry framework, or a new worker-node scoring mode.

## V03 Changes

This version resolves the qualifying concerns in the V02 assessment:

1. `startedAt` is optional for terminal `failed` and `canceled` jobs because a queued job can become terminal without ever running.
2. Queued jobs canceled before start and queued jobs failed by worker restart are eligible for replacement.
3. Monitoring-limit state is stored separately from replaceable latest progress.
4. Monitoring-limit state is tied to both the job ID and validated job `createdAt`.
5. Replacement jobs do not inherit an earlier job's monitoring-limit state, even if worker-node reuses a job ID.
6. Later progress writes cannot erase the durable monitoring-limit marker.

V03 retains the V02 resolutions: completed Phase 4 is skipped during continuation, Phase 5 has a protected start operation, configuration has safe defaults, status polling begins immediately, and a six-hour per-invocation limit triggers cancellation and an error exit.

## Sources and Constraints

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
- Apply the operator response in the V01 assessment requiring a six-hour last-resort monitoring limit and cancellation.
- Resolve the technical findings in the V01 and V02 assessments without adding unrelated scope.
- Preserve Phase 4 high-water marks, finalized `articleCount`, zero-work completion, and continuation behavior.
- Use worker-node's existing global queue and semantic-scorer endpoints.
- Keep semantic scoring untargeted. Do not pass an Article-ID range or `articleCount` to the semantic scorer.
- Keep `articleCount` unchanged for Phases 6 and 7.
- Persist Phase 5 start before invoking worker-node and persist verified completion before advancing.
- Start at most one semantic-scorer job in one coordinator invocation.
- Keep default automated tests database-free and worker-free.
- Do not infer complete article coverage from queue completion.

## Core Coding Principle

Continue the inside-out implementation. Add one focused Phase 5 module around the existing worker-node contract, then extend persistence and the coordinator only where durable recovery or orchestration requires it.

Keep Phase 5 policy local. Use descriptive names, direct control flow, small validation functions, and explicit persisted state for decisions that must survive coordinator restarts.

## Existing Integration Boundary

The coordinator currently completes Phase 4 in one of two ways:

1. `articleCount = 0` completes the weekly run, so Phase 5 must not start.
2. `articleCount > 0` persists Phase 4 completion and leaves the run incomplete at the Phase 5 boundary.

The current coordinator always calls the Phase 4 module after Phases 1–3. Gate that block on `lastPhaseCompleted < 4` because `collectGoogleNewsRss` correctly rejects an already completed Phase 4.

- If Phase 4 is incomplete, start or continue it through the existing module.
- If Phase 4 is complete, do not call `collectGoogleNewsRss`. Log that its persisted result is being reused.
- If Phase 4 completed the run through its zero-work branch, return without entering Phase 5.
- If Phase 4 is complete with a positive `articleCount`, enter or continue Phase 5.

A verified Phase 5 completion records `lastPhaseCompleted = 5` and stops at the unimplemented Phase 6 boundary.

When a continued run already has Phase 5 completed, skip both Phase 4 and Phase 5, log the Phase 6 boundary, and return successfully.

## Existing Worker-Node Contract

Use the existing interfaces without changing worker-node:

- Start: `POST /semantic-scorer/start-job` with an empty JSON object.
- Status: `GET /queue-info/check-status/:jobId`.
- Cancellation: `POST /queue-info/cancel_job/:jobId`.
- Expected start response: HTTP 202 with `jobId`, `status = queued`, and `endpointName = /semantic-scorer/start-job`.
- Queue statuses: `queued`, `running`, `completed`, `failed`, and `canceled`.
- Cancellation outcomes: `canceled`, `cancel_requested`, or HTTP 404 when the job cannot be found.
- Worker restart changes previously queued or running jobs to `failed` with `failureReason = worker_restart`.
- Queue storage can prune old jobs, and job IDs can be reused if the store is replaced or emptied.

Worker timestamps vary by lifecycle:

- A queued job has `createdAt` but no `startedAt` or `endedAt`.
- A running job has `createdAt` and `startedAt` but no `endedAt`.
- A completed job has all three timestamps.
- A failed or canceled job always has `createdAt` and `endedAt`, but may lack `startedAt` when it never left the queue.

Do not send `articleIdMinExclusive`, `articleIdMaxInclusive`, or anything derived from `articleCount`. An empty request preserves the existing unscored-backlog selection.

The semantic-scorer handler returns no structured queue result. A normal handler return produces `completed`; an uncaught workflow error produces `failed` with `failureReason`.

## Meaning of Phase 5 Completion

Treat only a validated queue record with `status = completed` as verified Phase 5 success.

Queue completion means the handler finished under its existing rules. It does not mean every candidate received a score:

- Articles without usable text may finish without a score.
- Individual scoring timeouts and errors are logged and skipped.
- The worker may complete with no candidates.
- Any accepted completion advances to Phase 6 and does not complete the weekly run.

Ops cannot distinguish an empty candidate set from another completed semantic job because the worker returns no counts. Do not log, persist, or test a detected semantic zero-work outcome.

## Phase Module Design

Add these files under `ops/src/weekly-flow-02/phases/`:

- `05_runSemanticScoring.ts` owns phase start or continuation, saved-job recovery, monitoring, replacement eligibility, monitoring-limit cancellation, progress persistence, and verified completion.
- `05_semanticScorerClient.ts` owns HTTP requests, response parsing, identity validation, status classification, cancellation validation, and transport error categories.

The phase-facing function accepts the persisted run, Phase 5 configuration, persistence adapter, worker client, clock, delay function, and event callback. It returns a compact verified result to the coordinator.

Use typed errors for start rejection, request timeout, connection failure, temporary server failure, permanent request failure, invalid response, unavailable job, unsuccessful terminal outcome, monitoring limit, cancellation failure, and unverified monitoring.

## HTTP Error Classification

Classify errors according to the request:

- A start-request 404 is a permanent rejection. It commonly means the semantic-scorer directory or keyword workbook is missing.
- A status-request 404 means the saved job is unavailable and may be eligible for replacement.
- A cancellation-request 404 requires one status lookup before deciding whether the job is inactive or cancellation is unverified.
- Authorization, validation, and other permanent 4xx responses stop immediately.
- Request timeout, connection failure, and temporary server errors use the monitoring failure policy.

## Job Identity and Timestamp Validation

Validate more than the saved job ID because worker-node IDs can be reused.

Apply these common checks to every returned job:

1. Require `endpointName = /semantic-scorer/start-job`.
2. Require a valid `createdAt`.
3. Require `createdAt` to be at or after the original persisted Phase 5 `startedAt`.
4. Reject unknown statuses.

Then validate timestamps by status:

1. `queued`: require no additional timestamp.
2. `running`: require valid `startedAt` and `createdAt <= startedAt`.
3. `completed`: require valid `startedAt` and `endedAt`, with `createdAt <= startedAt <= endedAt`.
4. `failed` or `canceled`: require valid `endedAt`. Treat `startedAt` as optional; if present, require `createdAt <= startedAt <= endedAt`. If absent, require `createdAt <= endedAt`.

Treat a status 404, endpoint mismatch, or creation before the Phase 5 start as an unavailable saved job. Treat malformed identity, status, or required timestamps as invalid and unverified.

Preserve the first Phase 5 `startedAt` across continuation. Do not overwrite it when resuming the phase or starting a replacement job.

A portal-triggered semantic job could theoretically reuse a saved ID. Requiring both the expected endpoint and a valid creation time limits this risk. Because the workflow is untargeted, accepting such a job would still score the same backlog.

## Monitoring Policy

Use a Phase 5-specific polling and invocation-limit policy.

- Perform the first status lookup immediately after saving a new job ID or loading a saved job.
- After an active response, wait 5 minutes before the next lookup.
- Never overlap status requests.
- Use the existing 60-second worker-node request timeout.
- Allow 2 consecutive transient status-request failures and stop on the third.
- Reset the failure count after a valid response.
- Treat request timeouts, connection failures, and temporary server errors as transient.
- Stop immediately on permanent errors or invalid responses.
- Persist compact observations such as job ID, status, worker timestamps, and failure reason.
- Start the six-hour clock when the current invocation begins monitoring Phase 5.

The limit bounds how long one invocation holds the single-execution lock. It does not measure total job age. A continuation gets a fresh clock only when the saved attempt has never reached the limit.

## Durable Phase 5 State Shape

Keep replaceable progress and durable monitoring-limit state as separate siblings under `phaseData.phase5`.

Use this logical shape:

```text
phase5:
  status
  startedAt
  latestProgress
  monitoringLimit
  result
```

`latestProgress` contains only the most recent observation. Replacing it must not modify `startedAt`, `monitoringLimit`, or `result`.

When a job reaches the monitoring limit, save `monitoringLimit` with:

- `jobId`
- validated `jobCreatedAt`
- `reachedAt`
- `cancellationRequestedAt`, when sent
- cancellation outcome, when returned
- verification observation, when available

The monitoring-limit marker applies only when both the current saved job ID and the current validated job `createdAt` equal the marker values.

Starting a replacement updates `semanticScorerJobId` but does not erase the earlier marker. The marker no longer applies because the replacement has a different ID, creation time, or both.

If a replacement later reaches its own limit, replace `monitoringLimit` with that replacement's ID, creation time, and cancellation details. The run table keeps compact recovery state rather than a history of every attempt.

## Six-Hour Limit and Cancellation

When six hours elapse while the validated job remains `queued` or `running`:

1. Persist `monitoringLimit.jobId`, `jobCreatedAt`, and `reachedAt` before requesting cancellation.
2. Send one cancellation request for the saved job ID.
3. Accept only `outcome = canceled` or `outcome = cancel_requested`.
4. For `canceled`, persist the outcome and stop immediately.
5. For `cancel_requested`, wait one normal poll interval and perform one final status lookup.
6. Persist the final observation without overwriting the monitoring-limit identity.
7. If the final job is terminal, record that cancellation is verified inactive.
8. If it remains active, record that cancellation was requested but not verified.
9. If cancellation returns 404, perform one status lookup. A status 404 or terminal record confirms inactivity; an active or unverified result does not.
10. If cancellation or follow-up fails, record the failure while retaining the marker.
11. In every branch, raise a Phase 5 error, let the coordinator record it, exit nonzero, and release the lock.

Never mark Phase 5 complete from the marked job afterward, including when a late `completed` result appears during follow-up or continuation.

Do not start a replacement in the same invocation. A later continuation may replace a confirmed inactive marked job.

## Terminal Outcome Mapping

1. `queued` or `running` before the limit: persist the observation and continue.
2. Unmarked `completed` before the limit: validate and persist Phase 5 completion.
3. `failed`: record the failure and stop without advancing.
4. `canceled`: record the cancellation and stop without advancing.
5. Unknown or malformed record: stop as invalid and unverified.
6. Active at the six-hour limit: mark, cancel, and stop with an error.
7. `completed` whose ID and creation time match `monitoringLimit`: treat as unsuccessful and never complete Phase 5 from it.

Do not convert failed, canceled, missing, malformed, unreachable, or monitoring-limited jobs into successful zero work.

## Interrupted Coordinator Recovery

Persist `semanticScorerJobId` immediately after validating the start response. Use the run's phase boundaries, original Phase 5 start, saved job ID, and durable monitoring-limit identity to select the next action.

1. If Phase 5 has not started, persist its start before sending the worker request.
2. Fetch and validate the saved job before applying a monitoring-limit marker, because matching requires both job ID and `createdAt`.
3. If the marker matches the saved job, never give that attempt a new six-hour window.
4. If a matching marked job is active, send one cancellation request immediately, perform bounded follow-up, and exit with a Phase 5 error.
5. If a matching marked job is terminal or unavailable, treat it as unsuccessful regardless of a late `completed` status. The invocation may start one replacement.
6. If the marker does not match, apply ordinary saved-job recovery.
7. Monitor an ordinary active valid job rather than starting another.
8. Accept an ordinary completed valid job and persist Phase 5 completion.
9. Allow one replacement for an ordinary failed, canceled, or unavailable job from an earlier invocation.
10. Treat `failed` or `canceled` without `startedAt` as a valid terminal outcome when its other required timestamps validate. It remains eligible for replacement.
11. If the current invocation's new job fails or is canceled, stop without a second start.
12. If monitoring stops without a verified terminal state, preserve the job ID and durable state for continuation.
13. If Phase 5 started but no job ID was saved, start at most one job and log the start-response persistence gap.

A replacement is safe because semantic scoring selects the current unscored backlog and upserts score contracts. Global queue concurrency one prevents two semantic jobs from executing simultaneously.

The lost-job-ID gap can still enqueue redundant work if an earlier start succeeded. Accept that limited risk rather than using `latest-job`, which cannot prove run ownership.

## Persistence Changes

Extend the typed persistence contract with focused Phase 5 operations.

### Phase 5 Start

Add `recordPhaseFiveStarted` rather than calling the generic start operation directly.

It should:

- Require completed Phase 4 and a positive persisted `articleCount`.
- Require Phase 5 to be next and `runCompleted = false`.
- Reject a second call when Phase 5 already started or has a saved start timestamp.
- Persist `lastPhaseStarted = 5`, `status = started`, and the original `startedAt` together.
- Leave `articleCount` unchanged.

### Phase 5 Progress

Add `recordPhaseFiveProgress` to:

- Require Phase 5 to be active and incomplete.
- Preserve the original Phase 5 start.
- Save a validated non-empty `semanticScorerJobId` immediately after start.
- Replace only `latestProgress` for ordinary observations.
- Preserve an existing `monitoringLimit` object during every ordinary progress write.
- Write or replace `monitoringLimit` only through an explicit monitoring-limit update containing job ID and validated creation time.
- Reject progress after Phase 5 or the run completes.

The existing `semanticScorerJobId` column is sufficient. No db-models schema change is required.

### Phase 5 Completion

Use the generic phase-completion operation to atomically set `lastPhaseCompleted = 5`, save the final job ID, and write the compact Phase 5 result.

Before completion, require that no `monitoringLimit` marker matches the job's ID and `createdAt`.

The final result includes:

- `jobId`
- `endpointName`
- final `status`
- `createdAt`
- `startedAt`
- `endedAt`
- elapsed milliseconds derived from worker timestamps

Do not add candidate, completed, skipped, failed, or zero-work counts.

## Coordinator Flow

1. Select or create the run through the existing policy.
2. Execute Phases 1–3 only when not already complete.
3. Execute or continue Phase 4 only when `lastPhaseCompleted < 4`.
4. Otherwise, skip Phase 4 and reuse its persisted result.
5. Return if Phase 4 completed the run through its zero-Article rule.
6. Require Phase 4 completion and a positive immutable `articleCount` before Phase 5.
7. If `lastPhaseCompleted < 5`, start or continue Phase 5.
8. Complete Phase 5 only from an unmarked, validated `completed` job.
9. If Phase 5 is already complete, skip it.
10. Leave `runCompleted = false`, log the Phase 6 boundary, and return successfully.
11. Record Phase 5 errors with `phase: 5`.

Refresh the in-memory run after executing Phase 4. When Phase 4 is skipped, use the selected run's persisted count and completion state.

## Configuration

Keep the shared worker-node URL and request timeout. Add these optional Phase 5 settings with defaults:

- `SEMANTIC_SCORER_STATUS_POLL_INTERVAL_SECONDS=300`
- `SEMANTIC_SCORER_TOLERATED_CONSECUTIVE_STATUS_FAILURES=2`
- `SEMANTIC_SCORER_MONITORING_LIMIT_HOURS=6`

Validate explicitly supplied values as positive safe integers. Defaults prevent missing new settings from breaking Phases 1–4.

Document the values in `ops/.env.example`, `ops/README.md`, and the production deployment checklist. Update host configuration before enabling Phase 5 even though defaults exist.

## Logging and Operator Visibility

Log:

- Phase 4 skip and persisted-result reuse.
- Phase 5 start or continuation with run and job IDs.
- Immediate first lookup, status transitions, transient failure count, and worker timestamps.
- Whether `startedAt` is absent because a terminal job never ran.
- Replacement eligibility and the invocation's one-start state.
- Monitoring-limit job ID, creation time, cancellation outcome, and follow-up.
- Verified completion with elapsed time.
- Failure or unverified stop with an actionable category.
- The Phase 6 boundary.

Do not log credentials, environment secrets, keyword contents, Article text, or database connection details.

If repeated continuation attempts cannot stop an active marked job, tell the operator that worker-node may be stuck in work that does not observe cancellation. The documented manual remedy is to inspect worker logs and restart worker-node; the coordinator must not restart it automatically.

## Verification

Add client and phase-module tests for:

- Empty-body starts and valid or invalid start responses.
- Start 404 as a permanent rejection.
- Immediate first status lookup and non-overlapping five-minute polling.
- Exact endpoint and creation-time identity checks.
- Timestamp validation for every status shape.
- Queued cancellation producing `canceled_before_start` without `startedAt`.
- Queued worker-restart failure without `startedAt`.
- Running, completed, failed, and canceled records with `startedAt`.
- Missing `startedAt` rejected for running and completed records.
- Sixty-second request timeout and transient failure policy.
- Monitoring immediately below and exactly at six hours.
- Queued and running cancellation paths.
- Cancellation 404 follow-up branches.
- Cancellation failure and unverified cancellation.
- Late completion of a marked job remaining unsuccessful.
- No replacement in the monitoring-limited invocation.

Extend persistence tests for:

- Protected Phase 5 start and preserved original timestamp.
- Immediate job-ID persistence.
- Ordinary progress replacing only `latestProgress`.
- A monitoring-limit marker surviving later progress writes.
- A marker retaining both job ID and validated creation time.
- A replacement job not matching the old marker.
- A reused job ID with a different creation time not matching the old marker.
- A replacement's new limit replacing the compact marker.
- Completion rejecting a job that matches the marker.
- Completion accepting an unmarked replacement.

Extend coordinator tests for:

- Phase 4 zero work never starting Phase 5.
- Completed Phase 4 being skipped during continuation.
- Positive `articleCount` not being passed to semantic scoring.
- Completed Phase 5 stopping at the Phase 6 boundary.
- Completed Phase 5 skipping both Phase 4 and Phase 5 on continuation.
- Saved active and completed ordinary-job recovery.
- Replacement after canceled-before-start with no `startedAt`.
- Replacement after queued worker-restart failure with no `startedAt`.
- One replacement for ordinary failed, canceled, or unavailable jobs.
- A matching marked active job receiving immediate cancellation rather than another six-hour window.
- A matching marked inactive job allowing one replacement.
- A replacement being monitored normally despite the preserved old marker.
- A replacement completion being accepted.
- No second start after a new job fails.
- Monitoring-limit failure being recorded with `phase: 5`.

Extend configuration tests for defaults and invalid explicit values for all three Phase 5 settings.

Run verification in this order:

1. Build `db-models`.
2. Run the ops type check.
3. Run the ops test suite.
4. Build ops.
5. Run worker-node build and tests only if its contract changes. No worker-node change is expected.

Do not run the real weekly-flow entry point as an automated smoke test because earlier phases perform destructive work against configured services and databases.

## Documentation Alignment

Update `ops/README.md` with:

- Phase 4 skipping during later-phase continuation.
- Untargeted semantic backlog behavior.
- Start, status, and cancellation endpoints.
- Status-specific timestamp requirements.
- Immediate first polling and continuation behavior.
- Six-hour monitoring, cancellation, error exit, and lock release.
- Durable job-specific monitoring-limit state.
- Replacement and lost-job-ID boundaries.
- Configuration defaults.
- Log correlation and the Phase 6 boundary.
- The manual worker-node restart remedy when cancellation cannot stop a stuck job.
- Safe database-free verification commands.

Correct stale statements that Phase 4 is unimplemented. Do not claim Phase 6, Phase 7, scheduling, or the complete weekly flow is implemented.

## Scope Exclusions

- Do not target semantic scoring with `articleCount` or Phase 4 Article IDs.
- Do not recalculate or modify `articleCount`.
- Do not change semantic-scoring selection or per-article error behavior.
- Do not add semantic result counts.
- Do not claim that ops detects an empty semantic batch.
- Do not use `latest-job` as proof of run ownership.
- Do not reuse the Phase 4 24-hour job-duration policy.
- Do not start a replacement in the same invocation after monitoring-limit cancellation.
- Do not restart worker-node automatically.
- Do not add cross-phase abstractions solely for future reuse.
- Do not implement Phase 6 or Phase 7.
- Do not add or install systemd units.
