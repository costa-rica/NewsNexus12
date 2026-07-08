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

## CLI Usage

The tool is invoked via `npm start --` with flags. With no flags it displays a database status summary.

```bash
npm start                                        # Status only
npm start -- --create_backup                     # Create ZIP backup of all tables
npm start -- --zip_file /path/to/backup.zip      # Import ZIP (drops and rebuilds schema first)
npm start -- --drop_db                           # Wipe all data and rebuild empty schema
npm start -- --dry_run --zip_file /path/to.zip   # Validate ZIP against scratch DB (live data untouched)
npm start -- --delete_articles                   # Delete unapproved articles >180 days old
npm start -- --delete_articles 90                # Delete unapproved articles >90 days old
npm start -- --delete_articles_trim 100          # Delete 100 oldest eligible articles
```

Flags can be combined (except `--dry_run` and `--drop_db`, which exit after completing). Execution order: backup, import, trim, delete, then status.

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
