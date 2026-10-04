---
created_at: 2026-10-04T18:12:31Z
updated_at: 2026-10-04T18:12:31Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Plan V05

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

The persistence contract already exposes:

- `firstRssRequestId`
- `firstRssArticleId`
- `rssArticlesAddedCount`
- `articleCount`
- `rssJobId`

Phase 4 replaces the current boundary return with the new module. A verified outcome with Articles in the broader batch stops at the Phase 5 boundary with the run still incomplete. A verified outcome with no Articles in the broader batch completes the run.

## Existing Worker-Node Contract

Use the existing worker-node interfaces:

- Start RSS with `POST /request-google-rss/start-job`.
- Omit `targetArticlesAddedCount` so the worker attempts the complete query list.
- Use the existing default `doNotRepeatRequestsWithinHours` value of 72 hours.
- The start response is HTTP 202 with `jobId`, `status`, and `endpointName`.
- Read status with `GET /queue-info/check-status/:jobId`.
- Queue statuses are `queued`, `running`, `completed`, `failed`, and `canceled`.
- The completed RSS result contains `endingReason`, `endingMessage`, `articlesAddedCount`, and detailed `queryResults`.

The queue is global across worker-node workflows and runs one job at a time. Time spent queued counts toward that RSS job's 24-hour limit.

Worker-node stores jobs in its JSON job store. Startup changes jobs left `queued` or `running` to `failed` with `failureReason = worker_restart`. Old jobs can be pruned, and job IDs can be reused if the store is replaced or emptied.

The current worker result does not contain the first request or Article IDs. Phase 4 recovers those markers from PostgreSQL rather than expanding the worker result with mid-job ID reporting.

## Phase Module

Add a Phase 4 module under `ops/src/weekly-flow-02/phases/`, following the separation used by the existing phase modules.

- A phase-facing function accepts only the configuration and dependencies needed for RSS collection.
- A worker integration layer starts collection, validates the start response, monitors the saved job, validates job identity, and interprets terminal status and result data.
- Typed results and errors keep worker response details out of the coordinator.
- Failure categories distinguish connection, request timeout, unsuccessful HTTP response, invalid response, per-job monitoring timeout, permanent status error, unsuccessful terminal result, and unverified outcome.

Do not persist the worker's detailed `queryResults` in `WeeklyArticleFlowRuns02`.

## Article and Request High-Water Marks

Before the first RSS start request, read and persist:

- `newsApiRequestIdHighWaterMark`: the current maximum `NewsApiRequests.id`, or zero when the table is empty.
- `articleIdHighWaterMark`: the current maximum `Articles.id`, or zero when the table is empty.

Persist both typed values with the Phase 4 start before invoking worker-node. Keep them unchanged across coordinator restarts, saved-job monitoring, and replacement RSS jobs.

Add these two typed fields to `WeeklyArticleFlowRuns02` rather than placing them in an open-ended metadata structure. Update the db-model mapping and existing persistence record type.

After a verified RSS outcome, derive:

- `firstRssRequestId`: the lowest Google News RSS `NewsApiRequests.id` above `newsApiRequestIdHighWaterMark`, when one exists.
- `firstRssArticleId`: the lowest Article ID associated with those post-mark Google News RSS requests, when one exists.
- `articleCount`: the count of all Articles where `id > articleIdHighWaterMark`, regardless of source.

The high-water marks close the interruption gap where RSS inserts Articles but worker-node restarts before writing its result. A replacement job can report zero because repeat suppression skips completed queries, while the database-derived Article count still includes the Articles already inserted.

`firstRssArticleId` remains RSS-specific metadata. It is not the lower boundary used to calculate `articleCount`. The typed `articleIdHighWaterMark` defines the broader downstream batch required by the operator.

## Two-Tier Time Policy

Use two existing scopes rather than one cross-invocation Phase 4 timeout.

### Tier 1: RSS job limit

- Give each RSS job its own 24-hour limit.
- Measure the limit from the validated worker job's `createdAt` value.
- Include time spent queued and running.
- A job older than 24 hours is timed out and its result is never trusted, even if it later reports completion.
- A replacement RSS job receives a new 24-hour limit measured from its own `createdAt`.

### Tier 2: Weekly run continuation window

- Keep the existing 72-hour run-age rule measured from `runStartedAt`.
- A trigger within that window may continue the existing run and inspect or replace its saved RSS job.
- A continuation receives a fresh coordinator invocation; it does not inherit an expired 24-hour limit from an earlier job.
- A trigger after the 72-hour window follows the existing run-selection policy and starts a new run.

No additional Tier 2 timer or field is required. The coordinator already applies the 72-hour continuation rule.

## Status Polling Policy

- Poll the saved job every 5 minutes.
- Do not overlap status requests. Schedule the next poll only after the current request finishes.
- Give each status request a 60-second timeout.
- Allow 2 consecutive transient status-request failures and stop monitoring on the third.
- Reset the consecutive-failure count after a valid status response.
- Treat request timeouts, connection failures, and temporary server errors as transient.
- Stop immediately for permanent errors, such as authorization failure or an invalid request.
- Record a monitoring stop as an unverified outcome rather than claiming the RSS job itself failed.

## Job Identity Validation

When reading a saved job, validate more than its job ID because worker-node job IDs can be reused.

- Require `endpointName` to equal `/request-google-rss/start-job`.
- Require the job creation time to be at or after the persisted Phase 4 start time.
- Treat HTTP 404, an endpoint mismatch, or an older creation time as an unavailable saved job.

This validation prevents a reused job ID from attaching the weekly flow to another worker workflow or an older RSS run.

## Terminal Outcome Mapping

Interpret worker status and RSS results explicitly:

1. `queued` or `running`: continue monitoring while the job remains within its 24-hour limit.
2. `completed` with `endingReason = queries_exhausted`: verified terminal success only when the job completed within its 24-hour limit.
3. `completed` with `endingReason = error` or `rate_limited`: unsuccessful terminal result; do not complete Phase 4.
4. `failed`, including `failureReason = worker_restart`: unsuccessful and unverified; do not complete Phase 4.
5. `canceled`: unsuccessful and unverified; do not complete Phase 4.
6. `target_articles_collected`: invalid for this integration because ops does not send `targetArticlesAddedCount`.
7. A missing or malformed status or result: invalid response; do not complete Phase 4.

An individual query failure that does not stop the worker is compatible with `queries_exhausted` and does not prevent Phase 4 completion. A rate limit or overall error that stops the remaining query loop is not an accepted success.

## Interrupted Coordinator Recovery

Persist `rssJobId` as soon as the start response is validated. When an incomplete run continues, inspect the saved job before starting another RSS invocation.

Apply these outcomes:

1. A valid saved job that is queued or running and within 24 hours is monitored.
2. A valid saved job that completed successfully within 24 hours is processed.
3. A saved job that is unavailable, failed, canceled, unsuccessfully completed, or already ended after its 24-hour limit is eligible for one replacement RSS invocation.
4. A saved job that is still queued or running after 24 hours is timed out and never trusted. Do not start a second job while it might still be active. Stop Phase 4 and let a later trigger inspect it again.

Start at most one RSS job during a coordinator invocation:

- If the coordinator began by inspecting an earlier job that is safely replaceable, it may start one replacement job.
- If a job started during the current invocation becomes unsuccessful or unverified, stop Phase 4. A later trigger can continue the run and start a replacement.

If a later trigger finds the timed-out job has ended, it may start one replacement within the existing 72-hour run window. If the timed-out job remains active, the coordinator stops again without starting another job.

The replacement uses worker-node's existing 72-hour exact-query repeat suppression. It skips queries already requested and continues with eligible remaining queries.

If the coordinator stops after sending the start request but before persisting the returned job ID, a later continuation can start another job. Repeat suppression limits duplicated requests, and the unchanged Article high-water mark keeps all inserted Articles inside the downstream batch. Log this recovery condition; do not add an idempotency-key system.

## Partial Query Outcomes and Logging

If one query fails or returns no articles:

- Worker-node logs the outcome and continues when its existing control flow permits.
- The individual query outcome does not by itself fail Phase 4.
- Phase 4 can complete when the job reaches `completed` with `endingReason = queries_exhausted` within 24 hours.

Keep detailed completed, skipped, empty, failed, and not-reached query information in worker or coordinator logs. Do not persist per-query results or aggregate query histories in `WeeklyArticleFlowRuns02`.

Persist only job identity, high-water marks, first RSS IDs, worker-reported RSS-added count when available, Phase 4 status, timestamps, compact terminal outcome, and downstream `articleCount`.

## RSS-Added Result and Downstream Batch

Keep `rssArticlesAddedCount` separate from `articleCount`.

- `rssArticlesAddedCount` records the worker-reported RSS result when available and is useful for logs and diagnosis.
- A missing RSS-added result after worker failure must not be treated as zero.
- A later replacement result of zero must not erase an earlier persisted nonzero result.
- `rssArticlesAddedCount` does not define downstream targeting.
- Do not build or persist a pure list or count of RSS-only Article IDs for downstream targeting.

After verified terminal success within the job's 24-hour limit, use `articleCount = COUNT(*) FROM Articles WHERE id > articleIdHighWaterMark`.

This deliberately includes Articles inserted by other processes after Phase 4 began. Save and pass this same `articleCount` unchanged to state assignment and AI Approver V02 in later increments.

## Completion Rules

Require a verified RSS terminal success within that job's 24-hour limit before completing Phase 4, even when Articles already exist above the high-water mark.

After verified success:

1. If `articleCount = 0`, atomically record Phase 4 completion and mark the run complete. Log that RSS completed normally but the broader batch contained no new Articles.
2. If `articleCount > 0`, record Phase 4 completion, keep the run incomplete, and stop at the Phase 5 boundary.

Add one focused atomic persistence operation for the zero-work outcome. In one database update it records Phase 4 completion, the available RSS result, `articleCount = 0`, `runCompleted = true`, and `runCompletedAt`.

This prevents a stopped process from leaving Phase 4 completed while the run still appears incomplete.

## Coordinator Flow

Extend coordinator dependencies with the Phase 4 function and injected database-marker operations.

1. Select or create the run using the existing 72-hour policy.
2. Execute Phases 1–3 only when they are not already complete.
3. For a new Phase 4 attempt, read both high-water marks and persist them with Phase 4 start before any worker request.
4. For a continued Phase 4, reuse the persisted high-water marks without recalculating them.
5. Inspect a saved RSS job and validate its identity, status, and 24-hour age.
6. Monitor, replace, or stop according to the recovery policy, starting at most one job in the invocation.
7. Require a verified `queries_exhausted` result from a job that completed within 24 hours.
8. Recover the first RSS request and Article IDs from PostgreSQL when present.
9. Count every Article above the persisted Article high-water mark.
10. Apply the atomic zero-work completion or persist nonzero Phase 4 completion and stop at the Phase 5 boundary.

Route Phase 4 failures through the existing failure recorder with `phase: 4`. Never convert an unavailable result, monitoring timeout, failed job, cancellation, rate limit, or overall worker error into healthy zero-work.

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

Follow the existing schema rollout requirements before deployed code exports the changed model. The implementation todo must include the required backup, drop, create, replenish, grant, and verification checkpoints. Keep automated persistence tests database-free.

## Configuration

Add the worker-node base URL and explicit Phase 4 settings:

- Poll interval: 5 minutes.
- Per-status-request timeout: 60 seconds.
- Tolerated consecutive transient failures: 2.
- Per-RSS-job timeout: 24 hours.

The existing run-selection code supplies the 72-hour Tier 2 continuation window; do not add a duplicate configuration value for it.

Validate URLs and positive integers with the existing `OpsConfig` conventions. Document the settings in `ops/.env.example` and `ops/README.md`.

## Verification

Add focused phase-module tests for:

- Start and status response parsing.
- Job identity validation against endpoint and creation time.
- Queued and running monitoring.
- `queries_exhausted` success.
- `error`, `rate_limited`, `failed`, `worker_restart`, and `canceled` outcomes.
- Five-minute non-overlapping polling.
- The 60-second request timeout.
- Failure-counter increment, reset, and stop on the third consecutive transient failure.
- Per-job timeout measured from `createdAt`, including queued time.
- Refusal to trust a result from a job that ran longer than 24 hours.
- Malformed or unverified worker results.

Extend persistence tests for:

- Reading and atomically persisting both high-water marks at Phase 4 start.
- Keeping high-water marks immutable across continuation and replacement.
- Recovering first RSS IDs after a worker restart.
- Counting all Articles above the Article high-water mark, including non-RSS inserts.
- Preserving a missing RSS result as unknown rather than zero.
- Atomic zero-work Phase 4 and run completion.
- Failure of the atomic update leaving neither completion state persisted.

Extend coordinator tests for:

- Phase order through Phase 4.
- Continuation after Phase 3 without repeating Phases 1–3.
- A continuation more than 24 hours after original Phase 4 start but within 72 hours of `runStartedAt`.
- A replacement job receiving its own 24-hour limit.
- A timed-out job that is still active preventing a second job start.
- A later trigger replacing that timed-out job after it ends.
- Saved running-job monitoring without another start.
- Saved successful-job result processing.
- Saved unsuccessful or unavailable job replacement.
- At-most-one RSS start per coordinator invocation.
- Worker restart after inserting Articles but before producing a result.
- A zero-result replacement still finding and counting the earlier inserted Articles.
- Inclusion of non-RSS Articles above the high-water mark.
- Verified success with zero post-mark Articles completing the run.
- Unverified failure with zero post-mark Articles remaining a failure.
- Nonzero success stopping at the Phase 5 boundary without marking the run complete.

Run the db-models build first, then the ops type check, tests, and build. Worker-node code should not require changes for the database-marker approach, but run its build and tests if implementation changes its contract. Default ops tests use injected worker and persistence fakes rather than PostgreSQL, worker-node, or package `.env` files.

## Known Boundary Limitation

PostgreSQL sequences assign IDs before transaction commit. An unrelated transaction can reserve a lower Article ID before the high-water read and commit it afterward. That late commit falls below the saved mark and is not included in this batch.

Exact cross-process cohort coverage is not required by the weekly-flow-v02 design. Document this limitation in `ops/README.md`; do not add a transaction-wide coordination mechanism for it.

## Documentation Alignment

Before implementation, update the authoritative weekly-flow-v02 PRD to record the operator-approved high-water boundary, broader source-agnostic `articleCount`, zero-work rule based on that count, and two-tier time policy.

Update `ops/README.md` with the worker contract, Phase 4 settings, high-water boundary, broader Article batch, job identity validation, two-tier timeout policy, continuation recovery, terminal mapping, logging behavior, zero-work completion, and Phase 5 boundary.
