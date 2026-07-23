---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Phase 5 Validation

## 1. Validation outcome

- Phase 5 automated validation passed.
- V02 remains advisory and writes only V02 run, prediction, prompt, and review data.
- V01 backend routes remain available.
- V01 configuration errors no longer prevent worker startup.
- V01 portal entry points are hidden while V01 review data remains available.

## 2. Full validation matrix

1. db-models

   - Command: `cd db-models && npm run build`
   - Result: passed

2. db-manager

   - Command: `cd db-manager && npm run build`
   - Result: passed
   - Command: `PG_DATABASE=newsnexus_test_db_manager_v02 npm test -- --runInBand`
   - Result: 13 suites and 211 tests passed
   - The dedicated database avoided an unrelated ownership conflict in the default local test database.

3. worker-python

   - Command: `PG_DATABASE=newsnexus_test_worker_python_v02 ./venv/bin/pytest`
   - Result: 201 tests passed
   - Expected result includes 40 existing psycopg pool deprecation warnings.

4. API

   - Command: `cd api && npm run build`
   - Result: passed
   - Command: `cd api && npm test -- --runInBand`
   - Result: 26 suites and 183 tests passed

5. portal

   - Command: `cd portal && npm run lint`
   - Result: passed with zero warnings
   - Command: `cd portal && npm run build`
   - Result: passed
   - The build requires network access because the existing layout downloads the Outfit Google font.

## 3. Scenario evidence

1. Preview through persistence

   - A database-backed test previews, accepts, executes, and persists a completed prediction.
   - The same test verifies final run counts and confirms no `ArticleApproveds` row is created.
   - Worker route tests verify queue submission, status, cancellation, and typed errors.

2. Retry and prompt behavior

   - A failed row is updated in place on its second attempt.
   - Human validation and comments survive the retry.
   - Completed and twice-attempted rows cannot be selected or written again.
   - Retries keep their original prompt while new articles use the accepted run prompt.

3. Selection safety

   - Tests cover both modes, boundary crossing, missing boundaries, zero eligible results, and frozen content.
   - Tests cover cancellation, alternating circuit-breaker failures, stale previews, and concurrent acceptance.

4. API and product isolation

   - API tests cover prompt immutability, activation, duplicate titles, prediction reads, and independent review updates.
   - Backup and import tests cover all three V02 models in dependency-safe order.
   - Full worker and API regression suites verify existing routes remain operational.

5. Portal verification

   - Browser verification covered V02 automation rendering, V01 not-found routing, and review-column defaults.
   - V02 state transitions are backed by worker and API tests because browser QA did not execute a live Codex call.

## 4. Intentionally unavailable checks

- No live Codex CLI model call was made.
- No production database backup, schema installation, deployment, or smoke test was performed.
- These actions require the explicit operator approvals retained in Phase 6.
