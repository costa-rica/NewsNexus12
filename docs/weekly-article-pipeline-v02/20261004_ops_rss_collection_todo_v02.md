---
created_at: 2026-10-04T18:16:36Z
updated_at: 2026-10-04T18:16:36Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Todo V02

Source plan: `docs/weekly-article-pipeline-v02/20261004_ops_rss_collection_plan_v06.md`

## Phase 1: Align the Authoritative Requirements

- [ ] Create the next weekly-flow-v02 PRD version without overwriting V09.
- [ ] Carry forward the unchanged V09 requirements.
- [ ] Replace the Phase 4 count boundary with immutable request and Article high-water marks.
- [ ] State that downstream `articleCount` includes every Article above `articleIdHighWaterMark`, regardless of source.
- [ ] Define healthy zero-work as an on-time verified RSS success with no Articles above the Article mark.
- [ ] Add the two-tier timing policy: 24 hours per RSS job and the existing 72-hour run continuation window.
- [ ] Define timely terminal success as `endedAt - createdAt <= 24 hours`.
- [ ] Add timed-out queued or running job cancellation and verified inactivity before replacement.
- [ ] Preserve the one-RSS-start-per-coordinator-invocation rule.
- [ ] Record the accepted worker statuses, terminal outcomes, and cancellation responses.
- [ ] Confirm the new PRD remains consistent with the Phase 1–3 recovery rules and Phase 5 boundary.
- [ ] Review the new PRD with the operator before implementation begins.
- [ ] Review the documentation diff for unrelated changes.
- [ ] Check off completed Phase 1 tasks and commit the requirements update using the repository commit-message guidance.

## Phase 2: Extend the Typed Run Model

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
- [ ] Check off completed Phase 2 tasks and commit the typed model changes using the repository commit-message guidance.

## Phase 3: Add Phase 4 Persistence Operations

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
- [ ] Check off completed Phase 3 tasks and commit the persistence changes using the repository commit-message guidance.

## Phase 4: Build the Worker-Node RSS Client

- [ ] Add the worker-node base URL and validated Phase 4 configuration values to `OpsConfig` and `ops/.env.example`.
- [ ] Configure a 5-minute poll interval, 60-second per-request timeout, 2 tolerated consecutive transient status failures, and 24-hour per-job limit.
- [ ] Add typed request and response parsing for `POST /request-google-rss/start-job`.
- [ ] Omit `targetArticlesAddedCount` and use the worker's default 72-hour repeat window.
- [ ] Add typed status parsing for `GET /queue-info/check-status/:jobId`.
- [ ] Require the RSS endpoint name and valid `createdAt`; require valid `endedAt` for terminal jobs.
- [ ] Reject a saved job created before Phase 4 started or belonging to another endpoint.
- [ ] Add typed cancellation parsing for `POST /queue-info/cancel_job/:jobId`.
- [ ] Accept only `canceled` and `cancel_requested` cancellation outcomes.
- [ ] Distinguish transient request failures, permanent request failures, malformed responses, unsuccessful terminal results, job timeouts, cancellation failures, and unverified outcomes.
- [ ] Add deterministic clock and delay dependencies so polling and 24-hour behavior can be tested without real waiting.
- [ ] Test non-overlapping polling and reset of the transient-failure counter after a valid response.
- [ ] Test stopping on the third consecutive transient failure.
- [ ] Test `queued`, `running`, `completed`, `failed`, and `canceled` statuses.
- [ ] Test `queries_exhausted`, `error`, `rate_limited`, and invalid `target_articles_collected` results.
- [ ] Test duration with `endedAt - createdAt` below, exactly at, and above 24 hours.
- [ ] Test cancellation of queued and active jobs, terminal cancellation verification, missing jobs, and failed or unverified cancellation.
- [ ] Confirm detailed worker `queryResults` are validated only as needed and are not returned for persistence.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm -C worker-node run build` and `npm -C worker-node test` to verify the consumed contract remains valid.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 4 tasks and commit the RSS client changes using the repository commit-message guidance.

## Phase 5: Implement the Independently Runnable Phase Module

- [ ] Add the Phase 4 module under `ops/src/weekly-flow-02/phases/` with focused functions and descriptive types.
- [ ] Accept the selected run state, Phase 4 configuration, persistence operations, worker client, clock, and delay through explicit dependencies.
- [ ] Reuse an existing saved job before starting another.
- [ ] Monitor an on-time queued or running job.
- [ ] Process only an on-time `completed` job with `endingReason = queries_exhausted` as verified success.
- [ ] Treat individual query failures or empty results as nonfatal when the overall result is `queries_exhausted`.
- [ ] Treat `error`, `rate_limited`, `failed`, `worker_restart`, and `canceled` as unsuccessful or unverified outcomes.
- [ ] Cancel a queued or running job after it exceeds 24 hours.
- [ ] After `cancel_requested`, wait one poll interval and verify the job is no longer active.
- [ ] Never trust a timed-out job's result, even if it later reports completion.
- [ ] Start one replacement only after the earlier job is confirmed inactive and the current invocation has not already started an RSS job.
- [ ] Stop after verified cancellation when the current invocation originally started the timed-out job.
- [ ] Use existing repeat suppression for every replacement; do not add coordinator deduplication or idempotency keys.
- [ ] After verified success, recover RSS markers and calculate the broad Article count from PostgreSQL.
- [ ] Return a typed zero-work or nonzero completion result without exposing detailed query history.
- [ ] Add module tests for saved-job monitoring, completed-job recovery, cancellation, replacement eligibility, one-start enforcement, worker restart, zero-result replacement, and both count outcomes.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 5 tasks and commit the Phase 4 module using the repository commit-message guidance.

## Phase 6: Connect Phase 4 to the Coordinator

- [ ] Extend coordinator dependencies with the Phase 4 module and persistence operations.
- [ ] Replace the Phase 4 boundary return while preserving continuation past completed Phases 1–3.
- [ ] For a new Phase 4, persist both high-water marks with Phase 4 start before any worker call.
- [ ] For continuation, reuse the original marks and saved job ID.
- [ ] Apply the worker identity, timestamp, polling, terminal, timeout, cancellation, and replacement rules.
- [ ] Enforce at most one RSS start per coordinator invocation.
- [ ] Route Phase 4 failures through the existing failure recorder with `phase: 4`.
- [ ] Never convert an unavailable or unverified worker outcome into healthy zero-work.
- [ ] For verified `articleCount = 0`, use the atomic Phase 4 and run completion operation.
- [ ] For verified `articleCount > 0`, complete Phase 4, keep the run incomplete, and log the Phase 5 boundary.
- [ ] Log run ID, phase, safe job ID, durations, cancellation outcome, recovery action, RSS-added result when known, broad Article count, elapsed time, and actionable errors.
- [ ] Keep per-query details in worker or coordinator logs rather than run-table metadata.
- [ ] Extend coordinator tests for phase ordering, recent continuation, fresh per-job timeouts, cancellation branches, replacement branches, worker restart, broad counting, zero work, persistence failures, and the Phase 5 boundary.
- [ ] Add a test for continuation more than 24 hours after original Phase 4 start but within 72 hours of `runStartedAt`.
- [ ] Add a test proving a timed-out active job prevents an unverified replacement.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Review the diff for unrelated changes.
- [ ] Check off completed Phase 6 tasks and commit the coordinator integration using the repository commit-message guidance.

## Phase 7: Perform the Schema Rollout

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
- [ ] Check off completed Phase 7 tasks and commit only the intended rollout documentation or source changes using the repository commit-message guidance.

## Phase 8: Document and Verify the Increment

- [ ] Update `ops/README.md` with the worker endpoints, settings, high-water boundary, broad Article batch, job identity validation, timestamp-based timing, cancellation, continuation, terminal mapping, logging, zero-work completion, and Phase 5 boundary.
- [ ] Explain how an operator can inspect and clear a stuck worker-node job.
- [ ] Document that a timed-out result is never trusted.
- [ ] Document the possible late-commit exclusion below the Article high-water mark.
- [ ] Confirm the README does not claim Phase 5 or the full weekly flow is implemented.
- [ ] Confirm default ops tests use injected worker and persistence fakes and make no live database or worker calls.
- [ ] Run `npm run build --workspace @newsnexus/db-models` and fix failures.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm -C worker-node run build` and `npm -C worker-node test` and fix any contract regressions.
- [ ] Inspect the final diff against Plan V06 and the updated authoritative PRD.
- [ ] Demonstrate the database-free Phase 4 tests and explain high-water recovery, job timing, cancellation, replacement, broad counting, zero work, and the Phase 5 boundary to the operator.
- [ ] Check off completed Phase 8 tasks and commit the final documentation and verification changes using the repository commit-message guidance.
