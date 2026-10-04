---
created_at: 2026-10-04T18:15:55Z
updated_at: 2026-10-04T18:15:55Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Plan V06

## Purpose

Implement Phase 4 of weekly-flow-02 in `ops/`. The phase starts and monitors worker-node Google News RSS collection, records the minimum durable data needed for recovery, and calculates the broader Article batch that later phases will analyze.

The batch includes every Article inserted after the Phase 4 starting boundary, regardless of which process inserted it. RSS-only counts remain separate and are not used to target later phases.

After a verified RSS outcome, Phase 4 either completes the run when the broader batch is empty or advances to the Phase 5 boundary. Phase 5 remains unimplemented in this increment.

This plan does not implement semantic scoring, state assignment, AI Approver V02, systemd scheduling, or a general retry framework.

## Sources and Constraints

- Use `docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v09.md` as the base product requirement.
- Apply the later operator decision that all Articles inserted after Phase 4 begins belong in the downstream batch, even when another process inserted them.
- Preserve the coordinator, persistence, logging, configuration, and testing patterns already present in `ops/`.
- Keep the phase independently runnable and written in TypeScript.
- Keep default automated tests database-free by injecting worker and persistence dependencies.
- Do not report Phase 4 as completed merely because an RSS job started or Articles appeared in the database.
- Do not add coordinator-managed query deduplication, leases, heartbeats, or a broad recovery framework.
- Do not change the single-execution guard or existing run-selection policy.
- Keep detailed per-query history in logs rather than in `WeeklyArticleFlowRuns02`.

## Core Coding Principle

Use the inside-out implementation approach. Build one focused Phase 4 module around the existing worker-node interface, then extend persistence and the coordinator only as that module requires.

Use descriptive names, straightforward control flow, and focused functions. Add comments for intent, assumptions, and non-obvious recovery behavior. Avoid abstractions that are not useful to this phase.

## Existing Integration Boundary

The coordinator currently persists verified completion through Phase 3 and stops at the Phase 4 boundary. A continued run with Phase 3 completed reaches the same boundary without repeating Phases 1–3.

The persistence contract already exposes `firstRssRequestId`, `firstRssArticleId`, `rssArticlesAddedCount`, `articleCount`, and `rssJobId`.

Phase 4 replaces the current boundary return with the new module. A verified outcome with Articles in the broader batch stops at the Phase 5 boundary with the run still incomplete. A verified outcome with no Articles in the broader batch completes the run.

## Existing Worker-Node Contract

Use the existing worker-node interfaces:

- Start RSS with `POST /request-google-rss/start-job`.
- Omit `targetArticlesAddedCount` so the worker attempts the complete query list.
- Use the existing default `doNotRepeatRequestsWithinHours` value of 72 hours.
- The start response is HTTP 202 with `jobId`, `status`, and `endpointName`.
- Read status with `GET /queue-info/check-status/:jobId`.
- Cancel with `POST /queue-info/cancel_job/:jobId`.
- Queue statuses are `queued`, `running`, `completed`, `failed`, and `canceled`.
- The completed RSS result contains `endingReason`, `endingMessage`, `articlesAddedCount`, and detailed `queryResults`.

The queue is global across worker-node workflows and runs one job at a time. Time spent queued counts toward that RSS job's 24-hour limit.

A queued cancellation returns `outcome = canceled` after persisting terminal cancellation. An active cancellation returns `outcome = cancel_requested`; the job becomes terminal only after its handler stops and worker-node persists `status = canceled`.

Worker-node startup changes jobs left `queued` or `running` to `failed` with `failureReason = worker_restart`. Old jobs can be pruned, and job IDs can be reused if the store is replaced or emptied.

The current worker result does not contain the first request or Article IDs. Phase 4 recovers those markers from PostgreSQL rather than expanding the worker result with mid-job ID reporting.

## Phase Module

Add a Phase 4 module under `ops/src/weekly-flow-02/phases/`, following the separation used by the existing phase modules.

- A phase-facing function accepts only the configuration and dependencies needed for RSS collection.
- A worker integration layer starts collection, validates the start response, monitors the saved job, validates job identity, interprets terminal data, and requests timed-out job cancellation.
- Typed results and errors keep worker response details out of the coordinator.
- Failure categories distinguish connection, request timeout, unsuccessful HTTP response, invalid response, per-job timeout, cancellation failure, permanent status error, unsuccessful terminal result, and unverified outcome.

Do not persist the worker's detailed `queryResults` in `WeeklyArticleFlowRuns02`.

## Article and Request High-Water Marks

Before the first RSS start request, read and persist:

- `newsApiRequestIdHighWaterMark`: the current maximum `NewsApiRequests.id`, or zero when the table is empty.
- `articleIdHighWaterMark`: the current maximum `Articles.id`, or zero when the table is empty.

Persist both typed values with the Phase 4 start before invoking worker-node. Keep them unchanged across coordinator restarts, saved-job monitoring, and replacement RSS jobs.

Add these fields as typed columns on `WeeklyArticleFlowRuns02` rather than placing them in an open-ended metadata structure.

After a verified RSS outcome, derive:

- `firstRssRequestId`: the lowest Google News RSS `NewsApiRequests.id` above `newsApiRequestIdHighWaterMark`, when one exists.
- `firstRssArticleId`: the lowest Article ID associated with those post-mark Google News RSS requests, when one exists.
- `articleCount`: the count of all Articles where `id > articleIdHighWaterMark`, regardless of source.

The high-water marks close the interruption gap where RSS inserts Articles but worker-node restarts before writing its result. A replacement job can report zero while the database-derived count still includes the Articles inserted by the first job.

`firstRssArticleId` remains RSS-specific metadata. The typed `articleIdHighWaterMark` defines the broader downstream batch.

## Two-Tier Time Policy

Use two scopes rather than one cross-invocation Phase 4 timeout.

### Tier 1: RSS job limit

- Give each RSS job its own 24-hour limit.
- Measure job duration with worker-node timestamps, not coordinator poll time.
- For `queued` or `running`, compare the current time with the validated `createdAt`.
- For a terminal job, require valid `createdAt` and `endedAt` values and calculate `endedAt - createdAt`.
- Accept a successful terminal result only when `endedAt - createdAt <= 24 hours`.
- A job that runs longer than 24 hours is timed out and its result is never trusted, even if a later poll finds it completed successfully.
- Include time spent queued and running.
- A replacement RSS job receives a new 24-hour limit measured from its own timestamps.

### Tier 2: Weekly run continuation window

- Keep the existing 72-hour run-age rule measured from `runStartedAt`.
- A trigger within that window may continue the run and inspect or replace its saved RSS job.
- A continuation does not inherit an expired 24-hour limit from an earlier job.
- A trigger after the 72-hour window follows the existing run-selection policy and starts a new run.

No additional Tier 2 timer or field is required.

## Status Polling Policy

- Poll the saved job every 5 minutes.
- Do not overlap requests. Schedule the next poll only after the current request finishes.
- Give each status or cancellation request a 60-second timeout.
- Allow 2 consecutive transient status-request failures and stop monitoring on the third.
- Reset the consecutive-failure count after a valid status response.
- Treat request timeouts, connection failures, and temporary server errors as transient.
- Stop immediately for permanent errors, such as authorization failure or an invalid request.
- Record a monitoring stop as an unverified outcome rather than claiming the RSS job itself failed.

## Job Identity Validation

Validate more than the saved job ID because worker-node IDs can be reused.

- Require `endpointName` to equal `/request-google-rss/start-job`.
- Require valid `createdAt`; require valid `endedAt` for a terminal result.
- Require `createdAt` to be at or after the persisted Phase 4 start time.
- Treat HTTP 404, an endpoint mismatch, or an older creation time as an unavailable saved job.

## Terminal Outcome Mapping

1. `queued` or `running` within 24 hours: continue monitoring.
2. `completed` with `endingReason = queries_exhausted` and `endedAt - createdAt <= 24 hours`: verified terminal success.
3. `completed` with `endingReason = error` or `rate_limited`: unsuccessful terminal result.
4. `failed`, including `failureReason = worker_restart`: unsuccessful and unverified.
5. `canceled`: unsuccessful and unverified.
6. `target_articles_collected`: invalid because ops does not send `targetArticlesAddedCount`.
7. A malformed status, result, or timestamp: invalid response.
8. Any job with `endedAt - createdAt > 24 hours`: timed out; never trust its result.

An individual query failure that does not stop the worker is compatible with `queries_exhausted` and does not prevent Phase 4 completion. A rate limit or overall error that stops the remaining query loop is not an accepted success.

## Timed-Out Job Cancellation

Cancel an RSS job found `queued` or `running` after its 24-hour limit. This releases worker-node's global queue rather than allowing the timed-out job to block other workflows.

1. Send one cancellation request for the validated job ID.
2. Validate `outcome = canceled` or `outcome = cancel_requested`.
3. After `cancel_requested`, wait one normal 5-minute poll interval before checking status again.
4. Verify the job is no longer `queued` or `running` before considering a replacement.
5. Never trust the timed-out job's result, regardless of the terminal state eventually reported.

If cancellation fails, times out, returns an invalid response, or cannot be verified, stop Phase 4 and do not start another job.

If the current coordinator invocation originally started the timed-out job, stop after verified cancellation because that invocation has already used its one allowed start. A later continuation may replace it.

If the timed-out job came from an earlier invocation and cancellation is verified, the current invocation may start one replacement job.

If the cancel endpoint reports the job missing, perform one status lookup. Treat a confirmed 404 as unavailable and eligible for replacement. If the lookup cannot verify that the job is inactive, stop without replacement.

## Interrupted Coordinator Recovery

Persist `rssJobId` as soon as the start response is validated. When an incomplete run continues, inspect the saved job before starting another RSS invocation.

Apply these outcomes:

1. A valid saved job within 24 hours that is queued or running is monitored.
2. A valid saved job with on-time verified success is processed.
3. An unavailable, failed, canceled, unsuccessfully completed, or terminally timed-out saved job is eligible for one replacement.
4. A timed-out active job must be canceled and verified inactive before replacement.

Start at most one RSS job during a coordinator invocation. Monitoring or canceling a job from an earlier invocation does not count as starting another job.

The replacement uses worker-node's existing 72-hour exact-query repeat suppression. It skips queries already requested and continues with eligible remaining queries.

If the coordinator stops after sending the start request but before persisting the returned job ID, a later continuation can start another job. Repeat suppression limits duplicated requests, and the unchanged Article high-water mark keeps all inserted Articles inside the downstream batch. Log this condition; do not add an idempotency-key system.

## Partial Query Outcomes and Logging

If one query fails or returns no articles:

- Worker-node logs the outcome and continues when its existing control flow permits.
- The individual outcome does not by itself fail Phase 4.
- Phase 4 can complete when the job reaches an on-time `queries_exhausted` result.

Keep detailed completed, skipped, empty, failed, and not-reached query information in worker or coordinator logs. Do not persist per-query results or aggregate query histories in `WeeklyArticleFlowRuns02`.

Persist only job identity, high-water marks, first RSS IDs, worker-reported RSS-added count when available, Phase 4 status, timestamps, compact terminal outcome, and downstream `articleCount`.

## RSS-Added Result and Downstream Batch

Keep `rssArticlesAddedCount` separate from `articleCount`.

- Record the worker-reported RSS result when available for logs and diagnosis.
- Do not treat a missing result after worker failure as zero.
- Do not let a later zero replacement result erase an earlier persisted nonzero result.
- Do not use the RSS-only result for downstream targeting.
- Do not build or persist a pure list of RSS-only Article IDs.

After on-time verified success, use `articleCount = COUNT(*) FROM Articles WHERE id > articleIdHighWaterMark`.

This includes Articles inserted by other processes after Phase 4 began. Save and pass the same `articleCount` unchanged to state assignment and AI Approver V02 in later increments.

## Completion Rules

Require an on-time verified RSS terminal success before completing Phase 4, even when Articles exist above the high-water mark.

1. If `articleCount = 0`, atomically record Phase 4 completion and mark the run complete. Log that RSS completed normally but the broader batch contained no new Articles.
2. If `articleCount > 0`, record Phase 4 completion, keep the run incomplete, and stop at the Phase 5 boundary.

The atomic zero-work update records Phase 4 completion, the available RSS result, `articleCount = 0`, `runCompleted = true`, and `runCompletedAt` in one database update.

## Coordinator Flow

1. Select or create the run using the existing 72-hour policy.
2. Execute Phases 1–3 only when they are not already complete.
3. For a new Phase 4, read both high-water marks and persist them with Phase 4 start before any worker request.
4. For a continued Phase 4, reuse the persisted marks.
5. Inspect the saved job and validate its identity, timestamps, status, and 24-hour duration.
6. Monitor, cancel, replace, or stop according to the recovery policy, starting at most one job in the invocation.
7. Require an on-time verified `queries_exhausted` result.
8. Recover the first RSS request and Article IDs from PostgreSQL when present.
9. Count every Article above the persisted Article high-water mark.
10. Apply atomic zero-work completion or persist nonzero Phase 4 completion and stop at the Phase 5 boundary.

Route Phase 4 failures through the existing failure recorder with `phase: 4`. Never convert an unavailable result, timeout, cancellation, failed job, rate limit, or overall worker error into healthy zero-work.

## Persistence and Schema

Extend the typed persistence interface with focused operations for:

- Reading both high-water marks.
- Starting Phase 4 with immutable high-water marks.
- Recording the RSS job ID and compact progress.
- Recovering the first post-mark RSS request and RSS Article IDs.
- Counting all post-mark Articles.
- Recording nonzero Phase 4 completion.
- Atomically recording zero-work Phase 4 and run completion.

Add `newsApiRequestIdHighWaterMark` and `articleIdHighWaterMark` as nullable typed columns on `WeeklyArticleFlowRuns02`. They are null before Phase 4 and immutable after Phase 4 starts.

Follow the existing schema rollout requirements before deployed code exports the changed model. The implementation todo must include backup, drop, create, replenish, grant, and verification checkpoints. Keep automated persistence tests database-free.

## Configuration

Add the worker-node base URL and Phase 4 settings:

- Poll interval: 5 minutes.
- Per-request timeout: 60 seconds.
- Tolerated consecutive transient status failures: 2.
- Per-RSS-job timeout: 24 hours.

The existing run-selection code supplies the 72-hour continuation window; do not add a duplicate setting.

Validate URLs and positive integers with existing `OpsConfig` conventions. Document the settings in `ops/.env.example` and `ops/README.md`.

## Verification

Add phase-module tests for:

- Start, status, and cancellation response parsing.
- Job identity and timestamp validation.
- `endedAt - createdAt` at, below, and above 24 hours.
- Queued and running age measured from `createdAt`.
- `queries_exhausted`, `error`, `rate_limited`, `failed`, `worker_restart`, and `canceled` outcomes.
- Five-minute non-overlapping polling and the 60-second request timeout.
- Transient failure increment, reset, and stop on the third consecutive failure.
- Queued cancellation, active cancellation request, and terminal cancellation verification.
- Cancellation failure or unverified cancellation preventing replacement.
- Refusal to trust a late terminal result.

Extend persistence tests for:

- Atomically persisting both high-water marks at Phase 4 start.
- Keeping marks immutable across continuation and replacement.
- Recovering first RSS IDs after worker restart.
- Counting all Articles above the Article mark, including non-RSS inserts.
- Preserving a missing RSS result as unknown rather than zero.
- Atomic zero-work Phase 4 and run completion.
- Atomic update failure leaving neither completion state persisted.

Extend coordinator tests for:

- Phase order and continuation without repeating Phases 1–3.
- Continuation after the original Phase 4 is older than 24 hours but the run is within 72 hours.
- A replacement receiving its own 24-hour limit.
- A timed-out active job being canceled before replacement.
- A current-invocation timeout stopping after cancellation without a second start.
- An earlier-invocation timeout allowing one replacement after verified cancellation.
- Missing-job cancellation and status confirmation.
- At-most-one RSS start per coordinator invocation.
- Worker restart after inserting Articles but before producing a result.
- A zero-result replacement still counting the earlier inserted Articles.
- Inclusion of non-RSS Articles above the high-water mark.
- Verified zero work completing the run and unverified zero remaining a failure.
- Nonzero success stopping at the Phase 5 boundary without completing the run.

Run the db-models build first, then the ops type check, tests, and build. Worker-node code should not require changes, but run its build and tests if implementation changes its contract. Default ops tests use injected worker and persistence fakes rather than PostgreSQL, worker-node, or package `.env` files.

## Known Boundary Limitation

PostgreSQL sequences assign IDs before transaction commit. An unrelated transaction can reserve a lower Article ID before the high-water read and commit it afterward. That late commit falls below the saved mark and is not included in this batch.

Exact cross-process cohort coverage is not required. Document this limitation; do not add transaction-wide coordination.

## Documentation Alignment

Before implementation, update the authoritative weekly-flow-v02 PRD to record the operator-approved high-water boundary, broader source-agnostic `articleCount`, zero-work rule, two-tier time policy, and timed-out job cancellation.

Update `ops/README.md` with the worker contract, settings, high-water boundary, broader batch, identity validation, timestamp-based timeout, cancellation behavior, continuation recovery, terminal mapping, logging behavior, zero-work completion, and Phase 5 boundary.
