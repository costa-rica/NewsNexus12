# Worker-Node Article Content Scraper Refactor Assessment

## TL;DR

1. Feasibility
   - High.
   - The architecture in `/Users/nick/Documents/NewsNexus11-ScraperV09-codexWLesson` is a good fit for `worker-node` and is more aligned with how Google News RSS links actually behave.

2. Difficulty
   - Medium to high.
   - This is not just a scraper swap. It is a pipeline redesign that changes what URL we treat as the scrape target, how we classify outcomes, and what we persist in the database.

3. Recommendation
   - Build a new scraping flow inside `worker-node` rather than trying to patch the existing one in place.
   - Keep the old flow temporarily for rollback safety.
   - Plan to retire the old flow after the new one proves stable.

4. Database recommendation
   - I recommend creating a new table such as `ArticleContents02` instead of changing `ArticleContents` first.
   - The new flow has materially different concerns:
     1. Google URL as the input URL
     2. resolved publisher URL as a discovered URL
     3. blocked vs success vs error as first-class states
     4. extraction source and detection reason
     5. Google-page body vs publisher-page body provenance
   - That is enough behavioral difference that a parallel table is safer for migration and easier to reason about.

## Executive Assessment

1. The current `worker-node` flow assumes `Article.url` is already the content page that should be scraped.
2. In practice, `requestGoogleRss` stores Google RSS article links into `Articles.url`.
3. The current article-content scraper then tries to scrape those Google URLs directly with a Cheerio-first and Puppeteer-fallback model.
4. The reference project uses a different mental model:
   1. Google URL is an intermediate discovery step
   2. publisher URL is the real content target
   3. blocked and interstitial responses are normal outcomes that must be stored explicitly
5. That reference model better matches the actual problem you described and the lessons captured in the scraper project docs.

## Current NewsNexus11 Flow

1. `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
   - Builds Google News RSS queries.
   - Fetches RSS XML.
   - Stores each RSS item as an `Article`.
   - Saves `item.link` into `Articles.url`.
   - That link is the Google RSS article URL, not necessarily the true publisher article URL.

2. `worker-node/src/modules/jobs/articleContentScraperJob.ts`
   - Selects candidate articles.
   - Calls article-content enrichment for each selected article.

3. `worker-node/src/modules/article-content/enrichment.ts`
   - Looks up the current canonical `ArticleContent` row.
   - Skips scraping if content already appears usable.
   - Calls the scraper with `article.url`.
   - Updates or creates a row in `ArticleContents`.

4. `worker-node/src/modules/article-content/scraper.ts`
   - Tries plain `fetch` + Cheerio first.
   - Falls back to Puppeteer if needed.
   - Treats success mainly as “did we get enough extracted article text.”

## Why The Current Flow Is Struggling

1. The current flow is operating on the wrong target abstraction.
   - Google RSS article URLs are not the final content target.
   - They are an entry point into a redirect, consent, interstitial, or handoff process.

2. The current schema does not represent the important states of the new problem.
   - `ArticleContents` currently stores:
     1. `articleId`
     2. `content`
     3. `scrapeStatusCheerio`
     4. `scrapeStatusPuppeteer`
   - It does not store:
     1. original Google URL
     2. resolved publisher URL
     3. final browser URL
     4. extraction source
     5. blocked reason
     6. which body was actually stored

3. The current success model is too narrow.
   - With Google URLs, `200 OK` and even non-empty HTML are not enough.
   - A consent page, interstitial page, or anti-bot page can still look like a technically successful fetch.

4. The current engine order is likely suboptimal for this use case.
   - The reference project found that browser-first Google navigation is the strongest first step.
   - The current flow is HTTP-first, which is weaker against the Google-specific problem.

## What The ScraperV09 Architecture Gets Right

1. It treats Google navigation as step one and publisher scraping as step two.

2. It uses a browser-first approach for the Google step.
   - This better handles cookies, redirects, JavaScript, and interstitial behavior.

3. It treats the final browser URL as a first-class extraction source.
   - This is important because the browser sometimes lands directly on the publisher page.

4. It still inspects metadata as a backup extraction path.
   - `canonical`
   - `og:url`
   - JSON-LD
   - other non-Google links

5. It classifies outcomes by content and behavior, not only by HTTP status.
   - `success`
   - `blocked`
   - `error`

6. It separates Google-page retrieval from publisher-page retrieval.
   - Google step: browser-first
   - publisher step: direct HTTP first, browser fallback second

## Recommended Replacement Strategy

1. Do not try to “improve” the current scraper by just adding more selectors or retries.
   - That would keep the wrong pipeline shape.

2. Create a new `worker-node` flow with these stages:
   1. read article with Google RSS URL from `Articles.url`
   2. open the Google URL in a real browser session
   3. capture:
      - Google input URL
      - Google final browser URL
      - Google response status when available
      - Google HTML
   4. classify Google result:
      - blocked
      - still-Google-with-no-publisher
      - publisher-discovered
   5. extract publisher URL from:
      - final browser URL
      - canonical
      - `og:url`
      - JSON-LD
      - fallback links
   6. fetch publisher page:
      - direct HTTP first
      - browser fallback second
   7. classify final result:
      - success
      - blocked
      - error
   8. persist the result with enough metadata to debug and retry later

3. Start with sequential processing.
   - This matches the reference project.
   - It reduces the risk of triggering Google defenses.
   - It makes early debugging much easier.

4. Reuse the current queueing and job orchestration in `worker-node`.
   - The queue/job structure already fits this work well.
   - The main refactor should happen inside the scraping modules and persistence layer.

## Refactor In Place vs New Flow

1. Refactor in place
   - Pros:
     1. fewer endpoints and fewer temporary code paths
     2. less duplicated orchestration code
   - Cons:
     1. high risk of mixing old assumptions with new ones
     2. harder migration for DB consumers
     3. harder rollback if the new scraper is unstable
     4. existing `ArticleContents` semantics become muddy

2. New flow in parallel
   - Pros:
     1. safer rollout
     2. clearer separation of old and new data contracts
     3. easier debugging because new rows can store richer metadata
     4. easier to compare old and new outputs on the same article set
     5. easier to delete old code later than to untangle a half-migrated design
   - Cons:
     1. short-term duplication
     2. one more model/table to maintain during transition

3. Recommendation
   - Build a new flow in parallel inside `worker-node`, then remove the old flow after validation.

## Database Assessment

1. I agree with the instinct to avoid forcing this into the current `ArticleContents` table right away.

2. A new table such as `ArticleContents02` is the cleaner migration path.

3. The main reason is not just “more columns.”
   - The new table represents a different workflow stage and a different source-of-truth model.
   - The row is no longer just “scraped content for an article.”
   - The row becomes “result of a Google-to-publisher content acquisition attempt.”

4. Suggested data responsibilities for `ArticleContents02`
   - Core identifiers:
     1. `id`
     2. `articleId`
   - Input and discovered URLs:
     1. `googleUrl`
     2. `googleFinalUrl`
     3. `publisherUrl`
     4. `publisherFinalUrl`
   - Status and classification:
     1. `status`
     2. `detectionReason`
     3. `extractionSource`
     4. `bodySource`
   - Content and diagnostics:
     1. `content`
     2. optional `rawHtml` or a truncated/raw-body field if you want deep debugging
     3. `googleStatusCode`
     4. `publisherStatusCode`
   - Execution metadata:
     1. `googleNavigationMethod`
     2. `publisherFetchMethod`
     3. timestamps

5. Suggested status values
   - `success`
   - `blocked`
   - `error`
   - optionally `skipped` or `no_publisher_url`

6. Suggested uniqueness approach
   - Do not force a strict one-row-per-article rule immediately.
   - It is useful to allow multiple attempts and then define a canonical row selection strategy, similar to what the current repository already does for `ArticleContents`.

## Why A New Table Is Better Than Expanding `ArticleContents`

1. Existing consumers already treat `ArticleContents` as a relatively simple content store.

2. Changing that table in place would create immediate ambiguity:
   - Is `content` from RSS feed content, Google HTML, or publisher article text?
   - Do `scrapeStatusCheerio` and `scrapeStatusPuppeteer` still mean anything once the flow becomes multi-stage?

3. A new table lets us preserve old behavior during migration.

4. A new table also gives us room to decide later whether:
   - `ArticleContents02` becomes the permanent system of record
   - or selected final content gets copied back into `ArticleContents` for legacy compatibility

## Best Place To Draw The Boundary

1. Keep `Articles.url` as the Google URL for now if that is what `requestGoogleRss` produces.

2. Store the resolved publisher URL in the new content-acquisition table rather than overwriting `Articles.url` immediately.

3. Reasons:
   - preserving the original Google link is useful for traceability and replay
   - overwriting `Articles.url` too early would destroy the original acquisition context
   - some downstream code may still assume `Articles.url` is the ingested source link

4. Later, after validation, you can decide whether to add a dedicated destination URL field to `Articles` or continue treating the content-acquisition table as the destination URL source of truth.

## Proposed Worker-Node Module Shape

1. Keep the route and queue layer conceptually similar to today.

2. Replace the current content scraper internals with a new module set closer to the reference project:
   1. `googleNavigator`
   2. `googlePageClassifier`
   3. `publisherUrlExtractor`
   4. `publisherFetcher`
   5. `publisherPageClassifier`
   6. `articleContent02Repository`
   7. `articleContent02Workflow`

3. Suggested result type
   - One richer discriminated union that carries:
     1. article id
     2. all URL states
     3. classification status
     4. source of extracted content
     5. final text content
     6. failure reason

4. This will make test coverage much easier than pushing everything through the current small `success/failure` scraper shape.

## Migration Plan

1. Phase 1
   - Add `ArticleContents02` model in `db-models`.
   - Add associations.
   - Build the new result types and repository helpers in `worker-node`.

2. Phase 2
   - Implement Google browser-first navigation in `worker-node`.
   - Implement publisher URL extraction and classification logic.

3. Phase 3
   - Implement publisher fetch with HTTP-first and browser fallback.
   - Persist results to `ArticleContents02`.

4. Phase 4
   - Add a new endpoint or job handler for the new scraper flow.
   - Run it on a controlled sample set in sequential mode.

5. Phase 5
   - Compare outcomes against the old flow:
     1. success rate
     2. blocked rate
     3. retry usefulness
     4. content quality

6. Phase 6
   - Update consumers that need the new canonical content source.
   - Deprecate old `ArticleContents`-based scraping behavior.

7. Phase 7
   - Remove the old flow only after the new path has proven stable.

## Risks And Tradeoffs

1. Browser automation cost
   - The new flow will be heavier than the current Cheerio-first flow.
   - This is acceptable because the Google step is the hard part and reliability matters more than raw speed.

2. Anti-bot variance
   - Some failures will move from Google consent pages to publisher anti-bot pages.
   - The reference project already observed this.
   - That is still a net improvement because the flow surfaces the true failure mode more clearly.

3. Storage growth
   - If you store raw HTML bodies, table size can grow quickly.
   - Consider either:
     1. storing only normalized article text in the DB
     2. storing raw HTML only for blocked/error cases
     3. storing large debug bodies on disk instead of in SQLite

4. Consumer migration
   - Portal and API code that currently expect `ArticleContents` may need a compatibility plan if they should use the new content source later.

## Feasibility And Difficulty Detail

1. Feasibility
   - High because:
     1. the reference project already validated the core pattern
     2. `worker-node` already has queueing, Puppeteer, and DB wiring
     3. the main gap is pipeline design, not basic infrastructure

2. Difficulty
   - Medium to high because:
     1. schema work is needed
     2. the TypeScript domain model will become richer
     3. classification logic needs careful tests
     4. migration and coexistence with legacy consumers must be thought through

3. Overall assessment
   - This is very doable and worth doing.
   - It should be treated as a controlled replacement project, not as a small bug fix.

## Final Recommendation

1. Build an entirely new Google-to-publisher scraping flow inside `worker-node`.

2. Back it with a new `ArticleContents02` table rather than mutating `ArticleContents` first.

3. Keep `requestGoogleRss` as the acquisition step that seeds articles with Google URLs.

4. Treat the new scraper as a second-stage resolver and content fetcher:
   1. Google URL in
   2. publisher URL discovered
   3. publisher content stored
   4. blocked/error reasons preserved

5. After the new flow is stable, migrate consumers and then remove the old content scraping path.

## Suggested Next Decisions

1. Confirm whether `ArticleContents02` should store only final normalized article text or also raw HTML/debug payloads.

2. Decide whether the new flow should:
   - live behind a new endpoint
   - or replace the existing article-content-scraper endpoint after a short validation period

3. Decide whether `Articles` should eventually gain a dedicated destination URL field, or whether `ArticleContents02.publisherUrl` should remain the main source of truth.
