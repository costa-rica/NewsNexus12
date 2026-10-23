---
created_at: 2026-10-23T22:06:04Z
updated_at: 2026-10-23T22:06:04Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Google RSS 503 Retry PRD v04

## Changes From v03

- Record the operator's answer on production log retention: `LOG_MAX_SIZE=20` and `LOG_MAX_FILES=5` are now set, keeping about 100 MB.
- Mark the log-retention deployment steps as done.
- Remove the resolved open question. No open questions remain.

v03 introduced the header summary entry, the `LOG_MAX_SIZE` deployment step, and the file-only log location note.

## Problem

- Weekly flow runs 3 and 4 stopped in Phase 4 after Google RSS returned HTTP 503, following 753 and 751 successful queries respectively.
- Both runs failed after nearly the same number of successful queries, despite different input sizes (833 and 1,519) and elapsed times. This suggests a volume limit near 750 requests, but the evidence does not prove it.
- A 20-minute total wait is unlikely to clear a limit of that kind.
- The worker retains no response headers or body, so the cause of the 503 cannot be verified.

References:

- [Run 3 failure report](20261016_weekly_flow_02_run_3_failure_report.md)
- [Run 4 failure report](20261023_weekly_flow_02_run_4_failure_report.md)
- [PRD v03](20261023_google_rss_503_retry_prd_v03.md)

## Goal and Scope

- Primary: on the next weekly run, capture the complete HTTP 503 response so the cause can be verified or narrowed.
- Secondary: give a failed query one recovery attempt after a long, configurable wait.
- Keep the normal five-second cadence and the existing stop-and-continue recovery.
- Apply this behavior to the shared worker-node Google RSS collection job in `worker-node/src/modules/jobs/requestGoogleRssJob.ts`, including calls from weekly flow Phase 4.
- Keep the change small and diagnosable from the existing worker-node logs.

## Decisions From Earlier Open Questions

1. Body safety cap: 1 MB, as long as the log files have room. Production `LOG_MAX_SIZE` is raised to `20` for the next run (see Deployment).
2. Cookie headers: log them unredacted for this diagnostic run. Reconsider once the cause is known.
3. Run length: a weekly run of 13 hours or more is acceptable.
4. Recovered retry: log status and headers only, not the body.
5. Log retention: production uses `LOG_MAX_SIZE=20` and `LOG_MAX_FILES=5`, about 100 MB in total.

## Configuration

1. `MILISECONDS_IN_BETWEEN_REQUESTS`
   - Preserve the existing behavior, validation, and `5000` millisecond default.
   - Do not change the production cadence as part of this change.
2. `MINUTES_IN_BETWEEN_REQUESTS_RETRY`
   - Default: `120` minutes when unset or empty.

- Read the new setting from worker-node's environment once per job.
- Accept positive, finite numeric minute values, including fractions for short local tests. The converted millisecond delay must fit a Node timer (at most 2,147,483,647 milliseconds).
- For an invalid value, log a warning naming the setting and use the default.
- Add the setting and its default to `worker-node/.env.example`. Do not edit production environment files in code changes.

## Request Sequence

1. Fetch the current query once using the existing request behavior.
2. If it returns HTTP 503, capture and log the response (see Diagnostics), then wait the configured retry interval.
3. Retry the same URL once.
4. If the retry succeeds, process its response once and return to the normal delay before the next query.
5. If the retry returns HTTP 503, capture and log that response too, then finish through the existing `rate_limited` failure path.

- Allow at most two fetch attempts per query: one initial attempt and one retry.
- Reset the retry allowance for every new query. If recovery succeeds and a later query hits another 503, that query also gets one retry after the full wait.
- The retry wait replaces the normal cadence delay between the two attempts of a query.
- Retry only HTTP 503. Any other error uses the existing handling for that result.
- Keep cancellation responsive during the wait, and prevent another fetch after cancellation.

### Timing Constraint

- The Phase 4 coordinator times the RSS job out 24 hours after creation (`RSS_JOB_TIMEOUT_HOURS=24` in `ops/.env.example`).
- Run 4 took about 26 seconds per query, so the full 1,519 queries would take about 11 hours. That leaves room for several 2-hour waits before the timeout.
- During a wait, the worker-node queue stays occupied by this job. This is acceptable because the weekly flow is the only scheduled consumer while it runs.
- Do not change the coordinator's timeout or poll interval as part of this change.

## Persistence and Continuation

- Retain successful Articles and the existing query-result and job-result contracts.
- Persist a successful retried response only once. Do not create intermediate request records that would suppress the retry or a later continuation.
- After a failed retry, mark the query failed and leave later queries unprocessed, as today.
- Preserve the coordinator's handling of unsuccessful results. Downstream phases still must not start after a terminal RSS failure.
- Keep manual continuation within the existing 72-hour eligibility window, using the existing repeat window and no new cursor.
- Do not add automatic coordinator or service restarts.

## Diagnostics

This is the primary deliverable. Every HTTP 503, on the initial attempt and on the retry, writes two `error` entries in this order:

1. A compact header summary.
2. The full response.

Both entries carry the same query ID, job ID, attempt number, and UTC timestamp so they can be matched.

### Entry 1: Header summary

This entry is small and written first. If the full-response entry is very large, fails to serialize, or the body read fails, the key clues are still on record.

Fields:

- Query ID, job ID, attempt number (`1` or `2`), and UTC timestamp.
- HTTP status, status text, final response URL, and redirect flag.
- The outcome: the scheduled retry delay in minutes, or `retry_exhausted`.
- A `headerSummary` object with one field per header below. Use the header's value when present and `null` when absent, so missing headers are recorded as missing.

Headers to look up (case-insensitive):

- Retry and rate limit:
  - `retry-after`
  - `ratelimit`, `ratelimit-policy`
  - `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`
  - `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`
  - `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset`
- Redirect and block page:
  - `location`
  - `content-type`, `content-length`, `content-encoding`
  - `cache-control`, `expires`
- Server and tracing:
  - `date`, `server`, `via`
  - `x-request-id`, `x-cloud-trace-context`, `traceparent`
- Cookies:
  - `setCookieNames`: the cookie names only, from all `Set-Cookie` headers, or an empty list. Full values are in entry 2.
- Google-specific:
  - `googlePrefixedHeaders`: every header whose name starts with `x-goog` or `x-google`, with its value, or an empty object.

Notes:

- Header capture is not limited by the 1 MB body cap. All headers are always recorded in full in entry 2; this summary only makes the likely clues easy to find.
- Keep the lookup list as a single constant in the job module so it is easy to extend.

### Entry 2: Full response

- Query ID, job ID, attempt number, and UTC timestamp.
- Request URL, final response URL (`response.url`), and whether a redirect occurred (`response.redirected`). Google may redirect blocked traffic to an interstitial page whose URL is itself a clue.
- HTTP status and status text.
- All response headers exposed by the HTTP client, unsanitized and unredacted, including every `Set-Cookie` value.
- The complete response body as text, unsanitized.
- The body's byte length and a `bodyTruncated` flag.

Body capture rules:

- Read the body in a stream, up to a 1 MB (1,048,576 bytes) safety cap. Do not buffer an unlimited response.
- Set `bodyTruncated: true` only when the body exceeds the cap; otherwise `false`.
- Bound the body read by the existing 10-second request timeout. Today that timer is cleared once headers arrive, so it must also cover the 503 body read.
- If reading the body fails or times out, log the error alongside the status, headers, and any partial body. Never lose the status or headers.
- Keep cancellation responsive during the body read.

### Other events

- Log the retry being scheduled: query ID, job ID, and wait in minutes.
- Log recovery when the retry succeeds, including that attempt's HTTP status, all its headers, and the same `headerSummary` object, so it can be compared with the 503.
- Log exhaustion after the second 503.
- Preserve the existing terminal error message and normal-delay reporting, but do not describe a 503 as proven rate limiting in new log text. Keep the existing `rate_limited` ending reason for compatibility.
- Do not log the full `queryResults` array in a 503 diagnostic entry.

### Where to find it

- Production worker-node logs go only to the file `${PATH_TO_LOGS}/${NAME_APP}.log`, using Winston size rotation (`LOG_MAX_SIZE` in MB per file, `LOG_MAX_FILES` files kept).
- Each entry is written whole. A large entry can push the file past `LOG_MAX_SIZE` before rotation, which is acceptable.
- Rotation deletes the oldest file. If a retry succeeds, hundreds more queries are logged after the 503, so the retained size must be large enough to keep the 503 entries until someone reads them.

## Deployment

These are operator steps on the production host, not code changes.

1. Done: production worker-node `.env` now has `LOG_MAX_SIZE=20` (previously `3`).
2. Done: production `LOG_MAX_FILES=5`, so retention is about 100 MB (previously about 15 MB).
3. Optionally set `MINUTES_IN_BETWEEN_REQUESTS_RETRY` explicitly. Leaving it unset uses the 120-minute default.
4. Restart worker-node through the approved control path so the new log settings take effect, if not already done, and verify its health.
5. After the run, copy the worker-node log files before investigating, so later rotation cannot remove the 503 entries.

## Acceptance and Verification

1. A 503 followed by success waits the configured interval once, saves the results once, and resumes normal cadence.
2. Two 503 responses on the same query preserve the existing terminal failure and manual continuation behavior.
3. After a recovered query, a 503 on a later query gets its own single retry.
4. Cancellation during the wait prevents further attempts.
5. Unset, empty, and invalid values for `MINUTES_IN_BETWEEN_REQUESTS_RETRY` use 120 minutes; invalid values also log a warning. Valid overrides, including fractions, are honored.
6. Every 503 writes the header summary entry before the full-response entry, and both share query ID, job ID, attempt number, and timestamp.
7. The header summary records present headers with their values and absent headers as `null`. It lists cookie names and all `x-goog` and `x-google` prefixed headers. Header lookup ignores case.
8. The full-response entry contains the request URL, final URL, redirect flag, status, status text, all exposed headers unredacted, and the complete body. Truncation is flagged correctly for bodies under, at, and over the 1 MB cap.
9. A body-read failure or timeout still logs the header summary, status, and headers.
10. A recovered retry logs its status, all headers, and its header summary, with no body.

- Extend the existing tests in `worker-node/tests/modules/requestGoogleRssJob.test.ts` using mocked fetches and fake timers. Avoid real waits, network calls, and database access.
- Run the focused tests and the worker-node build. Reuse existing coverage for unchanged coordinator behavior.

## Excluded Work

- Acting on `Retry-After` or any rate-limit header. They are logged but do not change the wait. A future PRD can decide this using the captured evidence.
- Searching the response body for clue keywords.
- Multiple retries, exponential backoff, or jitter.
- Retries for other status codes.
- Treating a terminal 503 as partial success so Phases 5–7 run.
- Reordering queries, such as least recently requested first.
- Changes to logger code, rotation behavior, or logger defaults.
- New infrastructure, queues, database tables, persistent query checkpoints, or separate diagnostic files.
- Changes to the normal request cadence, the coordinator's timeout, the continuation window, or the weekly schedule.
