---
created_at: 2026-10-04T18:26:06Z
updated_at: 2026-10-04T18:26:06Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops RSS Collection Todo V03 Assessment

## Summary

The todo follows PRD V10 and Plan V06 closely:

- **Typed run model first.** The high-water fields are added to the model, then the persistence operations, the worker client, the phase module and coordinator integration are built in that order.
- **Persistence rules are covered.** Marks are persisted with the Phase 4 start and never recalculated. An unknown RSS-added result stays unknown. Zero-work completion is atomic.
- **Worker handling matches PRD V10.** The client checks job identity and worker timestamps, applies the 24-hour limit per job, uses the cancellation outcomes PRD V10 accepts, and handles all three results of a missing-job follow-up, including a late terminal status, which my PRD V10 review asked for.
- **Starts are limited.** At most one RSS job starts per invocation. A replacement starts only after the earlier job is confirmed inactive.
- **Schema rollout comes before use.** The replenish backup is taken with the old build.

One concern qualifies.

## Concern 1: No development-server run of real Phase 4

Criteria: a gap that risks successful implementation; the tasks do not cover the PRD's verification scope.

Every earlier increment ended with an operator checkpoint and one real run on `nws-nn12dev`: Phase 1, Phase 2, Phase 3 and persistence. This todo ends with a schema rollout (Phase 6) and a database-free demonstration (Phase 7). Phase 4 code never runs against real PostgreSQL or a real worker-node before the work is called done.

That matters more here than in earlier increments:

- **The new SQL has never run.** Default tests use fakes, so the database queries are never executed:
  - `MAX(id)` with the zero fallback on both tables;
  - the lowest post-mark request from the Google News RSS source, which needs a join to `NewsArticleAggregatorSources` where `nameOfOrg = 'Google News RSS'` (the constant in `worker-node/src/modules/jobs/requestGoogleRssJob.ts:103`, which ops will have to duplicate);
  - the lowest Article for those requests;
  - the post-mark `COUNT(*)`;
  - the atomic zero-work update, and the immutability guard on the marks.

  A wrong table name, a misspelled source name, `BIGINT` returned as a string, or a null `MAX` on an empty table would all pass the fake-based tests.
- **The worker contract is only exercised through parsed fixtures.** Real status records come from worker-node's JSON job store, and their timestamp formats and `result` shape have not been checked against ops' parser.
- **Application-role access to the new reads is unverified.** Ops now reads `NewsApiRequests`, `Articles` and `NewsArticleAggregatorSources` as the application role. Phase 6 checks access to `WeeklyArticleFlowRuns02` only.
- **PRD V10's verification list cannot be met without a real run.** It asks to verify high-water capture, first-ID recovery, broad Article counting, both completion branches, and the worker restart with a zero-result replacement.

Recommendation: add a final phase, an operator checkpoint followed by a development-server Phase 4 run, after the schema rollout:

1. Confirm the branch and commit, the worker-node URL and health, the RSS spreadsheet path, and that no other worker-node job is queued.
2. Run the guarded weekly flow once. Use a run that continues at Phase 4, or a new run if the operator accepts repeating Phases 1–3.
3. Record the persisted marks and job ID before RSS starts, the terminal status and `endingReason`, `endedAt − createdAt`, the recovered `firstRssRequestId` and `firstRssArticleId`, `rssArticlesAddedCount`, and `articleCount`.
4. Check the results with read-only SQL:
   - `articleCount` equals `COUNT(*) WHERE id > articleIdHighWaterMark`;
   - the first IDs belong to the Google News RSS source;
   - the run stops at the Phase 5 boundary with `runCompleted = false`, or completes atomically if the count is 0.
5. Optional, if the operator agrees: restart worker-node during the RSS job, then trigger a continuation. Confirm that the saved `worker_restart` job is replaced and that the articles the first job inserted are still counted.
6. Record the evidence, and keep operator-reported evidence separate from commands the implementer observed directly.

An RSS run can take hours and calls Google. The checkpoint should state the expected duration and the 24-hour job limit, so the operator schedules it deliberately.

## Non-blocking notes

- **Name the Google News RSS source exactly.** Phase 2 says "post-mark Google News RSS request" without giving the exact identifier. The todo should name `NewsArticleAggregatorSources.nameOfOrg = 'Google News RSS'`, and a test should assert that exact string, so a mismatch with worker-node's constant is caught.
- **Run the schema rollout before any server build that exports the new model.** Phase 6 comes after the Phase 1–5 commits. That is fine locally. On the server, no build of the new `db-models` (including db-manager or the API) may be deployed before the rebuild, or backups will reference the missing columns. One sentence in Phase 6 would make that explicit.
- **List the new test file in the test script.** If Phase 3 or 4 adds a new ops test file, the explicit compiled-path list in the `test` script needs that entry. Earlier todos had a task for this.
