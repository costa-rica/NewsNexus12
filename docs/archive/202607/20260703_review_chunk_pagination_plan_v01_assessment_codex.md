---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Review Chunk Pagination Plan v01 Assessment

The plan is directionally sound and matches the goal of bounding `/articles/review` responses, but it warrants a v02 before todo. The main issues are not with the keyset chunking architecture; they are missing implementation details that could leave an existing route broken and make empty filtered result sets fail.

## 1. Existing test SQL route would break

1. The plan changes `sqlQueryArticlesForWithRatingsRoute()` from a date-filtered full hydration query into an ID hydration query.
2. The plan scopes route changes to `POST /articles/with-ratings`, but `api/src/routes/articles.ts` also calls this helper from `GET /articles/test-sql`.
3. The current caller passes `null, null`. After the proposed signature change, that route would either pass invalid IDs into hydration or fail when the helper expects an array.
4. v02 should explicitly include one of these choices:
   - update `/articles/test-sql` to use the new ID query plus hydration flow
   - remove `/articles/test-sql` if it is obsolete
   - replace it with a bounded diagnostic route that follows the same limit/cursor contract

## 2. Empty chunks are not handled end-to-end

1. The plan correctly says the hydration helper should return `[]` when `articleIds` is empty.
2. The route flow still needs to handle that empty list before calling `sqlQueryArticlesAndAiScores()` twice.
3. The current score helper builds SQL from `articlesIdArray.join(",")`; without an explicit empty-array guard, an empty result set can become `IN ()` or an equivalent invalid query after the planned bound-replacement rewrite.
4. This matters for normal behavior: the first chunk can have zero matches, and an outdated or stale client can also request a cursor past the end.
5. v02 should require either:
   - route-level short-circuiting when the ID chunk is empty, returning `articleCount: 0`, `articlesArray: []`, `hasMore: false`, `nextCursor: null`, and the appropriate `totalCount`
   - or `sqlQueryArticlesAndAiScores()` returning `[]` for empty ID arrays, with the route still producing the same metadata

## 3. Filter parity tests are aimed at the wrong layer

1. The plan puts the filter parity tests in `api/tests/articles/articles.routes.test.ts`.
2. That file mocks `src/modules/queriesSql`, so route tests there can verify response shape and route orchestration, but they cannot prove that the new SQL `NOT EXISTS` filters match the old JavaScript approval and relevance semantics.
3. v02 should add coverage for the SQL helper or its shared WHERE builder. A pure `buildWithRatingsWhereClause()` test would be enough if raw database execution is too heavy for the existing Jest setup.
4. The route tests should still cover limit clamping, first-chunk metadata, subsequent-chunk `totalCount: null`, and empty-result response shape using mocked helper returns.

## Recommendation

Create `20260703_review_chunk_pagination_plan_v02.md` before moving to todo. The v02 can keep the same architecture, but it should explicitly cover the extra helper caller, the empty-result path, and the test-layer split between route orchestration and SQL filter parity.
