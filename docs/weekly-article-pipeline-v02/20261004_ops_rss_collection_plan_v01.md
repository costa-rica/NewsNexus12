---
created_at: 2026-10-04T17:06:22Z
updated_at: 2026-10-04T17:06:22Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Plan V01

## Purpose

Implement Phase 4 of weekly-flow-02 in `ops/`. The phase runs worker-node Google News RSS collection, records durable progress, calculates the run's article count, and either advances to the Phase 5 boundary or completes the run under the zero-article rule.

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
- The first Article ID inserted by this run.
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

If a repeated RSS invocation reports zero new articles, preserve articles and first IDs already associated with the run. Calculate the final count from the original first Article ID after collection is verified complete.

## Article Count and Completion Rules

After verified RSS completion, calculate `articleCount` once with `COUNT(*)` over Articles where `id >= firstRssArticleId`. Save that value with the Phase 4 result and reuse it unchanged in later phases.

Keep `rssArticlesAddedCount` separate from `articleCount`; concurrent or unrelated inserts can make them differ. Do not store a list of RSS Article IDs and do not attempt exact RSS-cohort coverage.

The persistence boundary should provide the count operation so its database access remains injectable in coordinator tests. It must return a non-negative safe integer and fail Phase 4 if the count cannot be verified.

Apply these outcomes:

1. If the run added zero RSS articles, record Phase 4 as completed, mark the run completed, log the zero-work outcome, and stop before Phase 5.
2. If an interrupted run already recorded RSS additions, a resumed invocation adding zero does not erase those additions or trigger the zero-work rule for the whole run.
3. If the run has RSS articles, record verified Phase 4 completion with the first IDs, both counts, job ID, query progress, and outcome, then stop at the unimplemented Phase 5 boundary.

## Coordinator Flow

Extend the coordinator dependencies with the Phase 4 function so tests can inject it. The coordinator flow becomes:

1. Select or create the run using the existing policy.
2. Execute Phases 1–3 only when they are not already complete.
3. Persist the Phase 4 start before invoking worker-node.
4. Run or resume RSS collection using any Phase 4 markers already stored for the selected run.
5. Persist recoverable job and first-ID progress during the phase.
6. Verify the terminal worker outcome.
7. Calculate and persist the final article count.
8. Apply the zero-article completion rule or stop at the Phase 5 boundary.

Phase 4 errors should use the existing failure-recording path with `phase: 4`. Failure logs should include the run ID, phase, safe job identifiers, category, and actionable message without credentials or secret values.

## Configuration and Logging

Add only worker-node connection, monitoring interval, and timeout configuration values established during the operator review. Validate URLs and positive integer values with the existing `OpsConfig` conventions, and document them in `ops/.env.example` and `ops/README.md`.

Log Phase 4 start, job identity, recoverable first-ID progress, query progress, verified completion, both counts, elapsed time when available, zero-work completion, continuation, and failure. Preserve the current coordinator log format and application identity.

## Verification

Add focused tests for the worker response parser, start request, monitoring behavior, terminal result validation, timeout, and each agreed failure category.

Extend persistence tests to cover:

- Mid-phase job and first-ID writes.
- Preservation of original first IDs.
- Rejection of conflicting first IDs.
- Article counting from the original first Article ID.
- Phase 4 completion fields and zero-work run completion.

Extend coordinator tests to cover:

- Phase order through Phase 4.
- Continuation after Phase 3 without repeating Phases 1–3.
- Interruption after Phase 4 starts and recovery with preserved markers.
- At-most-one job start per invocation.
- Separate RSS-added and Article counts.
- New-run zero additions completing the run.
- Resumed zero additions preserving earlier additions.
- Worker, progress-persistence, count, and completion-persistence failures stopping before Phase 5.
- Nonzero success stopping at the Phase 5 boundary without marking the run complete.

Run the ops type check, tests, and build. All automated tests must use injected worker and persistence fakes rather than PostgreSQL, worker-node, or package `.env` files.

## Documentation Outcome

Update `ops/README.md` to describe the reviewed worker contract, required configuration, normal Phase 4 logs, recovery behavior, zero-work completion, the Phase 5 boundary, and safe verification commands.

## Open Questions

### 1. Worker start mechanism

Which existing worker-node command or HTTP endpoint should `ops/` use to start Google News RSS collection?

#### Operator Response

(codex) Review the existing worker-node interface before naming or modifying the production integration.

### 2. Job monitoring contract

Which status source, polling interval, timeout, and terminal states should Phase 4 use?

#### Operator Response

(codex) Reuse worker-node's existing job model where possible and add only the fields required by the PRD.

### 3. Interrupted job handling

When a persisted RSS job is nonterminal at restart, should the coordinator monitor that job or start another invocation that relies on query-repeat suppression?

#### Operator Response


### 4. Partial-result advancement

Which worker terminal outcomes with partial query or article failures permit Phase 4 completion?

#### Operator Response


### 5. RSS count accumulation

How will worker-node report the run-level added count across an interrupted collection and any resumed invocation?

#### Operator Response

(codex) Preserve prior additions and define an explicit run-level total before implementing the zero-article rule.
