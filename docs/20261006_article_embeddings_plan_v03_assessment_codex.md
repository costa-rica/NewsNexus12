---
created_at: 2026-10-06T22:28:40Z
updated_at: 2026-10-06T22:28:40Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Article Embeddings Plan v03 Assessment

The v02 concerns are resolved. One cancellation concern still meets the plan-assessment threshold because it can report a cancelled job as failed.

## 1. Cancellation translation is incomplete

- `EmbeddingSyncProcessor` translates `ArticleEmbeddingsCancelledError` to `DeduperProcessorError`, but `EmbeddingProcessor` also calls `ensure_embeddings(..., should_cancel)`.
- If cancellation occurs while `ensure_embeddings()` encodes a fallback, its module error reaches the orchestrator as a general exception. The deduper run is then marked failed instead of cancelled.
- The standalone embeddings runner has the same issue unless it translates the module error to `QueueJobCanceledError`.
- Require both translations and add tests confirming that cancellation during `ensure_embeddings()` and standalone sync produces a cancelled queue job, not a failed one.
