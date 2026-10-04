---
created_at: 2026-10-04T18:20:34Z
updated_at: 2026-10-04T18:24:21Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Weekly Combined Flow PRD V10

## Purpose

Build a weekly article-processing flow in `ops/` inside NewsNexus12. The operator must understand how it starts, progresses, logs its work, and recovers. Use TypeScript on the Ubuntu 24.04.5 LTS development and production servers, with systemd `.timer` and `.service` units for scheduled execution.

This version carries forward [V09](20261003_weekly_combined_flow_prd_v09.md). It adds the operator-approved Phase 4 high-water boundaries, broader Article batch, worker monitoring contract, per-job timeout, timed-out job cancellation, and continuation behavior.

The persistence implementation details remain in [Persistence Plan V03](20261003_weekly_flow_02_persistence_plan_v03.md), supplemented by the Phase 4 changes defined here and in [Phase 4 Plan V06](20261004_ops_rss_collection_plan_v06.md).

Phase 1–3 failures do not require an operator gate before a later trigger. This version preserves the Phase 3 recovery boundary and distinguishes an expected overlap rejection from a guard failure.

## Terminology

- Weekly flow or weekly pipeline: the complete ordered sequence of phases. “The flow” or “the pipeline” may mean this when context is clear.
- Phase: one step, such as database backup, RSS collection, semantic scoring, state assignment, or AI Approver V02. Use “phase” instead of “phase flow” or “phase pipeline.”
- Phase module: the code responsible for starting and monitoring a particular phase, exposing its inputs and reporting its outcome.
- Coordinator: the code that controls phase order, passes inputs, records progress, and manages stopping or restarting. It has its own logging.
- Run: one execution of the weekly flow, identified by a run ID. Continuing a run preserves that identity; starting a new run creates another identity.
- High-water mark: the highest persisted database ID immediately before Phase 4 starts. IDs above the mark define records inserted after the Phase 4 boundary.

## Inside-out Implementation

Inside-out means growing the coordinator around working phase modules, starting with Phase 1. Build in small increments that the operator can read, run, and discuss. These are implementation increments, separate from the seven runtime phases below.

1. Begin with bare coordinator scaffolding in `ops/`: a minimal entry point, logging, and a call to the Phase 1 module. The first iteration only triggers that module and logs that it started.
2. Work on Phase 1 with the operator. Explain its worker-python HTTP call, inputs, completion response, and logs. Worker-python owns the database clearing. Extend the coordinator only as that module needs it.
3. Review each small working increment with the operator before proceeding. Explain what the code does and demonstrate its behavior.
4. Add subsequent phase modules one at a time. Discuss the start command or API, monitoring options, completion criteria, recovery behavior, and logging before implementing each connection.
5. Discuss article-level failures and other recovery decisions while building the affected module. Do not treat deferred decisions as permission to create a general failure framework.
6. Write readable code with descriptive names, straightforward control flow, and focused functions. Use comments for intent, assumptions, and non-obvious behavior; avoid narrating every line or adding premature abstractions.

The operational requirements below describe the completed feature. Add persistence, completion monitoring, recovery, single-execution protection, and scheduled deployment progressively with operator involvement.

## Coordinator Logging

Use `worker-node/src/modules/logger.ts` as the logging reference. The coordinator needs its own logger and application identity so its activity can be followed independently of worker logs.

1. Match worker-node's Winston structure: `YYYY-MM-DD HH:mm:ss [LEVEL] message key=value`. Preserve error stacks and render non-string metadata as JSON values.
2. Follow the same environment behavior: development uses console output at debug level; testing uses console and file output at info level; production uses file output at info level.
3. Use `NODE_ENV`, `NAME_APP`, `PATH_TO_LOGS`, `LOG_MAX_SIZE`, and `LOG_MAX_FILES`. Use a coordinator-specific `NAME_APP` so its log file cannot collide with worker-node's file.
4. Match the readable workflow-start separator and heading convention. Add run ID, phase, job ID, status, counts, elapsed time, and actionable errors as those fields become available.
5. Add completion, stop, resume, cancellation, and failure events alongside the corresponding behavior. Never report a phase as completed merely because its job started.
6. Keep credentials and secret values out of logs. Document file location, rotation, permissions, and how to correlate coordinator and worker records.
7. Keep detailed Phase 4 per-query outcomes in worker or coordinator logs. Do not store per-query histories in `WeeklyArticleFlowRuns02`.

Journald captures service output. Production application events remain in the configured coordinator log file under the matching worker-node convention.

## Single Execution and Trigger Policy

1. Allow only one weekly-flow-02 coordinator process to be active.
2. Reject every additional manual or scheduled trigger immediately. Never queue it for later execution.
3. Do not automatically enqueue a replacement run. The operator may trigger another run after the active process ends.
4. Apply the same rule to manual commands and the weekly systemd trigger.
5. Keep overlap prevention outside `WeeklyArticleFlowRuns02`; do not add leases, lock versions, or queued-run fields.
6. Use the same-host kernel file-lock guard defined in Persistence Plan V03. Do not use a database activity flag or stale-lock timeout.
7. When another coordinator holds the lock, log the rejection and exit without creating a run row or starting a phase.
8. Treat an occupied-lock rejection as an expected no-op. It remains visible in the terminal or journald but does not mark the systemd service failed.
9. Treat an unavailable or malfunctioning guard as a real failure. Never run the coordinator without confirmed protection.
10. Within one coordinator invocation, start at most one job for a phase and verify that job before advancing.

The current deployment model has one Ubuntu host and one operational checkout. Cross-host coordination is outside this requirement.

## Supported Execution Paths

1. Every operational Ubuntu launch path uses the same single-execution guard.
2. Any direct command that bypasses the guard is unsupported for operational use.
3. Local macOS development does not provide the Ubuntu guard and must not target a shared server database.
4. Scheduled and production execution uses systemd process-group handling so stopping the service also terminates its phase child processes.

Command names, lock location, conflict code, rejection output, and development-server precautions are defined in Persistence Plan V03 and its implementation TODO.

## Data and Targeting Decisions

1. Keep independently runnable phase modules and the coordinator in `ops/`, using TypeScript so they can join the Node workspace.
2. Store durable progress in PostgreSQL. Use `WeeklyArticleFlowRuns02` without changing unrelated tables for flow metadata. Never restore the legacy `WeeklyArticleFlowRuns` CSV into it.
3. Add nullable typed `newsApiRequestIdHighWaterMark` and `articleIdHighWaterMark` columns to `WeeklyArticleFlowRuns02`. They remain null before Phase 4 and become immutable when Phase 4 starts.
4. Persist both high-water marks with the Phase 4 start before invoking worker-node. Use zero when the corresponding source table is empty.
5. Recover and save the first post-mark Google News RSS request ID and its first associated Article ID when they exist. Keep these RSS-specific markers across continuation and replacement jobs.
6. After verified RSS completion, calculate `articleCount` once using `COUNT(*)` from Articles where `id > articleIdHighWaterMark`.
7. Save and pass that same `articleCount` unchanged to state assignment and AI Approver V02. Do not reduce it based on state-assignment outcomes.
8. The downstream batch intentionally includes Articles inserted by other processes after the Phase 4 boundary. It is not a pure RSS cohort.
9. Keep the worker-reported `rssArticlesAddedCount` separate from `articleCount`. Use it for logging and diagnosis, not downstream targeting.
10. A missing RSS-added result after worker failure is unknown, not zero. A later replacement result of zero does not erase an earlier persisted nonzero result.
11. Do not save a list of RSS Article IDs or build a pure RSS-only count for downstream targeting.
12. Semantic scoring processes its existing unscored backlog, without an RSS count or Article-ID range.
13. Exact cross-process cohort coverage is not required. State assignment and V02 retain their existing selection rules.
14. Use `docs/weekly-article-flow-v01/` only for operational warnings about permissions, ownership, service hardening, and configuration. Do not use its architecture as the design for this feature.

PostgreSQL sequences assign IDs before transaction commit. A transaction can reserve a lower Article ID before the high-water read and commit later. That Article falls below the saved mark and is outside this batch. Do not add transaction-wide coordination for this accepted boundary limitation.

## Required Phase Order

1. Call worker-python's `DELETE /deduper/clear-db-table` to stop only deduper jobs and clear `ArticleDuplicateAnalyses`, preserving the table and schema. Validate its successful completion response before advancing.
2. Create a database backup with db-manager's `--create_backup`. Record its outcome and location before proceeding.
3. Delete old articles using db-manager's default `--delete_articles` behavior.
4. Persist the request and Article high-water marks, then run worker-node Google News RSS collection. Monitor the job, recover the first RSS IDs, record the worker result when available, and calculate the broader post-mark `articleCount` after verified completion.
5. Start worker-node semantic scoring with its ordinary untargeted behavior. Monitor and record the job outcome.
6. Start worker-node AI state assignment with `targetArticleStateReviewCount = articleCount` and an operator-reviewed `targetArticleThresholdDaysOld`. Record selected, completed, skipped, and failed work.
7. Preview and start AI Approver V02 with `selectionMode = article_position_count`, `requestedArticleCount = articleCount`, description fallback enabled, and scanning past the approved boundary enabled. Monitor and record its result without recalculating the count.

V02 selects the newest `articleCount` Article positions, then applies state-assignment and other eligibility rules. It can process fewer articles than requested and does not extend that window to replace skipped articles. A preview reporting no eligible articles becomes a logged zero-work outcome for the coordinator.

## Phase 1 Endpoint Prerequisite

- Implement and verify the [Worker Python Deduper Clear PRD](20261001_worker_python_deduper_clear_prd_v01.md) before connecting the working Phase 1 module.
- Every endpoint call cancels only deduper jobs, waits for running deduper work to stop, and then clears the table. Remove cancellation of unrelated workflows entirely. Keep worker-python running.
- Worker-python owns protection against concurrent deduper writes and the bounded cancellation wait.
- Ops makes the HTTP request and logs the confirmed cancellation and deletion results. It does not delete analysis rows directly.
- A timeout, failed request, or unsuccessful response must not be reported as Phase 1 completion or trigger Phase 2.

## Phase 4 Worker Contract

Use worker-node's existing queue interfaces:

- Start: `POST /request-google-rss/start-job`.
- Status: `GET /queue-info/check-status/:jobId`.
- Cancellation: `POST /queue-info/cancel_job/:jobId`.
- Do not send `targetArticlesAddedCount`.
- Use the existing default `doNotRepeatRequestsWithinHours` value of 72 hours.

The start response must contain the RSS job ID, status, and endpoint name. Validate saved jobs using the job ID, `endpointName = /request-google-rss/start-job`, and a valid `createdAt` at or after the persisted Phase 4 start.

Treat HTTP 404, an endpoint mismatch, or an older creation time as an unavailable saved job. This protects against job-ID reuse after the worker job store is replaced or emptied.

Interpret job outcomes as follows:

1. `queued` or `running`: active and monitorable while inside the job's 24-hour limit.
2. `completed` with `endingReason = queries_exhausted`: verified success only when the job completed within 24 hours.
3. `completed` with `endingReason = error` or `rate_limited`: unsuccessful; do not complete Phase 4.
4. `failed`, including `failureReason = worker_restart`: unsuccessful and unverified.
5. `canceled`: unsuccessful and unverified.
6. `target_articles_collected`: invalid because ops does not send a target.
7. Missing or malformed identity, timestamps, status, or result: invalid and unverified.

An individual query failure or empty result does not fail Phase 4 when the worker continues and ultimately reaches an accepted `queries_exhausted` result. A rate limit or overall error that prevents remaining queries from running is not successful completion.

## Phase 4 Monitoring and Time Policy

1. Poll every 5 minutes without overlapping requests.
2. Give each status or cancellation request a 60-second timeout.
3. Allow 2 consecutive transient status-request failures and stop on the third.
4. Reset the consecutive-failure count after a valid status response.
5. Treat timeouts, connection failures, and temporary server errors as transient.
6. Stop immediately for permanent request errors, such as authorization failure or an invalid request.
7. Record a monitoring stop as an unverified outcome rather than claiming the RSS job failed.

Use two time scopes:

- Tier 1 is a 24-hour limit for each RSS job. For an active job, compare current time with `createdAt`. For a terminal job, require `endedAt - createdAt <= 24 hours`. Time spent queued counts.
- Tier 2 is the existing 72-hour run continuation window measured from `runStartedAt`. A replacement job receives its own Tier 1 limit. Do not add another Tier 2 field or setting.

A job that exceeds 24 hours is timed out and its result is never trusted, even if it later reports success.

## Timed-Out Job Cancellation

Cancel a validated RSS job that remains `queued` or `running` after 24 hours. This prevents it from continuing to block worker-node's single global queue.

1. Send one cancellation request.
2. Accept only `outcome = canceled` or `outcome = cancel_requested`.
3. After `cancel_requested`, wait one normal poll interval and check status again.
4. Verify the job is no longer `queued` or `running` before considering replacement.
5. Never trust the timed-out job's result.

If cancellation fails, times out, returns an invalid response, or cannot be verified, stop Phase 4 and do not start another job.

If the current coordinator invocation started the timed-out job, stop after verified cancellation. A later continuation may replace it.

If the timed-out job came from an earlier invocation and is verified inactive, the current invocation may start one replacement job.

If cancellation reports the job missing, perform one status lookup and apply these outcomes:

1. A confirmed status 404 means the job is unavailable and eligible for replacement.
2. A terminal job status confirms the job is inactive and eligible for replacement. Never trust its late result, including a successful result.
3. An unverified status lookup stops Phase 4 without replacement.

## Progress and Recovery

1. Persist every phase start before invoking external work and persist verified outcomes before advancing.
2. Record run and phase timestamps, status, job IDs, Phase 4 high-water marks, first RSS IDs, both counts, backup location, and relevant errors.
3. If the flow stops during Phases 1–3, leave the old run incomplete. The next trigger starts a new run at Phase 1 without an outcome check.
4. If Phase 4 was started, continuation reuses its original high-water marks and inspects its saved RSS job before starting another.
5. A valid saved job that is active and within 24 hours is monitored. A valid on-time success is processed.
6. An unavailable, failed, canceled, unsuccessfully completed, or terminally timed-out saved job is eligible for one replacement.
7. A timed-out active job must be canceled and verified inactive before replacement.
8. Within one coordinator invocation, start at most one RSS job. Monitoring or canceling a job from an earlier invocation does not count as starting one.
9. Use worker-node's existing exact-query repeat suppression for replacement. Do not add a coordinator deduplication system.
10. If the coordinator stops after sending a start request but before persisting the returned job ID, a later continuation may start another job. Repeat suppression limits duplicate requests, and the unchanged high-water marks preserve the Article range.
11. Decide later-phase partial-result and article-level failure handling while implementing those modules. Phase 4 decisions do not create a general retry framework.

## Run Completion and Checkpoints

- Use `runCompleted` in `WeeklyArticleFlowRuns02`: `false` means incomplete and `true` means complete. Do not add other run lifecycle statuses.
- Require an on-time verified RSS success before applying a Phase 4 completion rule, even when Articles already exist above the mark.
- After verified Phase 4 success, calculate the broader `articleCount` once.
- If `articleCount = 0`, atomically record Phase 4 completion and set `runCompleted = true` with `runCompletedAt`.
- If `articleCount > 0`, complete Phase 4, leave the run incomplete, and advance to the Phase 5 boundary.
- Set `runCompleted = true` after the final phase finishes or when the final V02 preview has no eligible articles.
- Zero work in another intermediate phase does not by itself finish the weekly flow.
- Interrupted runs remain `runCompleted = false`. When a new run replaces one, leave the older row unchanged.
- Record the last phase reached and enough progress to distinguish started work from verified completion.
- Continuing a run preserves its original start time, run ID, high-water marks, first RSS IDs, and finalized `articleCount`.
- For recovery decisions, “past Phase 3” means Phase 3 is recorded as completed. A run where Phase 3 started but did not complete remains within the Phase 1–3 restart rule.

## Scheduling and CLI Controls

1. Schedule Friday at 05:00 in `America/Los_Angeles`, using `OnCalendar=Fri *-*-* 05:00:00 America/Los_Angeles`.
2. A trigger without arguments examines only the last `WeeklyArticleFlowRuns02` row. It never searches older rows for incomplete work.
3. Measure run age from the original `runStartedAt`. Use the 72-hour RSS repeat window for stopped-work selection.

| Last run | Default action |
| --- | --- |
| No previous run | Start a new run at Phase 1. |
| `runCompleted = true` | Start a new run at Phase 1. |
| Incomplete and stopped during Phases 1–3 | Start a new run at Phase 1, regardless of age. |
| Incomplete, past Phase 3, and older than 72 hours | Start a new run at Phase 1. |
| Incomplete, past Phase 3, and within 72 hours | Continue from the interrupted phase, or the next phase if the previous one completed. |

- Exactly 72 hours remains within the window. Only an age greater than 72 hours starts a new run under the age rule.
- Apply the single-execution guard before stopped-run recovery.
- Provide an explicit CLI option to continue an incomplete run by run ID.
- Without a supplied ID, explicit continuation inspects the last run only and never searches older incomplete rows.
- Provide a separate explicit option to start a new run when the default action would continue a recent incomplete run.
- Phases 1–3 always require a new run rather than continuation.
- Deliberate selection of an older run requires an explicit run ID.
- Keep systemd units thin. Review service user, working directory, environment paths, permissions, guard behavior, process-group behavior, and logs before installation.

## Schema Rollout

- Add `newsApiRequestIdHighWaterMark` and `articleIdHighWaterMark` as nullable typed columns before deployed Phase 4 code uses them.
- Grant application-role access before any deployed backup or service code exports the changed model.
- Use the established backup, drop, create, and replenish workflow while the environment permits schema rebuilds.
- Take the replenish backup with the old model build so backup code never references columns that do not exist yet.
- Build the new model, drop, create, replenish, restore grants, and verify both columns.
- Verify db-manager and API backups after the rebuilt schema is ready.
- Use an idempotent migration or installer first if an environment must retain its live database without a rebuild.

Persistence Plan V03 defines the ordered development-server procedure.

## Verification and Rollout

- Demonstrate and verify each small increment at the scope implemented.
- Verify phase order, backup results, high-water capture, first RSS ID recovery, broad Article counting, and both Phase 4 completion branches.
- Verify the worker status mapping, identity checks, five-minute polling, 60-second request timeout, failure counter, and per-job 24-hour duration from worker timestamps.
- Verify queued and active cancellation, terminal cancellation confirmation, replacement eligibility, one-start enforcement, and cancellation failure behavior.
- Verify continuation more than 24 hours after Phase 4 started but within 72 hours of `runStartedAt`.
- Verify a worker restart after Article insertion followed by a zero-result replacement still includes the earlier Articles.
- Verify that detailed query results remain in logs and do not expand run-table metadata.
- Keep default coordinator tests database-free and inject fake persistence, clock, delay, and worker dependencies.
- Do not point automated tests at `newsnexus_dev` or `newsnexus_prod`.
- Verify on Ubuntu that an overlapping trigger is an expected no-op, creates no run row, and starts no phase.
- Verify that a guard setup or execution failure marks the service failed and does not start the coordinator.
- Review the development service, timer, permissions, guard behavior, process-group behavior, and logs before production rollout.
- Verify a manual production run with the operator before relying on the production timer.
