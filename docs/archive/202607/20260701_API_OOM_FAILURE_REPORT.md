---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: hermes nws-nn12prod (gpt-5.5)
modified_by: hermes nws-nn12prod (gpt-5.5)
---

## Incident Summary

Yes. The second API shutdown appears to have been the same failure mode as the first shutdown: the Node.js API process exhausted its V8 heap and aborted with an out-of-memory fatal error.

The affected service was `newsnexus12-api.service`, the Express API running from `/home/limited_user/applications/NewsNexus12/api` on port `8001`. After the first restart, the service started successfully at `2026-07-01 19:53:36 UTC`, then failed again at `2026-07-01 20:22:54 UTC` with the same Node/V8 heap exhaustion signature observed in the earlier crash.

The API is currently back up after the later manual restart at `2026-07-01 21:42:58 UTC`.

## Evidence From The Service Logs

### First observed crash

The first observed outage ended with this signature:

- `2026-07-01 18:54:00 UTC`: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
- `2026-07-01 18:54:42 UTC`: `newsnexus12-api.service: Main process exited, code=dumped, status=6/ABRT`
- `2026-07-01 18:54:42 UTC`: `newsnexus12-api.service: Failed with result 'core-dump'`

Large responses immediately preceded the crash, including:

- `POST /articles/with-ratings` responses around `63 MB`, `67 MB`, and `106 MB`
- `GET /articles/approved` response around `23.8 MB`

### Second observed crash

After the API was restarted at `2026-07-01 19:53:36 UTC`, the second outage ended with the same signature:

- `2026-07-01 20:22:54 UTC`: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
- `2026-07-01 20:22:54 UTC`: `newsnexus12-api.service: Main process exited, code=dumped, status=6/ABRT`
- `2026-07-01 20:22:54 UTC`: `newsnexus12-api.service: Failed with result 'core-dump'`

Large responses again preceded the crash, including:

- Multiple `POST /articles/with-ratings` responses around `23 MB`, `63 MB`, `67 MB`, and `77 MB`
- One `POST /articles/with-ratings` response of `259,342,491` bytes that took `353.289835` seconds
- `POST /articles` response around `61 MB`
- `GET /articles/approved` response around `23.8 MB`

### Current service state

After the later manual restart, `newsnexus12-api.service` was active again from `2026-07-01 21:42:58 UTC`. Earlier post-restart smoke checks showed:

- `GET http://127.0.0.1:8001/`: `200`
- `GET http://127.0.0.1:8001/health`: `200`
- `POST /users/login` reached the API and returned an expected application response for a nonexistent user

## Relevant Code Paths

### `POST /articles`

`api/src/routes/articles.ts` lines `53-200` builds large in-memory arrays and maps before returning all matching articles in a single JSON response.

Important behaviors:

- It loads a base article array.
- It separately loads related states, relevance rows, and approval rows.
- It builds multiple JavaScript `Map` objects.
- It filters in application memory.
- It returns the full grouped result as one JSON payload.

### `GET /articles/approved`

`api/src/routes/articles.ts` lines `203-259` calls `sqlQueryArticlesWithStatesApprovedReportContract()`, filters the full result in JavaScript, maps the approved article objects, and returns the full list.

The query implementation in `api/src/modules/queriesSql.ts` selects large approval/report fields, including `textForPdfReport`, and then builds nested article objects in memory. This can inflate heap usage because the API holds the raw SQL result, grouped object graph, filtered array, mapped array, and serialized JSON response during the request lifecycle.

### `POST /articles/with-ratings`

`api/src/routes/articles.ts` lines `829-1040` is the strongest suspect for the crashes because it repeatedly appears immediately before the OOM events and produced the largest observed payloads.

Important behaviors:

- It loads the full article set from `sqlQueryArticlesForWithRatingsRoute()`.
- It filters rows in JavaScript rather than fully constraining the query in SQL.
- It builds an array of all article IDs.
- It queries AI scores for the full ID list.
- It uses repeated `Array.find()` calls while mapping article score data, which makes score lookup cost grow with result size.
- It builds `finalArticles` and returns the entire result set in one JSON response.

`api/src/modules/queriesSql.ts` also materializes and de-duplicates the joined SQL rows in application memory. The combined effect is high transient memory pressure during large requests.

## Likely Root Cause

The immediate cause of both shutdowns was V8 heap exhaustion in the Node.js API process.

The likely application-level root cause is unbounded article list endpoints that materialize large joined result sets, transform them in JavaScript, and serialize very large JSON responses. The endpoints most implicated by the logs are:

- `POST /articles/with-ratings`
- `POST /articles`
- `GET /articles/approved`

The `POST /articles/with-ratings` endpoint is the highest-priority suspect because it produced a `259 MB` response shortly before the second crash and performs several memory-amplifying operations: full result materialization, JavaScript filtering, full-ID score lookups, repeated `Array.find()` joins, final object construction, and full JSON serialization.

This is not primarily an authentication failure. Users could not log in because the API process was down, not because the login route itself was necessarily broken.

## Recommended Fix

### Primary recommendation

Fix the article list endpoints so they are bounded and do not return unbounded full-dataset JSON payloads.

The recommended implementation direction is:

1. Add pagination or cursor-based pagination to `POST /articles`, `GET /articles/approved`, and `POST /articles/with-ratings`.
2. Enforce a server-side maximum page size, even if the client requests more.
3. Move filters into SQL wherever possible instead of fetching broad datasets and filtering them in JavaScript.
4. Avoid selecting large text/report fields in list endpoints unless the client explicitly needs them.
5. Split detail-heavy fields into per-article detail endpoints or explicit expansion flags.
6. Replace repeated `Array.find()` score lookups with keyed `Map` lookups.
7. Return metadata such as `totalCount`, `pageSize`, `cursor`, or `hasMore` instead of returning every matching article at once.

### Why this is preferable to only increasing heap size

Increasing `--max-old-space-size` may delay the crash, but it does not address the root cause. The observed `259 MB` response implies the process is likely holding multiple copies or representations of the same data at once: raw SQL rows, grouped objects, filtered arrays, mapped response objects, and serialized JSON. Raising the heap limit could make the service survive a few more requests while still allowing slow, memory-heavy responses and eventual failure under load.

The durable fix is to reduce per-request memory amplification and payload size.

## Operational Mitigations

### Short-term mitigation

Add `Restart=on-failure` to the `newsnexus12-api.service` systemd unit so a Node abort does not leave the API down indefinitely.

This should be treated as an availability mitigation, not as the application fix. It reduces outage duration but does not prevent repeated crashes if users keep hitting the same heavy endpoints.

### Monitoring and alerting

Add memory telemetry and alerting for the API process:

- Track RSS and heap usage over time.
- Alert when heap usage approaches the default V8 limit.
- Log request path, response size, duration, and memory deltas for heavy article endpoints.
- Add an alert when `newsnexus12-api.service` enters `failed` state.

### Client-side mitigation

Until the API is fixed, reduce dashboard calls that request large article datasets. The UI should avoid polling or refreshing the heavy article list endpoints without pagination, especially when filters are broad.

## Follow-Up Verification

After implementing the code fix, verify the following:

1. `POST /articles/with-ratings` returns a bounded page of results and cannot return hundreds of megabytes in one response.
2. `POST /articles` and `GET /articles/approved` also enforce bounded responses.
3. The API memory footprint remains stable after repeated broad article-list requests.
4. Response durations for list endpoints remain within an acceptable range.
5. Login remains available while article list requests are running.
6. `newsnexus12-api.service` remains active after repeated use of the article dashboard.
7. Warning-or-higher journal logs show no new OOM or process aborts.

## Related Non-Crash Finding

After the latest restart, the API logged an `express-rate-limit` warning because the request included an `X-Forwarded-For` header while Express `trust proxy` was still false.

That warning is not the crash signature and does not explain the process abort. It should still be fixed because the API appears to be behind a proxy, and rate limiting may identify clients incorrectly until Express is configured with the appropriate `trust proxy` setting.

## Hermes Addendum

### Agreement with the recommendation

I agree with the recommendation to prioritize bounded, paginated article list endpoints over simply increasing Node's heap size.

The service failed twice with the same V8 OOM signature, and both failures were preceded by very large article-list responses. The most important fix is to stop the API from materializing and serializing unbounded article datasets in a single request. Increasing heap size alone would mask the failure and may make the next incident slower and harder to recover from.

### Additional items I would add

I would add three practical safeguards to the code recommendation:

1. Set hard API-level response-size budgets for dashboard list endpoints. Any endpoint returning tens or hundreds of megabytes should be considered a production incident risk.
2. Add database-level query plans and row-count checks before refactoring. The SQL joins may multiply rows before JavaScript de-duplication, so the fix should validate both raw SQL row counts and final response object counts.
3. Add regression tests or smoke tests that fail if list endpoints return unbounded data by default. A test should confirm default page size, maximum page size, and behavior when a broad filter would otherwise match the full article table.

### Alternative or phased approach

If a full pagination refactor cannot be completed immediately, I would implement a phased fix:

1. Emergency patch: enforce conservative default and maximum limits on the implicated endpoints and omit heavy text fields from list responses.
2. Availability patch: add `Restart=on-failure` and memory/request-size logging to production.
3. Correctness/performance patch: move filtering and sorting into SQL, convert repeated score joins to keyed maps, and add cursor or page metadata for the portal.
4. UX patch: update the portal to request pages incrementally and fetch full article details only when a user opens a specific article.

This keeps the API available quickly while still moving toward the durable fix.
