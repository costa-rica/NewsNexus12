---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: claude (fable-5)
modified_by: codex (gpt-5.5)
---

# Add-Delete Page Chunk Pagination — Todo v01

Implements `docs/20260703_add_delete_chunk_pagination_plan_v01.md` (approved by codex). Read
the plan first; it holds the design rationale, the endpoint-specific filter semantics, and the
request/response contract. The implemented review-page flow (fix02, commits
`fdd5ef1`…`7c39758`) is the reference implementation throughout — when in doubt, mirror it.

Incorporates codex's non-blocking plan note: the limit dropdown options are the review page's
live list — 1,000 / 5,000 / 10,000 / 20,000 / 30,000 / 40,000 (`ARTICLE_LIMIT_OPTIONS`,
review page lines ~61–68) — not the four values from earlier drafts.

At the end of each phase: run the listed type/lint checks, tests, and build; if anything
fails, fix the code so functionality remains and checks pass; then check off the phase's
tasks and commit the phase's changes (commit message per `AGENTS.md` guidance).

## Phase 1 — API query foundations (api/src, no route changes yet)

- [x] `api/src/modules/pagination.ts`: add `ARTICLES_LIST_DEFAULT_LIMIT = 20000` and
  `ARTICLES_LIST_MAX_LIMIT = 40000` to the existing exports. Reuse the existing
  `clampLimit()` — do not add a new clamp helper.
- [x] `api/src/modules/queriesSql.ts`: add pure exported
  `buildArticlesListWhereClause(filters, cursor?)` returning
  `{ clause, replacements }`, mirroring `buildWithRatingsWhereClause` (~line 38) with these
  predicates (see plan "API component" — do not improvise, the relevance predicate is
  intentionally different from with-ratings):
  - `returnOnlyThisCreatedAtDateOrAfter` → `a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter`
  - `returnOnlyThisPublishedDateOrAfter` → `a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter`
  - `returnOnlyIsNotApproved` → `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id AND aa."isApproved" = true)`
  - `returnOnlyIsRelevant` → `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id)`
    — no `isRelevant` condition; any relevance row disqualifies (preserves current
    `POST /articles` behavior)
  - `cursor` supplied → `a.id > :cursor`
- [x] Add `sqlQueryArticleIdsForArticlesRoute(filters, cursor, limit)`:
  `SELECT a.id FROM "Articles" a` + builder WHERE (with cursor) +
  `ORDER BY a.id LIMIT :limitPlusOne` (`limit + 1`; caller derives `hasMore`). Returns
  `number[]`. Bound replacements only.
- [x] Add `sqlQueryCountArticlesForArticlesRoute(filters)`: `SELECT COUNT(*)` over
  `"Articles" a` + builder WHERE (no cursor). Returns a number.
- [x] Add optional `articleIds` bounding to the four shared helpers — backward compatible;
  `GET /articles/summary-statistics` calls them without arguments and must behave
  byte-for-byte the same:
  - `sqlQueryArticles(options)` (~282): add `articleIds?: number[]` to its options object;
    when provided, add `a.id IN (:articleIds)` to its WHERE with bound replacements;
  - `sqlQueryArticlesWithStates(articleIds?)` (~327), `sqlQueryArticlesIsRelevant(articleIds?)`
    (~841), `sqlQueryArticlesApproved(articleIds?)` (~124): when provided, constrain with
    `"articleId" IN (:articleIds)` (append with `AND` where a WHERE already exists, e.g. the
    approved query's `WHERE aa."isApproved" = true`);
  - all four: when `articleIds` is provided but empty, return `[]` without issuing SQL (same
    guard pattern as `sqlQueryArticlesAndAiScores`); when the parameter is absent/undefined,
    the emitted SQL is unchanged.
- [x] Export `buildArticlesListWhereClause`, `sqlQueryArticleIdsForArticlesRoute`, and
  `sqlQueryCountArticlesForArticlesRoute` from the export block (~line 940).
- [x] New unit tests in `api/tests/modules/` following the fix02 WHERE-builder test pattern,
  for `buildArticlesListWhereClause`:
  - no filters, no cursor → empty clause and replacements;
  - each filter alone emits exactly its predicate and replacement;
  - the endpoint-distinguishing assertion: the `returnOnlyIsRelevant` predicate contains no
    `isRelevant` condition (an article whose only relevance row has `isRelevant IS NULL` is
    excluded by this endpoint — the opposite of `buildWithRatingsWhereClause`);
  - `returnOnlyIsNotApproved` predicate is identical to the with-ratings builder's;
  - cursor emits `a.id > :cursor` and composes with filters via `AND`.
- [x] Unit tests for the helper bounding (mock `sequelize.query` per existing module-test
  patterns): each of the four helpers called with an empty `articleIds` array resolves `[]`
  without calling `sequelize.query`; called with ids, the SQL contains the `IN (:articleIds)`
  constraint; called without the parameter, the SQL does not contain it.

Phase 1 gate: `cd api && npm run build` · `cd api && npm test` — fix failures, check off,
commit.

## Phase 2 — API route rework (POST /articles in api/src/routes/articles.ts)

- [x] Rework `POST /articles` (~lines 60–208):
  - read `limit` and `cursor` from `req.body`; compute effective limit via
    `clampLimit(limit, ARTICLES_LIST_DEFAULT_LIMIT, ARTICLES_LIST_MAX_LIMIT)`; start a
    `startTime` for `timeToRenderResponseFromApiInSeconds` (mirror the with-ratings route);
  - call `sqlQueryArticleIdsForArticlesRoute(filters, cursor ?? null, effectiveLimit)`;
    derive `hasMore` (ids returned > effectiveLimit), trim to `effectiveLimit`, derive
    `nextCursor` = last trimmed id or `null` when `hasMore` is false;
  - compute `totalCount` via `sqlQueryCountArticlesForArticlesRoute(filters)` only when
    `cursor` is absent; otherwise `totalCount = null`;
  - empty-chunk short-circuit: if the trimmed id list is empty, respond
    `{ articlesArray: [], articleCount: 0, limit: effectiveLimit, nextCursor: null,
    hasMore: false, totalCount, timeToRenderResponseFromApiInSeconds }` without calling the
    hydration or side queries;
  - hydrate via `sqlQueryArticles({ articleIds: trimmedIds })` (date options no longer needed
    — the ID query applied them) and pass `trimmedIds` to `sqlQueryArticlesWithStates`,
    `sqlQueryArticlesIsRelevant`, `sqlQueryArticlesApproved`;
  - keep the existing grouping/decoration logic (lines ~84–193: States map, relevance map,
    approval map, keyword string) unchanged — it now operates on one chunk;
  - delete the JavaScript `returnOnlyIsNotApproved` / `returnOnlyIsRelevant` post-filters
    (lines ~195–205) — handled in SQL; the decorated `articleIsApproved` /
    `ArticleIsRelevant` response fields remain, derived from the bounded side-query maps;
  - response: keep `articlesArray`, add `articleCount`, `limit`, `nextCursor`, `hasMore`,
    `totalCount`, `timeToRenderResponseFromApiInSeconds` (same shape as with-ratings).
- [x] Do not modify `GET /articles/summary-statistics` (~lines 621–686) — it continues
  calling the helpers with no arguments.
- [x] Extend `api/tests/articles/articles.routes.test.ts` (helpers mocked — orchestration
  only). Add the new helper mocks (`sqlQueryArticleIdsForArticlesRoute`,
  `sqlQueryCountArticlesForArticlesRoute`) to `mockQueriesSqlModule`. Cases for
  `POST /articles`:
  - no `limit` in body → ID query called with limit 20000;
  - `limit: 50000` → ID query called with limit 40000;
  - mocked ID query returns `limit + 1` ids → `hasMore: true`, `nextCursor` = last trimmed
    id, hydration and side queries called with exactly `limit` ids;
  - fewer ids than limit → `hasMore: false`, `nextCursor: null`;
  - no `cursor` → `totalCount` from the mocked count helper; with `cursor` →
    `totalCount: null` and count helper not called;
  - mocked ID query returns `[]` → empty-chunk response shape and none of
    `sqlQueryArticles`/`sqlQueryArticlesWithStates`/`sqlQueryArticlesIsRelevant`/
    `sqlQueryArticlesApproved` called;
  - existing `POST /articles` assertions still pass (`articlesArray` key and article object
    shape unchanged — response keys are additive);
  - existing `GET /articles/summary-statistics` tests pass unmodified.

Phase 2 gate: `cd api && npm run build` · `cd api && npm test` — fix failures, check off,
commit.

## Phase 3 — Portal (portal/src/app/(dashboard)/articles/add-delete/page.tsx)

Behavior rule (matches the review page): date, toggle, and limit changes only update Redux
`articleTableBodyParams` and light up the Refresh button via `hasFilterChanges`. Nothing
refetches except the mount fetch, `handleRefreshWithFilters`, and the Prev/Next handlers.

No Redux changes in this phase — `ArticleTableBodyParams.limit` already exists (fix02) and is
shared between the review and add-delete pages by design. Do not modify
`TableReviewArticles.tsx`, `Select.tsx`, `userSlice.ts`, or any review-page file.

- [x] Copy `ARTICLE_LIMIT_OPTIONS` verbatim from the review page (lines ~61–68) as a
  module-level const in the add-delete page — six options: `"1000"`/1,000, `"5000"`/5,000,
  `"10000"`/10,000, `"20000"`/20,000, `"30000"`/30,000, `"40000"`/40,000. (Shared extraction
  is a plan non-goal; keep the lists in sync manually.)
- [x] Add chunk state, mirroring the review page (~lines 84–90):
  `chunkStartCursors: (number | null)[]` (init `[null]`), `currentChunkIndex` (init 0),
  `nextCursor: number | null` (init `null`), `totalCount: number | null` (init `null`),
  `hasMore: boolean` (init `false`).
- [x] Rework `fetchArticlesArray` (currently ~lines 85–120) to
  `fetchArticlesArray(cursor: number | null = null)`:
  - body = spread of `articleTableBodyParams` plus `limit:
    articleTableBodyParams?.limit ?? 20000` and `cursor`;
  - on response: `setArticlesArray(result.articlesArray)`, set `hasMore` and `nextCursor`
    from the response, set `totalCount` only when `result.totalCount !== null` (later chunks
    return null and must not overwrite);
  - on error (existing catch): also reset `nextCursor` to `null`, `hasMore` to `false`;
  - type the response with the same metadata typing the review page fetch uses (reuse the
    existing type — no `any`, portal lint is strict).
- [x] Change the mount effect (~lines 122–127) to fetch once on mount only (empty dependency
  array with the same eslint-disable pattern the review page uses at its mount fetch), so
  Redux filter changes no longer auto-refetch. Keep the
  `updateStateArrayWithArticleState({ States: [] })` call.
- [x] Add `initialFilters` + `hasFilterChanges`, replicating the review page (~lines
  ~100–140), covering the four filter fields plus `limit` (`?? 20000` fallback on both
  sides of the comparison).
- [x] Add `handleRefreshWithFilters`, mirroring the review page: `setInitialFilters` from
  current params (including `limit`), reset `chunkStartCursors` to `[null]`,
  `currentChunkIndex` to 0, `nextCursor` to `null`, `hasMore` to `false`, `totalCount` to
  `null`, then `fetchArticlesArray(null)`.
- [x] Add Prev/Next handlers, mirroring the review page (~lines 725–760): Next (enabled when
  `hasMore && nextCursor !== null && !loadingTable`) fetches with `nextCursor`, pushes it,
  increments the index; Prev (enabled when `currentChunkIndex > 0 && !loadingTable`) fetches
  `chunkStartCursors[currentChunkIndex - 1]`, decrements, truncates the stack to the new
  index.
- [x] Insert the Filter Articles card above the `TableReviewArticles` usage, copied from the
  review page card (locate its `Filter Articles` heading, ~lines 955–1110): Database Date
  Limit and Published Date Limit inputs dispatching `updateArticleTableBodyParams`; Load
  Limit `Select` (controlled `value={String(articleTableBodyParams?.limit ?? 20000)}`,
  options `ARTICLE_LIMIT_OPTIONS`, dispatching `updateArticleTableBodyParams({ limit:
  Number(value) })`); Hide Approved / Hide Irrelevant buttons dispatching the existing
  `toggleHideApproved` / `toggleHideIrrelevant` reducers (import them); the Refresh button
  bound to `hasFilterChanges`; the total-count line (`totalCount === null ? "Article count
  pending" : …`); the `Chunk n of m` chip (`m = Math.ceil(totalCount / (limit ?? 20000))`);
  Prev/Next buttons using `loadingTable` as the disabled loading flag.
- [x] Leave the rest of the page unchanged (add form, `handleSelectArticleFromTable`, delete
  and update flows, modals, `TableReviewArticles` props).

Phase 3 gate: `cd portal && npm run lint` · `cd portal && npm run build` — fix failures,
check off, commit.

## Phase 4 — Integration verification

- [x] Full build in dependency order: `cd db-models && npm run build`, then
  `cd api && npm run build`, then `cd portal && npm run build`.
- [x] Full api test suite: `cd api && npm test`.
- [ ] Manual end-to-end against a dev database (api + portal dev servers per `AGENTS.md`):
  - Not run in this non-interactive implementation session because it requires browser verification and includes DB-mutating add/delete/update flows; automated API, lint, and build gates passed.
  - add-delete page loads chunk 1 at the default 20,000 limit; total count displays;
  - date/toggle/limit changes light up Refresh without refetching; Refresh refetches chunk 1
    with recomputed total; all six dropdown options selectable;
  - Next/Prev traverse chunks with no duplicated or skipped articles at boundaries; Prev then
    Next returns to the same chunk;
  - add article, select from table, delete (with confirmation), and update flows all still
    work; deleting an article removes it from the current chunk;
  - filters and limit set on the review page appear on add-delete (shared Redux state) and
    vice versa; each page keeps its own chunk position;
  - summary statistics component shows the same numbers as before the change on the same
    data (`GET /articles/summary-statistics` unaffected);
  - review page still works end-to-end (its helpers were extended, not changed).
- [ ] Confirm the `POST /articles` response for a 20,000-row chunk is far below the previous
  full-dataset payloads (log or curl + `wc -c`).

Phase 4 gate: all checks above pass — check off, commit any remaining changes.

## Deployment note (operator)

api and portal deploy together. The current add-delete page already sends `limit` in its
request body (shared Redux params); once the API interprets it, an un-updated portal would
receive only the first chunk with no navigation controls — bounded by design but
user-visible.
