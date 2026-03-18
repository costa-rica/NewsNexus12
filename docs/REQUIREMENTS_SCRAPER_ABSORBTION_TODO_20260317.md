# Requirements: Scraper Absorbtion

This document is a phased todo list for absorbing `NewsNexusUrlScraper01` into NewsNexus11. The intended end state is a reusable worker-node scraper job/module that can be run independently, while also being invoked as a bounded pre-step before the AI state assigner processes articles.

The standalone scraper flow is a requirement. In the `/articles/automations` section, add a `Scrape Article Content` section that behaves like `State Assigner`, using the same inputs and the same default inputs.

## Phase 1. Create the worker-node scraper module foundation

- [ ] Create a new article-content scraping module area in `worker-node/src/modules/article-content/`.
- [ ] Port the legacy Cheerio scraping logic into a worker-node helper module.
- [ ] Adapt imports and types from `newsnexus10db` to `@newsnexus/db-models`.
- [ ] Add clear result types for scrape success, failure, and error messaging.
- [ ] Add minimum usable content rules so blank or too-short content is treated as a failed scrape.
- [ ] Reuse worker-node logging patterns instead of `console.log`.
- [ ] Keep the initial implementation Cheerio-only.
- [ ] Do not add Puppeteer in this phase.

### Phase 1 tests

- [ ] Add module tests under `worker-node/tests/modules/` using `*.test.ts` naming.
- [ ] Follow `docs/TEST_IMPLEMENTATION_NODE.md` guidance:
  1. Keep tests behavior-focused.
  2. Mock network boundaries at the module edge.
  3. Cover one happy path and at least one failure path.
  4. Reset mocks between tests.
- [ ] Add a test file for the Cheerio scraper helper.
- [ ] Verify a successful scrape returns normalized content above the minimum threshold.
- [ ] Verify a short-content scrape is treated as failure.
- [ ] Verify an HTTP/network failure is treated as failure with stable error handling.

### Phase 1 engineer checkpoint

1. Run:
   - `npm -C worker-node test -- scraper`
   - `npm -C worker-node test`
2. If all tests pass:
   - [ ] Check off completed Phase 1 tasks in this document.
   - [ ] Commit all changes for Phase 1.
3. Do not continue to Phase 2 until the commit is complete.

## Phase 2. Add persistence and idempotent enrichment behavior

- [ ] Create a worker-node enrichment service that accepts a bounded list of target article IDs or article records.
- [ ] Query `Articles` and `ArticleContents` through `@newsnexus/db-models`.
- [ ] Define and implement the scrape eligibility rules:
  1. No `ArticleContents` row exists.
  2. Existing content is blank or below the usable threshold.
  3. `scrapeStatusCheerio` is `null`.
  4. Existing content needs retry behavior approved by the rules.
- [ ] Implement update-first persistence:
  1. Update the existing `ArticleContents` row when present.
  2. Create a row only when none exists.
- [ ] Persist `scrapeStatusCheerio` accurately for success and failure.
- [ ] Ensure the service skips articles with no URL.
- [ ] Return a structured summary:
  1. Articles considered.
  2. Articles skipped.
  3. Successful scrapes.
  4. Failed scrapes.
  5. Updated rows.
  6. Created rows.

### Phase 2 tests

- [ ] Add module tests under `worker-node/tests/modules/` for the enrichment service.
- [ ] Follow `docs/TEST_IMPLEMENTATION_NODE.md` guidance:
  1. Mock DB boundaries explicitly.
  2. Keep internal business logic real.
  3. Verify meaningful side effects, not implementation trivia.
- [ ] Verify an article with no `ArticleContents` row gets a new row created after a successful scrape.
- [ ] Verify an article with an existing row gets updated instead of creating a duplicate row.
- [ ] Verify an article with no URL is skipped and counted correctly.
- [ ] Verify a scrape failure marks `scrapeStatusCheerio` as failed and does not falsely report success.
- [ ] Verify summary counts match the processed outcomes.

### Phase 2 engineer checkpoint

1. Run:
   - `npx jest worker-node/tests/modules/<new-enrichment-test-file>.test.ts`
   - `npm -C worker-node test`
2. If all tests pass:
   - [ ] Check off completed Phase 2 tasks in this document.
   - [ ] Commit all changes for Phase 2.
3. Do not continue to Phase 3 until the commit is complete.

## Phase 3. Expose the scraper as its own worker-node job, route, and automation entry

- [ ] Add a dedicated job module such as `worker-node/src/modules/jobs/articleContentScraperJob.ts`.
- [ ] Make the job reusable so it can be called directly by a route and internally by other workflows.
- [ ] Add a dedicated route such as `worker-node/src/routes/articleContentScraper.ts`.
- [ ] Validate request input for bounded scraping targets.
- [ ] Match the scraper route inputs to the `State Assigner` inputs.
- [ ] Match the scraper route default inputs to the `State Assigner` defaults.
- [ ] Use the existing queue engine patterns for enqueueing the scraper job.
- [ ] Add environment/config handling only if required for this job.
- [ ] Return queued job metadata consistent with other worker-node routes.
- [ ] Register the route in `worker-node/src/app.ts`.
- [ ] Add a required `Scrape Article Content` section in `/articles/automations`.
- [ ] Make the `/articles/automations` `Scrape Article Content` section behave like `State Assigner`.
- [ ] Wire the `/articles/automations` `Scrape Article Content` section to the new standalone scraper endpoint.

### Phase 3 tests

- [ ] Add module tests for the new scraper job handler in `worker-node/tests/modules/`.
- [ ] Add route contract tests in `worker-node/tests/routes/`.
- [ ] Follow `docs/TEST_IMPLEMENTATION_NODE.md` guidance:
  1. Build a minimal local Express app per route suite.
  2. Import the router after mocks are declared when mocking dependencies.
  3. Assert status code, response shape, and key side effects.
- [ ] Verify the job handler passes expected arguments into the underlying scraper workflow dependency.
- [ ] Verify the route validates invalid request bodies correctly.
- [ ] Verify the route enqueues the scraper job and returns `202`.
- [ ] Verify the queued job can complete successfully in the happy path test.
- [ ] Add or extend route/UI-facing tests for `/articles/automations` behavior if that surface already has automated coverage.
- [ ] Verify the `Scrape Article Content` automation section uses the same input contract/defaults as `State Assigner`.

### Phase 3 engineer checkpoint

1. Run:
   - `npx jest worker-node/tests/modules/<new-job-test-file>.test.ts`
   - `npx jest worker-node/tests/routes/<new-route-test-file>.test.ts`
   - `npm -C worker-node test`
2. If all tests pass:
   - [ ] Check off completed Phase 3 tasks in this document.
   - [ ] Commit all changes for Phase 3.
3. Do not continue to Phase 4 until the commit is complete.

## Phase 4. Invoke scraper logic before AI state assigner processing

- [ ] Integrate the new scraper workflow into the state assigner job flow.
- [ ] Run scraping as a bounded pre-step for only the candidate articles the state assigner is about to process.
- [ ] Do not restore the legacy “scan all articles” behavior.
- [ ] Keep the state assigner route contract stable unless a change is intentionally required.
- [ ] Ensure scraping failures do not crash the entire state assigner job.
- [ ] Ensure articles can still fall back to `description` when content remains unavailable.
- [ ] Add logging that shows:
  1. Candidate articles selected.
  2. Pre-scrape enrichment attempted.
  3. Scrape summary results.
  4. State assignment continuing after scrape failures/timeouts.

### Phase 4 tests

- [ ] Extend `worker-node/tests/modules/stateAssignerJob.test.ts` or add a focused companion suite.
- [ ] Follow `docs/TEST_IMPLEMENTATION_NODE.md` guidance:
  1. Mock external boundaries.
  2. Keep orchestration behavior real.
  3. Verify the ordering of meaningful workflow steps.
- [ ] Verify the state assigner invokes the scraper workflow before assignment processing begins.
- [ ] Verify the state assigner continues when scraper results are partial or some articles fail to scrape.
- [ ] Verify only the bounded candidate set is sent to the scraper workflow.
- [ ] Verify the existing assignment flow still receives article content or description fallback correctly.

### Phase 4 engineer checkpoint

1. Run:
   - `npx jest worker-node/tests/modules/stateAssignerJob.test.ts`
   - `npm -C worker-node test`
2. If all tests pass:
   - [ ] Check off completed Phase 4 tasks in this document.
   - [ ] Commit all changes for Phase 4.
3. Do not continue to Phase 5 until the commit is complete.

## Phase 5. Add Puppeteer fallback behind configuration

- [ ] Add Puppeteer support only after the Cheerio-first flow is working.
- [ ] Make Puppeteer fallback configurable by environment flag or equivalent worker-node configuration.
- [ ] Attempt Puppeteer only when Cheerio has failed and fallback is enabled.
- [ ] Persist `scrapeStatusPuppeteer` accurately for success and failure.
- [ ] Ensure successful Puppeteer content updates the same `ArticleContents` row instead of creating duplicates.
- [ ] Document any runtime or deployment requirements for headless browser support.

### Phase 5 tests

- [ ] Add or extend module tests in `worker-node/tests/modules/` for Puppeteer fallback orchestration.
- [ ] Follow `docs/TEST_IMPLEMENTATION_NODE.md` guidance:
  1. Mock the browser boundary instead of launching a real browser in unit tests.
  2. Cover both enabled and disabled configuration paths.
  3. Assert persisted side effects clearly.
- [ ] Verify Puppeteer is not called when fallback is disabled.
- [ ] Verify Puppeteer is called after Cheerio failure when fallback is enabled.
- [ ] Verify Puppeteer success updates content and marks `scrapeStatusPuppeteer` as successful.
- [ ] Verify Puppeteer failure marks `scrapeStatusPuppeteer` as failed.

### Phase 5 engineer checkpoint

1. Run:
   - `npx jest worker-node/tests/modules/<puppeteer-fallback-test-file>.test.ts`
   - `npm -C worker-node test`
2. If all tests pass:
   - [ ] Check off completed Phase 5 tasks in this document.
   - [ ] Commit all changes for Phase 5.
3. Do not continue to Phase 6 until the commit is complete.

## Phase 6. Final hardening and documentation

- [ ] Review whether `ArticleContents` should be enforced as one effective row per article in future schema work.
- [ ] Add or update developer documentation for the standalone scraper job endpoint and its required use from `/articles/automations`.
- [ ] Add or update documentation for how the state assigner now performs pre-scrape enrichment.
- [ ] Confirm logs and queue output are sufficient for troubleshooting.
- [ ] Confirm cancellation and timeout behavior remain acceptable for worker-node jobs.
- [ ] Remove dead code or temporary scaffolding introduced during implementation.

### Phase 6 tests

- [ ] Run the full worker-node suite as the final verification gate.
- [ ] Run targeted suites again for any files changed during hardening.
- [ ] Validate TypeScript test configuration if new test infrastructure was added.
- [ ] Confirm no earlier scraper-related test coverage regressed.

### Phase 6 engineer checkpoint

1. Run:
   - `npm -C worker-node test`
   - `npx jest worker-node/tests/modules/`
   - `npx jest worker-node/tests/routes/`
   - `npx tsc -p worker-node/tests/tsconfig.json --noEmit`
2. If all tests pass:
   - [ ] Check off completed Phase 6 tasks in this document.
   - [ ] Commit all remaining changes for Phase 6.
3. After the final commit, the scraper absorbtion implementation is complete.
