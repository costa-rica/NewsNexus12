---
created_at: 2026-10-04T19:12:33Z
updated_at: 2026-10-04T19:26:14Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Ops RSS Collection Todo V04

Authoritative requirements: `docs/weekly-article-pipeline-v02/20261003_weekly_combined_flow_prd_v10.md`

Source plan: `docs/weekly-article-pipeline-v02/20261004_ops_rss_collection_plan_v06.md`

## Phase 1: Extend the Typed Run Model

- [x] Confirm the implementation follows PRD V10 and Plan V06 before changing code.
- [x] Add nullable `newsApiRequestIdHighWaterMark` and `articleIdHighWaterMark` fields to `WeeklyArticleFlowRun02`.
- [x] Use integer types consistent with the IDs in `NewsApiRequests` and `Articles`.
- [x] Keep both fields null before Phase 4 and document their immutability after Phase 4 starts.
- [x] Export the fields through the existing db-model initialization and serialization patterns.
- [x] Extend the ops `WeeklyFlowRunRecord`, persistence field types, Sequelize conversion, and database-free fixtures.
- [x] Add model or adapter validation for safe integer values and null pre-Phase-4 values.
- [x] Do not add per-query result columns or an open-ended RSS history structure.
- [x] Run `npm run build --workspace @newsnexus/db-models` and fix failures.
- [x] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [x] Review the code and schema diff for unrelated changes.
- [x] Check off completed Phase 1 tasks and commit the typed model changes using the repository commit-message guidance.

## Phase 2: Add Phase 4 Persistence Operations

- [x] Add an injected operation that reads `MAX(NewsApiRequests.id)` and `MAX(Articles.id)`, using zero for an empty table.
- [x] Persist both high-water marks with the Phase 4 start before any worker-node request.
- [x] Reject recalculation or replacement of persisted high-water marks during continuation.
- [x] Add a focused progress operation for `rssJobId`, compact status, and timestamps without marking Phase 4 complete.
- [x] Recover `firstRssRequestId` as the lowest post-mark request whose source satisfies `NewsArticleAggregatorSources.nameOfOrg = 'Google News RSS'`.
- [x] Recover `firstRssArticleId` as the lowest Article associated with those post-mark Google News RSS requests.
- [x] Define the exact source name once in ops and add a test asserting the literal value `'Google News RSS'`.
- [x] Count all Articles with `id > articleIdHighWaterMark`, regardless of source.
- [x] Validate IDs and counts as non-negative safe integers, including database drivers returning `BIGINT` aggregates as strings.
- [x] Preserve an unknown RSS-added result as unknown rather than converting it to zero.
- [x] Prevent a later zero worker result from erasing an earlier persisted nonzero result.
- [x] Add a nonzero Phase 4 completion operation that leaves the run incomplete.
- [x] Add one atomic zero-work operation that completes Phase 4 and the run in one database update.
- [x] Add database-free persistence tests for empty-table `MAX`, string aggregate conversion, high-water capture, immutability, exact source matching, recovered RSS IDs, broad Article counting, count preservation, ordered transitions, and both completion paths.
- [x] Add a test proving atomic failure leaves neither Phase 4 nor run completion persisted.
- [x] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [x] Review the diff for unrelated changes.
- [x] Check off completed Phase 2 tasks and commit the persistence changes using the repository commit-message guidance.

## Phase 3: Build the Worker-Node RSS Client

- [x] Add the worker-node base URL and validated Phase 4 settings to `OpsConfig` and `ops/.env.example`.
- [x] Configure a 5-minute poll interval, 60-second per-request timeout, 2 tolerated consecutive transient status failures, and 24-hour per-job limit.
- [x] Add typed request and response parsing for `POST /request-google-rss/start-job`.
- [x] Omit `targetArticlesAddedCount` and use the worker's default 72-hour repeat window.
- [x] Add typed status parsing for `GET /queue-info/check-status/:jobId`.
- [x] Require the RSS endpoint name and valid `createdAt`; require valid `endedAt` for terminal jobs.
- [x] Reject a saved job created before Phase 4 started or belonging to another endpoint.
- [x] Add typed cancellation parsing for `POST /queue-info/cancel_job/:jobId`.
- [x] Accept only `canceled` and `cancel_requested` as successful cancellation responses.
- [x] When cancellation reports the job missing, perform one follow-up status lookup.
- [x] Treat follow-up status 404 as unavailable and replacement-eligible.
- [x] Treat a follow-up terminal status as confirmed inactive and replacement-eligible, but never trust its late result.
- [x] Treat an unverified follow-up lookup as a stop condition without replacement.
- [x] Distinguish transient failures, permanent failures, malformed responses, unsuccessful results, job timeouts, cancellation failures, and unverified outcomes.
- [x] Add deterministic clock and delay dependencies so polling and 24-hour behavior can be tested without real waiting.
- [x] Test non-overlapping polling and reset of the transient-failure counter after a valid response.
- [x] Test stopping on the third consecutive transient failure.
- [x] Test `queued`, `running`, `completed`, `failed`, and `canceled` statuses.
- [x] Test `queries_exhausted`, `error`, `rate_limited`, and invalid `target_articles_collected` results.
- [x] Test duration with `endedAt - createdAt` below, exactly at, and above 24 hours.
- [x] Test queued cancellation, active cancellation, verified terminal cancellation, and failed cancellation.
- [x] Test all three missing-job follow-up outcomes: 404, terminal status, and unverified lookup.
- [x] Confirm detailed worker `queryResults` are not returned for persistence.
- [x] Add every new compiled ops test file to the explicit test-file list in `ops/package.json`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm -C worker-node run build` and `npm -C worker-node test` to verify the consumed contract remains valid.
- [x] Review the diff for unrelated changes.
- [x] Check off completed Phase 3 tasks and commit the RSS client changes using the repository commit-message guidance.

## Phase 4: Implement the Independently Runnable Phase Module

- [x] Add the Phase 4 module under `ops/src/weekly-flow-02/phases/` with focused functions and descriptive types.
- [x] Accept selected run state, configuration, persistence operations, worker client, clock, and delay through explicit dependencies.
- [x] Reuse an existing saved job before starting another.
- [x] Monitor an on-time queued or running job.
- [x] Process only an on-time `completed` job with `endingReason = queries_exhausted` as verified success.
- [x] Treat individual query failures or empty results as nonfatal when the overall result is `queries_exhausted`.
- [x] Treat `error`, `rate_limited`, `failed`, `worker_restart`, and `canceled` as unsuccessful or unverified.
- [x] Cancel a queued or running job after it exceeds 24 hours.
- [x] After `cancel_requested`, wait one poll interval and verify the job is no longer active.
- [x] Never trust a timed-out job's result, including a late successful result.
- [x] Apply the missing-job follow-up branches from PRD V10 before deciding replacement eligibility.
- [x] Start one replacement only after the earlier job is confirmed inactive and the invocation has not already started an RSS job.
- [x] Stop after verified cancellation when the current invocation originally started the timed-out job.
- [x] Use existing repeat suppression for replacements; do not add coordinator deduplication or idempotency keys.
- [x] After verified success, recover RSS markers and calculate the broad Article count from PostgreSQL.
- [x] Return a typed zero-work or nonzero result without exposing detailed query history.
- [x] Add module tests for saved-job monitoring, result recovery, cancellation, every follow-up lookup branch, replacement eligibility, one-start enforcement, worker restart, zero-result replacement, and both count outcomes.
- [x] Add every new compiled module test file to the explicit test-file list in `ops/package.json`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [x] Review the diff for unrelated changes.
- [x] Check off completed Phase 4 tasks and commit the Phase 4 module using the repository commit-message guidance.

## Phase 5: Connect Phase 4 to the Coordinator

- [x] Extend coordinator dependencies with the Phase 4 module and persistence operations.
- [x] Replace the Phase 4 boundary return while preserving continuation past completed Phases 1–3.
- [x] For a new Phase 4, persist both high-water marks with Phase 4 start before any worker call.
- [x] For continuation, reuse the original marks and saved job ID.
- [x] Apply worker identity, timestamps, polling, terminal mapping, timeout, cancellation, follow-up lookup, and replacement rules.
- [x] Enforce at most one RSS start per coordinator invocation.
- [x] Route Phase 4 failures through the existing failure recorder with `phase: 4`.
- [x] Never convert an unavailable or unverified worker outcome into healthy zero-work.
- [x] For verified `articleCount = 0`, use the atomic Phase 4 and run completion operation.
- [x] For verified `articleCount > 0`, complete Phase 4, keep the run incomplete, and log the Phase 5 boundary.
- [x] Log run ID, phase, safe job ID, durations, cancellation outcome, recovery action, RSS-added result when known, broad Article count, elapsed time, and actionable errors.
- [x] Keep per-query details in logs rather than run-table metadata.
- [x] Extend coordinator tests for phase ordering, recent continuation, per-job timeouts, cancellation, every missing-job follow-up branch, replacement, worker restart, broad counting, zero work, persistence failures, and the Phase 5 boundary.
- [x] Test continuation more than 24 hours after original Phase 4 start but within 72 hours of `runStartedAt`.
- [x] Test that a timed-out active job prevents replacement until confirmed inactive.
- [x] Add every new compiled coordinator test file to the explicit test-file list in `ops/package.json`.
- [x] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [x] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [x] Review the diff for unrelated changes.
- [x] Check off completed Phase 5 tasks and commit the coordinator integration using the repository commit-message guidance.

## Phase 6: Perform the Development Schema Rollout

- [ ] Coordinate the development-server schema window with the operator before destructive schema work.
- [ ] On the server, do not build or deploy new db-models, db-manager, API, or ops code that exports the new model before the old-build replenish backup is complete.
- [ ] Take the replenish backup using the old db-model build so backup code does not reference missing columns.
- [ ] Build the new db-model version containing both high-water fields only after that backup is verified.
- [ ] Follow the established drop, create, and replenish process.
- [ ] Verify `WeeklyArticleFlowRuns02` contains both new nullable typed columns.
- [ ] Verify the application role can read and write `WeeklyArticleFlowRuns02`, read `NewsApiRequests`, `Articles`, and `NewsArticleAggregatorSources`, and access required sequences.
- [ ] Verify db-manager and API backup paths after the rebuilt schema is ready.
- [ ] Do not point automated tests at `newsnexus_dev` or `newsnexus_prod`.
- [ ] Record the verified rollout outcome in the appropriate weekly-flow-v02 documentation.
- [ ] Review generated or changed files before staging.
- [ ] Check off completed Phase 6 tasks and commit only intended rollout documentation or source changes using the repository commit-message guidance.

## Phase 7: Document and Run Final Automated Verification

- [ ] Update `ops/README.md` with worker endpoints, settings, high-water boundaries, broad Article batch, exact Google News RSS source name, identity validation, timestamp timing, cancellation, follow-up outcomes, continuation, terminal mapping, logging, zero-work completion, and the Phase 5 boundary.
- [ ] Explain how an operator can inspect and clear a stuck worker-node job.
- [ ] Document that a timed-out result is never trusted, including a late terminal result found after cancellation reports the job missing.
- [ ] Document the possible late-commit exclusion below the Article high-water mark.
- [ ] Confirm the README does not claim Phase 5 or the full weekly flow is implemented.
- [ ] Confirm default Mac and CI tests use injected worker and persistence fakes and make no live database or worker calls.
- [ ] Do not add local Mac PostgreSQL or worker-node integration infrastructure in this increment.
- [ ] Run `npm run build --workspace @newsnexus/db-models` and fix failures.
- [ ] Run `npm run typecheck --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm test --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm run build --workspace newsnexus12-ops` and fix failures.
- [ ] Run `npm -C worker-node run build` and `npm -C worker-node test` and fix contract regressions.
- [ ] Inspect the final diff against PRD V10 and Plan V06.
- [ ] Demonstrate the database-free Phase 4 tests and explain high-water recovery, job timing, cancellation, replacement, broad counting, zero work, and the Phase 5 boundary to the operator.
- [ ] Check off completed Phase 7 tasks and commit the final documentation and automated-verification changes using the repository commit-message guidance.

## Phase 8: Verify Phase 4 on the Ubuntu Development Server

- [ ] Stop before the live checkpoint and schedule it with the operator; RSS can run for many hours and each job has a 24-hour limit.
- [ ] Confirm the exact branch and commit intended for the development server.
- [ ] Confirm the schema rollout and application-role permissions from Phase 6 are complete.
- [ ] Confirm the worker-node URL and health, configured RSS spreadsheet path, coordinator environment, and guarded launch path.
- [ ] Confirm no other worker-node job is queued or running before starting the checkpoint.
- [ ] Choose with the operator whether to continue an eligible run at Phase 4 or start a new run that repeats Phases 1–3.
- [ ] Run the guarded weekly flow once on the Ubuntu development server.
- [ ] Record the persisted request and Article high-water marks and RSS job ID before collection proceeds.
- [ ] Record the terminal status, `endingReason`, `createdAt`, `endedAt`, and calculated job duration.
- [ ] Record the recovered `firstRssRequestId`, `firstRssArticleId`, `rssArticlesAddedCount` when available, and broader `articleCount`.
- [ ] Use read-only SQL to verify `articleCount` equals the number of Articles where `id > articleIdHighWaterMark`.
- [ ] Use read-only SQL to verify recovered RSS IDs belong to `NewsArticleAggregatorSources.nameOfOrg = 'Google News RSS'`.
- [ ] Verify a nonzero run stops at the Phase 5 boundary with `runCompleted = false`.
- [ ] If the verified count is zero, verify Phase 4 completion and run completion were persisted atomically.
- [ ] Verify coordinator logs and worker logs provide the expected correlation and detailed query evidence without expanding run-table metadata.
- [ ] If the operator approves an interruption exercise, restart worker-node during RSS, continue the run, and verify `worker_restart` replacement plus retention of Articles inserted before restart.
- [ ] Keep operator-reported evidence clearly separate from commands and results directly observed by the implementing agent.
- [ ] Record the development-server evidence and any follow-up findings in `docs/weekly-article-pipeline-v02/` with compliant frontmatter.
- [ ] If verification exposes a defect, fix it, rerun the affected automated checks, and repeat only the safe portion of the live checkpoint approved by the operator.
- [ ] Check off completed Phase 8 tasks and commit the verification record and any approved fixes using the repository commit-message guidance.
