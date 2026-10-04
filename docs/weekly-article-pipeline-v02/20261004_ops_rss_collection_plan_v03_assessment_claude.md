---
created_at: 2026-10-04T17:50:06Z
updated_at: 2026-10-04T17:50:06Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops RSS Collection Plan V03 Assessment

## Summary

V03 keeps Phase 4 small and matches PRD V09 on several points:

- Polling is non-overlapping.
- Individual query failures are tolerated.
- `rssArticlesAddedCount` is kept separate from the broader `articleCount`.
- Zero-work completion is atomic.
- The run stays incomplete at the Phase 5 boundary.

The plan leaves the worker-node interface to "research before implementation." Because the plan's design depends on what that research finds, I did the research for this assessment. The current contract is:

- **Start:** `POST /request-google-rss/start-job` returns `202 { jobId, status, endpointName }`. The body accepts `doNotRepeatRequestsWithinHours` (default 72) and an optional `targetArticlesAddedCount`.
- **Status:** `GET /queue-info/check-status/:jobId` returns `{ job }`, with `status`, `result`, `failureReason`, `startedAt` and `endedAt`, or `404` when the job is unknown. `status` is one of `queued | running | completed | failed | canceled`.
- **Storage:** jobs live in a JSON file store. Jobs older than 30 days are pruned at startup, and jobs still `queued` or `running` at startup are rewritten as `failed` with `failureReason: 'worker_restart'`.
- **Result:** `{ endingReason, endingMessage, articlesAddedCount, queryResults }`. It is written **once**, in the job's `finally` block (`requestGoogleRssJob.ts:660-670`). It contains no request IDs or Article IDs.
- **No authentication middleware.** Jobs run one at a time through a single global queue shared by every worker-node endpoint.

Against that contract, two concerns qualify. The first can wrongly complete a run as zero-work and lose its Article range. The second leaves Phase 4's success test undefined.

## Concern 1: First IDs and the zero-work decision cannot come from the worker's reported result

Criteria: the plan will not work as written; it carries a correctness risk to later phases.

The plan says to persist the first IDs "as soon as they become available" and to decide zero-work from "every RSS invocation associated with the run adds zero articles." With the current worker:

1. **The first IDs never become available.** The result has no `firstRssRequestId` or `firstRssArticleId`, and nothing is reported during the run, only once at the end.
2. **A crashed job reports nothing.** If worker-node restarts mid-job, the job becomes `failed` / `worker_restart` with no `result`, because the `finally` block never ran. Articles were inserted, but the run has no record of how many.
3. **The replacement then reports zero.** That replacement job skips every query already requested within 72 hours (`wasRequestMadeRecently`), which is every query the crashed job reached. It can report `articlesAddedCount: 0` even though the run added articles.
4. **The run is then completed as zero-work.** "No earlier nonzero result" was ever recorded, so the zero-work branch sets `runCompleted = true` without a `firstRssArticleId` or an `articleCount`. Phases 5–7 never run, and the articles the crashed job inserted are never analyzed by this run.

The plan's rule "a later zero must not erase an earlier nonzero" does not help, because the earlier value is unknown, not zero.

Adding first-ID reporting to the worker (a mid-run `updateResult`) narrows the gap but does not close it. A crash between `NewsApiRequest.create` and the next progress write still loses the marker.

Recommendation: derive the markers and the zero-work decision from the database, not from the worker result. No worker-node change is needed:

- **At Phase 4 start, before the start request,** persist high-water marks in `phaseData.phase4`: `MAX("NewsApiRequests".id)` and `MAX("Articles".id)`. Keep them unchanged across continuation and any replacement invocation.
- **After a verified terminal outcome:**
  - `firstRssRequestId` is the lowest `NewsApiRequests.id` above the request mark whose `newsArticleAggregatorSourceId` is the Google News RSS source. That is the source `ensureAggregatorSourceAndEntity()` creates under `GOOGLE_NEWS_RSS_ORG_NAME`.
  - `firstRssArticleId` is the lowest `Articles.id` whose `newsApiRequestId` is at or above `firstRssRequestId` and belongs to that source.
- **Zero-work means no such RSS Article exists** above the marks, across every invocation in the run. The worker's `articlesAddedCount`, summed over the invocations that reported one, is recorded as `rssArticlesAddedCount` for logs only.
- **`articleCount` keeps the PRD definition:** `COUNT(*)` over Articles where `id >= firstRssArticleId`.

These queries belong in the injected persistence boundary, so the coordinator tests stay database-free. If the PRD's phrase "capture the first IDs" should mean worker-reported values, the operator should confirm that this database-derived approach meets the requirement.

## Concern 2: "Accepted terminal state" is undefined, and queue `completed` does not mean RSS succeeded

Criteria: an implementer would be confused; the plan will not work as written.

The plan uses "worker-defined terminal states confirmed during interface research" and lists three recovery outcomes for a saved job: running, completed, unavailable. The code shows:

- **`completed` covers failures.** `runLegacyWorkflow` catches every error and returns normally, so the queue marks the job `completed` even when `result.endingReason` is `error` or `rate_limited`. A Google `503` stops the query loop (`break`) and leaves later queries `not_reached`, yet the job still reads `completed`.
- **Two statuses fall outside the recovery list.** `failed` (worker restart or a handler exception) and `canceled` match none of the three outcomes.
- **`queued` is a real waiting state.** The global queue runs one job at a time across all endpoints, so the RSS job can wait behind semantic scoring or state assignment. That wait counts against the 24-hour limit.
- **Job IDs can be reused.** `getNextJobId()` returns the highest stored ID plus one. If the job store file is replaced or emptied (a fresh deploy or a manual reset), numbering restarts at `0001`, and a saved `rssJobId` can name a different job, possibly a semantic-scoring job.

Recommendation: the plan should define the mapping explicitly. For example:

| Saved or monitored job | Phase 4 action |
| --- | --- |
| `queued` / `running` | Keep monitoring; counts toward the 24-hour limit. |
| `completed` and `endingReason = queries_exhausted` | Verified terminal success. |
| `completed` with `error` or `rate_limited` | Operator decision: either an unverified failure that stops Phase 4 (the next trigger within 72 h continues and repeat suppression skips completed queries), or one replacement invocation in this coordinator run. |
| `failed` (including `worker_restart`) or `canceled` | Same decision as the previous row. |
| `404`, or a job whose `endpointName` is not `/request-google-rss/start-job`, or whose `createdAt` is before the persisted Phase 4 start | Unavailable: at most one replacement invocation. |

Also state that ops never sends `targetArticlesAddedCount`, so `target_articles_collected` cannot occur. Then add the corresponding status and result fixtures to the tests.

## Non-blocking notes

- **Mark the research as done.** With the contract above, the "Worker Interface Research" section and the open question can record their findings. The remaining operator review is the row-3/row-4 decision in Concern 2, and whether Concern 1's database-derived markers satisfy the PRD.
- **Ops can't tell when a replacement has started.** worker-node exposes no idempotency key on `start-job`. If ops crashes after sending the start request but before persisting the returned `jobId`, a continuation sees no saved job and starts another. The second job's repeat suppression makes this mostly harmless, and the high-water marks from Concern 1 still bound the range. It is worth one sentence in the plan.
- **Running Phase 4 locally needs a database.** A Phase 4 harness on macOS needs the same database-free fakes as earlier phases. The marker and count queries should be covered by the fake persistence boundary, not by connecting to a database.
