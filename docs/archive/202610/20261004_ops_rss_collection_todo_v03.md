---
created_at: 2026-10-04T18:25:13Z
updated_at: 2026-10-04T18:25:13Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Todo V03

Authoritative requirements: `docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v10.md`

Source plan: `docs/weekly-article-pipeline-v02/20261004_ops_rss_collection_plan_v06.md`

## Phase 1: Extend the Typed Run Model

- [ ] Confirm the implementation follows PRD V10 and Plan V06 before changing code.
- [ ] Add nullable `newsApiRequestIdHighWaterMark` and `articleIdHighWaterMark` fields to `WeeklyArticleFlowRun02`.
- [ ] Use integer types consistent with the IDs in `NewsApiRequests` and `Articles`.
- [ ] Keep both fields null before Phase 4 and document their immutability after Phase 4 starts.
- [ ] Export the fields through the existing db-model initialization and serialization patterns.
- [ ] Extend the ops `WeeklyFlowRunRecord`, persistence field types, Sequelize conversion, and database-free fixtures.
- [ ] Add model or adapter validation for safe integer values and null pre-Phase-4 values.
- [ ] Do not add per-query result columns or an open-ended RSS history structure.
- [ ] Run `npm run build --workspace @newsnexus/db-models` and fix failures.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Review the code and schema diff for unrelated changes.
- [ ] Check off completed Phase 1 tasks and commit the typed model changes using the repository commit-message guidance.

## Phase 2: Add Phase 4 Persistence Operations

- [ ] Add an injected operation that reads `MAX(NewsApiRequests.id)` and `MAX(Articles.id)`, using zero for an empty table.
- [ ] Persist both high-water marks with the Phase 4 start before any worker-node request.
- [ ] Reject recalculation or replacement of persisted high-water marks during continuation.
- [ ] Add a focused progress operation for `rssJobId`, compact status, and timestamps without marking Phase 4 complete.
- [ ] Recover `firstRssRequestId` as the lowest post-mark Google News RSS request when one exists.
- [ ] Recover `firstRssArticleId` as the lowest Article associated with a post-mark Google News RSS request when one exists.
- [ ] Count all Articles with `id > articleIdHighWaterMark`, regardless of source.
- [ ] Validate IDs and counts as non-negative safe integers.
- [ ] Preserve an unknown RSS-added result as unknown rather than converting it to zero.
- [ ] Prevent a later zero worker result from erasing an earlier persisted nonzero result.
- [ ] Add a nonzero Phase 4 completion operation that leaves the run incomplete.
- [ ] Add one atomic zero-work operation that completes Phase 4 and the run in one database update.
- [ ] Add database-free persistence tests for high-water capture, immutability, recovered RSS IDs, broad Article counting, count preservation, ordered transitions, and both completion paths.
- [ ] Add a test proving atomic failure leaves neither Phase 4 nor run completion persisted.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 2 tasks and commit the persistence changes using the repository commit-message guidance.

## Phase 3: Build the Worker-Node RSS Client

- [ ] Add the worker-node base URL and validated Phase 4 settings to `OpsConfig` and `ops/.env.example`.
- [ ] Configure a 5-minute poll interval, 60-second per-request timeout, 2 tolerated consecutive transient status failures, and 24-hour per-job limit.
- [ ] Add typed request and response parsing for `POST /request-google-rss/start-job`.
- [ ] Omit `targetArticlesAddedCount` and use the worker's default 72-hour repeat window.
- [ ] Add typed status parsing for `GET /queue-info/check-status/:jobId`.
- [ ] Require the RSS endpoint name and valid `createdAt`; require valid `endedAt` for terminal jobs.
- [ ] Reject a saved job created before Phase 4 started or belonging to another endpoint.
- [ ] Add typed cancellation parsing for `POST /queue-info/cancel_job/:jobId`.
- [ ] Accept only `canceled` and `cancel_requested` cancellation outcomes as successful cancellation responses.
- [ ] When cancellation reports the job missing, perform one follow-up status lookup.
- [ ] Treat follow-up status 404 as unavailable and eligible for replacement.
- [ ] Treat a follow-up terminal status as confirmed inactive and eligible for replacement, but never trust its late result.
- [ ] Treat an unverified follow-up lookup as a stop condition without replacement.
- [ ] Distinguish transient failures, permanent failures, malformed responses, unsuccessful results, job timeouts, cancellation failures, and unverified outcomes.
- [ ] Add deterministic clock and delay dependencies so polling and 24-hour behavior can be tested without real waiting.
- [ ] Test non-overlapping polling and reset of the transient-failure counter after a valid response.
- [ ] Test stopping on the third consecutive transient failure.
- [ ] Test `queued`, `running`, `completed`, `failed`, and `canceled` statuses.
- [ ] Test `queries_exhausted`, `error`, `rate_limited`, and invalid `target_articles_collected` results.
- [ ] Test duration with `endedAt - createdAt` below, exactly at, and above 24 hours.
- [ ] Test queued cancellation, active cancellation, verified terminal cancellation, and failed cancellation.
- [ ] Test all three missing-job follow-up outcomes: 404, terminal status, and unverified lookup.
- [ ] Confirm detailed worker `queryResults` are not returned for persistence.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm -C worker-node run build` and `npm -C worker-node test` to verify the consumed contract remains valid.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 3 tasks and commit the RSS client changes using the repository commit-message guidance.

## Phase 4: Implement the Independently Runnable Phase Module

- [ ] Add the Phase 4 module under `ops/src/weekly-flow-02/phases/` with focused functions and descriptive types.
- [ ] Accept selected run state, configuration, persistence operations, worker client, clock, and delay through explicit dependencies.
- [ ] Reuse an existing saved job before starting another.
- [ ] Monitor an on-time queued or running job.
- [ ] Process only an on-time `completed` job with `endingReason = queries_exhausted` as verified success.
- [ ] Treat individual query failures or empty results as nonfatal when the overall result is `queries_exhausted`.
- [ ] Treat `error`, `rate_limited`, `failed`, `worker_restart`, and `canceled` as unsuccessful or unverified.
- [ ] Cancel a queued or running job after it exceeds 24 hours.
- [ ] After `cancel_requested`, wait one poll interval and verify the job is no longer active.
- [ ] Never trust a timed-out job's result, including a late successful result.
- [ ] Apply the missing-job follow-up branches from PRD V10 before deciding replacement eligibility.
- [ ] Start one replacement only after the earlier job is confirmed inactive and the invocation has not already started an RSS job.
- [ ] Stop after verified cancellation when the current invocation originally started the timed-out job.
- [ ] Use existing repeat suppression for replacements; do not add coordinator deduplication or idempotency keys.
- [ ] After verified success, recover RSS markers and calculate the broad Article count from PostgreSQL.
- [ ] Return a typed zero-work or nonzero result without exposing detailed query history.
- [ ] Add module tests for saved-job monitoring, result recovery, cancellation, every follow-up lookup branch, replacement eligibility, one-start enforcement, worker restart, zero-result replacement, and both count outcomes.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 4 tasks and commit the Phase 4 module using the repository commit-message guidance.

## Phase 5: Connect Phase 4 to the Coordinator

- [ ] Extend coordinator dependencies with the Phase 4 module and persistence operations.
- [ ] Replace the Phase 4 boundary return while preserving continuation past completed Phases 1–3.
- [ ] For a new Phase 4, persist both high-water marks with Phase 4 start before any worker call.
- [ ] For continuation, reuse the original marks and saved job ID.
- [ ] Apply worker identity, timestamps, polling, terminal mapping, timeout, cancellation, follow-up lookup, and replacement rules.
- [ ] Enforce at most one RSS start per coordinator invocation.
- [ ] Route Phase 4 failures through the existing failure recorder with `phase: 4`.
- [ ] Never convert an unavailable or unverified worker outcome into healthy zero-work.
- [ ] For verified `articleCount = 0`, use the atomic Phase 4 and run completion operation.
- [ ] For verified `articleCount > 0`, complete Phase 4, keep the run incomplete, and log the Phase 5 boundary.
- [ ] Log run ID, phase, safe job ID, durations, cancellation outcome, recovery action, RSS-added result when known, broad Article count, elapsed time, and actionable errors.
- [ ] Keep per-query details in logs rather than run-table metadata.
- [ ] Extend coordinator tests for phase ordering, recent continuation, per-job timeouts, cancellation, every missing-job follow-up branch, replacement, worker restart, broad counting, zero work, persistence failures, and the Phase 5 boundary.
- [ ] Test continuation more than 24 hours after original Phase 4 start but within 72 hours of `runStartedAt`.
- [ ] Test that a timed-out active job prevents replacement until confirmed inactive.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 5 tasks and commit the coordinator integration using the repository commit-message guidance.

## Phase 6: Perform the Schema Rollout

- [ ] Coordinate the development-database schema window with the operator before destructive schema work.
- [ ] Take the replenish backup using the old db-model build so backup code does not reference missing columns.
- [ ] Build the new db-model version containing both high-water fields.
- [ ] Follow the established backup, drop, create, and replenish process.
- [ ] Verify `WeeklyArticleFlowRuns02` contains both new nullable typed columns.
- [ ] Verify the application role has the required table and sequence access.
- [ ] Verify db-manager and API backup paths after the rebuilt schema is ready.
- [ ] Do not point automated tests at `newsnexus_dev` or `newsnexus_prod`.
- [ ] Record the verified rollout outcome in the appropriate weekly-flow-v02 documentation.
- [ ] Review generated or changed files before staging.
- [ ] Check off completed Phase 6 tasks and commit only intended rollout documentation or source changes using the repository commit-message guidance.

## Phase 7: Document and Verify the Increment

- [ ] Update `ops/README.md` with worker endpoints, settings, high-water boundaries, broad Article batch, identity validation, timestamp timing, cancellation, follow-up lookup outcomes, continuation, terminal mapping, logging, zero-work completion, and the Phase 5 boundary.
- [ ] Explain how an operator can inspect and clear a stuck worker-node job.
- [ ] Document that a timed-out result is never trusted, including a late terminal result found after cancellation reports the job missing.
- [ ] Document the possible late-commit exclusion below the Article high-water mark.
- [ ] Confirm the README does not claim Phase 5 or the full weekly flow is implemented.
- [ ] Confirm default ops tests use injected worker and persistence fakes and make no live database or worker calls.
- [ ] Run `npm run build --workspace @newsnexus/db-models` and fix failures.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm -C worker-node run build` and `npm -C worker-node test` and fix contract regressions.
- [ ] Inspect the final diff against PRD V10 and Plan V06.
- [ ] Demonstrate database-free Phase 4 tests and explain high-water recovery, job timing, cancellation, replacement, broad counting, zero work, and the Phase 5 boundary to the operator.
- [ ] Check off completed Phase 7 tasks and commit the final documentation and verification changes using the repository commit-message guidance.
