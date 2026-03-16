# AGENT.md

This file provides guidance to the engineers or AI agents when working with code in this repository.

## Repository Overview

NewsNexus11 is a monorepo for a news aggregation and analysis platform. It has no formal monorepo tooling (no Lerna/Nx/Turborepo) — packages are linked via local `file:` dependencies.

## Packages

| Package           | Path             | Tech                                                                | Purpose                                                |
| ----------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| **db-models**     | `/db-models`     | Sequelize 6 + SQLite + TypeScript                                   | Shared database models (`@newsnexus/db-models`)        |
| **api**           | `/api`           | Express 5 + TypeScript                                              | REST API for articles, auth, analysis workflows        |
| **portal**        | `/portal`        | Next.js 16 (App Router, Turbopack) + Redux Toolkit + TailwindCSS v4 | Frontend dashboard                                     |
| **worker-python** | `/worker-python` | Flask 3                                                             | Queues Python microservices (deduper, location scorer) |
| **worker-node**   | `/worker-node`   | —                                                                   | Placeholder, not yet implemented                       |

**Dependency graph:** `portal → (HTTP) → api → db-models → SQLite ← worker-python`

## Build & Dev Commands

db-models must be built first — api depends on it via `file:../db-models`.

```bash
# Build (order matters)
cd db-models && npm run build
cd ../api && npm run build
cd ../portal && npm run build

# Dev servers (run in separate terminals)
cd db-models && npm run dev          # tsc --watch
cd api && npm run dev                # tsx watch, port 3000
cd portal && npm run dev             # next dev, port 3001
cd worker-python && source venv/bin/activate && flask run  # port 5000
```

## Testing & Linting

```bash
# API tests (Jest + Supertest, ~15 suites / 64 tests)
cd api && npm test
cd api && npm run test:watch
cd api && npm run test:endpoints     # smoke tests only

# Run a single test file
cd api && npx jest path/to/test.ts

# Portal lint (ESLint — strict, no `any` allowed)
cd portal && npm run lint
```

No test frameworks are configured for db-models, portal, or worker-python.

## Architecture Details

### db-models

- Sequelize models in `src/models/`, each file exports a class + `initModelName()` function
- `_connection.ts` — SQLite connection using `PATH_DATABASE` and `NAME_DB` env vars
- `_associations.ts` — all foreign keys and relationships (centralized)
- `_index.ts` — calls all init functions, sets up associations, exports everything
- Consuming apps call `initModels()` then `sequelize.sync()`
- ~30 models: Article, ArticleApproved, ArticleContent, ArticleDuplicateAnalysis, User, Report, State, Keyword, plus many-to-many contract tables

### api

- Entry: `src/server.ts` → `initializeDatabase()` → `runOnStartUp()` → `mountLegacyRouters()` → `app.listen()`
- App bootstrap: `src/app.ts` (CORS, morgan, cookie-parser, static files)
- Security middleware: `globalSecurity.ts` (input sanitization), `fileSecurity.ts` (path traversal), `rateLimiting.ts`
- 14+ routers under `src/routes/` covering articles, users, analysis workflows, news source integrations, downloads
- JWT authentication, Winston logging
- Jest config: `jest.config.cjs` (ts-jest, node env, 15s timeout)

### portal

- Next.js App Router with two route groups:
  - `(dashboard)` — authenticated pages with AppHeader + AppSidebar
  - `(full-width)` — auth pages (login, register) without dashboard chrome
- Redux Toolkit + redux-persist for state; use typed hooks `useAppDispatch`/`useAppSelector` from `src/store/hooks.ts`
- SVGs imported as React components via `@svgr/webpack` (configured for both Turbopack and Webpack in `next.config.ts`)
- Path alias: `@/*` → `./src/*`
- API base URL set via `NEXT_PUBLIC_API_BASE_URL` env var
- **Strict typing enforced** — ESLint prohibits `any`; use specific types, generics, or `unknown`

### worker-python

- Flask blueprints: Deduper (`/deduper`) and Index (`/`)
- Runs Python microservices (NewsNexusDeduper02, NewsNexusClassifierLocationScorer01) via `subprocess`
- In-memory job storage (resets on restart); job output streams to terminal
- Shares the same SQLite database as api

## Environment Variables

Each package reads from its own `.env`. Key variables:

- `PATH_DATABASE` / `NAME_DB` — SQLite database location (used by api and db-models)
- `JWT_SECRET` — API authentication
- `NEXT_PUBLIC_API_BASE_URL` — portal's API endpoint
- `NEXT_PUBLIC_MODE` — set to `"workstation"` to prefill login form in dev
- `PATH_TO_PYTHON_VENV`, `PATH_TO_MICROSERVICE_DEDUPER`, `PATH_TO_MICROSERVICE_LOCATION_SCORER` — worker-python paths

## Production

- Deployed on Ubuntu VM behind reverse proxy
- All services share the same SQLite database file

## Commit Message Guidance

### Guidelines

- Only generate the message for staged files/changes
- Title is lowercase, no period at the end.
- Title should be a clear summary, max 50 characters.
- Use the body (optional) to explain _why_, not just _what_.
- Bullet points should be concise and high-level.
- try to use ideal format, but if the commit has many "types" then

### Format

Try to use the ideal format. But if the commit is too broad or has too many different types, then use the borad format.

#### Ideal Format

```
<type>:<space><message title>

<bullet points summarizing what was updated>
```

#### Broad Format

```
<message title>

<bullet points summarizing what was updated>
```

#### Types for Ideal Format

| Type     | Description                           |
| -------- | ------------------------------------- |
| feat     | New feature                           |
| fix      | Bug fix                               |
| chore    | Maintenance (e.g., tooling, deps)     |
| docs     | Documentation changes                 |
| refactor | Code restructure (no behavior change) |
| test     | Adding or refactoring tests           |
| style    | Code formatting (no logic change)     |
| perf     | Performance improvements              |
