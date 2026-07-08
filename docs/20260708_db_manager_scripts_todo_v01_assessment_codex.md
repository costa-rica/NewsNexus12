---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Db manager scripts todo v01 assessment

## Assessment result

Revision requested before implementation.

The todo mostly follows `docs/20260708_db_manager_scripts_plan_v03.md`, and the phase breakdown is close. However, I found implementation-risk issues that should be fixed in a v02 todo before an agent starts coding. The concerns below are about task sequencing, destructive validation, and one preview contract ambiguity.

## Concern 1: phase 5 tells the implementing agent to run a destructive limited execute against a real database

1. The todo includes this validation task:
   - `npm start -- --delete_articles_no_state 100`

2. Why this risks successful implementation:
   - This is a real deletion command, not a dry run.
   - The todo places it under agent validation work rather than clearly marking it as operator-only or requiring explicit approval immediately before execution.
   - The command could delete production-like local data or any database pointed to by the current `db-manager/.env`.

3. Required todo change:
   - Move limited execute out of agent-owned validation, or mark it as operator-only/manual.
   - Agent-owned validation should stop at automated tests, build, and possibly a dry run if a safe local database is already expected and explicitly identified.
   - If a limited execute remains in the workflow, it should require an immediate operator instruction and a confirmed backup or disposable database.

## Concern 2: dry-run wiring is split across phases in a way that can leave an accepted but nonfunctional command

1. Phase 2 says to update `src/index.ts` so `--dry_run` is valid with `--delete_articles_no_state`.

2. The actual no-state module is not created until phase 3, and index wiring is not completed until phase 4.

3. Why this risks successful implementation:
   - Phase 2 is described as a natural commit boundary that should leave tests and build green.
   - If phase 2 makes `--dry_run --delete_articles_no_state` accepted before the preview module is wired, the command can silently fall through to unrelated status behavior instead of producing the promised preview.
   - The task also duplicates dry-run handling between phase 2 and phase 4, which makes the intended ownership unclear.

4. Required todo change:
   - Keep phase 2 focused on parser and type changes only.
   - Move `src/index.ts` dry-run validation and routing for `--delete_articles_no_state` into the wiring phase after `deleteArticlesNoState.ts` exists.
   - Add an index-level test or clearly scoped integration test in the wiring phase, with the deletion module mocked if needed, proving dry-run calls the preview path and does not call deletion.

## Concern 3: preview result shape lacks an explicit pre-limit eligible count

1. The todo asks `getNoStateDeletionPreview(limit?)` to return:
   - `eligible[]`, after protections and limit
   - `eligibleCount`
   - `appliedLimit`

2. The todo also requires this invariant:
   - `totalCandidates = totalExcluded + pre-limit eligible count`

3. Why this risks successful implementation:
   - If `eligibleCount` means the post-limit selected count, then the invariant cannot be calculated when a limit is applied.
   - If `eligibleCount` means the pre-limit count, then it will not match `eligible.length` when a limit is applied.
   - This can produce misleading dry-run output for limited runs, exactly when the operator most needs clear counts.

4. Required todo change:
   - Add separate fields, for example:
     - `eligibleBeforeLimitCount`
     - `selectedForDeletionCount`
   - Require tests for both unlimited and limited previews.
   - Require logged output to distinguish total eligible candidates from the number selected by the applied limit.

## Recommended todo v02 direction

1. Keep the current phase structure broadly:
   - parser refactor
   - new flag
   - preview/delete module
   - index wiring
   - validation/docs

2. Revise the todo to:
   - keep destructive real-database execution operator-owned,
   - move all index dry-run routing into the wiring phase,
   - clarify the preview count fields for pre-limit and post-limit behavior.

3. After those changes, the todo should be ready for implementation.
