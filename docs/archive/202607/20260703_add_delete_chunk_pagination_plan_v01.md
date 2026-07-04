---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Add-Delete Page Chunk Pagination — Plan v01

## Background

Fix 02 (`docs/20260703_review_chunk_pagination_plan_v02.md`, implemented in commits
`fdd5ef1`…`7c39758`) bounded `POST /articles/with-ratings` with keyset chunking and gave the
`/articles/review` page a Filter Articles section with a limit dropdown, total-match count, and
prev/next chunk navigation. It worked well; the operator has since raised the limits
(`WITH_RATINGS_DEFAULT_LIMIT = 20000`, `WITH_RATINGS_MAX_LIMIT = 40000` in
`api/src/modules/pagination.ts`).

This plan extends the same pattern to the `/articles/add-delete` page and its endpoint
`POST /articles` — the second of the three unbounded endpoints from the OOM report
(`docs/20260701_CLAUDE_API_OOM_FAILURE_REPORT.md`; a `POST /articles` response of ~61 MB
preceded the second crash). The operator's requirement: the new Filter Articles section works
exactly like the review page's.

## Differences from the review page flow (all handled, none breaking)

1. Relevance filter semantics. `POST /articles` excludes an article under
   `returnOnlyIsRelevant` when it has any `ArticleIsRelevants` row — including rows where
   `isRelevant IS NULL` (`articles.ts` lines ~168–170 key off row presence;
   `sqlQueryArticlesIsRelevant()` at `queriesSql.ts` ~841 has no `isRelevant` predicate).
   `POST /articles/with-ratings` excludes only non-null rows. Verified in fix01 plan v03 and
   re-verified against current code. Therefore `buildWithRatingsWhereClause` is not reusable
   for this endpoint; a separate builder preserves each endpoint's current behavior exactly.
   Approval semantics are identical to with-ratings (`sqlQueryArticlesApproved()` uses
   `WHERE aa."isApproved" = true`, `queriesSql.ts` ~136).
2. Shared helpers with another route. `GET /articles/summary-statistics` (`articles.ts`
   ~621–686) also calls `sqlQueryArticles({})`, `sqlQueryArticlesWithStates()`, and
   `sqlQueryArticlesApproved()`. These helpers therefore gain an optional `articleIds`
   parameter: when omitted, behavior is byte-for-byte unchanged (summary-statistics untouched);
   when provided, the query is bounded to the chunk.
3. Page fetch trigger. The add-delete page currently refetches whenever
   `articleTableBodyParams` changes (its `fetchArticlesArray` useCallback depends on the params
   and feeds the mount useEffect, page lines ~85–127). To match the review page's UX (changes
   light up a Refresh button; only Refresh/mount/chunk-nav fetch), that effect becomes
   mount-only. This is an intentional UX change that comes with the feature.
4. No AI-score step. `POST /articles` has no semantic-scorer or top-scores merging, so the
   route rework and portal fetch are simpler than the review page's.
5. Shared filter state. Both pages read the same Redux `articleTableBodyParams` (the
   add-delete page already sends it as its request body, including the `limit` field added by
   fix02, which `POST /articles` currently ignores). This plan keeps that sharing — filters and
   limit set on one page carry to the other, which is the existing design. Chunk position
   remains per-page local state.

## Scope

- API: `POST /articles` (`api/src/routes/articles.ts` ~60–208) plus the shared SQL helpers it
  uses, extended backward-compatibly.
- Portal: `portal/src/app/(dashboard)/articles/add-delete/page.tsx` gains the Filter Articles
  section; `TableReviewArticles.tsx` and the review page are untouched.
- Out of scope: `GET /articles/approved` (last remaining unbounded endpoint — future plan),
  any change to review-page code, any change to summary-statistics behavior.

## Design overview

Identical architecture to fix02: all filters pushed into SQL via a shared WHERE builder, a
lightweight ID chunk query with `limit + 1` for `hasMore`, an unlimited `COUNT(*)` for
`totalCount` on the first chunk only, hydration bounded to the chunk's ids, and an
empty-chunk short-circuit. The portal card replicates the review page's Filter Articles card
(dates, Hide Approved / Hide Irrelevant toggles, limit dropdown via the controlled `Select`,
total-count line, `Chunk n of m` with Prev/Next, Refresh button wired to
`hasFilterChanges`).

### Request/response contract — `POST /articles`

New optional body fields alongside the existing four filters: `limit` (clamped to maximum
40,000; default 20,000 — matching the current with-ratings values) and `cursor`.

Response keeps the existing `articlesArray` key and adds `articleCount`, `limit`,
`nextCursor`, `hasMore`, `totalCount` (number on first chunk, `null` with a cursor), and
`timeToRenderResponseFromApiInSeconds` — the same shape as the with-ratings response, so the
portal can share types.

### API component (api/src)

`api/src/modules/pagination.ts`: add `ARTICLES_LIST_DEFAULT_LIMIT = 20000` and
`ARTICLES_LIST_MAX_LIMIT = 40000`; reuse the existing `clampLimit()`.

`api/src/modules/queriesSql.ts`:

- New pure `buildArticlesListWhereClause(filters, cursor?)` returning
  `{ clause, replacements }`, mirroring `buildWithRatingsWhereClause` (~line 38) except for
  the relevance predicate:
  - dates: `a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter` /
    `a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter`;
  - `returnOnlyIsNotApproved` → `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE
    aa."articleId" = a.id AND aa."isApproved" = true)` (same as with-ratings);
  - `returnOnlyIsRelevant` → `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE
    air."articleId" = a.id)` — no `isRelevant` condition; any relevance row disqualifies,
    preserving this endpoint's current semantics;
  - cursor → `a.id > :cursor`.
- New `sqlQueryArticleIdsForArticlesRoute(filters, cursor, limit)` — `SELECT a.id FROM
  "Articles" a` + builder WHERE + `ORDER BY a.id LIMIT :limitPlusOne`; returns `number[]`.
- New `sqlQueryCountArticlesForArticlesRoute(filters)` — `COUNT(*)` on the same builder
  (no cursor).
- `sqlQueryArticles(options)` (~282): add optional `articleIds?: number[]` to its options.
  When provided, add `a.id IN (:articleIds)` to its WHERE (bound replacements) — dates may be
  omitted by the caller since the ID query applied them. When absent, unchanged
  (summary-statistics calls `sqlQueryArticles({})`).
- `sqlQueryArticlesWithStates(articleIds?)` (~327), `sqlQueryArticlesIsRelevant(articleIds?)`
  (~841), `sqlQueryArticlesApproved(articleIds?)` (~124): optional parameter; when provided,
  constrain with `WHERE/AND ... "articleId" IN (:articleIds)`; when absent, unchanged. When
  the caller passes an empty array, return `[]` without querying (same guard pattern as
  `sqlQueryArticlesAndAiScores`).
- Export the new functions from the export block (~line 940).

Route rework (`POST /articles`, `articles.ts` ~60–208):

- Read `limit`/`cursor`; clamp via `clampLimit(limit, ARTICLES_LIST_DEFAULT_LIMIT,
  ARTICLES_LIST_MAX_LIMIT)`.
- ID chunk query → `hasMore` (ids > effective limit), trim, `nextCursor` (last trimmed id or
  `null`). `totalCount` via the count query only when `cursor` is absent.
- Empty-chunk short-circuit: respond `{ articlesArray: [], articleCount: 0, limit,
  nextCursor: null, hasMore: false, totalCount, timeToRenderResponseFromApiInSeconds }`
  without calling the hydration or side queries.
- Hydrate with `sqlQueryArticles({ articleIds })` and pass the same ids to the three side
  queries — they stop scanning full tables on every request.
- Keep the existing grouping/decoration logic (States, `ArticleIsRelevant`,
  `articleIsApproved`, keyword string) unchanged — it is already Map-based and now operates
  on one chunk.
- Delete the JavaScript `returnOnlyIsNotApproved` / `returnOnlyIsRelevant` post-filters
  (lines ~195–205) — handled in SQL. The decorated per-article fields stay, derived from the
  bounded side queries, and remain consistent with the SQL filters.
- Add the response metadata; keep `articlesArray`.

### Portal component (portal/src)

No Redux changes: `ArticleTableBodyParams` already has `limit` (fix02), shared by design.
Response typing reuses the metadata fields added for the review page fetch (same shape).

`portal/src/app/(dashboard)/articles/add-delete/page.tsx`:

- Replicate the review page's chunk state and handlers (review page lines ~84–90, ~725–760 as
  the reference implementation): `chunkStartCursors` (init `[null]`), `currentChunkIndex`,
  `nextCursor`, `totalCount`, `hasMore`; Next pushes the response `nextCursor`; Prev fetches
  the previous stacked cursor, decrements, and truncates the stack; Refresh resets all chunk
  state and fetches chunk 1.
- `fetchArticlesArray(cursor: number | null = null)`: body = `articleTableBodyParams` fields
  plus `limit` (`?? 20000` fallback for stale persisted state) and `cursor`; on response set
  chunk metadata (only overwrite `totalCount` when non-null); on error reset `nextCursor`/
  `hasMore`.
- Change the mount effect (~lines 122–127) to fetch once on mount only (empty dependency
  array with the same eslint-disable pattern the review page uses at its line ~525), so
  filter edits no longer auto-refetch.
- Add `initialFilters` + `hasFilterChanges` replicating the review page (~82–140), including
  `limit`.
- Insert the Filter Articles card above the table, copied from the review page card
  (review page ~lines 995–1110): date inputs dispatching `updateArticleTableBodyParams`,
  Hide Approved / Hide Irrelevant buttons dispatching the existing `toggleHideApproved` /
  `toggleHideIrrelevant` reducers, limit dropdown (controlled `Select`, options 1,000 / 5,000 /
  10,000 / 20,000 / 40,000 — match whatever option list the review page currently renders),
  total-count line, `Chunk n of m` indicator, Prev/Next, and the Refresh button.
- Everything else on the page (add form, select/delete/update handlers, modals,
  `TableReviewArticles` usage) is unchanged.

Note: the review page's Filter Articles card is intentionally replicated, not extracted into a
shared component — extraction would modify a just-shipped working page for no functional gain.
A shared-component refactor can be its own later task if the operator wants it.

## Behavior notes

- Deploy api and portal together (additive response keys, but first-chunk-only behavior
  changes for un-updated clients — which would include the current add-delete page).
- Filters and limit are shared between review and add-delete via Redux; chunk position is not.
  Changing filters on one page lights up the other page's Refresh button on next visit rather
  than silently refetching.
- `GET /articles/summary-statistics` behavior is unchanged (helpers called without
  `articleIds`).
- The "Hide Irrelevant" toggle keeps this endpoint's stricter current meaning (any relevance
  marking hides the article, including null markings) — unchanged from today's add-delete
  behavior, though subtly different from the review page; this is pre-existing, documented
  endpoint semantics, not a new divergence.

## Testing and verification

Per `AGENTS.md`: api Jest + Supertest under `api/tests/`; portal lint only; build order
db-models → api → portal.

- WHERE-builder unit tests (extend the fix02 pattern in `api/tests/modules/`): each filter
  alone; `returnOnlyIsRelevant` emits `NOT EXISTS` with no `isRelevant` condition (the
  endpoint-distinguishing assertion — an article whose only relevance row is null is excluded
  here, opposite of with-ratings); approval predicate matches with-ratings; cursor composes
  with `AND`.
- Side-query guards: `sqlQueryArticlesWithStates([])`, `sqlQueryArticlesIsRelevant([])`,
  `sqlQueryArticlesApproved([])`, `sqlQueryArticles({ articleIds: [] })` resolve to `[]`
  without issuing SQL; called without the parameter they issue the same SQL as before.
- Route tests (`api/tests/articles/articles.routes.test.ts`, mocked helpers): default limit
  20,000; clamp 50,000 → 40,000; `hasMore`/`nextCursor` derivation; first-chunk `totalCount`,
  cursor-chunk `totalCount: null` and count helper not called; empty-chunk short-circuit skips
  hydration and side queries; existing `POST /articles` assertions still pass (response is
  additive); `GET /articles/summary-statistics` tests unaffected.
- Portal: `npm run lint`, `npm run build`.
- Manual E2E: add-delete loads chunk 1 at 20,000; limit/date/toggle changes light Refresh
  without refetching; Refresh refetches with recomputed total; Prev/Next traverse without
  duplicates/gaps at boundaries; add, select, delete, and update article flows all still work;
  filters set on review page appear on add-delete (shared state) and vice versa;
  summary-statistics numbers unchanged before/after deploy on the same data.

## Non-goals

- `GET /articles/approved` bounding — the last unbounded endpoint, future plan.
- Extracting a shared Filter Articles component — possible later refactor, not this change.
- Any change to review-page files or to with-ratings constants/behavior.
