---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Review Page Chunk Pagination — Todo v02

## Changelog (v01 → v02)

Responds to `docs/20260703_review_chunk_pagination_todo_v01_assessment_codex.md`. All three
concerns were verified against the code and fixed; the phase structure and all API tasks are
unchanged.

1. `nextCursor` state (concern 1): Phase 3 now declares `nextCursor: number | null` as local
   state, sets it from every response, clears it on empty responses and refresh resets, and
   the Next handler reads it from that state.
2. Filter-refresh behavior (concern 2): the current UX is preserved and stated once — filter,
   date, and limit changes only update Redux params and light up the Refresh button; only
   `handleRefreshWithFilters` (and the initial mount fetch) refetches. The contradictory
   "filter change refetches chunk 1" wording in Phases 3 and 4 is removed.
3. Limit dropdown wiring (concern 3): `Select.tsx` is uncontrolled today (`defaultValue` +
   internal state; its only consumers are the template demos `DefaultInputs.tsx` and
   `SelectInputs.tsx`). Phase 3 now includes a task to add an optional controlled `value`
   prop to `Select.tsx`, backward compatible with those consumers, and wires the dropdown
   through it.

Implements `docs/20260703_review_chunk_pagination_plan_v02.md` (approved by codex). Read the
plan before starting; it holds the design rationale, the exact SQL filter translations, and
the request/response contract. Work through the phases in order — Phase 2 depends on Phase 1,
and Phase 3 depends on the API contract from Phase 2.

At the end of each phase: run the listed type/lint checks, tests, and build; if anything
fails, fix the code so functionality remains and checks pass; then check off the phase's
tasks and commit the phase's changes (commit message per `AGENTS.md` guidance).

## Phase 1 — API query foundations (api/src, no route changes yet)

- [ ] Create `api/src/modules/pagination.ts` exporting:
  - `WITH_RATINGS_DEFAULT_LIMIT = 5000`
  - `WITH_RATINGS_MAX_LIMIT = 20000`
  - `clampLimit(requested: unknown, defaultLimit: number, maxLimit: number): number` —
    coerces to integer, returns `defaultLimit` for missing/NaN/invalid input, floors at 1,
    caps at `maxLimit`.
- [ ] In `api/src/modules/queriesSql.ts`, add `buildWithRatingsWhereClause(filters, cursor?)`
  — a pure exported function returning `{ clause: string, replacements: Record<string, unknown> }`.
  Predicates (see plan v02 "Shared WHERE builder" for exact SQL; do not improvise):
  - `returnOnlyThisCreatedAtDateOrAfter` → `a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter`
  - `returnOnlyThisPublishedDateOrAfter` → `a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter`
  - `returnOnlyIsNotApproved` → `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id AND aa."isApproved" = true)`
  - `returnOnlyIsRelevant` → `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id AND air."isRelevant" IS NOT NULL)`
  - `cursor` supplied → `a.id > :cursor`
- [ ] Add `sqlQueryArticleIdsForWithRatingsRoute(filters, cursor, limit)` to `queriesSql.ts`:
  `SELECT a.id FROM "Articles" a` + shared WHERE (with cursor) + `ORDER BY a.id LIMIT :limitPlusOne`
  where `limitPlusOne = limit + 1` (caller uses the extra row to compute `hasMore`).
  Returns `number[]`. Bound replacements only — no string interpolation.
- [ ] Add `sqlQueryCountArticlesForWithRatingsRoute(filters)` to `queriesSql.ts`:
  `SELECT COUNT(*)` over `"Articles" a` + shared WHERE (no cursor). Returns a number.
- [ ] In `sqlQueryArticlesAndAiScores()` (`queriesSql.ts` ~684–713):
  - add a guard: if `articlesIdArray` is empty, return `[]` without issuing SQL;
  - replace the interpolated `articlesIdArray.join(",")` and entity id with bound
    `replacements` (`IN (:articleIds)`, `= :entityWhoCategorizesId`).
  Do not change the return shape — `analysis/state-assigner.ts` (lines ~124, ~181) and
  `GET /articles/test-sql` also consume it.
- [ ] Export the new functions from the `queriesSql.ts` export block (~line 850).
- [ ] New test file `api/tests/modules/pagination.test.ts`: `clampLimit` returns default for
  `undefined`/`null`/`"abc"`/`NaN`/`0`/negative; passes through valid values; clamps 25000 →
  20000 with the with-ratings constants.
- [ ] New test file `api/tests/modules/queriesSql.withRatingsWhere.test.ts` for
  `buildWithRatingsWhereClause` (pure, no DB — this is the filter-parity proof per codex's
  plan v01 assessment):
  - no filters, no cursor → empty/absent WHERE and empty replacements;
  - each filter alone emits exactly its predicate and replacement;
  - `returnOnlyIsNotApproved` emits the `aa."isApproved" = true` form (keeps articles whose
    only approval row is false);
  - `returnOnlyIsRelevant` emits the `air."isRelevant" IS NOT NULL` form (keeps
    `isRelevant IS NULL` rows — with-ratings-specific semantics);
  - cursor emits `a.id > :cursor` and combines with filters via `AND`;
  - all filters + cursor together produce one well-formed clause.
- [ ] Unit test (same file or `api/tests/modules/` sibling): `sqlQueryArticlesAndAiScores([], 1)`
  resolves to `[]` and does not call `sequelize.query`.

Phase 1 gate: `cd api && npm run build` · `cd api && npm test` — fix failures, check off,
commit.

## Phase 2 — API route rework (api/src/routes/articles.ts)

- [ ] Change `sqlQueryArticlesForWithRatingsRoute()` (`queriesSql.ts` ~443–682) signature:
  replace the two date parameters with `articleIds: number[]`; WHERE becomes
  `WHERE a.id IN (:articleIds)` with bound replacements; keep `ORDER BY a.id` and all
  grouping/de-duplication logic unchanged; return `[]` immediately when `articleIds` is empty.
- [ ] Rework `POST /articles/with-ratings` (`articles.ts` ~829–1040):
  - read `limit` and `cursor` from `req.body`; compute effective limit via
    `clampLimit(limit, WITH_RATINGS_DEFAULT_LIMIT, WITH_RATINGS_MAX_LIMIT)`;
  - delete the dead Sequelize `whereClause`/`Op` block (lines ~855–870);
  - call `sqlQueryArticleIdsForWithRatingsRoute(filters, cursor ?? null, effectiveLimit)`;
    derive `hasMore` (ids returned > effectiveLimit) and trim to `effectiveLimit`; derive
    `nextCursor` = last trimmed id, or `null` when `hasMore` is false;
  - compute `totalCount` via `sqlQueryCountArticlesForWithRatingsRoute(filters)` only when
    `cursor` is absent; otherwise `totalCount = null`;
  - empty-chunk short-circuit: if the trimmed id list is empty, respond immediately with
    `{ articleCount: 0, articlesArray: [], limit: effectiveLimit, nextCursor: null,
    hasMore: false, totalCount, timeToRenderResponseFromApiInSeconds }` — skip AI-entity
    lookups, hydration, and score queries;
  - hydrate via `sqlQueryArticlesForWithRatingsRoute(trimmedIds)`;
  - delete the JavaScript post-filter block (lines ~877–902) — filters now run in SQL;
  - replace both `Array.find()` score merges (semantic ~933, location classifier ~966) with
    `new Map(rows.map((r) => [r.articleId, r]))` + `map.get(article.id)`;
  - final response keeps `articleCount` (chunk count), `articlesArray`,
    `timeToRenderResponseFromApiInSeconds` and adds `limit`, `nextCursor`, `hasMore`,
    `totalCount`.
- [ ] Update `GET /articles/test-sql` (`articles.ts` ~1152–1189): fetch ids via
  `sqlQueryArticleIdsForWithRatingsRoute(<no filters>, null, WITH_RATINGS_DEFAULT_LIMIT)`,
  hydrate via `sqlQueryArticlesForWithRatingsRoute(ids)`, keep the single semantic-score
  merge but convert its `Array.find()` to the same `Map` pattern.
- [ ] Extend `api/tests/articles/articles.routes.test.ts` (helpers are mocked there — test
  orchestration only, not SQL semantics). Add the new `queriesSql` mocks
  (`sqlQueryArticleIdsForWithRatingsRoute`, `sqlQueryCountArticlesForWithRatingsRoute`) to
  `mockQueriesSqlModule`. Cases for `POST /with-ratings`:
  - no `limit` in body → ID query called with limit 5000;
  - `limit: 25000` → ID query called with limit 20000;
  - mocked ID query returns `limit + 1` ids → response `hasMore: true`, `nextCursor` = last
    trimmed id, `articlesArray` hydrated from exactly `limit` ids;
  - fewer ids than limit → `hasMore: false`, `nextCursor: null`;
  - no `cursor` in body → `totalCount` is the mocked count; with `cursor` → `totalCount: null`
    and count helper not called;
  - mocked ID query returns `[]` → `{ articleCount: 0, articlesArray: [], hasMore: false,
    nextCursor: null }` and `sqlQueryArticlesAndAiScores` not called;
  - `GET /articles/test-sql` returns `articlesArrayModified` under the new flow.

Phase 2 gate: `cd api && npm run build` · `cd api && npm test` — fix failures, check off,
commit.

## Phase 3 — Portal (portal/src)

Behavior rule for this phase (preserves current UX): date, toggle, and limit changes only
update Redux `articleTableBodyParams` and light up the Refresh button via `hasFilterChanges`.
Nothing refetches except the initial mount fetch (page line ~525), `handleRefreshWithFilters`,
and the Prev/Next chunk handlers.

- [ ] `portal/src/store/features/user/userSlice.ts`:
  - add `limit: number` to `ArticleTableBodyParams` (line ~17);
  - set `limit: 5000` in `initialState.articleTableBodyParams` (~line 68) and in the
    `logoutUserFully` reset (~line 174).
- [ ] `portal/src/components/form/Select.tsx`: add an optional controlled `value?: string`
  prop. When `value` is provided, the rendered `<select>` uses it directly and ignores the
  internal `selectedValue` state (which remains for the existing `defaultValue`-only
  consumers, `form-elements/DefaultInputs.tsx` and `form-elements/SelectInputs.tsx` — both
  must keep compiling and behaving as before). `onChange` contract is unchanged.
- [ ] Add the response-metadata fields to the portal article-fetch types (no `any` — portal
  lint is strict): `limit: number`, `nextCursor: number | null`, `hasMore: boolean`,
  `totalCount: number | null` alongside the existing `articleCount`, `articlesArray`,
  `timeToRenderResponseFromApiInSeconds`.
- [ ] `portal/src/app/(dashboard)/articles/review/page.tsx` — fetch flow:
  - new local state: `chunkStartCursors: (number | null)[]` (init `[null]`),
    `currentChunkIndex: number` (init 0), `nextCursor: number | null` (init `null`),
    `totalCount: number | null` (init `null`), `hasMore: boolean` (init `false`);
  - change `fetchArticlesArray` to `fetchArticlesArray(cursor: number | null = null)`; body
    sends existing filters plus `limit` (`articleTableBodyParams.limit ?? 5000` — persisted
    pre-upgrade state lacks the field) and `cursor`;
  - on every response (including empty `articlesArray`): `setArticlesArray` with the chunk,
    set `nextCursor` and `hasMore` from the response (empty responses carry
    `nextCursor: null`, `hasMore: false`), and set `totalCount` from the response only when
    it is non-null (first chunk keeps it; later chunks return null and must not overwrite);
  - on fetch error (existing catch block): also reset `nextCursor` to `null` and `hasMore`
    to `false`;
  - chunk the AI-approver top-scores call (currently one request with all ids, lines
    ~378–380): split ids into arrays of 500, `await` them sequentially through
    `fetchAiApproverTopScores`, merge all `topScores` and `gatekeeperResults` records into
    single objects, then run the existing `mergeAiApproverTopScores` once (that function
    already uses keyed lookups — do not modify it).
- [ ] Review page — chunk navigation handlers:
  - Next (enabled only when `hasMore`): read the `nextCursor` state, call
    `fetchArticlesArray(nextCursor)`, push that cursor onto `chunkStartCursors`, increment
    `currentChunkIndex`;
  - Prev (enabled only when `currentChunkIndex > 0`): call
    `fetchArticlesArray(chunkStartCursors[currentChunkIndex - 1])`, decrement
    `currentChunkIndex`, and truncate `chunkStartCursors` so the stack top matches the new
    index (keeps Next re-walking forward consistently).
- [ ] Review page — `handleRefreshWithFilters` (~lines 658–672): in addition to its current
  `setInitialFilters` + fetch, reset `chunkStartCursors` to `[null]`, `currentChunkIndex` to
  0, `nextCursor` to `null`, `hasMore` to `false`, `totalCount` to `null`, then call
  `fetchArticlesArray(null)` (recomputes `totalCount` server-side). This is the only place
  filter/limit changes take effect.
- [ ] Review page — `hasFilterChanges` (~lines 93–107), `initialFilters` (~lines 82–91), and
  the `setInitialFilters` call inside `handleRefreshWithFilters`: include `limit` so changing
  the dropdown lights up the Refresh button like other filters and is captured on refresh.
- [ ] Filter Articles card (~lines 849–959):
  - limit dropdown using the updated `Select` with controlled
    `value={String(articleTableBodyParams.limit ?? 5000)}`, options 1,000 / 5,000 / 10,000 /
    20,000 (values `"1000"`/`"5000"`/`"10000"`/`"20000"`), `onChange` dispatching
    `updateArticleTableBodyParams({ limit: Number(value) })`;
  - total-count display from `totalCount` state (e.g. `12,483 articles match the current
    filters`; hide or show placeholder while null);
  - `Chunk n of m` indicator (`n = currentChunkIndex + 1`,
    `m = Math.ceil(totalCount / limit)`; only when `totalCount` known) plus Prev/Next buttons
    styled like the existing toggle buttons.
- [ ] Leave untouched (verify no accidental edits): `TableReviewArticles.tsx`, the
  `hideIrrelevant` client-side re-filter (page lines ~129–133), `mergeAiApproverTopScores`.

Phase 3 gate: `cd portal && npm run lint` · `cd portal && npm run build` — fix failures,
check off, commit.

## Phase 4 — Integration verification

- [ ] Full build in dependency order: `cd db-models && npm run build`, then
  `cd api && npm run build`, then `cd portal && npm run build`.
- [ ] Full api test suite: `cd api && npm test` (all suites, not just the new ones).
- [ ] Manual end-to-end against a dev database (api + portal dev servers per `AGENTS.md`):
  - review page loads chunk 1 at the default 5,000 limit; total count displays;
  - change limit to 1,000 → Refresh button lights up (no refetch yet); click Refresh →
    chunk 1 refetches and `Chunk 1 of m` shows a recomputed m;
  - toggle Hide Approved / Hide Irrelevant → Refresh lights up (no refetch yet); click
    Refresh → chunk 1 refetches with a changed `totalCount`;
  - Next/Prev traverse chunks with no duplicated or skipped articles at chunk boundaries
    (check boundary ids); Prev then Next returns to the same chunk;
  - table sorting, global search, column filters, and 5/10/20 row pagination still work
    within a chunk; selecting, approving, and marking-reviewed articles still work;
  - AI-approver columns populate (top-scores chunking works) on a chunk larger than 500;
  - `GET /articles/test-sql` responds with a bounded payload.
- [ ] Confirm api response size for a 5,000-row chunk is far below the previous full-dataset
  payloads (log or curl + `wc -c`).

Phase 4 gate: all checks above pass — check off, commit any remaining changes.

## Deployment note (operator)

api and portal must deploy together: an old portal against the new api would silently receive
only the first 5,000-article chunk (bounded by design, but user-visible).
