---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# API Pagination OOM Fix — Todo v01

Implements `docs/20260701_api_pagination_oom_fix_plan_v03.md` (the approved plan). Read that
plan in full before starting — especially the [[Design]] section's per-endpoint SQL filter
mappings, which were corrected twice through the assessment loop
(`..._plan_v01_assessment_codex.md`, `..._plan_v02_assessment_codex.md`) and must be
implemented **exactly as written in v03**. Background is in
`docs/20260701_CLAUDE_API_OOM_FAILURE_REPORT.md`.

## Instructions for the implementing agent

- Work on branch `dev_19_fix_overload_api`.
- Complete phases in order. At the end of each phase: (1) run type/lint checks, (2) run tests,
  (3) attempt to build — as itemized in each phase's verification tasks. If anything fails,
  fix the code so the intended functionality remains and the checks pass. Only after
  verification passes: check off the phase's completed tasks in this file (update
  `updated_at`/`modified_by` in the frontmatter) and commit the changes for that phase,
  following the commit guidance in `AGENTS.md` (reference this todo file and the phase in the
  commit message).
- Build order matters: `db-models` → `api` → `portal`. db-models is unchanged by this work but
  must be built first if its `dist/` output is missing.

### Safety constraints

- **No pushes, no deploys, no service/systemd changes, no service restarts, and no database
  mutations (schema changes, data edits, migrations) unless separately authorized by the
  operator.** Jest tests using the configured test setup are fine; do not point tests at
  production data.
- Local phase commits only, and only after that phase's verification passes.
- Do not modify unrelated files. Do not overwrite or edit existing plan/assessment docs.
- Preserve existing response keys and behavior everywhere except as specified below.

### Operator decisions to preserve (do not "improve" these away)

- **Keep `textForPdfReport`** and similar heavy fields in `GET /articles/approved` responses
  (plan recommendation 3 was excluded by operator decision); the conservative page cap
  compensates.
- **Portal strategy is "server pages, client accumulates":** the portal fetches all pages and
  accumulates them into the same state arrays used today. Client-side table pagination,
  sorting, global search, and filters (TanStack Table in
  `portal/src/components/tables/TableReviewArticles.tsx`) are **unchanged** — users still see
  every article matching their query. Do not convert any table to server-driven mode.
- **Pagination model is keyset (cursor on `Articles.id` ascending)**, not page/offset.
- Non-goals (do not implement in this change): `Restart=on-failure` systemd unit change,
  memory telemetry/alerting, Express `trust proxy`, server-driven table features. These are
  handled outside this repo change.

---

## Phase 1 — Pagination module and constants (api)

- [ ] Create `api/src/modules/pagination.ts` exporting:
  - [ ] Per-endpoint default/maximum page-size constants (values from the plan, tunable):
        `POST /articles/with-ratings` default 200 / max 500; `POST /articles` default 200 /
        max 500; `GET /articles/approved` default 50 / max 200.
  - [ ] `clampPageSize(requested, defaultSize, maxSize)` — returns `defaultSize` when
        `requested` is missing/invalid (non-numeric, non-integer, `<= 0`), otherwise
        `min(requested, maxSize)`.
  - [ ] A cursor parser/validator helper (accepts a positive-integer article id or
        `undefined`; rejects garbage rather than interpolating it into SQL).
- [ ] Add a Jest unit test for `clampPageSize` and cursor parsing (missing, valid, above-max,
      zero/negative, non-numeric inputs), following existing suite patterns under `api/`.

### Phase 1 verification

- [ ] `cd api && npm run build` (tsc type check + build).
- [ ] `cd api && npm test` — fix any failures.
- [ ] Check off completed Phase 1 tasks and commit Phase 1 changes.

---

## Phase 2 — `POST /articles/with-ratings` (highest priority endpoint)

Route: `api/src/routes/articles.ts` (~lines 830–1040). Queries:
`api/src/modules/queriesSql.ts`.

- [ ] Add `sqlQueryArticleIdsForWithRatingsRoute(filters, cursor, limit)` to
      `api/src/modules/queriesSql.ts`: a lightweight ID page query selecting only matching
      `Articles.id` values with **all** filters in SQL, using
      `WHERE a.id > :cursor ORDER BY a.id LIMIT :pageSize + 1` (fetch `pageSize + 1` to derive
      `hasMore`; drop the extra row). Use bound `replacements` — no string interpolation.
  - [ ] Date filters (`returnOnlyThisPublishedDateOrAfter`,
        `returnOnlyThisCreatedAtDateOrAfter`) move into this query unchanged.
  - [ ] `returnOnlyIsNotApproved` →
        `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id AND aa."isApproved" = true)`.
  - [ ] `returnOnlyIsRelevant` →
        `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id AND air."isRelevant" IS NOT NULL)`.
- [ ] Add a matching `COUNT` query (same WHERE clause, no cursor/limit) for `totalCount`.
- [ ] Modify `sqlQueryArticlesForWithRatingsRoute` (queriesSql.ts ~line 443) to require an
      `articleIds` array and constrain with `WHERE a.id IN (:articleIds)`; drop its
      date-filter parameters (now handled by the ID query). Keep its row de-duplication and
      grouping logic unchanged. Update the other caller at `api/src/routes/articles.ts`
      ~line 1156 (`GET` route calling `sqlQueryArticlesForWithRatingsRoute(null, null)`) to
      keep compiling and behaving as before — if that route must remain unpaginated for now,
      give it an explicit ID-list or documented pass-through path rather than silently
      breaking it.
- [ ] In the `POST /articles/with-ratings` route handler:
  - [ ] Read `pageSize` and `cursor` from the request body; clamp/validate via
        `pagination.ts`.
  - [ ] Call the ID page query first; short-circuit sensibly on an empty page (empty
        `articlesArray`, `hasMore: false`, `nextCursor: null`).
  - [ ] Run `totalCount` COUNT query **only when no `cursor` was supplied** (first page);
        return `totalCount: null` on subsequent pages.
  - [ ] Pass the page's ids into `sqlQueryArticlesForWithRatingsRoute`.
  - [ ] Delete the JavaScript `articlesArrayFilteredNoAi` post-filtering block
        (~lines 877–902) — the ID query now applies those filters in SQL.
  - [ ] **Map lookups (plan recommendation 4):** after each `sqlQueryArticlesAndAiScores`
        call (semantic-scorer and location-classifier merges, ~lines 927 and 958), build
        `new Map(rows.map(r => [r.articleId, r]))` and replace both `Array.find()` calls
        with `map.get(article.id)`.
  - [ ] `sqlQueryArticlesAndAiScores` (queriesSql.ts ~line 684) currently interpolates
        `articlesIdArray` and the entity id directly into the SQL string — convert to bound
        `replacements` while touching it.
  - [ ] Response: add `pageSize` (effective clamped value), `nextCursor` (last article id in
        the page, or `null` when done), `hasMore`, `totalCount`; **keep** existing keys
        `articleCount` (now the page's count), `articlesArray`, and
        `timeToRenderResponseFromApiInSeconds`.
- [ ] Add Jest + Supertest tests for this endpoint (follow existing suite patterns):
  - [ ] No `pageSize` sent → default page size applies (never the full dataset).
  - [ ] `pageSize` above the maximum → clamped to the maximum.
  - [ ] Cursor traversal: walking pages yields the full filtered set exactly once (no
        duplicates, no gaps) and terminates with `hasMore: false`.
  - [ ] `totalCount` present on the first page, `null` on subsequent pages.
  - [ ] Filter parity (fixtures per plan v03 — note the v03 correction):
    - [ ] **False-approval fixture** (only `ArticleApproveds` row has `isApproved = false`):
          **kept** under `returnOnlyIsNotApproved`. (Both POST endpoints keep it — do NOT
          expect divergence on this fixture.)
    - [ ] **Null-relevance fixture** (only `ArticleIsRelevants` row has
          `isRelevant IS NULL`): **kept** under `returnOnlyIsRelevant` (only non-null
          `isRelevant` rows disqualify on this endpoint).
    - [ ] True-approval row → excluded under `returnOnlyIsNotApproved`.
    - [ ] Non-null relevant row → excluded under `returnOnlyIsRelevant`.
    - [ ] Article with no approval/relevance rows → kept under both flags.

### Phase 2 verification

- [ ] `cd api && npm run build`.
- [ ] `cd api && npm test` — fix failures while preserving the semantics above.
- [ ] Check off completed Phase 2 tasks and commit Phase 2 changes.

---

## Phase 3 — `POST /articles` (add/delete list)

Route: `api/src/routes/articles.ts` (~lines 53–201).

**Semantics warning:** this endpoint's relevance/approval semantics differ from
`with-ratings`. Use exactly the SQL below (the corrected mappings from plan v02/v03), not the
Phase 2 predicates.

- [ ] Add `sqlQueryArticleIds(filters, cursor, limit)` ID page query in `queriesSql.ts`
      (bound replacements, `LIMIT :pageSize + 1`, cursor keyset) implementing the date
      filters plus:
  - [ ] `returnOnlyIsNotApproved` →
        `NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id AND aa."isApproved" = true)`
        (do **not** use a bare `NOT EXISTS` on any approval row — that would also exclude
        articles whose only approval rows are non-approved).
  - [ ] `returnOnlyIsRelevant` →
        `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id)`
        (no `isRelevant` predicate — **any** relevance row, including null, disqualifies on
        this endpoint; do **not** add `AND air."isRelevant" IS NOT NULL`).
- [ ] Add the matching `COUNT` query for `totalCount` (same WHERE clause).
- [ ] Constrain the three currently full-table side queries to accept an `articleIds` array
      and filter `WHERE ... "articleId" IN (:articleIds)` (each currently scans its whole
      table on every request):
  - [ ] `sqlQueryArticlesWithStates()` (~line 268).
  - [ ] `sqlQueryArticlesIsRelevant()` (~line 747) — keep its SQL otherwise unchanged (no
        `isRelevant` predicate) so the derived `ArticleIsRelevant` field stays consistent.
  - [ ] `sqlQueryArticlesApproved()` (~line 65) — keep its `isApproved = true` filter
        unchanged so the derived `articleIsApproved` field stays consistent.
  - [ ] Update **all** other call sites of these three helpers (e.g. the summary-statistics
        route around `api/src/routes/articles.ts:615–652` and any other importers found via
        repo search) so they keep compiling and behaving as before — make `articleIds`
        optional-with-explicit-intent or provide a documented unbounded path for those
        callers; do not silently change their results.
- [ ] Constrain `sqlQueryArticles` (~line 223) to the page's ids (its date parameters become
      redundant but harmless; the route passes the page ids).
- [ ] In the route handler:
  - [ ] Read `pageSize`/`cursor` from the body; clamp/validate via `pagination.ts`.
  - [ ] ID page query first; `totalCount` COUNT only on the first page (`null` after).
  - [ ] Remove the JavaScript `returnOnlyIsNotApproved` / `returnOnlyIsRelevant` post-filters
        (~lines 188–198) — now handled in SQL. Keep populating the per-article
        `articleIsApproved` / `ArticleIsRelevant` response fields from the (now
        page-constrained) side-query maps.
  - [ ] Response: add `pageSize`, `nextCursor`, `hasMore`, `totalCount` alongside the
        existing keys (keep `articlesArray` and any existing count/timing keys).
- [ ] Add Jest + Supertest tests for this endpoint:
  - [ ] Default page size, clamping, cursor traversal (complete set, no dupes/gaps,
        terminates), `totalCount` first-page-only — same shape as Phase 2.
  - [ ] Filter parity with this endpoint's own semantics:
    - [ ] **False-approval fixture** → **kept** under `returnOnlyIsNotApproved` (same as
          with-ratings; this fixture does not distinguish the endpoints).
    - [ ] **Null-relevance fixture** → **excluded** under `returnOnlyIsRelevant` (this is
          the **only** fixture that distinguishes the two POST endpoints — with-ratings
          keeps it, this endpoint excludes it).
    - [ ] True-approval row → excluded under `returnOnlyIsNotApproved`.
    - [ ] Any non-null relevant row → excluded under `returnOnlyIsRelevant`.
    - [ ] No approval/relevance rows → kept under both flags.
    - [ ] `articleIsApproved` / `ArticleIsRelevant` fields on returned rows match current
          behavior.

### Phase 3 verification

- [ ] `cd api && npm run build`.
- [ ] `cd api && npm test` — fix failures.
- [ ] Check off completed Phase 3 tasks and commit Phase 3 changes.

---

## Phase 4 — `GET /articles/approved` (weekly CPSC reports source)

Route: `api/src/routes/articles.ts` (~lines 204–259).

- [ ] Add `sqlQueryApprovedArticleIds(cursor, limit)` ID page query in `queriesSql.ts` with
      the approval filter
      `EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id AND aa."isApproved" = true)`
      (Postgres boolean semantics make `= true` equivalent to the current JS truthy check
      that also accepted `1`).
- [ ] Add the matching `COUNT` query for `totalCount`.
- [ ] Modify `sqlQueryArticlesWithStatesApprovedReportContract` (~line 292) to accept
      `articleIds` and add `WHERE a.id IN (:articleIds)`; grouping/de-duplication logic
      unchanged. **Do not remove `textForPdfReport` or other heavy fields** — operator
      decision; the conservative page cap (default 50 / max 200) compensates.
- [ ] In the route handler:
  - [ ] Read `pageSize`/`cursor` from `req.query`; clamp/validate via `pagination.ts`
        (remember query values arrive as strings).
  - [ ] Remove the JavaScript approval filter (~lines 217–221) — handled in SQL. Keep the
        `isSubmitted` / `articleHasBeenAcceptedByAll` / `stateAbbreviation` mapping as is.
  - [ ] `totalCount` COUNT only on the first page (`null` after).
  - [ ] Response: add `pageSize`, `nextCursor`, `hasMore`, `totalCount` alongside the
        existing keys.
- [ ] Add Jest + Supertest tests: default page size, clamping, cursor traversal
      (complete/no-dupes/terminates), `totalCount` first-page-only, and filter parity —
      only true-approved articles returned; an article whose only approval row has
      `isApproved = false` is excluded; heavy fields like `textForPdfReport` still present
      in row objects.

### Phase 4 verification

- [ ] `cd api && npm run build`.
- [ ] `cd api && npm test` — fix failures.
- [ ] Check off completed Phase 4 tasks and commit Phase 4 changes.

---

## Phase 5 — Portal: page-accumulation helper and call sites

Strict typing throughout — portal ESLint prohibits `any`; use specific types, generics, or
`unknown`.

- [ ] Create `portal/src/lib/fetchAllArticlePages.ts` exporting an async helper that:
  - [ ] Takes the endpoint URL, HTTP method, auth token, base body/query params, and an
        optional `onProgress(loadedCount, totalCount)` callback.
  - [ ] Loops: sends the request with the current `cursor` (body param for POST endpoints,
        query-string param for GET), appends each response's `articlesArray` to an
        accumulator, reads `nextCursor`/`hasMore`, and repeats until `hasMore` is `false`.
  - [ ] Captures `totalCount` from the first page.
  - [ ] Has a defensive iteration cap (e.g. 500 pages) that aborts with a thrown error
        rather than looping forever if the API misbehaves.
  - [ ] Returns `{ articlesArray, totalCount }`.
- [ ] Add the new pagination-metadata fields (`pageSize`, `nextCursor`, `hasMore`,
      `totalCount`) to the portal's article-endpoint response types.
- [ ] Update `portal/src/app/(dashboard)/articles/review/page.tsx`:
  - [ ] In `fetchArticlesArray` (~line 338), replace the single fetch to
        `POST /articles/with-ratings` (~line 356) with the helper, accumulating all pages
        into the same state array used today.
  - [ ] **AI approver top-scores chunking:** after accumulation completes, the
        `POST /analysis/ai-approver/top-scores` request (~line 313) must send article ids in
        **chunks** (e.g. 500 ids per request), merging all chunk responses into one map,
        instead of one giant id list — that request scales with the full result set.
  - [ ] Keep the final `setArticlesArray` and merge logic unchanged so the loading state,
        auto-select-first-article behavior, and table UX behave exactly as today.
- [ ] Update `portal/src/app/(dashboard)/reports/weekly-cpsc/page.tsx` (~line 73): loop
      `GET /articles/approved` pages via the helper, with `cursor`/`pageSize` passed as
      query parameters; accumulate into the existing state.
- [ ] Update `portal/src/app/(dashboard)/articles/add-delete/page.tsx` (`fetchArticlesArray`,
      ~line 85): loop `POST /articles` pages via the helper; accumulate into the existing
      state. The post-mutation refetches (~lines 124, 218) go through the same path.
- [ ] Do **not** modify `portal/src/components/tables/TableReviewArticles.tsx` or any other
      table component — client-side pagination/sort/search stays as is.

### Phase 5 verification

- [ ] `cd portal && npm run lint` — fix all findings (no `any`).
- [ ] `cd portal && npm run build` (build db-models and api first if their `dist/` outputs
      are missing: `cd db-models && npm run build`, then `cd api && npm run build`).
- [ ] Portal has no test framework (per `AGENTS.md`) — lint + build are the required gates.
- [ ] Check off completed Phase 5 tasks and commit Phase 5 changes.

---

## Phase 6 — Full-repo verification and wrap-up

- [ ] Full build in dependency order: `cd db-models && npm run build`, then
      `cd api && npm run build`, then `cd portal && npm run build`.
- [ ] `cd api && npm test` — entire suite green.
- [ ] `cd portal && npm run lint` — clean.
- [ ] Confirm no request shape against any of the three endpoints can return the full
      dataset: a request with no pagination parameters returns the first page at the default
      size (spot-check via the endpoint tests).
- [ ] Confirm no unrelated files were modified (`git status` / `git diff --stat`).
- [ ] Note for the operator in the final summary (do **not** act on these): api and portal
      must be **deployed together** (an un-updated portal would receive only page one), and
      the systemd `Restart=on-failure`, memory telemetry, and `trust proxy` items remain
      open outside this repo change. Manual verification against a production-sized dataset
      (review page loads the complete set; per-request responses in single-digit MB) is an
      operator step post-deploy.
- [ ] Check off remaining tasks and commit any final changes. **Do not push** — the operator
      handles pushes and deployment.
