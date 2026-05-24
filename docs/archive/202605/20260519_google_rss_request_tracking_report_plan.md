---
created_at: 2026-05-19
updated_at: 2026-05-19
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Plan: Google RSS Query Tracking Sheet in Weekly Orchestrator Report

Status: DRAFT — for AI reviewer assessment
Author target: feature plan for `worker-node`
Related files:

- [worker-node/src/modules/jobs/requestGoogleRssJob.ts](../worker-node/src/modules/jobs/requestGoogleRssJob.ts)
- [worker-node/src/modules/orchestrator/reportWriter.ts](../worker-node/src/modules/orchestrator/reportWriter.ts)
- [worker-node/src/modules/orchestrator/coordinator.ts](../worker-node/src/modules/orchestrator/coordinator.ts)
- [worker-node/src/modules/orchestrator/types.ts](../worker-node/src/modules/orchestrator/types.ts)

## Context

Today the Weekly Orchestrator produces an xlsx report with two sheets — **Jobs** and **Articles**. The report tracks step-level outcomes and per-article downstream attributes, but it does NOT show what happened at the level of each **Google RSS query row** read from the query input spreadsheet (`PATH_AND_FILENAME_FOR_QUERY_SPREADSHEET_AUTOMATED`).

When triaging weekly runs we want to be able to open the orchestrator report and immediately see, for every row in the query spreadsheet:

- Did we hit Google RSS for that query this run, or did we skip it?
- If we hit it, did it succeed or fail?
- How many new articles were saved to the database because of that specific query row?

The goal of this change is to add a new sheet to the existing orchestrator report — **"Google RSS Queries"** — that mirrors the query input spreadsheet column-for-column and appends three columns:

- `status` — strictly one of `success | skipped | failed`
- `saved_articles` — integer count of new `Articles` rows persisted for that query
- `note` — short reason qualifying the status (e.g. `not_reached`, `rate_limited`, `repeat_window`); blank on a clean success

> Note: the original request was for two appended columns (`status` and `saved_articles`). We are intentionally adding a third (`note`) so that `status` stays a clean three-value enum that's easy to filter, while the underlying reason (especially `not_reached` vs `repeat_window`, or `rate_limited` vs `rss_fetch_error`) is preserved in its own cell for triage.

The change must be additive, must not alter queue behavior, endpoint contracts, or the order of orchestrator steps, and must not require a database migration.

## Why this approach (option chosen)

There are three plausible ways to build the data the new sheet needs:

1. **Re-derive from DB at report time.** Re-read the query spreadsheet inside `reportWriter`, rebuild the RSS URL for each row using the same `buildQuery` + `buildRssUrl` logic, then look up `NewsApiRequest` rows by `url`. This duplicates business logic across modules and is fragile if `buildRssUrl`'s env defaults (`GOOGLE_RSS_HL`, `GOOGLE_RSS_GL`, `GOOGLE_RSS_CEID`) change.
2. **Schema change.** Add a `querySpreadsheetRowId` column to `NewsApiRequest` so requests are linked back to the spreadsheet row. Cleanest data model, but requires a db-models change, association/migration considerations, and downstream coordination.
3. **Let the job emit per-query results in-band.** `requestGoogleRssJob` already iterates every spreadsheet row — it can accumulate a per-row result array and return it on `GoogleRssJobResult`. The orchestrator already persists `stepResult` into the `OrchestratorRunSteps.result` JSON column; `reportWriter` already reads that column for `google_rss` (`step.result?.endingMessage`).

**We pick option 3.** It keeps the source of truth inside the workflow that has all the facts already, avoids cross-module logic duplication, requires no schema migration, and the persistence path it depends on (`updateResult` → JSON column) is already exercised every run.

Estimated payload size: a typical query spreadsheet has dozens to a few hundred rows; expected JSON blob is well under 200 KB. Acceptable for a JSONB column.

## High-level design

### 1. Track per-query outcomes inside `requestGoogleRssJob.runLegacyWorkflow`

Add a typed per-query result record and accumulate one entry per spreadsheet row, then surface the array on `GoogleRssJobResult`.

```ts
// New types added to requestGoogleRssJob.ts
export type GoogleRssQueryStatus = "success" | "skipped" | "failed";

export interface GoogleRssQueryResult {
	id: number; // spreadsheet row id
	and_keywords: string;
	and_exact_phrases: string;
	or_keywords: string;
	or_exact_phrases: string;
	time_range: string;
	status: GoogleRssQueryStatus;
	saved_articles: number; // 0 when skipped/failed
	note: string | null; // short reason, see mapping below
}

export interface GoogleRssJobResult {
	endingReason: GoogleRssEndingReason;
	endingMessage: string;
	articlesAddedCount: number;
	queryResults: GoogleRssQueryResult[]; // NEW (additive)
}
```

### 2. Status mapping (single source of truth)

Place inside the per-row loop in `runLegacyWorkflow`:

| Situation in current code (file:line approx)                                                                                                                  | `status`  | `saved_articles` | `note`                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------- | -------------------------------------------- |
| `buildQuery` returns empty `query` ([requestGoogleRssJob.ts:669-672](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L669))                            | `skipped` | 0                | `empty_query`                                |
| `wasRequestMadeRecently` returns true ([requestGoogleRssJob.ts:679-684](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L679))                         | `skipped` | 0                | `repeat_window`                              |
| `fetchRssItems` returns `status: 'error'` ([requestGoogleRssJob.ts:691,706-716](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L691))                 | `failed`  | 0                | `rss_fetch_error: <msg>`                     |
| HTTP 503 — breaks loop early ([requestGoogleRssJob.ts:699-704](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L699))                                  | `failed`  | 0                | `rate_limited`                               |
| Success path — `storeRequestAndArticles` returns `savedCount` ([requestGoogleRssJob.ts:706-717](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L706)) | `success` | `savedCount`     | null (or `time_range_invalid` if applicable) |
| `signal.aborted` mid-loop                                                                                                                                     | `skipped` | 0                | `canceled`                                   |
| Target articles collected — early break ([requestGoogleRssJob.ts:719-727](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L719))                       | `skipped` | 0                | `target_reached`                             |
| Exception caught at outer `try/catch` ([requestGoogleRssJob.ts:737-740](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L737))                         | `failed`  | 0                | `error: <msg>`                               |
| Spreadsheet rows iteration never reached this row (loop broke earlier)                                                                                        | `skipped` | 0                | `not_reached`                                |

To make the "not_reached" tail simple, the implementation should:

1. Read the spreadsheet once at the start and keep the full `rows` array.
2. Initialize a `Map<id, GoogleRssQueryResult>` seeded with `{ status: 'skipped', saved_articles: 0, note: 'not_reached' }` for every row up front.
3. Overwrite each map entry as the loop processes that row.
4. At the end, push `Array.from(map.values())` (preserving spreadsheet order) onto the result.

This guarantees the output sheet is row-complete and mirrors the input spreadsheet exactly.

### 3. Surface results to the orchestrator

The orchestrator already calls `context.updateResult(result)` inside the workflow's `finally` block ([requestGoogleRssJob.ts:744-746](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L744)). After step completion, the coordinator merges that into the `OrchestratorRunSteps.result` JSON column ([coordinator.ts:394-405](../worker-node/src/modules/orchestrator/coordinator.ts#L394)). No coordinator changes are required.

### 4. Add the "Google RSS Queries" sheet in `reportWriter.ts`

Insert sheet creation after the Jobs sheet and before the Articles sheet so logical ordering is **Jobs → Google RSS Queries → Articles**.

```ts
// reportWriter.ts — additive
const googleRssStep = steps.find((s) => s.stepName === "google_rss");
const rawQueryResults = googleRssStep?.result?.queryResults;
if (Array.isArray(rawQueryResults) && rawQueryResults.length > 0) {
	const sheet = workbook.addWorksheet("Google RSS Queries");
	sheet.columns = [
		{ header: "id", key: "id", width: 8 },
		{ header: "and_keywords", key: "and_keywords", width: 30 },
		{ header: "and_exact_phrases", key: "and_exact_phrases", width: 30 },
		{ header: "or_keywords", key: "or_keywords", width: 30 },
		{ header: "or_exact_phrases", key: "or_exact_phrases", width: 30 },
		{ header: "time_range", key: "time_range", width: 12 },
		{ header: "status", key: "status", width: 12 },
		{ header: "saved_articles", key: "saved_articles", width: 16 },
		{ header: "note", key: "note", width: 30 },
	];
	for (const row of rawQueryResults as GoogleRssQueryResult[]) {
		sheet.addRow(row);
	}
}
```

Guard with a defensive shape check (treat unexpected shape as "skip the sheet, log warn, don't throw") so older runs whose JSON predates this change still produce a valid report.

### 5. No coordinator / queue / API surface changes

- No changes to step ordering, endpoint names, or queue contracts.
- No changes to `OrchestratorConfig` or step defaults.
- `GoogleRssJobResult.queryResults` is purely additive — existing consumers that read `endingReason`, `endingMessage`, or `articlesAddedCount` are unaffected.

## Files to be modified

1. `worker-node/src/modules/jobs/requestGoogleRssJob.ts`
   - Add `GoogleRssQueryStatus`, `GoogleRssQueryResult` types.
   - Extend `GoogleRssJobResult` with `queryResults: GoogleRssQueryResult[]`.
   - Initialize a per-row result map at the top of `runLegacyWorkflow` after `readQuerySpreadsheet`.
   - In each branch of the loop (empty query, repeat window, fetch error, 503, success, abort, target reached) set the corresponding map entry.
   - In the outer `catch`, mark all rows that are still in their initial `not_reached` state as `failed` with `note: 'error: <msg>'` only if it's clear the loop never got to them due to the error — otherwise leave their last-known state.
   - In `finally`, push `Array.from(map.values())` onto the result before `updateResult`.

2. `worker-node/src/modules/orchestrator/reportWriter.ts`
   - Read `steps.find(s => s.stepName === 'google_rss')?.result?.queryResults`.
   - Defensively validate the shape (Array, non-empty, every entry has `id` + `status`).
   - Add `Google RSS Queries` worksheet between `Jobs` and `Articles`.

3. `worker-node/tests/modules/jobs/requestGoogleRssJob.test.ts` (existing tests)
   - Update any assertions that snapshot `GoogleRssJobResult` shape.
   - Add cases for each status branch: empty query, repeat window, fetch error, 503, success-with-saves, success-with-zero-saves, not_reached tail.

4. `worker-node/tests/modules/orchestrator/reportWriter.test.ts` (if exists; otherwise add)
   - Add a case that supplies a `google_rss` step with `result.queryResults` and asserts a third worksheet exists with the expected headers and row count.
   - Add a case where `queryResults` is missing/malformed — assert no crash and no extra sheet.

5. `worker-node/AGENTS.md`
   - One-paragraph note under `request-google-rss` documenting the new tracking output.

No changes required in: `db-models`, `api`, `portal`, `worker-python`, `db-manager`, `scripts/`.

## Reused existing utilities

- `readQuerySpreadsheet` ([requestGoogleRssJob.ts:258](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L258)) — already returns `QueryRow[]`; reuse its output as the seed for the result map. **Do not** read the spreadsheet twice.
- `storeRequestAndArticles` ([requestGoogleRssJob.ts:506](../worker-node/src/modules/jobs/requestGoogleRssJob.ts#L506)) — already returns `savedCount`. Use its return value directly to populate `saved_articles`.
- `workbook.addWorksheet` / `sheet.columns` / `sheet.addRow` pattern from `reportWriter.ts` — mirror the Jobs sheet style.
- ExcelJS is already a `worker-node` dependency.

## Risk assessment / safety

| Risk                                                       | Mitigation                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Older runs lack `queryResults` in their stored step result | Defensive guard in `reportWriter` — skip the sheet silently, log warn.                                 |
| Type drift between job and report writer                   | Keep `GoogleRssQueryResult` exported from `requestGoogleRssJob` and import it in `reportWriter`.       |
| JSON-column bloat                                          | Per-row payload is small; typical spreadsheets are < 500 rows. Document size expectation in AGENTS.md. |
| Test breakage in existing job tests                        | Update snapshot/assertions; add new dedicated cases per branch.                                        |
| Confusion between "success with 0 saved" and "skipped"     | Status mapping table above is the source of truth. `success` requires a successful HTTP fetch.         |
| Aborted runs leave the result partially populated          | The `not_reached` seed handles this — unreached rows stay `skipped/not_reached`.                       |

No changes to queue behavior, no schema changes, no migration, no endpoint changes. The feature is fully additive and isolated to `worker-node`.

## Verification

End-to-end:

1. `cd worker-node && npx tsc -p tsconfig.json --noEmit` — type check passes.
2. `cd worker-node && npm test` — all existing tests pass; new tests cover each status branch.
3. Trigger an abbreviated_test orchestrator run via the existing endpoint and confirm the produced xlsx contains a "Google RSS Queries" sheet with one row per spreadsheet query.
4. Open the xlsx in Numbers/Excel and confirm column order, status values, and `saved_articles` totals line up with the Articles sheet count for that run.
5. Manually simulate a 503 (e.g., point at an unreachable host via env override in a test env) and confirm rows after the failing one are recorded as `skipped` with `note: not_reached`.

## Open questions for the reviewer

1. Should the new sheet sit before or after the Articles sheet? (Plan currently places it between.)
2. Is `note` (free-text short reason) acceptable, or should we restrict to a fixed enum?
3. Should `success` with `saved_articles = 0` be classified differently (e.g., a separate `success_no_new` status)?
4. Acceptable to store the per-row results inside `OrchestratorRunSteps.result` JSON, or should this go to a dedicated table?
