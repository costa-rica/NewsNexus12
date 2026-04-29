# Worker Node OOM Scraper Assessment

Date: 2026-04-29

## Summary

The `newsnexus12-worker-node.service` crash was caused by Linux OOM handling during a long-running scraping workload. The service was processing the Google RSS plus `ArticleContents02` scrape flow. A Playwright/Chromium child process named `chrome-headless` was killed by the kernel OOM killer, and systemd later marked the worker-node service failed with `Result=oom-kill`.

This was not evidence that scraping should be disabled. It points to the browser automation layer needing stronger lifecycle bounds while scraping continues.

## Evidence

- Service: `newsnexus12-worker-node.service`
- Service start: `2026-04-28 00:11:28 UTC`
- OOM event: `2026-04-29 01:38:45 UTC`
- Service failure: `2026-04-29 01:40:10 UTC`
- systemd result: `oom-kill`
- killed process: `chrome-headless`
- workload immediately before failure: Google RSS requests and `Article content 02 workflow result persisted` logs
- repeated late-stage scrape failures: `failureType=navigation_error`

The relevant code path keeps one Playwright Chromium browser/context open across a long RSS spreadsheet run:

- `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
- `worker-node/src/modules/article-content-02/enrichment.ts`
- `worker-node/src/modules/article-content-02/googleNavigator.ts`
- `worker-node/src/modules/article-content-02/publisherFetcher.ts`

Individual pages are generally closed in `finally` blocks, so this does not look like a simple missing `page.close()` bug. The risk is that a long-lived Chromium session can accumulate state, memory pressure, expensive page resources, or unstable navigation behavior across many Google redirects and publisher fallback pages.

## Requirement

The solution must keep scraping available while avoiding indefinite restart loops.

The solution must not weaken the system-level resource guardrails that stop runaway processes. In particular:

- Do not disable Linux OOM behavior.
- Do not configure systemd to ignore OOM conditions.
- Do not loosen existing shutdown behavior to allow a resource-heavy process to continue indefinitely.
- Do not use an unbounded `Restart=always` style policy.

The operating system and systemd should still be allowed to shut the process down when resource use becomes unsafe.

## Recommended Solution

### 1. Recycle Chromium during long scrape jobs

Treat Chromium as disposable during scraping. Reuse it briefly for efficiency, then close and recreate the browser/context after a bounded number of article scrape attempts.

Recommended starting point:

- recycle after 25 to 50 article-content attempts
- recycle immediately after a short burst of consecutive `navigation_error` results
- recycle between large RSS batches if the spreadsheet job produces many new articles

This keeps scraping active while bounding browser process lifetime. It directly targets the failure mode because the killed process was `chrome-headless`, not Postgres, Express, or the core Node event loop.

### 2. Block nonessential browser resources

For Playwright fallback scraping, block resource types that are not needed for text extraction:

- images
- media
- fonts
- possibly stylesheets

The scraper needs final URLs and HTML/text. Loading full publisher pages increases memory and network load without improving most extraction results.

### 3. Add a full per-article scrape timeout

The current code has navigation-level timeouts, but a single article can still pass through Google navigation, publisher direct fetch, Playwright fallback, retries, post-load waits, parsing, and persistence.

Add a hard timeout around the full per-article Google-to-publisher workflow. When the timeout is reached, persist a failed `ArticleContents02` result and continue to the next article.

This prevents one unstable page from threatening the whole worker process.

### 4. Add bounded service restart behavior

The service currently has `Restart=no`, so one OOM leaves worker-node down until manual intervention.

Use a bounded restart policy, not indefinite restart:

```ini
[Unit]
StartLimitIntervalSec=1h
StartLimitBurst=3

[Service]
Restart=on-failure
RestartSec=30s
```

This allows up to three recovery attempts in one hour. If the process repeatedly hits the same resource failure, systemd stops trying and leaves the service failed for investigation.

This does not disable resource guardrails. Linux OOM and systemd failure handling remain active. The process can still be killed when resource usage becomes unsafe.

## What Not To Do

- Do not set `Restart=always`.
- Do not set unlimited retry behavior.
- Do not change `OOMPolicy` to continue after OOM.
- Do not treat OOM as a successful exit.
- Do not remove timeouts or shutdown behavior.
- Do not solve this by only increasing memory; that may hide the symptom while leaving Chromium lifecycle risk in place.

## Assessment

The best fix is app-level containment of browser automation:

1. Bound how long a Chromium session can live.
2. Reduce what Chromium loads.
3. Bound how long one article scrape can run.
4. Add only limited systemd restart recovery.

This preserves scraping and keeps the system-level safety mechanisms intact. If Chromium starts consuming unsafe resources again, the OS and systemd should still be able to terminate the workload. The bounded restart policy only helps recover from isolated failures; it does not create an infinite loop.
