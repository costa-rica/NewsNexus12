---
created_at: 2026-10-03T18:55:30Z
updated_at: 2026-10-03T18:55:30Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Persistence Plan V02 Assessment

## Summary

V02 resolves two of the three V01 concerns:

- **Schema creation.** The table is created through the existing drop, create and replenish workflow. `rebuildSchema()` in `db-manager/src/modules/zipImport.ts` already re-grants `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` and sequence access to `PG_APP_ROLE`, and sets default privileges, so the new table gets application-role access with no extra installer. Ops runs as the application role, and the backup paths are checked after the rebuild.
- **Test boundary.** db-models is loaded dynamically at the entry point and persistence is injected, so the default ops tests no longer need PostgreSQL variables.

It also settles the V01 notes: the "past phase 3" predicate, `lastError` semantics and the run-age column.

Moving the guard from a PostgreSQL advisory lock to a host file lock is a reasonable choice. It removes the database dependency and the pooled-connection problem. But one concern qualifies: the plan describes an in-process `flock` that Node cannot do on its own.

## Concern 1: Node.js has no `flock` API; the guard's mechanism is unspecified

Criteria: misunderstanding of the technology; the plan will not work as written.

The plan says: "Acquire `flock` atomically and without waiting… Keep the lock file descriptor open for the coordinator's full lifetime." That describes the coordinator process taking a kernel lock on a file descriptor it holds.

Node's `fs` module has no `flock` (or `fcntl` locking). The repository has no locking dependency installed; `node_modules` holds `fs-extra`, which does not lock. The common alternatives do not meet the plan's own rules:

- **`proper-lockfile` and similar packages** use `mkdir` or lock files with mtime-based stale detection. That is exactly what decision 7 rules out ("Do not infer activity from … lock-file existence"). A crashed process leaves a lock behind until the stale timeout passes.
- **Native addons such as `fs-ext`** provide real `flock`, but they add a compiled dependency to the dependency-light ops workspace, which needs build tools on each server. The plan does not mention this.
- **The `flock(1)` command (util-linux) works on Ubuntu, with conditions:**
  - It holds the lock in a wrapper process, not the coordinator.
  - It only protects invocations that go through the wrapper. Running `node dist/weekly-flow-02/index.js` directly bypasses it.
  - It is not installed on macOS (`which flock` finds nothing on this machine), so local tests and runs would need a different path.

The implementer has to make this decision, and each option changes the code, the dependencies, the systemd unit and the tests.

Recommendation: the plan should choose one mechanism explicitly. Options that keep "the kernel releases it on exit" and satisfy decision 7:

1. **`flock(1)` wrapper, Linux only.** The systemd `ExecStart` and the ops `weekly-flow-02:start` and `weekly-flow-02:dev` scripts run `flock -n <lockPath> node …`. A rejected trigger exits with flock's status, and the coordinator logs nothing. The plan should then say:
   - how the rejection is logged (the systemd journal, or a wrapper message);
   - that direct `node` invocation is unsupported; and
   - how macOS development runs and tests behave (unguarded, or skipped).
2. **An in-process Linux abstract-namespace Unix socket.** `net.createServer().listen('\0newsnexus12-weekly-flow-02')` binds atomically, and the kernel releases it when the process dies. It leaves no file and needs no dependency. On a second bind it fails with `EADDRINUSE`, which maps cleanly to "reject immediately". It is Linux-only. On macOS, a path-based socket leaves a stale file, so the plan should say macOS uses a no-op guard or a clearly documented substitute.
3. **A native `flock` addon.** This is the only way to get exactly what V02 describes, at the cost of a compiled dependency. The plan should state that cost and the build prerequisite on the servers.

Whichever option is chosen, the verification steps ("a held lock rejects a second invocation", "ending or killing the process permits a later invocation") should name the mechanism under test. They should also say whether those tests run locally, on macOS, or only on the Ubuntu server.

## Non-blocking notes

- **Take the replenish backup with the old build.** db-manager's backup reads every exported model. If the server has already been rebuilt with the new `db-models` before the table exists, `--create_backup` fails with "relation does not exist". The checkpoint should spell out the order:
  1. Stop the API and worker services that hold database connections.
  2. Take the backup with the current build.
  3. Pull and build the new `db-models` and db-manager.
  4. Run `--zip_file` with the owner role.
  5. Check the table and grants.
  6. Restart the services.
- **An orphaned db-manager child can outlive the guard.** If the coordinator is killed with `SIGKILL`, or by the OOM killer, while a db-manager child is running, the guard is released (under any of the mechanisms above) but the child may keep running, for example mid-deletion. A new trigger could then overlap with it. Under systemd, the default `KillMode=control-group` kills the whole group, so this mostly affects manual runs. The plan or README should note it, or state that manual runs should use `systemd-run` or the service.
- **Production needs a non-destructive schema path.** "No standalone table installer is required for this development increment" is fine for development. The plan should state that rolling ops persistence out to production requires the idempotent installer or migration first, because production should not be dropped and replenished.
