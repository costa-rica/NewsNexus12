---
created_at: 2026-10-02T22:29:51Z
updated_at: 2026-10-02T22:29:51Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Phase 2 Plan V02 Assessment

## Summary

V02 resolves the V01 concern and every V01 note:

- **Output handling:** both child streams are drained continuously; stdout is parsed line by line as it arrives, including lines split across chunks; success candidates are stored separately; and the cap applies only to a rolling diagnostic tail.
- **Backup path:** `PATH_DB_BACKUPS` is resolved to an absolute path inside db-manager.
- **Environment:** the stripped keys are listed explicitly, including every `PG_*` key, and tested with sentinel values.
- **Status-query failure:** if the status query fails after a valid backup, the ZIP is kept and Phase 2 fails.
- **Wording:** completion logs say `reportedManifestVersion`.
- **Memory and tests:** peak memory is recorded on the development server, and the Phase 2 test path is added only after its file exists.

One new gap qualifies.

## Concern 1: The local runtime fixture has no way to replace db-manager

Criteria: the plan will not work as written; the implementer would have to guess.

The child-process section fixes the command as `process.execPath` plus `<repository>/db-manager/dist/index.js`, "resolve[d] … from the known monorepo layout." The local runtime fixture section then asks the implementer to "Run development and compiled entry points against successful, failed, malformed-output, oversized-output, checksum-mismatch, and delayed fixtures" using "a temporary command fixture outside the tracked tree."

The plan has no way to point the real entry points at that fixture:

- The unit tests can use the plan's injected dependencies, but `npm run weekly-flow-02:dev` and `:start` always build the real db-manager path.
- Phase 1 had a natural seam: the fixture ran at `URL_BASE_NEWS_NEXUS_PYTHON_QUEUER`. Phase 2 has no equivalent setting.

An implementer will likely improvise one of these:

1. An undocumented environment override for the db-manager entry path. If it is left in production code, a setting can make the coordinator run any Node script. It would also be missing from the strip list and the config tests.
2. Temporarily overwriting `db-manager/dist/index.js` with the fixture. That risks leaving a fake backup command in place on a machine that later runs the flow for real.
3. Pointing the entry points at the real db-manager with the local `db-manager/.env`. That performs a real database backup instead of a controlled check.

Recommendation: the plan should choose the seam explicitly. Two reasonable options:

- **A separate fixture harness.** A test-only script imports `runCoordinator` (or the Phase 2 function) and passes a command dependency that runs the fixture. Production code keeps the fixed db-manager path. The "entry point" runtime checks are then reworded to use this harness. The real `weekly-flow-02:dev` and `:start` entry points are run only against the real db-manager, at the development-server checkpoint.
- **A documented configuration setting.** For example, an optional `DB_MANAGER_ENTRY_PATH` that defaults to the monorepo path. It is validated in `parseOpsConfig()`, covered by config tests and documented in `.env.example`. Its production risk is stated, and it is listed in the child strip list or confirmed harmless there.

The first option keeps production code simpler and matches the plan's preference for avoiding extra configuration surface.

## Non-blocking note

- **`/usr/bin/time -v` cannot give separate numbers.** It reports one maximum resident set size covering the coordinator and its waited-for child together, not each process separately. It also needs the `time` package on Ubuntu. If the operator wants the two figures split, sample the child PID with `ps -o rss=` during the run, or run db-manager's `--create_backup` once directly under `/usr/bin/time -v`. Otherwise the plan should say the recorded figure is the combined peak.

## Todo-phase note

After Concern 1 is resolved, this plan needs a task-style todo.
