---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# Db manager delete no-state articles todo v03

Source plan: `docs/20260708_db_manager_scripts_plan_v03.md` (accepted).
Supersedes `docs/20260708_db_manager_scripts_todo_v02.md`, incorporating the single remaining concern from `docs/20260708_db_manager_scripts_todo_v02_assessment_codex.md`:

- No intermediate phase may leave `--delete_articles_no_state` accepted but ignored. Resolution: the assessor's preferred option — all parser/type work for the new flag is merged into the wiring phase, after the module exists. The flag therefore does not parse at all until the phase that also routes it. The alternative (temporary "not wired yet" guard in `src/index.ts`) was rejected as throwaway churn.

Phase order changes from v02: the module (formerly Phase 3) is now Phase 2; the new flag's parser, types, and index wiring are combined into Phase 3. Everything else carries over from v02 unchanged, including operator-owned destructive execution and the disambiguated preview count fields (which refine plan v03 §Module item 1: `eligibleCount` → `eligibleBeforeLimitCount` + `selectedForDeletionCount`).

All work happens in `db-manager/` unless noted. Each phase should leave `npm test` and `npm run build` green and is a natural commit boundary. Invariant across all boundaries: `--delete_articles_no_state` either does not parse (Phases 1–2, erroring with an unknown-flag suggestion) or is fully routed (Phase 3 onward). It is never parsed-and-ignored.

## Phase 1 — CLI parser: exact flag-token matching

Refactor `src/modules/cli.ts` so every branch matches the flag token exactly instead of using `startsWith`. No new flag yet — this phase only removes the collision foot-gun while keeping existing behavior identical.

- [ ] 1.1 In `parseCliArgs`, split each arg on the first `=`; left side is the flag token, right side (if any) is the inline value.
- [ ] 1.2 Convert all existing branches (`--delete_articles_trim`, `--delete_articles`, `--zip_file`, `--create_backup`, `--dry_run`, `--drop_db`) to `===` comparison on the flag token. Keep value handling (inline `=value` or next-arg value) unchanged.
- [ ] 1.3 Confirm unknown-flag handling: malformed inputs like `--delete_articles90` now reach the suggestion path and error with "Did you mean --delete_articles?".
- [ ] 1.4 Extend the cli test suite with regression cases proving existing flags parse identically: `--delete_articles`, `--delete_articles 90`, `--delete_articles=90`, `--delete_articles_trim 100`, `--delete_articles_trim=100`, `--zip_file <path>`, `--create_backup`, `--dry_run`, `--drop_db`, and combined-flag invocations.
- [ ] 1.5 Add the new error case test: `--delete_articles90` rejects with a typo suggestion (documented behavior change, plan §CLI changes item 2).
- [ ] 1.6 Run `npm test` and `npm run build`.

Boundary check: `--delete_articles_no_state` does not parse yet — it errors as an unknown flag. Nothing is accepted-but-ignored.

## Phase 2 — Module: `src/modules/deleteArticlesNoState.ts`

Preview (pure read) and delete, per plan §Module, with the count-field refinement below. The module is fully built and tested before any CLI surface exists for it.

- [ ] 2.1 Verify exact model export names from `@newsnexus/db-models` before coding: `ArticleStateContract02`, `ArticleIsRelevant`, `ArticleApproved`, `ArticlesApproved02`, `ArticleReportContract`, `Article`, `State`.
- [ ] 2.2 Implement candidate query as raw SQL: latest `ArticleStateContracts02` row per article (`MAX(id) GROUP BY "articleId"`), left-joined to `States`; candidate when `stateId IS NULL` (`null_state_id`) or state join misses (`missing_state_join`). Articles with no assignment row are never selected.
- [ ] 2.3 Implement `getNoStateDeletionPreview(limit?)` returning:

  ```
  {
    totalCandidates: number;              // before protections
    excludedByProtection: {
      relevant: number;
      approved: number;                   // ArticleApproved
      aiApproved: number;                 // ArticlesApproved02
      reportLinked: number;               // ArticleReportContract
    };
    totalExcluded: number;                // distinct protected candidates
    eligibleBeforeLimitCount: number;     // after protections, before limit
    eligible: Array<{                     // after protections AND limit
      articleId: number;
      title: string;
      publishedDate: string | null;
      latestAssignmentId: number;
      reasonCode: "null_state_id" | "missing_state_join";
    }>;
    selectedForDeletionCount: number;     // === eligible.length
    appliedLimit: number | null;
    reasonCodeCounts: {                   // over the pre-limit eligible set
      null_state_id: number;
      missing_state_join: number;
    };
  }
  ```

- [ ] 2.4 Implement precedence-based exclusion attribution: each protected candidate counted under exactly one protection, precedence `relevant` → `approved` → `aiApproved` → `reportLinked`. Protection = any row in the table for that articleId (no `isApproved` inspection).
- [ ] 2.5 Implement `deleteNoStateArticles({ dryRun, limit })`: get preview, log the full summary; stop if `dryRun`; otherwise batch-delete `eligible` ids via `Article.destroy` in batches of 5000 with per-batch progress logging and a final deleted count, matching the `deleteArticles.ts` pattern. Logged output must distinguish "eligible before limit" from "selected for deletion by limit" whenever a limit is applied.
- [ ] 2.6 Candidate selection tests: no assignment row → not selected; latest `stateId = NULL` → selected `null_state_id`; latest joins valid state → not selected; older null but latest valid → not selected; latest points at missing `States` id → selected `missing_state_join`.
- [ ] 2.7 Protection tests: relevant / approved / report-linked excluded; otherwise-eligible article with an `ArticlesApproved02` row excluded (required by plan assessment); article in multiple protection tables counted once under highest precedence.
- [ ] 2.8 Invariant tests, for both unlimited and limited previews:
  - `totalCandidates === totalExcluded + eligibleBeforeLimitCount`,
  - `totalExcluded === relevant + approved + aiApproved + reportLinked`,
  - `selectedForDeletionCount === eligible.length === min(appliedLimit ?? ∞, eligibleBeforeLimitCount)`.
- [ ] 2.9 Contract tests: `dryRun: true` performs zero deletions; execute path deletes exactly the preview's `eligible` ids.
- [ ] 2.10 Run `npm test` and `npm run build`.

Boundary check: the module exists and is tested but has no CLI surface. `--delete_articles_no_state` still errors as an unknown flag.

## Phase 3 — New flag: parser, types, and `src/index.ts` wiring (single phase)

The flag becomes parseable and fully routed in the same commit, so there is no state where it parses but does nothing (required by todo v02 assessment).

Parser and types:

- [ ] 3.1 Add `--delete_articles_no_state` to `src/modules/cli.ts` and `KNOWN_FLAGS`. Accepts optional positive integer via next-arg (`--delete_articles_no_state 100`) or inline (`--delete_articles_no_state=100`), mirroring `--delete_articles_trim` value syntax. Store as `options.deleteArticlesNoState: true` (presence) plus optional `options.deleteArticlesNoStateLimit: number`, so "flag with no value" is distinguishable from "flag absent". Update `src/types/cli.ts`.
- [ ] 3.2 Reject zero, negative, and non-numeric values with clear errors.

Index wiring:

- [ ] 3.3 Update the dry-run validation block in `src/index.ts`: `--dry_run` is valid when combined with `--zip_file` (existing validator path, unchanged) or `--delete_articles_no_state` (preview-only path). `--dry_run` alone or with only other flags remains an error. Handle the no-state combination before the zip-validator short-circuit (which currently exits early and requires `--zip_file`).
- [ ] 3.4 Add the no-state delete step to the execution order: backup, import, trim, delete, **no-state delete**, status. Pass `dryRun` and the optional limit through to `deleteNoStateArticles`; log start/finish consistent with the other operations.

Tests:

- [ ] 3.5 Parser tests — new flag forms: no value, `100`, `=100`; zero/negative/non-numeric rejected.
- [ ] 3.6 Parser tests — collision (required by plan assessment): all three accepted forms of `--delete_articles_no_state` must never set `deleteArticlesDays` or `deleteArticlesTrimCount`.
- [ ] 3.7 Routing tests, integration-scoped with the module mocked (required by todo v02 assessment — both paths):
  - `--delete_articles_no_state` (execute path) calls `deleteNoStateArticles` with `dryRun: false` and the parsed limit; it does not fall through to status-only behavior,
  - `--dry_run --delete_articles_no_state` calls the preview path (`dryRun: true`) and never the deletion path,
  - `--dry_run` alone still errors,
  - `--dry_run --zip_file` still routes to the zip validator.
- [ ] 3.8 Run `npm test` and `npm run build`.

Boundary check: flag parses and is fully routed. No accepted-but-ignored state existed at any prior boundary.

## Phase 4 — Validation and docs

Agent-owned validation stops at automated tests, build, and a read-only dry run. All real deletions are operator-owned.

Agent-owned:

- [ ] 4.1 Full suite: `cd db-manager && npm test && npm run build`.
- [ ] 4.2 Read-only dry run — only after confirming `db-manager/.env` points at a local/development database (check `PS_` variables): `npm start -- --delete_articles_no_state --dry_run`. Sanity-check the counts against the portal review table's `No state` filter and record the reason-code breakdown (answers plan open question 1 about whether `missing_state_join` occurs in practice). If the `.env` target is production or ambiguous, stop and report instead of running.
- [ ] 4.3 Update `db-manager/AGENTS.md`: add the new flag to the CLI usage list and the `--dry_run` combination note.

Operator-owned (not agent tasks; require a confirmed backup or disposable database, and an explicit operator decision immediately before each run):

- [ ] 4.4 Limited execute: `npm start -- --delete_articles_no_state 100`, then re-run the dry run and confirm `eligibleBeforeLimitCount` dropped by the deleted amount. Verify `N/A` and state-assigned articles in the review table are unaffected.
- [ ] 4.5 Full execute in production per the AGENTS.md `nohup sudo -u limited_user ...` runbook, only after the limited pass looks correct.

## Commit guidance

One commit per phase, referencing this file and the phase per repo convention, e.g. `feat: cli exact flag matching (todo v03 phase 1)`.
