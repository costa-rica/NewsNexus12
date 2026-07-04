---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: claude (fable-5)
modified_by: hermes nws-nn12prod (gpt-5.5)
---

## Overview (100 words or less)

The NewsNexus12 API (`newsnexus12-api.service`, Express on port 8001) crashed twice on 2026-07-01 with the same V8 heap out-of-memory signature: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`, followed by a systemd core-dump failure. Both crashes were immediately preceded by very large article-list responses, most notably a `POST /articles/with-ratings` response of 259,342,491 bytes that took over 353 seconds. The root cause is unbounded article list endpoints that materialize and serialize full datasets in memory. The durable fix is bounded, paginated, SQL-filtered endpoints; raising the heap limit is only a short-term stopgap.

## Why api crashed

Both shutdowns ended with the identical Node/V8 heap exhaustion signature. The first crash occurred at 2026-07-01 18:54:00 UTC; after a restart at 19:53:36 UTC, the second crash followed at 20:22:54 UTC. In each case the journal shows `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`, then `Main process exited, code=dumped, status=6/ABRT` and `Failed with result 'core-dump'`.

### Log evidence

Large article-endpoint responses immediately preceded both crashes:

- First crash: `POST /articles/with-ratings` responses around 63 MB, 67 MB, and 106 MB, plus a `GET /articles/approved` response around 23.8 MB.
- Second crash: multiple `POST /articles/with-ratings` responses around 23 MB, 63 MB, 67 MB, and 77 MB; one `POST /articles/with-ratings` response of 259,342,491 bytes that took 353.289835 seconds; a `POST /articles` response around 61 MB; and a `GET /articles/approved` response around 23.8 MB.

### Implicated code paths

- `POST /articles/with-ratings` (`api/src/routes/articles.ts` lines 829-1040) is the strongest suspect. It loads the full article set from `sqlQueryArticlesForWithRatingsRoute()`, filters rows in JavaScript instead of constraining the query in SQL, collects every article ID, queries AI scores for the full ID list, joins scores with repeated `Array.find()` calls (cost grows with result size), and serializes the entire `finalArticles` result as one JSON response.
- `POST /articles` (`api/src/routes/articles.ts` lines 53-200) builds large in-memory arrays and multiple `Map` objects, filters in application memory, and returns all matching articles in a single payload.
- `GET /articles/approved` (`api/src/routes/articles.ts` lines 203-259) calls `sqlQueryArticlesWithStatesApprovedReportContract()`, which selects heavy fields such as `textForPdfReport`, then filters and maps the full result in JavaScript.

`api/src/modules/queriesSql.ts` additionally materializes and de-duplicates joined SQL rows in application memory. During a large request the process holds the raw SQL rows, grouped object graphs, filtered arrays, mapped response objects, and the serialized JSON simultaneously — several copies of the same data — which exhausts the default V8 heap. The login failures users saw were a symptom of the process being down, not an authentication bug.

## Recommended fix

Make the article list endpoints bounded so they can never return unbounded full-dataset JSON payloads.

### Application changes

1. Add pagination (page or cursor based) to `POST /articles`, `GET /articles/approved`, and `POST /articles/with-ratings`, with a server-side maximum page size enforced regardless of what the client requests, and response metadata such as `totalCount`, `pageSize`, `cursor`, or `hasMore`.
2. Move filtering and limits into SQL instead of fetching broad datasets and filtering them in JavaScript.
3. Remove large text/report fields (e.g. `textForPdfReport`) from list responses; expose them via per-article detail endpoints or explicit expansion flags.
4. Replace repeated `Array.find()` AI-score lookups in `POST /articles/with-ratings` with keyed `Map` lookups.

### Operational mitigations

- Add `Restart=on-failure` to the `newsnexus12-api.service` systemd unit so an abort does not leave the API down indefinitely. This is an availability mitigation, not the fix.
- Add memory telemetry and alerting: track RSS and heap usage, alert as heap approaches the V8 limit, log request path, response size, duration, and memory deltas for heavy article endpoints, and alert when the service enters the `failed` state.

### Why raising the heap is not sufficient

Increasing `--max-old-space-size` only delays the crash. The 259 MB response shows the process holds multiple representations of the same data at once, so a larger heap still permits slow, memory-heavy responses and eventual failure under load. Treat any heap increase as a short-term stopgap while the bounded-endpoint work lands.

## Hermes assessment of claude report

### Agreement

I agree with Claude's core diagnosis and recommendation. The report correctly identifies the repeated V8 heap OOM signature as the direct cause of the API shutdowns, and it ties that failure to unbounded article-list endpoints that create very large response payloads and substantial in-process memory amplification.

I also agree that simply increasing Node's heap limit is not a sufficient fix. It may buy time, but it leaves the API vulnerable to the same broad-query and huge-response pattern that made login unavailable when the process crashed.

### Additional emphasis

The highest-risk endpoint remains `POST /articles/with-ratings` because it produced the largest observed response, performs multiple full-result transformations, and joins AI score data in application memory. I would prioritize bounding that endpoint first, then apply the same pattern to `POST /articles` and `GET /articles/approved`.

I would also treat `Restart=on-failure` as urgent operational hygiene. It will not solve the memory bug, but it would reduce the chance that a single bad request leaves all users unable to log in until someone manually restarts the service.

### Suggested implementation order

1. Add conservative server-enforced limits and pagination defaults to `POST /articles/with-ratings`.
2. Remove large text/report fields from list responses unless requested through an explicit detail or expansion path.
3. Push filtering, ordering, and limits into SQL and validate raw SQL row counts versus response object counts.
4. Replace repeated `Array.find()` score joins with keyed maps.
5. Add request-size, response-size, duration, and heap/RSS logging around the heavy article endpoints.
6. Add `Restart=on-failure` and service-failed alerting while the code fix is being completed.
