---
created_at: 2026-11-09T21:09:10Z
updated_at: 2026-11-09T21:09:10Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly flow false-success fix: plan v02

## Changes from v01

- The operator accepted the v01 recommendations for all five open questions. They are now recorded under Out of Scope.
- Added Design Constraints to keep the fix small and inside the existing architecture.
- The technical approach is unchanged.

## Problem

Run 6 sent 1,547 articles to the state assigner. Every one failed because Codex rejected the model. The job still finished as `completed`, so ops recorded Phase 6 as a success. Phase 7 then found nothing eligible, and the weekly run ended green.

See `docs/20261107_NewsNexus12_Weekly_Flow_02_Phases_6_7_Failure_Report.md`.

## Goal

1. Stop the state-assigner job when articles keep failing.
2. Stop the weekly flow when Phase 6 produces no state assignments.
3. Log why Codex failed, in Codex's own words, in both workers.

## Design Constraints

This is a lean fix. The implementing agent should keep to these limits:

- No new database tables, columns, or migrations.
- No new environment variables or settings.
- No new persisted continuation reasons, error categories, or error classes.
- No changes to worker HTTP contracts or the ops-to-worker request shape.
- No parsing of Codex error text to classify errors.
- Change only the functions named below, plus their tests and two documentation lines.

If the fix seems to need something outside these limits, stop and ask the operator.

## What already works and stays unchanged

- AI Approver V02 already stops after 3 consecutive Codex failures or 5 consecutive invalid responses. Its run ends as `circuit_breaker`.
- Phase 7 already treats `failed`, `canceled`, and `circuit_breaker` as failures.
- Phase 7 typed zero work (`no_eligible_articles`) stays as it is. Once Phase 6 fails properly, Phase 7 never runs after a total Phase 6 failure.
- A Phase 6 error already goes through `recordFailure` with `phase: 6` and sets `process.exitCode = 1`, so the systemd service shows as failed.
- The worker-node queue engine already turns a thrown job error into status `failed`, stores it as `failureReason`, and logs it.
- worker-node already logs each article failure with a tail of Codex output.

## 1. worker-node: stop on consecutive failures

File: `worker-node/src/modules/jobs/stateAssignerJob.ts`, function `processStateAssignmentsWithTimeout`.

- Add a module constant `MAX_CONSECUTIVE_ARTICLE_FAILURES = 3`, matching V02's Codex limit.
- Track `consecutiveFailures`. A successful article resets it to 0. A timeout (skipped) leaves it unchanged.
- On the third consecutive failure, log an error and throw a plain `Error`.
- The message includes the counts so far and the last article error, for example:

```text
State assigner stopped after 3 consecutive article failures (completed 0, skipped 0, failed 3); last error: codex exec exited with code 1; output tail: ...
```

- Articles persisted before the stop keep their state rows.
- This applies to both backends (Codex CLI and OpenAI API). The loop does not need to know which one is active.
- Cancellation behavior stays the same. An aborted signal still returns without counting a failure.
- After the loop finishes normally, add one info log with the final counts.

## 2. worker-node: keep more Codex output

File: `worker-node/src/modules/state-assigner/codexCliClient.ts`.

- Raise `OUTPUT_TAIL_CHARS` from 400 to 2000.
- Reason: Codex 0.166.0 prints two warnings (bubblewrap and Code Mode) totaling about 490 characters on every call. A 400-character tail can cut off the real error.

No other change to the client.

## 3. ops Phase 6: zero assignments is not success

File: `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`.

In the `job.status === 'completed'` branch, before `recordPhaseSixCompleted`:

- Rule: if `selectedCount > 0` and `completedCount === 0`, the job did not succeed.
- Zero selection (`selectedCount === 0`) stays a valid completed result.
- Any result with at least one completed article stays a valid completed result.
- If the job started in this invocation, throw `RunStateAssignmentError('unsuccessful_result', ...)`. Message example: `State assigner completed 0 of 1547 selected articles (skipped 0, failed 1547)`.
- If it is a saved job from an earlier invocation, handle it the same way the existing code handles a saved failed job: emit `replacement_eligible` and set `pendingContinuation` with the existing reason `saved_job_failed`.

In the existing `failed` / `canceled` branch:

- Append the job's `failureReason` to the thrown message when present. The ops log and the run's `lastError` then show the worker's error, not only `ended with status failed`.

## 4. worker-python V02: log why Codex failed

File: `worker-python/src/modules/ai_approver_v02/client.py`, method `evaluate`.

- On a nonzero exit, append the last 2000 characters of `result.stderr` to `error_message`. This is already stored in `AiApproverArticlePredictionsV02.errorMessage`, a `TEXT` column.
- On `OSError`, append the exception text.
- `error_code` values stay the same.

File: `worker-python/src/modules/ai_approver_v02/orchestrator.py`.

- Log a loguru warning for each `failed` or `invalid_response` outcome: run ID, article ID, `error_code`, `error_message`.
- Log a loguru error when a circuit breaker trips: run ID, ending reason, and the last outcome's `error_message`.

No change to breaker thresholds or run statuses.

## 5. Documentation

- `ops/AGENTS.md`, Phase 6 Worker Contract: change "A completed result may select zero Articles or contain skipped and failed Articles" to say a completed result that selected Articles must have at least one completed Article.
- `worker-node/AGENTS.md`, state-assigner section: note that the job stops after 3 consecutive article failures.

## 6. Tests

worker-node (`npm test`, `npm run build`):

- `tests/modules/stateAssignerJob.test.ts`: three consecutive failures throw with counts and last error. A success between failures resets the counter. Timeouts do not count. Abort still returns counts.
- `tests/modules/stateAssignerCodexClient.test.ts`: an error at the end of a long stderr survives in the message.

ops (`npm run typecheck`, `npm test`):

- `tests/weekly-flow-02/06_runStateAssignment.test.ts`:
  - A completed job with `selected > 0, completed = 0` throws `unsuccessful_result` when started this invocation.
  - The same saved job becomes replacement-eligible on continuation.
  - `selected = 0` still completes.
  - A partial result (`completed > 0`) still completes.
  - A failed job's error message includes `failureReason`.

worker-python (`pytest tests/unit/ai_approver_v02`):

- `test_client.py`: a nonzero exit keeps the stderr tail in `error_message`.
- `test_orchestrator.py`: the breaker still trips at 3 and logs the reason.

## 7. Deployment

- Rebuild and restart worker-node and worker-python, then rebuild ops.
- No database or contract changes.
- Order does not matter. The worker-node change only makes jobs fail sooner, and ops already handles failed jobs.

## Out of Scope

The operator decided these on November 9, 2026. Revisit only if production shows a need.

1. Partial-failure threshold. Phase 6 fails only on zero completed articles, not on a high failure rate. The consecutive-failure stop catches most systemic failures.
2. Phase 7 zero-completion gate. The existing V02 breakers cover the realistic cases.
3. Fail on the first permanent error. No parsing of Codex error text, such as `model_not_found`. Three articles is a cheap cost.
4. Configurable breaker threshold. The threshold stays a constant of 3, matching V02.
5. Alerting on a failed run. A failed systemd service is the signal for now. Notifications would be a separate plan.
