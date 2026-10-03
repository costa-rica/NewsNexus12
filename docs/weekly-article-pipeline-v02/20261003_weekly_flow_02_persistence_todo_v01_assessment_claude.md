---
created_at: 2026-10-03T20:45:10Z
updated_at: 2026-10-03T20:45:10Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Persistence Todo V01 Assessment

## Summary

The todo follows PRD V09 and Persistence Plan V03 closely. In particular:

- **Fixed decisions:** the model and table names, the lock path, exit code `75` reserved for an occupied lock with `SuccessExitStatus=75`, guard errors on a different nonzero status, and the 72-hour window measured from `runStartedAt`.
- **Database-free coordinator:** an asynchronous persistence factory loaded after configuration, with no `sync()` from ops.
- **Run selection:** a pure selection function that covers every row of the decision table.
- **Restore compatibility:** adding the model to `MODEL_LOAD_ORDER` is correct and necessary. `zipImport.ts` loads CSVs in that order and skips files that are not listed, so a legacy `WeeklyArticleFlowRuns.csv` is ignored.
- **Rebuild order:** the server checkpoint takes the replenish backup with the old build.

Two concerns qualify. One leaves the key guard property untested. The other omits a configuration step the plan requires and that has gone wrong on this project before.

## Concern 1: The lock tests never prove the launcher holds the lock while Node runs

Criteria: the task leaves too much ambiguity; there is risk to the overlap guarantee.

The safety of the guard rests on one property: after `exec`, the Node coordinator, and most likely its db-manager children, keep the locked file descriptor for the whole run. The "Real lock behavior" checklist does not test that:

- **The holding process is undefined.** "Start one guarded test process that holds the configured lock without running destructive phases" does not say what that process is. The launcher always `exec`s the compiled coordinator, and the coordinator always runs Phases 1–3. The only ways to get a "non-destructive guarded process" are:
  - add a test mode or command override to the launcher, which creates a bypass path the plan has avoided so far; or
  - hold the lock with a separate `flock … sleep` command, which tests `flock(1)` itself, not the launcher.
- **Exec retention is never tested.** The persisted-run section runs the coordinator, but it never attempts a second trigger while that run is active. A launcher bug would go unnoticed and the run would still "pass". Examples: opening the descriptor in a subshell, closing it before `exec`, or `npm` adding a process layer that drops it.
- **Lock inheritance by db-manager children is not covered.** This was my Plan V03 note. If the coordinator is force-killed during Phase 2 or 3, an inherited lock is what keeps a new trigger out while db-manager is still running.

Recommendation: make the tests concrete. Each one checks the launcher's real behavior without adding an override path:

1. **Conflict branch.** Hold the lock externally with `flock -n ops/.runtime/weekly-flow-02.lock sleep 120`, then run `npm run weekly-flow-02:start`. Expect immediate exit `75`, the rejection message, no row created and no phase started. Release the lock and confirm a later launch can acquire it.
2. **Exec retention.** During the one real persisted run, while Phase 2 (the backup) is in progress, run `npm run weekly-flow-02:start` from a second terminal. Expect exit `75`.
3. **Crash release and child inheritance.** In a second controlled run:
   1. Force-kill only the coordinator PID during Phase 2.
   2. Confirm a new launch still returns `75` while the db-manager backup child is alive.
   3. Confirm a launch succeeds after that child exits.
   4. Record whether the child held the lock.

   This run is safe on development: Phase 1 is idempotent, Phase 2 only writes a backup, and the interrupted row is replaced by a new run under the Phase 1–3 rule.

Drop "Start one guarded test process … without running destructive phases" and "Force-terminate a guarded non-destructive test process", or reword them to match these steps.

## Concern 2: There is no task for ops' own database configuration and role

Criteria: the tasks do not align with the plan; there is risk of a privileged runtime credential.

Persistence Plan V02 and V03 require ops to run with the application role after the rebuild. db-models reads `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` and `PG_SCHEMA` from `process.env` when it loads. For ops, those values come from `ops/.env`. Ops currently has no PG settings at all.

The todo never says to:

- add the PG variables to `ops/.env.example` with safe placeholders, and document them in `ops/README.md`;
- configure the development server's `ops/.env` with `PG_USER` set to the application role (`newsnexus_app`), not the bootstrap owner role;
- confirm at the checkpoint, without printing credentials, that ops connects as the application role and can write `WeeklyArticleFlowRuns02`, and that db-manager children still get none of ops' PG values. The existing `PG_*` strip and its sentinel test cover the last point; the todo should name them.

Without these steps the first server run fails at startup with a missing-variable error. Worse, an operator might copy `db-manager/.env`, which runs as the owner role for rebuilds, into `ops/.env`. The previous weekly flow ended up in exactly that state on production, with the database owner role as its standing runtime credential.

Recommendation: add these tasks to implementation phase 2 (the configuration surface) and to the server checkpoint (the role check). Consider having ops log the connected role name, for example from `SELECT current_user`, at startup in non-production environments. That makes the role visible without exposing secrets.

## Non-blocking notes

- **The launcher must forward its arguments.** `npm run weekly-flow-02:start -- --continue-run 5` passes the arguments to the shell launcher, which must `exec node … "$@"`. Add a launcher stub test that confirms options reach Node unchanged.
- **The repeat trigger is a no-op continuation.** After the persisted run, the repeat trigger "continues the same run at Phase 4" and exits at the unimplemented boundary. That is correct. The record should state the exit status expected for that no-op continuation (presumably 0), so it is not mistaken for a failure.
- **Every trigger after 72 hours repeats the destructive phases.** Until Phase 4 exists, every row stays incomplete at the Phase 4 boundary. Any trigger more than 72 hours later starts a new run and repeats Phases 1–3. That is expected on development, but the README should say so in case someone runs the guarded command repeatedly during that period.
