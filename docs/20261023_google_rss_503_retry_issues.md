---
created_at: 2026-10-23T22:26:39Z
updated_at: 2026-10-23T22:26:39Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Google RSS 503 Retry Issues

## Overview

This lists the known issues in implementing and running [PRD v04](20261023_google_rss_503_retry_prd_v04.md) through [TODO v01](20261023_google_rss_503_retry_todo_v01.md).

- Test issues affect only the implementing agent's work before deployment.
- Other issues affect deployment, the next weekly run, or what the result can tell us.
- The TODO already handles every test issue. None of them blocks the work.

## Test Issues

### 1. Existing 503 tests would hang

- Two existing tests mock a 503 response.
- After the change, each 503 waits `MINUTES_IN_BETWEEN_REQUESTS_RETRY`, which defaults to 120 minutes.
- Without a setting, those tests wait until Jest's 15-second timeout and fail.
- Fix: set `MINUTES_IN_BETWEEN_REQUESTS_RETRY='0.001'` (about 60 ms) in the test setup.
- These tests already exist, so this update cannot be skipped.

### 2. Fetch mocks have no headers or body

- Existing mocks return a plain object with only `ok`, `status`, and `text`.
- The new 503 capture reads `headers`, `body`, `url`, and `redirected`, which those mocks lack.
- Fix: 503 tests use a real `new Response(...)` object, which Node provides.
- Without this, the capture code fails or logs empty data in tests.

### 3. PRD says tests should avoid the database

- The job writes `NewsApiRequest` and `Article` rows, so job-level tests cannot avoid the database.
- The existing test file already uses a local test Postgres database, created by `tests/globalSetup.js`.
- Fix: follow the existing setup. The TODO says so.
- The implementing agent's machine needs local Postgres running, as the existing suite already does.

### 4. PRD asks for fake timers

- Jest fake timers do not mix well with the real database awaits in this test file.
- Fix: use real timers with very short waits set through the environment, matching how the existing tests handle `MILISECONDS_IN_BETWEEN_REQUESTS`.
- The behavior tested is the same. Only the clock mechanism differs.

### 5. Invalid-setting tests use the 120-minute default

- An invalid `MINUTES_IN_BETWEEN_REQUESTS_RETRY` falls back to 120 minutes, so a test of that fallback would really wait.
- Fix: check only the warning and the logged delay, then cancel the job before the wait completes.
- Optional: skip these tests if they prove awkward. The parsing logic is small.

## Other Issues

### 1. Deployment must happen before October 30

- The next scheduled weekly run is October 30, 2026 at 12:00 UTC.
- If the code is not deployed by then, the run fails the same way and captures nothing new.

### 2. Worker-node restart is still pending

- `LOG_MAX_SIZE=20` and `LOG_MAX_FILES=5` are set in the production `.env`.
- Worker-node reads them only at startup.
- The deployment restart applies both the new code and these settings. Confirm it happens.

### 3. Logs must be copied soon after the run

- Retention is about 100 MB across five rotating files.
- If a retry succeeds, hundreds more queries are logged after the 503, and the item-level logging volume per query is not measured.
- The 503 entries could rotate out if the logs sit for weeks.
- Action: copy the worker-node log files right after the run.

### 4. The weekly run will likely still fail

- If the limit is near 750 requests, a 2-hour wait may not clear it, and the retry fails.
- If the retry succeeds, a second block near query 1,500 is likely. That query also gets one retry.
- Either failure stops Phase 4, so Phases 5–7 do not run.
- Expect a manual continuation again. The main value of this run is the captured response.

### 5. The queue is blocked during each wait

- Worker-node runs one job at a time.
- During a 2-hour wait, any job started from the portal waits in the queue.
- You accepted this for the weekly run, but portal users may see delays.

### 6. Run 4 is still incomplete

- Run 4 stopped in Phase 4, and this change does not recover it.
- Manual continuation is only allowed within 72 hours of the run start, which closes around October 26 at 12:00 UTC.
- After that, decide whether to leave run 4 incomplete or recover it another way. That decision is separate from this TODO.

### 7. One retry with these diagnostics may not prove the cause

- Google's 503 may have no rate-limit headers and only a generic error page.
- If so, the logs narrow the cause but do not prove it.
- The next step would then be a decision outside this PRD, such as reducing query volume or splitting the weekly run.
