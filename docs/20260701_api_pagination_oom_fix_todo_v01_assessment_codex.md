---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# API Pagination OOM Fix Todo v01 Assessment

The TODO is close and correctly carries forward the plan v03 filter-parity corrections. It is not ready for implementation because two checklist gaps can lead to compile breaks or runtime failures during otherwise faithful implementation.

## Concern 1: Phase 3 and Phase 4 need explicit empty-page short-circuit handling

Phase 2 tells the implementer to short-circuit sensibly when the ID page query returns no rows. Phase 3 (`POST /articles`) and Phase 4 (`GET /articles/approved`) do not include the same instruction, even though both phases also require page-constrained hydration queries using `WHERE ... IN (:articleIds)`.

This leaves an implementation-risk ambiguity for filters that match zero rows, or for a client-provided cursor beyond the last article id. An implementer may pass an empty id array into `IN (:articleIds)`, which can produce invalid SQL depending on Sequelize expansion, or may add an accidental fallback path that reverts to an unbounded query. Either outcome risks breaking existing empty-result behavior or the OOM fix invariant.

The TODO should explicitly require Phase 3 and Phase 4 route handlers to return an empty `articlesArray` response with the new pagination metadata when the ID page is empty, without calling hydration or side-query helpers with an empty id list.

## Concern 2: Phase 3 omits call-site preservation for `sqlQueryArticles`

Phase 3 says to constrain `sqlQueryArticles` to the page's ids, but unlike the side-query helpers, it does not tell the implementer to update all existing call sites so they keep compiling and behaving as before.

Current code calls `sqlQueryArticles` from both the paginated `POST /articles` route and the unpaginated summary-statistics route (`api/src/routes/articles.ts:620`). If the implementer makes `articleIds` required or changes the default behavior while following the TODO, summary statistics can either fail to compile or silently become page-limited, which would break existing API behavior outside the target endpoint.

The TODO should add an explicit task for `sqlQueryArticles`: update all call sites found by repo search, and make the unbounded summary-statistics usage intentional and documented, while only the `POST /articles` route passes the page id list.
