---
created_at: 2026-10-05T20:56:22Z
updated_at: 2026-10-05T20:56:22Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops Semantic Scoring Plan V01

## Goal

Implement Phase 5 of weekly-flow-02 in `ops/`. The phase starts worker-node semantic scoring with its ordinary untargeted behavior, monitors the saved queue job, records a verified outcome, and advances the incomplete run to the Phase 6 boundary.

This plan covers only Phase 5. It does not implement state assignment, AI Approver V02, systemd scheduling, a general retry framework, or a new worker-node scoring mode.

## Sources and Constraints

- Use `20261003_weekly_combined_flow_prd_v10.md` as the product requirement.
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

Phase 5 replaces the nonzero boundary return with the semantic-scoring module. A verified Phase 5 completion records `lastPhaseCompleted = 5` and stops at the unimplemented Phase 6 boundary.

When a continued run already has Phase 5 completed, the coordinator must not start another semantic-scorer job. It should log the Phase 6 boundary and return successfully until Phase 6 is implemented.

## Existing Worker-Node Contract

Use the existing interfaces without changing worker-node:

- Start: `POST /semantic-scorer/start-job` with an empty JSON object.
- Status: `GET /queue-info/check-status/:jobId`.
- Expected start response: HTTP 202 with `jobId`, `status = queued`, and `endpointName = /semantic-scorer/start-job`.
- Queue statuses: `queued`, `running`, `completed`, `failed`, and `canceled`.
- Worker restart behavior: a previously active job becomes `failed` with `failureReason = worker_restart`.
- Queue storage can prune old jobs, and job IDs can be reused if the store is replaced or emptied.

Do not send `articleIdMinExclusive`, `articleIdMaxInclusive`, or any field derived from the weekly run's `articleCount`. An empty request preserves the semantic scorer's existing unscored-backlog selection.

The semantic-scorer handler currently returns no structured queue result. A normal handler return produces `status = completed`; an uncaught workflow error produces `status = failed` with `failureReason`.

## Meaning of Phase 5 Completion

Treat only a validated queue record with `status = completed` as verified Phase 5 success.

Queue completion means the semantic-scorer handler finished under its existing rules. It does not mean every candidate received a score:

- Articles without usable text may finish without a score.
- Individual scoring timeouts and errors are logged and skipped by worker-node.
- An empty candidate set is a successful zero-work Phase 5 outcome.
- Zero work in Phase 5 does not complete the weekly run. It advances to Phase 6.

Persist the queue outcome and timestamps available from the job record. Keep detailed article-level diagnostics in worker-node logs because the existing job does not return article counts or per-article results.

## Phase Module Design

Add the Phase 5 files under `ops/src/weekly-flow-02/phases/`:

- `05_runSemanticScoring.ts` owns phase start or continuation, saved-job recovery, monitoring, replacement eligibility, progress persistence, and the verified completion result.
- `05_semanticScorerClient.ts` owns HTTP requests, response parsing, job identity validation, status classification, and transport error categories.

The phase-facing function accepts the persisted run, Phase 5 configuration, persistence adapter, worker client, clock, delay function, and event callback. It returns a compact verified result to the coordinator.

Use typed errors for start rejection, request timeout, connection failure, temporary server failure, permanent request failure, invalid response, unavailable saved job, unsuccessful terminal outcome, and unverified monitoring outcome.

## Job Identity Validation

Validate more than the saved job ID because worker-node job IDs can be reused.

1. Require `endpointName = /semantic-scorer/start-job`.
2. Require a valid `createdAt` timestamp.
3. Require `createdAt` to be at or after the original persisted Phase 5 `startedAt`.
4. Require a valid `startedAt` for `running` and terminal jobs.
5. Require a valid `endedAt` for every terminal job.
6. Require timestamps to be chronological: `createdAt <= startedAt <= endedAt` when all are present.
7. Treat HTTP 404, endpoint mismatch, or creation before the Phase 5 start as an unavailable saved job.
8. Treat malformed identity, status, or timestamps as an invalid and unverified response.

Preserve the first Phase 5 `startedAt` across continuation. Do not overwrite it when a later invocation resumes the phase or starts a replacement job.

## Monitoring Policy

Use a Phase 5-specific polling policy rather than silently inheriting the Phase 4 RSS timeout and cancellation rules.

- Poll every 5 minutes after an active status response.
- Never overlap status requests.
- Use the existing 60-second worker-node request timeout.
- Allow 2 consecutive transient status-request failures and stop on the third.
- Reset the consecutive-failure count after a valid status response.
- Treat request timeouts, connection failures, and temporary server errors as transient.
- Stop immediately on permanent HTTP errors or invalid responses.
- Persist compact observations such as job ID, status, worker timestamps, and failure reason when available.

Do not add a Phase 5 job-duration limit or automatic cancellation in this increment. The PRD defines the 24-hour timeout and cancellation contract for Phase 4 RSS jobs only.

An active semantic-scorer job can therefore remain monitored until it reaches a terminal state, the coordinator is stopped, or status monitoring becomes unverified.

## Terminal Outcome Mapping

1. `queued` or `running`: persist the observation and continue monitoring.
2. `completed`: accept only after identity and terminal timestamps validate, then persist Phase 5 completion.
3. `failed`: record the `failureReason`, stop the current attempt, and do not advance.
4. `canceled`: record the terminal outcome, stop the current attempt, and do not advance.
5. Unknown status or malformed terminal record: stop as an invalid, unverified outcome.

Do not convert `failed`, `canceled`, missing, malformed, or unreachable jobs into successful zero work.

## Interrupted Coordinator Recovery

Persist `semanticScorerJobId` immediately after validating the start response. A continued run uses `lastPhaseStarted`, `lastPhaseCompleted`, the original Phase 5 `startedAt`, and the saved job ID to choose its next action.

Apply these rules:

1. If Phase 5 has not started, persist its start before sending the worker request.
2. If a saved job is active and valid, monitor it rather than starting another.
3. If a saved job is already completed and valid, persist Phase 5 completion without rerunning scoring.
4. If a saved job from an earlier invocation is failed, canceled, or unavailable, the current invocation may start one replacement job.
5. If the current invocation's new job fails or is canceled, stop. Do not start a second job in that invocation.
6. If status monitoring stops without a verified terminal state, preserve the saved job ID. A later continuation checks that same job first.
7. If Phase 5 was persisted as started but no job ID was saved, the continuation may start one job and must log the start-response persistence gap.

A replacement is safe for the workflow because semantic scoring selects the current unscored backlog and upserts score contracts. The global queue's concurrency of one also prevents two semantic jobs from executing simultaneously.

The lost-job-ID gap can still enqueue redundant work if the earlier start request succeeded. Accept that limited risk for this increment rather than adopting `latest-job`, which cannot prove that a semantic job belongs to this weekly run.

## Persistence Changes

Extend the typed persistence contract with a focused Phase 5 progress operation. It should:

- Require Phase 5 to be the active incomplete phase.
- Preserve the original Phase 5 `startedAt`.
- Save a validated non-empty `semanticScorerJobId` as soon as it is known.
- Save compact latest progress under `phaseData.phase5`.
- Reject progress updates after Phase 5 or the run is completed.

The existing `semanticScorerJobId` column is sufficient. No db-models schema change is required.

Use the existing generic phase-completion operation to atomically set `lastPhaseCompleted = 5`, save the final `semanticScorerJobId`, and write the compact Phase 5 result under `phaseData.phase5`.

The final result should include:

- `jobId`
- `endpointName`
- final `status`
- `createdAt`
- `startedAt`
- `endedAt`
- elapsed milliseconds derived from worker timestamps
- a flag or outcome label showing whether the job completed with no structured result

Do not add candidate, completed, skipped, or failed article counts because worker-node does not currently expose trustworthy values for them.

## Coordinator Flow

1. Select or create the weekly run through the existing run-selection policy.
2. Execute or continue Phases 1 through 4 as currently implemented.
3. Return immediately if Phase 4 completed the run under its zero-Article rule.
4. Require persisted Phase 4 completion and a positive immutable `articleCount` before entering Phase 5.
5. Start or continue Phase 5 through the new module.
6. Record and log only a validated completed semantic-scorer job as Phase 5 completion.
7. Leave `runCompleted = false` and stop at the Phase 6 boundary.
8. Route Phase 5 errors through the existing failure recorder with `phase: 5`.

Refresh the in-memory run after Phase 4 so the coordinator sees the persisted `articleCount`, Phase 4 completion, and any Phase 5 progress returned by persistence operations.

## Configuration

Keep `URL_BASE_NEWS_NEXUS_WORKER_NODE` and `WORKER_NODE_REQUEST_TIMEOUT_SECONDS` as shared worker-node transport settings.

Add Phase 5 settings with names that do not imply RSS behavior:

- `SEMANTIC_SCORER_STATUS_POLL_INTERVAL_SECONDS=300`
- `SEMANTIC_SCORER_TOLERATED_CONSECUTIVE_STATUS_FAILURES=2`

Validate both as positive safe integers. Do not add a semantic-scorer timeout-hours setting in this increment.

Document the values in `ops/.env.example` and `ops/README.md`.

## Logging and Operator Visibility

Coordinator logs should include:

- Phase 5 start or continuation with run ID and saved job ID.
- Worker job start with job ID and endpoint.
- Status transitions, consecutive transient failure count, and worker timestamps.
- Replacement eligibility and whether the invocation has already used its one start.
- Verified completion with elapsed time.
- Failure or unverified stop with an actionable category and message.
- The Phase 6 boundary after successful completion.

Do not log credentials, request environment values, keyword workbook contents, Article text, or database connection details.

The operator correlates coordinator and worker records with `semanticScorerJobId`. Detailed article processing remains in worker-node logs.

## Verification

Add client and phase-module tests for:

- Empty-body semantic-scorer start requests.
- Valid and invalid start responses.
- Exact endpoint identity validation.
- Reused job IDs whose `createdAt` predates Phase 5.
- Missing, malformed, and non-chronological timestamps.
- `queued`, `running`, `completed`, `failed`, `worker_restart`, and `canceled` outcomes.
- Five-minute non-overlapping polling and 60-second request timeouts.
- Transient status failures incrementing, resetting, and stopping on the third consecutive failure.
- Permanent request failures and invalid responses stopping immediately.
- A completed job with no structured result being accepted.
- Empty semantic work advancing rather than completing the weekly run.
- No Phase 5 duration timeout or cancellation request.

Extend persistence tests for:

- Saving `semanticScorerJobId` before completion.
- Preserving the original Phase 5 start timestamp.
- Rejecting progress outside an active incomplete Phase 5.
- Persisting compact progress without changing `articleCount`.
- Atomically recording Phase 5 completion and its job ID.

Extend coordinator tests for:

- Phase 4 zero work never starting Phase 5.
- Positive Phase 4 `articleCount` starting Phase 5 without passing that count to worker-node.
- Phase order through verified Phase 5 completion.
- Completed Phase 5 stopping at the Phase 6 boundary with `runCompleted = false`.
- Continuation monitoring a saved active semantic job.
- Continuation accepting a saved completed semantic job.
- Prior failed, canceled, or unavailable jobs allowing one replacement.
- A new job failure not causing a second start in the same invocation.
- A missing saved job ID allowing one start and logging the persistence-gap risk.
- Already completed Phase 5 not rerunning semantic scoring.
- Phase 5 failures being persisted with `phase: 5`.

Run verification in this order:

1. Build `db-models` because ops uses its local package.
2. Run the ops type check.
3. Run the ops test suite.
4. Build ops.
5. Run worker-node build and tests only if implementation changes its contract. No worker-node change is expected.

Do not run the real weekly-flow entry point as an automated smoke test because it performs destructive earlier phases against configured services and databases.

## Documentation Alignment

Update `ops/README.md` to describe:

- Phase 5's untargeted backlog behavior.
- The semantic-scorer start and status endpoints.
- Job identity checks and completion meaning.
- Monitoring and continuation behavior.
- Replacement and lost-job-ID boundaries.
- Phase-specific configuration.
- Logging and operator correlation.
- The Phase 6 boundary.
- Safe database-free verification commands.

Correct stale README statements that still say Phase 4 is unimplemented, while avoiding any claim that Phase 6, Phase 7, scheduling, or the complete weekly flow is implemented.

## Scope Exclusions

- Do not target semantic scoring with `articleCount` or Phase 4 Article IDs.
- Do not recalculate or modify `articleCount`.
- Do not change semantic-scoring selection or per-article error behavior.
- Do not add semantic result counts unless worker-node gains a separately reviewed contract.
- Do not use `GET /queue-info/latest-job` as proof that a job belongs to the weekly run.
- Do not add a Phase 5 timeout or coordinator cancellation policy.
- Do not add cross-phase worker abstractions solely for future reuse.
- Do not implement Phase 6 or Phase 7.
- Do not add or install systemd units.
