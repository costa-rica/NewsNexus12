---
created_at: 2026-07-08
updated_at: 2026-07-08
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Db manager scripts todo v02 assessment

## Assessment result

Revision requested before implementation.

The v02 todo addresses the three concerns from `docs/20260708_db_manager_scripts_todo_v01_assessment_codex.md`: destructive execution is operator-owned, dry-run routing moved to the wiring phase, and preview count fields now distinguish pre-limit and post-limit values.

One phase-boundary issue remains. It is narrow, but it should be fixed before implementation because the todo explicitly treats each phase as a natural commit boundary.

## Concern 1: phase 2 leaves the execute command accepted but ignored

1. Phase 2 adds parser support for:
   - `--delete_articles_no_state`
   - `--delete_articles_no_state 100`
   - `--delete_articles_no_state=100`

2. Phase 2 also explicitly says not to touch `src/index.ts` until Phase 4.

3. The note under Phase 2 says this is acceptable because `--dry_run --delete_articles_no_state` still fails index validation. That covers the dry-run path, but it does not cover the normal execute path.

4. Why this risks successful implementation:
   - After Phase 2, `npm start -- --delete_articles_no_state` would parse successfully.
   - Because `src/index.ts` is not wired yet, the command would fall through to the normal status path and exit successfully without previewing or deleting no-state articles.
   - That leaves a user-facing destructive-maintenance flag accepted but nonfunctional at a phase boundary.
   - This is the same class of issue v01 had for dry-run routing, just on the execute command.

5. Required todo change:
   - Avoid a phase boundary where the new command parses successfully but is ignored.
   - Prefer moving the new flag parser/type work into the same phase as index wiring, after the module exists.
   - Acceptable alternative: Phase 2 may add parser support only if the same phase also adds a temporary `src/index.ts` guard that rejects `--delete_articles_no_state` with an explicit "not wired yet" error, then Phase 4 replaces that guard with real routing.

6. Required tests:
   - If parser support remains before module wiring, add a test or equivalent validation that `--delete_articles_no_state` cannot fall through to status-only behavior.
   - In the final wiring phase, test both dry-run and normal execute routing with the module mocked.

## Recommended todo v03 direction

1. Keep the rest of v02.

2. Revise Phase 2 and Phase 4 so no intermediate phase accepts `--delete_articles_no_state` without either:
   - executing the intended no-state path, or
   - failing loudly with an intentional temporary error.

3. After that change, the todo should be ready for implementation.
