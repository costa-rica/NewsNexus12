# Local Postgres Setup

This guide walks through provisioning a local Postgres instance for NewsNexus12 development and wiring each package's `.env` to it. It replaces the former SQLite-based setup.

> No Docker required. We use a native Postgres install (Homebrew on macOS, apt on Ubuntu) for both development and the Ubuntu VM production host.

## 1. Install Postgres 16

### macOS (Homebrew)

```bash
brew install postgresql@16
brew services start postgresql@16
```

Add the binaries to your shell profile if needed:

```bash
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
```

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y postgresql-16
sudo systemctl enable --now postgresql
```

Verify:

```bash
psql --version          # psql (PostgreSQL) 16.x
pg_isready              # /tmp:5432 - accepting connections
```

## 2. Create roles and databases

NewsNexus12 uses two Postgres roles per environment:

- **app role** — used by api, worker-node, worker-python, portal (at runtime). No DDL privileges.
- **bootstrap role** — used by db-manager for replenish / schema-rebuild flows. Owns the schema.

For local development the two roles can share a single superuser-ish role, but we still model them separately so the production VM can enforce the split.

### Development defaults

Run once from any shell where your OS user can `psql postgres`:

```bash
# Connect as the default superuser (macOS: your OS user; Ubuntu: postgres)
psql postgres <<'SQL'
CREATE ROLE newsnexus_app      WITH LOGIN PASSWORD 'newsnexus_app_dev';
CREATE ROLE newsnexus_boot     WITH LOGIN PASSWORD 'newsnexus_boot_dev' CREATEDB;

CREATE DATABASE newsnexus_dev             OWNER newsnexus_boot;
CREATE DATABASE newsnexus_test_api        OWNER newsnexus_boot;
CREATE DATABASE newsnexus_test_db_manager OWNER newsnexus_boot;
CREATE DATABASE newsnexus_test_worker_node OWNER newsnexus_boot;

GRANT CONNECT ON DATABASE newsnexus_dev             TO newsnexus_app;
GRANT CONNECT ON DATABASE newsnexus_test_api        TO newsnexus_app;
GRANT CONNECT ON DATABASE newsnexus_test_db_manager TO newsnexus_app;
GRANT CONNECT ON DATABASE newsnexus_test_worker_node TO newsnexus_app;
SQL
```

Then, inside each database, grant the bootstrap role DDL rights and the app role runtime access to the `public` schema:

```bash
for DB in newsnexus_dev newsnexus_test_api newsnexus_test_db_manager newsnexus_test_worker_node; do
  psql -d "$DB" <<SQL
    -- PG 15+ revokes CREATE on public from everyone by default; restore it for the bootstrap role.
    GRANT CREATE ON SCHEMA public TO newsnexus_boot;
    GRANT USAGE ON SCHEMA public TO newsnexus_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE newsnexus_boot IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO newsnexus_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE newsnexus_boot IN SCHEMA public
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO newsnexus_app;
SQL
done
```

## 3. Seed the dev database

Use db-manager to restore from a CSV backup zip. This is the **only** supported path for getting real data into a fresh Postgres instance — we do not run SQLite → Postgres migration.

```bash
cd db-manager
# Ensure db-manager/.env points PG_* to newsnexus_dev using the bootstrap role
npm run build
node dist/index.js --zip-file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```

db-manager will:

1. `DROP SCHEMA public CASCADE` and re-`CREATE` it.
2. `sequelize.sync()` to rebuild every table.
3. Load each CSV in `MODEL_LOAD_ORDER` (parents before children, no FK disable).
4. Run `resetAllSequences()` so that auto-increment ids continue from `MAX(id)`.

## 4. Wire up each package's `.env`

Each package keeps its own `.env`. Copy from `.env.example` and fill in the Postgres block. Example values below target the dev database and the app role.

### api/.env

```
NODE_ENV=development
NAME_APP=NewsNexus12API
PATH_TO_LOGS=/absolute/path/to/logs
PORT=3000
LOAD_LEGACY_ROUTERS=true
PATH_TO_UTILITIES_ANALYSIS_SPREADSHEETS=/absolute/path/to/analysis_spreadsheets

PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_dev
PG_USER=newsnexus_app
PG_PASSWORD=newsnexus_app_dev
PG_SCHEMA=public
# Optional tuning — defaults listed in db-models/src/models/_connection.ts
# PG_POOL_MAX=10
# PG_POOL_MIN=0
# PG_LOG_SQL=false
# PG_SSL=false
```

### db-manager/.env

Same block as above, but with the **bootstrap role** because db-manager runs DDL:

```
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_dev
PG_USER=newsnexus_boot
PG_PASSWORD=newsnexus_boot_dev
PG_SCHEMA=public
# PG_POOL_MAX=3
```

### worker-node/.env

Same pattern as api, but lower pool size:

```
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_dev
PG_USER=newsnexus_app
PG_PASSWORD=newsnexus_app_dev
PG_SCHEMA=public
# PG_POOL_MAX=5
```

### worker-python/.env

worker-python reads the same `PG_*` variables and builds a psycopg connection pool at startup.

```
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_dev
PG_USER=newsnexus_app
PG_PASSWORD=newsnexus_app_dev
PG_SCHEMA=public
# PG_POOL_MAX=5
```

### Per-package test databases

To avoid Jest-worker races, each test-running package has its own test database. The test harness sets `PG_DATABASE=newsnexus_test_<package>` per-suite; no shared test DB. See §5.3 of the transition plan for details.

## 5. Sanity checks

From the repo root:

```bash
# Confirm db-models can connect
cd db-models && npm run build
node -e "require('./dist/models/_connection'); console.log('ok');"

# Confirm api can boot and hit the DB
cd ../api && npm run build && node dist/server.js   # Ctrl-C after it logs "Listening on 3000"
```

If connection fails, verify:

- `pg_isready` returns green
- `psql -h localhost -U newsnexus_app -d newsnexus_dev -c 'SELECT 1;'` succeeds
- `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` all match what you set in step 2

## 6. Resetting a local database

```bash
psql postgres <<'SQL'
DROP DATABASE IF EXISTS newsnexus_dev;
CREATE DATABASE newsnexus_dev OWNER newsnexus_boot;
SQL
```

Then re-run the db-manager zip import from step 3.
