# @newsnexus/db-manager

Database management CLI tool for NewsNexus12 monorepo. Provides operations for database status reporting, article cleanup, backup creation, and database restoration from ZIP backups.

## Features

- **Database Status** - Query article counts, approval status, relevance ratings, and age metrics
- **Article Deletion** - Remove stale articles older than a configurable threshold (protects approved/relevant articles)
- **Article Trim** - Delete N oldest eligible articles by published date
- **Database Backup** - Create compressed ZIP files containing CSV exports of all database tables
- **Zip Import** - Import CSV data from ZIP backups back into the database with validation and error handling

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

# Backup configuration (required for --create_backup)
PATH_DB_BACKUPS=/absolute/path/to/backups
```

See `.env.example` for detailed descriptions of each variable.

## Usage

The CLI supports multiple operation flags that can be combined in a single execution:

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

Restore database from a ZIP backup (only works on empty database):

```bash
npm start -- --zip_file /path/to/backup.zip
```

**Note:** Import is skipped if the database already contains data (displays status only).

Run the import as the same OS user that will later run the NewsNexus12 services. On the production server that user is `limited_user`.

Recommended production workflow:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
npm start -- --zip_file /path/to/backup.zip
```

If the command must be launched from another account, run the process as `limited_user` instead of creating the database as a different user and changing ownership afterward:

```bash
sudo -u limited_user -H bash -lc 'cd /home/limited_user/applications/NewsNexus12/db-manager && npm start -- --zip_file /path/to/backup.zip'
```

Why this matters:

- SQLite may create temporary side files such as `newsnexus12.db-journal`, `newsnexus12.db-wal`, or `newsnexus12.db-shm`
- Importing as a different user can leave the database or side files in a state that later causes `SQLITE_READONLY`
- Changing ownership of only `newsnexus12.db` after the import may not fix those side files or related metadata

### Delete Old Articles

Remove articles older than N days (default: 180) that are not approved or marked relevant:

```bash
# Use default threshold (180 days)
npm start -- --delete_articles

# Specify custom threshold
npm start -- --delete_articles 90
npm start -- --delete_articles=90
```

- **Run in background on production (Ubuntu):** Use `nohup` so the process survives logout. Output is logged to the Winston log file, so stdout/stderr can be discarded. Capture the PID to check on it later.

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

Multiple flags can be combined in one execution:

```bash
npm start -- --create_backup --delete_articles 180 --delete_articles_trim 50
```

**Execution order:**
1. Create backup (if requested)
2. Import from ZIP (if requested and database is empty)
3. Trim articles (if requested)
4. Delete old articles (if requested)
5. Display status summary

## CLI Flags

| Flag | Argument | Description |
|------|----------|-------------|
| `--create_backup` | None | Create a ZIP backup of all database tables |
| `--zip_file` | Path | Import database from ZIP file (only if DB is empty) |
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
│   ├── config/
│   │   └── logger.ts            # Winston logger configuration
│   ├── modules/
│   │   ├── cli.ts               # CLI argument parser with Levenshtein suggestions
│   │   ├── status.ts            # Database status reporting
│   │   ├── deleteArticles.ts    # Article deletion operations (batch processing)
│   │   ├── backup.ts            # Database backup to ZIP/CSV
│   │   └── zipImport.ts         # ZIP import with date sanitization
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

- **CLI Argument Parsing:** Levenshtein distance for typo suggestions
- **Batch Processing:** Delete operations process articles in batches of 5000 with progress logging
- **Protected Articles:** Articles in `ArticleApproved` or `ArticleIsRelevant` tables are excluded from deletion
- **Date Sanitization:** ZIP import normalizes invalid dates to NULL with warnings
- **Foreign Key Safety:** Disables foreign keys during import, re-enables in finally block
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
- **24** zipImport tests (date normalization, foreign keys, error handling)
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
