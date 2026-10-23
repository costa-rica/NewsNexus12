---
created_at: 2026-10-23T22:38:06Z
updated_at: 2026-10-23T22:38:06Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Google RSS 503 Retry TODO v02 Assessment

## Result

- Reviewed [TODO v02](20261023_google_rss_503_retry_todo_v02.md) against [PRD v04](20261023_google_rss_503_retry_prd_v04.md), the current RSS job, its tests, and the logger.
- Two concerns meet the TODO assessment threshold in [plan-and-vet](PLAN_AND_VET.md): contradictory implementation instructions and recovery logging that conflicts with the PRD.
- Both can be corrected within the existing approach. No new infrastructure or broader test suite is needed.
- The explicitly accepted testing deviations are not findings in this assessment.

## Findings

### 1. Non-503 mocks also need headers

- Priority: P2.
- TODO references: Context for the Implementing Agent, lines 51–54; Phase 2 Fetch Result Changes, line 128.
- The context says non-503 mocks can remain unchanged, but Phase 2 requires extracting headers for every response.
- Existing 200 and 500 mocks contain only `ok`, `status`, and `text`. Examples are in `worker-node/tests/modules/requestGoogleRssJob.test.ts` at lines 304–308 and 567–576.
- Reading or iterating their missing `headers` will throw. The existing fetch catch then converts that exception into a generic error, breaking successful ingestion assertions and losing the intended HTTP 500 result.

Required correction:

1. Update the todo to require headers on every fetch mock reached by the new capture code, including successful and non-503 error responses.
2. Prefer fresh real `Response` objects for these mocks, as already required for 503 responses. Repeated calls must receive fresh bodies.
3. Keep existing assertions. Do not add production fallbacks solely to accommodate incomplete test mocks.

### 2. Recovery must mean success

- Priority: P2.
- TODO references: Phase 1 Retry Flow, step 8; Phase 2 Fetch Result Changes and recovery logging.
- Step 8 logs recovery for any retry result other than 503. That includes HTTP 500, network failures, and XML parsing failures.
- PRD v04 requires recovery logging when the retry succeeds. False recovery entries would undermine the primary purpose of gathering reliable diagnostic evidence.
- The current successful `fetchRssItems()` return also omits `statusCode` (`worker-node/src/modules/jobs/requestGoogleRssJob.ts`, lines 261–264). The listed new result fields do not explicitly correct this, although recovery logs require the HTTP status.

Required correction:

1. Log recovery only when the retry result has `status === 'success'`.
2. Route other non-503 outcomes through the existing error handling without calling them recovery.
3. Explicitly retain the numeric HTTP status on successful fetch results, alongside the new response metadata, so recovery entries contain the actual status.
4. Extend the already planned 503-then-500 test to assert no recovery log. Have the planned recovery-log test assert the numeric successful HTTP status.

## Scope of Review

- No code, PRD, or todo was modified.
- No tests or production operations were run. These findings follow from the todo instructions and current source.
