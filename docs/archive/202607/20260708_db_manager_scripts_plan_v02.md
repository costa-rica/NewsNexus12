---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Db manager delete no-state articles plan v02

## Purpose

1. Add a way to delete articles whose AI-assigned state resolves to `No state` in the portal's `/articles/review` table.
2. Leave `N/A` articles (no AI state assignment row) and articles with a real assigned state untouched.
3. Supersedes `docs/20260708_db_manager_scripts_plan_v01.md`. The v01 plan proposed a new `db-manager/scripts/` directory with its own conventions; this plan folds the feature into the existing db-manager CLI as a new flag instead.

## Why a CLI flag instead of `db-manager/scripts/`

1. db-manager is an on-demand CLI, not a long-running service. Operationally, a `scripts/` entrypoint and a CLI flag are the same thing: a command typed in a terminal. The difference is the scaffolding each requires.

2. The existing CLI already provides everything v01 proposed to build fresh:
   - CLI parsing with tests and typo suggestions (`src/modules/cli.ts`).
   - A `--dry_run` flag (currently coupled to `--zip_file`; this plan generalizes it).
   - Batch deletion with approved/relevant protections (`src/modules/deleteArticles.ts`), covered by the existing Jest suite.
   - Winston logging and a documented production runbook (`nohup sudo -u limited_user npm start -- --<flag>`), which works unchanged for a new flag.

3. The `scripts/` approach creates problems it then has to solve:
   - `scripts/` sits outside `tsconfig.json` `rootDir: "src"`, forcing ts-node-only execution or a second tsconfig.
   - It needs new package.json aliases and a README documenting a second convention for operator tools.

4. Verdict: add one flag and one module. No new directory, no new tsconfig, no new conventions.

## Verified data semantics

1. The API (`api/src/modules/queriesSql.ts`) attaches a `StateAssignment` object to a review-table article only when an `ArticleStateContracts02` row exists for it. `stateName` comes from joining that row's `stateId` to `States`.

2. The portal review table (`portal/src/components/tables/TableReviewArticles.tsx`) renders:
   - the state name when `stateAssignment.stateName` is non-empty,
   - `No state` when `stateAssignment` exists but `stateName` is missing/empty,
   - `N/A` when `stateAssignment` is null (no `ArticleStateContracts02` row).

3. Therefore the deletion target is: articles that have an `ArticleStateContracts02` row whose `stateId` is `NULL`, or whose `stateId` does not join to an existing `States` row.

4. Multiple-assignment nuance: the API query does not order `ArticleStateContracts02` rows, so when an article has multiple assignments the review table shows an effectively arbitrary one. The script uses the **latest assignment row per article** (highest id) as the deciding record. This is safer than deleting because any historical row was null, and matches the latest-assignment convention used by the worker report writer.

## Candidate definition

1. Find the latest `ArticleStateContracts02` row per article (max id per `articleId`).

2. An article is a candidate when that latest row satisfies either:
   - `stateId IS NULL` — reason code `null_state_id`, or
   - `stateId` is set but has no matching `States` row — reason code `missing_state_join`.

3. Articles with no `ArticleStateContracts02` row at all (`N/A` in the review table) are **never** candidates.

4. Articles whose latest assignment joins to a valid state are never candidates, even if older assignments were null.

## Protections

1. Reuse the existing protected-IDs pattern from `deleteArticles.ts`:
   - articles with an `ArticleIsRelevant` row are protected,
   - articles with an `ArticleApproved` row are protected.

2. Add report protection: articles with an `ArticleReportContract` row are protected.

3. Protections are always on. No flags to disable them — if an exception is ever needed, that is a deliberate future change, not a footgun to ship now.

## CLI changes

1. New flag in `src/modules/cli.ts`:
   - `--delete_articles_no_state` — delete all eligible candidates.
   - `--delete_articles_no_state <n>` — optional positive integer cap for a cautious first pass, mirroring the `--delete_articles_trim` value syntax.
   - Add the flag to `KNOWN_FLAGS` so typo suggestions cover it.

2. Generalize `--dry_run`:
   - Current behavior: `--dry_run` requires `--zip_file` and runs the zip validator.
   - New behavior: `--dry_run` combined with `--delete_articles_no_state` reports candidates without deleting. `--dry_run` with `--zip_file` keeps its current behavior. `--dry_run` alone (or with any other flag) remains an error.

3. Execution order in `src/index.ts` stays: backup, import, trim, delete, no-state delete, status. (Exact position of the new step relative to the existing deletes is not critical; place it after `--delete_articles`.)

## Module: `src/modules/deleteArticlesNoState.ts`

1. Exports:
   - `findNoStateCandidates(limit?)` — returns candidate article ids with reason codes, after protections. Testable in isolation.
   - `deleteNoStateArticles(options)` — orchestrates dry run vs execute, batching, and logging.

2. Candidate query: raw SQL (consistent with the API's use of raw queries for `ArticleStateContracts02`) selecting the latest assignment row per article via `MAX(id) GROUP BY "articleId"`, left-joined to `States`, filtered to null/unjoinable state, excluding protected ids.

3. Deletion: `Article.destroy({ where: { id: { [Op.in]: batchIds } } })` in batches of 5000 with progress logging — the same pattern and batch size as `deleteArticles.ts`.

4. Explicitly out of scope: the v01 plan's 13-table related-row deletion helper. Existing production delete paths call `Article.destroy()` directly; if orphan rows are a real issue it is pre-existing across all delete paths and deserves its own investigation, not a side effect of this change.

5. Dry-run output (via logger):
   - total candidate count before protections,
   - counts excluded by each protection (relevant, approved, report),
   - eligible count (and applied limit if any),
   - breakdown by reason code,
   - sample of up to 20 candidates: article id, title, publishedDate, latest assignment id, reason code.

6. Execute output: same summary as dry run, then per-batch progress, then final deleted count.

## Testing plan

1. Candidate selection tests (new suite alongside existing `tests/modules/` suites):
   - no `ArticleStateContracts02` row → not selected,
   - latest assignment `stateId = NULL` → selected with `null_state_id`,
   - latest assignment joins a valid state → not selected,
   - older null assignment but latest valid → not selected,
   - latest assignment points at a missing `States` id → selected with `missing_state_join`,
   - relevant / approved / report-linked candidates → excluded,
   - limit caps the eligible set.

2. CLI parser tests (extend existing cli suite):
   - `--delete_articles_no_state` with no value,
   - `--delete_articles_no_state 100` and `=100` forms,
   - zero / negative / non-numeric values rejected,
   - typo suggestion still works,
   - `--dry_run` + `--delete_articles_no_state` accepted; `--dry_run` alone still rejected.

3. Validation from `db-manager/`:
   - `npm test`
   - `npm run build`

## Operator workflow

1. Dry run:
   - `npm start -- --delete_articles_no_state --dry_run`
2. Inspect counts, reason-code breakdown, and samples.
3. Limited execute:
   - `npm start -- --delete_articles_no_state 100`
4. Re-run the dry run and confirm counts dropped as expected.
5. Full execute:
   - `npm start -- --delete_articles_no_state`
6. Production runs follow the existing AGENTS.md `nohup sudo -u limited_user ...` pattern unchanged.

## Open questions

1. Should `missing_state_join` candidates exist at all in practice? The dry run's reason-code breakdown will answer this; if the count is 0 the code path still costs nothing.
2. Should the review page/API later be updated to consistently use the latest `ArticleStateContracts02` row? Recommended as a separate follow-up; not required for this change.

## Implementation summary

1. Add `--delete_articles_no_state [n]` to `src/modules/cli.ts` and `KNOWN_FLAGS`.
2. Generalize `--dry_run` to compose with the new flag.
3. Add `src/modules/deleteArticlesNoState.ts` with latest-assignment candidate selection, always-on protections (relevant, approved, report), and batched `Article.destroy()`.
4. Wire the new step into `src/index.ts` after the existing deletes.
5. Extend cli and module test suites; run `npm test` and `npm run build` in `db-manager/`.
