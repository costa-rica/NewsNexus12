---
created_at: 2026-10-04T14:51:55Z
updated_at: 2026-10-04T14:51:55Z
created_by: codex (gpt-5.6-sol) nws-nn12dev
modified_by: codex (gpt-5.6-sol) nws-nn12dev
---

# Weekly Flow 02 database schema skew report

## Report status

- Date investigated: 2026-10-04
- Environment: NewsNexus12 development server
- Repository branch: `dev_35_weekly_combined_flow_02`
- Repository commit: `4ba7f50fdf5a3aff8a99e157dcbd3affe62084b6`
- Affected portal page: `/admin-database/backup`
- Affected model: `WeeklyArticleFlowRun02`
- Expected PostgreSQL table: `WeeklyArticleFlowRuns02`

## Executive summary

The development deployment has code/database schema skew.

The shared model, API registration, and compiled artifacts include `WeeklyArticleFlowRun02`. The connected PostgreSQL database does not contain the expected `WeeklyArticleFlowRuns02` table.

The admin row-count API queries every registered model in one all-or-nothing operation. When it reaches the missing table, PostgreSQL raises an undefined-relation error. The API returns HTTP 500 and discards the successful counts collected for the other tables.

The portal receives no usable row-count response. It therefore displays none of the table names on `/admin-database/backup`.

Running Weekly Flow 02 will not install the table. The ops implementation intentionally does not call `sequelize.sync()`. It expects the schema to be installed before the coordinator runs.

## User-visible symptoms

- `/admin-database/backup` does not display the database table list.
- The API request to `/admin-db/db-row-counts-by-table` returns HTTP 500.
- Existing tables disappear from the display even though they remain present and readable.
- The dev sidebar reports version `12.412.34`, while a Mac build at the same HEAD reports `12.421.25`.

The version difference is explained separately below. It is not the cause of the missing table list.

## Evidence

### Repository and build state

The development checkout was at commit `4ba7f50fdf5a3aff8a99e157dcbd3affe62084b6` during the investigation.

The deployed source and compiled output include:

- `WeeklyArticleFlowRun02` in `db-models`.
- `WeeklyArticleFlowRun02` in the API build.
- The model in the admin database row-count registry.
- The model in the stable database model load order.

The portal and API services had been rebuilt and started after the artifacts were generated. This rules out an old portal bundle as the primary cause.

### Database state

A read-only PostgreSQL catalog query found no physical table matching the Weekly Flow 02 run-table name.

The API log recorded the corresponding database error:

```text
relation "public.WeeklyArticleFlowRuns02" does not exist
```

This occurred while serving:

```text
GET /admin-db/db-row-counts-by-table
```

### Incomplete deployment checkpoint

The persistence implementation checklist already defines a development-server schema checkpoint in:

`docs/weekly-article-pipeline-v02/20261003_weekly_flow_02_persistence_todo_v02.md`

That checkpoint requires the operator to:

1. Back up the development database.
2. Pull and build the persistence changes.
3. Drop, create, and replenish the development schema.
4. Verify `WeeklyArticleFlowRuns02` and its planned columns and defaults.
5. Verify application-role access to the table and sequence.
6. Test both db-manager and API backup paths.
7. Run the persisted coordinator verification.

At investigation time, these tasks were unchecked and the development-server verification record was `Pending`.

## Root cause

Commit `6245115` added and exported the Sequelize model. Commit `4ba7f50` registered it with the admin database table-list and row-count route.

The physical table was not subsequently installed in the database used by the development services.

This created the following mismatch:

| Layer | State |
| --- | --- |
| Shared Sequelize model | Present |
| API model registration | Present |
| Compiled API and model artifacts | Present |
| PostgreSQL table | Missing |

`npm install` and `npm run build` cannot resolve this mismatch. They install dependencies and compile source code, but they do not migrate an existing PostgreSQL schema.

## Why every table disappears

The row-count endpoint counts the models sequentially inside one outer error boundary.

Counts for existing tables succeed until the endpoint reaches `WeeklyArticleFlowRun02`. The missing PostgreSQL relation causes that count to throw. The route then returns HTTP 500 without returning the earlier successful counts.

The portal only replaces its initial empty table array after a successful response. When the request fails, it logs the error and leaves the array empty.

This behavior turns one missing relation into a blank list for every table.

## Empty table versus missing table

These cases must remain distinct:

- An existing table with no records is valid. `COUNT(*)` returns `0`.
- A missing table is a schema error. PostgreSQL raises an undefined-relation error.

The current incident is not caused by an empty `WeeklyArticleFlowRuns02` table. The physical table does not exist.

The user interface should not represent a missing table as having zero rows. Doing so would conceal deployment or migration failures.

## Effect on Weekly Flow 02

Running `npm run weekly-flow-02:start` will not create the missing table.

The persistence design explicitly prevents the ops application from calling `sequelize.sync()`. Weekly Flow 02 expects the table and application-role permissions to exist before startup.

A real invocation would likely fail while selecting or creating its persisted run record. It should not be used as a schema-installation mechanism.

## Effect on database backups

The problem is broader than the row-count display.

The API backup implementation enumerates exported database models and calls `findAll()` for each model. The missing relation can therefore cause an actual API backup to fail when it reaches `WeeklyArticleFlowRun02`.

The row-count endpoint may be hardened to return partial display results. The actual backup operation must not silently skip a required table and claim success. That could produce an incomplete backup presented as valid.

A safety backup taken before schema remediation may require a known-good pre-model build or another explicitly verified backup method.

## Sidebar version difference

The app-version script calculates the display version from two Git counts:

```text
12.<commit count through merge-base>.<commits from merge-base to HEAD>
```

The script checks the local `main` reference before `origin/main`. The local trunk reference is therefore an undeclared build input.

The observed versions have the same total history count:

| Build | Base count | Branch count | Total |
| --- | ---: | ---: | ---: |
| Dev `12.412.34` | 412 | 34 | 446 |
| Mac `12.421.25` | 421 | 25 | 446 |

The two builds can have the same feature-branch HEAD while displaying different versions if their local `main` references point to different ancestors.

The version difference does not indicate that the model is absent from the dev build. The dev artifacts were confirmed to contain it.

## Required schema remediation

Schema remediation should follow the controlled operator checkpoint rather than an ordinary pipeline run.

Before any destructive action:

1. Confirm the exact database authorized for remediation.
2. Stop services and processes that can write to that database.
3. Create and verify a safety backup using a method not blocked by the missing model.
4. Build the required packages in dependency order.
5. Run the approved bootstrap-owner schema workflow.
6. Verify the table definition, defaults, timestamps, and sequence.
7. Verify the application role can select, insert, and update the table and use its sequence.
8. Remove any controlled verification row.
9. Start the stopped services.
10. Test the row-count endpoint, db-manager backup, and API backup.
11. Run the persisted Weekly Flow 02 checkpoint only after schema verification succeeds.

Do not create an ad hoc table containing only the expected name. The Sequelize model defines multiple typed columns, JSONB fields, defaults, validation rules, timestamps, and sequence behavior.

## Recommended display hardening

The row-count endpoint should isolate failures by table.

A per-model `try/catch` or `Promise.allSettled()` can return healthy counts while identifying unavailable models. A response entry could use this shape:

```json
{
  "tableName": "WeeklyArticleFlowRun02",
  "rowCount": null,
  "status": "unavailable",
  "error": "table_missing"
}
```

The portal should then:

- Display every healthy table and its count.
- Display `0` for an existing empty table.
- Display `Missing` or `Unavailable` for a missing relation.
- Show a visible warning that the database schema and deployed model set differ.
- Avoid exposing raw database error details or credentials.

Tests should cover one model count rejecting while all other model counts remain visible.

This hardening improves diagnosis and prevents one table from blanking the display. It does not replace the required schema installation.

## Additional prevention measures

- Add a deployment-time schema readiness check for required runtime models.
- Verify new model tables and permissions before deploying code that enumerates them.
- Treat model export, schema installation, permissions, and consumer deployment as one rollout unit.
- Record the exact database target and schema verification evidence in the implementation checklist.
- Make the portal show row-count request failures instead of only logging them to the browser console.
- Keep actual backups fail-closed when required tables cannot be read.
- Consider basing displayed versions on a canonical fetched trunk reference or a CI-injected value.

## Safety note

The persistence checklist refers to `newsnexus_dev`, while the inspected development API startup information identified a database named `newsnexus_prod`.

The name alone does not establish whether the database is production data. It does create enough ambiguity that no drop, rebuild, or replenish action should occur until the operator confirms the intended target and backup method.

## Investigation scope

The investigation was read-only except for generating this report.

No database schema, records, service definitions, runtime services, or application source files were changed as part of the diagnosis.

## Open Questions

### 1. Authorized database target

Which exact PostgreSQL database on the development server is authorized for the schema rebuild and replenish operation?

#### Operator Response

(codex) Confirm the target independently before any destructive command because the documented and observed database names differ.
