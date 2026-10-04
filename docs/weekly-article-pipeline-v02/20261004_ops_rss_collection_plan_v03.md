---
created_at: 2026-10-04T17:46:29Z
updated_at: 2026-10-04T17:46:29Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Plan V03

## Purpose

Implement Phase 4 of weekly-flow-02 in `ops/`. The phase runs worker-node Google News RSS collection, records the minimum durable progress needed for recovery, and defines the broader Article range that later phases will analyze.

After verified RSS completion, Phase 4 either stops the run under the zero-work rule or advances it to the Phase 5 boundary. Phase 5 remains unimplemented in this increment.

This plan does not implement semantic scoring, state assignment, AI Approver V02, systemd scheduling, or a general retry framework.

## Sources and Constraints

- Use `docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v09.md` as the product requirement.
- Preserve the coordinator, persistence, logging, configuration, and testing patterns already present in `ops/`.
- Keep the phase independently runnable and written in TypeScript.
- Keep default automated tests database-free by injecting worker and persistence dependencies.
- Do not report Phase 4 as completed merely because an RSS job started.
- Do not add coordinator-managed query deduplication, leases, heartbeats, or a broader recovery system.
- Do not change the single-execution guard or existing run-selection policy.
- Keep detailed per-query history in logs rather than turning `WeeklyArticleFlowRuns02` into a general metadata store.

## Core Coding Principle

Use the inside-out implementation approach. Research and review the smallest worker-node contract first, build one focused Phase 4 module around it, and extend the coordinator only as that module requires.

Use descriptive names, straightforward control flow, and focused functions. Add comments for intent, assumptions, and non-obvious recovery behavior. Avoid abstractions that are not useful to this phase.

## Existing Integration Boundary

The coordinator currently persists verified completion through Phase 3 and stops at the Phase 4 boundary. A continued run with Phase 3 completed reaches the same boundary without repeating Phases 1–3.

The persistence contract already exposes these Phase 4 fields:

- `firstRssRequestId`
- `firstRssArticleId`
- `rssArticlesAddedCount`
- `articleCount`
- `rssJobId`

Phase 4 replaces the current boundary return with the new module. A verified nonzero outcome stops at the Phase 5 boundary with the run still incomplete. A verified zero-work outcome completes the run.

## Worker Interface Research

Before implementation, inspect worker-node's existing Google News RSS interface and review the findings with the operator.

Confirm:

- The start command or HTTP endpoint.
- The job identifier returned at start.
- The authoritative status source and worker-defined terminal states.
- How the first `NewsApiRequests` ID and first inserted Article ID can be captured or recovered.
- How the worker reports articles added and minimal query progress.
- How a completed job result remains available after coordinator interruption.
- How an unavailable saved job is distinguished from a temporary status failure.
- The existing exact-query repeat-suppression behavior used by the recovery fallback.

Add only the smallest worker-node change needed to expose or recover this contract. Do not redesign the RSS workflow.

## Phase Module

Add a Phase 4 module under `ops/src/weekly-flow-02/phases/`, following the separation used by the existing phase modules.

- A phase-facing function accepts only the configuration and dependencies needed for RSS collection.
- A worker integration layer starts collection, validates the start response, monitors the saved job, validates terminal results, and supports the approved continuation behavior.
- Typed results and errors keep worker response details out of the coordinator.
- Failure categories distinguish connection, request timeout, unsuccessful HTTP response, invalid response, overall monitoring timeout, permanent status error, and unsuccessful or unverified job outcome.

The verified result must provide the job ID, first IDs when available, RSS-added result, minimal query progress, and terminal outcome.

## Monitoring Policy

Use worker-node's authoritative job status and worker-defined terminal states confirmed during interface research.

- Poll every 5 minutes.
- Do not overlap status requests. Schedule the next poll only after the current request finishes.
- Give each status request a 60-second timeout.
- Allow 2 consecutive transient status-request failures and stop monitoring on the third.
- Reset the consecutive-failure count after a valid status response.
- Treat request timeouts, connection failures, and temporary server errors as transient.
- Stop immediately for permanent errors, such as authorization failure or an invalid request.
- Stop Phase 4 after an overall timeout of 24 hours.
- Record a monitoring stop as an unverified outcome rather than claiming that the RSS job itself failed.

A saved job that is unavailable during continuation follows the recovery rule below rather than being treated as an ordinary transient poll failure.

## Durable Progress

Persist Phase 4 start before asking worker-node to begin work. Persist the RSS job ID and first IDs as soon as they become available rather than waiting for terminal completion.

Extend the persistence interface with a focused Phase 4 progress operation that:

- Updates only the selected run.
- Preserves an existing first request ID and first Article ID.
- Rejects attempts to replace either first ID with a different value.
- Records the job ID and only the minimal query-progress marker needed for recovery.
- Does not mark Phase 4 complete.
- Does not store per-query results or a detailed history.

Keep detailed completed, skipped, empty, and failed query information in coordinator or worker logs.

## Interrupted Coordinator Recovery

Persist `rssJobId` in `WeeklyArticleFlowRuns02`. When a run continues after Phase 4 started but did not complete, query worker-node for that saved job before starting another RSS invocation.

Apply these outcomes:

1. If the saved job is running, resume monitoring it.
2. If the saved job completed, validate and process its result.
3. If the saved job is unavailable, start at most one replacement invocation using worker-node's existing exact-query repeat suppression.

The recovery path preserves the original run ID, start time, first IDs, and any earlier nonzero RSS-added result. It does not add leases, heartbeats, or a coordinator-managed deduplication system.

Within one coordinator invocation, start at most one RSS job. Monitoring an already running saved job does not count as starting another job.

## Partial Query Outcomes

An individual query failure or a query that returns no articles does not fail Phase 4.

- Log the individual outcome.
- Continue to the next query.
- Allow Phase 4 to complete after the worker reaches its accepted terminal completion state.
- Do not persist detailed query outcomes or aggregate failure histories in `WeeklyArticleFlowRuns02`.

If the entire RSS job stops before reaching an accepted terminal state, apply the interrupted-job recovery rule. If recovery cannot produce a verified terminal result, stop Phase 4 with an unverified failure.

## RSS-Added Result and Downstream Article Count

The RSS-added result decides whether the run follows the zero-work branch. It does not define the Article cohort used by later phases.

- If every RSS invocation associated with the run adds zero articles, complete the run before semantic scoring.
- If any invocation adds articles, preserve that nonzero outcome. A later invocation reporting zero must not erase it.
- Preserve the original first RSS Article ID across continuation.
- Do not build or persist a list of RSS-only Article IDs.
- Do not use an RSS-only count for downstream targeting.

For a nonzero RSS outcome, calculate `articleCount` once with `COUNT(*)` over Articles where `id >= firstRssArticleId`. Save and pass that same value unchanged to later phases.

This Article range is deliberately broader than a pure RSS cohort. It can include Articles inserted by other processes after the weekly flow's first RSS Article. The goal is for later phases to analyze all newly added Articles in the selected range, regardless of how they entered the database.

Keep `rssArticlesAddedCount` separate from `articleCount`. The former records the worker's RSS-added result for the run and protects the zero-work decision. The latter is the only count used by later phases.

The persistence boundary provides the Article count operation so database access remains injectable in coordinator tests. A required count must be a verified non-negative safe integer.

## Completion Persistence

For a verified zero-work outcome, no first RSS Article ID exists and no Article count query is required.

Add one focused atomic persistence operation that, in one database update:

- Records verified Phase 4 completion.
- Records the zero RSS-added result.
- Sets `runCompleted = true`.
- Sets `runCompletedAt`.

This prevents a stopped process from leaving Phase 4 completed while the run still appears incomplete.

For a verified nonzero outcome, require the original `firstRssArticleId`, calculate `articleCount`, and record Phase 4 completion with the job ID, first IDs, RSS-added result, Article count, minimal progress, and terminal outcome. Leave the run incomplete at the Phase 5 boundary.

## Coordinator Flow

Extend the coordinator dependencies with the Phase 4 function so tests can inject it.

1. Select or create the run using the existing policy.
2. Execute Phases 1–3 only when they are not already complete.
3. Persist Phase 4 start before any worker-node start request.
4. If a saved RSS job ID exists, apply the interrupted coordinator recovery rule.
5. Otherwise, start one RSS job and persist its ID and recoverable first IDs.
6. Monitor according to the approved polling and timeout policy.
7. Continue past individual query failures and empty query results.
8. Verify the terminal result and determine whether the run has any nonzero RSS-added outcome.
9. For zero work, atomically complete Phase 4 and the run without an Article count query.
10. For nonzero work, calculate and persist the broader `articleCount`, complete Phase 4, and stop at the Phase 5 boundary.

Route Phase 4 failures through the existing failure recorder with `phase: 4`. Logs include the run ID, phase, safe job ID, monitoring outcome, useful query details, elapsed time, counts when applicable, and actionable errors without credentials or secret values.

## Configuration

Add only the worker-node connection settings needed by the researched start and status interface.

Add explicit Phase 4 settings for:

- A 5-minute polling interval.
- A 60-second per-request timeout.
- A limit of 2 tolerated consecutive transient failures.
- A 24-hour overall Phase 4 timeout.

Validate URLs and positive integers with the existing `OpsConfig` conventions. Document the settings in `ops/.env.example` and `ops/README.md`.

## Verification

Add focused phase-module tests for:

- Start and status response parsing.
- Worker-defined terminal states.
- Five-minute non-overlapping polling.
- The 60-second request timeout.
- Failure-counter increment, reset, and stop on the third consecutive transient failure.
- Immediate permanent-error handling.
- The 24-hour overall timeout.
- Individual query errors and empty query outcomes that still reach verified completion.
- Safe handling of malformed or unverified worker results.

Extend persistence tests for:

- Mid-phase job and first-ID writes.
- Preservation of original first IDs.
- Rejection of conflicting first IDs.
- Minimal progress without detailed query history.
- Article counting from the original first Article ID.
- Atomic zero-work Phase 4 and run completion.
- Failure of the atomic update leaving neither completion state persisted.

Extend coordinator tests for:

- Phase order through Phase 4.
- Continuation after Phase 3 without repeating Phases 1–3.
- Saved running-job monitoring without another start.
- Saved completed-job result processing.
- The unavailable-job replacement fallback.
- At-most-one RSS job start per coordinator invocation.
- A later zero result preserving an earlier nonzero outcome.
- The deliberately broader Article count.
- New-run zero work completing without a first Article ID or Article count query.
- Worker, monitoring, progress-persistence, count, and completion-persistence failures stopping before Phase 5.
- Nonzero success stopping at the Phase 5 boundary without marking the run complete.

Run the ops type check, tests, and build. Run the worker-node build and tests if the minimal worker contract requires code changes. All default ops tests use injected worker and persistence fakes rather than PostgreSQL, worker-node, or package `.env` files.

## Documentation Outcome

Update `ops/README.md` with the researched worker contract, Phase 4 settings, monitoring policy, minimal persisted data, detailed logging behavior, continuation recovery, partial-query handling, broad Article range, zero-work completion, and Phase 5 boundary.

## Open Questions

### 1. Worker interface

Which existing worker-node command or HTTP endpoints provide the RSS start, authoritative job status, and recoverable result contract required by this plan?

#### Operator Response

Research the existing worker-node interface before naming or modifying the production integration. Review the smallest required contract change with the operator before implementation.
