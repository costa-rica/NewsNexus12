---
created_at: 2026-07-03
updated_at: 2026-07-03
created_by: claude (fable-5)
modified_by: codex (gpt-5)
---

# Fix 02 Assessment: Chunked Pagination for /articles/review

Assessment of the operator's Fix 02 proposal: push Filter Articles inputs into SQL, add a limit dropdown (1,000-30,000) with chunk pagination in the Filter Articles section, display the unlimited-query article count, and leave TableReviewArticles client-side behavior unchanged.

## 1. Feasibility of the plan

1. Feasible, and it directly fixes why Fix 01 failed. Fix 01 still transferred the entire result set to the portal, just in 200-row pages (roughly 200 sequential requests for 40,000 articles). The limit dropdown bounds both response size and total data fetched, so it removes the OOM path and the latency problem in one move.
2. Pushing the approval/relevance filters into SQL is straightforward. Today only the two date filters run in SQL (queriesSql.ts ~450-462); returnOnlyIsNotApproved and returnOnlyIsRelevant filter in JavaScript (articles.ts ~877-902). The exact NOT EXISTS translations, including the subtle null-relevance semantics, were already worked out and vetted in the failed plan v03 and are fully reusable.
3. The unlimited count is cheap and safe: a COUNT reusing the chunk query's WHERE clause returns one row regardless of dataset size, and doubles as the input for computing the number of chunks.
4. Keeping TanStack sort/search/pagination unchanged works as-is; the table already receives an array prop and will simply receive a chunk.

## 2. Claude recommendations to modify the plan

1. Cap the dropdown at 10,000 (for example 1,000 / 2,500 / 5,000 / 10,000). Observed crash payloads imply roughly 1.5-6 KB per serialized row, so a 30,000-row chunk could reach 45-180 MB — the same failure class as the 259 MB crash. Enforce a server-side maximum regardless of client input.
2. Navigate chunks with a keyset cursor (WHERE a.id > :cursor ORDER BY a.id LIMIT :n) and prev/next controls, with the client remembering chunk-start cursors. OFFSET is an acceptable fallback given the small chunk count.
3. Return the unlimited count as totalCount on the first chunk only; recompute when filters change, not on every chunk fetch.
4. Chunk the POST /analysis/ai-approver/top-scores articleIds request (about 500 ids per call); it scales with chunk size.
5. Keep Fix 01's sound pieces: Map lookups replacing Array.find() in both the API merge (~line 933) and the portal merge (lines 287-288), bounded side queries, and the filter-parity test fixtures (the null-relevance fixture especially).
6. Deploy api and portal together; response keys are additive, but the first-chunk-only behavior changes.

## 3. Claude recommendation regardless of the plan

1. Apply the same server-enforced maximum to POST /articles and GET /articles/approved. with-ratings is one of three unbounded endpoints; either of the others can still crash production.
2. Add Restart=on-failure to newsnexus12-api.service, plus response-size and heap/RSS logging on heavy endpoints.
3. Reconsider excluding textForPdfReport from GET /articles/approved list responses; 23.8 MB responses were observed before both crashes.
