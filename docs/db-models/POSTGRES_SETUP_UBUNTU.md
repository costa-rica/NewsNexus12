# Ubuntu Postgres Setup

Steps to prepare a Postgres 16 instance on the Ubuntu production server so
all NewsNexus12 apps can connect, read, and write.

Assumes Postgres 16 is already installed and the service is running.


## 1. Verify Postgres is running

```bash
pg_isready
sudo systemctl status postgresql
```


## 2. Allow passwordless local connections

Edit pg_hba.conf (path varies, find it with `psql -U postgres -c 'SHOW hba_file;'`)
and make sure the line for local IPv4 connections uses trust:

```
host    all    all    127.0.0.1/32    trust
```

Then reload:

```bash
sudo systemctl reload postgresql
```

This lets any process on the server connect without a password. Port 5432
should not be open to the internet — confirm with `sudo ufw status`.


## 3. Create roles

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE newsnexus_boot WITH LOGIN CREATEDB;
CREATE ROLE newsnexus_app  WITH LOGIN;
SQL
```


## 4. Create the production database

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE newsnexus_prod OWNER newsnexus_boot;
GRANT CONNECT ON DATABASE newsnexus_prod TO newsnexus_app;
SQL
```


## 5. Grant schema privileges

Postgres 15+ revokes CREATE on public from everyone by default. Run this
inside the production database so the bootstrap role can create tables and
the app role can read and write them.

```bash
sudo -u postgres psql -d newsnexus_prod <<'SQL'
GRANT CREATE ON SCHEMA public TO newsnexus_boot;
GRANT USAGE  ON SCHEMA public TO newsnexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE newsnexus_boot IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO newsnexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE newsnexus_boot IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO newsnexus_app;
SQL
```


## 6. Configure each package's .env

Every package has its own .env. Leave PG_PASSWORD blank — no password needed.

db-manager uses the bootstrap role because it runs schema rebuilds.
All other apps use the app role.

### db-manager/.env (bootstrap role)

```
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_prod
PG_USER=newsnexus_boot
PG_PASSWORD=
PG_SCHEMA=public
PG_APP_ROLE=newsnexus_app
```

PG_APP_ROLE tells db-manager to re-grant privileges to the app role after
every replenish, because DROP SCHEMA CASCADE wipes default privileges.

### api/.env, worker-node/.env, worker-python/.env (app role)

```
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_prod
PG_USER=newsnexus_app
PG_PASSWORD=
PG_SCHEMA=public
```


## 7. Load data with db-manager

Run this from the db-manager directory. It will drop and rebuild the schema,
load all CSVs from the backup zip in dependency order, and reset sequences.

```bash
cd db-manager
npm run build
node dist/index.js --zip_file /path/to/db_backup_YYYYMMDDHHMMSS.zip
```

To validate a backup zip without touching the production database first:

```bash
node dist/index.js --dry_run --zip_file /path/to/db_backup_YYYYMMDDHHMMSS.zip
```


## 8. Verify the connection

```bash
psql -h localhost -U newsnexus_app -d newsnexus_prod -c 'SELECT COUNT(*) FROM "Articles";'
```


## 9. Reset the database if needed

To wipe all data and rebuild an empty schema without dropping the database:

```bash
cd db-manager
node dist/index.js --drop_db
```

To also drop and recreate the database itself:

```bash
sudo -u postgres psql <<'SQL'
DROP DATABASE IF EXISTS newsnexus_prod;
CREATE DATABASE newsnexus_prod OWNER newsnexus_boot;
SQL
```

Then re-run step 5 and step 7.
