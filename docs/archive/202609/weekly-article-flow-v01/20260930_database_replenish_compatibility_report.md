---
created_at: 2026-09-30T22:29:01Z
updated_at: 2026-09-30T22:30:06Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Database Replenish Compatibility at 1ae8c77

## Abstract

The NewsNexus12 ZIP backup should import into the database schema defined at commit 1ae8c77 without manually editing its CSV files. The historical importer already filters unknown columns and skips CSV files whose models are absent from its load order. Its implementation is identical to the current importer.

The schema comparison identifies one added table, WeeklyArticleFlowRuns, and one added column, NewsApiRequests.weeklyArticleFlowRunId, with associated constraints and indexes. Returning to the older schema intentionally omits that workflow history and linkage while retaining compatible article, request, scoring, state, and AI Approver V02 data. The newer backup manifest does not prevent import.

This conclusion comes from source inspection, not a restore of the actual latest backup. Preserve the original archive unchanged, rebuild dependencies and models from the target revision, and rehearse its import in an isolated database before replacing live data. Review skipped records, verify counts and relationships, and retain workflow evidence separately for reference.

## Recommendation

1. Keep the latest complete backup ZIP unchanged. No CSV conversion is required for the identified weekly-flow schema changes when using the repository's db-manager ZIP importer at `1ae8c77`.
2. Validate that exact archive with the target revision's importer and compiled models in a disposable database before rebuilding a live database.
3. Preserve the original ZIP outside the repository, including weekly-run CSV data and the request column that the older schema will omit.
4. Accept the intentional loss of those fields from the restored operational database only after confirming that the historical evidence is safely retained.
5. Treat code rollback, schema rebuild, data restoration, and retirement of installed weekly-flow services as separate operator steps.

## Scope and confidence

- Target: `1ae8c77b8eaf2a28de30badd9bbfcfa2b943dba2`, dated August 29, 2026; `fix: preserve v02 rows during restore`.
- Compared source: `f6fcc7f18d9178d3895d324dea4a6c1bf78b7e99`, the current committed preservation state.
- Reviewed model definitions, associations, load order, backup serialization, ZIP import, CLI routing, dry-run validation, and both server inventory reports.
- The ZIP importer and dry-run validator have identical Git blob IDs at the target and current revisions. This is verified historical behavior, not an assumption about the older implementation.
- No specific latest backup archive was supplied or inspected. No database connection, import, drop, schema change, service change, checkout, or revert was performed for this report.
- Compatibility is strongly supported for the committed schema delta. Archive integrity, actual host schema drift, and actual data quality remain unverified.

## Schema differences that affect replenishment

The complete `db-models/src` comparison shows these database changes. The remaining model changes register the new model and its load order; existing business models otherwise retain their definitions.

| Current item | State at 1ae8c77 | Result when importing current ZIP with target code |
| --- | --- | --- |
| `WeeklyArticleFlowRuns` table | Absent | `WeeklyArticleFlowRun.csv` is skipped and listed in skipped files, if present |
| `NewsApiRequests.weeklyArticleFlowRunId` | Absent | The extra field in `NewsApiRequest.csv` is filtered from each record before insertion |
| Request-to-weekly-run foreign key and request-column index | Absent | Not recreated by the older models; retained request rows do not need weekly-run parents |
| Weekly-run indexes, including the single-active-run constraint | Absent | Not recreated because the weekly-run table is absent |
| Article, content, scoring, state, approval, and AI Approver V02 models | No definition changes in this comparison | Their compatible CSV records remain eligible for import |

- CSV filenames use exported model names, not PostgreSQL table names. The relevant filenames are singular: `WeeklyArticleFlowRun.csv` and `NewsApiRequest.csv`.
- Retained request IDs and existing article/request relationships are not removed by filtering `weeklyArticleFlowRunId`.
- Weekly cohort attribution and durable weekly stage results will no longer be queryable through the older operational schema. They remain in the preserved original archive.
- Restoring current article data keeps the results of completed processing where stored in retained tables. It does not recreate articles or duplicate-analysis rows already deleted before the backup.

## Why unchanged CSVs should work

1. The backup writer exports nonempty registered models as CSV and now adds `manifest.json` with row counts, sizes, and checksums. Empty models have manifest entries but no CSV.
2. The historical importer recursively discovers CSV files. It does not consume the manifest or execute schema definitions from the archive, so the additional JSON file is harmless.
3. The importer rebuilds the schema from the loaded Sequelize models. With correctly built target models, this creates the older schema.
4. It imports only models in the target `MODEL_LOAD_ORDER`. A CSV outside that order is recorded in `skippedFiles`, and the CLI emits a warning.
5. `filterRecordToModelAttributes()` removes CSV fields that are absent from the target model's `rawAttributes`. This removes `weeklyArticleFlowRunId` without requiring a spreadsheet edit. This field filtering does not produce a dedicated warning.
6. Retained tables load in dependency order, and serial ID sequences reset after import.

The target commit also contains the nullable-string normalization fix intended to preserve AI Approver V02 runs and predictions during restore. Choosing its parent would omit that fix. Keep the exact target revision when rehearsing.

## What drop, create, and replenish mean here

- A Git revert alone does not alter the existing PostgreSQL schema or rows.
- db-manager's `--zip_file` operation already calls `rebuildSchema()`: it drops `public` with `CASCADE`, recreates it, calls `sequelize.sync()`, and then imports records.
- A separate `--drop_db` step is unnecessary for this ZIP restore. That flag also rebuilds the schema; despite its name, it does not drop the PostgreSQL database itself.
- The PostgreSQL database must already exist for normal import. If the operator drops the entire database externally, its creation, ownership, and connection configuration must be handled separately.
- The older importer re-grants access when `PG_APP_ROLE` is configured. Confirm that the bootstrap role and intended runtime role are correct before an eventual rebuild.
- Schema rebuild removes other objects in `public` too. Model-driven CSV backups do not preserve arbitrary extra tables, views, functions, or every database-level setting. Check the host inventory for objects outside the registered models.
- Import uses per-batch transactions, not one transaction covering the whole rebuild. A later error can leave a partially restored database.

## Proposed verification before live restoration

These are future operator steps, not commands executed during this assessment.

1. Choose the exact source archive for each destination and record its source host, database, capture time, and checksum. Confirm any intended production-to-development copy explicitly.
2. Capture the final backup while relevant writers are stopped or quiescent. The backup writer reads models sequentially without a shared snapshot transaction, so concurrent writes can produce inconsistent cross-table data.
3. Preserve the archive and weekly-flow evidence outside the repository. Verify manifest checksums independently; the importer does not validate them.
4. Prepare an isolated checkout of `1ae8c77`, install its dependencies, and build `db-models` before db-manager. Confirm the resolved `@newsnexus/db-models` package has no weekly-run model or request-link column. Old ignored build outputs or installed package copies can otherwise invalidate the rehearsal.
5. Run the target revision's existing validation path against the chosen archive:

   ```bash
   npm start -- --zip_file /absolute/path/to/verified-backup.zip --dry_run
   ```

   - Run from that checkout's `db-manager` directory with reviewed database connection settings.
   - This creates, imports into, and drops a scratch database named `newsnexus_dry_run_<timestamp>` on the configured PostgreSQL server. It is not a purely read-only operation and requires suitable database privileges.
   - It overrides `PG_DATABASE` for the child importer. Running it from current code would test the current schema, not the proposed target schema.
6. Inspect the raw import output as well as the summary. With production file logging, stdout may not contain all warnings. The validator's success flag is based on child exit status, not strict row preservation.
7. For detailed reconciliation, use a separate disposable restored database that can remain available for inspection. The built-in validator drops its scratch database before returning.
8. Compare actual restored counts and IDs with the archive for every retained table, especially articles, requests, content, approval records, AI Approver V02 runs/predictions, and association tables. Check relationships and verify sequences permit new inserts in the disposable database.
9. Expect only `WeeklyArticleFlowRun.csv` to be skipped because of this schema rollback, if that CSV is present. Investigate additional skipped files, orphaned rows, unexpected count differences, or coercions before live restoration.
10. After successful reconciliation, smoke-test the target applications against the disposable database. The operator can then schedule the live rebuild with writers and weekly-flow triggers stopped, followed by the same checks.

## Important limits of a successful import

- Foreign-key violations can cause orphaned rows to be skipped with warnings rather than failing the entire import.
- `bulkCreate` uses `ignoreDuplicates: true`. The reported import total increments by processed batch size, so it is not proof that every input row was inserted.
- Invalid dates, malformed JSON, and some blank values are normalized. Review whether these conversions are expected for the selected archive.
- A zero exit code establishes completion, not complete preservation of retained business data. Actual destination counts and relationships are the acceptance criteria.

## When CSV changes would be necessary

- No manual CSV edits are indicated for the source-controlled changes identified here.
- A direct PostgreSQL `COPY`, a raw SQL restore, or another importer would not necessarily filter the extra column or skip the weekly-run table. This recommendation applies specifically to db-manager's ZIP importer.
- If the actual archive contains additional schema drift, renamed fields, incompatible values, or constraints not represented by this comparison, assess those differences after the rehearsal identifies them.
- If conversion becomes necessary, create a separate derived archive and a written transformation record. Keep the original archive immutable; do not hand-edit the only backup.

## Evidence references

1. Git comparison: `git diff 1ae8c77 f6fcc7f -- db-models/src db-manager/src`.
2. Target `db-manager/src/modules/zipImport.ts`: `filterRecordToModelAttributes`, `importCsvFileInBatches`, `rebuildSchema`, and `importZipFileToDatabase`. Blob: `5f4dbc8306bfb4d449a29ce4cbce57d6951ec027`, unchanged at the compared revisions.
3. Target `db-manager/src/modules/dryRunValidator.ts`: scratch-database lifecycle, child environment override, and exit-status-based result. Blob: `f980726a64370277b1440d0243d503ade283c1df`, unchanged at the compared revisions.
4. Target `db-manager/src/index.ts`: ZIP import routing, schema rebuild flag, and skipped-file reporting.
5. Current `db-manager/src/modules/backup.ts`: registered-model CSV filenames, sequential reads, and manifest generation.
6. Current `db-manager/src/modules/installWeeklyArticleFlowSchema.ts` and `db-models/src/models/WeeklyArticleFlowRun.ts`: additive schema, constraints, and indexes.
7. [Development lessons and inventory](20260930_lessons_learned_from_v01_flow_nws-nn12dev.md): observed weekly-run table and database-lineage concerns.
8. [Production lessons and inventory](20260930_lessons_learned_from_v01_flow_nws-nn12prod.md): observed weekly-run table and request foreign key; neither host reported a `public.SequelizeMeta` table.
