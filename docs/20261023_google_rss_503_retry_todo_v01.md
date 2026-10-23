---
created_at: 2026-10-23T22:16:03Z
updated_at: 2026-10-23T22:16:03Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Google RSS 503 Retry TODO v01

## Overview

This TODO implements [PRD v04](20261023_google_rss_503_retry_prd_v04.md) in `worker-node`. The assessing agent found no PRD concerns and judged that no separate plan is needed, so this TODO is built directly from the PRD.

The PRD is the source of truth for behavior. This TODO adds the implementation order and the code-level details an implementing agent needs.

## Context for the Implementing Agent

Read these before starting:

- `worker-node/AGENTS.md`
- `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
- `worker-node/tests/modules/requestGoogleRssJob.test.ts`

Current code facts:

- `fetchRssItems()` starts a 10-second abort timer and clears it as soon as headers arrive. It returns only `status`, `items`, `error`, and `statusCode`.
- The main loop in `runLegacyWorkflow()` checks `response.statusCode === 503` and immediately breaks with `rate_limited`.
- `delay(ms, signal)` already resolves early on abort. Reuse it for the retry wait.
- `MILISECONDS_IN_BETWEEN_REQUESTS` is parsed inline at the top of `runLegacyWorkflow()`. Parse the new setting the same way, next to it.
- Production logging is file-only through Winston. Metadata objects are rendered as `key=JSON`, so pass diagnostics as structured metadata, not string concatenation.
- Node is v24. `Headers.getSetCookie()` and `response.body.getReader()` are available.

Test harness facts:

- Tests in `requestGoogleRssJob.test.ts` use a real local test Postgres database created by `tests/globalSetup.js`. The PRD's "avoid database access" cannot apply to job-level tests because the job writes `NewsApiRequest` and `Article` rows. Follow the existing harness; do not add new database mocking.
- Existing tests use real timers, with `MILISECONDS_IN_BETWEEN_REQUESTS='500'` set in `beforeEach`. Use small fractional retry minutes, for example `'0.001'` (60 ms), instead of fake timers. Fake timers fight with the real database awaits in this file.
- Existing fetch mocks are plain objects (`{ ok, status, text }`) with no `headers` or `body`. 503 tests must switch to real `new Response(body, { status, statusText, headers })` objects. Use `Object.defineProperty` to set `url` and `redirected` when a test needs them.
- Without a retry setting, the existing 503 tests would wait the 120-minute default and time out. Set `MINUTES_IN_BETWEEN_REQUESTS_RETRY` in the `beforeEach` of every describe block that can hit a 503, and restore it in `afterEach`, as is done for `MILISECONDS_IN_BETWEEN_REQUESTS`.

## End-of-Phase Steps

At the end of every phase, from `worker-node/`:

1. Run `npx tsc -p tsconfig.json --noEmit`.
2. Run `npx jest tests/modules/requestGoogleRssJob.test.ts`, then `npm test`.
3. Run `npm run build`.
4. If anything fails, fix the code so existing behavior is kept and the tests pass. Do not weaken or delete existing assertions to get a pass.
5. Check off the completed tasks in this file.
6. Commit the phase's changes using the commit guidance in the root `AGENTS.md`.

## Phase 1: Retry Setting and Single Retry

Goal: one retry per query after `MINUTES_IN_BETWEEN_REQUESTS_RETRY`, with today's minimal 503 logging. Phase 2 adds the full diagnostics.

### Configuration

- [ ] In `runLegacyWorkflow()`, next to the `delayBetweenRequestsMs` parse, add a `retryDelayMs` parse for `MINUTES_IN_BETWEEN_REQUESTS_RETRY`.
  - [ ] Unset or empty: use 120 minutes, with no warning.
  - [ ] Accept positive, finite numbers, including fractions. Use `Number(...)`, not `parseInt`, so `0.001` works.
  - [ ] Reject zero, negatives, `NaN`, `Infinity`, non-numeric text, and values whose milliseconds exceed `2_147_483_647`. Log a `warn` naming the setting and the bad value, then use 120 minutes.
  - [ ] Log the effective retry delay once at job start, next to the existing delay log line.
- [ ] Keep the `MILISECONDS_IN_BETWEEN_REQUESTS` parse unchanged.

### Retry Flow

- [ ] In the main loop, replace the single `fetchRssItems()` call with an attempt sequence for the current row:
  1. Attempt 1: fetch.
  2. If the signal aborted, keep the existing "canceled during RSS fetch" handling.
  3. If the status is 503: log an `error` that includes query ID, job ID, attempt number, and planned wait in minutes. Then `await delay(retryDelayMs, context.signal)`.
  4. If the signal aborted during the wait: mark the row `skipped` / `canceled`, set `endingReason = 'canceled'` with a message saying cancellation happened during the 503 retry wait, and break. Do not fetch again.
  5. Attempt 2: fetch the same `requestUrl`.
  6. If the signal aborted: keep the existing canceled handling.
  7. If attempt 2 is a 503: log retry exhaustion, then use the existing `rate_limited` terminal block (row `failed` / `rate_limited`, later rows stay `not_reached`).
  8. Otherwise: log recovery (query ID, job ID, attempt 2, status) and continue with the existing code path using attempt 2's result. A non-503 error on attempt 2 follows the existing `rss_fetch_error` handling.
- [ ] Make sure `storeRequestAndArticles()` runs once, only for the final non-503 result. No `NewsApiRequest` row is created for a 503 attempt.
- [ ] The retry allowance is per row. Declare attempt state inside the loop body so it resets each iteration.
- [ ] The normal `delay(delayBetweenRequestsMs)` after the row stays as it is. Do not add a cadence delay between attempt 1 and attempt 2.
- [ ] Update the terminal `endingMessage`. Keep the HTTP 503 status, row ID, and URL. Drop the "rate limit likely exceeded" claim. State that one retry was attempted after N minutes. Keep `endingReason = 'rate_limited'` and the `rate_limited` row note unchanged.

### Tests

- [ ] Add `MINUTES_IN_BETWEEN_REQUESTS_RETRY='0.001'` setup and restore to the `beforeEach` and `afterEach` of the `requestGoogleRss terminal path results` block and any other block that can hit a 503.
- [ ] Update the existing 503 tests so two 503 responses still give `rate_limited`, and assert `fetchSpy` was called exactly twice.
- [ ] Add: 503 then 200 succeeds, saves articles once, row is `success`, ending reason is `queries_exhausted`, and exactly one `NewsApiRequest` row exists for the URL.
- [ ] Add: 503 then 200 on row 1, then 503 then 200 on row 2. Both rows recover, proving the allowance resets per row. Expect four fetches.
- [ ] Add: 503 then a non-503 error such as 500. The row gets the existing `rss_fetch_error` note, and the job continues to the next row.
- [ ] Add: cancel during the retry wait. Use a larger retry value such as `'0.01'` (600 ms) and abort after about 100 ms. Expect ending reason `canceled`, the row `skipped` / `canceled`, and exactly one fetch.
- [ ] Add config tests through job behavior, by spying on `logger`:
  - [ ] An invalid value (`'abc'`, `'0'`, `'-5'`) logs a warning naming `MINUTES_IN_BETWEEN_REQUESTS_RETRY`. To keep the test short, only check the warning and the logged effective delay of 120 minutes, and cancel the job before the wait completes.
  - [ ] An empty value logs no warning and uses 120 minutes.
  - [ ] A fractional override is honored. This is covered by the recovery tests above.

### End of Phase 1

- [ ] Run the end-of-phase steps.
- [ ] Commit, for example `feat: retry google rss 503 once after wait`.

## Phase 2: 503 Response Capture and Header Summary

Goal: every 503, on either attempt, writes the header summary entry and then the full-response entry described in PRD v04 Diagnostics.

### Fetch Result Changes

- [ ] Extend `RssFetchResult` with optional fields for response details. Suggested names, consistent with the existing camelCase style:
  - `responseHeaders`: all headers as a plain object. Store `set-cookie` as an array from `headers.getSetCookie()`.
  - `finalUrl`: from `response.url`.
  - `redirected`: from `response.redirected`.
  - `statusText`: from `response.statusText`.
  - `diagnosticBody`: present only for 503, containing `text`, `byteLength`, `bodyTruncated`, and an optional `readError`.
- [ ] Fill `responseHeaders`, `finalUrl`, `redirected`, and `statusText` for every response, so a recovered retry can log its headers too.
- [ ] Keep the existing `logger.error('RSS request failed with status ...')` line for non-OK responses.

### Bounded Body Read on 503

- [ ] Add a helper, for example `readBodyWithCap(response, capBytes, signal)`, that:
  - [ ] Reads `response.body` with `getReader()`, collecting chunks until the total exceeds 1,048,576 bytes.
  - [ ] Once over the cap, keeps exactly the first 1,048,576 bytes, sets `bodyTruncated: true`, and calls `reader.cancel()`.
  - [ ] Sets `bodyTruncated: false` when the stream ends at or under the cap, including exactly 1,048,576 bytes.
  - [ ] Decodes with `TextDecoder('utf-8')` without the `fatal` option, so invalid bytes do not throw.
  - [ ] Handles a `null` body as an empty string with `byteLength: 0`.
  - [ ] Catches read errors and returns the partial text plus `readError`. It never throws.
- [ ] Define the 1 MB cap as a named constant in the module, for example `RSS_503_BODY_CAPTURE_LIMIT_BYTES`.
- [ ] In `fetchRssItems()`, for 503 only, do not clear the 10-second timeout until the body read finishes. The same timer then bounds the body read, and outer cancellation still aborts it through the linked controller. Clear the timer in a `finally`-style path for every outcome.
- [ ] For non-503, non-OK responses, keep today's behavior and do not read the body.

### Header Summary

- [ ] Add a module constant listing the PRD v04 header keys. Keep the names lowercase and the list in one place:
  - `retry-after`, `ratelimit`, `ratelimit-policy`, `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`
  - `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`
  - `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset`
  - `location`, `content-type`, `content-length`, `content-encoding`, `cache-control`, `expires`
  - `date`, `server`, `via`, `x-request-id`, `x-cloud-trace-context`, `traceparent`
- [ ] Add a pure helper, for example `buildRssHeaderSummary(headers)`, that returns:
  - One field per listed key, with the header value or `null`. `Headers.get()` is already case-insensitive.
  - `setCookieNames`: the names before the first `=` in each `getSetCookie()` entry, or `[]`.
  - `googlePrefixedHeaders`: every header whose lowercase name starts with `x-goog` or `x-google`, or `{}`.
- [ ] Export the helper so it can be unit-tested directly, like `mapRssItems`.

### Log Entries

- [ ] On every 503, in the main loop, write two `logger.error` entries in this order:
  1. Message `RSS 503 header summary`, with metadata `queryId`, `jobId`, `attempt`, `timestamp` (UTC ISO), `status`, `statusText`, `finalUrl`, `redirected`, `outcome`, and `headerSummary`.
  2. Message `RSS 503 full response`, with metadata `queryId`, `jobId`, `attempt`, the same `timestamp`, `requestUrl`, `finalUrl`, `redirected`, `status`, `statusText`, `responseHeaders`, `body`, `bodyByteLength`, `bodyTruncated`, and `bodyReadError` when present.
- [ ] Set `outcome` to `retry_scheduled_in_N_minutes` on attempt 1 and `retry_exhausted` on attempt 2. Any clear, consistent value is fine.
- [ ] Compute the timestamp once and reuse it in both entries.
- [ ] Do not redact or sanitize headers or body. Winston's normal JSON escaping is fine.
- [ ] On recovery, extend the Phase 1 recovery log with `responseHeaders` and `headerSummary`. Do not log the body.
- [ ] Do not include `queryResults` in any 503 entry.
- [ ] Remove the Phase 1 minimal 503 log line if the two new entries fully replace it. The retry-scheduled line may stay.

### Tests

- [ ] Unit-test `buildRssHeaderSummary()`:
  - [ ] Present keys return values, and absent keys return `null`.
  - [ ] Mixed-case header names are still found.
  - [ ] Two `Set-Cookie` headers give two names.
  - [ ] `x-goog-*` and `x-google-*` headers are collected; unrelated `x-*` headers are not.
- [ ] Job-level tests spying on `logger.error`:
  - [ ] A 503 with headers and a small body writes the header summary entry before the full-response entry, with matching `queryId`, `jobId`, `attempt`, and `timestamp`.
  - [ ] The full-response entry has the unredacted `set-cookie` values and the complete body, with `bodyTruncated: false`.
  - [ ] Body exactly 1,048,576 bytes gives `bodyTruncated: false` and the full length.
  - [ ] Body of 1,048,577 bytes or more gives `bodyTruncated: true` and exactly 1,048,576 captured bytes.
  - [ ] A body stream that errors after a partial chunk still logs status, headers, header summary, the partial body, and `bodyReadError`. Use a `ReadableStream` that enqueues a chunk and then errors.
  - [ ] A `redirected: true` response with a different `url` is logged with both values.
  - [ ] Recovery logs headers and header summary but no body.

### End of Phase 2

- [ ] Run the end-of-phase steps.
- [ ] Commit, for example `feat: log full google rss 503 responses`.

## Phase 3: Documentation and Handoff

### Documentation

- [ ] Add `MINUTES_IN_BETWEEN_REQUESTS_RETRY=120` to `worker-node/.env.example`, with a short comment that it is the wait before the single 503 retry and accepts fractional minutes.
- [ ] Add `MINUTES_IN_BETWEEN_REQUESTS_RETRY` (default `120` minutes) to the Optional list in `worker-node/README.md`.
- [ ] Do not edit any production `.env` file.

### Final Verification

- [ ] Run the end-of-phase steps one last time on the full worker-node suite.
- [ ] Check PRD v04 Acceptance items 1 to 10 against the tests and note any item not covered by an automated test.
- [ ] Confirm `ops/` was not changed. The coordinator's handling of `rate_limited` stays as it is.

### Operator Handoff

- [ ] Report to the operator:
  - The commits created in each phase.
  - That the production deployment steps in PRD v04 still need the operator: restart worker-node so `LOG_MAX_SIZE=20` takes effect, optionally set `MINUTES_IN_BETWEEN_REQUESTS_RETRY`, and copy the worker-node logs right after the next run.
  - Any acceptance item covered only by reasoning, not by a test.

### End of Phase 3

- [ ] Check off the completed tasks.
- [ ] Commit, for example `docs: document google rss 503 retry setting`.
