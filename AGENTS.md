# AGENTS.md

This file provides guidance to the engineers or AI agents when working with code in this repository.

## Workflows

Workflows are named instruction files. When the operator invokes one by name, read the referenced file and follow it.

### plan-and-vet

See `docs/PLAN_AND_VET.md`.

### NickVault

For work involving the NickVault knowledge base, read and follow `docs/NICKVAULT_INSTRUCTIONS_MAC.md`. These instructions apply only to NickVault work and do not change the project's runtime behavior or engineering requirements.

## Repository Overview

NewsNexus12 is a monorepo for a news aggregation and analysis platform. It has no formal monorepo tooling (no Lerna/Nx/Turborepo) — packages are linked via local `file:` dependencies.

## Packages

| Package           | Path             | Tech                                                                | Purpose                                                |
| ----------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| **db-models**     | `/db-models`     | Sequelize 6 + Postgres + TypeScript                                 | Shared database models (`@newsnexus/db-models`)        |
| **api**           | `/api`           | Express 5 + TypeScript                                              | REST API for articles, auth, analysis workflows        |
| **portal**        | `/portal`        | Next.js 16 (App Router, Turbopack) + Redux Toolkit + TailwindCSS v4 | Frontend dashboard                                     |
| **worker-python** | `/worker-python` | Flask 3                                                             | Queues Python microservices (deduper, location scorer) |
| **worker-node**   | `/worker-node`   | Express 5 + TypeScript                                              | Queue-backed Node workflows and article scraping       |
| **db-manager**    | `/db-manager`    | TypeScript CLI + Winston + Sequelize 6                              | Database maintenance (article cleanup, backup, import) |

**Dependency graph:** `portal → (HTTP) → api → db-models → Postgres ← worker-python` and `portal → (HTTP) → api → worker-node → db-models`

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
- **Strict typing enforced** — ESLint prohibits `any`; use specific types, generics, or `unknown`

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

## Creating Markdown Files in docs/

### Filenames

The default naming pattern should be

- prefix date using the `YYYYMMDD_` format
- descriptive name in lowercase
- use "\_" in place of spaces

### YAML frontmatter

Every generated `.md` file will begin with a YAML frontmatter block delimited by `---` lines containing exactly these four keys:

```yaml
---
created_at: YYYY-MM-DDTHH:MM:SSZ
updated_at: YYYY-MM-DDTHH:MM:SSZ
created_by: <agent name> (<model>) <machine>
modified_by: <agent name> (<model>) <machine>
---
```

Rules:

- `created_at` / `updated_at` are UTC timestamps in ISO 8601 format: `YYYY-MM-DDTHH:MM:SSZ`. Use a 24-hour clock with zero-padded hours, minutes, and seconds; the trailing `Z` identifies UTC.
- `created_at` is set once, at file creation, and MUST NEVER be modified on later edits.
- `updated_at` is rewritten to the current UTC timestamp on every modification.
- `created_by` is set once, at file creation, and MUST NEVER be modified on later edits.
- `modified_by` is rewritten on every modification. On the very first write, set it to the same value as `created_by`.
- `modified_by` must be one line containing only the latest modifier.
- The `created_by` / `modified_by` value uses the format `<agent name> (<model>) <machine>`, lowercase only, with no email addresses and no angle brackets. The machine is mandatory so the operator can identify which host wrote the file.
- For a legacy document whose immutable `created_at` or `created_by` uses the former format, preserve those values. Apply the new format to `updated_at` and `modified_by` when editing it.

Acceptable examples:

```yaml
created_by: claude (opus-4.7) macbook-air
created_by: codex (gpt-5.5) fsdc-avatar09
modified_by: claude (haiku-4.5) macbook-air
```

### Archive Subfolder

- Really old docs are moved into `docs/archive/`.
- Organized into per-month subfolders named `YYYYMM/` (e.g. `202604/`).
- Not every month will have a folder — only months with archived files exist.
- Usually managed by the operator, not the AI coding agent.
- Agents: these files are kept for reference only; do not review them when scanning the project to build context.

## Human-readable documents

Treat these as strong operator preferences rather than strict requirements. If they conflict with a requested document structure, template, or established heading hierarchy, preserve the intended structure and adapt these preferences to fit.

- Use plain, human-readable language.
- Do not use bold text.
- Prefer bullets and numbering over long paragraphs.
- Keep each paragraph under 50 words.
- Multiple short paragraphs are acceptable.
- Keep sections focused and easy for the operator to scan and answer.

## Open questions created by agents

Use an open-questions section when the operator asks for one or when unresolved decisions would materially help the document.

- Make open questions the final section of the PRD, plan, or other agent-authored document.
- Use `## Open Questions` as the section heading.
- If the document's required structure uses different heading levels, adjust the hierarchy while preserving the pattern below.
- Give each question its own numbered `###` heading.
- Keep the numbered question heading description to 40 characters or fewer.
- Put the full question below its heading.
- Focus each question on one decision.
- Bullets are acceptable when they make choices or context easier to scan.
- Add a `#### Operator Response` subsection under every question.
- Leave the operator response empty unless an agent recommendation would be useful.
- When providing a recommendation, begin it with the agent's name in parentheses.
- Prefer recommendations under 30 words.
- Apply the human-readable document preferences to questions and recommendations.

Example:

```markdown
## Open Questions

### 1. Default date range

Should a report without dates cover the trailing seven days, including today?

#### Operator Response

(codex) Recommend the trailing seven days in the Toggl user timezone.
```

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
- append co-authored-by line(s) at the end of the commit message
  - format: `co-authored-by: <agent name> (<model>)`
  - examples:
    - `co-authored-by: claude (sonnet-4)`
    - `co-authored-by: codex (gpt-5)`
- never include emails or angle brackets (`< >`)
- use lowercase only
- if multiple agents contributed, add one line per agent (no bullets, just separate lines)

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
