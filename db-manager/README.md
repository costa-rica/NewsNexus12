# @newsnexus/db-manager

Database management CLI tool for NewsNexus12 monorepo. Provides operations for database status reporting, article cleanup, backup creation, database restoration from ZIP backups, schema reset, and dry-run validation against a scratch database.

## Features

- **Database Status** - Query article counts, approval status, relevance ratings, and age metrics
- **Article Deletion** - Remove stale articles older than a configurable threshold (protects approved/relevant articles)
- **Article Trim** - Delete N oldest eligible articles by published date
- **No-State Article Deletion** - Preview or delete articles whose latest AI state assignment resolves to `No state`
- **Retired-Source Article Deletion** - Preview or delete articles found by retired aggregator sources
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
npm start -- --clear_duplicate_analyses           # Clear duplicate-analysis rows in bounded batches
npm start -- --zip_file /path/to/backup.zip      # Import ZIP (drops and rebuilds schema first)
npm start -- --drop_db                           # Wipe all data and rebuild empty schema
npm start -- --dry_run --zip_file /path/to.zip   # Validate ZIP against scratch DB (live data untouched)
npm start -- --delete_articles                   # Delete unapproved articles >180 days old
npm start -- --delete_articles 90                # Delete unapproved articles >90 days old
npm start -- --delete_articles_trim 100          # Delete 100 oldest eligible articles
npm start -- --delete_articles_no_state --dry_run # Preview No state AI-assigned article deletion
npm start -- --delete_articles_no_state 100       # Delete 100 eligible No state AI-assigned articles
npm start -- --delete_articles_no_state           # Delete all eligible No state AI-assigned articles
npm start -- --delete_articles_retired_sources --dry_run # Preview retired-source article deletion
npm start -- --delete_articles_retired_sources 100       # Delete 100 eligible retired-source articles
npm start -- --delete_articles_retired_sources           # Delete all eligible retired-source articles
```

Flags can be combined (except `--dry_run` and `--drop_db`, which exit after completing). Execution order: duplicate-analysis cleanup, backup, import, trim, delete, no-state delete, retired-sources delete, then status.

## AI Approver V02 Schema Installer

The dedicated installer creates or validates only the three AI Approver V02 tables:

```bash
npm run schema:ai-approver-v02
```

It does not use `force` or `alter`. It rejects partial or incompatible existing V02 tables before creating an absent table.

See `../docs/ai-appover-v02/20260723_ai_approver_v02_schema_operations.md` for backup prerequisites, production usage, verification queries, and rollback.

## Weekly Article Flow Schema Installer

The dedicated installer creates or validates the additive weekly-run table and nullable `NewsApiRequests.weeklyArticleFlowRunId` relationship:

```bash
npm run schema:weekly-article-flow
```

It rejects incompatible existing definitions and does not use `force` or `alter`. Run the disposable PostgreSQL integration suite with `npm run test:schema-weekly-article-flow`.

This schema supports the coordinator under `../ops/weekly-article-flow`. Install it as a separate deployment step before any development canary or production run.

## CLI Flags

| Flag | Argument | Description |
|------|----------|-------------|
| `--create_backup` | None | Create a ZIP backup with CSV exports and a versioned hash manifest |
| `--clear_duplicate_analyses` | None | Delete all duplicate-analysis rows in bounded batches without changing the table or sequence |
| `--zip_file` | Path | Full replenish: drop schema, import ZIP, reset sequences |
| `--drop_db` | None | Wipe all data and rebuild empty schema |
| `--dry_run` | None (requires `--zip_file`, `--delete_articles_no_state`, or `--delete_articles_retired_sources`) | Validate a ZIP against a scratch DB, preview no-state deletion, or preview retired-source deletion |
| `--delete_articles` | Days (optional) | Delete articles older than N days (default: 180) |
| `--delete_articles_trim` | Count | Delete N oldest eligible articles |
| `--delete_articles_no_state` | Count (optional) | Delete articles whose latest AI state assignment resolves to `No state` |
| `--delete_articles_retired_sources` | Count (optional) | Delete articles found by retired aggregator sources (`NewsAPI`, `GNews`, `NewsData.IO`) |

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
│   ├── index.ts                 # Main entry point and runDbManager orchestration
│   ├── lib.ts                   # Library entry point (importable by other packages)
│   ├── config/
│   │   └── logger.ts            # Winston logger configuration
│   ├── modules/
│   │   ├── cli.ts               # CLI argument parser with Levenshtein suggestions
│   │   ├── status.ts            # Database status reporting
│   │   ├── deleteArticles.ts    # Article deletion operations (batch processing)
│   │   ├── deleteArticlesNoState.ts # Preview/delete No state AI-assigned articles
│   │   ├── deleteArticlesRetiredSources.ts # Preview/delete retired-source articles
│   │   ├── backup.ts            # Database backup to ZIP/CSV
│   │   ├── zipImport.ts         # ZIP import: schema rebuild, topological load, sequence reset
│   │   ├── installAiApproverV02Schema.ts # Dedicated V02 schema validation and installation
│   │   └── dryRunValidator.ts   # Dry-run validation against a scratch Postgres database
│   ├── standalone/
│   │   └── installAiApproverV02Schema.ts # AI Approver V02 schema command
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
│       ├── deleteArticlesNoState.test.ts # No-state deletion tests (mocked DB)
│       ├── deleteArticlesRetiredSources.test.ts # Retired-source deletion tests (mocked DB)
│       ├── indexRouting.test.ts # CLI routing tests (mocked modules)
│       ├── backup.test.ts       # Backup module tests (mocked DB + real FS)
│       └── zipImport.test.ts    # Import module tests (real ZIPs + mocked DB)
├── package.json
├── tsconfig.json
├── jest.config.cjs
├── .env.example
├── .gitignore
└── README.md
```
