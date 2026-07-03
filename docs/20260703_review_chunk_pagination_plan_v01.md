---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Review Page Chunk Pagination — Plan v01

## Background

On 2026-07-01 the production API crashed twice with V8 heap OOM, triggered by unbounded
article-list responses — the largest a 259 MB `POST /articles/with-ratings` response. Analysis:
`docs/20260701_CLAUDE_API_OOM_FAILURE_REPORT.md`. Fix 01 ("server pages, client accumulates",
final plan `20260701_api_pagination_oom_fix_plan_v03.md`, now in the operator's
`fix01-failed/` archive) was rejected: fetching the full result set in 200-row pages made
review-page queries far too slow.

Fix 02 (this plan) changes the product behavior instead of hiding it: the user chooses how many
articles to load per chunk, the Filter Articles section shows the total match count and chunk
navigation, and the API never returns more than one bounded chunk. Assessment that shaped this
plan: `docs/20260703_FIX02_CHUNK_PAGINATION_PLAN_ASSESSMENT.md`.

## Scope (operator decisions, 2026-07-03)

- Only the `/articles/review` page flow: `POST /articles/with-ratings` and its portal call
  sites. `POST /articles` and `GET /articles/approved` are explicitly out of scope for this
  plan (future work).
- Chunk limit dropdown capped at 20,000 (operator raised from the assessment's suggested
  10,000; users will learn to keep the value low).
- No items from the assessment's "recommendations regardless of the plan" section (no systemd
  changes, no telemetry, no `textForPdfReport` change, no changes to the other two endpoints).

## Design overview

The API gains keyset (cursor) chunking with all filters pushed into SQL. One request returns
one chunk, never the full dataset — even when called by an outdated client with no pagination
parameters. The portal's Filter Articles section gains a limit dropdown, a total-match count,
and prev/next chunk navigation. `TableReviewArticles.tsx` (TanStack Table) is untouched: it
receives the loaded chunk and keeps its existing client-side sorting, global search, column
filters, and 5/10/20-row pagination.

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
`clampLimit(requested: unknown, defaultLimit: number, maxLimit: number): number`.

Two-step query pattern in `api/src/modules/queriesSql.ts`:

1. `sqlQueryArticleIdsForWithRatingsRoute(filters, cursor, limit)` — new lightweight ID query.
   Selects `a.id FROM "Articles" a` with all filters in SQL, `WHERE a.id > :cursor ORDER BY
   a.id LIMIT :limit + 1` (the extra row determines `hasMore` and is dropped). Filter
   translation preserves the route's current JavaScript semantics exactly (verified in fix01
   plan v03 and reused here):
   - date filters: `a."createdAt" >= :date` / `a."publishedDate" >= :date` (same as the
     existing hydration query, lines ~450–462);
   - `returnOnlyIsNotApproved` → `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE
     aa."articleId" = a.id AND aa."isApproved" = true)`;
   - `returnOnlyIsRelevant` → `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE
     air."articleId" = a.id AND air."isRelevant" IS NOT NULL)`.
2. `sqlQueryCountArticlesForWithRatingsRoute(filters)` — new `COUNT(*)` sharing the same WHERE
   builder as the ID query (extract a shared `buildWithRatingsWhereClause(filters)` helper so
   the two cannot drift).

`sqlQueryArticlesForWithRatingsRoute()` (hydration, lines ~443–682) changes signature: the two
date parameters are replaced by `articleIds: number[]`, and the WHERE becomes
`WHERE a.id IN (:articleIds)` with bound replacements. Row grouping/de-duplication logic is
unchanged but now operates on at most one chunk. When `articleIds` is empty the function
returns `[]` without querying.

Route changes (`api/src/routes/articles.ts`, `POST /with-ratings`, lines ~829–1040):

- Read `limit`/`cursor` from the body; clamp.
- Call the ID query, derive `hasMore`/`nextCursor`, call the count query only when `cursor` is
  absent, then hydrate by ids.
- Delete the JavaScript post-filter block (lines ~877–902) — its filters now run in SQL.
- Replace both `Array.find()` AI-score merges (semantic scorer ~line 933, location classifier
  ~line 966) with keyed lookups: build `new Map(rows.map((r) => [r.articleId, r]))` per score
  set and use `map.get(article.id)`.
- `sqlQueryArticlesAndAiScores()` (queriesSql.ts ~684–713) currently interpolates the id array
  and entity id directly into the SQL string; convert to bound `replacements` while touching
  it. It already accepts an id array, so it is naturally chunk-bounded.
- Unused `whereClause` construction at lines ~855–870 (dead Sequelize `Op` code) is removed.

### Portal component (portal/src)

Redux (`portal/src/store/features/user/userSlice.ts`):

- Add `limit: number` to `ArticleTableBodyParams` (initial value 5,000, matching the API
  default). Because the review page spreads `articleTableBodyParams` into the request body,
  the new field flows to the API without extra wiring. redux-persist rehydrates older
  persisted state without `limit`; the fetch falls back to the default via `?? 5000`.
- Chunk position (`cursor` history, `totalCount`, `hasMore`) is deliberately local component
  state on the review page, not Redux — it is transient view state.

Review page (`portal/src/app/(dashboard)/articles/review/page.tsx`):

- `fetchArticlesArray(cursor?: number | null)` sends `limit` and `cursor` in the body and
  stores the response metadata. New local state: `chunkStartCursors: (number | null)[]`
  (stack, initialized `[null]`), `currentChunkIndex`, `totalCount`, `hasMore`.
- Chunk navigation: "Next" fetches with `nextCursor` and pushes it onto the stack; "Prev"
  fetches with `chunkStartCursors[currentChunkIndex - 1]`. Chunk label:
  `Chunk n of m` where `m = Math.ceil(totalCount / limit)` (from the first-chunk
  `totalCount`).
- "Refresh with New Filters" and any filter change reset the cursor stack to `[null]` and
  refetch chunk 1 (recomputing `totalCount`). `hasFilterChanges` (lines ~93–107) and
  `initialFilters` gain the `limit` field so changing the dropdown lights up the Refresh
  button like any other filter.
- AI-approver top scores: `fetchArticlesArray` currently sends every article id in one
  `POST /analysis/ai-approver/top-scores` request (line ~378–380). Split ids into chunks of
  500, request sequentially, and merge the returned `topScores`/`gatekeeperResults` records
  into single maps before `mergeAiApproverTopScores()` (which already uses keyed record
  lookups and needs no change).
- Response types gain the new metadata fields (strict typing — no `any`, per portal lint).
- The `hideIrrelevant` client-side re-filter (lines ~129–133) is unchanged; it now operates
  within the loaded chunk, which is consistent with the table operating on chunks.

Filter Articles UI (same card, lines ~849–959):

- Limit dropdown using the existing `portal/src/components/form/Select.tsx`, options 1,000 /
  5,000 / 10,000 / 20,000, wired to `updateArticleTableBodyParams({ limit })`.
- Total count display, e.g. `12,483 articles match the current filters` (from `totalCount`),
  plus the chunk indicator and Prev/Next buttons styled like the existing toggle buttons.

## Behavior notes

- An outdated client sending no `limit`/`cursor` receives the first 5,000-article chunk —
  bounded by construction; no request shape returns the full dataset. Because of this behavior
  change, api and portal deploy together (response keys are additive).
- Keyset (`a.id > :cursor ORDER BY a.id`) matches the existing `ORDER BY a.id` output order
  and cannot skip or duplicate rows when approvals/relevance change between chunk fetches;
  each chunk remains a point-in-time snapshot, same as today.
- Worst-case response is ~20,000 rows. Operator accepts this upper bound; the default stays at
  5,000 and the server clamp guarantees nothing above 20,000 regardless of client input.

## Testing and verification

Per `AGENTS.md`: api tests are Jest + Supertest under `api/tests/` (extend
`api/tests/articles/articles.routes.test.ts`); portal has lint only
(`cd portal && npm run lint`); build order db-models → api → portal.

New api tests for `POST /articles/with-ratings`:

- Default limit applied when `limit` absent; `limit` above 20,000 clamped to 20,000.
- Cursor traversal: walking chunks yields the full filtered set exactly once and ends with
  `hasMore: false`, `nextCursor: null`.
- `totalCount` is a number on the first chunk and `null` when `cursor` is supplied.
- Filter parity against the previous JavaScript semantics (fixtures from fix01 plan v03):
  an article whose only approval row has `isApproved = true` is excluded under
  `returnOnlyIsNotApproved`; one whose only approval row has `isApproved = false` is kept;
  an article whose only relevance row has non-null `isRelevant` is excluded under
  `returnOnlyIsRelevant`; one whose only relevance row has `isRelevant IS NULL` is kept
  (the with-ratings-specific semantics).

Manual verification on a production-sized dataset: the review page loads chunk 1 quickly,
the total count matches expectations, Prev/Next walk the result set, and per-request response
sizes stay far below the previous full-dataset payloads.

## Non-goals

- `POST /articles` and `GET /articles/approved` bounding — future plan.
- Server-driven TanStack table (server-side sort/search) — unchanged client-side behavior is a
  requirement of this plan.
- Operational mitigations (systemd `Restart=on-failure`, telemetry) — excluded by operator.
