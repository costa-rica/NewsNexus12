---
created_at: 2026-10-04T17:07:50Z
updated_at: 2026-10-04T17:45:20Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Plan V02

## Purpose

Implement Phase 4 of weekly-flow-02 in `ops/`. The phase runs worker-node Google News RSS collection, records durable progress, calculates the run's article count when articles were added, and either advances to the Phase 5 boundary or atomically completes the run under the zero-article rule.

This plan covers only Phase 4. It does not implement semantic scoring, state assignment, AI Approver V02, systemd scheduling, or a general retry framework.

## Sources and Constraints

- Use `docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v09.md` as the product requirement.
- Preserve the coordinator, persistence, logging, configuration, and testing patterns already present in `ops/`.
- Keep the phase independently runnable and written in TypeScript.
- Keep default automated tests database-free by injecting worker and persistence dependencies.
- Do not treat a triggered worker job as verified phase completion.
- Do not add a coordinator-managed query deduplication system.
- Do not change the single-execution guard or the existing run-selection policy.

## Core Coding Principle

Use the inside-out implementation approach. Build a focused Phase 4 module around the smallest reviewed worker-node integration, then extend the coordinator only as that module requires.

Use descriptive names, straightforward control flow, and focused functions. Add comments for intent, assumptions, and non-obvious recovery behavior. Avoid abstractions that are not yet useful to this phase.

## Existing Integration Boundary

The current coordinator persists verified completion through Phase 3 and stops at the Phase 4 boundary. A continued run with Phase 3 completed reaches the same boundary without repeating Phases 1–3.

The persistence contract already exposes these Phase 4 fields:

- `firstRssRequestId`
- `firstRssArticleId`
- `rssArticlesAddedCount`
- `articleCount`
- `rssJobId`

Phase 4 should replace the boundary return with a call to the new module. The boundary after successful nonzero RSS work becomes Phase 5, which remains unimplemented in this increment.

## Worker Integration

Add a Phase 4 module under `ops/src/weekly-flow-02/phases/`, following the separation used by the existing phase modules:

- A small phase-facing function accepts only the configuration and dependencies needed for RSS collection.
- A worker integration layer starts the RSS work, validates its response, monitors the identified job, and validates the terminal result.
- Typed result and error contracts keep worker response details out of the coordinator.
- Failure categories distinguish connection, timeout, unsuccessful HTTP response, invalid response, and unsuccessful or unverified job outcomes when the reviewed worker contract supports those distinctions.

Before implementation, review the existing worker-node start mechanism, job identifier, status source, polling or monitoring option, timeout, cancellation behavior, output fields, and repeat behavior with the operator. The PRD does not authorize inventing these details.

The worker contract must reliably expose or allow recovery of:

- The job ID.
- The first `NewsApiRequests` ID associated with this run.
- The first Article ID inserted by this run when the run adds articles.
- The number of RSS articles added.
- Query progress.
- A verified terminal outcome.

The integration should add only the smallest worker-node change needed to provide this contract, including recovery after interruption.

## Durable Progress and Recovery

Persist Phase 4 start before asking worker-node to begin work. Once external work is started, persist the job ID and first IDs as soon as they become available rather than waiting for terminal completion.

The current completion-only persistence method is insufficient for durable mid-phase markers. Extend the persistence interface with a focused Phase 4 progress operation that:

- Updates only the selected run.
- Preserves an existing first request ID and first Article ID.
- Rejects attempts to replace either first ID with a different value.
- Records job identity and query progress without marking Phase 4 complete.
- Keeps progress inside the Phase 4 data and typed columns already defined for the run.

When continuing an interrupted Phase 4 run, retain the original run ID, start time, and first IDs. Start at most one RSS job during that coordinator invocation. Use RSS's existing exact-query repeat suppression and its configured default repeat window; do not create another deduplication layer in `ops/`.

If a repeated RSS invocation reports zero new articles, preserve articles, counts, and first IDs already associated with the run. Use the run-level RSS-added total, rather than only the latest invocation's added count, to select the final outcome.

## Article Count and Completion Rules

After verified RSS completion, first determine the run-level RSS-added total.

1. If the run-level total is zero, no first Article ID exists. Persist the zero-work Phase 4 result and mark the run completed without attempting an Article count query.
2. If the run-level total is greater than zero, require the original `firstRssArticleId`. Calculate `articleCount` once with `COUNT(*)` over Articles where `id >= firstRssArticleId`, then save it with the Phase 4 result for later phases.

Keep `rssArticlesAddedCount` separate from `articleCount`; concurrent or unrelated inserts can make them differ. Do not store a list of RSS Article IDs and do not attempt exact RSS-cohort coverage.

The persistence boundary should provide the Article count operation so database access remains injectable in coordinator tests. It must return a non-negative safe integer and fail Phase 4 if a required count cannot be verified.

Add one focused atomic persistence operation for the zero-work outcome. In one database update, it should record verified Phase 4 completion, set the run-level RSS-added count to zero, set `runCompleted = true`, and set `runCompletedAt`. This prevents a stopped process from leaving Phase 4 completed while the run still appears incomplete.

For nonzero RSS work, record verified Phase 4 completion with the first IDs, both counts, job ID, query progress, and outcome. Leave the run incomplete and stop at the unimplemented Phase 5 boundary.

## Coordinator Flow

Extend the coordinator dependencies with the Phase 4 function so tests can inject it. The coordinator flow becomes:

1. Select or create the run using the existing policy.
2. Execute Phases 1–3 only when they are not already complete.
3. Persist the Phase 4 start before invoking worker-node.
4. Run or resume RSS collection using any Phase 4 markers already stored for the selected run.
5. Persist recoverable job, first-ID, count, and query progress during the phase.
6. Verify the terminal worker outcome and determine the run-level RSS-added total.
7. For zero total additions, atomically complete Phase 4 and the run without requiring `firstRssArticleId` or an Article count query.
8. For nonzero total additions, calculate and persist `articleCount`, complete Phase 4, and stop at the Phase 5 boundary.

Phase 4 errors should use the existing failure-recording path with `phase: 4`. Failure logs should include the run ID, phase, safe job identifiers, category, and actionable message without credentials or secret values.

## Configuration and Logging

Add only worker-node connection, monitoring interval, and timeout configuration values established during the operator review. Validate URLs and positive integer values with the existing `OpsConfig` conventions, and document them in `ops/.env.example` and `ops/README.md`.

Log Phase 4 start, job identity, recoverable first-ID progress, query progress, verified completion, both counts when applicable, elapsed time when available, zero-work completion, continuation, and failure. Preserve the current coordinator log format and application identity.

## Verification

Add focused tests for the worker response parser, start request, monitoring behavior, terminal result validation, timeout, and each agreed failure category.

Extend persistence tests to cover:

- Mid-phase job and first-ID writes.
- Preservation of original first IDs.
- Rejection of conflicting first IDs.
- Article counting from the original first Article ID.
- Phase 4 completion fields.
- Atomic zero-work Phase 4 and run completion.
- Failure of the atomic update leaving neither completion state persisted.

Extend coordinator tests to cover:

- Phase order through Phase 4.
- Continuation after Phase 3 without repeating Phases 1–3.
- Interruption after Phase 4 starts and recovery with preserved markers.
- At-most-one job start per invocation.
- Separate RSS-added and Article counts.
- New-run zero additions completing without a first Article ID or count query.
- Resumed zero additions preserving earlier additions and using the nonzero path.
- Worker, progress-persistence, count, and completion-persistence failures stopping before Phase 5.
- Nonzero success stopping at the Phase 5 boundary without marking the run complete.

Run the ops type check, tests, and build. All automated tests must use injected worker and persistence fakes rather than PostgreSQL, worker-node, or package `.env` files.

## Documentation Outcome

Update `ops/README.md` to describe the reviewed worker contract, required configuration, normal Phase 4 logs, recovery behavior, zero-work completion, the Phase 5 boundary, and safe verification commands.

## Open Questions

### 1. Worker start mechanism

Which existing worker-node command or HTTP endpoint should `ops/` use to start Google News RSS collection?

#### Operator Response

Review the existing worker-node interface before naming or modifying the production integration.

### 2. Job monitoring contract

Which status source, polling interval, timeout, and terminal states should Phase 4 use?

#### Operator Response

Use worker-node's authoritative job status and its defined terminal states, as confirmed by the worker-interface research.

- Poll every 5 minutes without overlapping status requests.
- Give each status request a 60-second timeout.
- Allow 2 consecutive transient status-request failures and stop on the third.
- Reset the consecutive-failure count after a valid status response.
- Count timeouts, connection failures, and temporary server errors as transient failures.
- Stop immediately for permanent errors, such as an invalid job ID or authorization failure.
- Stop Phase 4 after an overall timeout of 24 hours.
- Record a monitoring stop as an unverified outcome rather than claiming that the RSS job failed.

### 3. Interrupted job handling

When a persisted RSS job is nonterminal at restart, should the coordinator monitor that job or start another invocation that relies on query-repeat suppression?

This question applies when the coordinator stops after it has started an RSS job but before it has recorded verified completion. For example, the coordinator process or server could restart while worker-node is still collecting articles.

The database would show that Phase 4 started and may contain an RSS job ID, but it would not confirm whether that job is still running, completed successfully, or stopped.

When the weekly flow continues, the coordinator needs one defined recovery action:

1. Find the original job by its saved job ID and continue monitoring it.
2. Start RSS collection again and rely on worker-node's existing exact-query repeat suppression to avoid repeating recently completed queries.

The decision must also cover what happens when the saved job cannot be found or its status is no longer available. Without a defined rule, the coordinator could either leave recoverable work unfinished or start duplicate RSS work.

#### Operator Response

Persist the RSS job ID in `WeeklyArticleFlowRuns02`. On continuation, query worker-node for that saved job before starting another RSS invocation.

- If the job is running, resume monitoring it.
- If the job completed, process its result.
- If the job is unavailable, use a small operator-reviewed fallback that relies on RSS's existing exact-query repeat suppression.
- Do not add leases, heartbeats, or a broader coordinator recovery system for this case.

### 4. Partial-result advancement

Which worker terminal outcomes with partial query or article failures permit Phase 4 completion?

#### Operator Response

- If one query fails or returns no articles, log the outcome and continue to the next query.
- Individual query failures do not prevent Phase 4 completion.
- Store only the data needed for recovery and later phases in `WeeklyArticleFlowRuns02`: job ID, first IDs, RSS-added count, `articleCount`, phase status, and minimal query progress.
- Keep detailed query results and failure counts in logs rather than the run table.
- If the entire RSS job stops, apply the Question 3 recovery rule.

### 5. RSS count accumulation

How will worker-node report the run-level added count across an interrupted collection and any resumed invocation?

#### Operator Response

The RSS-added result is needed to decide whether the run follows the zero-work branch. It does not need to define a pure RSS cohort for later phases.

- If every RSS invocation associated with the run adds zero articles, complete the run before semantic scoring.
- If any invocation adds articles, preserve that nonzero outcome. A later invocation reporting zero must not erase it.
- Preserve the original first RSS Article ID across continuation.
- Calculate the downstream `articleCount` from all Articles with IDs at or above that original first Article ID.
- Accept that `articleCount` can include Articles inserted by other processes after the weekly flow began.
- Send that broader `articleCount` to later phases so all newly added Articles in the selected range are analyzed, regardless of how they entered the database.
- Do not build or persist a pure list or count of RSS-only Article IDs for downstream targeting.
