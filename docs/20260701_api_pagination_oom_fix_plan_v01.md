---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# API Pagination OOM Fix — Plan v01

## Background

On 2026-07-01 the production API (`newsnexus12-api.service`) crashed twice with V8 heap
exhaustion (`FATAL ERROR: Ineffective mark-compacts near heap limit`). Both crashes were
preceded by very large article-list responses, including a 259 MB `POST /articles/with-ratings`
response. Full analysis is in `docs/20260701_API_OOM_FAILURE_REPORT.md` and
`docs/20260701_CLAUDE_API_OOM_FAILURE_REPORT.md`.

The root cause is that three endpoints materialize the full article dataset (and several
full-table side queries), filter it in JavaScript, and serialize one unbounded JSON response:

- `POST /articles` (`api/src/routes/articles.ts` ~53–201)
- `GET /articles/approved` (`api/src/routes/articles.ts` ~203–259)
- `POST /articles/with-ratings` (`api/src/routes/articles.ts` ~829–1040)

## Scope

This plan implements recommendations 1, 2, and 4 from the Claude report:

1. Cursor-based pagination with a server-enforced maximum page size and response metadata.
2. Filtering and limits pushed into SQL instead of JavaScript post-filtering.
3. ~~Remove large text/report fields from list responses~~ — **excluded by operator decision.**
   `textForPdfReport` and similar fields remain in `GET /articles/approved` responses; the
   page-size cap for that endpoint is set conservatively to compensate.
4. Replace repeated `Array.find()` AI-score lookups with keyed `Map` lookups.

Portal alignment strategy (operator decision): **server pages, client accumulates.** The API
becomes paginated; the portal fetches pages in a loop until `hasMore` is `false` and
accumulates results into the same state arrays it uses today. The portal's existing
client-side table pagination, sorting, global search, and filters (TanStack Table in
`portal/src/components/tables/TableReviewArticles.tsx`) are intentionally **unchanged** —
users continue to see every article matching their query.

## Design

### Pagination model

Keyset (cursor) pagination on `Articles.id` ascending, not page/offset. Approvals and new
articles land between page fetches; offset pages would skip or duplicate rows, while
`WHERE a.id > :cursor ORDER BY a.id LIMIT :pageSize` is stable.

Request parameters (body for the two POST endpoints, query string for the GET endpoint):

- `pageSize` (optional) — clamped server-side to the endpoint's maximum.
- `cursor` (optional) — the `nextCursor` value from the previous response; omitted on the
  first request.

Response metadata added alongside the existing `articlesArray` key (existing keys are kept so
the response stays backward-shaped):

- `pageSize` — the effective (clamped) page size used.
- `nextCursor` — the last article id in this page, or `null` when no further pages exist.
- `hasMore` — boolean.
- `totalCount` — total rows matching the filters. Computed with a `COUNT` query **only on the
  first request** (no `cursor` supplied) to avoid repeating the cost on every page; `null` on
  subsequent pages.

A request with no pagination parameters returns the **first page at the default page size** —
never the full dataset. This is the property that fixes the OOM: no request shape can produce
an unbounded response.

### Page-size constants

One new module `api/src/modules/pagination.ts` exports the constants and a
`clampPageSize(requested, defaultSize, maxSize)` helper so limits live in one place:

| Endpoint                      | Default | Maximum | Rationale                                  |
| ----------------------------- | ------- | ------- | ------------------------------------------ |
| `POST /articles/with-ratings` | 200     | 500     | Moderate rows (no content/report fields)   |
| `POST /articles`              | 200     | 500     | Moderate rows                              |
| `GET /articles/approved`      | 50      | 200     | Heavy rows (`textForPdfReport` retained)   |

Exact values are tunable at implementation time; the invariant is that a maximum is enforced
regardless of what the client requests.

### Two-step query pattern (applies to all three endpoints)

To keep the existing multi-join hydration queries intact while bounding memory:

1. **ID page query** — a new lightweight SQL query per endpoint selects only the page of
   matching `Articles.id` values, with **all** filters expressed in SQL (dates, approval
   status, relevance), `WHERE a.id > :cursor ORDER BY a.id LIMIT :pageSize + 1`. Fetching
   `pageSize + 1` rows determines `hasMore` without a second query; the extra row is dropped.
2. **Hydration query** — the existing per-endpoint join query, modified to accept an
   `articleIds` array and constrained with `WHERE a.id IN (:articleIds)`. Row de-duplication
   and grouping logic in `queriesSql.ts` is unchanged, but now operates on at most one page of
   articles.

Filter translation to SQL (preserving each endpoint's current JavaScript semantics exactly):

- `returnOnlyIsNotApproved` in `POST /articles`: currently excludes articles having **any**
  `ArticleApproveds` row → `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id)`.
- `returnOnlyIsNotApproved` in `POST /articles/with-ratings`: currently excludes articles
  having an `ArticleApproveds` row with `isApproved` true →
  `NOT EXISTS (... AND aa."isApproved" = true)`.
- `returnOnlyIsRelevant` (both POST endpoints): currently excludes articles having any
  `ArticleIsRelevants` row with non-null `isRelevant` →
  `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id AND air."isRelevant" IS NOT NULL)`.
- `GET /articles/approved`: currently keeps only articles with an approval where
  `isApproved` is truthy → `EXISTS (... aa."isApproved" = true)` (the current JS also accepts
  `1`; Postgres boolean semantics make `= true` equivalent).
- Date filters (`returnOnlyThisPublishedDateOrAfter`, `returnOnlyThisCreatedAtDateOrAfter`)
  already run in SQL and move into the ID page query unchanged.

The `COUNT` query for `totalCount` reuses the same WHERE clause as the ID page query.

## API changes by endpoint

### `POST /articles/with-ratings` (highest priority)

- Read `pageSize`/`cursor` from the body; clamp via `pagination.ts`.
- New `sqlQueryArticleIdsForWithRatingsRoute(filters, cursor, limit)` in
  `api/src/modules/queriesSql.ts` implementing the ID page query with the SQL filters above.
- Modify `sqlQueryArticlesForWithRatingsRoute` to require an `articleIds` array and add
  `WHERE a.id IN (:articleIds)`; drop its date-filter parameters (now handled by the ID query).
- Delete the JavaScript `articlesArrayFilteredNoAi` filtering block (lines ~877–902) — the ID
  query already applied those filters.
- **Map lookups (recommendation 4):** after each `sqlQueryArticlesAndAiScores` call, build
  `new Map(rows.map(r => [r.articleId, r]))` and replace both `Array.find()` calls (semantic
  scorer and location classifier merges) with `map.get(article.id)`.
- `sqlQueryArticlesAndAiScores` currently interpolates `articlesIdArray` and the entity id
  directly into the SQL string; convert to bound `replacements` while touching it.
- Response adds `pageSize`, `nextCursor`, `hasMore`, `totalCount`; keeps `articleCount`
  (now the page's count), `articlesArray`, and `timeToRenderResponseFromApiInSeconds`.

### `POST /articles`

- Read `pageSize`/`cursor` from the body; clamp.
- New `sqlQueryArticleIds(filters, cursor, limit)` ID page query (dates + the two
  `returnOnly*` filters in SQL).
- Constrain the three currently full-table side queries — `sqlQueryArticlesWithStates()`,
  `sqlQueryArticlesIsRelevant()`, `sqlQueryArticlesApproved()` — to accept an `articleIds`
  array and filter `WHERE ... "articleId" IN (:articleIds)`. Today each scans its entire
  table on every request, which contributes to heap pressure independent of the main query.
- Constrain `sqlQueryArticles` to the page's ids (its date parameters become redundant but
  harmless; the route passes the page ids).
- Remove the JavaScript `returnOnlyIsNotApproved` / `returnOnlyIsRelevant` post-filters
  (lines ~188–198) — handled in SQL. The per-article `articleIsApproved` /
  `ArticleIsRelevant` response fields are still derivable from the side-query maps.
- Response adds the pagination metadata alongside `articlesArray`.

### `GET /articles/approved`

- Read `pageSize`/`cursor` from `req.query`; clamp (conservative cap — heavy rows).
- New `sqlQueryApprovedArticleIds(cursor, limit)` ID page query with the `EXISTS` approval
  filter.
- Modify `sqlQueryArticlesWithStatesApprovedReportContract` to accept `articleIds` and add
  `WHERE a.id IN (:articleIds)`; grouping logic unchanged.
- Remove the JavaScript approval filter in the route (lines ~217–221) — handled in SQL. The
  `isSubmitted` / `articleHasBeenAcceptedByAll` / `stateAbbreviation` mapping stays as is.
- Response adds the pagination metadata.

## Portal changes

One new shared helper plus three call-site updates. No table component changes.

### Shared page-accumulation helper

New `portal/src/lib/fetchAllArticlePages.ts` exporting an async function that:

- Takes the endpoint URL, method, auth token, base body/query params, and an optional
  `onProgress(loadedCount, totalCount)` callback.
- Loops: sends the request with the current `cursor`, appends `articlesArray` to an
  accumulator, reads `nextCursor`/`hasMore`, repeats until `hasMore` is `false`.
- Includes a defensive iteration cap (e.g., 500 pages) that aborts with an error rather than
  looping forever if the API misbehaves.
- Returns `{ articlesArray, totalCount }`.

New pagination-metadata fields are added to the portal's response types (strict typing — no
`any`, per portal lint rules).

### Call sites

- `portal/src/app/(dashboard)/articles/review/page.tsx` (`fetchArticlesArray`, ~line 338):
  replace the single fetch to `POST /articles/with-ratings` with the helper. After
  accumulation completes, the AI-approver top-scores fetch
  (`POST /analysis/ai-approver/top-scores`) sends article ids in **chunks** (e.g., 500 ids per
  request, merged into one map) instead of one giant id list, since that request scales with
  the full result set. The final `setArticlesArray` and merge logic are unchanged, so the
  loading state, auto-select-first-article behavior, and table UX behave exactly as today.
- `portal/src/app/(dashboard)/reports/weekly-cpsc/page.tsx` (~line 73): loop
  `GET /articles/approved` pages via the helper (cursor passed as a query parameter).
- `portal/src/app/(dashboard)/articles/add-delete/page.tsx` (~line 91): loop
  `POST /articles` pages via the helper.

## Deployment coupling and compatibility

The portal is the only consumer of all three endpoints (verified by repository search). Since
an un-updated client calling without pagination parameters now receives only the first page,
**api and portal must be deployed together**. Response bodies keep their existing keys
(`articlesArray`, `articleCount`, `timeToRenderResponseFromApiInSeconds`), so the change is
additive in shape; only the "all rows in one response" behavior changes.

Snapshot semantics during accumulation: an approval or relevance toggle happening mid-loop can
cause an article to shift relative to the filter on later pages. This matches the existing
behavior (the current single response is also a point-in-time snapshot) and keyset cursors
prevent duplicates or skips from id-ordering drift.

## Testing and verification

Per `AGENTS.md`: api tests are Jest + Supertest (`cd api && npm test`); portal has lint only
(`cd portal && npm run lint`); build order is db-models → api → portal.

New api tests (following existing suite patterns) covering, for each endpoint:

- Default page size applies when no `pageSize` is sent.
- Requested `pageSize` above the maximum is clamped.
- Cursor traversal: walking pages yields the full filtered set exactly once (no duplicates,
  no gaps) and terminates with `hasMore: false`.
- `totalCount` present on the first page, `null` afterward.
- Filter parity: SQL-filtered results match the previous JavaScript-filter semantics for
  approved/relevant combinations.

Manual verification against a production-sized dataset should confirm the review page still
loads the complete article set and that per-request API responses stay in the single-digit-MB
range.

## Non-goals

- Recommendation 3 (removing `textForPdfReport` etc. from list responses) — excluded by
  operator decision.
- Fully server-driven table (server-side sort/search/filter for TanStack Table) — a possible
  future phase if article volume outgrows browser memory; nothing in this plan precludes it.
- Operational mitigations from the reports (`Restart=on-failure` systemd unit change, memory
  telemetry/alerting, Express `trust proxy` setting) — server configuration handled outside
  this repository change, except `trust proxy`, which can be a separate small follow-up.
