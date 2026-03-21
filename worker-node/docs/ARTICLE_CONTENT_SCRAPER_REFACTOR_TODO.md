# Article Content Scraper Refactor TODO

## Overview

This TODO covers the new Google-RSS-aware article scraping flow for `worker-node`.

The new flow will:

1. read the Google RSS article URL from `Articles.url`
2. navigate the Google URL in a browser
3. discover the publisher URL behind the Google URL
4. fetch the publisher page
5. store the result in `ArticleContents02`

The new table and flow should include:

1. `articleId`
2. `url`
   - the discovered publisher URL
3. `googleRssUrl`
   - the original Google RSS URL
4. `title`
5. `content`
6. `status`
   - `success` or `fail`
7. `failureType`
8. `details`
9. `extractionSource`
10. `bodySource`

The engineer or agent should complete this work phase by phase.

At the end of each phase:

1. run the relevant tests
2. verify the tests pass
3. check off all completed items in this file
4. commit all changes for that phase
5. then move on to the next phase

Do not move to the next phase until the current phase is complete, tested, and committed.

## Phase 1 - Finalize Schema And Data Contract

- [ ] Confirm the final `ArticleContents02` columns and data types.
  Run relevant tests after this task.
- [ ] Confirm `status` values will be `success` and `fail`.
  Run relevant tests after this task.
- [ ] Confirm `failureType` values to support at least:
  1. `blocked_google`
  2. `blocked_publisher`
  3. `no_publisher_url_found`
  4. `navigation_error`
  5. `publisher_fetch_error`
  6. `short_content`
  Run relevant tests after this task.
- [ ] Confirm `url` will store the discovered publisher URL and `googleRssUrl` will store the original Google URL.
  Run relevant tests after this task.
- [ ] Confirm `details`, `extractionSource`, and `bodySource` are required for the new workflow.
  Run relevant tests after this task.
- [ ] Confirm whether raw HTML will be stored in SQLite or omitted from the first version.
  Run relevant tests after this task.
- [ ] Confirm whether the new flow will allow multiple `ArticleContents02` rows per article.
  Run relevant tests after this task.
- [ ] Update this TODO file if any schema decisions changed during implementation planning.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 2.

## Phase 2 - Add `ArticleContents02` To `db-models`

- [ ] Add `db-models/src/models/ArticleContents02.ts`.
  Run relevant tests after this task.
- [ ] Define the Sequelize model for `ArticleContents02` with the approved fields.
  Run relevant tests after this task.
- [ ] Register `ArticleContents02` in `db-models/src/models/_index.ts`.
  Run relevant tests after this task.
- [ ] Add associations in `db-models/src/models/_associations.ts`.
  Run relevant tests after this task.
- [ ] Add `Article.hasMany(ArticleContents02)` and `ArticleContents02.belongsTo(Article)`.
  Run relevant tests after this task.
- [ ] Verify the new model is exported everywhere needed by `worker-node`.
  Run relevant tests after this task.
- [ ] Build `db-models` successfully.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 3.

## Phase 3 - Add Worker-Node Repository And Types

- [ ] Create a new `worker-node` repository module for `ArticleContents02`.
  Run relevant tests after this task.
- [ ] Add create helpers for new scrape-attempt rows.
  Run relevant tests after this task.
- [ ] Add update helpers for completed scrape-attempt rows.
  Run relevant tests after this task.
- [ ] Add read helpers for loading prior `ArticleContents02` rows by `articleId`.
  Run relevant tests after this task.
- [ ] Define canonical or latest-row selection logic if needed for skip behavior.
  Run relevant tests after this task.
- [ ] Create new workflow result types for the Google-to-publisher pipeline.
  Run relevant tests after this task.
- [ ] Keep the new result types separate from the legacy article-content scraper types.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 4.

## Phase 4 - Build Google Navigation

- [ ] Add a new Google navigation module for browser-first navigation.
  Run relevant tests after this task.
- [ ] Use a real browser flow suitable for Google URL handling.
  Run relevant tests after this task.
- [ ] Reuse one browser context per job run when practical.
  Run relevant tests after this task.
- [ ] Capture the Google input URL, final browser URL, response status when available, and returned HTML.
  Run relevant tests after this task.
- [ ] Add conservative retry logic for transient Google navigation failures.
  Run relevant tests after this task.
- [ ] Keep processing sequential in the first version.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 5.

## Phase 5 - Build Google Classification And Publisher URL Extraction

- [ ] Add Google-page classification logic.
  Run relevant tests after this task.
- [ ] Detect consent, interstitial, or still-Google outcomes.
  Run relevant tests after this task.
- [ ] Detect when the browser already landed on a non-Google publisher URL.
  Run relevant tests after this task.
- [ ] Add publisher URL extraction from final browser URL.
  Run relevant tests after this task.
- [ ] Add fallback extraction from `canonical`, `og:url`, JSON-LD, and other eligible links.
  Run relevant tests after this task.
- [ ] Reject Google-owned or unusable candidate URLs.
  Run relevant tests after this task.
- [ ] Save the chosen extraction source in the result object.
  Run relevant tests after this task.
- [ ] Save useful human-readable explanations in `details`.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 6.

## Phase 6 - Build Publisher Fetch And Content Extraction

- [ ] Add direct HTTP publisher fetching.
  Run relevant tests after this task.
- [ ] Add fallback browser fetching for incomplete or unusable direct HTTP results.
  Run relevant tests after this task.
- [ ] Extract normalized title from the publisher page.
  Run relevant tests after this task.
- [ ] Extract normalized article content from the publisher page.
  Run relevant tests after this task.
- [ ] Set `bodySource` based on the path that produced the final usable content.
  Run relevant tests after this task.
- [ ] Save human-readable `details` such as:
  1. `Direct HTTP returned usable publisher HTML`
  2. `Playwright fallback returned publisher HTML`
  3. `Publisher page returned anti-bot challenge`
  Run relevant tests after this task.
- [ ] Set `failureType` for publisher fetch failures and blocked publisher outcomes.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 7.

## Phase 7 - Persist `ArticleContents02` Rows

- [ ] Save successful scrape results to `ArticleContents02`.
  Run relevant tests after this task.
- [ ] Save failed scrape results to `ArticleContents02` whenever there is enough diagnostic information to preserve.
  Run relevant tests after this task.
- [ ] Persist both `url` and `googleRssUrl`.
  Run relevant tests after this task.
- [ ] Persist `status`, `failureType`, `details`, `extractionSource`, and `bodySource`.
  Run relevant tests after this task.
- [ ] Persist final title and content when available.
  Run relevant tests after this task.
- [ ] Decide and implement skip behavior for articles that already have a usable `ArticleContents02` success row.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 8.

## Phase 8 - Integrate With Worker-Node Jobs And Routes

- [ ] Add a new workflow module for the `ArticleContents02` scraping flow.
  Run relevant tests after this task.
- [ ] Integrate the workflow with the existing queue/job system.
  Run relevant tests after this task.
- [ ] Add a new route or job entrypoint for the new flow instead of replacing the old flow immediately.
  Run relevant tests after this task.
- [ ] Ensure the old article-content scraper flow remains available during validation.
  Run relevant tests after this task.
- [ ] Add logging for job start, per-article progress, success, fail, and summary results.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 9.

## Phase 9 - Add And Expand Test Coverage

- [ ] Add tests for `ArticleContents02` repository behavior.
  Run relevant tests after this task.
- [ ] Add tests for Google classification logic.
  Run relevant tests after this task.
- [ ] Add tests for publisher URL extraction.
  Run relevant tests after this task.
- [ ] Add tests for direct HTTP success.
  Run relevant tests after this task.
- [ ] Add tests for browser fallback success.
  Run relevant tests after this task.
- [ ] Add tests for blocked Google outcomes.
  Run relevant tests after this task.
- [ ] Add tests for blocked publisher outcomes.
  Run relevant tests after this task.
- [ ] Add tests for no-publisher-url outcomes.
  Run relevant tests after this task.
- [ ] Add tests for route and job integration.
  Run relevant tests after this task.
- [ ] Run the full relevant test suite for `worker-node` and any impacted packages.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. Move to Phase 10.

## Phase 10 - Validate And Roll Out

- [ ] Run the new flow against a controlled sample of Google RSS article URLs.
  Run relevant tests after this task.
- [ ] Review saved `ArticleContents02` rows for correctness and completeness.
  Run relevant tests after this task.
- [ ] Compare the new flow against the old flow for success rate, fail rate, and content quality.
  Run relevant tests after this task.
- [ ] Fix any issues discovered during validation.
  Run relevant tests after this task.
- [ ] Decide whether downstream readers should begin consuming `ArticleContents02`.
  Run relevant tests after this task.
- [ ] Document rollout and deprecation steps for the legacy scraper flow.
  Run relevant tests after this task.

Phase completion steps:

1. Run the relevant tests.
2. If tests pass, check off all completed items in this phase.
3. Commit all changes.
4. If all phases are complete, the TODO is complete.

## Final Completion Rules

1. Every task should end with running the relevant tests.
2. Every phase should end with passing tests, checked-off items, and a commit.
3. Continue phase by phase until all TODO items are completed.
