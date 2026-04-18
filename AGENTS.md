# AGENTS.md

This file provides guidance to the engineers or AI agents when working with code in this repository.

## Repository Overview

NewsNexus12 is a monorepo for a news aggregation and analysis platform. It has no formal monorepo tooling (no Lerna/Nx/Turborepo) — packages are linked via local `file:` dependencies.

## Packages

| Package           | Path             | Tech                                                                | Purpose                                                |
| ----------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| **db-models**     | `/db-models`     | Sequelize 6 + SQLite + TypeScript                                   | Shared database models (`@newsnexus/db-models`)        |
| **api**           | `/api`           | Express 5 + TypeScript                                              | REST API for articles, auth, analysis workflows        |
| **portal**        | `/portal`        | Next.js 16 (App Router, Turbopack) + Redux Toolkit + TailwindCSS v4 | Frontend dashboard                                     |
| **worker-python** | `/worker-python` | Flask 3                                                             | Queues Python microservices (deduper, location scorer) |
| **worker-node**   | `/worker-node`   | Express 5 + TypeScript                                              | Queue-backed Node workflows and article scraping       |
| **db-manager**    | `/db-manager`    | TypeScript CLI + Winston + Sequelize 6                              | Database maintenance (article cleanup, backup, import) |

**Dependency graph:** `portal → (HTTP) → api → db-models → SQLite ← worker-python` and `portal → (HTTP) → api → worker-node → db-models`

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
cd worker-node && npm run dev                              # port 3002 by default
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

# Worker-node build/tests
cd worker-node && npm run build
cd worker-node && npm test
```

No test frameworks are configured for db-models, portal, or worker-python. db-manager uses Jest (146 tests).

## Architecture Details

### db-models

- Sequelize models in `src/models/`, each file exports a class + `initModelName()` function
- `_connection.ts` — SQLite connection using `PATH_DATABASE` and `NAME_DB` env vars
- `_associations.ts` — all foreign keys and relationships (centralized)
- `_index.ts` — calls all init functions, sets up associations, exports everything
- Consuming apps call `initModels()` then `sequelize.sync()`
- ~30 models: Article, ArticleApproved, ArticleContents02, ArticleDuplicateAnalysis, User, Report, State, Keyword, plus many-to-many contract tables

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

### worker-node

- Express worker service with queue-backed job starter routes
- Owns `request-google-rss`, `semantic-scorer`, `state-assigner`, and `article-content-scraper-02`
- Uses `ArticleContents02` as the single article-content table
- `requestGoogleRss` now seeds or follows up into `ArticleContents02`
- Portal and state assigner both rely on the new `article-content-scraper-02` flow

## Environment Variables

Each package reads from its own `.env`. Key variables:

- `PATH_DATABASE` / `NAME_DB` — SQLite database location (used by api and db-models)
- `JWT_SECRET` — API authentication
- `NEXT_PUBLIC_API_BASE_URL` — portal's API endpoint
- `NEXT_PUBLIC_MODE` — set to `"workstation"` to prefill login form in dev
- `PATH_TO_PYTHON_VENV`, `PATH_TO_MICROSERVICE_DEDUPER`, `PATH_TO_MICROSERVICE_LOCATION_SCORER` — worker-python paths
- `PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED`, `PATH_TO_STATE_ASSIGNER_FILES`, `KEY_OPEN_AI` — important worker-node workflow settings

## Production

- Deployed on Ubuntu VM behind reverse proxy
- All services share the same SQLite database file

## Commit Message Guidance

### Guidelines

- Only generate the message for staged files/changes
- Title is lowercase, no period at the end.
- Title should be a clear summary, max 50 characters.
- Use the body to explain _why_ and the main areas changed, not just _what_.
- Bullet points should be concise and high-level.
- Try to use the ideal format. But if the commit is too broad or has too many different types, then use the borad format.
- When committing changes from TODO or task list that is already part of the repo and has phases, make refernce to the file and phase instead of writing a long commit message.
- Add a commit body whenever the staged change is not trivially small.
- A body is expected when the commit:
  - touches more than 3 files
  - touches more than one package or app
  - includes both implementation and tests
  - adds a new route, component, workflow, or integration point
- For broader commits, the title can stay concise, but the body should summarize the main change areas so a reader can understand scope without opening the diff.
- Do not use the body as a file inventory. Summarize the logical changes in 2-5 bullets.

### Format

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

### Body expectations

- Small single-purpose commits may omit the body if the title is fully clear.
- Multi-file or cross-package commits should usually include 2-5 bullets.
- Good body bullets summarize change areas such as:
  - new UI section and status handling
  - new API proxy route and validation
  - added tests for the new route
- If the staged changes span portal, api, and worker code, the body should mention each area that changed.
- include a "co-authored-by:" at the end of the commit, with the ai agent name and model being used.
  - Do not include `<noreply@anthropic.com>`
  - keep it all lower case

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
