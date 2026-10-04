---
created_at: 2026-10-03T18:34:33Z
updated_at: 2026-10-03T20:51:33Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Weekly Combined Flow PRD V07

## Purpose

Build a weekly article-processing flow in `ops/` inside NewsNexus12. The operator must understand how it starts, progresses, logs its work, and recovers. Use TypeScript on the Ubuntu 24.04.5 LTS development and production servers, with systemd `.timer` and `.service` units for scheduled execution.

This version carries forward [V06](20261003_weekly_combined_flow_prd_v06.md) and resolves the recovery conflict identified in the [V06 assessment](20261003_weekly_combined_flow_prd_v06_assessment_claude.md). Phase 1–3 failures do not require an operator gate before a later trigger. It also defines the Phase 3 recovery boundary and fail-closed lock behavior.

## Terminology

- Weekly flow or weekly pipeline: the complete ordered sequence of phases. “The flow” or “the pipeline” may mean this when context is clear.
- Phase: one step, such as database backup, RSS collection, semantic scoring, state assignment, or AI Approver V02. Use “phase” instead of “phase flow” or “phase pipeline.”
- Phase module: the code responsible for starting and monitoring a particular phase, exposing its inputs and reporting its outcome.
- Coordinator: the code that controls phase order, passes inputs, records progress, and manages stopping or restarting. It has its own logging.
- Run: one execution of the weekly flow, identified by a run ID. Continuing a run preserves that identity; starting a new run creates another identity.

## Inside-out implementation

Inside-out means growing the coordinator around working phase modules, starting with phase 1. Build in small increments that the operator can read, run, and discuss. These are implementation increments, separate from the seven runtime phases below.

1. Begin with bare coordinator scaffolding in `ops/`: a minimal entry point, logging, and a call to the phase 1 module. The first iteration only triggers that module and logs that it started. It does not implement failure handling, recovery, retries, or the full weekly sequence.
2. Work on phase 1 with the operator. Explain its worker-python HTTP call, inputs, completion response, and logs. Worker-python owns the database clearing. Extend the coordinator only as that module needs it.
3. Review the small working increment with the operator before proceeding. Explain what the code does and demonstrate its behavior; let the operator supply further direction.
4. Add subsequent phase modules one at a time. Discuss the start command or API, monitoring or polling options, completion criteria, and logging before implementing each connection.
5. Discuss article-level failures and other recovery decisions when building the relevant module. Do not treat deferred decisions as permission to implement a comprehensive failure framework in the first iteration.
6. Write readable code with descriptive names, straightforward control flow, and focused functions. Use comments for intent, assumptions, and non-obvious behavior; avoid narrating every line or adding abstractions before they are useful.

The operational requirements below describe the completed feature. They are not the scope of the first iteration. Add persistence, completion monitoring, recovery, single-execution protection, and scheduled deployment progressively with operator involvement.

## Coordinator logging

Use `worker-node/src/modules/logger.ts` as the logging reference. The coordinator needs its own logger and application identity so its activity can be followed independently of worker logs.

1. Match worker-node's Winston structure: `YYYY-MM-DD HH:mm:ss [LEVEL] message key=value`. Preserve error stacks and render non-string metadata as JSON values.
2. Follow the same environment behavior: development uses console output at debug level; testing uses console and file output at info level; production uses file output at info level.
3. Use the same configuration conventions: `NODE_ENV`, `NAME_APP`, `PATH_TO_LOGS`, `LOG_MAX_SIZE`, and `LOG_MAX_FILES`. Write a coordinator-specific `<NAME_APP>.log` with size-based rotation and retained-file limits. The coordinator must use a different `NAME_APP` from worker-node so their log files cannot collide in a shared log directory.
4. Match the readable workflow-start separator and heading convention. Add run ID, phase, job ID, status, counts, elapsed time, and actionable errors as those fields become available during implementation.
5. Start with coordinator-start and phase-start events. Add completion, stop, resume, and failure events alongside the corresponding behavior. Never report a phase as completed merely because its start was triggered.
6. Keep credentials and secret values out of logs. Document file location, rotation, permissions, and how to correlate coordinator and worker records. Journald captures service output; production application events remain in the configured log file under the matching worker-node convention.

## Single execution and trigger policy

1. Allow only one weekly-flow-02 coordinator process to be active.
2. Reject every additional manual or scheduled trigger immediately. Never queue it for later execution.
3. Do not automatically retry or enqueue a replacement run. The operator may trigger another run after the active process ends.
4. Apply the same rule to manual commands and the weekly systemd trigger.
5. Keep overlap prevention outside `WeeklyArticleFlowRuns02`; do not add leases, lock versions, or queued-run fields to the table.
6. Use the [persistence plan's](20261003_weekly_flow_02_persistence_plan_v01.md) non-blocking PostgreSQL advisory lock as the process guard. If PostgreSQL is unreachable or lock acquisition cannot be evaluated, reject the trigger with a logged reason. Never run unguarded.
7. The coordinator starts at most one job for a phase and verifies that job before advancing.

## Data and targeting decisions

1. Keep independently runnable phase modules and the coordinator in `ops/`, using TypeScript so they can join the Node workspace.
2. Store durable progress in PostgreSQL when persistence is introduced. Prefer one new table, tentatively `WeeklyArticleFlowRuns02`, without changing existing tables for flow metadata. Never restore the legacy `WeeklyArticleFlowRuns` CSV into it.
3. Save the first `NewsApiRequests` ID recorded by this run and the first Article ID it inserts. Do not save a list of RSS article IDs. These two first IDs must remain associated with the run across RSS restarts.
4. After RSS completes, calculate `articleCount` once using `COUNT(*)` from `Articles` where `id >= firstRssArticleId`. Save and pass that same count unchanged to state assignment and AI Approver V02. Do not reduce it based on state-assignment outcomes.
5. Keep RSS's reported added count separate from `articleCount`, since other inserts can make them differ. If the run adds zero RSS articles, record the outcome and stop before semantic scoring. A resumed RSS invocation adding zero does not erase articles already added by that run.
6. Semantic scoring processes its existing unscored backlog, without an RSS count or article-ID range.
7. Exact RSS-cohort coverage is not required. Eligible older articles within selected work may be useful, and occasional missed RSS articles are accepted. State assignment and V02 retain their existing selection rules.
8. Use `docs/weekly-article-flow-v01/` only for operational warnings about permissions, ownership, service hardening, and configuration. Do not use its architecture or implementation as the design for this feature.

## Required phase order

1. Call worker-python's `DELETE /deduper/clear-db-table` to stop only deduper jobs and clear `ArticleDuplicateAnalyses`, preserving the table and schema. Validate its successful completion response before advancing. These disposable analysis rows are intentionally excluded from the subsequent phase 2 backup.
2. Create a database backup with db-manager's `--create_backup`. Record its outcome and location before proceeding.
3. Delete old articles using db-manager's default `--delete_articles` behavior.
4. Run worker-node Google News RSS collection. Capture the first request ID, first inserted Article ID, added count, query progress, and outcome. Apply the zero-article rule and calculate the run's `articleCount` after collection completes.
5. Start worker-node semantic scoring with its ordinary untargeted behavior. Monitor and record the job outcome.
6. Start worker-node AI state assignment with `targetArticleStateReviewCount = articleCount` and an operator-reviewed `targetArticleThresholdDaysOld`. The count limits selection; it does not guarantee that many successful assignments. Record selected, completed, skipped, and failed work.
7. Preview and start AI Approver V02 with `selectionMode = article_position_count`, `requestedArticleCount = articleCount`, description fallback enabled, and scanning past the approved boundary enabled. Monitor and record its result without recalculating the count.

V02 selects the newest `articleCount` Article positions, then applies state-assignment and other eligibility rules. It can process fewer articles than requested and does not extend that window to replace skipped articles. A preview reporting no eligible articles becomes a logged zero-work outcome for the coordinator.

The current RSS result reports `articlesAddedCount` but does not expose the required first IDs. When building phase 4, add a reliable way to capture or recover them, including after interruption. Keep this integration small and review it with the operator.

## Phase 1 endpoint prerequisite

- Implement and verify the [Worker Python Deduper Clear PRD](20261001_worker_python_deduper_clear_prd_v01.md) before connecting the working phase 1 module. The initial logging stub can be built independently.
- Every endpoint call must cancel only deduper jobs, wait for running deduper work to stop, and then clear the table. Remove cancellation of unrelated workflows entirely, with no option to restore it. Keep worker-python running.
- Worker-python owns protection against concurrent deduper writes and the bounded cancellation wait. The endpoint PRD defines these requirements, including the operator-approved configurable 30-second cancellation wait.
- Ops makes the HTTP request and logs the confirmed cancellation and deletion results. It does not delete analysis rows directly. A timeout, failed request, or unsuccessful response must not be reported as phase completion or trigger phase 2.

## Progress and recovery

These requirements are introduced incrementally after the initial trigger-and-log scaffolding.

1. Define each module's inputs, start mechanism, job ID, status source, monitoring interval or alternative, timeout, cancellation behavior, outputs, and repeat behavior with the operator.
2. Persist phase start before invoking external work and the verified outcome before advancing. Record run and phase timestamps, status, job IDs, first RSS request and Article IDs, both counts, backup location, and relevant errors.
3. If the flow stops during phases 1–3, leave the old run incomplete. These phases are safe to repeat: clearing is idempotent, each attempt creates a new backup before deletion, and deletion removes only rows still eligible. The next trigger starts a new run at phase 1 without an outcome check. Optional operator inspection does not block replacement work.
4. For interrupted RSS collection, preserve the run's first IDs and use RSS's existing exact-query repeat suppression. Its current default is 72 hours, defined by `DEFAULT_REQUEST_GOOGLE_RSS_REPEAT_WINDOW_HOURS`; follow that configured default rather than inventing a second window.
5. It is acceptable for RSS to repeat an expired query. After resumed collection completes, calculate `articleCount` from the original first Article ID. No separate coordinator-managed query deduplication system is required.
6. Decide partial-result and article-level failure handling while implementing the affected module. Record those decisions then; V07 does not prescribe retries or advancement rules for every failure.
7. Reject a trigger while another coordinator invocation is active. Do not queue it. Within one invocation, start at most one job for a phase and distinguish a triggered phase from verified completion.

## Run completion and checkpoints

- Use `runCompleted` in `WeeklyArticleFlowRuns02`: `false` means incomplete and `true` means complete. Do not introduce additional run lifecycle statuses such as abandoned or superseded.
- Set `runCompleted = true` after the final phase finishes under its agreed completion criteria, when the run stops because RSS added zero articles, or when the final V02 preview has no eligible articles.
- Zero work in an intermediate phase, such as no remaining semantic-scoring candidates, does not by itself finish the weekly flow. Advance according to that phase's completion criteria.
- Interrupted runs remain `runCompleted = false`. When a new run replaces one, leave the older row unchanged; automatic selection never searches backward for an incomplete run.
- Record the last phase reached and enough phase-level progress to distinguish started work from verified completion. This does not add run lifecycle statuses. If phase 3 completed and phase 4 has not started, the next phase is 4; phases 1–3 need not be repeated during continuation.
- Continuing a run preserves its original start time, run ID, first RSS IDs, and any finalized `articleCount`. Starting a new run gives it a new ID, start time, and its own RSS markers and count.
- For recovery decisions, “past phase 3” means Phase 3 is recorded as completed. A run where Phase 3 started but did not complete remains within the Phase 1–3 restart rule.

## Scheduling and CLI controls

1. Schedule Friday at 05:00 in `America/Los_Angeles`, using `OnCalendar=Fri *-*-* 05:00:00 America/Los_Angeles`.
2. A trigger without arguments examines only the last run in `WeeklyArticleFlowRuns02`, meaning the most recently created run. It never searches older rows for incomplete work.
3. Measure run age from the original run start time. Use the default RSS repeat window, currently 72 hours. Apply the following decision table to stopped work.

| Last run | Default action |
| --- | --- |
| No previous run | Start a new run at phase 1. |
| `runCompleted = true` | Start a new run at phase 1. |
| Incomplete and stopped during phases 1–3 | Start a new run at phase 1, regardless of age. |
| Incomplete, past phase 3, and older than the repeat window | Start a new run at phase 1. |
| Incomplete, past phase 3, and within the repeat window | Continue the existing run from its interrupted phase, or the next phase if the previous one completed. |

- Exactly 72 hours falls within the current window; only an age greater than the window starts a new run under the age rule.
- Apply the single-execution guard before stopped-run recovery. If another coordinator is active, reject the trigger immediately. An incomplete row alone does not prove work is still running.
- Provide an explicit CLI option to continue an incomplete run by run ID. Without a supplied ID, that option inspects the last run only and reports when it cannot be continued; it does not search older incomplete runs.
- Provide a separate explicit CLI option to start a new run when the default action would continue a recent incomplete run. Older incomplete rows remain unchanged. This option does not bypass the single-execution guard.
- Choose argument names and detailed manual recovery mechanics with the operator during implementation. Phases 1–3 always require a new run rather than continuation. Deliberate selection of an older run requires an explicit run ID.
- Keep systemd units thin. Review the service user, working directory, environment paths, permissions, and log locations before installation.

## Verification and rollout

- Demonstrate and verify each small increment at the scope implemented. The first iteration proves phase 1 can be triggered and the coordinator logs its start; it does not claim recovery or full-flow readiness.
- As capabilities are added, verify phase order, backup results, count capture and reuse, zero-work outcomes, interrupted recovery, CLI controls, partial results, and overlap rejection and no-queue behavior.
- Review the development service, timer, permissions, and logs before production rollout. Verify a manual production run with the operator before relying on the production timer.
