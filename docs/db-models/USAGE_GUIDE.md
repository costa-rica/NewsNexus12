# Database Usage Guide

This guide explains how to use `@newsnexus/db-models` inside the NewsNexus12 monorepo. The package provides Sequelize models for SQLite, model associations, and TypeScript declarations.

## Package Description

- Package name: `@newsnexus/db-models`
- Monorepo directory: `db-models/`
- Source files: `db-models/src/`
- Build output: `db-models/dist/`
- One model class per table, with centralized initialization and associations
- Models include `createdAt` and `updatedAt` timestamps

## Project Structure

```text
db-models/
├── src/
│   ├── index.ts
│   └── models/
│       ├── _connection.ts
│       ├── _index.ts
│       ├── _associations.ts
│       └── <ModelName>.ts
├── dist/
├── docs/
└── package.json
```

## Using This Package in an App

Initialize the database before mounting routes or serving requests. In NewsNexus12 API, this happens during startup before `app.listen(...)`.

### Required startup sequence

1. Load environment variables.
2. Import `initModels` and `sequelize` from `@newsnexus/db-models`.
3. Call `initModels()`.
4. Call `await sequelize.authenticate()`.
5. Call `await sequelize.sync()`.
6. Mount DB-dependent routes.
7. Start the HTTP server.

### Initialization pattern

```javascript
require("dotenv").config();

const { initModels, sequelize } = require("@newsnexus/db-models");

async function bootstrap() {
  initModels();
  await sequelize.authenticate();
  await sequelize.sync();

  // mount routes and then start server
}

bootstrap();
```

## Why Order Matters

- `initModels()` initializes model definitions and applies associations.
- `sequelize.sync()` creates missing tables.
- If requests run before `sync`, you can get runtime errors such as `no such table`.
- If the DB file path is invalid or not writable, SQLite can fail with `SQLITE_CANTOPEN` or `EPERM`.

## Environment Variables

The package reads environment variables from the consuming app.

Required:

- `PATH_DATABASE`: directory for the SQLite database file
- `NAME_DB`: SQLite filename

Example:

- `PATH_DATABASE=/Users/nick/Documents/_databases/NewsNexus12/`
- `NAME_DB=newsnexus12.db`

Filesystem requirement:

1. `PATH_DATABASE` must exist or be creatable by the app process.
2. The process must have read/write permissions to that directory.
3. The DB file will be created at `PATH_DATABASE/NAME_DB` if it does not exist.

## Creating or Updating Schema

```javascript
await sequelize.sync();
await sequelize.sync({ alter: true }); // non-destructive schema adjustment
await sequelize.sync({ force: true }); // destructive: drops and recreates tables
```

Use `force: true` only for local resets or controlled migrations.

## Using Models

```javascript
const { Article, NewsApiRequest, User } = require("@newsnexus/db-models");

const articles = await Article.findAll({ limit: 10 });
const request = await NewsApiRequest.findOne({ where: { id: 1 } });
```

## Template (copy for each new model)

```ts
// src/models/Example.ts
import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
} from "sequelize";
import { sequelize } from "./_connection";

export class Example extends Model<
  InferAttributes<Example>,
  InferCreationAttributes<Example>
> {
  declare id: CreationOptional<number>;
  declare name: string;

  // FK example:
  // declare userId: ForeignKey<User["id"]>;
  // declare user?: NonAttribute<User>;
}

export function initExample() {
  Example.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      // userId: { type: DataTypes.INTEGER, allowNull: false }
    },
    {
      sequelize,
      tableName: "examples",
      timestamps: true,
    },
  );
  return Example;
}
```

## Example src/models/\_index.ts

```ts
// sample of src/models/_index.ts
import { sequelize } from "./_connection";

import { initExample, Example } from "./Example";

import { applyAssociations } from "./_associations";

/** Initialize all models and associations once per process. */
export function initModels() {
  initExample();
  applyAssociations();

  return {
    sequelize,
    Example,
  };
}

// 👇 Export named items for consumers
export { sequelize, Example };
```

## Database Configuration

- Database engine: SQLite (through Sequelize ORM)
- Environment variables: `PATH_DATABASE`, `NAME_DB`
- No package-local `.env` required
