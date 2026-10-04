---
created_at: 2026-10-04T16:30:45Z
updated_at: 2026-10-04T16:30:45Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Mac workstation database drop, create, and replenish

## Before starting

1. Stop all NewsNexus12 applications.
2. Confirm the backup ZIP is the intended restore source.
3. Confirm `db-manager/.env` uses:
   - `PG_DATABASE=newsnexus_prod`
   - `PG_USER=newsnexus_boot`
   - `PG_SCHEMA=public`
   - `PG_APP_ROLE=newsnexus_app`

## Prepare the repository

Run from the repository root:

```bash
git rev-parse HEAD
git status --short --branch
npm install
npm run build:backend
```

Confirm the checked-out commit contains every model expected in the rebuilt database before continuing.

## Drop and create the database

These commands permanently replace the local `newsnexus_prod` database.

```bash
dropdb --if-exists newsnexus_prod
createdb -O newsnexus_boot newsnexus_prod

psql postgres -c "GRANT CONNECT ON DATABASE newsnexus_prod TO newsnexus_app;"
psql postgres -c "GRANT CREATE ON DATABASE newsnexus_prod TO newsnexus_boot;"
psql -d newsnexus_prod -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"
psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
psql -d newsnexus_prod -c "GRANT USAGE ON SCHEMA public TO newsnexus_app;"
```

## Replenish

Use an absolute path to the verified backup:

```bash
cd /Users/nick/Documents/NewsNexus12/db-manager
node dist/index.js --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

The current model registry creates tables that are absent from an older backup. Those tables remain empty after replenishment.

## Verify

```bash
psql -d newsnexus_prod -c '\dt public.*'
psql -d newsnexus_prod -c 'SELECT COUNT(*) FROM public."WeeklyArticleFlowRuns02";'
```

1. Confirm the replenish command completed successfully.
2. Confirm expected tables exist.
3. Confirm `WeeklyArticleFlowRuns02` exists even when its backup CSV was absent.
4. Start the applications only after verification passes.
