![Logo](./docs/images/logoAndNameRound.png)

A Sequelize SQLite module for the NewsNexus12Db and microservices suite of applications.

## Build Instructions

To build the TypeScript source code and generate the dist/ directory for package distribution:

```bash
# Build the project (compile TypeScript to dist/)
npm run build
# Clean the dist/ directory
npm run clean
# Development mode with watch (rebuilds on file changes)
npm run dev
# Clean and build (used automatically before publishing)
npm run prepublishOnly
```

The build process will:

- Compile TypeScript source files from `src/` to JavaScript in `dist/`
- Generate `.d.ts` type declaration files for consuming TypeScript projects
- Create source maps for debugging

## Installation

1. `npm init -y`
2. `npm install sequelize sqlite3`

## Import to Other Apps

```bash
# Install as local file dependency
npm install file:../NewsNexus12Db
```

```javascript
const { initModels, sequelize } = require("@newsnexus/db-models");
initModels(); // <-- Initialize models DB in TS solution
sequelize.sync();
```

```typescript
// Import in TypeScript projects (with full type support)
import db from "@newsnexus/db-models";
const { Article, User, sequelize } = db;

// Or in JavaScript projects
const db = require("@newsnexus/db-models");
const { Article, User, sequelize } = db;
```

## Environmental Variables

- No .env file is needed becuase this package will use the .env vars from the project it is imported into.

## AI Approver V02 tables

- AI Approver V02 uses `AiApproverPromptVersionsV02`, `AiApproverRunsV02`, and `AiApproverArticlePredictionsV02`.
- V02 associations and load order are isolated from unrelated models.
- Install V02 tables with the dedicated db-manager command.
- Do not use general `sync({ alter: true })` or `sync({ force: true })` for V02 deployment.

## Weekly article flow tables

- `WeeklyArticleFlowRuns` is the authoritative run and recovery record.
- `NewsApiRequests.weeklyArticleFlowRunId` associates Google RSS requests with one weekly cohort.
- Install this additive schema with `npm -C db-manager run schema:weekly-article-flow` from the repository root.
- Do not use general Sequelize sync to deploy the weekly-flow schema.

## References

- [Database Overview](./docs/DATABASE_OVERVIEW.md): Describes the database package architecture, schema and relationships.
