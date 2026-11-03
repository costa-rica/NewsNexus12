---
created_at: 2026-10-23T21:37:20Z
updated_at: 2026-10-23T21:42:24Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Google RSS 503 Retry PRD v02

## Changes From v01

- Replace the two retry settings with a single `MINUTES_IN_BETWEEN_REQUESTS_RETRY`, defaulting to 120 minutes.
- Allow one retry per query instead of two.
- Make complete capture of the 503 response the primary goal, replacing the 2 KB body excerpt.
- Add the final response URL and redirect flag to diagnostics.

## Problem

- Weekly flow runs 3 and 4 stopped in Phase 4 after Google RSS returned HTTP 503, following 753 and 751 successful queries respectively.
- Both runs failed after nearly the same number of successful queries, despite different input sizes (833 and 1,519) and elapsed times. This suggests a volume limit near 750 requests, but the evidence does not prove it.
- A 20-minute total wait is unlikely to clear a limit of that kind.
- The worker retains no response headers or body, so the cause of the 503 cannot be verified.

References:

- [Run 3 failure report](20261016_weekly_flow_02_run_3_failure_report.md)
- [Run 4 failure report](20261023_weekly_flow_02_run_4_failure_report.md)
- [PRD v01](20261023_google_rss_503_retry_prd_v01.md)

## Goal and Scope

- Primary: on the next weekly run, capture the complete HTTP 503 response so the cause can be verified or narrowed.
- Secondary: give a failed query one recovery attempt after a long, configurable wait.
- Keep the normal five-second cadence and the existing stop-and-continue recovery.
- Apply this behavior to the shared worker-node Google RSS collection job in `worker-node/src/modules/jobs/requestGoogleRssJob.ts`, including calls from weekly flow Phase 4.
- Keep the change small and diagnosable from the existing worker-node logs.

## Configuration

1. `MILISECONDS_IN_BETWEEN_REQUESTS`
   - Preserve the existing behavior, validation, and `5000` millisecond default.
   - Do not change the production cadence as part of this change.
2. `MINUTES_IN_BETWEEN_REQUESTS_RETRY`
   - Default: `120` minutes when unset or empty.

- Read the new setting from worker-node's environment once per job.
- Accept positive, finite numeric minute values, including fractions for short local tests. The converted millisecond delay must fit a Node timer (at most 2,147,483,647 milliseconds).
- For an invalid value, log a warning naming the setting and use the default.
- Add the setting and its default to `worker-node/.env.example`. Do not edit production environment files.

## Request Sequence

1. Fetch the current query once using the existing request behavior.
2. If it returns HTTP 503, capture and log the complete response (see Diagnostics), then wait the configured retry interval.
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

This is the primary deliverable.

### On every HTTP 503 (initial attempt and retry)

Write one structured `error` entry to the worker-node logger that includes:

- Query ID, job ID, attempt number (`1` or `2`), and UTC timestamp.
- Request URL, final response URL (`response.url`), and whether a redirect occurred (`response.redirected`). Google may redirect blocked traffic to an interstitial page whose URL is itself a clue.
- HTTP status and status text.
- All response headers exposed by the HTTP client, unsanitized and unredacted, including `Retry-After`, `Set-Cookie`, `Date`, and any server or trace headers.
- The complete response body as text, unsanitized.
- The body's byte length and a `bodyTruncated` flag.
- The outcome: the scheduled retry delay in minutes, or `retry_exhausted`.

Body capture rules:

- Read the body in a stream, up to a 1 MB (1,048,576 bytes) safety cap. Do not buffer an unlimited response.
- Set `bodyTruncated: true` only when the body exceeds the cap; otherwise `false`.
- Bound the body read by the existing 10-second request timeout. Today that timer is cleared once headers arrive, so it must also cover the 503 body read.
- If reading the body fails or times out, log the error alongside the status, headers, and any partial body. Never lose the status or headers.
- Keep cancellation responsive during the body read.

### Other events

- Log the retry being scheduled: query ID, job ID, and wait in minutes.
- Log recovery when the retry succeeds, including that attempt's HTTP status and its headers.
- Log exhaustion after the second 503.
- Preserve the existing terminal error message and normal-delay reporting, but do not describe a 503 as proven rate limiting in new log text. Keep the existing `rate_limited` ending reason for compatibility.
- Do not log the full `queryResults` array in a 503 diagnostic entry.

### Where to find it

- The worker-node file log, `${PATH_TO_LOGS}/${NAME_APP}.log`, is the record of truth. Its Winston size rotation must not drop an entry mid-write.
- Large journald console entries may be split. That is acceptable as long as the file log entry is complete.

## Acceptance and Verification

1. A 503 followed by success waits the configured interval once, saves the results once, and resumes normal cadence.
2. Two 503 responses on the same query preserve the existing terminal failure and manual continuation behavior.
3. After a recovered query, a 503 on a later query gets its own single retry.
4. Cancellation during the wait prevents further attempts.
5. Unset, empty, and invalid values for `MINUTES_IN_BETWEEN_REQUESTS_RETRY` use 120 minutes; invalid values also log a warning. Valid overrides, including fractions, are honored.
6. Every 503 log entry contains the request URL, final URL, redirect flag, status, status text, all exposed headers unredacted, and the complete body. Truncation is flagged correctly for bodies under, at, and over the 1 MB cap.
7. A body-read failure or timeout still logs the status and headers.

- Extend the existing tests in `worker-node/tests/modules/requestGoogleRssJob.test.ts` using mocked fetches and fake timers. Avoid real waits, network calls, and database access.
- Run the focused tests and the worker-node build. Reuse existing coverage for unchanged coordinator behavior.

## Excluded Work

- Acting on `Retry-After`. It is logged but does not change the wait. A future PRD can decide this using the captured evidence.
- Multiple retries, exponential backoff, or jitter.
- Retries for other status codes.
- Treating a terminal 503 as partial success so Phases 5–7 run.
- Reordering queries, such as least recently requested first.
- New infrastructure, queues, database tables, persistent query checkpoints, or separate diagnostic files.
- Changes to the normal request cadence, the coordinator's timeout, the continuation window, or the weekly schedule.

## Open Questions

### 1. Body safety cap

Is a 1 MB cap on the captured 503 body acceptable?

- Google's 503 pages are usually a few KB, so the whole body should fit.
- The cap only prevents unbounded memory use.

#### Operator Response

Let's do 1 MB. It should capture real 503 bodies in full. But only if we have enough space in our log files. Right now our production worker-node .env file uses `LOG_MAX_SIZE=3`, which might limit the size of the file. Can we extend this? I think for the next run we shoudl exten to maybe 20 just in case we get a big header.

### 2. Unredacted cookie headers

Should `Set-Cookie` and similar headers be logged unredacted?

- Unredacted matches the goal of capturing the full response.
- These are Google-issued values on our own host.
- They stay in the worker-node log until rotation.
- The alternative is logging each cookie's length and a short prefix.

#### Operator Response
unredacted for this diagnostic run, then reconsider once the cause is known.

### 3. Longer weekly run length

Does anything depend on the weekly flow finishing within a set window?

- If retries succeed, a run could grow from about 5.5 hours to 13 hours or more.
- The Phase 4 job timeout of 24 hours still allows this.

#### Operator Response
No this is not a problem.

### 4. Body on a recovered retry

Should a successful retry also log its response body?

- This PRD logs only the status and headers of a successful retry.
- The body is normal RSS XML and would add bulk without likely clues.

#### Operator Response

yes, headers only. They are enough to compare against the 503 headers.
