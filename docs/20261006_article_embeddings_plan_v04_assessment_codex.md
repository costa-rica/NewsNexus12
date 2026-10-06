---
created_at: 2026-10-06T22:30:54Z
updated_at: 2026-10-06T22:30:54Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Article Embeddings Plan v04 Assessment

The v03 cancellation concern is resolved. One bulk-write concern meets the plan-assessment threshold because an implementation path allowed by the plan will fail at runtime.

## 1. Existing insert helper cannot run the update

- The plan allows the bulk `UPDATE ... FROM (VALUES ...)` to use `execute_insert()` or `execute_many()` connection handling.
- `DeduperRepository.execute_insert()` always calls `cursor.fetchone()`. The proposed update has no `RETURNING` clause, so that call raises an error after the transaction has already committed.
- `execute_many()` is designed to execute one parameter tuple at a time and does not express the intended single bulk statement clearly.
- Require a new `execute_statement(query, params)` helper that executes once, commits, and returns `cursor.rowcount` without fetching a row.
- Add a test confirming one bulk statement succeeds and reports the updated row count.
