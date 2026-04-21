# AGENTS.md

This file provides guidance to AI agents when working with code in this package.

## Project Overview

db-manager is a TypeScript CLI tool for managing the NewsNexus12 SQLite database. It handles article cleanup, database backups, and ZIP-based import/restore. It is part of the NewsNexus12 monorepo and depends on `@newsnexus/db-models` (local `file:../db-models` dependency).

## Development Commands

```bash
# Run directly (ts-node, no build required)
npm start

# Build TypeScript to dist/
npm run build

# Run tests (Jest, 146 tests)
npm test

# Clean compiled output
npm run clean
```

## CLI Usage

The tool is invoked via `npm start --` with flags. With no flags it displays a database status summary.

```bash
npm start                                        # Status only
npm start -- --create_backup                     # Create ZIP backup of all tables
npm start -- --zip_file /path/to/backup.zip      # Import ZIP into empty database
npm start -- --delete_articles                   # Delete unapproved articles >180 days old
npm start -- --delete_articles 90                # Delete unapproved articles >90 days old
npm start -- --delete_articles_trim 100          # Delete 100 oldest eligible articles
```

Flags can be combined. Execution order is always: backup, import, trim, delete, then status.

### Running in Production

The tool runs as user `limited_user`. To run in the background (survives logout):

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager && \
nohup sudo -u limited_user npm start -- --delete_articles > /dev/null 2>&1 &
echo $!
```

stdout/stderr are discarded because the app logs to its own Winston log file. Use `echo $!` to capture the PID for later monitoring with `ps -p <PID>`.

## Architecture

### Entry Point

`src/index.ts` — an IIFE that loads env, parses CLI args, connects to the database, runs operations in order, logs status, and closes the connection.

### Modules

| Module             | Path                            | Purpose                                                                  |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------ |
| **cli**            | `src/modules/cli.ts`            | CLI argument parser with Levenshtein distance typo suggestions           |
| **deleteArticles** | `src/modules/deleteArticles.ts` | Article deletion (batch size: 5000). Protects approved/relevant articles |
| **backup**         | `src/modules/backup.ts`         | ZIP/CSV backup creation (compression level 9)                            |
| **zipImport**      | `src/modules/zipImport.ts`      | ZIP import with date sanitization (invalid dates become NULL)            |
| **status**         | `src/modules/status.ts`         | Database status reporting                                                |
| **logger**         | `src/config/logger.ts`          | Winston logger configuration                                             |

### Key Behaviors

- **Article protection:** Articles in `ArticleApproved` or `ArticleIsRelevant` tables are never deleted.
- **Batch processing:** Deletions run in batches of 5000 with progress logging.
- **Default delete threshold:** 180 days.
- **Foreign keys:** Disabled during ZIP import, re-enabled in a `finally` block.
- **Date sanitization:** Invalid dates in imported CSVs are normalized to NULL with warnings.

## Logging

Uses Winston with file rotation. Logs are written based on `NODE_ENV`:

- **development:** Console only (colorized, `HH:mm:ss` format)
- **testing / production:** File only (`YYYY-MM-DD HH:mm:ss` format)

Log file: `{PATH_TO_LOGS}/{NAME_APP}.log` (currently `/home/limited_user/logs/NewsNexus12DbManager.log`)

Rotation: `LOG_MAX_SIZE` MB per file (default 5), `LOG_MAX_FILES` rotated files (default 5).

To follow logs in real time:

```bash
tail -f /home/limited_user/logs/NewsNexus12DbManager.log
```

## Environment Variables

Configured via `.env` in the package root. See `.env.example` for the template.

| Variable          | Required | Default | Purpose                                                |
| ----------------- | -------- | ------- | ------------------------------------------------------ |
| `NODE_ENV`        | Yes      | --      | `development`, `testing`, or `production`              |
| `NAME_APP`        | Yes      | --      | App name (used in log filename)                        |
| `PATH_TO_LOGS`    | Yes      | --      | Absolute path to logs directory                        |
| `LOG_MAX_SIZE`    | No       | 5       | Max log file size in MB                                |
| `LOG_MAX_FILES`   | No       | 5       | Max rotated log files                                  |
| `PATH_DATABASE`   | Yes      | --      | Absolute path to database directory                    |
| `NAME_DB`         | Yes      | --      | Database filename                                      |
| `PATH_DB_BACKUPS` | Yes\*    | --      | Backup output directory (\*only for `--create_backup`) |

## Database

- **Type:** Postgres via Sequelize 6
- `PS_` prefixed variables — Postgres database location (used by api and db-models)
- **Models:** Imported from `@newsnexus/db-models`. Key tables: `Article`, `ArticleApproved`, `ArticleIsRelevant`
- Models are initialized via `initModels()` from db-models

## Testing

Jest with ts-jest. Config in `jest.config.cjs`.

```bash
npm test                          # Run all tests
npx jest path/to/test.ts          # Run a single test file
```

Test suites are in `tests/smoke/` (4 suites) and `tests/modules/` (5 suites).
