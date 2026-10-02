---
created_at: 2026-10-02T21:23:43Z
updated_at: 2026-10-02T21:35:48Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Plan V02 Assessment

## Summary

V02 is a sound, well-scoped plan. The phase result, validation rules, error categories, no-retry stance and persistence boundary all match the worker-python endpoint as implemented in `worker-python/src/routes/deduper.py`. Three concerns qualify under Plan and Vet. The first is a design risk that should go back to the operator. The other two would cause the planned tests to fail or be unreliable as written.

## Concern 1: A 30-second client timeout guarantees ambiguous outcomes in the main failure case

Criteria: the plan will not work as intended; it carries risk.

V01 required the client timeout to "exceed worker-python's 30-second deduper cancellation limit and leave time for connection handling and deletion." V02 drops that requirement and sets both deadlines to 30 seconds, saying either side may reach its deadline first.

Why this matters:

- `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` limits only the cancellation wait. Deletion, the DB connection and the response all happen after that wait. The worker's total response time is therefore always longer than 30 seconds whenever a running deduper job takes close to the full window to stop.
- In that case the worker would return a clean result: a `504` (nothing deleted) or a `200` (deleted). With a 30-second client timeout, the client aborts first and records an **unverified** outcome instead.
- The plan's own rules say an unverified outcome stops the flow and needs a manual check before anyone sends another destructive request. So the configured timeout turns the most likely real failure (a slow-stopping deduper job) into the most expensive one to recover from.
- The worker-side limit is configurable on the worker host. Ops cannot see it, so the coupling between the two values should be documented.

The operator answered the v01 question "What client timeout should Phase 1 use beyond the worker's 30-second cancellation limit?" with `30`. That may have been meant to name the variable rather than its value. Please confirm the value with the operator before the todo is written.

Recommendation:

- Set the default well above the worker deadline, for example 90 seconds. Document in `ops/.env.example` and `ops/README.md` that it must exceed the worker's `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` plus deletion time.
- If the operator deliberately keeps 30, the plan should say that a timeout will usually be ambiguous, and the README should explain how to check the table and worker logs before rerunning.

### Operator decisions (added 2026-10-02 after review)

1. **Timeout: 90 seconds.** Set `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS=90` in `ops/.env.example` and the README. Document that it must exceed the worker's `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS` plus deletion time.
   - worker-python enforces no overall limit on this request. The only worker deadline is the cancellation wait.
   - Nothing bounds the deletion and response on the worker side: there is no database statement timeout, and uvicorn has no per-request timeout.
   - The ops client timeout is therefore the only overall limit on the call.
2. **A longer request fails and stops the flow.** A request that exceeds 90 seconds is aborted. Phase 1 fails, the process exits with a nonzero status, and no later phase runs. In particular, no backup runs against a table that was not confirmed cleared. V02 already defines this behavior, so it stays.
3. **No outcome check after a timeout; rerunning from the beginning is safe.** The operator does not want added logic to find out the table state after a timeout. V03 should replace V02's sentence "A timeout or lost connection creates an ambiguous result that must be checked before another destructive request is sent" with:
   - A failed or timed-out Phase 1 stops the run. Ops does no automatic retry and no checking of the outcome.
   - The next run, started by the operator or the scheduler, begins from Phase 1 with no manual check. This is safe because the clear is idempotent:
     - If the earlier delete finished late, the rerun returns `200` with `rowsDeleted: 0` and passes.
     - If nothing was deleted, the rerun deletes normally.
     - If the earlier clear is still running on the worker, the rerun gets `409` from the clear guard and fails cleanly without deleting.
   - Only a validated `cleared: true` lets the flow continue past Phase 1.
   - A rerun is not guaranteed to pass. It can time out again if the cause comes back, for example a new deduper job queued in the meantime or a slow worker or database. Each such failure still stops safely.
4. **Make the failure visible.** In production the logger writes only to file. The plan should name where the operator sees a Phase 1 failure, for example the scheduler alerting on a nonzero exit status. It does not need to add notification logic in this increment.

## Concern 2: The configuration tests conflict with how `loadConfig` works today

Criteria: the plan will not work as written; naming/pattern conflict with existing code.

The plan asks for tests of "Required worker URL and timeout" and of rejected timeout values. In `ops/src/config.ts`:

- `loadConfig()` calls `dotenv.config()` on `ops/.env`, and dotenv fills in any missing values. `ops/.env` already exists on the operator's machine and already defines both new variables. A test that deletes `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER` from `process.env` gets it back from the file, so the "missing" case cannot fail as expected. The result depends on the machine.
- `loadConfig()` reads and changes the global `process.env` and also requires `NODE_ENV`, `NAME_APP` and `PATH_TO_LOGS`. Tests that call it leak state into one another.
- The existing `positiveInteger` helper returns `5` when the value is empty. That directly contradicts the plan's rule "Do not silently replace a missing or invalid value with a default." An implementer who reuses the helper for `WORKER_PYTHON_REQUEST_TIMEOUT_SECONDS` would ship a silent 5-second timeout.

Recommendation: the plan should state that:

- Value parsing is split into a pure function that takes an env object (for example `parseOpsConfig(env)`). `loadConfig()` keeps doing the dotenv step and then calls it. Tests call only the pure function.
- The timeout uses a strict required-positive-integer parser, not the existing default-to-5 helper. The existing log-rotation defaults stay unchanged.

A related small gap: `runCoordinator(logger)` and the phase function receive no config today. The plan should say that `index.ts` passes the worker settings (and, for tests, a substitutable request function) through the coordinator to the phase. That way the "failures prevent completion logging" test has a seam to use.

## Concern 3: The `node --test` setup will pick up the wrong files

Criteria: the plan will not work as written.

The plan compiles test files through the existing `tsconfig.json` (which includes `src/**/*`) and runs "the generated JavaScript tests with `node --test`".

- **Bare `node --test` picks up TypeScript sources.** On this machine's Node 24, a bare `node --test` run from `ops/` also matches `src/**/*.test.ts`, because type stripping is on by default. Those files fail on the project's extensionless imports (`ERR_MODULE_NOT_FOUND`). I reproduced this in a scratch directory.
- **Stale files in `dist/` keep running.** `tsc` never cleans `dist/`, and it already holds a stale `dist/weekly-flow-02/phases/clearDuplicateAnalyses.js` from the `01_` rename. Test files that are renamed or deleted would keep running from `dist/`.
- **Node 20 does not support the obvious fix.** The repository declares `node >=20`, but glob arguments to `node --test` need Node 21 or later. The plan should state the minimum Node version for the ops test command (and check what `nws-nn12dev` runs), or pass explicit file paths.
- **Test files ship in the production build.** Compiling tests with the main build puts them in the deployed `dist/`. This is acceptable if intended, but it should be a stated choice.

Recommendation: the plan should name the exact test script. One example is a clean build followed by `node --test "dist/**/*.test.js"` with a stated Node 22 or later requirement. Another is a separate `tsconfig.test.json` with its own output directory. Either way, the script must clean stale output before running.

## Not concerns (checked)

- The response shape, the use of `cleared` and the 200/409/500/504 mapping match the route and `worker-python/docs/worker-python-api-documentation/endpoints/deduper.md`.
- Treating `exitCode`, `stdout` and `stderr` as optional transport details is safe. Failure bodies omit them.
- The `01_` file prefix, avoiding a generic worker client, and deferring `WeeklyArticleFlowRuns02` are consistent with the ops plan and the existing scaffold.

## Todo-phase note

Once these are resolved, this plan still needs a task-style todo (multi-file, tests, config, runtime checks), not direct implementation.
