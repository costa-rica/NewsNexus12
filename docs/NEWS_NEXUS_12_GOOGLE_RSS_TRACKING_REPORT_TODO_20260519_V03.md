# News Nexus 12 Google RSS Tracking Report TODO — V03

Implementation checklist for the new "Google RSS Queries" sheet in the Weekly Orchestrator report.

Source plan: [20260519_google_rss_request_tracking_report_plan_V03.md](20260519_google_rss_request_tracking_report_plan_V03.md). Read it first — this TODO is the execution checklist, not the design.

Supersedes: [NEWS_NEXUS_12_GOOGLE_RSS_TRACKING_REPORT_TODO_20260519_V02.md](NEWS_NEXUS_12_GOOGLE_RSS_TRACKING_REPORT_TODO_20260519_V02.md)

## Changes from V02

V02 was reviewed by Codex ([assessment](NEWS_NEXUS_12_GOOGLE_RSS_TRACKING_REPORT_TODO_20260519_V02_assessment_codex.md)). One concern, accepted:

- **The `empty_query` branch is dead code in the current `buildQuery`** — `when:<timeRange>` is unconditionally appended, so `queryResult.query` is never empty regardless of input. V03 of this TODO adds a small, deliberate behavior change to `buildQuery`: when there are no AND/OR terms, return `query: ''` so the existing guard at [requestGoogleRssJob.ts:669](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L669) actually fires and the row is recorded as `skipped / empty_query`. This prevents misconfigured blank-keyword rows from silently hitting Google RSS with only `when:180d`, which would return arbitrary unrelated articles.

The source plan V03 already assumes this branch is reachable, so no plan revision is strictly required — but a brief note belongs in `worker-node/AGENTS.md` (handled in Phase 4) flagging the new `buildQuery` behavior.

Everything else from V02 carries forward unchanged.

## Goal

Add a third sheet to the orchestrator xlsx that mirrors `AutomatedRequestsGoogleNewsRss04.xlsx` row-for-row and appends `status`, `saved_articles`, and `note`. Implementation is isolated to `worker-node`; no schema change, no queue/endpoint changes. **V03 also includes one small `buildQuery` behavior change so the `empty_query` outcome maps to real runtime behavior.**

## Per-phase workflow

Per [TODO_LIST_GUIDANCE.md](TODO_LIST_GUIDANCE.md), after each phase:

1. `cd worker-node && npx tsc -p tsconfig.json --noEmit` — must pass.
2. `cd worker-node && npm test` — must pass.
3. Check off completed tasks in this file.
4. Commit. Title format: `feat: <phase title>` (e.g. `feat: google rss query tracking types and scaffold`). Body references this file and the phase number.

Do not start a later phase before the earlier phase is committed.

## Phase 2 testing strategy (READ BEFORE STARTING PHASE 2)

V02 binds Phase 2 to **public-boundary testing only**. Concretely:

- **Mocking layer:** mock `global.fetch` for RSS HTTP responses. Do NOT spy on or stub `fetchRssItems`, `wasRequestMadeRecently`, or `storeRequestAndArticles` — they are file-private and must stay that way.
- **`global.fetch` mock return shape:** a `Response`-like object. The fields `fetchRssItems` reads are `response.ok`, `response.status`, and `response.text()`. Example for a successful RSS feed:
  ```ts
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '<rss><channel><item>...</item></channel></rss>',
  } as unknown as Response);
  ```
  Example for a 500 error:
  ```ts
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: async () => 'server error',
  } as unknown as Response);
  ```
  Example for a 503:
  ```ts
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 503,
    text: async () => 'unavailable',
  } as unknown as Response);
  ```
- **DB-state assertions instead of call spies.** "`storeRequestAndArticles` was called with status=error" becomes "a `NewsApiRequest` row exists with `status='error'`". "`storeRequestAndArticles` was NOT called" becomes "no new `NewsApiRequest` row exists for that URL." This is strictly stronger — it tests observable persistence rather than implementation calls.
- **Mid-row exception test:** instead of forcing `storeRequestAndArticles` to throw, mock `Article.create` to throw on the Nth call (use `jest.spyOn(Article, 'create')` — `Article` is a public export from `@newsnexus/db-models`). The throw propagates through `storeRequestAndArticles` up to the outer `try/catch` — same control-flow path the V03 plan describes.
- **Repeat-window test:** seed a `NewsApiRequest` row for the URL inside the doNotRepeatRequestsWithinHours window before invoking the job. `wasRequestMadeRecently` will detect it through normal Sequelize reads — no mocking of the helper needed.
- **Cancellation tests:** use an `AbortController` and trigger `controller.abort()` at the desired point. To exercise the post-delay abort, set `MILISECONDS_IN_BETWEEN_REQUESTS=500` (or similar) and abort after a successful row's persistence completes but before the next iteration begins.

If during implementation the agent finds a branch that genuinely cannot be exercised through these public boundaries, STOP and surface the issue — do not add an export or DI seam without explicit approval.

---

## Phase 1 — Types and accumulator scaffold

Adds the new types and the `queryResults` array, but leaves every row at the seed value (`skipped / not_reached`). No semantic behavior change from the user's perspective yet. This phase exists so the type and result-shape changes can be committed and verified in isolation.

### 1.1 Types

- [ ] In `worker-node/src/modules/jobs/requestGoogleRssJob.ts`, add:
  - [ ] `export type GoogleRssQueryStatus = 'success' | 'skipped' | 'failed';`
  - [ ] `export interface GoogleRssQueryResult { id, and_keywords, and_exact_phrases, or_keywords, or_exact_phrases, time_range, status, saved_articles, note }` per V03 §1.
  - [ ] Extend `GoogleRssJobResult` with `queryResults: GoogleRssQueryResult[]`.

### 1.2 Accumulator

- [ ] After `readQuerySpreadsheet(...)` in `runLegacyWorkflow`, build `queryResults: GoogleRssQueryResult[]` by `rows.map(...)` with seed values `status: 'skipped'`, `saved_articles: 0`, `note: 'not_reached'`.
- [ ] Declare `let currentRowIndex = -1;` immediately before the per-row loop.
- [ ] Convert the existing `for (const row of rows)` to a numeric `for (let i = 0; i < rows.length; i += 1)` loop. Assign `currentRowIndex = i;` and `const row = rows[i];` at the top of each iteration. Do NOT yet wire any branch to update `queryResults[i]` — leave that for Phase 2.

### 1.3 Surface on result

- [ ] In the `finally` block, include `queryResults` on the `GoogleRssJobResult` object passed to `context.updateResult(...)`.

### 1.4 Tests

- [ ] Update any existing test that snapshots the `GoogleRssJobResult` shape to include `queryResults`.
- [ ] Add one new test: when the spreadsheet has N rows and the job runs to completion (mock `global.fetch` with a valid empty-channel RSS payload for every row), assert the returned `queryResults` has N entries, all with `status: 'skipped'`, `saved_articles: 0`, `note: 'not_reached'`, and original spreadsheet field values preserved.

### 1.5 Phase exit

- [ ] `npx tsc -p tsconfig.json --noEmit` passes.
- [ ] `npm test` passes (existing tests + the new Phase 1 test).
- [ ] Commit.

---

## Phase 2 — Per-row branch updates (core behavior)

Wires each branch in `runLegacyWorkflow` to update `queryResults[i]` per the V03 status mapping table.

**Reminder:** read the "Phase 2 testing strategy" section above before writing tests.

### 2.1 buildQuery: make the empty-query guard reachable (V03 NEW)

The current `buildQuery` always appends `when:<timeRange>`, so its return value is never empty. Update it so the empty-query branch in the loop is actually reachable:

- [ ] In `requestGoogleRssJob.ts`, modify `buildQuery` so the `when:<timeRange>` append happens **only when at least one of `andTerms` or `orTerms` is non-empty**:
  ```ts
  // before queryParts.push(`when:${timeRange}`):
  if (andTerms.length === 0 && orTerms.length === 0) {
    return {
      query: '',
      andString: combineForDb(row.and_keywords, row.and_exact_phrases),
      orString: combineForDb(row.or_keywords, row.or_exact_phrases),
      timeRange,
      timeRangeInvalid,
    };
  }
  queryParts.push(`when:${timeRange}`);
  ```
- [ ] Verify with a unit test that `buildQuery({ and_keywords: '', and_exact_phrases: '', or_keywords: '', or_exact_phrases: '', time_range: '180d', id: 1 })` returns `query: ''`.
- [ ] Verify with a unit test that `buildQuery` with at least one keyword still produces a non-empty query ending in `when:<timeRange>` (regression guard).

This is a deliberate behavior change: a row with no AND/OR terms used to hit Google RSS with just `when:180d` (returning arbitrary recent news). After this change, such rows are skipped and recorded as `empty_query`.

### 2.2 Branches that WRITE to `queryResults[i]`

For each, update the existing code in `requestGoogleRssJob.ts` per V03 plan §3:

- [ ] Pre-fetch abort check (line ~662): write `queryResults[i] = { ..., status: 'skipped', note: 'canceled' }` then `break`.
- [ ] Empty query (line ~669) — **now reachable thanks to §2.1**: write `queryResults[i] = { ..., status: 'skipped', note: 'empty_query' }` then `continue`.
- [ ] Repeat window (line ~679): write `queryResults[i] = { ..., status: 'skipped', note: 'repeat_window' }` then `continue`.
- [ ] Post-fetch abort check (line ~693): write `queryResults[i] = { ..., status: 'skipped', note: 'canceled' }` then `break`.
- [ ] HTTP 503 (line ~699): write `queryResults[i] = { ..., status: 'failed', note: 'rate_limited' }` then `break`.
- [ ] Non-503 RSS error (lines ~691, ~706-716): **keep the call to `storeRequestAndArticles(..., status: response.status, items: response.items)` exactly as it is today** — this preserves the existing `NewsApiRequest` history row that `wasRequestMadeRecently` relies on. Then write `queryResults[i] = { ..., status: 'failed', note: \`rss_fetch_error: ${response.error}\` }` and `continue`.
- [ ] Success (lines ~706-717): write `queryResults[i] = { ..., status: 'success', saved_articles: savedThisRequest, note: queryResult.timeRangeInvalid ? 'time_range_invalid' : null }`.

### 2.3 Branches that DO NOT write to `queryResults[i]`

These fire after the row already has its real outcome. They are run-ending reasons, not per-row outcomes.

- [ ] Target articles collected (line ~719): **do NOT modify `queryResults[i]`**; just `break`. The current row already has its `success / savedCount` written from §2.2.
- [ ] Post-delay abort check (line ~731): **do NOT modify `queryResults[i]`**; just `break`. The current row already has its real outcome written.

### 2.4 Outer exception handler

- [ ] In the `catch` block, if `currentRowIndex >= 0 && currentRowIndex < queryResults.length`, write `queryResults[currentRowIndex] = { ..., status: 'failed', saved_articles: 0, note: \`error: ${endingMessage}\` }`. Rows after `currentRowIndex` keep their seeded `not_reached` value.

### 2.5 Tests — public-boundary only

Add to `worker-node/tests/modules/jobs/requestGoogleRssJob.test.ts` (create the file or extend the existing one — match what's already there). Every test below uses `global.fetch` mocking + DB-state assertions — see "Phase 2 testing strategy" above for the mock shape and approach.

- [ ] **Empty query row (V03 corrected)** — spreadsheet has one row with all keyword/phrase columns blank. Assert: (a) `global.fetch` was NOT called for that row (the row is short-circuited before HTTP); (b) `queryResults[i] = skipped / 0 / empty_query`; (c) no `NewsApiRequest` row was created for that row; (d) the loop continued to the next row.
- [ ] **Repeat window** — pre-seed a `NewsApiRequest` row with the URL the row would generate, `createdAt` within `doNotRepeatRequestsWithinHours`. Assert `queryResults[i] = skipped / repeat_window`. Assert the existing `NewsApiRequest` row count for that URL did not increase (no new request was made).
- [ ] **Success with saves** — `global.fetch` mock returns a 3-item RSS payload (well-formed XML with three `<item>`s, none of which exist in `Article` yet). Assert `queryResults[i] = success / 3 / null` and that 3 new `Article` rows + 1 new `NewsApiRequest` row exist.
- [ ] **Success with zero saves** — `global.fetch` mock returns 3 items whose URLs already exist in `Article` (pre-seeded). Assert `queryResults[i] = success / 0 / null` (status is still success because the fetch succeeded); 1 new `NewsApiRequest` row; no new `Article` rows.
- [ ] **Non-503 RSS error** — `global.fetch` mock returns `{ ok: false, status: 500, text: async () => 'server error' }`. Assert: (a) a `NewsApiRequest` row was created with `status: 'error'` and `countOfArticlesSavedToDbFromRequest: 0` (this proves `storeRequestAndArticles` still ran); (b) `queryResults[i] = failed / 0 / rss_fetch_error: <msg>`; (c) the loop continued to the next row (next row's outcome is also recorded).
- [ ] **HTTP 503** — `global.fetch` mock returns `{ ok: false, status: 503, text: async () => 'unavailable' }`. Assert: `queryResults[i] = failed / rate_limited`; loop broke; rows after stay `skipped / not_reached`; `endingReason === 'rate_limited'`. Assert no `NewsApiRequest` row was created for this row (the 503 branch breaks before `storeRequestAndArticles`).
- [ ] **Target reached on success** — `targetArticlesAddedCount` set so it's met by the success of row N (e.g. target=3, row N returns 3 items, all new). Assert: row N stays `success / 3` (NOT overwritten to `skipped/target_reached`); rows N+1.. stay `skipped / not_reached`; `endingReason === 'target_articles_collected'`.
- [ ] **Post-delay cancel after success** — set `MILISECONDS_IN_BETWEEN_REQUESTS=500`. Successfully process row 0 (returns 1 new item). Inside a `setTimeout(() => controller.abort(), 100)` between iterations, abort. Assert: row 0 stays `success / 1` (NOT overwritten to `skipped/canceled`); rows 1.. stay `skipped / not_reached`.
- [ ] **Pre-fetch cancel** — `controller.abort()` before the first iteration even runs. Assert: row 0 is `skipped / canceled`; rows after stay `skipped / not_reached`. No `NewsApiRequest` rows created.
- [ ] **Mid-row exception** — `jest.spyOn(Article, 'create').mockImplementationOnce(...)` to throw on the first call inside row N's processing. `global.fetch` mock returns a valid 1-item payload first. Assert: row N is `failed / 0 / error: <msg>`; rows after stay `skipped / not_reached`; rows before keep their real outcomes; `endingReason === 'error'`.
- [ ] **Duplicate `id`** — spreadsheet has two rows with the same `id` value but different keyword sets. Assert: both appear in `queryResults` (length matches input row count, not unique id count); each gets its own per-row outcome.
- [ ] **Not_reached tail** — after the 503 test above, assert rows N+1..end are explicitly `skipped / not_reached` (covered as part of the 503 test if you assert each tail row; if not, add a dedicated assertion).

### 2.6 Phase exit

- [ ] `npx tsc -p tsconfig.json --noEmit` passes.
- [ ] `npm test` passes (all old tests + all new Phase 2 tests, including the new `buildQuery` unit tests).
- [ ] Manually inspect the final job result for a small fixture run: every input row has a `queryResults` entry; no row is silently lost.
- [ ] Commit.

---

## Phase 3 — Report sheet

Adds the new worksheet to the orchestrator xlsx.

### 3.1 Sheet creation

- [ ] In `worker-node/src/modules/orchestrator/reportWriter.ts`:
  - [ ] Locate the `google_rss` step via `steps.find(s => s.stepName === 'google_rss')`.
  - [ ] Read `googleRssStep?.result?.queryResults`.
  - [ ] Defensively validate the shape: `Array.isArray(...)`, length > 0, every entry is an object with `id` (number) and `status` (string). If invalid, `logger.warn(...)` and skip the sheet — do NOT throw.
  - [ ] If valid, call `workbook.addWorksheet('Google RSS Queries')` between the Jobs sheet creation and the Articles sheet creation so final sheet order is **Jobs → Google RSS Queries → Articles**.
  - [ ] Use the column definitions in V03 plan §6 (id, and_keywords, and_exact_phrases, or_keywords, or_exact_phrases, time_range, status, saved_articles, note).
  - [ ] `for (const row of rawQueryResults) sheet.addRow(row);`

### 3.2 Type sharing

- [ ] Import `GoogleRssQueryResult` from `requestGoogleRssJob.ts` in `reportWriter.ts` so the cast on `addRow` is type-checked rather than `any`.

### 3.3 Tests

In `worker-node/tests/modules/orchestrator/reportWriter.test.ts` (create or extend):

- [ ] **Sheet present** — supply a mock `google_rss` step with a non-empty `result.queryResults`. Assert the produced workbook contains a `Google RSS Queries` sheet, with the expected column headers in order, and one row per `queryResults` entry. Assert sheet order: Jobs → Google RSS Queries → Articles.
- [ ] **Missing queryResults** — supply a `google_rss` step with `result: {}` (no `queryResults`). Assert no `Google RSS Queries` sheet is created and no exception is thrown.
- [ ] **Malformed queryResults** — supply `result: { queryResults: 'not an array' }`. Assert no sheet, no throw, and a warn-level log was emitted.
- [ ] **No google_rss step at all** — supply a `steps` array without a `google_rss` step. Assert no sheet, no throw.

### 3.4 Phase exit

- [ ] `npx tsc -p tsconfig.json --noEmit` passes.
- [ ] `npm test` passes.
- [ ] Open a real generated xlsx (use the existing dev/test trigger or the abbreviated_test orchestrator run) and visually confirm the new sheet's column order, headers, and a few representative status values.
- [ ] Commit.

---

## Phase 4 — Documentation

### 4.1 worker-node AGENTS.md

- [ ] Under the `### request-google-rss` section in `worker-node/AGENTS.md`, add one paragraph noting:
  - The job now emits `queryResults` on `GoogleRssJobResult`, rendered as the "Google RSS Queries" sheet in the orchestrator report.
  - **V03:** `buildQuery` now treats rows with no AND/OR terms as empty queries — those rows are recorded as `skipped / empty_query` and do NOT hit Google RSS. Operators editing the query spreadsheet should treat blank-keyword rows as inert.
  - Reference the V03 plan.

### 4.2 Phase exit

- [ ] Commit.

---

## Done criteria

- [ ] All four phases checked off and committed.
- [ ] A real abbreviated_test orchestrator run produces an xlsx with three sheets in order: Jobs, Google RSS Queries, Articles.
- [ ] The new sheet has one row per input spreadsheet row, with correct status / saved_articles / note for every row including unreached/failed/canceled tails.
- [ ] Blank-keyword rows in the input spreadsheet are recorded as `skipped / empty_query` and do not generate Google RSS requests (V03 buildQuery change).
- [ ] No regressions in queue behavior, no schema changes, no endpoint changes.

## Out of scope (do NOT do as part of this TODO)

- Passing through extra unknown columns from the input spreadsheet (rejected from V01 plan review).
- Validating uniqueness of `id` in the input spreadsheet (rejected from V02 plan review — array indexing already handles duplicates).
- Adding a dedicated DB table for per-query results (open question #4 in V03 plan — leave for a future decision).
- Splitting `success` into `success` vs `success_no_new` (open question #3 in V03 plan).
- Constraining `note` to a fixed enum (open question #2 in V03 plan).
- Re-ordering Jobs / Articles sheets relative to the new sheet (open question #1 in V03 plan — plan places new sheet between).
- Adding new exports or a dependency-injection seam to `requestGoogleRssJob.ts` for the sake of testing. Use `global.fetch` mocks and DB-state assertions instead. If a branch genuinely can't be exercised that way, stop and ask.
- **V03:** Broader query-builder refactor beyond the single empty-terms guard in §2.1. Do NOT change how `when:<timeRange>` is formatted, how AND/OR are combined, or how `normalizeTimeRange` defaults work.
