---
created_at: 2026-10-02T23:06:43Z
updated_at: 2026-10-02T23:06:43Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Weekly Flow 02 Phase 3 Plan V01 Assessment

## Summary

The plan correctly describes db-manager's existing `--delete_articles` behavior, which I checked in `db-manager/src/modules/deleteArticles.ts` and `cli.ts`:

- the 180-day `DEFAULT_DELETE_DAYS`;
- a protection snapshot taken from `ArticleApproved` and `ArticleIsRelevant`;
- ID-ordered batches of 5,000, with an initial 1,000-row sample when more than 5,000 articles are eligible;
- a zero-row early return.

It also correctly reuses the Phase 2 child-process policy. Pulling the shared runner out of the 379-line `02_createDatabaseBackupCommand.ts` is justified, now that a second phase needs it. The Phase 2 regression tests guard that refactor.

One concern qualifies. The planned count semantics conflict with the deletion loop the plan says to preserve. As a result, a completed deletion can be rejected by ops, or by db-manager's own new integrity check, as a failed run.

## Concern 1: `eligibleCount` and `deletedCount` are not defined tightly enough for the loop being preserved

Criteria: the plan will not work as written; the implementer would be confused.

The current loop counts eligible rows once (`totalToDelete`) and then runs `while (deletedCount < totalToDelete)`. Each pass fetches up to the full batch size (`limit: batchSize`), not up to the number of rows remaining, and adds `ids.length` to `deletedCount`. The plan keeps this loop ("Preserve ID-ordered pagination and existing batch sizes") but adds two rules:

- ops rejects the result unless `deletedCount` is not greater than `eligibleCount`;
- db-manager throws "if the loop cannot obtain usable IDs while unprocessed eligible work remains."

Both rules can trip on a deletion that actually completed, because the database can change between the initial `Article.count` and the batch queries:

1. **Overshoot: valid work is rejected after it is done.**
   - Suppose 10 rows are counted as eligible, but by the first batch query 12 match (for example, articles inserted with an old `publishedDate` by another worker).
   - The query's limit is 5,000, so it returns and deletes all 12. The result is `deletedCount = 12`, `eligibleCount = 10`.
   - db-manager exits 0, but ops rejects the result as an "impossible count relationship." The flow fails after deletion has already happened, and the operator gets a misleading "unverified" outcome.
2. **Undershoot: legitimate disappearance is treated as an integrity failure.**
   - If eligible rows disappear before the loop reaches them (for example, deleted through the API or by another db-manager deletion command), the loop sees an empty batch while `deletedCount < totalToDelete`.
   - Under the new rule, db-manager throws and Phase 3 fails, even though no eligible rows remain.
3. **What `deletedCount` measures is ambiguous.** The plan calls `deletedCount` "the count reported by the completed deletion operation." Today it counts IDs passed to `destroy`, not the rows `destroy` returns. Those numbers differ in exactly the cases above.

The "unusable IDs" case is effectively impossible: `id` is an integer primary key. Edge cases 1 and 2 are the real ones.

Recommendation: define the semantics explicitly in the plan. One consistent option:

- **Cap each batch at the remaining count.** Use `limit: Math.min(batchSize, eligibleCount - processedCount)`, so the run deletes at most the rows counted at the start and `deletedCount <= eligibleCount` holds by construction. Rows that become eligible mid-run are left for the next weekly run.
- **Sum what `Article.destroy()` returns as `deletedCount`.** Then the reported number is what the database actually removed.
- **Choose the behavior for an early empty batch.** Either:
  - treat it as successful completion with `deletedCount < eligibleCount`, which matches the operator's earlier "fail, rerun from Phase 1" stance if it *does* fail, since a rerun is safe; or
  - keep it as an error, but say in the plan that concurrent deletions will cause this false failure and that the remedy is a rerun.

Then align ops' validation and the db-manager tests with whichever rule is chosen.

## Non-blocking notes

- **The plan doesn't say how to run the read-only counts.** The checkpoint asks for "a read-only count of Articles currently eligible under the same protection rules," and verification asks for a post-run query confirming that no unprotected old articles remain. db-manager's `--dry_run` is not valid with `--delete_articles`, and ops has no database access. The todo should give the exact read-only SQL, for example a `SELECT count(*)` over `Articles` with `NOT EXISTS` against `ArticleApproveds` and `ArticleIsRelevants`. It should also name who runs it and with which database role.
- **The protection snapshot can go stale during deletion.** Protected IDs are read once, before deletion starts. An article approved or marked relevant during a long run is not protected. The `hasMany` association has a non-null `articleId`, so the new approval row would likely cascade-delete with the article. This is existing behavior and rare for articles over 180 days old, but the weekly flow now runs it unattended. Either record it as a known limitation in the README, or note a future fix: re-check protection per batch with `NOT EXISTS` in the batch query.
- **Deleted articles may not be in the backup.** An old, unprotected article inserted after the Phase 2 backup starts reading tables, and before Phase 3 runs, is deleted without appearing in that backup. This follows from the non-snapshot backup already documented. It is worth one README sentence alongside "the verified Phase 2 backup is the recovery artifact."
- **Each rerun takes another full backup.** A rerun after a Phase 3 failure creates another full backup. Repeated failures accumulate archives in `PATH_DB_BACKUPS`. That is acceptable given the rerun-from-Phase-1 decision, but the checkpoint's disk-space check should allow for it.

## Todo-phase note

After Concern 1 is resolved, this plan needs a task-style todo. It changes db-manager deletion logic, refactors the verified Phase 2 runner, adds a phase, and ends with a real deletion on the development server.
