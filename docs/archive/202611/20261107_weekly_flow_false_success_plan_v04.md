---
created_at: 2026-11-09T21:35:17Z
updated_at: 2026-11-09T21:35:17Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly flow false-success fix: plan v04

## Changes from v03

The operator asked for consistent logs and consistent stop rules across both workers.

- Logs: both workers remove the prompt and article text from Codex output, and log the article ID and prompt ID instead (Sections 2, 4, 5).
- Stop rules: V02's invalid-response limit drops from 5 to 3, so every stop condition is 3 in a row (Section 4.4).
- worker-node still uses one counter for all failures. A Codex failure and an invalid response both log and end the run, which is the intended behavior.
- The v03 open question is answered: prompt-removed Codex output is accepted in both workers.
- Out of Scope item 6 from v03 (no prompt removal in worker-node) is removed.

## Problem

Run 6 sent 1,547 articles to the state assigner. Every one failed because Codex rejected the model. The job still finished as `completed`, so ops recorded Phase 6 as a success. Phase 7 then found nothing eligible, and the weekly run ended green.

See `docs/20261107_NewsNexus12_Weekly_Flow_02_Phases_6_7_Failure_Report.md`.

## Goal

1. Stop the state-assigner job after 3 failed articles in a row.
2. Stop the weekly flow when Phase 6 produces no state assignments.
3. Use the same limit of 3 for every stop condition in both workers.
4. Log why Codex failed, in Codex's own words, without the prompt or article text, and with the article ID and prompt ID.

## Design Constraints

This is a lean fix. The implementing agent should keep to these limits:

- No new database tables, columns, or migrations.
- No new environment variables or settings.
- No new persisted continuation reasons, error categories, or error classes.
- No changes to worker HTTP contracts or the ops-to-worker request shape.
- No parsing of Codex error text to classify errors. Removing the prompt is a plain string replace, not classification.
- Change only the functions named below, plus their tests and the listed documentation lines.

If the fix seems to need something outside these limits, stop and ask the operator.

## Resulting stop rules

| Worker | Condition | Result |
| ------ | --------- | ------ |
| worker-node state assigner | 3 failed articles in a row (Codex failure or invalid response) | Job `failed`; Phase 6 fails; weekly run fails |
| ops Phase 6 | Job completed with articles selected but none completed | Phase 6 fails; weekly run fails |
| worker-python V02 | 3 Codex failures in a row | Run `circuit_breaker`; Phase 7 fails; weekly run fails |
| worker-python V02 | 3 invalid responses in a row | Run `circuit_breaker`; Phase 7 fails; weekly run fails |

V02 keeps its two separate counters. worker-node cannot tell the two failure types apart without a new error class, and does not need to.

## What already works and stays unchanged

- Phase 7 already treats `failed`, `canceled`, and `circuit_breaker` as failures.
- Phase 7 typed zero work (`no_eligible_articles`) stays as it is. Once Phase 6 fails properly, Phase 7 never runs after a total Phase 6 failure.
- A Phase 6 error already goes through `recordFailure` with `phase: 6` and sets `process.exitCode = 1`, so the systemd service shows as failed.
- The worker-node queue engine already turns a thrown job error into status `failed`, stores it as `failureReason`, and logs it.
- In worker-node, both Codex failures and invalid responses already reach the job loop as thrown errors and are counted as failed articles.

## 1. worker-node: stop on consecutive failures

File: `worker-node/src/modules/jobs/stateAssignerJob.ts`, function `processStateAssignmentsWithTimeout`.

- Add a module constant `MAX_CONSECUTIVE_ARTICLE_FAILURES = 3`.
- Track `consecutiveFailures`. A successful article resets it to 0. A timeout (skipped) leaves it unchanged.
- On the third consecutive failure, log an error and throw a plain `Error`.
- The message includes the counts so far, the last article ID, the prompt ID, and the last article error, for example:

```text
State assigner stopped after 3 consecutive article failures (completed 0, skipped 0, failed 3); last article 485308, prompt 12: codex exec exited with code 1; output tail: ...
```

- Articles persisted before the stop keep their state rows.
- This applies to both backends (Codex CLI and OpenAI API). The loop does not need to know which one is active.
- Cancellation behavior stays the same. An aborted signal still returns without counting a failure.
- The existing per-article failure log, `Failed to process article <id>: <message>`, adds the prompt ID (`prompt.id`, already in scope).
- After the loop finishes normally, add one info log with the final counts.

## 2. worker-node: remove the prompt and keep more output

File: `worker-node/src/modules/state-assigner/codexCliClient.ts`, function `analyzeArticleWithCodexCli`.

Today stdout and stderr are kept as rolling 400-character tails. A rolling tail can hold part of the prompt, which an exact string replace cannot remove.

Change:

1. Collect the full stdout and stderr text for the call instead of rolling tails.
2. When building an error message, replace every exact occurrence of the built `prompt` with `[prompt removed]` in each stream.
3. Then keep the last `OUTPUT_TAIL_CHARS` characters, raised from 400 to 2000.

Notes:

- Codex 0.166.0 prints two warnings totaling about 490 characters on every call. A 400-character tail can cut off the real error.
- The output collected for one call is discarded when the call ends. Memory use is bounded by one article's Codex output.
- The `output file tail` added on invalid JSON is the model's reply, not the prompt. It stays, also limited to 2000 characters.

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

## 4. worker-python V02

### 4.1 Current contract and the change

Today a nonzero Codex exit stores only `Codex execution failed with exit code N`. The test `test_client_redacts_prompt_from_process_failure` enforces that no process output reaches `error_message`.

That rule keeps article text out of the database and logs, but it also hides the provider's error. That is why Run 6's cause was invisible on the Python side.

v04 keeps the purpose of the rule, keeping prompt and article text out, and drops the broader effect of hiding all output. The operator accepted this change.

### 4.2 Client change

File: `worker-python/src/modules/ai_approver_v02/client.py`, method `evaluate`.

On a nonzero exit:

1. Take `result.stderr`.
2. Replace every exact occurrence of `rendered_prompt` with `[prompt removed]`. Do this before truncating, so a long prompt is removed whole.
3. Keep the last 2000 characters.
4. Append that excerpt to the existing `error_message` text.

On `OSError`, append the exception text.

- `error_code` values stay the same.
- `result.stdout` is not included. On failure it holds no useful diagnostics.
- The result is already stored in `AiApproverArticlePredictionsV02.errorMessage`, a `TEXT` column.

### 4.3 Orchestrator logging

File: `worker-python/src/modules/ai_approver_v02/orchestrator.py`.

- Log a loguru warning for each `failed` or `invalid_response` outcome: run ID, article ID, prompt version ID (`prompt["id"]`), `error_code`, `error_message`.
- Log a loguru error when a circuit breaker trips: run ID, ending reason, last article ID, prompt version ID, and the last outcome's `error_message`.

### 4.4 Invalid-response limit

Same file. Change the invalid-response limit from 5 to 3.

- Replace the literals with module constants `MAX_CONSECUTIVE_CLI_FAILURES = 3` and `MAX_CONSECUTIVE_INVALID_RESPONSES = 3`.
- Counter reset rules stay the same: only a completed outcome resets both counters.
- Ending reasons `codex_cli_failures` and `invalid_responses` stay the same.

## 5. Known limit of prompt removal

If Codex echoes the prompt in an altered form, fragments could remain in the excerpt. The prompt is public news article text, and the excerpt is capped at 2000 characters, so the impact is low.

## 6. Documentation

- `ops/AGENTS.md`, Phase 6 Worker Contract: change "A completed result may select zero Articles or contain skipped and failed Articles" to say a completed result that selected Articles must have at least one completed Article.
- `worker-node/AGENTS.md`, state-assigner section: note that the job stops after 3 consecutive article failures, and that Codex output in errors has the prompt removed.
- `docs/CODEX_CLI_PRODUCTION_RUNBOOK.md`, Section 2: replace "Both workers keep going after each failed article. One bad setting can fail a whole batch while the job still shows as completed. Check the failed counts." with the stop rules table from this plan.

## 7. Tests

worker-node (`npm test`, `npm run build`):

- `tests/modules/stateAssignerJob.test.ts`:
  - Three consecutive failures throw with counts, last article ID, prompt ID, and last error.
  - A success between failures resets the counter.
  - Timeouts do not count.
  - Abort still returns counts.
- `tests/modules/stateAssignerCodexClient.test.ts`:
  - Update the existing bounded-tail test (`'a'.repeat(450)`) for the 2000-character limit.
  - stderr containing the full prompt followed by an error: the message contains the error and not the prompt, even when the prompt is longer than 2000 characters.

ops (`npm run typecheck`, `npm test`):

- `tests/weekly-flow-02/06_runStateAssignment.test.ts`:
  - A completed job with `selected > 0, completed = 0` throws `unsuccessful_result` when started this invocation.
  - The same saved job becomes replacement-eligible on continuation.
  - `selected = 0` still completes.
  - A partial result (`completed > 0`) still completes.
  - A failed job's error message includes `failureReason`.

worker-python (`pytest tests/unit/ai_approver_v02`):

- `test_client.py`: replace `test_client_redacts_prompt_from_process_failure` with a test where stderr contains the prompt followed by a provider error such as `model_not_found`. Assert that `error_message`:
  - does not contain the prompt text,
  - contains the provider error,
  - does not contain stdout content.
- `test_client.py`: a long prompt in stderr is removed whole even when stderr exceeds 2000 characters.
- `test_orchestrator.py`:
  - Update `test_orchestrator_stops_at_invalid_response_breaker` so the breaker trips on the third consecutive invalid response.
  - The CLI-failure breaker still trips at 3.
  - Both breakers log the reason.

## 8. Deployment

- Rebuild and restart worker-node and worker-python, then rebuild ops.
- No database or contract changes.
- Order does not matter. The worker changes only make jobs and runs stop sooner, and ops already handles both outcomes.

## Out of Scope

The operator decided these on November 9, 2026. Revisit only if production shows a need.

1. Partial-failure threshold. Phase 6 fails only on zero completed articles, not on a high failure rate. The consecutive-failure stop catches most systemic failures.
2. Phase 7 zero-completion gate. The V02 breakers cover the realistic cases.
3. Fail on the first permanent error. No parsing of Codex error text, such as `model_not_found`. Three articles is a cheap cost.
4. Configurable thresholds. All limits stay constants of 3.
5. Alerting on a failed run. A failed systemd service is the signal for now. Notifications would be a separate plan.
6. Separate failure counters in worker-node. One counter covers Codex failures and invalid responses, because both should log and end the run.
