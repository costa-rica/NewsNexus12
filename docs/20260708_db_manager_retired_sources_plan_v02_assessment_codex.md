---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Db manager retired sources plan v02 assessment

The v02 plan correctly applies the operator's new `retired_sources` naming pattern, but it explicitly says this is a naming-only revision and does not address the prior assessment yet. The same two feasibility concerns still apply and should be resolved in a v03 before creating the todo.

## 1. Raw-SQL candidate selection tests are under-specified

The module plan says to use one raw SQL query, while the test plan says to use mocked models like the existing suites and verify candidate selection cases:

1. NewsAPI, GNews, and NewsData.IO articles are selected.
2. user-found, Google-RSS-found, other-source, and null-`entityWhoFoundArticleId` articles are never selected.
3. each protection table excludes candidates.

With `sequelize.query` mocked, those tests do not actually prove the SQL performs the intended joins and filters. A test can return an empty mocked row set for "Google RSS" or "user-found" and pass even if the SQL accidentally filters through `NewsApiRequests`, uses a left join, omits the `EntityWhoFoundArticles` join, or matches the wrong source names.

This is a real implementation risk because the feature is destructive and the core safety property is the candidate query. The v03 plan should require one of these verification strategies:

1. Add SQL-shape assertions in `tests/modules/deleteArticlesRetiredSources.test.ts` that inspect the query passed to `sequelize.query` and require:
   - `INNER JOIN "EntityWhoFoundArticles"` from `Articles.entityWhoFoundArticleId`.
   - `INNER JOIN "NewsArticleAggregatorSources"` from `EntityWhoFoundArticles.newsArticleAggregatorSourceId`.
   - a source-name filter using only `NewsAPI`, `GNews`, and `NewsData.IO`.
   - no candidate path through `Articles.newsApiRequestId` or `NewsApiRequests`.
   - the four protection `EXISTS` clauses.
2. Or add a small database-backed query test fixture that creates source rows, finder rows, articles, and protection rows, then runs the retired-sources preview query against real tables.

Mocked return-row tests are still useful for counting, limit behavior, batching, and logging, but they are not enough for candidate-selection correctness.

## 2. The referenced accepted plan path is stale

The plan says it follows `docs/20260708_db_manager_scripts_plan_v03.md`, but that file is no longer present at that path. It appears to have been moved to `docs/archive/202607/20260708_db_manager_scripts_plan_v03.md`.

This is not a code blocker because the implemented no-state module is now present in `db-manager/src/modules/deleteArticlesNoState.ts`, and the retired-sources plan describes most of the needed shape directly. Still, the stale reference can confuse the todo creator or implementer, especially because `docs/archive/` is reference-only by repo convention.

The v03 plan should either:

1. Reference the current implementation files instead of the archived plan:
   - `db-manager/src/modules/deleteArticlesNoState.ts`
   - `db-manager/src/modules/cli.ts`
   - `db-manager/src/index.ts`
   - `db-manager/tests/modules/deleteArticlesNoState.test.ts`
2. Or update the cross-reference to the archive path and clarify that it is historical context only.

## Requested revisions

1. Strengthen the testing plan so retired-sources candidate-selection correctness is verified through SQL-shape assertions or a real-query fixture, not only mocked `sequelize.query` return rows.
2. Replace or correct the stale `docs/20260708_db_manager_scripts_plan_v03.md` reference so the implementing agent has a live source of truth.
3. Keep the v02 naming decision intact:
   - flag: `--delete_articles_retired_sources`
   - module: `deleteArticlesRetiredSources.ts`
   - tests: `deleteArticlesRetiredSources.test.ts`
   - constants/types/functions using `RetiredSources` / `RETIRED_SOURCE_NAMES`

Once those are fixed, the plan should be ready to move into the todo phase.
