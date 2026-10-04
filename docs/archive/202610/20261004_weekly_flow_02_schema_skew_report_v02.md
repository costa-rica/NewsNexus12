---
created_at: 2026-10-04T15:14:47Z
updated_at: 2026-10-04T15:18:52Z
created_by: codex (gpt-5.6-sol) nws-nn12dev
modified_by: codex (gpt-5.6-sol) nws-nn12dev
---

# Weekly Flow 02 schema-skew report v02

## Executive summary

The operator response resolves the database-target ambiguity.

The development server intentionally uses PostgreSQL database `newsnexus_prod`. The drop, create, and privilege commands explicitly targeted it. The replenish command obtained its target from db-manager configuration. Current configuration and runtime resolution point to `localhost:5432/newsnexus_prod`, although the historical import log does not print the database name.

The newly collected evidence also explains why `WeeklyArticleFlowRuns02` was not created:

1. The two replenishes ran while the local branch was still at commit `8476671`.
2. That commit did not contain `WeeklyArticleFlowRun02` in source, model initialization, or model load order.
3. The local branch did not advance to `4ba7f50` until 2026-10-04 14:12 UTC, hours after both replenishes.
4. The backup ZIP also predates the new model. It contains the retired `WeeklyArticleFlowRun.csv`, not `WeeklyArticleFlowRun02.csv`.

The rebuild therefore completed successfully, but it rebuilt the schema from an older local checkout that did not know about the new table.

This is not a Sequelize failure and is not caused by an empty table. It is a deployment-order and checkout-verification failure.

## Current state

A read-only database check on 2026-10-04 confirmed:

- Database: `newsnexus_prod`
- Schema: `public`
- Expected relation: `WeeklyArticleFlowRuns02`
- PostgreSQL `to_regclass(...)` result: `null`

The current physical `@newsnexus/db-models` build does register the model:

- Module entry point: `/home/limited_user/applications/NewsNexus12/db-models/dist/index.js`
- Model name: `WeeklyArticleFlowRun02`
- Table name: `WeeklyArticleFlowRuns02`
- Schema: `public`
- Present in `sequelize.models`: yes

The present code and the existing database remain out of sync.

## 1. Exact build, rebuild, and replenish commands

Shell history records two rebuild cycles.

The blocks below reproduce the relevant build, database, and replenish commands. Service-control and unrelated diagnostic commands are omitted.

### First cycle

The commands started on 2026-10-03 around 21:16 UTC:

```bash
npm run build --workspace @newsnexus/db-models
npm run build --workspace @newsnexus/db-manager
npm run build --workspace newsnexus12-ops

sudo -u postgres dropdb newsnexus_prod
sudo -u postgres createdb newsnexus_prod

sudo -u postgres psql -d newsnexus_prod -c "GRANT CREATE ON DATABASE newsnexus_prod TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_app;"
sudo -u postgres psql -d newsnexus_prod -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"

cd db-manager
node dist/index.js --zip_file /home/nick/db_backup_202609302314388.zip
```

### Second cycle

The same procedure was repeated on 2026-10-04 around 01:29 UTC after another root `npm install` and build:

```bash
npm install

npm run build --workspace @newsnexus/db-models
npm run build --workspace @newsnexus/db-manager
npm run build --workspace newsnexus12-ops

sudo -u postgres dropdb newsnexus_prod
sudo -u postgres createdb newsnexus_prod

sudo -u postgres psql -d newsnexus_prod -c "GRANT CREATE ON DATABASE newsnexus_prod TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_app;"
sudo -u postgres psql -d newsnexus_prod -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"

cd db-manager
node dist/index.js --zip_file /home/nick/db_backup_202609302314388.zip
```

### Log evidence

`/home/limited_user/logs/NewsNexus12DbManager.log` records both replenishes.

First replenish:

- 2026-10-03 21:16:53: import started from the named ZIP.
- 2026-10-03 21:17:02: application-role grants were reapplied.
- 2026-10-03 21:22:25: 1,622,983 records were imported across 26 tables.
- 2026-10-03 21:22:27: the post-import database status completed.

Second replenish:

- 2026-10-04 01:30:31: import started from the same ZIP.
- 2026-10-04 01:30:39: application-role grants were reapplied.
- 2026-10-04 01:36:02: 1,622,983 records were imported across 26 tables.
- 2026-10-04 01:36:03: the post-import database status completed.

The logger does not print the database name on each import line. However:

- The destructive shell commands explicitly name `newsnexus_prod`.
- The db-manager environment resolves to `localhost:5432/newsnexus_prod` with schema `public`.
- A current runtime resolution check reports the same target.

The available evidence supports successful completion against `newsnexus_prod`.

## 2. Physical db-models package loaded

`db-manager/dist/index.js` imports `@newsnexus/db-models`.

Node resolution from the db-manager entry point maps that package to:

```text
/home/limited_user/applications/NewsNexus12/db-models/dist/index.js
```

The package metadata is:

```text
name: @newsnexus/db-models
main: dist/index.js
```

The root workspace link resolves to:

```text
/home/limited_user/applications/NewsNexus12/db-models
```

There is no separate nested copy under `db-manager/node_modules/@newsnexus/db-models` in the current installation.

This physical resolution was verified against the current installation. Historical resolution was not logged directly. It is inferred from the recorded root-workspace build, package declaration, and module layout.

### What the rebuild-time build registered

The important distinction is between the current compiled package and the package compiled before the two replenishes.

Git reflog shows:

- Local branch HEAD was `8476671` from 2026-10-02 23:29 UTC until 2026-10-04 14:12 UTC.
- Remote tracking fetched `6245115` on 2026-10-03 21:11 UTC, but local HEAD did not advance then.
- Local HEAD finally fast-forwarded to `4ba7f50` on 2026-10-04 14:12 UTC.

Both rebuild cycles occurred before that local fast-forward.

At `8476671`:

- `db-models/src/models/WeeklyArticleFlowRun02.ts` did not exist.
- `db-models/src/models/_index.ts` did not initialize or export `WeeklyArticleFlowRun02`.
- `db-models/src/models/_loadOrder.ts` did not include it.

Therefore, the compiled `initModels()` used by those replenishes did not register `WeeklyArticleFlowRun02`.

### What the current build registers

At the current checkout, compiled `initModels()` calls `initWeeklyArticleFlowRun02()` and returns the model.

A runtime inspection confirmed:

- `weeklyModelRegistered: true`
- `sequelizeHasWeeklyModel: true`
- Table mapping: `public.WeeklyArticleFlowRuns02`

The current build registers the expected model and table mapping. The database was rebuilt before that version was actually checked out locally.

## 3. What the rebuild path creates

The restore path does not limit schema creation to CSV files in the backup.

`db-manager/src/modules/zipImport.ts` performs:

```typescript
await sequelize.query("DROP SCHEMA IF EXISTS public CASCADE;");
await sequelize.query("CREATE SCHEMA public;");
await sequelize.sync();
```

Before this, `db-manager/src/index.ts` calls `initModels()`.

As a result, `sequelize.sync()` creates every model registered in that process, including registered models that have no CSV in the backup.

After schema creation, the importer separately loads data:

1. It loops through `MODEL_LOAD_ORDER`.
2. It looks for a matching CSV.
3. If no CSV exists, it continues without importing rows.
4. The already-created table remains empty.

Therefore:

- Registered model without a CSV: table is created with zero rows.
- Unregistered model: table is not created at all.

### Where WeeklyArticleFlowRuns02 was omitted

The schema omission happened in the rebuild-time model registry.

The local checkout was still `8476671`, so `initModels()` did not know about `WeeklyArticleFlowRun02`. Consequently, `sequelize.sync()` had no model from which to create `WeeklyArticleFlowRuns02`.

The backup had a separate data omission:

- ZIP: `/home/nick/db_backup_202609302314388.zip`
- Present: `WeeklyArticleFlowRun.csv`
- Absent: `WeeklyArticleFlowRun02.csv`

The db-manager log reports:

```text
Skipped files with no matching model: WeeklyArticleFlowRun.csv
```

That old CSV did not cause the missing table. It only confirms the backup predates the V02 model and cannot restore V02 run-history rows.

Had the current model been registered during the rebuild, `sequelize.sync()` would have created an empty `WeeklyArticleFlowRuns02` table despite the missing V02 CSV.

## Root cause

The root cause is stale local HEAD during destructive schema rebuilds.

A fetch updated the remote-tracking reference, but the local branch remained at `8476671`. The build and replenish commands then completed successfully from that older checkout.

Later, the local branch advanced to `4ba7f50` and the applications were rebuilt. This deployed code that expected `WeeklyArticleFlowRuns02` against a database created by code that did not define it.

That sequence produced the observed code/database schema skew.

## Recommendation

### Immediate schema repair

Do not run Weekly Flow 02 as a repair. It does not create schema and will depend on the missing table.

Prefer an explicit, idempotent schema installation or migration that creates only `public.WeeklyArticleFlowRuns02` from the current model definition.

This is safer than replaying the 2026-09-30 ZIP because that ZIP is stale and contains no V02 run-history data.

After installation, verify:

1. `to_regclass('public."WeeklyArticleFlowRuns02"')` is non-null.
2. The table is readable by `newsnexus_app`.
3. Its row count is `0` before the first successful run.
4. `/admin-database/backup` lists all registered or exported model tables.
5. A real backup succeeds.
6. Weekly Flow 02 can create and update a persisted run record.

If the team chooses another destructive replenish instead, first confirm the accepted data-loss window and use a verified current backup. Do not assume the old ZIP represents the current database.

### Prevent recurrence

Before every schema rebuild, print and record:

```bash
git rev-parse HEAD
git status --short --branch
git rev-list --left-right --count origin/dev_35_weekly_combined_flow_02...HEAD
node -p "require.resolve('@newsnexus/db-models')"
```

Also add a preflight that initializes models and asserts the required model/table mapping before any destructive command.

The restore log should print:

- Git commit or build identifier
- Resolved db-models entry point
- Database host, port, database, and schema without credentials
- Registered model count
- Created table count
- Models without matching CSV files

### Admin backup display hardening

Harden `/db-row-counts-by-table` so one missing relation does not suppress healthy tables.

Use per-model isolation and return:

- Existing empty table: `rowCount: 0`, `status: "ok"`
- Missing or inaccessible table: `rowCount: null`, `status: "unavailable"`

Keep actual backup creation fail-closed. A missing registered table should prevent a misleadingly successful backup.

## Conclusion

The operator answer clears the target ambiguity and the additional evidence clears the root-cause ambiguity.

Both replenish logs show successful schema rebuild and import completion. The available target-resolution evidence supports that they operated on `newsnexus_prod`, but they used an older local checkout whose compiled model registry did not include `WeeklyArticleFlowRun02`.

The table was omitted at schema creation because the model was unregistered, not because its backup CSV was absent. The absent CSV only means there was no V02 data to restore.
