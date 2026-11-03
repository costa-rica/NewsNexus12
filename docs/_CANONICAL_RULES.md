---
created_at: 2026-11-03T19:36:12Z
updated_at: 2026-11-03T19:49:01Z
created_by: nick
modified_by: claude (opus-5.5) nicksmacbookair
---

# Canonical Project Rules

## Workflows

### NickVault

For work involving the NickVault knowledge base, read and follow `docs/NICKVAULT_INSTRUCTIONS_MAC.md`. These instructions apply only to NickVault work and do not change the project's runtime behavior or engineering requirements.

## Repository Overview

NewsNexus12 is a monorepo for a news aggregation and analysis platform. It has no formal monorepo tooling (no Lerna/Nx/Turborepo) — packages are linked via local `file:` dependencies.

## Packages

| Package       | Path             | Tech                                                                | Purpose                                                |
| ------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| db-models     | `/db-models`     | Sequelize 6 + Postgres + TypeScript                                 | Shared database models (`@newsnexus/db-models`)        |
| api           | `/api`           | Express 5 + TypeScript                                              | REST API for articles, auth, analysis workflows        |
| portal        | `/portal`        | Next.js 16 (App Router, Turbopack) + Redux Toolkit + TailwindCSS v4 | Frontend dashboard                                     |
| worker-python | `/worker-python` | Flask 3                                                             | Queues Python microservices (deduper, location scorer) |
| worker-node   | `/worker-node`   | Express 5 + TypeScript                                              | Queue-backed Node workflows and article scraping       |
| db-manager    | `/db-manager`    | TypeScript CLI + Winston + Sequelize 6                              | Database maintenance (article cleanup, backup, import) |

Dependency graph: `portal → (HTTP) → api → db-models → Postgres ← worker-python` and `portal → (HTTP) → api → worker-node → db-models`

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

No test frameworks are configured for db-models, portal, or worker-python. db-manager uses Jest (201 tests).

## Architecture Details

AI Approver V02 is the only live AI Approver workflow. Its runtime is under `worker-python/src/modules/ai_approver_v02/`, and its operator-facing routes use `/ai-approver-v02`.

### db-models

- Sequelize models in `src/models/`, each file exports a class + `initModelName()` function
- `_connection.ts` — Postgres connection `PS_` environmental variables.
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
- Strict typing enforced — ESLint prohibits `any`; use specific types, generics, or `unknown`

### worker-python

- Flask blueprints: Deduper (`/deduper`) and Index (`/`)
- Runs Python microservices (NewsNexusDeduper02, NewsNexusClassifierLocationScorer01) via `subprocess`
- In-memory job storage (resets on restart); job output streams to terminal
- Shares the same Postgres database as api

### worker-node

- Express worker service with queue-backed job starter routes
- Owns `request-google-rss`, `semantic-scorer`, `state-assigner`, and `article-content-scraper-02`
- Uses `ArticleContents02` as the single article-content table
- `requestGoogleRss` now seeds or follows up into `ArticleContents02`
- Portal and state assigner both rely on the new `article-content-scraper-02` flow

## Environment Variables

Each package reads from its own `.env`. Key variables:

- `PS_` prefixed variables — Postgres database location (used by api and db-models)
- `JWT_SECRET` — API authentication
- `NEXT_PUBLIC_API_BASE_URL` — portal's API endpoint
- `NEXT_PUBLIC_MODE` — set to `"workstation"` to prefill login form in dev
- `PATH_TO_PYTHON_VENV`, `PATH_TO_MICROSERVICE_DEDUPER`, `PATH_TO_MICROSERVICE_LOCATION_SCORER` — worker-python paths
- `PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED`, `PATH_TO_STATE_ASSIGNER_FILES`, `USE_OPEN_AI_API`, optional `KEY_OPEN_AI`, `STATE_ASSIGNER_MODEL_NAME`, `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` — important worker-node workflow settings

## Production

- Deployed on Ubuntu VM behind reverse proxy

## Markdown Frontmatter Addenda

These supplement the YAML frontmatter rules in `AGENTS.md`.

- `modified_by` must be one line containing only the latest modifier.
- For a legacy document whose immutable `created_at` or `created_by` uses the former format, preserve those values. Apply the new format to `updated_at` and `modified_by` when editing it.
