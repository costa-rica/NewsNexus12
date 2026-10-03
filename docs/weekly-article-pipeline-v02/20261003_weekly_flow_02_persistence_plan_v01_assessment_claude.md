---
created_at: 2026-10-03T18:28:22Z
updated_at: 2026-10-03T18:28:22Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Persistence Plan V01 Assessment

## Summary

The direction fits the PRD and the existing code:

- **One table, no lifecycle statuses.** A single `WeeklyArticleFlowRuns02` table with typed recovery columns plus JSONB phase data, and `runCompleted` as the only lifecycle field.
- **No coordination columns.** No queue or lease columns.
- **Plain integer markers for the first RSS IDs.** No cascading foreign keys, so cleanup of articles or requests cannot remove the run record.

Adding the model to `db-models` will not break `ensureSchemaReady()` in the API or worker-node, because `REQUIRED_TABLES` only lists `Articles`, `Users` and `States`.

Three concerns qualify. The first means the single-execution guard, as described, would silently stop protecting the run within seconds of acquiring it.

## Concern 1: A session advisory lock taken through the Sequelize pool is lost almost immediately

Criteria: the plan will not work; it risks the overlap guarantee the PRD requires.

The plan says to hold "one non-blocking PostgreSQL advisory lock" for the coordinator's lifetime, and that "PostgreSQL releases it if the connection or process ends." It also says ops will "initialize [db-models] after ops configuration loads" and use repository functions on top of it.

`pg_try_advisory_lock()` is session-scoped: the lock belongs to one physical connection. If it is acquired with `sequelize.query(...)`, the following happens:

- The query borrows a pooled connection and returns it to the pool afterwards. db-models sets `pool.idle` to `PG_POOL_IDLE`, default 10,000 ms, and `min: 0`.
- After about 10 idle seconds, the pool closes that connection, and PostgreSQL releases the lock.
- From then on, a second manual or scheduled trigger acquires the lock and starts a concurrent run while the first is still in Phases 2–7. Those phases can take minutes to hours.
- Before eviction, a later repository query could reuse the lock-holding connection. Behavior then depends on which connection happens to run which statement.

Even a dedicated connection can drop during a long run, through a network blip, a server restart, `idle_session_timeout` or a firewall idle cutoff. The plan says nothing about detecting that.

Recommendation: the plan should specify that:

- The lock is held on a **dedicated connection outside the Sequelize pool**, for example a single `pg.Client` (`pg` is already a root dependency) opened with TCP keepalive and kept open for the whole process. Alternatively, a connection taken from Sequelize's connection manager and never released.
- The coordinator **listens for that connection's `error` and `end` events**. If the lock connection is lost, the current phase is allowed to finish or fail, but the coordinator does not start another phase. It records `lastError` and exits nonzero.
- The **lock key is a documented constant that cannot collide with other advisory locks** in the same database. worker-python already uses `pg_advisory_xact_lock(2_026_072_302)` in `ai_approver_v02/repository.py`. The two-key form `pg_try_advisory_lock(classid, objid)` with a project namespace avoids accidental collisions.
- **Tests cover the real failure mode.** The lock must still block a second session after the pool's idle period has passed, and losing the lock connection must stop further phases.

## Concern 2: There is no defined way to create the table, and backups break until it exists

Criteria: risk to existing functionality; the plan will not work as written.

The plan adds the model to `db-models` and says to "verify the development schema", but it never says how `WeeklyArticleFlowRuns02` gets created on each database.

- **Every backup reads every exported model.** db-manager's `createDatabaseBackupZipFile()` (`db-manager/src/modules/backup.ts`) and the API's admin backup (`api/src/modules/adminDb.ts`) both call `findAll()` on each exported db-models model.
  - Once the new model ships in `db-models`, any database without the table fails with `relation "WeeklyArticleFlowRuns02" does not exist`.
  - That breaks weekly-flow Phase 2, manual db-manager backups and the API's backup endpoint on development, and on production as soon as the code is deployed there.
- **Nothing in the normal path creates the table.** db-manager's `ensureDatabaseExists()` only falls back to `sequelize.sync()` when a *required* table is missing, which this one is not. A schema is only fully re-synced on ZIP import or `--drop_db`.
- **Creating the table needs a different database role from the one ops runs with.** Creation requires DDL privileges, which belong to the owner/bootstrap role. Ops' runtime writes should use the application role (`PG_APP_ROLE`, `newsnexus_app`), which then needs `SELECT/INSERT/UPDATE` on the table and `USAGE/SELECT` on its `id` sequence. The plan names no role. On the earlier weekly flow, production ended up with the bootstrap owner role as the standing runtime credential because schema setup and runtime shared one env file.

Recommendation: the plan should specify that:

- **A standalone installer creates the table**, following the existing `db-manager` pattern `npm run schema:ai-approver-v02` (`src/standalone/installAiApproverV02Schema.ts`). It should create the table and indexes idempotently, check the columns, and grant to `PG_APP_ROLE`.
- **It runs with the owner role, once per environment.**
- **Ops' own `PG_USER` is the application role.**
- **Rollout order:** install the table on a database *before* deploying a `db-models` build that exports the model to any service on that server. The development-server verification step should include running db-manager `--create_backup` and the API backup after installation.
- **Dropping and recreating the table during early development** goes through this installer, not `sync({ force })` or a full-database path.

## Concern 3: Importing db-models into ops breaks the existing ops test and harness approach

Criteria: the plan will not work as written; it carries risk to existing functionality.

`db-models/src/models/_connection.ts` reads `PG_HOST`, `PG_DATABASE` and `PG_USER` with `readRequired()` **at module load** and throws if any is missing.

The ops tests and the Phase 2/3 harnesses deliberately avoid loading `.env` files and import `coordinator.ts` directly. If `coordinator.ts`, or anything it imports, statically imports `@newsnexus/db-models` or a repository module that does, then:

- every existing ops test that imports the coordinator fails at import time unless PG variables are set; and
- tests that do set them would silently connect to whatever database those variables name.

The plan's verification also asks for model and constraint tests "against the isolated PostgreSQL test database". But the ops `node:test` setup has no test-database configuration, and the existing db-manager Jest setup (`tests/setupEnv.js`) defaults `PG_USER` to `newsnexus_boot`.

Recommendation: the plan should specify that:

- **Only the entry point loads db-models.** `index.ts` imports db-models (or a persistence factory) and passes repository functions and the lock guard to the coordinator through the existing dependencies object. The coordinator and phase modules never import db-models directly.
- **Coordinator persistence tests use in-memory fakes.**
- **Database-backed tests are a separate, opt-in suite.** They have an explicit `PG_DATABASE` for a disposable test database and refuse to run against a database name that does not match the test naming convention. They are not part of the default `npm test`.

## Non-blocking notes

- **Define "past phase 3".** The PRD says that when `lastPhaseCompleted = 3` and Phase 4 has not started, continuation goes to Phase 4. The plan should state the predicate directly, for example `lastPhaseCompleted >= 3`, and say that a row with `lastPhaseStarted = 3` and `lastPhaseCompleted = 2` is "stopped during phases 1–3".
- **Clarify what `lastError` holds.** It is a single JSONB value, so a continued run that later succeeds still shows the earlier error. Say whether continuation clears it or whether errors are also kept per phase in `phaseData`.
- **Name the run-age column.** Run age is measured from `runStartedAt`. The 72-hour comparison should use that column, not `createdAt`, so the name should be stated once.
- **A restore brings back run history.** A database restore through `--zip_file` re-creates the table (via `sync()`) and imports its CSV, along with any incomplete rows from the backup moment. That is acceptable, but the restore runbook should say the restored "last run" may be an incomplete row that the next trigger evaluates.
