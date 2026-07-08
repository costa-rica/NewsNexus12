---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Db manager delete no-state articles todo v01

Source plan: `docs/20260708_db_manager_scripts_plan_v03.md` (accepted).
All work happens in `db-manager/` unless noted. Each phase should leave `npm test` and `npm run build` green and is a natural commit boundary.

## Phase 1 — CLI parser: exact flag-token matching

Refactor `src/modules/cli.ts` so every branch matches the flag token exactly instead of using `startsWith`. No new flag yet — this phase only removes the collision foot-gun while keeping existing behavior identical.

- [ ] 1.1 In `parseCliArgs`, split each arg on the first `=`; left side is the flag token, right side (if any) is the inline value.
- [ ] 1.2 Convert all existing branches (`--delete_articles_trim`, `--delete_articles`, `--zip_file`, `--create_backup`, `--dry_run`, `--drop_db`) to `===` comparison on the flag token. Keep value handling (inline `=value` or next-arg value) unchanged.
- [ ] 1.3 Confirm unknown-flag handling: malformed inputs like `--delete_articles90` now reach the suggestion path and error with "Did you mean --delete_articles?".
- [ ] 1.4 Extend the cli test suite with regression cases proving existing flags parse identically: `--delete_articles`, `--delete_articles 90`, `--delete_articles=90`, `--delete_articles_trim 100`, `--delete_articles_trim=100`, `--zip_file <path>`, `--create_backup`, `--dry_run`, `--drop_db`, and combined-flag invocations.
- [ ] 1.5 Add the new error case test: `--delete_articles90` rejects with a typo suggestion (documented behavior change, plan §CLI changes item 2).
- [ ] 1.6 Run `npm test` and `npm run build`.

## Phase 2 — New flag and `--dry_run` generalization

- [ ] 2.1 Add `--delete_articles_no_state` to `src/modules/cli.ts` and `KNOWN_FLAGS`. Accepts optional positive integer via next-arg (`--delete_articles_no_state 100`) or inline (`--delete_articles_no_state=100`), mirroring `--delete_articles_trim` value syntax. Store as e.g. `options.deleteArticlesNoStateLimit` (number) plus a presence marker (e.g. `deleteArticlesNoState: true`) so "flag with no value" is distinguishable from "flag absent".
- [ ] 2.2 Reject zero, negative, and non-numeric values with clear errors.
- [ ] 2.3 Update `--dry_run` validation (currently in `src/index.ts`, which errors unless `--zip_file` is present): `--dry_run` is valid when combined with `--zip_file` (existing validator path, unchanged) or `--delete_articles_no_state` (new preview-only path). `--dry_run` alone or with only other flags remains an error.
- [ ] 2.4 Parser tests — new flag forms: no value, `100`, `=100`; zero/negative/non-numeric rejected.
- [ ] 2.5 Parser tests — collision (required by assessment): all three accepted forms of `--delete_articles_no_state` must never set `deleteArticlesDays` or `deleteArticlesTrimCount`.
- [ ] 2.6 Parser/validation tests: `--dry_run --delete_articles_no_state` accepted; `--dry_run` alone still rejected.
- [ ] 2.7 Run `npm test` and `npm run build`.

## Phase 3 — Module: `src/modules/deleteArticlesNoState.ts`

Preview (pure read) and delete, per plan §Module.

- [ ] 3.1 Verify exact model export names from `@newsnexus/db-models` before coding: `ArticleStateContract02`, `ArticleIsRelevant`, `ArticleApproved`, `ArticlesApproved02`, `ArticleReportContract`, `Article`, `State`.
- [ ] 3.2 Implement candidate query as raw SQL: latest `ArticleStateContracts02` row per article (`MAX(id) GROUP BY "articleId"`), left-joined to `States`; candidate when `stateId IS NULL` (`null_state_id`) or state join misses (`missing_state_join`). Articles with no assignment row are never selected.
- [ ] 3.3 Implement `getNoStateDeletionPreview(limit?)` returning the result shape from plan §Module item 1: `totalCandidates`, `excludedByProtection` (`relevant`, `approved`, `aiApproved`, `reportLinked`), `totalExcluded`, `eligible[]` (articleId, title, publishedDate, latestAssignmentId, reasonCode), `eligibleCount`, `appliedLimit`, `reasonCodeCounts`.
- [ ] 3.4 Implement precedence-based exclusion attribution: each protected candidate counted under exactly one protection, precedence `relevant` → `approved` → `aiApproved` → `reportLinked`. Protection = any row in the table for that articleId (no `isApproved` inspection).
- [ ] 3.5 Implement `deleteNoStateArticles({ dryRun, limit })`: get preview, log the full summary (counts, per-protection exclusions, reason-code breakdown, up to 20 sample rows); stop if `dryRun`; otherwise batch-delete `eligible` ids via `Article.destroy` in batches of 5000 with per-batch progress logging and a final deleted count, matching the `deleteArticles.ts` pattern.
- [ ] 3.6 Candidate selection tests: no assignment row → not selected; latest `stateId = NULL` → selected `null_state_id`; latest joins valid state → not selected; older null but latest valid → not selected; latest points at missing `States` id → selected `missing_state_join`; limit caps eligible set and is reported in `appliedLimit`.
- [ ] 3.7 Protection tests: relevant / approved / report-linked excluded; otherwise-eligible article with an `ArticlesApproved02` row excluded (required by assessment); article in multiple protection tables counted once under highest precedence.
- [ ] 3.8 Invariant tests: `totalExcluded` = sum of per-protection counts; `totalCandidates` = `totalExcluded` + pre-limit eligible count.
- [ ] 3.9 Contract tests: `dryRun: true` performs zero deletions; execute path deletes exactly the preview's `eligible` ids.
- [ ] 3.10 Run `npm test` and `npm run build`.

## Phase 4 — Wire into `src/index.ts`

- [ ] 4.1 Handle the `--dry_run` + `--delete_articles_no_state` combination before the zip-validator dry-run short-circuit (which currently exits early and requires `--zip_file`).
- [ ] 4.2 Add the no-state delete step to the execution order: backup, import, trim, delete, **no-state delete**, status.
- [ ] 4.3 Pass `dryRun` and the optional limit through to `deleteNoStateArticles`; log start/finish consistent with the other operations.
- [ ] 4.4 Run `npm test` and `npm run build`.

## Phase 5 — Validation and docs

- [ ] 5.1 Full suite: `cd db-manager && npm test && npm run build`.
- [ ] 5.2 Manual dry run against a real database: `npm start -- --delete_articles_no_state --dry_run`. Sanity-check the counts against the portal review table's `No state` filter and record the reason-code breakdown (answers plan open question 1 about whether `missing_state_join` occurs in practice).
- [ ] 5.3 Limited execute (`npm start -- --delete_articles_no_state 100`), then re-run the dry run and confirm counts dropped by the expected amount. Verify `N/A` and state-assigned articles in the review table are unaffected.
- [ ] 5.4 Update `db-manager/AGENTS.md`: add the new flag to the CLI usage list and the `--dry_run` combination note.
- [ ] 5.5 Operator (not agent): full execute in production per AGENTS.md runbook when satisfied with the limited pass.

## Commit guidance

One commit per phase, referencing this file and the phase per repo convention, e.g. `feat: cli exact flag matching (todo v01 phase 1)`.
