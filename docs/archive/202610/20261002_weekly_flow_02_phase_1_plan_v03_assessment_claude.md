---
created_at: 2026-10-02T21:40:56Z
updated_at: 2026-10-02T21:40:56Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Phase 1 Plan V03 Assessment

## Summary

V03 resolves all three V02 concerns and records the operator decisions correctly:

- **Timeout:** the 90-second overall timeout, and how it relates to `DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS`, are documented.
- **Failure and rerun:** a failure stops the run with no retry and no outcome check, and the next run starts again at Phase 1.
- **Configuration:** a pure `parseOpsConfig(env)` with a new strict timeout parser.
- **Tests:** a separate test build, explicit test paths that work on Node 20, and clean builds.

One small concern qualifies, because the plan states something that is not true of the repository and the implementing agent commits after every todo phase. Once it is fixed, the plan is ready for a todo.

## Concern 1: `dist-test/` is not gitignored

Criteria: the plan will not work as written; risk to the repository.

The "Test build and commands" section says: "The generated `dist-test/` directory is ignored and is not deployed as production runtime output."

- The root `.gitignore` ignores `dist/`, and `ops/.gitignore` ignores only `logs/`. Neither pattern matches `dist-test/`. `git check-ignore ops/dist-test/x.js` confirms the directory is not ignored.
- The plan states this as a fact rather than a task, so the todo is unlikely to include it.
- Under Plan and Vet, the implementing agent commits after each phase. The compiled test output, including a compiled copy of `src/` under `dist-test/src/`, would then be committed.

Recommendation: make adding `dist-test/` to `ops/.gitignore` an explicit task. Add `git status` showing no `dist-test/` files to the verification steps.

## Non-blocking note: `opsDirectory` resolves differently in the test build

`ops/src/config.ts` computes `opsDirectory = path.resolve(__dirname, '..')`, and its comment assumes compiled code sits directly inside `ops/`.

In the test build, with `rootDir: "."`, the compiled config is at `dist-test/src/config.js`. There, `opsDirectory` resolves to `ops/dist-test`, not `ops`. If `parseOpsConfig()` resolves `PATH_TO_LOGS` against `opsDirectory`, a test that asserts the resolved log path will see an unexpected base.

Production is unaffected, and tests that check only URL and timeout parsing are unaffected. The todo should tell the implementer either to avoid asserting absolute log paths or to pass the base directory into `parseOpsConfig()`.

## Not concerns (checked)

- **Node 20:** explicit file arguments to `node --test`, global `fetch` and `AbortSignal.timeout` are all available.
- **No hidden earlier timeout:** Node's built-in `fetch` (undici) waits up to 300 seconds by default for response headers and body. The 90-second abort is therefore the timeout that actually takes effect.
- **Build scripts:** adding `clean` to `build` does not affect the root build scripts, which do not include ops.
- **Rerun safety:** the 409 guard during an in-flight clear matches `worker-python/src/routes/deduper.py`.

## Todo-phase note

After the `.gitignore` fix, this plan needs a task-style todo, not direct implementation. The fix can be folded into the todo without a V04 if the operator prefers.
