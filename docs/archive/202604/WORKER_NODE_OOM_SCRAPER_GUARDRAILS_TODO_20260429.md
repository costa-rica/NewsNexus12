# Worker Node OOM Scraper Guardrails TODO

## Phase 1: TODO and configuration

- [x] Add this TODO list using `docs/TODO_LIST_GUIDANCE.md`.
- [x] Add environment-backed worker-node scraper guardrail settings.
- [x] Default Chromium recycling to 25 article attempts.
- [x] Default consecutive navigation-error recycling to 3 failures.
- [x] Default full article scrape timeout to 90000ms.
- [x] Validate invalid env values and fall back to defaults.

## Phase 2: Chromium session recycling

- [x] Add a small reusable session manager for `GoogleNavigationSession`.
- [x] Track article scrape attempts since the latest browser session was created.
- [x] Track consecutive `navigation_error` scrape results.
- [x] Recycle Chromium after the configured attempt limit.
- [x] Recycle Chromium after the configured consecutive navigation-error limit.
- [x] Use the session manager in article-content enrichment jobs.
- [x] Use the session manager in request Google RSS follow-up scraping.
- [x] Log recycle events with the recycle reason and counters.

## Phase 3: Full per-article timeout

- [x] Add a child abort controller for each article scrape.
- [x] Link the child abort controller to the job abort signal.
- [x] Add a hard timeout around the Google-to-publisher article workflow.
- [x] Persist timed-out articles as failed `ArticleContents02` results.
- [x] Continue processing later articles after one article times out.
- [x] Preserve current skip behavior for missing URLs and existing canonical rows.

## Phase 4: Tests and verification

- [x] Add tests for attempt-count browser recycling.
- [x] Add tests for consecutive `navigation_error` browser recycling.
- [x] Add tests for full article timeout persistence and continuation.
- [x] Run `npm -C worker-node test`.
- [x] Run `npm -C worker-node run build`.
- [x] Commit the completed implementation with this TODO file updated.
