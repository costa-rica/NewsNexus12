---
created_at: 2026-10-06T22:41:44Z
updated_at: 2026-10-06T22:41:44Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Article Embeddings Todo v01 Assessment

The todo aligns with plan v06, but two concerns meet the todo-assessment threshold because they leave failure-prone implementation details unresolved.

## 1. Deduper connection ownership is unclear

- Phase 3 allows the new repository to follow the deduper pool pattern, while Phase 5 does not say who creates or closes that repository.
- `JobManager` currently closes only `DeduperRepository`. Separate pools created by the sync and scoring processors could remain open after every job.
- Specify that deduper callers borrow the existing psycopg connection, without closing it, or add explicit creation and cleanup owned by the orchestrator.
- Keep the standalone runner as the owner that closes its repository in `finally`.

## 2. Empty analysis runs need an explicit path

- The existing embedding processor returns successfully when there are no analysis records.
- The replacement calls `get_analysis_article_ids()` and `ensure_embeddings(ids)` before paging. With an empty ID list, dynamically built `IN (...)` queries can become invalid unless every method short-circuits.
- Require `get_selected_texts([])`, `get_embeddings([])`, `delete_embeddings([])` and `ensure_embeddings([])` to return safely without querying where appropriate.
- Add an `EmbeddingProcessor` test confirming an empty analysis table returns `processed: 0` without loading the model or issuing invalid SQL.
