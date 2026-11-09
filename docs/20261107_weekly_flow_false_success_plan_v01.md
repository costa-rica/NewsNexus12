---
created_at: 2026-11-07T18:00:15Z
updated_at: 2026-11-07T18:00:15Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly flow false-success fix: plan v01

## Problem

Run 6 sent 1,547 articles to the state assigner. Every one failed because Codex rejected the model. The job still finished as `completed`, so ops recorded Phase 6 as a success. Phase 7 then found nothing eligible, and the weekly run ended green.

See `docs/20261107_NewsNexus12_Weekly_Flow_02_Phases_6_7_Failure_Report.md`.

## Goal

- A Phase 6 that produces zero state assignments fails the weekly run, with a nonzero exit.
- A systemic Codex failure stops the state-assigner job after a few articles, not after an hour.
- When Codex fails, both workers' logs say why, in Codex's own words.

This is a lean fix. Stricter partial-failure policies are listed as open questions.

## What already works and stays unchanged

- AI Approver V02 already stops after 3 consecutive Codex failures or 5 consecutive invalid responses. Its run ends as `circuit_breaker`.
- Phase 7 already treats `failed`, `canceled`, and `circuit_breaker` as failures.
- Phase 7 typed zero work (`no_eligible_articles`) stays as it is. Once Phase 6 fails properly, Phase 7 never runs after a total Phase 6 failure.
- A Phase 6 failure already goes through `recordFailure` with `phase: 6` and sets `process.exitCode = 1`, so the systemd service shows as failed.
- worker-node already logs each article failure with a 400-character tail of Codex output.

## 1. worker-node: stop on consecutive failures

File: `worker-node/src/modules/jobs/stateAssignerJob.ts`, function `processStateAssignmentsWithTimeout`.

- Add `MAX_CONSECUTIVE_ARTICLE_FAILURES = 3`, matching V02's Codex limit.
- Track `consecutiveFailures`. A successful article resets it. A timeout (skipped) leaves it unchanged.
- On the third consecutive failure, log an error and throw.
- The thrown message includes the counts so far and the last article error, for example:

```text
State assigner stopped after 3 consecutive article failures (completed 0, skipped 0, failed 3); last error: codex exec exited with code 1; output tail: ...
```

The queue engine already turns a thrown error into job status `failed` with that message as `failureReason`, and logs it. Articles persisted before the stop keep their state rows.

- This applies to both backends (Codex CLI and OpenAI API).
- Cancellation behavior stays the same. An aborted signal still returns without counting a failure.
- After the loop, add one info log with the final counts, so a completed job's outcome shows in the journal.

## 2. worker-node: keep more Codex output

File: `worker-node/src/modules/state-assigner/codexCliClient.ts`.

- Raise `OUTPUT_TAIL_CHARS` from 400 to 2000.
- Reason: Codex 0.166.0 prints two warnings (bubblewrap and Code Mode) totaling about 490 characters on every call. A 400-character tail can cut off the real error.

No other change to the client.

## 3. ops Phase 6: zero assignments is not success

File: `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`, in the `job.status === 'completed'` branch, before `recordPhaseSixCompleted`.

- Rule: if `selectedCount > 0` and `completedCount === 0`, the job did not succeed.
- Zero selection (`selectedCount === 0`) stays a valid completed result.
- If the job started in this invocation, throw `RunStateAssignmentError('unsuccessful_result', ...)`. Message example: `State assigner completed 0 of 1547 selected articles (skipped 0, failed 1547)`.
- If it is a saved job from an earlier invocation, treat it like a saved failed job. Emit `replacement_eligible` and set `pendingContinuation` with the existing reason `saved_job_failed`. No new persisted reason, so `persistence.ts` and `sequelizePersistence.ts` need no changes.

Also in the failed/canceled branch, add the worker's `failureReason` to the thrown message when present. The ops log and the run's `lastError` then show the Codex error, not only `ended with status failed`.

## 4. worker-python V02: log why Codex failed

File: `worker-python/src/modules/ai_approver_v02/client.py`.

- On a nonzero exit, include the last 2000 characters of `result.stderr` in `error_message`, after the existing text. This value is already stored in `AiApproverArticlePredictionsV02.errorMessage`, a `TEXT` column.
- On `OSError`, include the exception text.
- `error_code` values stay the same.

File: `worker-python/src/modules/ai_approver_v02/orchestrator.py`.

- Log a warning with loguru for each `failed` or `invalid_response` outcome: run ID, article ID, `error_code`, `error_message`.
- Log an error when a circuit breaker trips: run ID, ending reason, and the last outcome's `error_message`.

Today V02 writes nothing to the journal about Codex failures, and stores only `Codex execution failed with exit code N`.

## 5. Documentation

- `ops/AGENTS.md`, Phase 6 Worker Contract: change "A completed result may select zero Articles or contain skipped and failed Articles" to say a completed result with selected Articles must have at least one completed Article.
- `worker-node/AGENTS.md`: note the 3-consecutive-failure stop in the state-assigner section.

## 6. Tests

worker-node (`npm test`, `npm run build`):

- `tests/modules/stateAssignerJob.test.ts`: three consecutive failures throw with counts and last error. A success between failures resets the counter. Timeouts do not count. Abort still returns counts.
- `tests/modules/stateAssignerCodexClient.test.ts`: an error at the end of a long stderr survives in the message.

ops (`npm run typecheck`, `npm test`):

- `tests/weekly-flow-02/06_runStateAssignment.test.ts`: a completed job with `selected > 0, completed = 0` throws `unsuccessful_result` when started this invocation. The same saved job becomes replacement-eligible on continuation. `selected = 0` still completes. A partial result (`completed > 0`) still completes. A failed job's message includes `failureReason`.

worker-python (`pytest tests/unit/ai_approver_v02`):

- `test_client.py`: a nonzero exit keeps the stderr tail in `error_message`.
- `test_orchestrator.py`: the breaker still trips at 3 and logs. Existing behavior is unchanged.

## 7. Deployment

- Rebuild and restart worker-node and worker-python, then rebuild ops. No database or contract changes.
- Order does not matter. The worker-node change only makes jobs fail sooner; ops already handles failed jobs.

## Open Questions

### 1. Partial-failure threshold

Should Phase 6 also fail when most articles fail but a few succeed, for example more than 50% failed?

- The lean rule only catches zero successes.
- The consecutive-failure stop already catches most systemic failures, so a mostly-failed but completed job should be rare.

#### Operator Response

(claude) Skip for now. Revisit only if a run completes with mostly failures.

### 2. Phase 7 zero-completion gate

Should Phase 7 also fail when a V02 run completes with attempts but zero completed predictions?

- This needs failures interleaved so neither V02 breaker trips. Unlikely.

#### Operator Response

(claude) Skip. The existing V02 breakers cover the realistic cases.

### 3. Fail on the first permanent error

Should known permanent errors, such as `model_not_found` or a login failure, stop the job on the first article instead of the third?

- This means parsing Codex error text, which can change between versions.

#### Operator Response

(claude) Skip. Three articles is cheap, and avoids depending on error wording.

### 4. Breaker threshold setting

Should the threshold of 3 be an environment variable instead of a constant?

#### Operator Response

(claude) Keep a constant. It matches V02 and has no known need to vary.

### 5. Alerting on failure

Should a failed weekly run send a notification, beyond the failed systemd service?

#### Operator Response

(claude) Worth a separate plan. Out of scope for this fix.
