# @newsnexus/db-manager

Database management CLI tool for NewsNexus12 monorepo. Provides operations for database status reporting, article cleanup, backup creation, database restoration from ZIP backups, schema reset, and dry-run validation against a scratch database.

## Features

- **Database Status** - Query article counts, approval status, relevance ratings, and age metrics
- **Article Deletion** - Remove stale articles older than a configurable threshold (protects approved/relevant articles)
- **Article Trim** - Delete N oldest eligible articles by published date
- **Database Backup** - Create compressed ZIP files containing CSV exports of all database tables
- **Zip Import** - Full replenish: drop and rebuild schema, load CSVs in topological order, reset sequences
- **Drop DB** - Wipe all data and rebuild an empty schema (Postgres equivalent of deleting the SQLite file)
- **Dry-Run Validator** - Load a ZIP into a temporary scratch database, report coercion counts and errors, then clean up — live data is never touched

## Installation

This package is part of the NewsNexus12 monorepo and depends on `@newsnexus/db-models`.

```bash
# Install dependencies
npm install

# Build the package
npm run build
```

**Important:** Ensure `@newsnexus/db-models` is built before building this package:

```bash
cd ../db-models
npm run build
cd ../db-manager
npm run build
```

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

```bash
# Application Environment (development, testing, production)
NODE_ENV=development

# Application name (used for log file naming)
NAME_APP=NewsNexus12DbManager

# Logging configuration
PATH_TO_LOGS=/absolute/path/to/logs
LOG_MAX_SIZE=5
LOG_MAX_FILES=5

# Database configuration
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=newsnexus_dev
PG_USER=postgres
PG_PASSWORD=

# Optional: app role to re-grant after schema rebuild (leave blank if not used)
PG_APP_ROLE=

# Backup configuration (required for --create_backup)
PATH_DB_BACKUPS=/absolute/path/to/backups
```

See `.env.example` for detailed descriptions of each variable.

## Usage

The CLI supports multiple operation flags that can be combined in a single execution. Pass flags after `--` when using `npm start`:

```bash
npm start -- <flags>
```

### Database Status

Display current database statistics:

```bash
npm start
```

### Create Backup

Export all database tables to CSV and compress to ZIP:

```bash
npm start -- --create_backup
```

Creates a timestamped backup file at `PATH_DB_BACKUPS/db_backup_YYYYMMDDHHmmss.zip`.

### Import from Backup

Full replenish: drops and rebuilds the schema, imports all CSVs in dependency order, then resets sequences. Works whether or not the database already contains data.

```bash
npm start -- --zip_file /path/to/backup.zip
```

**Warning:** This destroys all existing data before importing. Create a backup first if needed.

Run the import as the same OS user that will later run the NewsNexus12 services. On the production server that user is `limited_user`:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --zip_file /path/to/backup.zip
```

If the command must be launched from another account:

```bash
sudo -u limited_user -H bash -lc 'cd /home/limited_user/applications/NewsNexus12/db-manager && npm start -- --zip_file /path/to/backup.zip'
```

### Drop Database

Wipe all data and rebuild an empty schema. This is the Postgres equivalent of deleting the SQLite database file:

```bash
npm start -- --drop_db
```

**What it does:**
1. `DROP SCHEMA public CASCADE` — removes all tables and data
2. `CREATE SCHEMA public` — recreates the empty schema
3. `sequelize.sync()` — rebuilds all table definitions
4. Re-grants access to `PG_APP_ROLE` if configured

**Warning:** This is irreversible. All data is permanently deleted.

### Dry-Run Validator

Load a ZIP backup into a temporary scratch database, run the full import pipeline, report coercion stats and errors, then drop the scratch database. **Your live database is never touched.**

```bash
npm start -- --dry_run --zip_file /path/to/backup.zip
```

Requires `--zip_file`. The scratch database is named `newsnexus_dry_run_<timestamp>` and is automatically dropped after the run, even if the import fails.

**Example output:**

```
Creating scratch database: newsnexus_dry_run_1776550931985

────────────────────────────────────────────────────────────
DRY-RUN VALIDATOR REPORT
────────────────────────────────────────────────────────────
Scratch database: newsnexus_dry_run_1776550931985
Status:           PASSED

Import summary
  Records imported:  2,536,606
  Tables imported:   27

Data coercion
  Invalid dates → null:    14
  SQLite booleans coerced: 320
────────────────────────────────────────────────────────────
Dropping scratch database: newsnexus_dry_run_1776550931985
```

Use this before running `--zip_file` on production to confirm the backup imports cleanly.

The validator resolves `createdb` / `dropdb` automatically from known Homebrew and system paths. If they are not found at those paths, ensure the PostgreSQL bin directory is on `PATH`.

### Delete Old Articles

Remove articles older than N days (default: 180) that are not approved or marked relevant:

```bash
# Use default threshold (180 days)
npm start -- --delete_articles

# Specify custom threshold
npm start -- --delete_articles 90
npm start -- --delete_articles=90
```

**Run in background on production (Ubuntu):**

```bash
# Step 1 — Cache your sudo password
sudo -v

# Step 2 — Start the job in the background
nohup sudo -u limited_user npm start -- --delete_articles > /dev/null 2>&1 &

# Step 3 — Get the PID
echo $!

# Check if still running
ps -p <PID> -o pid,stat,etime,cmd

# Follow logs
tail -f /home/limited_user/logs/NewsNexus12DbManager.log
```

### Trim Oldest Articles

Delete the N oldest eligible articles by published date:

```bash
npm start -- --delete_articles_trim 100
npm start -- --delete_articles_trim=100
```

### Combined Operations

Multiple flags can be combined in one execution (except `--dry_run`, which exits immediately after the validation report):

```bash
npm start -- --create_backup --delete_articles 180 --delete_articles_trim 50
```

**Execution order:**
1. Dry-run validation (if `--dry_run` — exits after report)
2. Drop and rebuild schema (if `--drop_db` — exits after rebuild)
3. Create backup (if `--create_backup`)
4. Import from ZIP (if `--zip_file`)
5. Trim articles (if `--delete_articles_trim`)
6. Delete old articles (if `--delete_articles`)
7. Display status summary

## CLI Flags

| Flag | Argument | Description |
|------|----------|-------------|
| `--create_backup` | None | Create a ZIP backup of all database tables |
| `--zip_file` | Path | Full replenish: drop schema, import ZIP, reset sequences |
| `--drop_db` | None | Wipe all data and rebuild empty schema |
| `--dry_run` | None (requires `--zip_file`) | Validate a ZIP against a scratch DB without touching live data |
| `--delete_articles` | Days (optional) | Delete articles older than N days (default: 180) |
| `--delete_articles_trim` | Count | Delete N oldest eligible articles |

## Development

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

Output is generated in the `dist/` directory.

### Test

Run the test suite:

```bash
npm test
```

Run tests in watch mode during development:

```bash
npm test -- --watch
```

### Clean

Remove compiled output:

```bash
npm run clean
```

## Architecture

### Project Structure

```
db-manager/
├── src/
│   ├── index.ts                 # Main entry point (IIFE orchestration)
│   ├── lib.ts                   # Library entry point (importable by other packages)
│   ├── config/
│   │   └── logger.ts            # Winston logger configuration
│   ├── modules/
│   │   ├── cli.ts               # CLI argument parser with Levenshtein suggestions
│   │   ├── status.ts            # Database status reporting
│   │   ├── deleteArticles.ts    # Article deletion operations (batch processing)
│   │   ├── backup.ts            # Database backup to ZIP/CSV
│   │   ├── zipImport.ts         # ZIP import: schema rebuild, topological load, sequence reset
│   │   └── dryRunValidator.ts   # Dry-run validation against a scratch Postgres database
│   └── types/
│       ├── cli.ts               # CLI options type definitions
│       └── status.ts            # Database status type definitions
├── tests/
│   ├── smoke/
│   │   ├── scaffold.test.ts     # Package structure validation
│   │   ├── entrypoint.test.ts   # Entry point integration tests
│   │   └── build.test.ts        # Build output verification
│   └── modules/
│       ├── cli.test.ts          # CLI parser unit tests
│       ├── logger.test.ts       # Logger configuration tests
│       ├── status.test.ts       # Status module tests (mocked DB)
│       ├── deleteArticles.test.ts  # Deletion logic tests (mocked DB)
│       ├── backup.test.ts       # Backup module tests (mocked DB + real FS)
│       └── zipImport.test.ts    # Import module tests (real ZIPs + mocked DB)
├── package.json
├── tsconfig.json
├── jest.config.cjs
├── .env.example
├── .gitignore
└── README.md
```

### Key Design Patterns

- **CLI Argument Parsing:** Levenshtein distance for typo suggestions on unknown flags
- **Batch Processing:** Delete operations process articles in batches of 5000 with progress logging
- **Protected Articles:** Articles in `ArticleApproved` or `ArticleIsRelevant` tables are excluded from deletion
- **Topological Import:** ZIP import loads tables in `MODEL_LOAD_ORDER` so foreign key constraints are satisfied without disabling them
- **Date Sanitization:** ZIP import normalizes invalid dates to NULL with logged warnings
- **Boolean Coercion:** SQLite-style `"0"`/`"1"` boolean values are converted to Postgres booleans on import
- **Sequence Reset:** After import, all serial `id` sequences are reset to `MAX(id)` so new inserts do not collide
- **Schema Rebuild:** `--zip_file` and `--drop_db` both use `DROP SCHEMA public CASCADE` + `CREATE SCHEMA public` + `sequelize.sync()` to guarantee a clean state
- **Dry-Run Isolation:** `--dry_run` spawns a child process with `PG_DATABASE` overridden to a scratch DB name, so the parent process connection is never used for destructive operations
- **Logging:** Winston with environment-based transports (console in dev, file in prod)
- **Testing:** Jest with ts-jest, mocked dependencies at module boundaries

## Test Coverage

The package includes 146 comprehensive tests:

- **12** scaffold tests (package structure validation)
- **25** CLI parser tests (argument parsing, error handling)
- **20** logger tests (configuration, environment handling)
- **11** status module tests (database queries, protected IDs)
- **14** deleteArticles tests (batch processing, protected articles)
- **10** backup tests (ZIP creation, CSV export, cleanup)
- **24** zipImport tests (date normalization, topological load, sequence reset)
- **16** entrypoint tests (module loading, orchestration)
- **14** build tests (compilation verification, dist/ validation)

All tests use mocked database models (no real database required for testing).

## Dependencies

### Runtime
- `@newsnexus/db-models` - Sequelize database models (file dependency)
- `sequelize` - ORM for database access
- `winston` - Structured logging
- `dotenv` - Environment configuration
- `adm-zip` - ZIP extraction
- `archiver` - ZIP compression
- `csv-parser` - CSV parsing
- `json2csv` - CSV generation

### Development
- `typescript` - TypeScript compiler
- `ts-node` - TypeScript execution for development
- `jest` - Testing framework
- `ts-jest` - TypeScript support for Jest
- Type definitions for all dependencies

## License

ISC

## Contributing

This package is part of the NewsNexus12 monorepo. Follow the monorepo's contribution guidelines.
