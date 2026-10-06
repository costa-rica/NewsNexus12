---
created_at: 2026-10-06T20:43:33Z
updated_at: 2026-10-06T20:43:33Z
created_by: codex (gpt-5.6-sol) nws-nn12dev
modified_by: codex (gpt-5.6-sol) nws-nn12dev
---

# Weekly-flow-02 run 1 Phase 7 investigation

## Scope

This report investigates why weekly-flow-02 run 1 failed in Phase 7 when AI Approver V02 run 37 reached `circuit_breaker` after three Codex CLI failures.

The investigation was read-only. It did not change configuration, code, database data, services, queues, or workflow state. It did not rerun or continue the weekly flow.

Investigation time: 2026-10-06T20:37:16Z through 2026-10-06T20:43:33Z on `nws-nn12dev`.

## Conclusion

The evidence-backed root cause was the worker-python systemd `PATH`, not the requested model.

The service could locate the `codex` launcher because a symlink existed inside its Python virtual environment. The launcher uses `#!/usr/bin/env node`, but the service `PATH` contained only the virtual-environment `bin` directory and did not contain `/usr/bin`, where `node` is installed.

Each launcher invocation therefore terminated with exit code 127 before Codex initialized, authenticated, contacted a model, or evaluated an article. Three consecutive exit-127 outcomes triggered the designed `codex_cli_failures` circuit breaker.

The intended model setting was valid, active, and persisted as `gpt-5.6-luna` on run 37 and all three failed predictions.

## Findings

### 1. The `.env` setting is exact and valid

File: `worker-python/.env`

- File size: 501 bytes.
- Line endings: 20 LF bytes, zero CRLF sequences.
- File ends with LF.
- The setting occurs once.
- It is line 20, immediately after the comment `# AI approver worker-python`.
- Line byte range: offset 461 through offset 499 inclusive.
- The terminating LF is byte offset 500.
- The line is not commented out.
- There is no leading whitespace, trailing whitespace, carriage return, quote, or hidden byte.

Exact line representation:

```text
b'AI_APPROVER_V02_MODEL_NAME=gpt-5.6-luna'
```

Exact line bytes:

```text
41 49 5f 41 50 50 52 4f 56 45 52 5f 56 30 32 5f 4d 4f 44 45 4c 5f 4e 41 4d 45 3d 67 70 74 2d 35 2e 36 2d 6c 75 6e 61
```

The file was last modified at `2026-10-06 15:00:25.430748337+00`, before the current worker-python process started at `2026-10-06 19:53:42+00`.

### 2. Worker-python loaded `gpt-5.6-luna`

The service definition reported:

- User: `limited_user`.
- Group: `limited_user`.
- Working directory: `/home/limited_user/applications/NewsNexus12/worker-python`.
- Environment file: `/home/limited_user/applications/NewsNexus12/worker-python/.env`.
- Process: `/home/limited_user/environments/news_nexus_12/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 8004`.
- Main PID: 31783.
- Start time: `2026-10-06 19:53:42+00`.

`src/main.py` loads the same `.env` before creating AI Approver configuration. `config.py` reads `AI_APPROVER_V02_MODEL_NAME`, strips surrounding whitespace, and passes the value into preview creation.

The strongest runtime evidence is persisted data created by that live process:

- AI Approver V02 run 37 has `modelName=gpt-5.6-luna`.
- All three prediction rows for run 37 have `modelName=gpt-5.6-luna`.

This proves the live worker used the intended setting. A default or malformed-model explanation is contradicted by the database.

### 3. The service PATH could find `codex` but not `node`

Systemd reported this explicit worker-python environment:

```text
PATH=/home/limited_user/environments/news_nexus_12/bin
```

The `.env` file does not define `PATH`, so it did not expand or replace that value.

Within that exact PATH:

```text
/home/limited_user/environments/news_nexus_12/bin/codex
```

resolves through a symlink to:

```text
/usr/local/lib/node_modules/@openai/codex/bin/codex.js
```

The launcher begins with these exact bytes:

```text
#!/usr/bin/env node
```

Running the installed launcher with the worker-python service PATH returned:

```text
exit code: 127
stderr: /usr/bin/env: 'node': No such file or directory
```

Running the same installed CLI with a normal path containing `/usr/bin` returned:

```text
codex-cli 0.160.1
```

This exactly matches the persisted prediction error class and exit code.

### 4. Authentication was not the failing boundary

A direct `codex login status` as `limited_user` was not available to the investigating account because `limited_user`'s `.codex` directory is mode 700 and passwordless user switching is not permitted.

Authentication was nevertheless exercised successfully by independent runtime evidence immediately before Phase 7:

- `newsnexus12-worker-node.service` also runs as `limited_user`.
- Its PATH is `/usr/bin:/usr/local/bin`, which can run both the Codex launcher and `node`.
- At `2026-10-06T20:06:42+00`, it selected `backend=codex-cli` and `modelName=gpt-5.6-luna` for state-assigner job 0041.
- It successfully processed all 20 selected articles through `2026-10-06T20:08:37+00`.
- No 401, token-refresh, revoked-token, or authentication error appeared in that journal window.

This is strong evidence that the `limited_user` Codex credentials were usable minutes before run 37. It is not a direct login-status reading, but authentication cannot explain run 37's exit 127 because the worker-python launcher failed before Node or Codex code started.

### 5. Persisted run and prediction evidence

AI Approver V02 run 37:

- Status: `circuit_breaker`.
- Ending reason: `codex_cli_failures`.
- Model: `gpt-5.6-luna`.
- Job ID: `0010`.
- Planned eligible count: 5.
- Attempted count: 3.
- Completed count: 0.
- Failed count: 3.
- Invalid response count: 0.
- Skipped count: 0.
- Started: `2026-10-06T20:11:22.086809+00`.
- Ended: `2026-10-06T20:11:22.154138+00`.

The three persisted prediction rows were for Articles 465532, 465530, and 465523. Every row recorded:

- `resultStatus=failed`.
- `errorCode=codex_exit_error`.
- `errorMessage=Codex execution failed with exit code 127`.
- `attemptCount=1`.
- `modelName=gpt-5.6-luna`.
- No prediction or reasoning.

The failures were only milliseconds apart. That timing is consistent with immediate launcher failure and inconsistent with three model requests reaching a remote inference service.

### 6. Queue evidence

Worker-python queue record `0010` contains:

- Endpoint: `/ai-approver-v02/start`.
- Parameters: `runId=37`.
- Created: `2026-10-06T20:11:22.035187+00`.
- Started: `2026-10-06T20:11:22.057241+00`.
- Ended: `2026-10-06T20:11:22.156300+00`.
- Queue status: `completed`.
- Queue failure reason: null.
- Queue logs: empty.
- Queue result: null.

The queue status means the queue runner returned normally. It does not mean the AI run succeeded. The nested database run is authoritative and ended in `circuit_breaker`.

### 7. Weekly-flow-02 evidence

Weekly-flow-02 run 1 persisted:

- `runCompleted=false`.
- `lastPhaseCompleted=6`.
- `lastPhaseStarted=7`.
- `aiApproverV02JobId=0010`.
- Phase 7 status: `failed`.
- Last error category: `unsuccessful_terminal_result`.
- Last error message: `V02 run 37 ended with circuit_breaker`.

The coordinator log shows:

1. Phase 7 preview persisted at `20:11:21`, with V02 run 37 and five eligible articles.
2. Job 0010 started at `20:11:22`.
3. The first status observation still showed `running` and zero attempts.
4. The next scheduled observation at `20:16:22` saw `circuit_breaker`, three attempts, and three failures.
5. The coordinator stopped without marking Phase 7 or the weekly run complete.

The five-minute gap is the coordinator polling interval. The worker run itself failed in approximately 67 milliseconds.

### 8. Service journal and log availability

The worker-python journal contains the preview, start, and run-detail HTTP requests. It does not contain per-attempt Codex errors.

The production worker-python application log had no run-37 or exit-127 entry. Its last write was the Phase 1 deduper clear at `2026-10-06 19:54:41+00`.

The V02 client starts Codex with `capture_output=True`, but on a nonzero exit it persists only the numeric return code. It does not log or persist captured stdout or stderr. Its temporary output file is deleted in a `finally` block.

Therefore the original stderr from the three failed attempts is unavailable in the queue record, worker journal, application log, or prediction rows. The exact service-PATH reproduction supplied the missing diagnostic stderr:

```text
/usr/bin/env: 'node': No such file or directory
```

No Codex-owned per-attempt log is expected because the shebang failed before the Node-based Codex program started.

## Root cause chain

1. Worker-python started with `PATH=/home/limited_user/environments/news_nexus_12/bin`.
2. Startup validation used `shutil.which("codex")` and passed because that directory contained a `codex` symlink.
3. The validation did not execute the launcher or verify its interpreter dependency.
4. AI Approver run 37 invoked that launcher with `gpt-5.6-luna`.
5. `/usr/bin/env` searched the restricted PATH for `node` and could not find it.
6. The launcher exited 127 before Codex authentication or model selection occurred.
7. Three consecutive `failed` outcomes triggered `codex_cli_failures` and `circuit_breaker`.
8. Weekly-flow-02 correctly classified the nested terminal result as unsuccessful and stopped Phase 7.

## Remaining uncertainty

The direct output of `codex login status` under the worker-python service identity was not obtainable without elevated user switching.

This does not weaken the root-cause finding:

- Run 37 never reached the authentication code path.
- The same service user successfully completed 20 Codex-backed state assignments with `gpt-5.6-luna` minutes earlier under a PATH that included Node.

After PATH recovery, authentication should still be checked directly before continuation because credentials can change independently over time.

## Recommended recovery

Do not start a new weekly run merely to recover this failure.

1. Correct the worker-python service PATH so it retains the virtual-environment directory and can also resolve the Node runtime. A suitable ordering would include the venv `bin`, `/usr/bin`, and `/usr/local/bin`.
2. Under the exact `limited_user` service identity, HOME, and PATH, verify:
   - `command -v codex`;
   - `command -v node`;
   - `codex --version`;
   - `codex login status`;
   - an approved minimal non-interactive read-only Codex call using `gpt-5.6-luna`.
3. Restart worker-python only after the configuration change is reviewed, then verify startup and `/` health.
4. Re-read weekly run 1 and AI run 37. Confirm run 1 is still eligible for continuation and that no other active V02 run exists.
5. Continue weekly-flow-02 run 1 through the guarded operator path. The Phase 7 contract permits replacement after a verified circuit breaker and should reuse completed Phases 1 through 6.
6. Verify the replacement V02 run, prediction rows, queue record, Phase 7 completion, and atomic weekly-run completion.

For future diagnosis, record a bounded, sanitized Codex stderr tail on nonzero exit. Also strengthen startup validation to execute a harmless CLI check, not only `shutil.which("codex")`, so missing launcher dependencies fail before jobs are accepted.

## Safety confirmation

No configuration, code, database data, queue record, service state, or workflow state was changed. Weekly-flow-02 run 1 was not rerun or continued.
