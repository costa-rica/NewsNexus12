---
date: 2026-04-27
origin: Claude Code Opus 4.7
---

# CTO Onboarding — NewsNexus12

## 1. Summary

NewsNexus12 is a monorepo for a news-aggregation and analysis platform. It ingests news articles (Google News RSS, NewsAPI, NewsData.io, GNews), persists them in a shared Postgres database via a Sequelize model package, exposes a REST API and a Next.js review portal, and runs analysis workflows (deduper, semantic scorer, location scorer, OpenAI-based state assigner, content scrapers) through two queue-backed worker services — one Node, one Python. There is no monorepo tooling; packages are wired through local `file:` dependencies and built in dependency order. The codebase is mid-migration from SQLite to Postgres (most heavy lifting landed in the last ~30 commits; see `docs/archived/`).

## 2. Tech stack

- **Languages:** TypeScript (Node 22), Python 3 (FastAPI service)
- **Backend:** Express 5 (`api`, `worker-node`), FastAPI 0.116 + uvicorn (`worker-python`)
- **Frontend:** Next.js 16 App Router + Turbopack, React 19, Redux Toolkit + redux-persist, TailwindCSS v4
- **Data:** Postgres 16 via Sequelize 6 (`pg`, `pg-hstore`); `psycopg[binary]` on the Python side
- **Auth:** JWT (`jsonwebtoken`), bcrypt
- **Scraping/AI:** Playwright + Puppeteer + cheerio, `@huggingface/transformers`, `sentence-transformers`, OpenAI SDK
- **Queue:** custom JSON-backed FIFO queue (concurrency 1) implemented per-worker in `worker-node/src/modules/queue/` and `worker-python/src/modules/queue/`
- **Logging:** Winston (TS), loguru (Python)
- **CI:** GitHub Actions, single workflow `.github/workflows/postgres-tests.yml` with a Postgres 16 service container, matrixed across `db-models`, `api`, `worker-node`, `db-manager`
- **Runtime target:** Ubuntu VM behind a reverse proxy (per `AGENTS.md`); no Dockerfiles, no IaC

## 3. Repository layout

```
api/             Express 5 REST API — auth, articles, reports, analysis proxy routes
portal/          Next.js 16 review dashboard (port 3001)
worker-node/     Express worker — Google RSS, semantic scorer, state assigner, content scraper
worker-python/   FastAPI worker — deduper, location scorer
db-models/       Shared Sequelize models, published locally as @newsnexus/db-models
db-manager/      CLI tool — backups, ZIP import, article cleanup
docs/            Project docs (postgres transition history in docs/archived/)
.github/         CI workflows
```

**Read first:** [AGENTS.md](AGENTS.md), [db-models/src/models/_associations.ts](db-models/src/models/_associations.ts), [api/src/app.ts](api/src/app.ts), [worker-node/AGENTS.md](worker-node/AGENTS.md), [worker-python/AGENTS.md](worker-python/AGENTS.md).

## 4. Architecture

```
                 ┌──────────────┐
                 │    portal    │  Next.js, port 3001
                 │  (Redux)     │
                 └──────┬───────┘
                        │ HTTP (NEXT_PUBLIC_API_BASE_URL)
                        ▼
                 ┌──────────────┐
                 │     api      │  Express 5, port 3000, JWT
                 │  ~25 routers │
                 └──┬─────┬─────┘
            HTTP   │     │   HTTP
        proxy ────┘       └──── proxy
                 ▼               ▼
        ┌─────────────┐   ┌──────────────┐
        │ worker-node │   │worker-python │
        │  port 3002  │   │  port 5000   │
        │  (queue=1)  │   │  (queue=1)   │
        └──────┬──────┘   └──────┬───────┘
               │                 │
               ▼                 ▼
        ┌─────────────────────────────┐
        │      Postgres 16            │
        │  (shared by all services)   │
        └─────────────────────────────┘
                ▲
                │  ts-node CLI
        ┌──────────────┐
        │  db-manager  │  backup / restore / cleanup
        └──────────────┘
```

- **Synchronous path:** portal → `api` for reads/writes against Postgres via `@newsnexus/db-models` ([api/src/server.ts](api/src/server.ts), routers in [api/src/routes/](api/src/routes/)).
- **Async path:** portal → `api` proxy routes (e.g. [api/src/routes/analysis/](api/src/routes/analysis/), [api/src/routes/newsOrgs/automations.ts](api/src/routes/newsOrgs/automations.ts)) → workers' queue-backed `start-job` endpoints. Workers return `202` + `jobId`; portal polls `/queue-info/latest-job?endpointName=…` and `/queue-info/check-status/:jobId`.
- **State:** All durable state is in Postgres. Per-worker job state is JSON files (`worker-python/queue-jobs.json` under `PATH_UTILTIES`; equivalent in `worker-node/src/modules/queue/jobStore.ts`). On restart, in-flight jobs reconcile to `failed`.
- **Concurrency:** each worker runs FIFO with global concurrency 1. Cancellation is cooperative (`AbortSignal` / `should_cancel`); child-process style jobs in worker-node use SIGTERM→SIGKILL.
- **Boundary discipline (worker-node):** routes validate input, resolve env, enqueue, return — workflow logic lives in `src/modules/jobs/` and `src/modules/article-content-02/` (see [worker-node/AGENTS.md](worker-node/AGENTS.md)).

## 5. Data model

Sequelize models live in [db-models/src/models/](db-models/src/models/) (~30 files). Foreign keys are centralized in [_associations.ts](db-models/src/models/_associations.ts); init order in [_loadOrder.ts](db-models/src/models/_loadOrder.ts). Consumers call `initModels()` then `sequelize.sync()`.

Most important entities:

- **Article** — canonical article record (URL, headline, publication, dates). Hub of the schema.
- **ArticleContents02** — article body storage. May contain multiple attempt rows per `articleId`; canonical-row selection logic in [worker-node/src/modules/article-content-02/repository.ts](worker-node/src/modules/article-content-02/repository.ts). Replaces legacy `ArticleContents` (removed).
- **ArticleApproved / ArticleIsRelevant / ArticleReviewed** — user-workflow tables; protected from cleanup deletion.
- **ArticleDuplicateAnalysis** — deduper output.
- **ArticleStateContract / ArticleStateContract02** — Article ↔ State M2M (v02 carries `promptId`, written by state assigner).
- **ArticleKeywordContract** — Article ↔ Keyword M2M, scored per `EntityWhoCategorizedArticle`.
- **Report**, **ArticleReportContract**, **ArticlesApproved02** — report grouping and approvals.
- **NewsArticleAggregatorSource**, **NewsApiRequest**, **NewsRssRequest**, **WebsiteDomain** — ingestion source tracking.
- **User**, **ArtificialIntelligence**, **EntityWhoCategorizedArticle / EntityWhoFoundArticle**, **Prompt**, **AiApproverPromptVersion / AiApproverArticleScore** — actors and AI metadata.

No formal migrations folder — schema is currently driven by `sequelize.sync()`. `db-manager` handles backup, ZIP import, and bulk article cleanup ([db-manager/src/modules/](db-manager/src/modules/)).

## 6. External integrations

| Service | Used by | Purpose | Auth | Configured via |
|---|---|---|---|---|
| OpenAI | worker-node (state assigner) | Article→state classification | API key | `KEY_OPEN_AI` |
| Google News RSS | worker-node (request-google-rss) | Ingest article candidates | none | `PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED` |
| NewsAPI / NewsData.io / GNews | api ([routes/newsOrgs/](api/src/routes/newsOrgs/)) | Ingest article candidates | API keys | per-route env vars |
| Hugging Face / sentence-transformers | worker-node (semantic-scorer), worker-python (deduper, location-scorer) | Local embedding models | none (local) | `PATH_TO_SEMANTIC_SCORER_DIR`, model cache |
| Publisher sites | worker-node (article-content-scraper-02) | Direct fetch + Playwright fallback | none | requires `npx playwright install chromium` |
| Postgres | all | Primary datastore | password | `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` (api/db-models also use `PS_` prefix per [AGENTS.md](AGENTS.md) — confirm) |
| SMTP | api (`nodemailer`) | Outbound email | per-deployment | dotenv |

All credentials are loaded from per-package `.env` files. There is no central secret manager.

## 7. Running it locally

Prereqs: Node 22, Python 3 with venv, Postgres 16 reachable.

```bash
# 1. Postgres env (each package's .env needs these; see docs/archived/ for setup guides)
PG_HOST=localhost PG_PORT=5432 PG_DATABASE=newsnexus_dev PG_USER=… PG_PASSWORD=…

# 2. Build shared package first — api/worker-node/db-manager depend on db-models via file:
(cd db-models && npm install && npm run build)
(cd db-manager && npm install && npm run build)

# 3. Install + run the rest
(cd api && npm install && npm run dev)               # :3000
(cd portal && npm install && npm run dev)            # :3001
(cd worker-node && npm install && npm run dev)       # :3002
(cd worker-node && npx playwright install chromium)  # for scraper fallback

# 4. Python worker
(cd worker-python && python -m venv venv && source venv/bin/activate \
  && pip install -r requirements.txt \
  && uvicorn src.main:app --reload --host 0.0.0.0 --port 5000)
```

Gotchas:

- Rebuild `db-models` after model changes — consumers import from `db-models/dist`.
- `worker-python` startup fails fast if `PATH_UTILTIES` (note the misspelling — it is the actual var name) or `NAME_AI_ENTITY_LOCATION_SCORER` is missing.
- Set `NEXT_PUBLIC_MODE=workstation` to prefill the portal login form.
- Portal ESLint forbids `any` — `npm run build` will fail otherwise.

## 8. Deployment

Per [AGENTS.md](AGENTS.md) and [db-manager/AGENTS.md](db-manager/AGENTS.md): production runs on an Ubuntu VM behind a reverse proxy as user `limited_user`, with logs under `/home/limited_user/logs/`. There is **no automated deploy pipeline in the repo** — no Dockerfile, no IaC, no deploy script. The only CI is `.github/workflows/postgres-tests.yml` which runs builds and tests against a Postgres 16 service container; it does not publish or deploy. The deploy mechanism (manual SSH? rsync? pull-and-restart?) is not documented in-tree — see open questions.

## 9. Testing

- **api:** Jest + supertest, ~15 suites / 64 tests; smoke split via `npm run test:endpoints`. Config [api/jest.config.cjs](api/jest.config.cjs).
- **db-manager:** Jest, 146 tests across `tests/smoke/` and `tests/modules/`.
- **worker-node:** Jest + supertest; route, module, and smoke tests under [worker-node/tests/](worker-node/tests/). Guidance in [docs/TEST_IMPLEMENTATION_NODE.md](docs/TEST_IMPLEMENTATION_NODE.md).
- **worker-python:** test fixtures present (recent commit `c5b75d1 test: update worker-python config fixtures`); harness not yet documented in AGENTS.md.
- **db-models / portal:** no test framework configured.
- **CI:** Postgres-backed matrix build+test for `db-models`, `api`, `worker-node`, `db-manager` on every push/PR.

Coverage is uneven — the Express API and the db-manager CLI are the best-tested surfaces; the portal has none, and worker-python coverage is thin relative to its workflows.

## 10. Active areas of work

Based on the last 30 commits:

1. **SQLite → Postgres migration.** Dominates recent history (`15539be feat: phase 1 postgres foundation`, `e3ee110 feat: advance postgres worker phase 2`, plus a flurry of `fix:` commits widening STRING→TEXT, fixing serial sequences, sanitizing ZIP-import data). Phase docs archived under [docs/archived/](docs/archived/) on 2026-04-21.
2. **CI bootstrap stabilization.** Commits `5733130`, `06e164f`, `0548a90`, `6e1c407` — getting the Postgres CI matrix reliable.
3. **db-manager hardening.** `de211c4 feat: add --dry_run validator and --drop_db command`, plus the unified portal-replenish import pipeline (`831f338`).
4. **Stale doc/code drift.** [db-models/AGENTS.md](db-models/AGENTS.md) and [worker-node/AGENTS.md](worker-node/AGENTS.md) still describe SQLite as the live store though the code has moved to Postgres — likely the next doc cleanup target.
5. **Article-content unification.** `ArticleContents02` is the active table; the legacy `ArticleContents` model has been removed. Scraper, state-assigner, and Google-RSS follow-up scraping all converge on `src/modules/article-content-02/` in worker-node.

## 11. Open questions for the project owner

- **Postgres env var naming.** [AGENTS.md](AGENTS.md) and [db-manager/AGENTS.md](db-manager/AGENTS.md) reference a `PS_`-prefixed convention, but [db-models/src/models/_connection.ts](db-models/src/models/_connection.ts) and CI use `PG_*`. Which is canonical? Are both supported intentionally?
- **Deployment.** How does code actually reach the Ubuntu VM today? Manual SSH, rsync, pull-and-restart? Is there a runbook? What is the rollback procedure beyond `git revert`?
- **Process supervision.** What runs `api`, `worker-node`, and `worker-python` in production — systemd, pm2, something else? AGENTS files don't say.
- **Reverse proxy.** Which proxy (nginx? caddy?), and where does its config live?
- **Schema management.** With no migrations folder, schema evolution relies on `sequelize.sync()` plus ad-hoc fix commits (`d5985d8`, `8c62e32`). Is a migrations tool planned for post-Postgres-cut-over?
- **Stale docs.** [db-models/AGENTS.md](db-models/AGENTS.md) still says "SQLite via Sequelize" and [worker-node/AGENTS.md](worker-node/AGENTS.md) refers to "shared SQLite-backed Sequelize model package" / `database.sqlite` — should these be rewritten as part of finishing the Postgres transition?
- **Secrets.** All packages read per-directory `.env` files. Is there a plan for centralized secret management, or is `.env`-on-the-VM the intended steady state?
- **Portal testing.** No tests, no type-coverage on critical Redux flows. Is there appetite for a Playwright/Vitest layer, or is portal considered low-risk?
- **Worker observability.** Job state lives in flat-file JSON per worker. At what scale does this become a liability — and is Redis/RQ/BullMQ on the roadmap?
- **`PATH_UTILTIES` typo.** Used as-is across worker-python and worker-node. Worth fixing, or kept frozen for compatibility?
