---
created_at: 2026-10-04T18:07:33Z
updated_at: 2026-10-04T18:07:33Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops RSS Collection Plan V04 Assessment

## Summary

V04 resolves both V03 concerns and adopts the operator's broader-batch decision:

- **High-water marks fix the crash case.** Two typed marks (`newsApiRequestIdHighWaterMark`, `articleIdHighWaterMark`) are persisted before the first start request and never change afterwards. The batch is defined as `COUNT(*) WHERE id > articleIdHighWaterMark`. A worker restart followed by a zero-result replacement can no longer drop articles that were already inserted, and a missing RSS result is never read as zero.
- **The terminal states are mapped explicitly.** Only `completed` with `queries_exhausted` counts as success. `error`, `rate_limited`, `failed` (including `worker_restart`) and `canceled` are unsuccessful, and `target_articles_collected` is invalid because ops never sends a target.
- **A saved job is checked before it is trusted.** Its `endpointName` must be the RSS endpoint and its `createdAt` must be at or after Phase 4 started. That guards against reused job IDs.
- **Starts are limited.** Ops starts at most one RSS job per invocation. A job that fails during the current invocation stops Phase 4, and the next trigger starts the replacement.

One concern qualifies.

## Concern 1: Anchoring the 24-hour timeout at the original Phase 4 start blocks continuation after 24 hours

Criteria: conflicts with the PRD recovery rule; the plan will not work as intended.

The monitoring policy says: "Measure the 24-hour overall Phase 4 timeout from the persisted original Phase 4 start time, including queued time and continuation."

PRD V09 continues a run that is "Incomplete, past phase 3, and within the repeat window" (72 hours from `runStartedAt`). A run whose Phase 4 started but did not complete falls in that row, so it continues at Phase 4. With the timeout anchored at the *original* Phase 4 start:

1. Phase 4 starts on Friday at 05:05. worker-node restarts at 09:00, and the RSS job becomes `failed` / `worker_restart`.
2. The operator triggers the flow on Saturday at 08:00. That is 27 hours after Phase 4 started, but only 27 hours into the 72-hour run window, so the PRD says continue.
3. The coordinator continues the run at Phase 4, but the persisted Phase 4 timeout has already expired. Phase 4 fails as an unverified timeout before it can inspect the saved job or start the replacement it is allowed to start.
4. Every trigger until hour 72 fails the same way. After that, the age rule starts a new run, which repeats the Phase 1 clear, the Phase 2 backup and the Phase 3 deletion. The only other way out is `--new-run`, which also repeats them.

The effect is that a Phase 4 interruption can only be recovered within 24 hours. The remaining 48 hours of the PRD's continuation window do nothing for Phase 4, and recovery always falls back to repeating the destructive phases.

The timeout's purpose (do not monitor one job forever) does not need a cross-invocation anchor. A replacement job is a new attempt.

Recommendation: limit the 24-hour timeout to one job or one coordinator invocation. For example:

- **Measure from that job's creation time.** Read `createdAt` from the validated status response, so the queue wait is still included, and apply the limit to monitoring that job.
- **Or measure from the moment this coordinator invocation began monitoring Phase 4.**

The overall bound across invocations is then the PRD's 72-hour run-age rule, which already exists. Update the timeout tests to cover a continuation that arrives more than 24 hours after the original Phase 4 start and less than 72 hours after the run started, and assert that it inspects or replaces the job instead of timing out.

## Non-blocking notes

- **The PRD still uses the old `articleCount` definition.** PRD V09 still says `articleCount` is `COUNT(*) … WHERE id >= firstRssArticleId` (data decision 4, recovery item 5) and that zero RSS-added articles stop the run (decision 5). V04 deliberately changes both, to the post-mark count and to zero-work decided by that count. For the persistence increment, the PRD was updated before the todo was written. The same order would keep the PRD authoritative here: a V10 that records the operator's broader-batch decision, the high-water marks, and zero-work based on `articleCount`.
- **The two typed columns require another schema rebuild.** Under the current rollout rule, adding typed columns to `WeeklyArticleFlowRuns02` means another backup, drop, create and replenish cycle on the development database. That is acceptable, but the todo should include the checkpoint steps explicitly. If the operator would rather avoid a rebuild for this increment, `phaseData.phase4` could hold the marks. V04 chose typed columns deliberately, so this is only an option.
- **A late commit can fall below the mark.** `MAX(id)` read at Phase 4 start can miss an article another process inserted in a transaction that was still open, with a lower sequence value, and committed after the read. Under the broader-batch policy that only means one non-RSS article might be left out. The README can mention it alongside the batch definition.
