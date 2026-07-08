# AGENTS.md

This file provides guidance to AI agents when working with code in this package.

## Project Overview

db-manager is a TypeScript CLI tool for managing the NewsNexus12 Postgres database. It handles article cleanup, database backups, ZIP-based import/restore, schema reset, and dry-run import validation. It is part of the NewsNexus12 monorepo and depends on `@newsnexus/db-models` (local `file:../db-models` dependency).

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
npm start -- --delete_articles_no_state --dry_run # Preview deletion of No state AI-assigned articles
npm start -- --delete_articles_no_state 100       # Delete 100 eligible No state AI-assigned articles
npm start -- --delete_articles_no_state           # Delete all eligible No state AI-assigned articles
```

Flags can be combined. Execution order is always: backup, import, trim, delete, no-state delete, then status.

`--dry_run` is valid with `--zip_file` for scratch database import validation, or with `--delete_articles_no_state` for a read-only no-state deletion preview. `--dry_run` alone is invalid.

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

`src/index.ts` — exports `runDbManager(args)` and runs it when invoked as the CLI. It loads env, parses CLI args, connects to the database, runs operations in order, logs status, and closes the connection.

### Modules

| Module             | Path                            | Purpose                                                                  |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------ |
| **cli**            | `src/modules/cli.ts`            | CLI argument parser with Levenshtein distance typo suggestions           |
| **deleteArticles** | `src/modules/deleteArticles.ts` | Article deletion (batch size: 5000). Protects approved/relevant articles |
| **deleteArticlesNoState** | `src/modules/deleteArticlesNoState.ts` | Preview/delete articles whose latest AI state assignment resolves to `No state` |
| **backup**         | `src/modules/backup.ts`         | ZIP/CSV backup creation (compression level 9)                            |
| **zipImport**      | `src/modules/zipImport.ts`      | ZIP import: schema rebuild, topological load, sequence reset             |
| **dryRunValidator** | `src/modules/dryRunValidator.ts` | Dry-run validation against a scratch Postgres database                 |
| **status**         | `src/modules/status.ts`         | Database status reporting                                                |
| **logger**         | `src/config/logger.ts`          | Winston logger configuration                                             |

### Key Behaviors

- **Article protection:** Articles in `ArticleApproved` or `ArticleIsRelevant` tables are never deleted.
- **No-state deletion protection:** `--delete_articles_no_state` protects articles with any `ArticleIsRelevant`, `ArticleApproved`, `ArticlesApproved02`, or `ArticleReportContract` row.
- **Batch processing:** Deletions run in batches of 5000 with progress logging.
- **Default delete threshold:** 180 days.
- **Topological import:** ZIP import loads tables in `MODEL_LOAD_ORDER` so foreign key constraints are satisfied without disabling them; orphaned rows (legacy SQLite data) are skipped with warnings.
- **Date sanitization:** Invalid dates in imported CSVs are normalized to NULL with warnings.
- **Boolean coercion:** SQLite-style `"0"`/`"1"` boolean values are converted to Postgres booleans on import.
- **Sequence reset:** After import, all serial `id` sequences are reset to `MAX(id)` so new inserts do not collide.
- **Schema rebuild:** `--zip_file` and `--drop_db` both use `DROP SCHEMA public CASCADE` + `CREATE SCHEMA public` + `sequelize.sync()` to guarantee a clean state, then re-grant `PG_APP_ROLE` if configured.
- **Dry-run isolation:** `--dry_run` spawns a child process with `PG_DATABASE` overridden to a scratch DB name (`newsnexus_dry_run_<timestamp>`), so the parent process connection is never used for destructive operations. The scratch DB is dropped even if the import fails.
- **No-state dry run:** `--delete_articles_no_state --dry_run` is read-only against the configured database and logs candidate counts, protection exclusions, reason-code breakdown, and sample rows.

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

| Variable          | Required | Default  | Purpose                                                |
| ----------------- | -------- | -------- | ------------------------------------------------------ |
| `NODE_ENV`        | Yes      | --       | `development`, `testing`, or `production`              |
| `NAME_APP`        | Yes      | --       | App name (used in log filename)                        |
| `PATH_TO_LOGS`    | Yes      | --       | Absolute path to logs directory                        |
| `LOG_MAX_SIZE`    | No       | 5        | Max log file size in MB                                |
| `LOG_MAX_FILES`   | No       | 5        | Max rotated log files                                  |
| `PG_HOST`         | Yes      | --       | Postgres host                                          |
| `PG_PORT`         | Yes      | --       | Postgres port                                          |
| `PG_DATABASE`     | Yes      | --       | Postgres database name                                 |
| `PG_USER`         | Yes      | --       | Postgres user                                          |
| `PG_PASSWORD`     | Yes      | --       | Postgres password                                      |
| `PG_SCHEMA`       | No       | `public` | Postgres schema                                        |
| `PG_APP_ROLE`     | No       | --       | App role re-granted access after schema rebuild        |
| `PATH_DB_BACKUPS` | Yes\*    | --       | Backup output directory (\*only for `--create_backup`) |

## Database

- **Type:** Postgres via Sequelize 6
- `PG_` prefixed variables — Postgres database location (used by api and db-models)
- **Models:** Imported from `@newsnexus/db-models`. Key tables: `Article`, `ArticleApproved`, `ArticleIsRelevant`
- Models are initialized via `initModels()` from db-models

## Testing

Jest with ts-jest. Config in `jest.config.cjs`.

```bash
npm test                          # Run all tests
npx jest path/to/test.ts          # Run a single test file
```

Test suites are in `tests/smoke/` (3 suites) and `tests/modules/` (6 suites). All tests use mocked database models — no real database is required.
