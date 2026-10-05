---
created_at: 2026-10-05T19:14:29Z
updated_at: 2026-10-05T19:14:29Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Weekly Flow 02 Shutdown Observability PRD V01

## Purpose

Add targeted shutdown logging to `ops/src/weekly-flow-02` so an operator can distinguish a completed workflow from completed cleanup, natural Node exit, and a terminal or command-wrapper problem.

The next controlled run should identify the last completed shutdown boundary without changing weekly-flow behavior or forcing the process to exit.

## Background

Run 2 persisted successful completion and logged `runCompleted=true`, while the invoking terminal appeared occupied. Later investigation found no weekly-flow process or lock holder.

The incident could not be reproduced. Safe probes showed that Sequelize, Winston, the worker-node status connection, timers, and the lock all closed normally.

The current final workflow message is written before database and logger cleanup. It therefore cannot prove that the Node process exited.

## Goals

1. Identify whether shutdown reaches and completes each cleanup stage.
2. Confirm natural Node `beforeExit` and `exit` events in terminal-visible output.
3. Detect a referenced Node resource that remains after owned cleanup completes.
4. Correlate every shutdown event using the process ID and run ID when available.
5. Preserve the existing graceful cleanup order and exit behavior.
6. Add subprocess verification that the compiled entrypoint exits and releases its lock.

## Non-Goals

- Do not add an unconditional `process.exit()`.
- Do not introduce a successful forced-exit timeout.
- Do not change Phase 4 job creation, polling, cancellation, or completion rules.
- Do not change run-selection or persistence semantics.
- Do not add a second lock mechanism.
- Do not log credentials, environment values, query contents, Users-table data, or database result rows.
- Do not launch a real RSS job solely to test shutdown.

## Existing Shutdown Sequence

The supported sequence remains:

1. The coordinator settles.
2. `loadedPersistence.close()` closes Sequelize.
3. `finishLogging()` drains and ends Winston.
4. Node reaches natural process exit.
5. The operating system closes the inherited lock descriptor and releases `flock`.
6. The outer `npm`, `sudo`, and terminal command chain returns control to the operator.

The implementation must observe this sequence without replacing it.

## Logging Requirements

### 1. Event format

Use stable event names and the existing human-readable metadata convention.

Include these fields when known:

- `pid`
- `runId`
- `stage`
- `outcome`
- `durationMilliseconds`
- `exitCode`
- `activeResources`

Do not use a database row as the source of process-lifecycle truth. These events describe the current process only.

### 2. Coordinator and persistence milestones

Write the following through the ordinary coordinator logger while Winston is available:

1. `Weekly pipeline shutdown started`
   - Emit immediately after the coordinator settles, whether it succeeded or failed.
   - Include `pid`, the known `runId`, and the coordinator outcome.
2. `Weekly pipeline persistence close started`
   - Emit immediately before awaiting `loadedPersistence.close()`.
3. `Weekly pipeline persistence close completed`
   - Emit after Sequelize closes.
   - Include elapsed milliseconds.
4. `Weekly pipeline persistence close failed`
   - Emit when close rejects.
   - Include safe error diagnostics and elapsed milliseconds.
   - Preserve the nonzero failure outcome.
5. `Weekly pipeline logger finish started`
   - Emit immediately before beginning Winston drain.

The existing nested `finally` behavior must remain: logger finishing is attempted even when persistence close fails.

### 3. Logger and process-exit milestones

Winston cannot report its own completed shutdown after it has ended. Use a minimal console-safe lifecycle writer for events that occur at or after logger completion.

The writer must:

- write synchronously to standard error;
- use a UTC timestamp and the existing `[INFO]` or `[ERROR]` style;
- include `pid` and a stable event name;
- never include secrets or arbitrary objects;
- tolerate a closed or unavailable standard error without throwing.

Emit:

1. `Weekly pipeline logger finish completed`
   - Emit immediately after `finishLogging()` resolves.
   - Include elapsed milliseconds.
2. `Weekly pipeline logger finish failed`
   - Emit if logger finishing rejects.
   - Preserve a nonzero failure outcome.
3. `Weekly pipeline beforeExit reached`
   - Register once during entrypoint startup.
   - Include Node's proposed exit code.
4. `Weekly pipeline process exit reached`
   - Register once during entrypoint startup.
   - Include the final exit code.
   - Perform synchronous output only; do not start asynchronous work.

If `process exit reached` appears but the terminal remains occupied, investigation should move outside the weekly-flow Node process to `npm`, `sudo`, the invoking shell, or the terminal session.

### 4. Lingering-resource diagnostic

After persistence and logger cleanup complete, schedule one unreferenced diagnostic timer for 10 seconds.

- Call `unref()` so this timer never delays a healthy natural exit.
- If another referenced resource keeps Node alive long enough for the timer to fire, write `Weekly pipeline remains active after cleanup` to standard error.
- Include `process.getActiveResourcesInfo()` as a sorted list of resource type names.
- Do not log socket contents, environment values, file contents, request bodies, or database data.
- Do not close resources automatically based only on their type names.

This diagnostic identifies the resource category while preserving evidence for a contemporaneous server inspection.

## Error and Exit Behavior

1. Successful coordinator work and successful cleanup retain exit code `0`.
2. Coordinator, persistence-close, or logger-finish failure retains a nonzero exit code.
3. Logging failure must not replace an earlier application error.
4. Lifecycle logging must not throw from `beforeExit` or `exit` handlers.
5. Do not use lifecycle handlers to perform database, HTTP, or Winston work.
6. Do not add shutdown deadlines in this increment. First use the new evidence to determine whether a deadline is justified and which stage would need it.

## Implementation Boundaries

Keep the change focused in:

- `ops/src/weekly-flow-02/entrypoint.ts`
- `ops/src/weekly-flow-02/index.ts`, if process event registration belongs at the executable boundary
- `ops/src/logger.ts`, only if a small logger-finish result hook is required
- weekly-flow entrypoint and subprocess tests
- `ops/README.md` for operator interpretation

Prefer small named functions for lifecycle output, timing, and active-resource reporting. Do not introduce a general process-management framework.

## Verification Requirements

### 1. Unit tests

Verify:

- shutdown events occur in the required order;
- persistence close is attempted once;
- logger finish is attempted once after persistence settles;
- persistence-close failure still proceeds to logger finish;
- logger-finish failure produces terminal-safe diagnostics;
- the original failure remains the reported failure;
- lifecycle output excludes arbitrary error objects and sensitive values.

### 2. Subprocess exit test

Spawn the compiled weekly-flow executable with injected or fixture-controlled successful work that makes no live database or worker request.

Assert:

- the process exits naturally within two seconds;
- exit code is `0`;
- ordered shutdown markers appear;
- `beforeExit reached` appears;
- `process exit reached` appears;
- the unreferenced 10-second diagnostic does not delay exit;
- the test can acquire the same temporary lock immediately afterward.

### 3. Deliberate lingering-resource test

In a test subprocess, create a controlled referenced resource after cleanup.

Assert:

- the 10-second diagnostic fires;
- `activeResources` names the resource category;
- no sensitive resource details are printed;
- the test tears down its fixture and exits normally.

Do not create a live database connection or worker-node job for this test.

### 4. Existing regression checks

Run:

1. `npm run typecheck --workspace newsnexus12-ops`
2. `npm test --workspace newsnexus12-ops`
3. `npm run build --workspace newsnexus12-ops`

## Controlled Development-Server Run

After the code is reviewed and deployed, run the supported guarded command once. Do not start a second invocation while the first retains the lock.

Interpret the last observed marker as follows:

- No `persistence close completed`: inspect Sequelize close and database connectivity.
- No `logger finish completed`: inspect Winston transport drain and errors.
- `logger finish completed` followed by the 10-second resource diagnostic: capture the live Node process, active resources, sockets, and lock ownership before interrupting it.
- `process exit reached` but no terminal prompt: inspect the outer `npm`, `sudo`, shell, and terminal process chain. The weekly-flow Node process has finished.
- Terminal prompt returns after `process exit reached`: shutdown completed normally.

If the process remains active, use a second terminal to capture `ps`, `pstree`, `lslocks`, and `lsof` evidence before pressing `Ctrl+C`. Do not start another RSS job to reproduce the condition.

## Acceptance Criteria

1. A normal run reports every shutdown boundary and exits naturally.
2. Shutdown logging identifies whether persistence close or logger finish failed or stalled.
3. A process alive 10 seconds after cleanup reports only safe active-resource type names.
4. A visible Node exit marker allows the operator to separate application shutdown from an occupied outer terminal command.
5. The added diagnostics do not delay exit, change flow state, start jobs, or expose protected data.
6. Automated tests prove shutdown ordering, natural subprocess exit, lock release, and the lingering-resource diagnostic.
