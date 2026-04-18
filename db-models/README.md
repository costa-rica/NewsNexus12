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

## References

- [Database Overview](./docs/DATABASE_OVERVIEW.md): Describes the database package architecture, schema and relationships.
