---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Db manager scripts plan v01

## Purpose

1. Add a repeatable pattern for operator-run database maintenance scripts under `db-manager/scripts/`.
2. Implement the first script in that pattern: delete articles whose AI-assigned state resolves to `No state`.
3. Keep the actual database logic testable by putting reusable code under `db-manager/src/`, with `db-manager/scripts/` acting as thin entrypoints.
4. Make destructive behavior opt-in, visible, and batch-safe.

This plan is for the plan-and-vet process. It should be reviewed before implementation, especially around the candidate definition and deletion safety.

## Current repository context

1. `db-manager` already owns database maintenance:
   - Existing cleanup functions live in `db-manager/src/modules/deleteArticles.ts`.
   - Existing CLI parsing lives in `db-manager/src/modules/cli.ts`.
   - Existing tests cover the db-manager cleanup module and CLI parser.

2. `db-manager/tsconfig.json` currently has:
   - `rootDir: "src"`
   - `include: ["src/**/*"]`
   - This means a new `db-manager/scripts/` directory will not be part of the normal `npm run build` output unless the implementation changes TypeScript config.

3. The portal review table displays `No state` when:
   - `article.stateAssignment` exists.
   - `article.stateAssignment.stateName` is missing, null, empty, or whitespace.
   - This is different from `N/A`, which means no AI state assignment object exists for the article.

4. The API derives `stateAssignment.stateName` from:
   - `ArticleStateContracts02.stateId`
   - joined to `States.name`

5. The state assigner worker writes `ArticleStateContracts02.stateId = null` when:
   - the model says the article did not occur in the United States, or
   - the model returns a state value that cannot be matched to `States.name` or `States.abbreviation`.

## Proposed structure

1. Create `db-manager/scripts/`.

2. Add a short `db-manager/scripts/README.md` that explains:
   - scripts are operator-run tools,
   - scripts should default to dry run when destructive,
   - reusable logic belongs in `db-manager/src/modules/`,
   - scripts should log counts and samples before executing destructive operations.

3. Add a script entrypoint:
   - `db-manager/scripts/delete_articles_no_state.ts`

4. Add reusable implementation logic under `src`, for example:
   - `db-manager/src/modules/deleteArticlesNoState.ts`

5. Add package script aliases in `db-manager/package.json`, for example:
   - `delete:no-state`: run the script through `ts-node`
   - `delete:no-state:dry-run`: run the script without `--execute`

6. Keep `npm run build` focused on `src` unless the assessor recommends compiling scripts too.
   - Reason: `scripts/` files are operational entrypoints, and existing db-manager already uses `ts-node`.
   - If compiled scripts are required later, add a separate `tsconfig.scripts.json` rather than widening the main `rootDir` without review.

## Candidate definition

1. The script should target articles whose latest AI state assignment resolves to `No state`.

2. Candidate query intent:
   - Find the latest `ArticleStateContracts02` row per article.
   - Join that latest row to `States`.
   - Include the article when the latest assignment has `stateId IS NULL`.
   - Also include the article when `stateId` is not null but does not join to an existing `States` row, because the review table would still have no usable `stateName`.

3. The script must not target `N/A` rows.
   - `N/A` means there is no AI state assignment object.
   - Those articles should remain out of scope for this script.

4. The latest-assignment rule should be explicitly documented in the script output.
   - It is safer than deleting an article because any historical assignment had `stateId = null`.
   - It also matches the latest-assignment convention already used in the worker report writer.

5. The assessor should vet whether the review page should also be updated later to use the latest `ArticleStateContracts02` row consistently.
   - This plan does not require that UI/API change for the script.
   - It does call out that multiple assignment rows could make the current review table less deterministic than the script.

## Script behavior

1. Default mode is dry run.
   - Running the script without `--execute` prints counts and sample candidates only.
   - Deletion happens only when `--execute` is present.

2. Suggested flags:
   - `--execute`: actually delete matching candidate articles.
   - `--limit <n>`: cap candidate count for a cautious first run.
   - `--batch_size <n>`: control deletion batch size.
   - `--sample_size <n>`: control how many candidate rows are printed.
   - `--protect_approved true|false`: default `true`.
   - `--protect_relevant true|false`: default `true`.

3. Suggested dry run output:
   - total candidate count,
   - count excluded by approval protection,
   - count excluded by relevance protection,
   - count eligible for deletion,
   - sample article IDs, titles, published dates, assignment IDs, and reason codes.

4. Suggested reason codes:
   - `null_state_id`: latest AI state assignment has `stateId = null`.
   - `missing_state_join`: latest AI state assignment has a `stateId`, but no matching row exists in `States`.

5. The script should close the Sequelize connection in a `finally` block.

## Deletion safety

1. Use a transaction per batch or per full run.
   - Per batch is better for large deletes because it avoids a long-running transaction.
   - The log should clearly show each completed batch.

2. Prefer a shared helper that deletes article-related rows consistently.
   - Existing delete paths mostly call `Article.destroy(...)`.
   - Some API delete code explicitly deletes a subset of related rows.
   - A new script should avoid leaving obvious orphan rows.

3. The helper should account for known article-linked tables, including:
   - `ArticleStateContract02`
   - `ArticleStateContract`
   - `ArticleApproved`
   - `ArticleIsRelevant`
   - `ArticleContents02`
   - `ArticleReviewed`
   - `ArticleEntityWhoCategorizedArticleContract`
   - `ArticleEntityWhoCategorizedArticleContracts02`
   - `ArticleKeywordContract`
   - `ArticlesApproved02`
   - `AiApproverArticleScore`
   - `ArticleReportContract`
   - `ArticleDuplicateAnalysis` rows where the article appears in any article reference column

4. The implementation should verify the exact model export names from `@newsnexus/db-models` before coding this helper.

5. If an article is already in a report, approved, or marked relevant, default protections should prevent deletion.
   - `--protect_approved true` protects rows in `ArticleApproveds` and `ArticlesApproved02`.
   - `--protect_relevant true` protects rows in `ArticleIsRelevants`.
   - Report-linked articles should be treated as protected by default unless the assessor recommends a different rule.

## Testing plan

1. Add unit tests for candidate selection logic.
   - Article with no `ArticleStateContracts02` row is not selected.
   - Article with latest assignment `stateId = null` is selected.
   - Article with latest assignment joined to a valid state is not selected.
   - Article with old null assignment but latest valid state is not selected.
   - Article with latest assignment pointing to a missing `States` row is selected.

2. Add unit tests for protection filters.
   - Approved article is excluded by default.
   - Relevant article is excluded by default.
   - Report-linked article is excluded by default if report protection is implemented.
   - Protection can be disabled only through explicit flags, if implemented.

3. Add CLI argument tests if argument parsing is shared under `src`.
   - `--execute`
   - `--limit`
   - `--batch_size`
   - invalid non-numeric values
   - default dry-run behavior

4. Run validation from `db-manager`:
   - `npm test`
   - `npm run build`

5. If script files remain outside `src`, add one smoke test or documentation check that confirms the package script points at the expected file path.

## Operator workflow

1. First run a dry run:
   - `cd db-manager && npm run delete:no-state:dry-run`

2. Inspect candidate counts and sample rows.

3. Run a limited execute pass:
   - `cd db-manager && npm run delete:no-state -- --execute --limit 100`

4. Re-run dry run to confirm counts decreased as expected.

5. Run a larger execute pass only after the limited pass looks correct.

## Risks and vetting questions

1. Candidate semantics:
   - Should the script use latest AI assignment, or should it exactly mirror the current review table behavior?
   - The plan recommends latest assignment for safety.

2. Deletion scope:
   - Should report-linked articles always be protected?
   - The plan recommends yes by default.

3. Existing deletion behavior:
   - Current cleanup code may rely on database cascade behavior or may leave some orphanable rows.
   - The assessor should confirm whether adding a broader shared article deletion helper is desirable now or too broad for this change.

4. Scripts build strategy:
   - Should `db-manager/scripts/` be run only by `ts-node`, or should scripts compile to `dist/scripts/`?
   - The plan recommends `ts-node` for now and a separate script tsconfig only if production operation needs compiled artifacts.

5. Naming:
   - The user-facing table label is `No state`.
   - Script and flag names should use lowercase snake case: `delete_articles_no_state` or `delete:no-state`.

## Recommended implementation summary

1. Add `db-manager/scripts/` with a README and one thin script entrypoint.
2. Put testable candidate selection and deletion logic under `db-manager/src/modules/deleteArticlesNoState.ts`.
3. Default to dry run and require `--execute` for destructive deletion.
4. Select candidates using the latest `ArticleStateContracts02` row per article.
5. Protect approved, relevant, and report-linked articles by default.
6. Add focused db-manager tests for candidate selection, protections, and argument parsing.
7. Run `npm test` and `npm run build` in `db-manager`.
