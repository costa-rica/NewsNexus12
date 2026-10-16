---
created_at: 2026-10-06T22:33:53Z
updated_at: 2026-10-06T22:33:53Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Article Embeddings Plan v05 Assessment

The v04 bulk-write concern is resolved. One data-lifecycle concern meets the plan-assessment threshold because the service can return an embedding for an article that no longer has content.

## 1. Null text can leave a stale embedding

- `ArticleApproved.textForPdfReport` is nullable and the API can update it to `null`.
- The plan says null-text articles have no embedding row, but incremental cleanup deletes rows only for articles that are no longer approved.
- If existing text becomes null, its old embedding remains. `ensure_embeddings()` loads stored rows first, so it can return that stale embedding despite promising to omit null-text IDs.
- Require sync to delete current-model embeddings whose selected text is null.
- Require `ensure_embeddings()` to validate current selected text before returning stored rows, or explicitly enforce the same cleanup within that operation.
- Test the transition from non-null text with an embedding to null text, confirming the row is deleted and omitted from `ensure_embeddings()`.
