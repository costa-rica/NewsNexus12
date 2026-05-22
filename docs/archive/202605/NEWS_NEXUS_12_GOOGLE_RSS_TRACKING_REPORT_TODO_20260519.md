---
created_at: 2026-05-19
updated_at: 2026-05-19
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# News Nexus 12 Google RSS Tracking Report TODO

Implementation checklist for the new "Google RSS Queries" sheet in the Weekly Orchestrator report.

Source plan: [20260519_google_rss_request_tracking_report_plan_V03.md](20260519_google_rss_request_tracking_report_plan_V03.md). Read it first — this TODO is the execution checklist, not the design.

## Goal

Add a third sheet to the orchestrator xlsx that mirrors `AutomatedRequestsGoogleNewsRss04.xlsx` row-for-row and appends `status`, `saved_articles`, and `note`. Implementation is isolated to `worker-node`; no schema change, no queue/endpoint changes.

## Per-phase workflow

Per [TODO_LIST_GUIDANCE.md](TODO_LIST_GUIDANCE.md), after each phase:

1. `cd worker-node && npx tsc -p tsconfig.json --noEmit` — must pass.
2. `cd worker-node && npm test` — must pass.
3. Check off completed tasks in this file.
4. Commit. Title format: `feat: <phase title>` (e.g. `feat: google rss query tracking types and scaffold`). Body references this file and the phase number.

Do not start a later phase before the earlier phase is committed.

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
- [ ] Add one new test: when the spreadsheet has N rows and the job runs to completion (mock RSS returns empty items for every row), assert the returned `queryResults` has N entries, all with `status: 'skipped'`, `saved_articles: 0`, `note: 'not_reached'`, and original spreadsheet field values preserved.

### 1.5 Phase exit

- [ ] `npx tsc -p tsconfig.json --noEmit` passes.
- [ ] `npm test` passes (existing tests + the new Phase 1 test).
- [ ] Commit.

---

## Phase 2 — Per-row branch updates (core behavior)

Wires each branch in `runLegacyWorkflow` to update `queryResults[i]` per the V03 status mapping table.

### 2.1 Branches that WRITE to `queryResults[i]`

For each, update the existing code in `requestGoogleRssJob.ts` per V03 §3:

- [ ] Pre-fetch abort check (line ~662): write `queryResults[i] = { ..., status: 'skipped', note: 'canceled' }` then `break`.
- [ ] Empty query (line ~669): write `queryResults[i] = { ..., status: 'skipped', note: 'empty_query' }` then `continue`.
- [ ] Repeat window (line ~679): write `queryResults[i] = { ..., status: 'skipped', note: 'repeat_window' }` then `continue`.
- [ ] Post-fetch abort check (line ~693): write `queryResults[i] = { ..., status: 'skipped', note: 'canceled' }` then `break`.
- [ ] HTTP 503 (line ~699): write `queryResults[i] = { ..., status: 'failed', note: 'rate_limited' }` then `break`.
- [ ] Non-503 RSS error (lines ~691, ~706-716): **keep the call to `storeRequestAndArticles(..., status: response.status, items: response.items)` exactly as it is today** — this preserves the existing `NewsApiRequest` history row that `wasRequestMadeRecently` relies on. Then write `queryResults[i] = { ..., status: 'failed', note: `rss_fetch_error: ${response.error}` }` and `continue`.
- [ ] Success (lines ~706-717): write `queryResults[i] = { ..., status: 'success', saved_articles: savedThisRequest, note: queryResult.timeRangeInvalid ? 'time_range_invalid' : null }`.

### 2.2 Branches that DO NOT write to `queryResults[i]`

These fire after the row already has its real outcome. They are run-ending reasons, not per-row outcomes.

- [ ] Target articles collected (line ~719): **do NOT modify `queryResults[i]`**; just `break`. The current row already has its `success / savedCount` written from §2.1.
- [ ] Post-delay abort check (line ~731): **do NOT modify `queryResults[i]`**; just `break`. The current row already has its real outcome written.

### 2.3 Outer exception handler

- [ ] In the `catch` block, if `currentRowIndex >= 0 && currentRowIndex < queryResults.length`, write `queryResults[currentRowIndex] = { ..., status: 'failed', saved_articles: 0, note: \`error: ${endingMessage}\` }`. Rows after `currentRowIndex` keep their seeded `not_reached` value.

### 2.4 Tests

Add to `worker-node/tests/modules/jobs/requestGoogleRssJob.test.ts` (create the file or extend the existing one — match what's already there):

- [ ] **Empty query row** — `queryResults[i].status === 'skipped'`, `note === 'empty_query'`.
- [ ] **Repeat window** — mock `wasRequestMadeRecently` true → `skipped / repeat_window`. `storeRequestAndArticles` NOT called for that row (spy).
- [ ] **Success with saves** — mock RSS returns 3 items, `storeRequestAndArticles` returns 3 → `success / 3 / null`.
- [ ] **Success with zero saves** — RSS returns items but all are duplicates → `success / 0 / null` (status is still success because the fetch succeeded).
- [ ] **Non-503 RSS error** — mock fetch returns `{ status: 'error', error: 'boom', statusCode: 500 }`. Assert: (a) `storeRequestAndArticles` IS called (spy) with `status: 'error'` and `items: []`; (b) `queryResults[i] = failed / 0 / rss_fetch_error: boom`; (c) loop continues to next row.
- [ ] **HTTP 503** — mock fetch returns `statusCode: 503`. Assert: `queryResults[i] = failed / rate_limited`; loop breaks; rows after stay `skipped / not_reached`.
- [ ] **Target reached on success** — set `targetArticlesAddedCount` so it's met by the success of row N. Assert: row N stays `success / savedCount` (NOT overwritten); rows N+1.. stay `skipped / not_reached`; `endingReason === 'target_articles_collected'`.
- [ ] **Post-delay cancel after success** — abort the signal after a successful row's store, before the next iteration. Assert: the successful row stays `success`; rows after stay `skipped / not_reached`.
- [ ] **Pre-fetch cancel** — abort the signal at the very top of an iteration. Assert: that row is `skipped / canceled`; rows after stay `skipped / not_reached`.
- [ ] **Mid-row exception** — make `storeRequestAndArticles` throw on row N. Assert: row N is `failed / error: <msg>`; rows after stay `skipped / not_reached`; rows before keep their real outcomes.
- [ ] **Duplicate `id`** — spreadsheet has two rows with the same `id`. Assert: both appear in `queryResults` (length matches input row count, not unique id count).
- [ ] **Not_reached tail** — when 503 fires on row N, rows N+1..end are `skipped / not_reached`.

### 2.5 Phase exit

- [ ] `npx tsc -p tsconfig.json --noEmit` passes.
- [ ] `npm test` passes (all old tests + all new Phase 2 tests).
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
  - [ ] Use the column definitions in V03 §6 (id, and_keywords, and_exact_phrases, or_keywords, or_exact_phrases, time_range, status, saved_articles, note).
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

- [ ] Under the `### request-google-rss` section in `worker-node/AGENTS.md`, add one paragraph noting that the job now emits `queryResults` on `GoogleRssJobResult`, and that the orchestrator report renders this as the "Google RSS Queries" sheet. Reference the V03 plan.

### 4.2 Phase exit

- [ ] Commit.

---

## Done criteria

- [ ] All four phases checked off and committed.
- [ ] A real abbreviated_test orchestrator run produces an xlsx with three sheets in order: Jobs, Google RSS Queries, Articles.
- [ ] The new sheet has one row per input spreadsheet row, with correct status / saved_articles / note for every row including unreached/failed/canceled tails.
- [ ] No regressions in queue behavior, no schema changes, no endpoint changes.

## Out of scope (do NOT do as part of this TODO)

- Passing through extra unknown columns from the input spreadsheet (rejected from V01 review).
- Validating uniqueness of `id` in the input spreadsheet (rejected from V02 review — array indexing already handles duplicates).
- Adding a dedicated DB table for per-query results (open question #4 in V03 — leave for a future decision).
- Splitting `success` into `success` vs `success_no_new` (open question #3 in V03).
- Constraining `note` to a fixed enum (open question #2 in V03).
- Re-ordering Jobs / Articles sheets relative to the new sheet (open question #1 in V03 — plan places new sheet between).
