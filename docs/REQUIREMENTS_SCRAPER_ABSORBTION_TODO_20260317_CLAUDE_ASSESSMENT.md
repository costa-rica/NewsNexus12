# Claude Assessment: Scraper Absorption Requirements

This document identifies the five most problematic concerns for implementing the scraper absorption plan defined in `REQUIREMENTS_SCRAPER_ABSORBTION_TODO_20260317.md`.

## 1. Missing worker-node dependencies

Phase 1 ports Cheerio scraping logic into worker-node, but `worker-node/package.json` has neither `axios` nor `cheerio` as dependencies. The legacy scraper at `NewsNexusUrlScraper01/src/cheerioScraper.ts` requires both. The requirements document never mentions installing them. This is a blocking prerequisite for Phase 1 that should be called out explicitly so the engineer does not discover it mid-implementation. Additionally, the legacy scraper uses a 15-second timeout and `maxRedirects: 5`, while the existing API scraper at `api/src/modules/analysis/scraper.ts` uses a 10-second timeout with no redirect config. The requirements should specify which timeout and redirect policy to adopt so the port produces a deliberate configuration rather than an accidental one.

## 2. ArticleContent one-row-per-article assumption is unenforced

The `ArticleContent` model at `db-models/src/models/ArticleContent.ts` defines `articleId` as `allowNull: false` with no unique constraint. The association in `_associations.ts` uses `Article.hasMany(ArticleContent)`, meaning multiple rows per article are structurally possible. The legacy scraper assumes one effective row per article — it calls `ArticleContent.findOne({ where: { articleId } })` and updates that single row. The state assigner in `stateAssignerJob.ts` does the same `findOne` lookup. Phase 2 specifies update-first persistence but never addresses what happens if duplicate rows already exist in production data. Before implementing Phase 2, the engineer should audit the production database for duplicates and either clean them up or add defensive ordering to `findOne` calls. The Phase 6 review mention of this issue comes too late.

### Recommendation: add a Phase 0 for the articleId uniqueness constraint

Audit production data for duplicate `ArticleContent` rows, clean them up, and add a unique constraint on `articleId` before any scraper code is written. Every subsequent phase assumes one row per article — enforcing it upfront eliminates an entire class of bugs rather than patching around it in Phase 2 and reviewing it again in Phase 6. Change the association from `Article.hasMany(ArticleContent)` to `Article.hasOne(ArticleContent)` to make the intent explicit at the model level.

## 3. Phase 3 portal scope is underspecified

Phase 3 requires a `Scrape Article Content` section in `/articles/automations` that "behaves like State Assigner." This requirement spans three packages: a new worker-node route, a new API proxy route in `api/src/routes/newsOrgs/automations.ts`, and a new React component in `portal/src/components/automations/`. The State Assigner section alone is 233 lines of TSX with form inputs, modal alerts, a job status panel, and tooltip-labeled controls. The requirements list only worker-node route tasks and a single automation bullet. There is no mention of the API proxy route or the portal component. If the intent is full parity with State Assigner UI, Phase 3 needs explicit tasks for adding the API proxy endpoint, creating the portal component, and wiring the same inputs and defaults. Without this, the phase will be underscoped.

### Recommendation: split Phase 3 into two commits

Do the worker-node route first as its own commit — the route can be tested independently with supertest before any other package is touched. Then add the API proxy endpoint in `automations.ts` and the portal React component as a second commit. This keeps each commit focused on one package and makes review easier.

## 4. Phase 4 state assigner coupling increases test complexity

Phase 4 inserts a scraper pre-step into `stateAssignerJob.ts` before the existing `selectArticles` and `processStateAssignmentsWithTimeout` flow. Today the state assigner job is tested through a dependency-injected `runLegacyWorkflow` function. Adding a scraper pre-step means the job handler now depends on a new module boundary (the enrichment service from Phase 2), its own database queries, and network I/O. The existing `stateAssignerJob.test.ts` will need substantial rework to mock the enrichment service while keeping the assignment flow real. The requirements say "extend or add a focused companion suite" but do not address whether the enrichment call should be injected as a dependency like `runLegacyWorkflow` is today. Without dependency injection for the scraper pre-step, testing becomes tightly coupled and brittle.

### Workaround: skip state assigner test modifications

The scraper enrichment service will already have standalone tests from Phases 1-3 covering happy path, failure handling, and persistence. The Phase 4 integration point is simple — call the enrichment service with candidate article IDs, then proceed with assignment regardless of outcome. If the integration is designed defensively (try/catch around the enrichment call, log and continue), the state assigner does not need new test coverage for scraper behavior. The existing `stateAssignerJob.ts` already handles the case where no `ArticleContent` row exists by falling back to `article.description` (line 230). That fallback path is already exercised by existing tests. Rather than reworking the state assigner test suite to mock a new enrichment dependency, rely on the standalone scraper tests and keep the integration seam minimal.

## 5. Puppeteer adds significant dependency weight with no install guidance

Phase 5 adds Puppeteer as a configurable fallback. Puppeteer pulls in a bundled Chromium binary (~300-400 MB), which significantly increases `npm install` time and disk usage for `worker-node`. The queue's single-concurrency design is intentional and handles Puppeteer jobs correctly — they run to completion before the next job starts, same as any other job. The real gap is that the requirements mention documenting runtime and deployment requirements but include no concrete tasks for it. The engineer should know upfront that the Ubuntu VM needs specific system libraries for headless Chrome (e.g., `libatk-bridge2.0`, `libdrm2`, `libxkbcommon0`), and whether to use Puppeteer's bundled Chromium or point `PUPPETEER_EXECUTABLE_PATH` to a system-installed browser. These are straightforward install tasks but should be specified in Phase 5 rather than left to discovery.
