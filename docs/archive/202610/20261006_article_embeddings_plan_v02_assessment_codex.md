---
created_at: 2026-10-06T22:25:28Z
updated_at: 2026-10-06T22:25:28Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Article Embeddings Plan v02 Assessment

The plan is feasible, but the following concerns meet the plan-assessment threshold because they could cause runtime failure or excessive memory use.

## 1. Pipeline result contract is incompatible

- `ArticleEmbeddingService.sync()` returns an `EmbeddingSyncSummary`.
- The orchestrator currently calls `result.get("processed", 0)` for every pipeline step.
- A dataclass or typed object does not provide `get()`, so returning the summary directly will fail at runtime.
- The plan should require the sync step to return a dictionary containing `processed`, or explicitly update the orchestrator to support typed summaries.

## 2. Score collection can consume too much memory

- The plan says to collect 1.5 million score records and describes their memory use as tens of megabytes.
- A Python list containing 1.5 million dictionaries can consume hundreds of megabytes, in addition to the already-loaded analysis records.
- The plan should require flushing each 5,000-row batch immediately and discarding it before calculating the next batch.
- Add a test or review check confirming the processor never accumulates all score updates.

## 3. Fallback operation is missing from the service API

- The processor must encode and upsert an article when content exists but its stored embedding is missing.
- The proposed service exposes only `sync()` and `load_embeddings()`; neither accepts specific article IDs for this fallback.
- The plan should define a method such as `ensure_embeddings(article_ids)` or explain how the fallback uses existing service operations without accessing repository or encoder internals.
