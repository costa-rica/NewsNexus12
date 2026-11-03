---
created_at: 2026-10-23T21:11:56Z
updated_at: 2026-10-23T21:23:08Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Google RSS 503 Retry PRD v01

## Problem

- Weekly flow runs 3 and 4 stopped in Phase 4 after Google RSS returned HTTP 503, following 753 and 751 successful queries respectively.
- Both retained saved Articles, but downstream phases did not start.
- These responses do not establish whether the cause was rate limiting or temporary unavailability.
- Today, a single 503 ends collection without retrying the failed query.

References:

- [Run 3 failure report](20261016_weekly_flow_02_run_3_failure_report.md)
- [Run 4 failure report](20261023_weekly_flow_02_run_4_failure_report.md)

## Goal and Scope

- Give a failed RSS query two opportunities to recover after configurable waits.
- Keep the normal five-second default cadence and existing stop-and-continue recovery.
- Apply this behavior to the shared worker-node Google RSS collection job, including calls from weekly flow Phase 4.
- Keep the change small and easy to diagnose using existing logs.

## Configuration

1. `MILISECONDS_IN_BETWEEN_REQUESTS`
   - Preserve existing behavior, validation, and the `5000` millisecond default.
   - Do not increase the production cadence setting as part of this change.
2. `MINUTES_IN_BETWEEN_REQUESTS_RETRY_1`
   - Default: `5` minutes when unset or empty.
3. `MINUTES_IN_BETWEEN_REQUESTS_RETRY_2`
   - Default: `15` minutes when unset or empty.

- Read the new settings from worker-node's environment once per job.
- Accept positive, finite numeric minute values, including fractions for short local tests; the converted millisecond delay must also fit a Node timer.
- For invalid values, log a warning naming the setting and use its default.
- Document the defaults in the existing worker-node environment example or configuration documentation. Do not edit production environment files.

## Request Sequence

1. Fetch the current query once using the existing request behavior.
2. If it returns HTTP 503, log the failure and wait the configured first retry interval.
3. Retry that same URL once.
4. If it returns HTTP 503 again, log the failure and wait the configured second retry interval.
5. Retry that same URL a final time.
6. If any attempt succeeds, process its response once and return to the existing normal delay before the next query.
7. If the final attempt returns HTTP 503, finish through the existing `rate_limited` failure path.

- Allow at most three fetch attempts per query: one initial attempt and two retries.
- Reset the retry allowance for every new query.
- The second wait begins after the first retry returns 503. Default total waiting time before the final attempt is 20 minutes, excluding request time.
- Retry waits replace the normal cadence delay between attempts of the same query.
- Retry only HTTP 503. If an attempt returns another error, use the existing handling for that result without spending further 503 retries.
- Keep cancellation responsive during waits and prevent another fetch after cancellation.

## Persistence and Continuation

- Retain successful Articles and the existing query-result and job-result contracts.
- Persist a successful retried response only once; do not create intermediate request records that would suppress retry or later continuation.
- After exhausted retries, mark the query failed and leave later queries unprocessed, as today.
- Preserve the coordinator's unsuccessful-result handling and prevent downstream phases from starting after terminal RSS failure.
- Keep manual continuation within the existing 72-hour eligibility window. Recovery continues to skip recently recorded requests through the existing repeat window, rather than a new cursor.
- Do not add automatic coordinator or service restarts.

## Diagnostics

- Log query ID, job ID, attempt number, HTTP status, and selected wait when scheduling a retry.
- On every HTTP 503, including the initial failure and both failed retries, log all response headers exposed by the HTTP client and up to 2 KB (2,048 bytes) of the response body.
- Preserve header values and the body excerpt without sanitization or redaction. Normal structured-logger escaping still applies.
- Include `bodyTruncated: true` when the body exceeds the capture limit, and `bodyTruncated: false` when the complete body fits within it.
- Bound body capture while reading; do not buffer an unlimited response before truncating it. Keep cancellation responsive and record body-read failures without losing the HTTP status or headers.
- Include query ID, job ID, attempt number, UTC timestamp, and the planned retry delay or retry-exhausted outcome with each 503 diagnostic entry.
- Log recovery after a successful retry and exhaustion after the final 503.
- Preserve the existing terminal error details and normal-delay reporting.
- Do not describe a 503 as proven rate limiting; retain the existing `rate_limited` contract for compatibility.

## Acceptance and Verification

1. A 503 followed by success waits once, saves results once, and resumes normal cadence.
2. Two 503 responses followed by success use both configured waits and resume normal cadence.
3. Three 503 responses preserve the existing terminal failure and manual continuation behavior.
4. Cancellation during either wait prevents further attempts.
5. New configuration defaults and overrides work; invalid values fall back with a warning.
6. Every 503 logs all exposed response headers and an unsanitized body excerpt capped at 2,048 bytes, with an accurate `bodyTruncated` flag for complete bodies and bodies exceeding the limit.

- Extend existing worker-node tests with mocked fetches and fake timers for these behaviors; avoid real waits, network calls, or database access.
- Run focused tests and the worker-node build. Reuse existing coverage for unchanged coordinator behavior.

## Excluded Work

- New infrastructure, queues, database tables, or persistent query checkpoints.
- Broad telemetry or logging redesign beyond the specified 503 diagnostics.
- Retries for other status codes, exponential backoff, jitter, or automatic `Retry-After` overrides.
- Changes to the normal request cadence, continuation window, or weekly schedule.
