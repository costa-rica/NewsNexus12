---
created_at: 2026-10-04T20:54:03Z
updated_at: 2026-10-04T20:58:17Z
created_by: codex (gpt-5.6-sol) nws-nn12dev
modified_by: codex (gpt-5.6-sol) nws-nn12dev
---

# Weekly Flow 02 shutdown investigation report V01

## Executive conclusion

The 2026-10-04 run persisted and logged successful Phase 4 completion at `20:34:15Z`, but that message is emitted before entrypoint teardown begins. It proves workflow completion, not Node.js process termination.

No weekly-flow process or lock holder remained when safe diagnostics were taken at `20:51:51Z`. Because the process had already ended, the exact incident handle can no longer be recovered from `/proc`, `lsof`, or a Node diagnostic report.

The current shutdown path is structurally correct and was reproduced safely without launching another RSS job:

1. `runCoordinator()` settles.
2. `sequelize.close()` is awaited.
3. Winston receives `logger.end()` and its `finish` event is awaited.
4. Node exits naturally.
5. The kernel closes launcher file descriptor 9 and releases the `flock` lock.

A combined read-only probe exercised the same PostgreSQL singleton, the completed RSS job status request, and the real Winston implementation. PostgreSQL closed in 5 ms and Winston finished in 3 ms. Two `Socket` handles remained, consistent with the probe's standard-I/O channels, and Node exited naturally in 0.73 seconds.

A separate status-only probe briefly showed a socket with remote port `8003` immediately after `fetch`, but Node exited in 0.15 seconds. This confirms a transient worker-node connection can still be visible immediately after the response; it does not establish that connection as the incident blocker.

The available evidence does not support blaming Sequelize, Winston, the worker-node HTTP socket, a phase timer, a signal listener, or `flock`. The incident is classified as not reproduced, with insufficient contemporaneous handle evidence.

The final log precedes both cleanup awaits. The missing evidence cannot distinguish a stalled teardown await, a referenced handle after teardown, an operator-observation delay, or another non-reproduced condition.

Do not add an unconditional `process.exit()`. The recommended first remedy is shutdown-stage observability plus a subprocess exit test. If policy later requires bounded shutdown, define and test separate Sequelize and Winston deadlines with nonzero failure reporting. The existing explicit close order should remain.

## Scope and safety boundaries

This investigation:

- inspected `ops/src/weekly-flow-02`, its launcher, logger, persistence adapter, Phase 4 client, tests, logs, shell history, systemd state, process state, sockets, and file locks;
- used only read-only database authentication/query behavior and a GET of completed worker job `0023`;
- did not start or replace an RSS job;
- did not change application code, database rows, schemas, services, or runtime configuration;
- wrote temporary probe logs only under `/tmp` and removed them;
- preserved the unrelated modified root `package-lock.json`.

## Incident timeline

The shell history and application logs align as follows:

| UTC time | Evidence |
|---|---|
| `20:27:13` | `newsnexus12-worker-node.service` started. |
| `20:27:21` | Operator invoked `npm run weekly-flow-02:start --workspace newsnexus12-ops` as `limited_user`. |
| `20:27:38` | Weekly flow selected run `2`. |
| `20:29:14` | Phase 4 started worker job `0023`. |
| `20:29:33` | Worker-node logged job `0023` completed. |
| `20:34:15` | The next five-minute poll verified success and the coordinator logged `runCompleted=true`. |
| `20:51:51` | No weekly-flow Node process and no holder of `weekly-flow-02.lock` existed. |

The final weekly-flow log entry is:

```text
2026-10-04 20:34:15 [INFO] Phase 4 completed with no downstream Articles; weekly run completed ... runCompleted=true
```

There is no shutdown-stage log after this entry, so the log cannot distinguish:

- coordinator completion;
- entry into `loadedPersistence.close()`;
- completion of `sequelize.close()`;
- entry into `finishLogging()`;
- Winston `finish`;
- natural process exit.

## Code-path evidence

### Persisted completion precedes teardown

`ops/src/weekly-flow-02/coordinator.ts` logs the completion message at lines 309–323 after Phase 4 persistence has completed. Control then returns to `executeWeeklyFlow02()`.

`ops/src/weekly-flow-02/entrypoint.ts` lines 51–72 use nested `finally` blocks:

```ts
try {
  // run coordinator
} finally {
  try {
    if (loadedPersistence) await loadedPersistence.close();
  } finally {
    await dependencies.finishLog(logger);
  }
}
```

This guarantees that Winston finishing is attempted even if database close rejects. It does not expose which await is in progress.

### Sequelize ownership and closure

`loadWeeklyFlowPersistence()` dynamically loads the workspace `@newsnexus/db-models` singleton, authenticates it, and returns:

```ts
close: async () => dbModels.sequelize.close()
```

All Phase 4 database calls are awaited before `collectGoogleNewsRss()` returns. No detached transaction, query promise, or second Sequelize instance was found in the flow path.

The safe probe showed:

```text
persistence_loaded [ Socket, Socket, Socket ]
persistence_closed_ms 4 [ Socket, Socket ]
```

The combined probe measured 5 ms. This confirms that the current compiled Sequelize shutdown closes its PostgreSQL socket and does not hold the probe open.

### Winston finishing

`ops/src/logger.ts` registers one-time `error` and `finish` listeners, calls `logger.end()`, and resolves only on `finish`.

The real file-plus-console logger completed in 7 ms in an isolated probe and in 3 ms after the combined database/status probe. Node then exited naturally. There is no evidence that Winston was blocked in the current build.

One diagnostic limitation remains: `finishLogging()` has no timeout and no entry/exit logs because it is itself shutting down the logger. If a transport ever fails to emit `finish`, the promise can wait indefinitely without identifying the transport.

### Phase 4 timers and HTTP handles

Phase 4 polling uses awaited one-shot `setTimeout()` calls. The terminal-status path returns before another delay is scheduled. There is no `setInterval()` in the production weekly-flow path.

Request timeouts use `AbortSignal.timeout()`. On this Node runtime (`v24.21.0`), an isolated 60-second abort signal did not keep Node alive; the process exited in 0.05 seconds.

A read-only call through the actual compiled `getGoogleNewsRssJobStatus()` for completed job `0023` showed a `Socket` whose remote port was worker-node port `8003` immediately after the response. Despite that transient handle, the process exited naturally in 0.15 seconds. The combined probe also exited normally after the status request, database close, and log finish.

Thus the worker-node socket is a transient candidate, not a blocking handle.

### Child processes

Phases 2 and 3 await child `close`, await both output streams, and clear their timeout and force-kill timers. Their successful completion was logged before Phase 4 started. No db-manager child remained during the incident window.

### File lock lifecycle

`ops/scripts/runWeeklyFlow02.sh` opens `ops/.runtime/weekly-flow-02.lock` on file descriptor 9, acquires a nonblocking `flock`, and uses `exec node ...`.

The Node process inherits file descriptor 9 and therefore owns the kernel lock for its full lifetime. An open regular-file descriptor does not keep the Node event loop alive. The lock is an effect of a live process, not an independent event-loop blocker. It is released automatically when the process exits or is killed; the zero-byte lock file correctly remains on disk.

At `20:51:51Z`, `lslocks` and `fuser` showed no holder. Launcher tests use stubbed `flock` and `node` executables; they verify shell syntax, status handling, argument forwarding, and guard failure branches, not real kernel-lock release.

### Signal behavior

No production `SIGINT`, `SIGTERM`, `beforeExit`, or `exit` listener exists in `ops/src/weekly-flow-02` or `ops/src/logger.ts`.

Consequences:

- normal completion executes both awaited cleanup stages;
- default `SIGINT`/`SIGTERM` terminates Node and causes the kernel to close PostgreSQL/TCP/file descriptors and release `flock`;
- a signal is not guaranteed to unwind JavaScript `finally` blocks or flush Winston cleanly;
- there is no application-level cancellation for an in-progress poll delay or fetch.

Signal handling is therefore a shutdown-quality gap, but no stale signal listener is keeping this process alive.

## Safe runtime probes and results

### Combined dependency probe

The probe performed these operations only:

1. authenticated the existing Sequelize singleton;
2. issued a GET for already-completed RSS job `0023`;
3. logged one line to a temporary Winston logger;
4. awaited `sequelize.close()`;
5. awaited `finishLogging()`;
6. removed the temporary log directory.

Result:

```text
before_close [ Socket, Socket, Socket, Socket ]
db_close_ms 5 [ Socket, Socket ]
log_finish_ms 3 [ Socket, Socket ]
wall_seconds=0.73 exit_status=0
```

The remaining two unnamed sockets were consistent with the probe's standard output/error channels. The probe did not capture their file-descriptor numbers, so this attribution is not definitive. PostgreSQL and the remote-port-8003 socket were no longer present.

### Read-only `executeWeeklyFlow02()` harness

`executeWeeklyFlow02()` was invoked against completed run `2` with a configuration override. Selection rejected it as already complete, then the real cleanup path ran. This exercised the entrypoint function, not the supported shell launcher.

```text
expected_rejection WeeklyFlowRunSelectionError Run 2 is already complete
settled_ms 306 handles [ Socket, Socket ]
wall_seconds=0.68 exit_status=0
```

This verifies entrypoint cleanup without creating a run or contacting the RSS start endpoint.

### Existing automated tests

The selected compiled suites passed:

```text
43 tests; 43 passed; 0 failed
```

Command:

```bash
npm run test:build --workspace newsnexus12-ops && \
node --test \
  ops/dist-test/tests/weekly-flow-02/entrypoint.test.js \
  ops/dist-test/tests/weekly-flow-02/launcher.test.js \
  ops/dist-test/tests/weekly-flow-02/04_googleNewsRssClient.test.js \
  ops/dist-test/tests/weekly-flow-02/04_collectGoogleNewsRss.test.js
```

Included coverage:

- entrypoint closes persistence before finishing logging;
- Phase 4 terminal monitoring returns without another poll;
- RSS client timeout and cancellation behavior;
- launcher shell syntax, status handling, argument forwarding, and guard failure branches with stubbed executables.

The suite does not currently spawn the real entrypoint and assert that its OS process exits after a successful zero-work Phase 4.

## Finding by suspected blocker

| Candidate | Finding | Confidence |
|---|---|---|
| PostgreSQL/Sequelize pool socket | Explicitly closed; probes closed it in 4–5 ms. Could only be implicated if the incident was stalled inside `sequelize.close()` before it resolved. | High for current build; incident not captured |
| Winston file/console transport | `finishLogging()` resolved in 3–7 ms and process exited. Could only be implicated if the incident transport did not emit `finish`. | High for current build; incident not captured |
| Worker-node HTTP socket | A remote-port-8003 socket was visible immediately after a final-style GET, but did not keep the probe alive. | High for the probe; incident not captured |
| Poll timer | Terminal response returns before scheduling another delay. | High |
| `AbortSignal.timeout()` timer | Isolated 60-second signal did not keep Node alive. | High |
| db-manager child/pipe | Phases 2/3 had already completed and no child remained. | High |
| Signal listener | No production listener exists. | High |
| `flock` descriptor | Does not keep the event loop alive; no current holder. | High |
| Exact incident handle | Process was gone before handle capture; cannot be proven retrospectively. | Definitive limitation |

## Operational impact

If Node remains alive after persisted completion through the supported lock launcher:

1. the launcher retains the kernel lock;
2. manual and scheduled invocations are rejected as overlap no-ops;
3. a systemd oneshot remains active even though `runCompleted=true` is already durable;
4. operators may incorrectly start troubleshooting the RSS worker even though its job completed successfully;
5. force termination releases the lock but can skip orderly logger draining and obscure the root cause.

It should not duplicate job `0023` while the process remains alive. The immediate risk is blocked future coordination and ambiguous service state, not loss of the already-persisted completion row.

## Recommendation

### Immediate conclusion for this incident

Do not rerun RSS and do not add `process.exit()`. The process and lock are already gone, and the safe probes show the current owned resources close correctly.

### Recommended implementation remedy

Implement observable orderly shutdown in a separate reviewed change:

1. Emit a console-safe shutdown milestone before closing persistence.
2. Record completion or failure of `sequelize.close()`.
3. Enter Winston finishing only after database closure settles.
4. Add one idempotent shutdown coordinator so normal completion and signals cannot run cleanup twice.
5. Handle `SIGINT` and `SIGTERM` by requesting cancellation of polling/delay/fetch work, awaiting the same cleanup path, and setting an appropriate exit code.
6. If operations policy requires a finite shutdown deadline, define separate, configurable deadlines for Sequelize close and Winston drain. On a deadline, emit diagnostics through a still-available fallback channel and return a nonzero result.
7. Do not add transport-forcing or forced-exit behavior until the supported Winston close semantics and data-loss consequences are covered by tests.
8. Do not use an unconditional successful `process.exit()`, because it can truncate logs and hide failed cleanup.

The tested graceful sequence is:

```text
coordinator settled -> await sequelize.close() -> await Winston finish -> natural Node exit
```

The probes demonstrate that sequence exits cleanly with the current dependencies. This validates the sequence, not a root-cause remedy. Instrumentation is required to identify which stage or handle is responsible if the condition recurs.

## Proposed verification tests

### 1. Successful subprocess exit test

Spawn a real Node subprocess with:

- real `initializeLogger()` and `finishLogging()` writing to a temporary directory;
- a fake successful coordinator that follows the zero-work completion path;
- a fake persistence resource whose `close()` records ordering;
- the real launcher or an isolated temporary lock path.

Assert within two seconds:

- exit code `0`;
- order is coordinator completion, persistence close, Winston finish, process exit;
- the lock can be acquired immediately after exit;
- final log line is present.

### 2. Read-only integration teardown test

Against an explicitly approved development database and an already-completed worker job:

- authenticate Sequelize;
- GET only the completed job status;
- close Sequelize;
- finish a temporary Winston logger;
- assert the subprocess exits under two seconds;
- fail the test if non-standard-I/O active handles remain.

This is the probe performed during this investigation and should be made repeatable without production credentials.

### 3. Winston failure tests

Use custom transports that:

- finish normally;
- emit `error`;
- never emit `finish`.

Assert normal drain, propagated error, bounded timeout diagnostics, and no indefinite subprocess.

### 4. Sequelize close failure test

Make `close()` reject and assert that Winston finishing still runs, the error remains nonzero, and the subprocess exits.

### 5. Signal tests

Spawn a synthetic coordinator waiting on an abortable delay, send `SIGTERM` and `SIGINT`, and assert:

- no RSS start request occurs;
- cancellation is requested once;
- cleanup runs once;
- logs drain;
- exit status reflects the signal policy;
- the lock is immediately available afterward.

### 6. Recurrence capture

For the next controlled non-RSS reproduction, start Node with diagnostic reports enabled and a report directory readable only by the operating account. Diagnostic reports can contain environment values, command arguments, and other sensitive process details; do not commit or broadly share them.

Example startup options:

```bash
NODE_OPTIONS="--report-on-signal --report-signal=SIGUSR2 --report-directory=/protected/path"
```

If it remains alive after the final completion line, do not kill it first. Capture:

```bash
kill -USR2 <pid>
lslocks -o COMMAND,PID,TYPE,MODE,PATH
lsof -nP -p <pid>
ss -tpn
```

The `SIGUSR2` report is generated only when report-on-signal was enabled. It supplies contemporaneous process and libuv-handle evidence, but it may not identify JavaScript ownership for every handle. Correlate it with `lsof`, `ss`, lock state, and shutdown milestones.

## Reproduction guidance without starting RSS

Preferred approach:

1. Use the subprocess tests above with faked coordinator work.
2. Use a dedicated temporary lock path.
3. Use a temporary Winston directory.
4. Use no worker start endpoint.
5. If a live database check is necessary, authenticate and close only.
6. If a worker check is necessary, GET only an already-completed job ID.

A real operational `--new-run` or default invocation is not an acceptable shutdown reproduction because it can start another RSS job. An explicit continuation of a verified completed run is read-only through selection and rejects before Phase 4, but it should still be used only after confirming the run is complete and the database target is correct.

## Final assessment

The strongest supported conclusion is not that a specific library leaked a handle, but that the final business log occurs before two silent cleanup awaits. Both cleanup components and the observed Phase-4 worker socket exited cleanly under safe probes. The incident process ended and released its lock before handle capture.

The remedy is therefore to preserve the existing graceful close order, add shutdown observability and signal-aware cancellation, and add an OS-process exit test. If recurrence diagnostics show a referenced handle, close that handle's owner explicitly rather than masking it with `process.exit()`.
