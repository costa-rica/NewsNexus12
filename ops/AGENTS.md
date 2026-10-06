---
created_at: 2026-10-05T22:11:53Z
updated_at: 2026-10-06T19:25:00Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops Agent Instructions

## Scope

- These instructions apply to files under `ops/`.
- Follow the repository-root `AGENTS.md` first. This file adds ops-specific rules.
- Keep operator setup and commands in `ops/README.md`.
- Keep implementation contracts, recovery rules, and testing guidance here or in the versioned documents under `docs/weekly-article-pipeline-v02/`.

## Safety Boundary

- Never run weekly-flow-02 against a real environment unless the operator explicitly authorizes that run.
- The workflow clears duplicate analyses, creates a database backup, deletes eligible old Articles, and starts worker jobs.
- Do not use the runtime entry point as a smoke test.
- Prefer the database-free tests for verification.
- Do not automatically restart worker-python, worker-node, PostgreSQL, or systemd services.
- Do not add or enable a timer or service unless the operator requests the scheduling phase separately.

## Build and Test Commands

Run from the repository root:

```bash
npm run build --workspace @newsnexus/db-models
npm run build --workspace @newsnexus/db-manager
npm run typecheck --workspace newsnexus12-ops
npm test --workspace newsnexus12-ops
npm run build --workspace newsnexus12-ops
```

- Build db-models before ops because ops consumes `@newsnexus/db-models` through a local workspace dependency.
- Build db-manager before a real run because Phases 2 and 3 use its compiled entry point.
- The ops test command explicitly lists compiled test files. Add every new test file to `ops/package.json`.
- Default tests must not connect to PostgreSQL, load package `.env` files, or make real worker requests.
- Coordinator tests that can reach a worker phase must inject controlled dependencies.

## Operator Runtime Command

The established Ubuntu command is:

```bash
sudo -u limited_user -H sh -c 'npm run weekly-flow-02:start --workspace newsnexus12-ops'
```

- Use the guarded launcher rather than running compiled JavaScript directly.
- Pass supported CLI options after npm's `--` separator.
- Rebuild ops after source changes and before using the compiled launcher.

## Coordinator Contract

Weekly-flow-02 currently implements:

1. Clear duplicate analyses through worker-python.
2. Create and verify a db-manager backup.
3. Delete old, unprotected Articles through db-manager.
4. Collect Google News RSS Articles through worker-node.
5. Run semantic scoring through worker-node.
6. Run state assignment through worker-node.
7. Run AI Approver V02 through worker-python and atomically complete the weekly run after verified success or typed zero work.

- Phase 4 zero work atomically completes the run.
- A positive Phase 4 `articleCount` is immutable and is not sent to the semantic scorer.
- Phase 7 reuses the immutable Phase 4 `articleCount` as its position-window count.

## Run Selection and Continuation

- No arguments inspect only the latest run.
- `--new-run` always creates a new run.
- `--continue-run` continues the latest eligible incomplete run.
- `--continue-run ID` targets that exact eligible run.
- Runs stopped during Phases 1–3 are replaced rather than continued.
- Runs past Phase 3 can continue through exactly 72 hours from the original `runStartedAt`.
- Default continuation inside that window, `--continue-run`, and `--continue-run ID` may each revisit incomplete Phase 6 or Phase 7 repeatedly.
- Explicit continuation retains its existing ability to select an eligible older run; it does not bypass completed or Phase 1–3 eligibility checks.
- An unsuccessful invocation exits. It never reinvokes the coordinator or consumes future continuation eligibility.
- Completed Phase 4, Phase 5, and Phase 6 results are reused without restarting their worker jobs. Completed weekly runs are never continued.
- Preserve the original run ID, start time, Phase 4 high-water marks, first RSS IDs, and finalized `articleCount` during continuation.

## Single-Execution Guard

- `ops/scripts/runWeeklyFlow02.sh` acquires `ops/.runtime/weekly-flow-02.lock` with `flock`.
- The lock is held for the coordinator process lifetime.
- An occupied lock exits 75 without creating a run or starting a phase.
- A guard setup failure exits nonzero and must not start the coordinator.
- A leftover lock file does not prove that a process is active; the kernel-held lock is authoritative.
- After forcibly terminating a run, verify that any db-manager child process has ended before retrying.
- A future systemd unit must treat 75 as an expected no-op and preserve process-group termination.
- A future systemd service must not use `Restart=on-failure`, `Restart=always`, or another automatic restart policy.
- Continuation after failure requires another timer trigger or a deliberate operator command.

## Phase 4 Worker Contract

- Start with `POST /request-google-rss/start-job` and an empty JSON body.
- Read status with `GET /queue-info/check-status/:jobId`.
- Cancel with `POST /queue-info/cancel_job/:jobId`.
- Poll immediately, then use the configured interval.
- Require verified RSS success before calculating the database result.
- Keep detailed worker results in logs rather than expanding run-table metadata.
- Never recalculate persisted Phase 4 high-water marks after the phase starts.

## Phase 5 Worker Contract

- Start with `POST /semantic-scorer/start-job` and exactly `{}`.
- Do not send `articleCount`, Article IDs, or another targeting field.
- Poll status immediately and then at the configured interval without overlapping requests.
- Validate worker endpoint identity, job ID, lifecycle status, and chronological timestamps.
- `failed` and `canceled` terminal jobs may omit `startedAt` when they never ran.
- Reset the consecutive transient-failure counter after every valid status.
- Stop immediately on permanent or malformed responses.
- Start no more than one semantic job per coordinator invocation.

Replacement rules:

1. A failed, canceled, or unavailable saved job can be replaced once.
2. Status 404 uses the normal unavailable replacement rule because no job record exists for marker comparison.
3. A verified active saved job is monitored rather than replaced.
4. A job started during the current invocation is never replaced in that invocation.
5. A Phase 5 start without a saved job ID is a persistence gap; log it and start at most one recovery job.

Monitoring-limit rules:

1. The monitoring budget is six hours per invocation by default.
2. Persist a marker containing job ID, worker `createdAt`, and limit time before cancellation.
3. A job matching the marker by both ID and `createdAt` can never complete Phase 5.
4. After `cancel_requested`, wait one interval and perform one final lookup.
5. After cancellation 404, perform one lookup and classify the result.
6. Preserve the marker through cancellation and verification writes.
7. Never replace a monitoring-limited job in the same invocation.
8. Every monitoring-limit branch exits nonzero.
9. On continuation, re-cancel a matching active marked job immediately.
10. A matching inactive marked job can be replaced once; a nonmatching replacement proceeds normally.

Ops cannot infer semantic zero work or prove per-Article scoring coverage. A validated queue-level `completed` record is the Phase 5 success contract.

## Phase 6 Worker Contract

- Start with `POST /state-assigner/start-job` and exactly the persisted threshold and Article count.
- The production threshold is 180 days and the monitoring limit is 12 hours.
- Preserve the Phase 4 `articleCount`; do not recalculate, reduce, or overwrite it.
- Do not send Article IDs, ID ranges, `includeArticlesThatMightHaveBeenStateAssigned`, AI keys, prompt text, Article content, or filesystem paths.
- Poll immediately, then every configured interval without overlapping requests.
- Validate worker endpoint identity, job ID, lifecycle timestamps, exact queue parameters, result inputs, nonnegative counts, and the count invariant.
- A completed result may select zero Articles or contain skipped and failed Articles.
- Stop on the third consecutive transient status failure and reset the counter after a valid response.
- Stop immediately on permanent or malformed responses.
- Start no more than one state-assigner job per coordinator invocation.

Phase 6 replacement rules:

1. A failed, canceled, unavailable, inactive monitoring-limited, or inactive incompatible saved job can be replaced on a later eligible invocation.
2. A saved active job is monitored rather than replaced.
3. A job started or canceled during the current invocation is not replaced in that invocation.
4. A Phase 6 start without a saved job ID is an accepted persistence gap eligible for one start.
5. Replacements perform a new full newest-first selection and can spend additional AI work on older eligible Articles.
6. Start at most one new state-assigner job per invocation, with no lifetime limit on later valid continuation invocations.
7. Malformed, identity-mismatched, ambiguously active, or otherwise unverified jobs are not replacement-eligible.

Phase 6 monitoring-limit rules:

1. Persist a marker tied to job ID and validated `createdAt` before cancellation.
2. After `cancel_requested`, wait one interval and perform one final lookup.
3. After cancellation 404, perform one lookup and classify the result.
4. Never trust or complete Phase 6 from a matching marked job.
5. Exit nonzero on every monitoring-limit branch.
6. On continuation, re-cancel a matching active job or replace it only after verified inactivity.

Phase 6 incompatible-contract rules:

1. Missing required queue parameters use the dedicated incompatible-contract path.
2. Persist every incompatible attempt by exact job ID plus validated `createdAt`, with its missing fields, before cancellation or terminal exit.
3. Merge repeated observations of the same exact identity instead of appending duplicates.
4. Never trust a result from an exact incompatible identity.
5. Cancel active incompatible jobs and verify inactivity or unavailability before later replacement.
6. End the invocation after a newly started or newly canceled incompatible job.
7. A later continuation may start another job regardless of incompatible-attempt history length.
8. Allow a compatible current job to complete after the full contract validates.

## Persistence Rules

- Use `WeeklyArticleFlowRuns02` for durable progress and recovery state.
- Use the dedicated Phase 4, Phase 5, Phase 6, and Phase 7 persistence operations.
- Generic `recordPhaseCompleted` must not complete Phase 5, Phase 6, or Phase 7.
- Persist `semanticScorerJobId` immediately after a successful start.
- Store ordinary Phase 5 observations under `phaseData.phase5.latestProgress`.
- Update `phaseData.phase5.monitoringLimit` only through the explicit monitoring-limit input.
- Preserve sibling start, marker, result, and failure data during progress writes.
- Record Phase 5 failures with `phase: 5` and leave Phase 4 complete.
- Persist immutable Phase 6 inputs before starting worker-node and validate the audit mirror on every Phase 6 write.
- Persist `stateAssignerJobId` immediately after a successful start response.
- Store ordinary Phase 6 observations under `phaseData.phase6.latestProgress`.
- Parse and normalize legacy Phase 6 recovery state through `phaseSixRecoveryState.ts`.
- Store incompatible-contract recovery as compact V06 attempt history and preserve it through every Phase 6 write.
- Use the protected continuation-start persistence operation for every Phase 6 replacement reason.
- Record Phase 6 failures with `phase: 6` and leave Phase 5 complete.
- Persist the immutable Phase 7 input mirror before requesting a preview.
- Store Phase 7 attempts in compact history keyed by V02 run ID. History length never limits continuation.
- Keep `aiApproverV02JobId` equal to the current attempt's job ID or null before binding.
- Never persist preview tokens, selection snapshots, Article content, prompts, or model input.
- Protect continuation previews, job binding, progress, monitoring markers, and completion with exact current-attempt identity checks.
- Complete Phase 7 and the weekly run in one atomic persistence operation.
- Record Phase 7 failures with `phase: 7` and leave Phase 6 complete.

## Phase 7 Worker Contract

- Preview with exactly `selectionMode`, immutable `requestedArticleCount`, `allowPastApprovedBoundary: true`, and `allowDescriptionFallback: true`.
- Treat only typed `no_eligible_articles` as zero work.
- Start with exactly the V02 run ID and the in-memory preview token.
- Read detail by persisted V02 run ID and validate immutable inputs, counters, lifecycle timestamps, and queue identity when present.
- Never compare worker database timestamps to the ops process clock.
- A valid durable completed run may be accepted without queue status. An active run without queue evidence is unverified.
- Start no more than one new V02 job per coordinator invocation.
- Permit unlimited later continuation invocations after verified replacement-eligible outcomes.

Phase 7 recovery rules:

1. Monitor a valid active accepted attempt rather than replacing it.
2. Adopt a recovered job ID only when both the attempt and weekly-row mirrors are null.
3. Replace an unavailable unaccepted preview, verified terminal failure, cancellation, circuit breaker, or verified inactive monitoring-limited attempt only on an eligible invocation.
4. Stop on post-acceptance 404, stale identity, malformed state, ambiguous cancellation, or other unverified outcomes.
5. Stop on start conflict without canceling or modifying another V02 run.
6. Treat queued-without-job-ID as an orphaned accepted run for the current invocation.
7. Reuse the original inputs for every later preview and never aggregate counters across attempts.

Phase 7 monitoring-limit rules:

1. Poll immediately, then serially at the configured interval.
2. Stop on the third consecutive transient failure and reset the counter after a valid detail response.
3. Measure 12 hours from validated queue `createdAt`, including shared-queue wait time.
4. Persist the exact V02 attempt marker before cancellation.
5. Accept only matching `canceled` or `cancel_requested` responses.
6. After `cancel_requested`, wait one interval and perform one final detail request.
7. Never trust late completion from a monitoring-limited V02 run.
8. Exit nonzero on every monitoring-limit path.

Phase 7 logging rules:

- Log the current V02 run ID, current job ID, status, per-attempt counts, recovery decision, queue age, and cancellation outcome.
- Do not log preview tokens, snapshots, Article content, prompts, model input, credentials, or secrets.

## Schema Rollout

- Phase 5 uses the existing `semanticScorerJobId` column and JSON phase data. It adds no schema fields.
- Phase 6 uses the existing `stateAssignerJobId` and `targetArticleThresholdDaysOld` columns and JSON phase data. It adds no schema fields.
- Phase 7 uses the existing `aiApproverV02JobId` column and JSON phase data. It adds no schema fields.
- Phase 4 requires `newsApiRequestIdHighWaterMark` and `articleIdHighWaterMark` on `WeeklyArticleFlowRuns02`.
- Before a real run, verify that both columns exist and that the application role has access.
- If the model changes require rebuild and replenish, take the replenish backup with the old model build before deploying the new model.
- Do not point automated tests at `newsnexus_dev` or `newsnexus_prod`.

## Failure Handling

- Persist verified progress before moving to the next phase.
- Treat timeouts and ambiguous worker outcomes as unverified rather than successful.
- Do not delete a possible backup artifact after a Phase 2 timeout.
- Phase 3 can partially delete before a timeout or process failure; do not retry or restore automatically.
- If repeated Phase 5 attempts cannot stop a marked job, inspect worker-node logs and queue state. Tell the operator that a manual worker-node restart may be necessary.
- If repeated Phase 6 attempts cannot stop a marked job, inspect worker-node logs and queue state. Tell the operator that a manual worker-node restart may be necessary.
- If Phase 7 cannot verify an accepted run or cancellation, inspect worker-python V02 execution state, shared queue state, and coordinator logs before continuing.
- Deploy and restart compatible worker-node code before running the Phase 6 ops build.
- Deploy and restart reviewed worker-python code before running the Phase 7 ops build.
- Never log credentials, environment secrets, Article text, keyword contents, or database connection secrets.
- Suppress nested database diagnostics when an error references the `Users` table, following the persistence adapter's existing policy.

## Key References

- `docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v10.md`
- `docs/weekly-article-pipeline-v02/20261003_weekly_flow_02_persistence_plan_v03.md`
- `docs/weekly-article-pipeline-v02/20261005_ops_semantic_scoring_plan_v03.md`
- `docs/weekly-article-pipeline-v02/20261005_ops_semantic_scoring_todo_v02.md`
- `docs/weekly-article-pipeline-v02/20261006_ops_state_assignment_plan_v06.md`
- `docs/weekly-article-pipeline-v02/20261006_ops_state_assignment_todo_v03.md`
- `docs/weekly-article-pipeline-v02/20261006_ops_ai_approver_v02_plan_v03.md`
- `docs/weekly-article-pipeline-v02/20261006_ops_ai_approver_v02_todo_v02.md`
