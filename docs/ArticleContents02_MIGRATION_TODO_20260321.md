# ArticleContents02 Migration TODO

This TODO tracks the migration from the legacy `ArticleContents` scraping flow to the new `ArticleContents02` Google-to-publisher flow.

The new scraper has already proven better in testing. The remaining work is replacing existing callers, updating compatibility reads, and reviewing older ingestion paths that still write or depend on `ArticleContents`.

## Migration goals

1. Replace the portal-triggered article scraper flow with the new `ArticleContents02` worker route.
2. Replace the state assigner pre-scrape/content-read path with `ArticleContents02`.
3. Update API read paths that still depend on `ArticleContents`.
4. Assess whether `requestGoogleRss` should remain as-is, be partially updated, or be refactored to better align with the new flow.
5. Retire the old article-content scraper only after all active callers are migrated and validated.

## Phase 1. Portal-triggered scraper migration

1. Update the portal article-content automation UI to target the new worker flow.
   - File to inspect:
     - `portal/src/components/automations/ScrapeArticleContentSection.tsx`
   - Replace the old worker endpoint name:
     1. `/article-content-scraper/start-job`
   - With the new worker endpoint name:
     1. `/article-content-scraper-02/start-job`

2. Update the API proxy that forwards portal automation requests to worker-node.
   - File to inspect:
     - `api/src/routes/newsOrgs/automations.ts`
   - Decide whether to:
     1. keep the public API route name the same and forward it to the new worker route
     2. or add a parallel API route for the new flow and migrate the portal explicitly

3. Update the portal worker job status panel wiring for this section.
   - Ensure the UI watches the new endpoint name so job status and job history are correct.

4. Test the portal-triggered flow end to end.
   - Confirm the job is queued on the new endpoint.
   - Confirm `ArticleContents02` rows are created.
   - Confirm the job status panel reflects the new worker route.

## Phase 2. State assigner migration

1. Replace the state assigner pre-scrape dependency on the old enrichment flow.
   - File to inspect:
     - `worker-node/src/modules/jobs/stateAssignerJob.ts`
   - Current old dependency:
     1. `enrichArticleContent`
   - Target new dependency:
     1. `enrichArticleContent02`

2. Replace the state assigner content-read dependency on the old canonical row helper.
   - Current old dependency:
     1. `getCanonicalArticleContentRow`
   - Replace with a new `ArticleContents02` canonical read path.

3. Define fallback behavior for state assigner article content.
   - Recommended order:
     1. usable `ArticleContents02.content`
     2. article description if no usable `ArticleContents02` content exists

4. Validate state assigner behavior after the migration.
   - Confirm the pre-scrape step uses the new scraper flow.
   - Confirm articles classified by the state assigner are reading from `ArticleContents02`.
   - Confirm the state assigner still progresses when scraping fails.

## Phase 3. API compatibility updates

1. Review API SQL and route code that still reads from `ArticleContents`.
   - File already identified:
     - `api/src/modules/queriesSql.ts`

2. Update article detail queries to prefer `ArticleContents02`.
   - Decide whether to:
     1. fully replace `ArticleContents`
     2. or prefer `ArticleContents02` and fall back to `ArticleContents` during transition

3. Review any other API routes that insert into or read from `ArticleContents`.
   - Search areas to review:
     1. `api/src/routes`
     2. `api/src/modules`

4. Validate portal/article-detail behavior after this change.
   - Confirm article detail screens show the new content source correctly.

## Phase 4. Assess `requestGoogleRss`

1. Review the current `requestGoogleRss` storage behavior.
   - File to inspect:
     - `worker-node/src/modules/jobs/requestGoogleRssJob.ts`

2. Confirm what it currently writes into:
   1. `Articles.url`
   2. `ArticleContents`

3. Assess whether its current lightweight content persistence should remain.
   - Questions to answer:
     1. Should RSS `content` or `description` still populate legacy `ArticleContents`?
     2. Should that path start populating `ArticleContents02` instead?
     3. Should `requestGoogleRss` stop writing content rows entirely and leave content acquisition to the new scraper flow?

4. Assess whether `requestGoogleRss` is doing any HTML/content handling that duplicates old assumptions.
   - If so, decide whether to:
     1. keep it as temporary seed content
     2. simplify it
     3. align it with the `ArticleContents02` model

5. Document the decision before changing this flow.
   - This area should be reviewed carefully because it seeds the articles that the new scraper later processes.

## Phase 5. Legacy route and legacy flow retirement

1. Identify all remaining callers of the old scraper route.
   - Worker route:
     1. `/article-content-scraper/start-job`
   - Old modules:
     1. `worker-node/src/modules/article-content/*`

2. Confirm the following are migrated first:
   1. portal-triggered scraper flow
   2. state assigner pre-scrape/content-read flow
   3. API detail/read compatibility where needed

3. Decide whether to keep old `ArticleContents` as:
   1. transitional fallback only
   2. historical data only
   3. removable technical debt

4. Remove or deprecate the old route only after rollout is stable.

## Validation checklist

1. Portal manual scraper run creates `ArticleContents02` rows.
2. Portal job status panel points at the new endpoint.
3. State assigner reads content from `ArticleContents02`.
4. API article detail queries return the new content source correctly.
5. `requestGoogleRss` has been reviewed and its role is clearly documented.
6. Old scraper flow is no longer required for active workflows before retirement.

## Recommended implementation order

1. Migrate the portal-triggered scraper flow first.
2. Test and confirm the new route is the active portal path.
3. Migrate the state assigner to use `ArticleContents02`.
4. Update API compatibility reads.
5. Assess and decide the future of `requestGoogleRss` content persistence.
6. Retire the old scraper route and old flow only after all of the above are validated.
