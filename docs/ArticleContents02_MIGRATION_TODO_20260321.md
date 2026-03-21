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

## Phase 4. Assess and migrate `requestGoogleRss`

1. Review the current `requestGoogleRss` storage behavior.
   - File to inspect:
     - `worker-node/src/modules/jobs/requestGoogleRssJob.ts`

2. Confirm what it currently writes into:
   1. `Articles.url`
   2. `ArticleContents`

3. Migrate `requestGoogleRss` away from legacy `ArticleContents`.
   - Stop writing new rows to `ArticleContents` from this flow.
   - Use `ArticleContents02` as the single content table going forward.

4. Add RSS ingestion support to `ArticleContents02`.
   - Add `rss-feed` to the allowed `bodySource` values.
   - Confirm `googleRssUrl` is always populated from the RSS item link.
   - Keep `url`, `googleFinalUrl`, and `publisherFinalUrl` nullable for RSS-seeded rows when publisher resolution has not happened yet.

5. Define `requestGoogleRss` ingestion behavior for rows with usable RSS content.
   - If the RSS item includes usable content:
     1. write or update `ArticleContents02`
     2. set `status = success`
     3. set `bodySource = rss-feed`
     4. set `failureType = null`
     5. set `details` to a simple final value such as `Seeded from Google RSS item content`
   - Do not trigger the Google-to-publisher scraper in this case.

6. Define `requestGoogleRss` ingestion behavior for rows without usable RSS content.
   - If RSS content is missing or too short:
     1. write or update `ArticleContents02`
     2. set `status = fail`
     3. set `bodySource = rss-feed` when short content exists, otherwise `none`
     4. set a temporary `details` value indicating RSS content was missing or too short and that scraping is being triggered
     5. immediately trigger the new Google-to-publisher scraper for that article
   - Once scraping finishes, update the same row with the final scraper outcome and final `details` value.

7. Enforce overwrite protection for `requestGoogleRss`.
   - Never overwrite an existing usable successful `ArticleContents02` row for the same `articleId`.
   - Only create or update rows that are incomplete, failed, or missing.

8. Add a per-article scrape path for `requestGoogleRss`.
   - Reuse the new `ArticleContents02` Google-to-publisher workflow for one article at a time.
   - Avoid duplicating the scraper logic inside `requestGoogleRss`.

9. Validate the integrated `requestGoogleRss` behavior.
   - Test cases:
     1. RSS item with usable content
     2. RSS item with missing content
     3. RSS item with short content
     4. RSS item that triggers follow-up scrape success
     5. RSS item that triggers follow-up scrape fail
     6. RSS item for an article that already has a successful `ArticleContents02` row

10. Review API-side Google RSS storage for consistency.
   - File to inspect:
     - `api/src/modules/newsOrgs/storageGoogleRss.ts`
   - Decide whether it should:
     1. also move to `ArticleContents02`
     2. be deprecated
     3. or be left as transitional legacy behavior temporarily

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
