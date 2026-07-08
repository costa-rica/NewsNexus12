---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Db manager delete no-state articles plan v03

## Purpose

1. Add a way to delete articles whose AI-assigned state resolves to `No state` in the portal's `/articles/review` table.
2. Leave `N/A` articles (no AI state assignment row) and articles with a real assigned state untouched.
3. Supersedes `docs/20260708_db_manager_scripts_plan_v02.md`. Incorporates all three revision requests from `docs/20260708_db_manager_scripts_plan_v02_assessment_codex.md`:
   - collision-safe CLI parsing (Concern 1),
   - `ArticlesApproved02` protection (Concern 2),
   - a preview function contract that can actually produce the promised dry-run output (Concern 3).
4. The v02 architecture is unchanged: one new CLI flag, one new module under `db-manager/src/modules/`, no `db-manager/scripts/` directory, no broad multi-table deletion helper.

## Why a CLI flag instead of `db-manager/scripts/` (unchanged from v02)

1. db-manager is an on-demand CLI, not a long-running service. A `scripts/` entrypoint and a CLI flag are operationally identical; the difference is scaffolding.
2. The existing CLI already provides CLI parsing with tests, a `--dry_run` flag, batched protected deletion, Winston logging, and a production runbook that works unchanged for a new flag.
3. A `scripts/` directory would sit outside `tsconfig.json` `rootDir: "src"` and require a second execution convention. Rejected in v02; the assessor concurred.

## Verified data semantics (unchanged from v02)

1. The API (`api/src/modules/queriesSql.ts`) attaches a `StateAssignment` object to a review-table article only when an `ArticleStateContracts02` row exists for it. `stateName` comes from joining that row's `stateId` to `States`.
2. The portal review table (`portal/src/components/tables/TableReviewArticles.tsx`) renders:
   - the state name when `stateAssignment.stateName` is non-empty,
   - `No state` when `stateAssignment` exists but `stateName` is missing/empty,
   - `N/A` when `stateAssignment` is null (no `ArticleStateContracts02` row).
3. Therefore the deletion target is: articles that have an `ArticleStateContracts02` row whose `stateId` is `NULL`, or whose `stateId` does not join to an existing `States` row.
4. Multiple-assignment nuance: the API query does not order `ArticleStateContracts02` rows, so the review table shows an effectively arbitrary one when several exist. The script uses the **latest assignment row per article** (highest id) as the deciding record.

## Candidate definition (unchanged from v02)

1. Find the latest `ArticleStateContracts02` row per article (max id per `articleId`).
2. An article is a candidate when that latest row satisfies either:
   - `stateId IS NULL` — reason code `null_state_id`, or
   - `stateId` is set but has no matching `States` row — reason code `missing_state_join`.
3. Articles with no `ArticleStateContracts02` row at all (`N/A` in the review table) are **never** candidates.
4. Articles whose latest assignment joins to a valid state are never candidates, even if older assignments were null.

## Protections (revised — addresses Concern 2)

1. The always-on protected set is:
   - `ArticleIsRelevant` — any row for the article,
   - `ArticleApproved` — any row for the article (matches existing `deleteArticles.ts` behavior, which does not inspect `isApproved`),
   - `ArticlesApproved02` — any row for the article. This is the AI approver flow's approval table (per-article rows with `isApproved` and PDF-report metadata, written by the llm04 flow). Verified it is an approval-record table, not a per-evaluation score table — `AiApproverArticleScore` holds scores and is deliberately **not** a protection, because scoring every evaluated article would exclude nearly all candidates.
   - `ArticleReportContract` — any row for the article (report-linked).
2. Protect on *any row* rather than `isApproved = true` rows, consistent with the existing delete paths: a row with `isApproved = false` is still human/AI review signal worth preserving.
3. Protections are always on. No flags to disable them.

## CLI changes (revised — addresses Concern 1)

1. New flag in `src/modules/cli.ts`:
   - `--delete_articles_no_state` — delete all eligible candidates.
   - `--delete_articles_no_state <n>` / `--delete_articles_no_state=<n>` — optional positive integer cap for a cautious first pass, mirroring the `--delete_articles_trim` value syntax.
   - Add the flag to `KNOWN_FLAGS` so typo suggestions cover it.

2. **Collision-safe parsing (required).** The current parser matches flags with `startsWith`, and the generic `--delete_articles` branch would swallow `--delete_articles_no_state`. Worse, `--delete_articles_no_state 100` would parse as `deleteArticlesDays = 100` — the wrong destructive operation. The parser must be changed to **exact flag-token matching**:
   - split each arg on the first `=`; the left side is the flag token,
   - match the token with `===` against the known flag name in every branch (existing branches included),
   - value handling (inline `=value` or next-arg value) stays as is.
   - Side effect to accept: malformed inputs like `--delete_articles90` (currently silently treated as `--delete_articles` with default days) now fail with an unknown-flag error and a typo suggestion. This is a strict improvement; no documented usage relies on the old behavior.
   - Alternative rejected: merely ordering the new branch before the generic one fixes this flag but leaves the `startsWith` foot-gun for the next flag someone adds.

3. Generalize `--dry_run` (unchanged from v02):
   - `--dry_run` + `--zip_file` keeps its current validator behavior,
   - `--dry_run` + `--delete_articles_no_state` reports the deletion preview without deleting,
   - `--dry_run` alone (or with only other flags) remains an error.

4. Execution order in `src/index.ts`: backup, import, trim, delete, **no-state delete**, status.

## Module: `src/modules/deleteArticlesNoState.ts` (revised — addresses Concern 3)

1. Exports two functions with distinct responsibilities:

   - `getNoStateDeletionPreview(limit?)` — pure read. Returns a summary object shaped to support the full dry-run output:

     ```
     {
       totalCandidates: number;            // before protections
       excludedByProtection: {
         relevant: number;
         approved: number;                 // ArticleApproved
         aiApproved: number;               // ArticlesApproved02
         reportLinked: number;             // ArticleReportContract
       };
       totalExcluded: number;              // distinct protected candidates
       eligible: Array<{                   // after protections (+ limit)
         articleId: number;
         title: string;
         publishedDate: string | null;
         latestAssignmentId: number;
         reasonCode: "null_state_id" | "missing_state_join";
       }>;
       eligibleCount: number;
       appliedLimit: number | null;
       reasonCodeCounts: {
         null_state_id: number;
         missing_state_join: number;
       };
     }
     ```

   - `deleteNoStateArticles({ dryRun, limit })` — calls `getNoStateDeletionPreview`, logs the summary, and stops there when `dryRun` is true; otherwise proceeds to batched deletion of `eligible` ids. Dry run and execute therefore log the identical candidate summary before anything destructive happens.

2. **Deterministic exclusion counting.** An article can appear in several protection tables. To keep counts deterministic and non-double-counted, each excluded article is attributed to exactly one protection using fixed precedence: `relevant` → `approved` → `aiApproved` → `reportLinked`. The invariant `totalExcluded = relevant + approved + aiApproved + reportLinked` and `totalCandidates = totalExcluded + (eligible count before limit)` must hold and be tested.

3. Candidate query: raw SQL (consistent with the API's raw queries against `ArticleStateContracts02`) selecting the latest assignment row per article via `MAX(id) GROUP BY "articleId"`, left-joined to `States`, filtered to null/unjoinable state. Protections applied against the four tables above.

4. Deletion: `Article.destroy({ where: { id: { [Op.in]: batchIds } } })` in batches of 5000 with progress logging — same pattern and batch size as `deleteArticles.ts`.

5. Explicitly out of scope (unchanged from v02): a multi-table related-row deletion helper. Existing production delete paths call `Article.destroy()` directly; orphan-row behavior is a pre-existing, cross-cutting question for a separate change.

6. Logged preview output (both modes):
   - total candidate count before protections,
   - exclusion count per protection (using the precedence rule) and distinct total excluded,
   - eligible count and applied limit if any,
   - reason-code breakdown,
   - sample of up to 20 eligible rows: article id, title, publishedDate, latest assignment id, reason code.

7. Execute output: the preview summary, then per-batch progress, then final deleted count.

## Testing plan (revised)

1. Parser tests (extend existing cli suite):
   - `--delete_articles_no_state` with no value,
   - `--delete_articles_no_state 100` and `--delete_articles_no_state=100` forms,
   - zero / negative / non-numeric values rejected,
   - **collision tests (required by assessment):** all three forms above must never set `deleteArticlesDays`,
   - existing flags still parse identically under exact-token matching (`--delete_articles`, `--delete_articles 90`, `--delete_articles=90`, `--delete_articles_trim 100`, `--zip_file`, `--create_backup`, `--dry_run`, `--drop_db`),
   - `--delete_articles90` now errors with a suggestion,
   - `--dry_run` + `--delete_articles_no_state` accepted; `--dry_run` alone still rejected.

2. Candidate selection tests (new suite alongside existing `tests/modules/` suites):
   - no `ArticleStateContracts02` row → not selected,
   - latest assignment `stateId = NULL` → selected with `null_state_id`,
   - latest assignment joins a valid state → not selected,
   - older null assignment but latest valid → not selected,
   - latest assignment points at a missing `States` id → selected with `missing_state_join`,
   - limit caps the eligible set and is reported in `appliedLimit`.

3. Protection tests:
   - relevant / approved / report-linked candidates → excluded,
   - **an otherwise-eligible no-state article with an `ArticlesApproved02` row → excluded (required by assessment),**
   - an article present in multiple protection tables is counted once, under the highest-precedence protection,
   - count invariants hold: `totalExcluded` equals the sum of per-protection counts, and `totalCandidates` equals `totalExcluded` plus pre-limit eligible count.

4. Preview/delete contract tests:
   - `dryRun: true` produces the summary and performs no deletions,
   - execute path deletes exactly the `eligible` ids from the preview.

5. Validation from `db-manager/`:
   - `npm test`
   - `npm run build`

## Operator workflow (unchanged from v02)

1. Dry run: `npm start -- --delete_articles_no_state --dry_run`
2. Inspect counts, per-protection exclusions, reason-code breakdown, and samples.
3. Limited execute: `npm start -- --delete_articles_no_state 100`
4. Re-run the dry run and confirm counts dropped as expected.
5. Full execute: `npm start -- --delete_articles_no_state`
6. Production runs follow the existing AGENTS.md `nohup sudo -u limited_user ...` pattern unchanged.

## Open questions

1. Should `missing_state_join` candidates exist at all in practice? The dry run's reason-code breakdown will answer this; the code path costs nothing if the count is 0.
2. Should the review page/API later be updated to consistently use the latest `ArticleStateContracts02` row? Recommended as a separate follow-up; not required for this change.

## Implementation summary

1. Refactor `src/modules/cli.ts` to exact flag-token matching; add `--delete_articles_no_state [n]` and register it in `KNOWN_FLAGS`.
2. Generalize `--dry_run` to compose with the new flag.
3. Add `src/modules/deleteArticlesNoState.ts` with `getNoStateDeletionPreview(limit?)` and `deleteNoStateArticles({ dryRun, limit })`: latest-assignment candidate selection, always-on protections (`ArticleIsRelevant`, `ArticleApproved`, `ArticlesApproved02`, `ArticleReportContract`) with precedence-based exclusion counting, and batched `Article.destroy()`.
4. Wire the new step into `src/index.ts` after the existing deletes.
5. Extend cli and module test suites per the testing plan; run `npm test` and `npm run build` in `db-manager/`.
