---
created_at: 2026-11-09T21:54:05Z
updated_at: 2026-11-09T22:01:06Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly flow false-success fix: todo v01

## How to use this todo

- Source plan: `docs/20261107_weekly_flow_false_success_plan_v05.md`. Read it fully before starting. It holds the reasons, examples, and Out of Scope decisions.
- Work on branch `dev_43_weekly_flow_false_success`.
- Follow the plan's Design Constraints. If a task seems to need something outside them, stop and ask the operator.
- Do the phases in order. Each phase ends with checks and one commit.

## End-of-phase routine

Run the commands for the package or packages the phase changed:

| Package | Type check | Tests | Build |
| ------- | ---------- | ----- | ----- |
| worker-node | covered by build | `npm test` | `npm run build` |
| ops | `npm run typecheck` | `npm test` | `npm run build` |
| worker-python | none | `./venv/bin/pytest tests/unit/ai_approver_v02 tests/integration/test_ai_approver_v02_routes.py` | `./venv/bin/python -m compileall -q src` |

1. Run the commands from inside the package directory.
2. If a test fails, fix the code so the intended behavior stays and the test passes. Do not weaken or delete a test to make it pass, except where a task says to replace one.
3. Check off the completed tasks in this file.
4. Commit the phase's changes and this file. Follow `## Git Guidance` in the root `AGENTS.md`. Reference this todo and the phase number in the commit body instead of a long list.

## Phase 1: worker-node stop rule

File: `worker-node/src/modules/jobs/stateAssignerJob.ts`. Plan Section 1.

- [x] Add module constant `MAX_ARTICLE_FAILURES_SINCE_SUCCESS = 3`.
- [x] In `processStateAssignmentsWithTimeout`, track `failuresSinceSuccess`:
  - [x] Reset to 0 after a successful article.
  - [x] Leave unchanged on a timeout (skipped article).
  - [x] Add 1 in the existing `catch` block, after the existing abort check.
- [x] Add the prompt ID (`prompt.id`) to the existing `Failed to process article <id>: <message>` error log.
- [x] When `failuresSinceSuccess` reaches the limit, log an error and throw a plain `Error`. Message format:
  - `State assigner stopped after 3 article failures since the last success (completed X, skipped Y, failed Z); last article <articleId>, prompt <promptId>: <last error message>`
- [x] After the loop ends normally, log one info line with the final completed, skipped, and failed counts.
- [x] Do not change cancellation behavior. An aborted signal still returns counts without counting a failure.

Tests in `worker-node/tests/modules/stateAssignerJob.test.ts`:

- [x] Three failures with no success throw. The message has the counts, last article ID, prompt ID, and last error.
- [x] Success reset: fail, fail, success, fail, fail completes without throwing.
- [x] Mixed types: a Codex-style failure, an invalid-response-style failure, and another Codex-style failure throw on the third article. (In worker-node both are just thrown errors with different messages.)
- [x] Timeouts do not count: fail, timeout, fail, timeout completes without throwing.
- [x] Abort still returns counts. Keep or extend the existing abort test.
- [x] Run the end-of-phase routine for worker-node and commit.

## Phase 2: worker-node prompt removal

File: `worker-node/src/modules/state-assigner/codexCliClient.ts`, function `analyzeArticleWithCodexCli`. Plan Section 2.

- [x] Raise `OUTPUT_TAIL_CHARS` from 400 to 2000.
- [x] Collect the full stdout and stderr text for each call instead of rolling tails. Remove or replace `recordTail` as needed.
- [x] Before building any error message, replace every exact occurrence of the built `prompt` with `[prompt removed]` in both streams. Then keep the last `OUTPUT_TAIL_CHARS` characters of each.
- [x] Apply this to every existing error path that includes output (nonzero exit, stdin error, unreadable output file, empty output, invalid JSON).
- [x] Leave the invalid-JSON `output file tail` as the model's reply, limited to `OUTPUT_TAIL_CHARS`.

Tests in `worker-node/tests/modules/stateAssignerCodexClient.test.ts`:

- [x] Update the existing bounded-tail test (`'a'.repeat(450)` followed by `failure tail`) so it still proves the tail is bounded at the new 2000-character limit.
- [x] stderr containing the full prompt followed by an error: the message contains the error and does not contain the prompt.
- [x] Same case with a prompt longer than 2000 characters: the prompt is still removed whole.
- [x] Run the end-of-phase routine for worker-node and commit.

## Phase 3: ops Phase 6 gate

File: `ops/src/weekly-flow-02/phases/06_runStateAssignment.ts`. Plan Section 3.

- [x] In the `job.status === 'completed'` branch, after the existing `monitoringLimited` and missing-result checks and before `recordPhaseSixCompleted`, add the rule: `selectedCount > 0` and `completedCount === 0` means the job did not succeed.
  - [x] If `startedThisInvocation`, throw `RunStateAssignmentError('unsuccessful_result', ...)` with a message like `State assigner completed 0 of 1547 selected articles (skipped 0, failed 1547)`.
  - [x] Otherwise, follow the existing saved-failed-job path: emit `replacement_eligible`, set `pendingContinuation` with reason `saved_job_failed`, clear `jobId`, and `continue`. Copy the existing pattern from the `failed` / `canceled` branch.
- [x] In the existing `failed` / `canceled` branch, append the job's `failureReason` to the thrown message when present.
- [x] Do not add a continuation reason or touch `persistence.ts` or `sequelizePersistence.ts`.

Tests in `ops/tests/weekly-flow-02/06_runStateAssignment.test.ts`:

- [x] A completed job with `selected > 0, completed = 0` started this invocation throws `unsuccessful_result` and does not call `recordPhaseSixCompleted`.
- [x] The same result from a saved job becomes replacement-eligible and a new job is started.
- [x] `selected = 0` still completes Phase 6.
- [x] A partial result (`completed > 0`, some failed) still completes Phase 6.
- [x] A failed job's thrown message includes its `failureReason`.
- [x] Run the end-of-phase routine for ops and commit.

## Phase 4: worker-python V02

Files: `worker-python/src/modules/ai_approver_v02/client.py` and `orchestrator.py`. Plan Section 4.

Client (`evaluate`):

- [ ] On a nonzero exit, take `result.stderr`, replace every exact occurrence of `rendered_prompt` with `[prompt removed]`, keep the last 2000 characters, and append that to the existing `error_message` text.
- [ ] On `OSError`, append the exception text to the existing `error_message`.
- [ ] Do not include `result.stdout`. Do not change any `error_code`.

Orchestrator (`run`):

- [ ] Replace the literals with module constants `MAX_CLI_FAILURES_SINCE_SUCCESS = 3` and `MAX_INVALID_RESPONSES_SINCE_SUCCESS = 3`. The invalid-response limit changes from 5 to 3.
- [ ] Keep the existing reset rule: only a completed outcome resets both counters.
- [ ] Log a loguru warning for each `failed` or `invalid_response` outcome: run ID, article ID, prompt version ID (`prompt["id"]`), `error_code`, `error_message`.
- [ ] Log a loguru error when either breaker trips: run ID, ending reason, last article ID, prompt version ID, and the last `error_message`.
- [ ] Keep ending reasons `codex_cli_failures` and `invalid_responses` and run status `circuit_breaker` unchanged.

Tests (existing files, existing `FakeRepository` and `FakeClient` helpers, no new test architecture):

- [ ] `test_client.py`: replace `test_client_redacts_prompt_from_process_failure`. stderr holds the prompt followed by a provider error such as `model_not_found`. Assert `error_message` does not contain the prompt, contains the provider error, and does not contain stdout content.
- [ ] `test_client.py`: a prompt longer than 2000 characters in stderr is removed whole.
- [ ] `test_orchestrator.py`: update `test_orchestrator_stops_at_invalid_response_breaker` to trip on the third invalid response since the last completed evaluation.
- [ ] `test_orchestrator.py`: the CLI-failure breaker still trips at 3.
- [ ] `test_orchestrator.py`: mixed outcomes CLI failure, invalid, CLI failure, invalid, CLI failure trip `codex_cli_failures` on the fifth article.
- [ ] `test_orchestrator.py`: success reset CLI failure, CLI failure, completed, CLI failure, CLI failure finishes the run as `completed`.
- [ ] Run the end-of-phase routine for worker-python and commit.

## Phase 5: Documentation

Plan Section 6.

- [ ] `ops/AGENTS.md`, Phase 6 Worker Contract: replace "A completed result may select zero Articles or contain skipped and failed Articles." with a line saying a completed result may select zero Articles, but a result that selected Articles must have at least one completed Article.
- [ ] `worker-node/AGENTS.md`, state-assigner section: note the stop after 3 article failures since the last success, and that Codex output in errors has the prompt removed.
- [ ] `docs/CODEX_CLI_PRODUCTION_RUNBOOK.md`, Section 2: replace "Both workers keep going after each failed article. One bad setting can fail a whole batch while the job still shows as completed. Check the failed counts." with the plan's stop rules table and its notes. Update the runbook's `updated_at` and `modified_by`.
- [ ] Update `updated_at` and `modified_by` in any other edited file that has YAML frontmatter.
- [ ] Run all three packages' end-of-phase routines once more, then commit.

## Phase 6: Hand-off to the operator

The implementing agent does not deploy or touch any server.

- [ ] Push the branch only if the operator asks.
- [ ] Tell the operator the work is ready, with the commit list and test results.
- [ ] Remind the operator of the plan's optional manual check on `nws-nn12dev` (plan Section 8) and the deployment steps (plan Section 9). The operator runs both.
