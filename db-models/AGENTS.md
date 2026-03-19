# AGENTS.md

This file provides guidance to AGENT Code (AGENT.ai/code) when working with code in this repository.

## Project Overview

NewsNexus11Db is a TypeScript Sequelize SQLite database module designed for news aggregation and microservices architectures. It provides strongly-typed database models with comprehensive relationships for managing news articles, user workflows, and content categorization.

## Development Commands

### Build and Development

```bash
# Build TypeScript to JavaScript (dist/)
npm run build

# Development mode with file watching
npm run dev

# Clean compiled output
npm run clean

# Clean and build (used before publishing)
npm run prepublishOnly
```

### No Testing Framework

This project currently has no test framework configured. When adding tests, refer to the package.json to determine the appropriate testing setup.

## Architecture Overview

### Core Structure

- **Database**: SQLite via Sequelize ORM
- **Models**: Individual TypeScript classes in `src/models/`
- **Entry Point**: `src/index.ts` exports all models and utilities
- **Distribution**: Compiled JavaScript + TypeScript declarations in `dist/`

### Key Files

- `src/models/_connection.ts`: Database connection and configuration
- `src/models/_index.ts`: Model initialization and exports
- `src/models/_associations.ts`: All database relationships and foreign keys
- Each model follows the pattern: `src/models/ModelName.ts`

### Database Configuration

The database uses environment variables from the consuming application:

- `PATH_DATABASE`: Directory path for SQLite file (default: current directory)
- `NAME_DB`: Database filename (default: "database.sqlite")

## Model Patterns

### Standard Model Structure

All models follow this TypeScript pattern:

```typescript
export class ModelName extends Model<
  InferAttributes<ModelName>,
  InferCreationAttributes<ModelName>
> {
  declare id: CreationOptional<number>;
  // Additional fields...
}

export function initModelName() {
  ModelName.init(
    {
      // Field definitions...
    },
    {
      sequelize,
      tableName: "table_name",
      timestamps: true, // All tables include createdAt/updatedAt
    },
  );
  return ModelName;
}
```

### Model Relationships

Complex many-to-many and foreign key relationships are centrally managed in `_associations.ts`. Key relationship patterns include:

- Articles ↔ States (many-to-many through ArticleStateContract)
- Articles ↔ Keywords (many-to-many through ArticleKeywordContract)
- User workflows (ArticleApproved, ArticleReviewed, ArticleIsRelevant)
- News source tracking (NewsApiRequest, NewsRssRequest)

## Usage as Package

This module is designed to be imported into other applications:

```typescript
import db from "@newsnexus/db-models";
const { Article, User, sequelize } = db;

// Initialize models in consuming app
import { initModels } from "@newsnexus/db-models";
initModels();
sequelize.sync();
```

## Key Considerations

- All database models include automatic `createdAt` and `updatedAt` timestamps
- The package exports TypeScript declarations for full type safety in consuming applications
- Database initialization must be called before using models: `initModels()`
- Environment variables are inherited from the consuming application (no local .env needed)
- The `dist/` directory contains the compiled package ready for distribution
