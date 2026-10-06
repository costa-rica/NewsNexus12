# Deduper Speed-Up Ideas

Context: ~10,000+ approved articles and ~150 new articles each week mean about 1.5M pair comparisons. At ~8 comparisons/sec, a run takes ~60 hours. The cosine math itself takes microseconds, so the time goes to per-pair overhead.

Rating scale used below:

- **Risk / implementation**: Low = same results, internal change only · Medium = same results but new moving parts, or small scoring differences · High = results change.
- **Time reduction**: an estimate based on reading the code. Timing a 1,000-pair sample of each stage would confirm it.

## 1. Remove the per-pair database round trips

1. `EmbeddingProcessor.execute` calls `get_article_content` twice per pair, so 1.5M pairs make ~3M single-row queries. `StatesProcessor` makes ~3M more through `get_article_state`.
2. Load all the needed article text and states once at the start, in a single query keyed by `articleId`.
3. Look up values from that in-memory dict inside the loop.

### Risk / implementation: Low

- Scoring is identical. Only where the data comes from changes, not the data itself.
- Memory cost: ~10k texts trimmed to 1,000 chars is roughly 10–20 MB.
- The change stays inside the processors and repository. Existing tests should cover it.

### Potential time reduction: Small to moderate (~1.2–3x, low confidence)

- Each query costs roughly 1–5 ms on a local Postgres, or more over a network. Removing ~6M of them saves about 2–8+ hours.
- This idea probably isn't the main bottleneck. At 8 pairs/sec, each pair takes ~125 ms, and most of that is likely re-encoding the embeddings (see idea 2).

## 2. Store embeddings and compare them with one matrix multiply

1. Compute each article's embedding once, in batches (`model.encode(list_of_texts, batch_size=64)`), and save it, for example in a new `ArticleEmbeddings` table or a `.npy` file.
2. Each week, embed only the ~150 new articles. The approved ones are already stored.
3. Stack the vectors into matrices and compute all similarities at once: `new (150×384) @ approved (10k×384).T`, which gives 1.5M scores in under a second.
4. This also fixes cache thrash: `DEDUPER_CACHE_MAX_ENTRIES=10000` is now smaller than the article count, so the cache clears and re-encodes articles during the run.

### Risk / implementation: Low–Medium

- Scoring is effectively identical. It uses the same model, same text preprocessing, and same dot product. Batched encoding can differ by ~1e-6, which doesn't matter at the threshold.
- New moving part: the stored embeddings must be recomputed if an article's `textForPdfReport` is edited, or if the model changes. Store a text hash and the model name with each vector.
- The first run needs a one-time backfill of all ~10k articles.

### Potential time reduction: Large for the embedding stage (~50–500x), medium confidence

- Today: if the cache is thrashing, the run does up to ~1.5M single-text encodes at ~20–100 ms each on CPU. That matches the observed ~125 ms/pair.
- After: the one-time backfill takes ~5–15 min. Each weekly run is ~150 encodes (seconds) plus one matrix multiply (under 1 sec). Writing 1.5M scores back to the DB becomes the main remaining cost, roughly minutes with batched writes.
- The other stages (states, URL, content hash) still loop per pair. Combine this idea with idea 1 or 3 for the full win.

## 3. Only compare against likely candidates

1. Most of the 1.5M pairs can't be duplicates, for example articles that are years apart or come from different states.
2. Add filters before comparing:
   - Time window: only compare against approved articles from the last N days (e.g. 60).
   - Same state, matching the existing `states` processor.
   - Optional: approximate nearest neighbors (FAISS or pgvector), keeping only the top-k most similar approved articles for each new one.
3. Write analysis rows only for pairs that pass the filters, instead of inserting all 1.5M in the `load` step.

### Risk / implementation: Medium–High (functionality changes)

- Scores for the remaining pairs are unchanged, but **pairs outside the filter are never scored**, so the report shows fewer candidate duplicates.
- Possible misses:
  - Republished or syndicated stories older than 60 days.
  - Articles with a missing or wrong state. Keep empty-state articles in every comparison to be safe.
  - Multi-state stories.
- Implementation is easy: add `WHERE` clauses in `get_all_approved_article_ids` and filter in the `load` step.

### Potential time reduction: Very large (~50–100x), medium confidence

- 60-day window: at ~150 approvals/week, 60 days is ~1,300 approved articles, ~13% of 10k. That's ~7.7x fewer pairs.
- Same state: if articles spread over ~50 states with some concentration, about 5–15% of pairs share a state. That's another ~7–20x.
- Combined: ~150 × 1,300 × ~8% ≈ **15–20k comparisons instead of 1.5M**. At today's 8/sec, that's ~35–45 minutes instead of ~60 hours.
- Bonus: the cost stays flat as the approved set grows, while today it grows every week.
- These numbers are assumptions. A `GROUP BY state` count on recent approved articles would confirm the real ratio.
