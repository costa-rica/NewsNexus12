---
created_at: 2026-07-01
updated_at: 2026-07-01
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# API Pagination OOM Fix Plan v01 Assessment

The plan is not ready for TODO creation because its SQL filter translation for `POST /articles` does not match the current route behavior. This is a breakage risk: implementing the plan as written would silently change which articles appear in the add/delete article list.

## Concern 1: `returnOnlyIsNotApproved` semantics are wrong for `POST /articles`

The plan says `POST /articles` currently excludes articles having any `ArticleApproveds` row, and proposes:

```sql
NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id)
```

That does not match the current code. `POST /articles` builds its approval map from `sqlQueryArticlesApproved()`, and that helper only returns rows where `aa."isApproved" = true`. The route then sets `articleIsApproved = true` only when the article appears in that approved-only result set.

So the current `returnOnlyIsNotApproved` behavior excludes articles with a true approval, not articles with any approval row. The plan's proposed SQL would also exclude articles that only have non-approved approval rows, which is a material behavior change.

The plan should update the `POST /articles` SQL filter to preserve the current behavior, for example by using `NOT EXISTS (... AND aa."isApproved" = true)`, unless the operator explicitly wants to change this route's meaning.

## Concern 2: `returnOnlyIsRelevant` semantics are wrong for `POST /articles`

The plan says both POST endpoints currently exclude articles having any `ArticleIsRelevants` row with non-null `isRelevant`, and proposes:

```sql
NOT EXISTS (
  SELECT 1
  FROM "ArticleIsRelevants" air
  WHERE air."articleId" = a.id
    AND air."isRelevant" IS NOT NULL
)
```

That matches the current `POST /articles/with-ratings` route, but not `POST /articles`.

For `POST /articles`, the route builds `isRelevantByArticleId` from `sqlQueryArticlesIsRelevant()`, which returns every joined `ArticleIsRelevants` row without filtering by `isRelevant`. The route then sets `ArticleIsRelevant = false` when the article has any row in that map. Therefore `returnOnlyIsRelevant` currently keeps only articles with no `ArticleIsRelevants` rows at all.

The plan's SQL would keep articles that have an `ArticleIsRelevants` row where `isRelevant` is null, while the current route excludes them. The plan should either preserve the current `POST /articles` behavior with `NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id)` or explicitly document a desired behavior change for planner/operator approval.
