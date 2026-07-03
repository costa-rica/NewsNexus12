---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Review Page Chunk Pagination — Plan v02

## Changelog (v01 → v02)

This revision responds to `docs/20260703_review_chunk_pagination_plan_v01_assessment_codex.md`.
Codex confirmed the keyset-chunking architecture and raised three qualifying concerns, all
verified against the current code and all warranting a fix. The architecture is unchanged; v02
adds the missing implementation details.

1. Second caller of the hydration helper. `sqlQueryArticlesForWithRatingsRoute()` is also
   called by `GET /articles/test-sql` (`api/src/routes/articles.ts:1156`) as
   `(null, null)`. The v01 signature change (dates → `articleIds`) would break it. v02 updates
   `test-sql` to the new ID-query-then-hydrate flow (see [[#GET /articles/test-sql]]).
2. Empty-chunk path. `sqlQueryArticlesAndAiScores()` builds SQL from
   `articlesIdArray.join(",")` (`queriesSql.ts:688`); an empty array produces invalid `IN ()`.
   The route can legitimately reach an empty chunk (zero matches on chunk 1, or a cursor past
   the end). v02 adds a helper-level empty guard plus a route-level short-circuit. This also
   protects the third caller, `state-assigner.ts` (lines ~124, ~181).
3. Test layer. `api/tests/articles/articles.routes.test.ts` mocks `src/modules/queriesSql`
   entirely, so filter-parity cannot be proven there. v02 moves parity coverage onto a pure
   `buildWithRatingsWhereClause()` unit test and keeps route tests focused on orchestration
   with mocked helper returns.

No scope, cap, or design decision from v01 is otherwise altered.

## Background

On 2026-07-01 the production API crashed twice with V8 heap OOM, triggered by unbounded
article-list responses — the largest a 259 MB `POST /articles/with-ratings` response. Analysis:
`docs/20260701_CLAUDE_API_OOM_FAILURE_REPORT.md`. Fix 01 ("server pages, client accumulates")
was rejected: fetching the full result set in 200-row pages made review-page queries far too
slow.

Fix 02 (this plan) changes product behavior instead of hiding it: the user chooses how many
articles to load per chunk, the Filter Articles section shows the total match count and chunk
navigation, and the API never returns more than one bounded chunk. Assessment that shaped this
plan: `docs/20260703_FIX02_CHUNK_PAGINATION_PLAN_ASSESSMENT.md`.

## Scope (operator decisions, 2026-07-03)

- Only the `/articles/review` page flow: `POST /articles/with-ratings` and its portal call
  sites, plus the two other callers of the shared SQL helpers that must not break
  (`GET /articles/test-sql`, `analysis/state-assigner.ts`). `POST /articles` and
  `GET /articles/approved` are out of scope (future work).
- Chunk limit dropdown capped at 20,000 (operator raised from the assessment's 10,000).
- No items from the assessment's "recommendations regardless of the plan" section.

## Design overview

The API gains keyset (cursor) chunking with all filters pushed into SQL. One request returns
one chunk, never the full dataset — even from an outdated client with no pagination params. The
portal's Filter Articles section gains a limit dropdown, a total-match count, and prev/next
chunk navigation. `TableReviewArticles.tsx` (TanStack Table) is untouched: it receives the
loaded chunk and keeps its client-side sorting, global search, column filters, and 5/10/20-row
pagination.

### Request/response contract — `POST /articles/with-ratings`

New optional body fields alongside the existing five:

- `limit` — requested chunk size. Clamped server-side via `clampLimit()` to maximum 20,000;
  default 5,000 when absent or invalid.
- `cursor` — the `nextCursor` from the previous chunk; omitted/null for the first chunk.

Response keeps `articleCount` (now the chunk's count), `articlesArray`, and
`timeToRenderResponseFromApiInSeconds`, and adds:

- `limit` — effective (clamped) limit used.
- `nextCursor` — last article id in this chunk, or `null` when no more chunks.
- `hasMore` — boolean.
- `totalCount` — count of all articles matching the filters with no limit (the "unlimited
  query" count). Computed only when `cursor` is absent (first chunk / filter change); `null`
  on subsequent chunks.

### API component (api/src)

New module `api/src/modules/pagination.ts`: exports
`WITH_RATINGS_DEFAULT_LIMIT = 5000`, `WITH_RATINGS_MAX_LIMIT = 20000`, and
`clampLimit(requested: unknown, defaultLimit: number, maxLimit: number): number` (coerces to
integer, floors at 1, caps at `maxLimit`, falls back to `defaultLimit` on NaN/invalid).

Shared WHERE builder in `queriesSql.ts`:
`buildWithRatingsWhereClause(filters, cursor?)` — a pure function returning
`{ clause: string, replacements: Record<string, unknown> }` used by all three new queries so
the filter SQL cannot drift between them. Filter translation preserves the route's current
JavaScript semantics exactly (verified against the current code and against fix01 plan v03):

- date filters: `a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter` /
  `a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter`;
- `returnOnlyIsNotApproved` → `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE
  aa."articleId" = a.id AND aa."isApproved" = true)`;
- `returnOnlyIsRelevant` → `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE
  air."articleId" = a.id AND air."isRelevant" IS NOT NULL)`;
- when a `cursor` is supplied, append `a.id > :cursor`.

Two-step query pattern:

1. `sqlQueryArticleIdsForWithRatingsRoute(filters, cursor, limit)` — new lightweight ID query.
   `SELECT a.id FROM "Articles" a` + shared WHERE (with cursor) +
   `ORDER BY a.id LIMIT :limitPlusOne` (fetch `limit + 1` to compute `hasMore`; the extra row
   is dropped). Returns `number[]`.
2. `sqlQueryCountArticlesForWithRatingsRoute(filters)` — new `COUNT(*)` using the shared WHERE
   without cursor. Returns a number.

`sqlQueryArticlesForWithRatingsRoute()` (hydration, lines ~443–682) changes signature: the two
date parameters are replaced by `articleIds: number[]`, and the WHERE becomes
`WHERE a.id IN (:articleIds)` with bound replacements. Row grouping/de-duplication is unchanged
but now operates on at most one chunk. Guard: when `articleIds` is empty, return `[]` without
querying.

`sqlQueryArticlesAndAiScores()` (lines ~684–713): convert the interpolated
`articlesIdArray.join(",")` and entity id into bound `replacements`, and add an explicit guard
returning `[]` when `articlesIdArray` is empty (prevents invalid `IN ()`). This guard protects
all three callers — the review route, `test-sql`, and `state-assigner.ts` — none of which
currently guarantee a non-empty array.

Route changes (`api/src/routes/articles.ts`, `POST /with-ratings`, lines ~829–1040):

- Read `limit`/`cursor` from the body; clamp `limit`.
- Call the ID query; derive `hasMore` (more than `limit` ids returned) and `nextCursor` (last
  id of the trimmed chunk, else `null`).
- Empty-chunk short-circuit: if the ID query returns no ids, compute `totalCount` (only when
  `cursor` absent) and return `{ articleCount: 0, articlesArray: [], limit, nextCursor: null,
  hasMore: false, totalCount, timeToRenderResponseFromApiInSeconds }` without the AI-entity
  lookups or hydration.
- Otherwise compute `totalCount` only when `cursor` is absent, hydrate by ids, run the AI-score
  merges, build the response, and attach the metadata.
- Delete the JavaScript post-filter block (lines ~877–902) — its filters now run in SQL.
- Delete the dead Sequelize `whereClause`/`Op` construction (lines ~855–870).
- Replace both `Array.find()` AI-score merges (semantic scorer ~line 933, location classifier
  ~line 966) with keyed lookups: `new Map(rows.map((r) => [r.articleId, r]))` then
  `map.get(article.id)`.

#### GET /articles/test-sql

Update this diagnostic route (lines ~1152–1189) to the new flow so it keeps working and stops
being a second unbounded query: call `sqlQueryArticleIdsForWithRatingsRoute` with no filters,
no cursor, and `WITH_RATINGS_DEFAULT_LIMIT`, then hydrate those ids via
`sqlQueryArticlesForWithRatingsRoute(ids)`, then the existing single semantic-score merge
(converted to a `Map` lookup for consistency). If the operator considers `test-sql` obsolete,
the alternative is to delete the route; the plan assumes it is kept and bounded.

### Portal component (portal/src)

Redux (`portal/src/store/features/user/userSlice.ts`):

- Add `limit: number` to `ArticleTableBodyParams` (initial value 5,000). The review page
  spreads `articleTableBodyParams` into the request body, so the field flows to the API without
  extra wiring; redux-persist rehydrating older state without `limit` falls back via `?? 5000`
  at the fetch call.
- Chunk position (`cursor` history, `totalCount`, `hasMore`) is local component state on the
  review page, not Redux — transient view state.

Review page (`portal/src/app/(dashboard)/articles/review/page.tsx`):

- `fetchArticlesArray(cursor?: number | null)` sends `limit` and `cursor` in the body and
  stores response metadata. New local state: `chunkStartCursors: (number | null)[]` (stack,
  init `[null]`), `currentChunkIndex`, `totalCount`, `hasMore`.
- Navigation: "Next" fetches with `nextCursor` and pushes it; "Prev" fetches with the previous
  stacked cursor. Label `Chunk n of m`, `m = Math.ceil(totalCount / limit)`.
- Any filter change (including the limit dropdown) and "Refresh with New Filters" reset the
  cursor stack to `[null]` and refetch chunk 1 (recomputing `totalCount`). `hasFilterChanges`
  (lines ~93–107) and `initialFilters` gain the `limit` field.
- AI-approver top scores: `fetchArticlesArray` currently sends every id in one
  `POST /analysis/ai-approver/top-scores` request (lines ~378–380). Split ids into chunks of
  500, request sequentially, and merge the returned `topScores`/`gatekeeperResults` into single
  maps before `mergeAiApproverTopScores()`. Note: `mergeAiApproverTopScores()` already uses
  keyed record lookups (lines ~287–288) and needs no change.
- Response types gain the new metadata fields (strict typing — no `any`, per portal lint).
- The `hideIrrelevant` client-side re-filter (lines ~129–133) is unchanged; it now operates
  within the loaded chunk.

Filter Articles UI (same card, lines ~849–959):

- Limit dropdown using `portal/src/components/form/Select.tsx`, options 1,000 / 5,000 /
  10,000 / 20,000, wired to `updateArticleTableBodyParams({ limit })`.
- Total-count display, e.g. `12,483 articles match the current filters` (from `totalCount`),
  the `Chunk n of m` indicator, and Prev/Next buttons styled like the existing toggles.

## Behavior notes

- An outdated client sending no `limit`/`cursor` receives the first 5,000-article chunk —
  bounded by construction. Because of this behavior change, api and portal deploy together
  (response keys are additive).
- Keyset (`a.id > :cursor ORDER BY a.id`) matches the existing `ORDER BY a.id` order and cannot
  skip or duplicate rows when approvals/relevance change between chunk fetches; each chunk is a
  point-in-time snapshot, same as today.
- Worst-case response is ~20,000 rows. Operator accepts this bound; default stays 5,000 and the
  server clamp guarantees nothing above 20,000 regardless of client input.

## Testing and verification

Per `AGENTS.md`: api tests are Jest + Supertest under `api/tests/`; portal has lint only
(`cd portal && npm run lint`); build order db-models → api → portal.

SQL filter-parity — new unit test (not in the route test, which mocks `queriesSql`):

- Test `buildWithRatingsWhereClause()` directly (pure function, no DB). Assert the emitted
  clause and replacements for each `returnOnly*` combination and for the cursor case. This is
  where parity with the old JavaScript semantics is proven:
  - `returnOnlyIsNotApproved` emits `NOT EXISTS (... aa."isApproved" = true)` (excludes only
    true approvals; keeps articles whose only approval row is `false`);
  - `returnOnlyIsRelevant` emits `NOT EXISTS (... air."isRelevant" IS NOT NULL)` (excludes
    non-null relevance; keeps `isRelevant IS NULL` — the with-ratings-specific semantics);
  - date predicates and the `a.id > :cursor` predicate appear only when their inputs are set.

Route orchestration — extend `api/tests/articles/articles.routes.test.ts` (mocked helpers):

- Default limit applied when `limit` absent; `limit` above 20,000 clamped to 20,000.
- First chunk returns numeric `totalCount`; a request with `cursor` returns `totalCount: null`.
- `hasMore`/`nextCursor` derived correctly when the mocked ID query returns `limit + 1` ids
  vs fewer.
- Empty-chunk path: mocked ID query returns `[]` → response is
  `{ articleCount: 0, articlesArray: [], hasMore: false, nextCursor: null, totalCount }` and
  `sqlQueryArticlesAndAiScores` is not called.
- `test-sql` still returns a bounded `articlesArrayModified` after the flow change.

Empty-array guard — unit test that `sqlQueryArticlesAndAiScores([], id)` returns `[]` without
issuing SQL.

Manual verification on a production-sized dataset: chunk 1 loads quickly, the total count
matches expectations, Prev/Next walk the result set, and per-request response sizes stay far
below the previous full-dataset payloads.

## Non-goals

- `POST /articles` and `GET /articles/approved` bounding — future plan.
- Server-driven TanStack table (server-side sort/search) — unchanged client behavior is a
  requirement.
- Operational mitigations (systemd `Restart=on-failure`, telemetry) — excluded by operator.
