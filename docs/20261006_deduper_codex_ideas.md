---
created_at: 2026-10-06T19:44:05Z
updated_at: 2026-10-06T20:03:57Z
created_by: codex (gpt-5) nicksmacbookair
modified_by: codex (gpt-5) nicksmacbookair
---

# Deduper Speed Recommendations

The current pipeline creates every pairing between new and approved articles. With about 150 new articles and more than 10,000 approved articles, this produces roughly 1.5 million comparisons each week. The following changes target that growth directly.

Ratings use a five-level scale: very low, low, medium, high, and very high. Time estimates are directional until each pipeline stage is benchmarked separately.

## 1. Reduce candidates before detailed comparison

- Compare same-state articles within a rolling 60-day publication window.
- Keep a fallback path for missing dates, missing states, and multi-state articles.

### Implementation and scoring risk

- Rating: high.
- Retained pairs keep the same scores, but older or cross-state duplicates are excluded. Validate fallback rules with a shadow run against current results.

### Potential time reduction

- Rating: very high.
- A 60-day window contains about 1,300 articles. This reduces 1.5 million comparisons to about 193,000, or 87%. At eight comparisons per second, that is 6.7 hours before state savings.

## 2. Store embeddings and use vector search

- Store each article's embedding once and query the nearest approved articles through `pgvector`.
- Update stored embeddings as new articles are approved.

### Implementation and scoring risk

- Rating: medium to high.
- The same model preserves pair scores. Approximate search or a result limit can miss qualifying duplicates, so measure recall. Exact vector search is safer but slower than HNSW.

### Potential time reduction

- Rating: very high for the embedding stage.
- Retrieving 50 candidates for each new article produces about 7,500 comparisons, a 99.5% reduction. Overall savings are smaller if earlier stages still process every pair.

## 3. Replace per-pair queries with bulk processing

- Load states, URLs, and content in bulk instead of querying every pair.
- Batch embedding generation, vectorize cosine calculations, and use set-based SQL updates.

### Implementation and scoring risk

- Rating: low to medium.
- Candidate selection and scoring can remain unchanged. Vectorization may cause tiny floating-point differences, so tests should compare duplicate decisions rather than require identical raw scores.

### Potential time reduction

- Rating: high.
- Bulk loading can replace millions of repeated queries with a handful. A 50% to 90% total reduction is plausible if database latency dominates, but stage-level timing must validate this range.
