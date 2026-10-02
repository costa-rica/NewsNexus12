---
created_at: 2026-10-02T22:24:58Z
updated_at: 2026-10-02T22:24:58Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Phase 2 Plan V01 Assessment

## Summary

The plan is well grounded in the current code. I checked the following against the repository:

- **Entry point:** `db-manager/src/index.ts` runs backup, then status, then close, and returns 0 or 1. The backup path is logged but never written to stdout. On a handled error the entry point writes only the message with `console.error`.
- **Import compatibility:** the importer collects only `.csv` entries (`zipImport.ts:392`), so adding `manifest.json` is backward compatible.
- **Prior manifest:** the version 1 manifest and failure cleanup to restore exist in commit `a3698c2`.
- **Return-type change:** changing `createDatabaseBackupZipFile`'s return type affects only `db-manager/src/index.ts` and the mocked `indexRouting` test. The API has its own unrelated function of the same name in `api/src/modules/adminDb.ts`.
- **Environment isolation is mandatory, not optional.** ops' `loadConfig()` puts `NODE_ENV`, `NAME_APP`, `PATH_TO_LOGS`, `LOG_MAX_SIZE` and `LOG_MAX_FILES` into `process.env`. db-manager reads the same keys, and its plain `dotenv.config()` does not override inherited values. Without stripping, db-manager would log into the ops log under the ops app name. A production incident on the earlier weekly flow came from the same pattern: an inherited `PG_USER` overrode db-manager's `.env`. The plan's isolation step addresses this correctly.

One concern qualifies. It is about how child output is captured, and if it is implemented the obvious way, Phase 2 can fail or hang even when the backup succeeded.

## Concern 1: Bounded output capture can drop the success line or stall the child

Criteria: the plan will not work under a plausible implementation.

The plan says: "Capture stdout and stderr with a fixed maximum retained size." It also says ops "scans complete lines and accepts exactly one valid `database_backup_created` result." Read together, the natural implementation is to buffer stdout up to a cap and then parse the buffer once the process exits. That has two failure modes:

1. **The success line gets truncated away.**
   - When db-manager's `NODE_ENV` is not `production`, its Winston console transport writes to stdout. That includes per-backup logs and the status summary, which run after the backup.
   - The JSON success line sits in the middle of that output. A head-only cap can cut it off if earlier output is large. A tail-only cap can cut it off once later output is large.
   - The result is a valid backup reported as "missing success output." This applies to the local fixture runs and to any development or testing db-manager configuration.
2. **The child stalls on a full pipe.** If the implementation stops reading stdout or stderr once the cap is reached (or pauses the stream), the OS pipe buffer fills and db-manager blocks on write. The run then sits until the 1800-second timeout and is reported as an unverified timeout instead of a success.

Recommendation: the plan should say explicitly that ops:

- reads both streams continuously until the child exits, and never pauses or detaches them once the cap is reached;
- parses stdout line by line as it arrives (handling a line split across chunks), and records success-line candidates and their count separately from the retained output; and
- applies the retention cap only to the diagnostic excerpt used in errors, for example the last N KB of stderr.

The ops tests should include a success line surrounded by output larger than the retention cap, and a child that writes past the cap and still exits normally.

## Non-blocking notes

- **Relative `PATH_DB_BACKUPS`.** db-manager builds `zipFilePath` with `path.join(backupRoot, …)`, so a relative `PATH_DB_BACKUPS` produces a relative path. Ops then rejects it under success condition 3 ("The reported path is absolute"). The todo should have db-manager `path.resolve()` the path before reporting it, or document that `PATH_DB_BACKUPS` must be absolute.
- **The strip list should be explicit.** "Ordinary operating-system values" leaves the implementer to choose. The todo should name the removed keys: at minimum every key in ops' `.env.example` and every key db-manager reads (`NODE_ENV`, `NEXT_PUBLIC_MODE`, `NAME_APP`, `PATH_TO_LOGS`, `LOG_MAX_SIZE`, `LOG_MAX_FILES`, `PATH_DB_BACKUPS`, all `PG_*`). It should also test that a sentinel value for each is absent from the child environment.
- **Exit after a valid backup.** db-manager runs `getDatabaseStatus()` after the backup. If that query fails, the success line has already been printed but the exit status is 1. The plan correctly treats this as a Phase 2 failure. The todo should say the already-written ZIP is left in place, consistent with the "do not delete artifacts" rule.
- **Memory profile.** The backup loads each table fully with `findAll({ raw: true })`. Running it weekly from the coordinator does not change that cost, but the development-server run should record the child's peak memory alongside the disk-space check. That gives evidence before unattended production use.
- **Manifest version is self-reported.** Ops checks the `manifestVersion` that db-manager reports; it does not read it from inside the ZIP. That matches the plan's stated scope ("external metadata"). It is worth keeping that wording so completion logs don't imply the archive contents were checked.
- **Test script.** The ops `test` script lists explicit compiled files. The todo must add `dist-test/tests/weekly-flow-02/02_createDatabaseBackup.test.js` once the file exists, following the Phase 1 rule.

## Todo-phase note

After Concern 1 is resolved, this plan needs a task-style todo. It spans two packages, adds a cross-process contract, and ends with a real backup on the development server.
