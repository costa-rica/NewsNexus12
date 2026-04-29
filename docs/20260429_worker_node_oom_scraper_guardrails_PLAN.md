# Worker Node OOM Scraper Guardrails Plan

Date: 2026-04-29

## Summary

This plan narrows the OOM scraper mitigation work to the two repo-level measures most likely to prevent another production crash while preserving scraping efficacy. The goal is to keep the existing Google RSS plus `ArticleContents02` scrape flow active, but bound the lifetime of Chromium and prevent one unstable article from tying up browser resources indefinitely.

## Scope

1. Implement Chromium recycling during long scrape jobs.
2. Add a full per-article scrape timeout.
3. Exclude OS-level and systemd changes from this repo plan.
4. Defer browser resource blocking for now to avoid changing page-render behavior until the lower-risk guardrails are in place.

## Measure 1: Recycle Chromium During Long Scrape Jobs

### Reason

- The production failure involved the kernel killing `chrome-headless`.
- Current worker-node scrape paths can keep one Playwright browser/context open across a long article run.
- Recycling Chromium keeps the same scraping logic but limits how long any single browser process can accumulate memory, page state, redirects, or unstable publisher behavior.
- This is expected to have little to no scraping efficacy impact because each article still uses the existing navigation and publisher fetch behavior.

### Starting Behavior

1. Recycle the Playwright Chromium session after 25 attempted article-content scrapes.
2. Recycle immediately after 3 consecutive `navigation_error` scrape results.
3. Close the old browser/context before creating the next session.
4. Log each recycle event with:
   - reason
   - article attempt count since last recycle
   - consecutive navigation error count
   - current job context when available

### Implementation Notes

- Add a small session manager for `GoogleNavigationSession`.
- The manager should own:
  - the current browser/context session
  - scrape attempts since last recycle
  - consecutive navigation errors
  - session creation and cleanup
- Use the manager in:
  - `worker-node/src/modules/article-content-02/enrichment.ts`
  - `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
- Keep `processArticleContent02Candidate()` focused on a single candidate and let the caller or manager decide when to recycle.

### Acceptance Criteria

1. Long enrichment jobs no longer reuse one Chromium session for the full article list.
2. Request Google RSS follow-up scraping no longer reuses one Chromium session for the full spreadsheet run.
3. A successful or non-navigation failure resets the consecutive navigation error counter.
4. Recycle events are visible in worker-node logs.
5. Existing scrape result persistence behavior is unchanged.

## Measure 2: Add a Full Per-Article Scrape Timeout

### Reason

- Existing timeouts cover specific navigation calls, but one article can still pass through multiple stages:
  - Google navigation
  - Google page classification
  - publisher URL extraction
  - direct publisher fetch
  - Playwright publisher fallback
  - retries
  - post-load waits
  - parsing
  - persistence
- A full per-article timeout prevents one unstable article from threatening the worker process.
- Using a generous timeout should preserve most successful scrapes while bounding pathological cases.

### Starting Behavior

1. Add a hard timeout around the full Google-to-publisher article workflow.
2. Start with a 90 second timeout per article.
3. Link the timeout to the existing job `AbortSignal`.
4. When the timeout fires:
   - abort in-flight browser/page work
   - close any active page through the existing abort cleanup paths
   - persist a failed `ArticleContents02` result
   - continue to the next article

### Failure Result

- Use the existing failed workflow result shape.
- Prefer `failureType: 'navigation_error'` for the first pass to avoid broad model/database changes.
- Set `details` to a clear timeout message, such as:
  - `Article content 02 scrape timed out after 90000ms`

### Implementation Notes

- Add a helper that creates a child `AbortController` linked to the parent job signal.
- Wrap the main scrape body in `processArticleContent02Candidate()`.
- Ensure timeout cleanup always clears timers and removes abort listeners.
- Preserve the current skip behavior for:
  - missing article URLs
  - articles that already have canonical content rows

### Acceptance Criteria

1. A single slow article cannot run beyond the configured full-article timeout.
2. Timed-out articles are persisted as failed `ArticleContents02` rows.
3. The worker continues processing later articles after a timeout.
4. Existing job cancellation still stops the run promptly.
5. Normal successful scrapes still persist with the same fields and statuses as before.

## Configuration

1. Add environment-backed configuration with safe defaults:
   - `ARTICLE_CONTENT_02_BROWSER_RECYCLE_ATTEMPTS=25`
   - `ARTICLE_CONTENT_02_BROWSER_RECYCLE_NAVIGATION_ERRORS=3`
   - `ARTICLE_CONTENT_02_ARTICLE_TIMEOUT_MS=90000`
2. Validate values at startup or module load:
   - recycle attempts must be at least 1
   - consecutive navigation errors must be at least 1
   - article timeout must be at least 10000ms
3. Fall back to defaults and log a warning when values are invalid.

## Test Plan

1. Add unit tests for browser session recycling:
   - recycles after the configured attempt count
   - recycles after consecutive `navigation_error` results
   - closes the final active session at the end of a job
2. Add unit tests for article timeout handling:
   - persists a failed result on timeout
   - aborts in-flight work
   - continues the enrichment summary correctly
3. Update existing tests where mocks assume one session per whole run.
4. Run:

```bash
npm -C worker-node test
npm -C worker-node run build
```

## Rollout

1. Deploy with the default settings.
2. Watch worker-node logs for:
   - Chromium recycle frequency
   - timeout failures
   - `navigation_error` bursts
   - successful scrape rate
3. If efficacy drops because too many articles time out, raise `ARTICLE_CONTENT_02_ARTICLE_TIMEOUT_MS` before changing browser recycling.
4. If memory pressure continues, lower `ARTICLE_CONTENT_02_BROWSER_RECYCLE_ATTEMPTS` from 25 toward 10 before considering resource blocking.

## Deferred Work

1. Browser resource blocking is intentionally deferred.
2. OS-level and systemd restart policy changes remain outside this repo plan.
3. A dedicated `article_timeout` failure type can be added later if reporting needs a timeout-specific category.
