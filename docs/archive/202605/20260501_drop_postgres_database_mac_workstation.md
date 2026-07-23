# Drop and Restore PostgreSQL Database - Mac workstation

Date: 2026-05-01

Server: Nick's Mac workstation

Database: `newsnexus_dev`

## Context

Use this runbook when the local NewsNexus12 development database needs to be dropped, recreated, and restored from a db-manager `.zip` backup. This is the Mac workstation version of `docs/20260430_drop_postgres_database.md`.

The current workstation was checked on 2026-05-01:

1. Postgres is installed with Homebrew as `postgresql@16`.
2. Postgres is running for user `nick`.
3. `pg_isready` reports `/tmp:5432 - accepting connections`.
4. The NewsNexus12 app database is `newsnexus_dev`.
5. The database owner and db-manager role is `newsnexus_boot`.
6. The runtime app role is `newsnexus_app`.
7. The package test databases are:
   - `newsnexus_test_api`
   - `newsnexus_test_db_manager`
   - `newsnexus_test_worker_node`
   - `newsnexus_test_worker_python`

## Existing local docs

You have not overlooked a complete Mac drop-and-restore runbook. The closest existing file is `docs/db-models/POSTGRES_SETUP_LOCAL.md`.

That file is still useful because it documents local Homebrew setup, roles, databases, and env wiring. Its reset section is brief, though, and does not cover the full Mac workstation workflow for checking active connections, recreating grants, and restoring with db-manager.

## Local env values to confirm

The local package `.env` files currently point at the same dev database:

1. `api/.env`
   - `PG_HOST=localhost`
   - `PG_PORT=5432`
   - `PG_DATABASE=newsnexus_dev`
   - `PG_USER=newsnexus_app`
   - `PG_SCHEMA=public`
2. `worker-node/.env`
   - `PG_HOST=localhost`
   - `PG_PORT=5432`
   - `PG_DATABASE=newsnexus_dev`
   - `PG_USER=newsnexus_app`
   - `PG_SCHEMA=public`
3. `worker-python/.env`
   - `PG_HOST=localhost`
   - `PG_PORT=5432`
   - `PG_DATABASE=newsnexus_dev`
   - `PG_USER=newsnexus_app`
   - `PG_SCHEMA=public`
4. `db-manager/.env`
   - `PG_HOST=localhost`
   - `PG_PORT=5432`
   - `PG_DATABASE=newsnexus_dev`
   - `PG_USER=newsnexus_boot`
   - `PG_SCHEMA=public`
   - `PG_APP_ROLE=newsnexus_app`

Do not paste passwords into this doc. Check them locally in the `.env` files when needed.

## 1. Verify Postgres is running

```bash
command -v psql
command -v pg_isready
brew services list | rg 'postgres|Name'
pg_isready
```

Expected local paths:

```bash
/opt/homebrew/opt/postgresql@16/bin/psql
/opt/homebrew/opt/postgresql@16/bin/pg_isready
```

If Postgres is not running:

```bash
brew services start postgresql@16
```

## 2. Confirm the database and roles

List local databases:

```bash
psql postgres -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;"
```

Confirm the NewsNexus roles:

```bash
psql postgres -c "SELECT rolname, rolsuper, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname LIKE 'newsnexus%' OR rolname = current_user ORDER BY rolname;"
```

Confirm `newsnexus_dev` ownership:

```bash
psql -d newsnexus_dev -c "SELECT current_database(), pg_get_userbyid(d.datdba) AS owner, current_user FROM pg_database d WHERE d.datname = current_database();"
```

Expected ownership:

```text
newsnexus_dev | newsnexus_boot | nick
```

## 3. Stop local NewsNexus services

Stop any local dev terminals running these commands:

1. `cd api && npm run dev`
2. `cd portal && npm run dev`
3. `cd worker-node && npm run dev`
4. `cd worker-python && flask run`
5. `cd db-models && npm run dev`

Check the usual local ports:

```bash
lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:3002 -iTCP:5000 -sTCP:LISTEN
```

If rows appear, stop the matching process from its terminal or with `kill <pid>`.

## 4. Confirm no active database connections

```bash
psql postgres -c "SELECT pid, datname, usename, application_name, state FROM pg_stat_activity WHERE datname = 'newsnexus_dev';"
```

If anything is still connected, terminate only the `newsnexus_dev` sessions:

```bash
psql postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'newsnexus_dev' AND pid <> pg_backend_pid();"
```

## 5. Optional backup before dropping

If the current local database may contain useful work, make a backup first:

```bash
cd /Users/nick/Documents/NewsNexus12/db-manager
npm start -- --create_backup
```

The local db-manager log path is configured as:

```text
/Users/nick/Documents/_logs/NewsNexus12/NewsNexus12DbManager.log
```

Follow it in another terminal if desired:

```bash
tail -f /Users/nick/Documents/_logs/NewsNexus12/NewsNexus12DbManager.log
```

## 6. Drop the local dev database

Run this from any terminal:

```bash
dropdb --if-exists newsnexus_dev
```

Confirm it is gone:

```bash
psql postgres -c "SELECT datname FROM pg_database WHERE datname = 'newsnexus_dev';"
```

The query should return zero rows.

## 7. Recreate the empty database

Create it with the db-manager/bootstrap role as owner:

```bash
createdb -O newsnexus_boot newsnexus_dev
```

Reapply the expected database and schema privileges:

```bash
psql postgres -c "GRANT CONNECT ON DATABASE newsnexus_dev TO newsnexus_app;"
psql postgres -c "GRANT CREATE ON DATABASE newsnexus_dev TO newsnexus_boot;"
psql -d newsnexus_dev -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"
psql -d newsnexus_dev -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
psql -d newsnexus_dev -c "GRANT USAGE ON SCHEMA public TO newsnexus_app;"
```

Check the privileges:

```bash
psql -d newsnexus_dev -c "SELECT 'newsnexus_boot create' AS check_name, has_schema_privilege('newsnexus_boot','public','CREATE') UNION ALL SELECT 'newsnexus_boot usage', has_schema_privilege('newsnexus_boot','public','USAGE') UNION ALL SELECT 'newsnexus_app usage', has_schema_privilege('newsnexus_app','public','USAGE') UNION ALL SELECT 'newsnexus_app create', has_schema_privilege('newsnexus_app','public','CREATE');"
```

Expected result:

1. `newsnexus_boot create` is `true`.
2. `newsnexus_boot usage` is `true`.
3. `newsnexus_app usage` is `true`.
4. `newsnexus_app create` is `false`.

## 8. Restore from a ZIP backup

Run the restore through db-manager using the bootstrap role configured in `db-manager/.env`.

```bash
cd /Users/nick/Documents/NewsNexus12/db-manager
npm start -- --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

Important notes:

1. The db-manager flag is `--zip_file`, with an underscore.
2. The import calls `rebuildSchema()`, which runs `DROP SCHEMA IF EXISTS public CASCADE`, recreates `public`, runs `sequelize.sync()`, imports the CSV files, and resets sequences.
3. `PG_APP_ROLE=newsnexus_app` in `db-manager/.env` lets db-manager re-grant runtime privileges after rebuilding the schema.

Follow the local db-manager log:

```bash
tail -f /Users/nick/Documents/_logs/NewsNexus12/NewsNexus12DbManager.log
```

## 9. Verify the restored database

Check that tables exist:

```bash
psql -d newsnexus_dev -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LIMIT 20;"
psql -d newsnexus_dev -c "SELECT count(*) AS table_count FROM pg_tables WHERE schemaname='public';"
```

Run a few focused app checks:

```bash
cd /Users/nick/Documents/NewsNexus12/db-models
npm run build

cd /Users/nick/Documents/NewsNexus12/api
npm run build

cd /Users/nick/Documents/NewsNexus12/worker-node
npm run build
```

## 10. Restart local services

Start the local services you need in separate terminals:

```bash
cd /Users/nick/Documents/NewsNexus12/db-models && npm run dev
cd /Users/nick/Documents/NewsNexus12/api && npm run dev
cd /Users/nick/Documents/NewsNexus12/portal && npm run dev
cd /Users/nick/Documents/NewsNexus12/worker-node && npm run dev
cd /Users/nick/Documents/NewsNexus12/worker-python && source venv/bin/activate && flask run
```

## Quick reference

| Item | Value |
| --- | --- |
| Postgres install | Homebrew `postgresql@16` |
| Host | `localhost` |
| Port | `5432` |
| Dev database | `newsnexus_dev` |
| Database owner | `newsnexus_boot` |
| Runtime role | `newsnexus_app` |
| Schema | `public` |
| db-manager log | `/Users/nick/Documents/_logs/NewsNexus12/NewsNexus12DbManager.log` |
| Existing local setup doc | `docs/db-models/POSTGRES_SETUP_LOCAL.md` |
