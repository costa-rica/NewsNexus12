---
created_at: 2026-10-05T19:26:27Z
updated_at: 2026-10-05T19:26:27Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Shutdown Observability PRD V02

## Purpose

Add a small, temporary set of shutdown markers to `ops/src/weekly-flow-02` that confirm, durably, whether the weekly-flow Node process reaches each cleanup step and exits.

The markers are kept to one commit so they can be removed with `git revert` after one or more clean runs.

This version replaces [Shutdown Observability PRD V01](20261005_weekly_flow_02_shutdown_observability_prd_v01.md). V01's diagnostic scope is larger than the evidence now supports.

## Background

The 2026-10-04 development-server run (run 2) completed Phases 1–4 and logged `runCompleted=true` at `20:34:15Z`. The terminal that started it stayed occupied afterwards. The [shutdown investigation report](20261004_weekly_flow_02_shutdown_investigation_report_v01.md) found:

- **No process or lock holder remained.** By `20:51:51Z`, no weekly-flow process and no holder of `weekly-flow-02.lock` existed.
- **Every component shut down normally in probes.** Sequelize, Winston, the worker-node status connection, timers and the lock all closed normally.
- **The incident could not be reproduced**, and no contemporaneous handle evidence exists.

### Operator-supplied information

After the report was written, the operator added two facts:

1. **Ctrl+C had no effect** on the occupied terminal.
2. **The terminal only came back when the window was closed.**

### Interpretation

Ctrl+C sends `SIGINT` to the terminal's foreground process group, and `npm` and `sudo` pass it on to their child. The weekly-flow coordinator registers no `SIGINT` handler, so a running Node process would have ended immediately on Ctrl+C. A live coordinator process therefore cannot explain an ignored Ctrl+C.

The most likely explanation is that **the SSH session froze or dropped**, so keystrokes no longer reached the server. This fits all the evidence:

- The coordinator logged completion.
- The process and lock were gone by `20:51`, which is consistent with a natural exit.
- The terminal stayed unresponsive and ignored Ctrl+C until the window was closed.

Phase 4 prints nothing for 5 minutes between status polls. That gives an idle-connection drop (by NAT, a firewall, or a client network change) the opportunity to happen during a run.

This is a working explanation, not a confirmed cause. The checks below can confirm or rule it out cheaply.

## Goals

1. Record, in a place that survives a dropped terminal, whether shutdown reaches database close, logger close and process exit.
2. Distinguish a stall inside the weekly-flow process from a problem in the connection, terminal, `npm` or `sudo`.
3. Keep the change small, clearly marked as temporary, and removable with a single revert.

## Non-Goals

- Do not add `process.exit()`, shutdown deadlines or forced termination.
- Do not change cleanup order, exit codes, phase behavior, persistence or the lock.
- Do not add a lifecycle-logging framework, an active-resource timer, or new subprocess tests.
- Do not log credentials, environment values or database data.
- Do not start an RSS job solely to test shutdown.

## Connection Checks (No Code)

Before or alongside the code change:

1. **Check the earlier session's disconnect.** On `nws-nn12dev`, look for that session's disconnect around the incident:

   ```bash
   journalctl -u ssh --since "2026-10-04 20:20" --until "2026-10-04 21:00"
   ```

   ```bash
   last -F | head -20
   ```

   Look for "Connection reset", "Timeout", or "client not responding", and compare the time with `20:34:15Z`.
2. **Keep the client connection alive.** For manual runs, add `ServerAliveInterval 60` for that host in the operator's `~/.ssh/config`.
3. **Run the next manual invocation inside `tmux` or `screen`**, so a dropped connection does not end or obscure the run.
4. **Record the exact invocation**, for example `sudo -u limited_user npm run weekly-flow-02:start --workspace newsnexus12-ops`.

## Temporary Shutdown Markers

### 1. Cleanup-step messages (Winston)

In `executeWeeklyFlow02()` (`ops/src/weekly-flow-02/entrypoint.ts`), inside the existing nested `finally` blocks:

- Log `Shutdown: closing database` immediately before `loadedPersistence.close()`, only when persistence was loaded.
- Log `Shutdown: closing logger` immediately before `dependencies.finishLog(logger)`.

Use the ordinary coordinator logger. Do not change the `finally` structure or the order of the awaits.

### 2. Process-exit marker (synchronous, durable)

Register one `process.on('exit')` handler once, after configuration loads, in `executeWeeklyFlow02()`. The handler is:

```ts
// TEMP shutdown diagnostic — remove after clean runs are confirmed.
process.on('exit', (code) => {
  const line = `${new Date().toISOString()} [INFO] Process exiting pid=${process.pid} exitCode=${code}\n`;
  if (config.nodeEnv !== 'development') {
    try { fs.appendFileSync(path.join(config.pathToLogs, `${config.nameApp}.log`), line); } catch {}
  }
  try { process.stderr.write(line); } catch {}
});
```

The handler must:

- **Append synchronously to the coordinator log file.** This is the line that survives a dropped terminal. It is written only when file logging is active, that is, when `nodeEnv` is not `development`, matching `ops/src/logger.ts`.
- **Also write to stderr**, for an attached terminal.
- **Do only synchronous work, and swallow its own errors.**
- **Carry the `TEMP` comment** so it is easy to find and remove.

### 3. Removal

- Put all of the above in **one commit** whose message identifies it as a temporary shutdown diagnostic.
- After at least one clean run, where the log shows `Process exiting … exitCode=0` and the terminal returns, remove it with `git revert <commit>`.

## Verification

1. Run the existing checks:
   - `npm run typecheck --workspace newsnexus12-ops`
   - `npm test --workspace newsnexus12-ops`
   - `npm run build --workspace newsnexus12-ops`
2. No new automated tests are required for this temporary change. Existing entrypoint tests must still pass.
3. On the next supported development-server run, inside `tmux`, confirm the log file ends with:

   ```text
   … [INFO] Shutdown: closing database
   … [INFO] Shutdown: closing logger
   … [INFO] Process exiting pid=<pid> exitCode=0
   ```

## Interpreting the Next Run

| Last line in the coordinator log | Meaning | Next step |
| --- | --- | --- |
| `Process exiting … exitCode=0`, and the terminal returned | Normal shutdown. | Keep the markers for one more run if desired, then revert. |
| `Process exiting …`, but the terminal stayed occupied | Node exited; the problem is in the connection, `sudo`, `npm`, or the terminal. | Check `journalctl -u ssh` and `pstree -p` for the invoking chain. No ops code change. |
| `Shutdown: closing database` with nothing after it | The database close stalled. | Escalate to V01's fuller diagnostics for that stage. Capture `lsof` and `ss` before interrupting. |
| `Shutdown: closing logger` with nothing after it | The Winston drain stalled. | Escalate to V01's fuller diagnostics for that stage. |
| The completion message with no shutdown lines | Cleanup was never reached, or the log was truncated. | Investigate the coordinator return path. |

V01 remains available as the next step if a stage is shown to stall. Do not implement it unless this lighter evidence points to an in-process problem.
