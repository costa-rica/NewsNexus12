---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# API Pagination OOM Fix Plan v02 Assessment

The v02 plan resolves the two v01 concerns about `POST /articles` filter semantics. Its main SQL mapping now correctly preserves the current add/delete route behavior for both `returnOnlyIsNotApproved` and `returnOnlyIsRelevant`.

However, the plan is not ready for TODO creation because its testing section introduces a contradictory expectation for `POST /articles/with-ratings` approval filtering.

## Concern 1: with-ratings false-approval fixture expectation is wrong

In the filter-parity test section, the plan says to include:

```text
an article with an ArticleApproveds row where isApproved = false
```

and then says the corresponding `POST /articles/with-ratings` cases "resolve the opposite way" from `POST /articles`.

That is incorrect for the approval fixture. The current `POST /articles/with-ratings` route excludes an article only when one of its approval rows has `isApproved === true || isApproved === 1`. An article whose only approval row has `isApproved = false` is currently kept under `returnOnlyIsNotApproved`.

This is the same approval behavior v02 correctly specifies earlier:

```sql
NOT EXISTS (
  SELECT 1
  FROM "ArticleApproveds" aa
  WHERE aa."articleId" = a.id
    AND aa."isApproved" = true
)
```

If the TODO or tests inherit the "opposite way" wording, the implementation could either add a failing test or change `POST /articles/with-ratings` to exclude false-approval rows, which would be a behavior regression. The plan should revise the testing section to say only the null-relevance fixture distinguishes `POST /articles` from `POST /articles/with-ratings`; the false-approval fixture should be kept by both endpoints under `returnOnlyIsNotApproved`.
