---
title: Codex assessment: Google RSS request tracking report plan
date: 2026-05-19
reviewer: codex
source_document: docs/20260519_google_rss_request_tracking_report_plan.md
status: assessment
---

# Codex assessment: Google RSS request tracking report plan

1. Moderate flaw: the plan says the new sheet should mirror the query input spreadsheet column-for-column, but the proposed `GoogleRssQueryResult` only preserves the six currently required columns.

- Current `readQuerySpreadsheet` returns a normalized `QueryRow[]` with only `id`, `and_keywords`, `and_exact_phrases`, `or_keywords`, `or_exact_phrases`, and `time_range`.
- If the production query workbook contains any extra operational columns, notes, disabled flags, owner fields, or future additions, the report will not actually mirror the source spreadsheet.
- This weakens the main triage goal because users may need the original spreadsheet context next to the status columns.
- Suggested adjustment: have `readQuerySpreadsheet` return both the parsed workflow fields and the original row values keyed by the workbook headers, preserving header order. The report sheet should use the original headers first, then append `status`, `saved_articles`, and `note`.

2. Moderate flaw: seeding results in a `Map<id, GoogleRssQueryResult>` can drop rows if spreadsheet ids are duplicated.

- The current spreadsheet reader validates that `id` is numeric, but it does not validate uniqueness.
- A map keyed only by `id` will overwrite earlier rows with the same id, causing the report to have fewer rows than the input spreadsheet.
- That directly conflicts with the stated requirement to show every row in the query spreadsheet.
- Suggested adjustment: track query results in an array by spreadsheet row order, not by id. Keep `id` as a displayed value, but use an internal `rowIndex` or array index for tracking. Optionally add a separate validation or warning for duplicate ids if duplicate ids should be treated as invalid input.

3. Moderate flaw: exception handling for per-row failures is under-specified and could misclassify the current row as `not_reached`.

- The plan says the outer catch should mark rows still in their initial `not_reached` state as failed only when it is clear the loop never got to them, but it does not define how the implementation will know which row was active when the exception happened.
- If an exception occurs after a row begins processing but before its result entry is overwritten, that row may remain `skipped/not_reached`, which is misleading.
- Suggested adjustment: maintain a `currentRowIndex` or update the row to an in-progress/default processed state before async work begins. In the catch block, mark the active row as `failed/error: <msg>` and leave later rows as `skipped/not_reached`.

Overall: the plan is directionally strong and appropriately additive, but I would fix these row-fidelity details before implementation. They are the pieces most likely to make the final report less trustworthy even if the code compiles and the tests pass.
