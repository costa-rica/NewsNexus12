---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Db manager scripts plan v02 assessment

## Assessment result

Revision requested before implementation.

The v02 plan is directionally better than v01 because it keeps the feature inside the existing `db-manager` CLI instead of adding a second operator-tool convention under `db-manager/scripts/`. That matches the current package layout, build boundary, test structure, and production runbook.

However, I found plan-level issues that could cause the implementation to delete the wrong article set or fail to protect important rows. The next plan version should keep the v02 architecture, but it should address the concerns below before a todo list is created.

## Concern 1: new flag can collide with existing parser prefix matching

1. v02 proposes a new flag:
   - `--delete_articles_no_state`

2. The current parser checks flags with `startsWith`.
   - `--delete_articles_trim` is checked first.
   - Generic `--delete_articles` is checked next.
   - Any new flag beginning with `--delete_articles` can be parsed by the generic branch unless the new branch is placed before it or parsing is changed to exact flag-name matching.

3. Why this risks successful implementation:
   - If `--delete_articles_no_state` is parsed by the existing `--delete_articles` branch with no value, it can set `deleteArticlesDays` to the default old-article cleanup threshold.
   - A user intending to run the no-state deletion could instead trigger the old unapproved article deletion path.
   - This is especially risky because both operations are destructive.

4. Required plan change:
   - Require exact flag-name parsing, or explicitly require `--delete_articles_no_state` to be parsed before the generic `--delete_articles` branch.
   - Add parser tests that prove `--delete_articles_no_state`, `--delete_articles_no_state 100`, and `--delete_articles_no_state=100` never set `deleteArticlesDays`.

## Concern 2: approval protection omits `ArticlesApproved02`

1. v02 protects:
   - `ArticleIsRelevant`
   - `ArticleApproved`
   - `ArticleReportContract`

2. The repository also has `ArticlesApproved02`, which is used by the AI approval flow and appears in API and portal code.

3. Why this risks successful implementation:
   - An article with a latest `ArticleStateContracts02.stateId = NULL` can still have AI approval metadata in `ArticlesApproved02`.
   - v02 would allow such an article to be deleted unless it also appears in `ArticleApproved`, `ArticleIsRelevant`, or `ArticleReportContract`.
   - v01 was safer on this point because it explicitly called out both `ArticleApproveds` and `ArticlesApproved02` protection.

4. Required plan change:
   - Add `ArticlesApproved02` to the always-on protected set.
   - Update the dry-run summary to report AI-approved exclusions separately or as part of the approval-protected count.
   - Add a candidate-selection test proving an otherwise eligible no-state article is excluded when it has an `ArticlesApproved02` row.

## Concern 3: dry-run summary and candidate function contract conflict

1. v02 says `findNoStateCandidates(limit?)` returns candidate article ids after protections.

2. v02 also says dry-run output should include:
   - total candidate count before protections
   - counts excluded by each protection
   - eligible count
   - reason-code breakdown

3. Why this risks successful implementation:
   - A function that only returns post-protection candidates cannot by itself produce accurate pre-protection counts or per-protection exclusion counts.
   - If the implementing agent follows the export contract literally, the dry-run output may be incomplete or misleading.

4. Required plan change:
   - Define a summary-returning function, for example `getNoStateDeletionPreview(limit?)`, that returns both pre-protection and post-protection counts.
   - Keep deletion separate from preview generation so dry-run and execute paths log the same candidate summary before any destructive operation.
   - Include tests for overlapping protections so the counts are deterministic and not double-counted accidentally.

## Recommended v03 direction

1. Keep the v02 approach:
   - one new db-manager CLI flag
   - one new module under `db-manager/src/modules`
   - no new `db-manager/scripts` directory
   - no broad 13-table deletion helper in this change

2. Revise the plan to require:
   - exact or collision-safe CLI parsing
   - protection for `ArticleApproved`, `ArticlesApproved02`, `ArticleIsRelevant`, and `ArticleReportContract`
   - a preview result shape that can support the promised dry-run output
   - tests for the parser collision, `ArticlesApproved02` protection, and protection-count reporting

3. After those changes, the plan should be ready to turn into a task-style todo list.
