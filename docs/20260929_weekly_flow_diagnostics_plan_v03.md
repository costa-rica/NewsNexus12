---
created_at: 2026-09-29T21:41:46Z
updated_at: 2026-09-29T21:41:46Z
created_by: codex (gpt-6) macbook-air
modified_by: codex (gpt-6) macbook-air
---

# Dev weekly flow reproduction plan v03

## Direction and scope

- Target only `nws-nn12dev`. Reproduce the full weekly workflow through systemd, including its normal maintenance, ingestion, scoring, and downstream stages.
- Install a service matching the repository's production service template and a dev-only, one-time timer. Schedule execution five minutes after preparation and validation finish, not five minutes after receiving the request.
- Collect minimal worker measurements before the run so a repeated reset is more informative than the previous attempt.
- This document supersedes [v02](20260929_weekly_flow_diagnostics_plan_v02.md) and responds to [Claude's assessment](20260929_weekly_flow_diagnostics_plan_v02_assessment_claude.md). Preserve prior documents.
- The present deliverable is the plan. No remote setup or workflow execution happens while writing it. Follow the plan-and-vet review and todo stages before implementation.

## Decisions from the assessment

1. Make the complete, timer-triggered dev workflow the first reproduction target. Synthetic tests and standalone semantic-job loops are deferred.
2. Move minimal worker responsiveness and memory measurements before the real run.
3. Record process age, memory, runtime version, and preceding RSS activity. Do not restart the worker immediately before semantic scoring or inject artificial memory pressure into this baseline.
4. Leave production scheduling and potential production retry fixes outside this plan. They do not block dev work.
5. Use one scheduled run per observation batch. Non-reproduction leads to an evidence review and a deliberately chosen next condition, not an automatic rerun loop or an arbitrary end to the investigation.

## Components

1. Coordinator code and diagnostics remain in `ops/weekly-article-flow`.
2. Minimal semantic initialization measurements belong in `worker-node`; this part necessarily extends beyond the ops folder.
3. Host configuration belongs in `/etc/systemd/system/` and `/etc/newsnexus12/` on dev. Do not change the repository's recurring production timer to implement the one-time dev schedule.
4. Use journal output for the coordinator and the worker's configured log destinations. Keep the actual installed unit definitions and effective settings with the run evidence.

## Dev preparation

- Verify the hostname is `nws-nn12dev` before any system-level write. Confirm the checkout, branch/revision, Node version, worker endpoints, and database host resolve to dev resources. Matching database names do not establish that the target is dev.
- Inspect existing units and drop-ins before installation. Preserve their contents and enabled/active states. Account for any overrides when comparing the effective configuration with the repository template.
- Confirm no weekly run, maintenance subprocess, or conflicting worker job is active. A stale running database record needs investigation and explicit recovery; do not delete it or bypass the active-run guard.
- Validate `/etc/newsnexus12/weekly-article-flow.env` as readable by `limited_user`, using `newsnexus_app` for the dev database. Preserve an existing working file; do not overwrite it blindly from an example or print credentials.
- Run the existing configuration check as `limited_user` with that environment file and `--mode scheduled_production`.
- Confirm required builds, external services, and log destinations are ready. Record known downstream dev problems separately; do not skip stages or change model configuration merely to reach semantic scoring.

## Minimal diagnostics before scheduling

- Retain coordinator poll timings, job identity, HTTP status when available, nested transport errors, and cancellation results. Extend existing events only where necessary; do not duplicate them.
- Measure semantic initialization start/end and first article attempt with the existing job ID. Include existing selected counts without additional database queries.
- Capture process uptime, RSS, heap, external memory, event-loop delay/utilization, and delayed sampling at initialization boundaries and at most once per second during initialization.
- Use supported Node APIs and monotonic durations alongside UTC timestamps. Label measurements as process-wide and report delayed samples after the loop resumes; missing samples do not mean zero delay.
- Keep `WEEKLY_FLOW_DIAGNOSTICS_ENABLED` for optional coordinator detail and `WORKER_HTTP_DIAGNOSTICS_ENABLED` for worker detail, both default off. Scope worker detail to the relevant workflow; do not add detailed logging to all endpoints.
- Limit each detailed initialization window to 15 minutes and 1,000 records per side. Preserve normal errors and one suppression/final summary after the limit. Clean up collectors on every terminal path and use unreferenced timers.
- Exclude bodies, article text, SQL text, credentials, and environment dumps. Logging failures must not change workflow outcomes.
- Preserve pooling, request count, polling cadence, timeouts, cancellation, eligibility, and queue concurrency. No retries, dispatcher replacement, correlation-header expansion, socket ring, or new socket-error handlers in this baseline.
- If loading diagnostics requires a worker restart, perform it while dev is idle before scheduling, and record the restart. Keep that same worker process through RSS and semantic scoring; this fresh process remains a documented difference from production.

## Dev systemd service

1. Install `ops/weekly-article-flow/systemd/newsnexus12-weekly-article-flow.service` as `/etc/systemd/system/newsnexus12-weekly-article-flow.service`, with root ownership and standard unit-file permissions.
2. Preserve the template's execution settings:
   - `User=limited_user` and `Group=limited_user`.
   - Working directory `/home/limited_user/applications/NewsNexus12`.
   - Environment file `/etc/newsnexus12/weekly-article-flow.env`.
   - Existing `run-weekly-flow --mode scheduled_production --allow-live-ai` command.
   - `Type=oneshot`, `TimeoutStartSec=73h`, journal output, `NoNewPrivileges=true`, and `PrivateTmp=true`.
3. Do not add automatic service restarts or enable the service to run at boot. The timer starts it for this experiment.
4. Preserve security restrictions even if alert publication fails. Record that failure separately from the semantic connection issue.

## One-time dev timer

1. Create `/etc/systemd/system/newsnexus12-weekly-article-flow.timer` on dev, pointing to `newsnexus12-weekly-article-flow.service`.
2. Use one absolute UTC `OnCalendar` date/time, calculated five minutes ahead after builds, diagnostics, and readiness checks have passed. Do not include the repository timer's recurring Friday expression or any repeat interval.
3. Set `Persistent=false`, `RandomizedDelaySec=0`, and `AccuracySec=1s`. This avoids a missed experiment firing unexpectedly after a later boot and keeps its intended start time clear; system load can still delay execution.
4. Before replacing an existing timer, stop it and preserve its previous state. Ensure effective timer settings contain only the intended one-time schedule, including any drop-ins.
5. Validate unit syntax and the calendar expression, reload systemd, then start the timer without enabling it at boot. Do not manually start the service for this test.
6. Check and report the resolved next trigger time in UTC and local time, target service, effective service settings, and timer state. If setup consumes the scheduled window, choose a fresh five-minute target and validate again before arming.
7. Once armed, watch the timer launch the service. Do not send another start command if startup appears slow. Confirm the invocation in the journal and identify the new workflow run ID.

## Verification and observation

- Before deployment, build affected packages and run relevant tests. Worker integration tests must use a dedicated test database because setup may drop/recreate it; never use `newsnexus_prod` for those tests.
- Compare diagnostics enabled and disabled for unchanged start/poll/cancel counts, error handling, collector cleanup, and bounded output. Test delayed sampling without placing the requesting client in the same process as the stalled server.
- Before arming the timer, verify effective units and configuration without starting the flow. The scheduled full workflow is a real run and performs its ordinary database writes and live AI work.
- Record coordinator and worker revisions/runtime versions, worker uptime, current resource use, effective resource limits, and clock alignment. Capture RSS duration and ingestion counts before semantic starts.
- Follow coordinator journal output and worker logs through semantic initialization, preserving original timestamps, job IDs, poll outcomes, cancellation evidence, and measurements.
- If the workflow fails, capture its final state and any still-active child job before recovery. Stopping the systemd service alone must not be assumed to cancel worker-owned jobs.
- After the run, stop the one-time timer and verify there is no future trigger. Do not restore an active recurring dev schedule automatically. Preserve logs before disabling diagnostic settings through normal service management.

## Interpretation and next batch

1. A reset with delayed worker measurements narrows the timing relationship but does not alone establish the TCP reset sender or cause.
2. No reset establishes that this particular systemd-driven dev run succeeded through semantic scoring. It does not clear differences in workload, heap state, runtime, associated-row counts, or host pressure.
3. Report the result before choosing another condition. Prefer an evidence-led comparison, such as a warm worker versus the baseline or a heavier preceding RSS workload, with bounded runs and measured resource use.
4. Defer packet capture, synthetic fixtures, real-job-only loops, and deeper transport hooks until the baseline identifies a specific evidence gap. Define their scope before adding them.
5. Do not change SQL selection or retry behavior while trying to reproduce the existing failure; those remain separate proposals.

## Completion and rollback

- Deliver the installed service/timer definitions, scheduled and actual start times, run/job IDs, relevant logs, measured conditions, and an explicit reproduced/not-reproduced finding with limits.
- Successful setup means the one-time timer actually launched the complete flow under the intended service configuration. Workflow failure is a test finding, not a reason to silently repeat it.
- Disarm the timer before any rollback. Restore saved unit contents/configuration as appropriate, reload systemd, and report their final states; do not accidentally rearm a recurring schedule.
- Diagnostics require no database migration. Full workflow writes are real and are not reversed by removing units or disabling logging.
