---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Assessment of portal lint cleanup TODO

## Summary

This TODO is much more implementation-ready than the plan documents. It has phases, scoped file lists, expected warning-count deltas, verification commands, and commit boundaries. An AI coding agent could follow the general sequence.

There are still moderate to severe concerns that should be fixed before using it as the execution checklist. The main issue is mechanical: several phases instruct the agent to add `eslint-disable-next-line` above `useEffect`, but the current warnings are reported on statements inside the effect body. Those comments will not suppress the warning, so the expected counts in those phases will not drop.

## Findings

1. `eslint-disable-next-line` placement is wrong for most `set-state-in-effect` suppressions.

   Phase 4 says to insert this line directly above the listed `useEffect(`:

   ```ts
   // eslint-disable-next-line react-hooks/set-state-in-effect -- client-side auth mount fetch; pending SWR migration
   ```

   The lint warnings are not attached to the `useEffect` line. They are attached to the specific call or setter inside the effect body, such as `fetchBackupList()` at `portal/src/app/(dashboard)/admin-database/backup/page.tsx:124`, `fetchRowCountsByTable()` at `delete/page.tsx:87`, and `setCurrentPage(...)` at `ModalReviewArticleContent.tsx:197`.

   An `eslint-disable-next-line` placed above `useEffect(` only disables the next physical line, not nested statements inside the effect callback. The same problem affects Phase 5 and some suppressions suggested in Phase 3 and Phase 6.

   Fix the TODO to require one of these patterns:

   - place `eslint-disable-next-line react-hooks/set-state-in-effect -- reason` immediately above the exact flagged statement inside the effect body
   - use `eslint-disable` / `eslint-enable` around the whole effect only when multiple statements in the effect are flagged
   - after each suppression, rerun lint and update the expected warning count only after confirming the warning actually disappeared

   This is severe because it would cause an agent to complete Phase 4 or Phase 5 exactly as written and still fail the phase's expected lint count.

2. The Phase 1 ESLint config instruction is too vague for flat config.

   `portal/eslint.config.mjs` uses ESLint flat config, where scoped rules should be added as another config object with a `files` array and `rules`. The TODO says to add an "`overrides`-style entry," which could lead an agent to add an old `.eslintrc`-style `overrides` key that flat config will not apply as intended.

   Make the task explicit, for example:

   ```js
   {
     files: ["src/components/tables/Table*.tsx"],
     rules: {
       "react-hooks/incompatible-library": "off",
     },
   }
   ```

   If the glob is evaluated relative to `portal/eslint.config.mjs`, use `src/components/tables/Table*.tsx`; if running ESLint from the repo root proves the workspace path is needed, verify with lint before committing.

3. Some phase labels mix fix categories with suppression categories.

   Phase 4 is titled "Pattern C: mount-fetch scope-suppress," but it includes at least one non-fetch derived/sync warning, `portal/src/components/ui/modal/ModalReviewArticleContent.tsx:197`, which clamps `currentPage` from `totalPages`. Phase 3 also includes `ModalAiApproverDetails.tsx:123`, which is closer to keyed data loading than event-handler state sync.

   This is less severe than the disable-placement bug, but it weakens the value of the phased list for an AI agent. If the intent is "suppress all remaining accepted warnings," rename those phases around the action being taken. If the intent is pattern-correct refactoring, move non-matching entries to the appropriate phase.

## Recommendation

Revise the TODO before implementation starts:

1. Replace every "insert above `useEffect`" suppression instruction with "insert immediately above the lint-highlighted statement" or use block disables around the specific effect.
2. Show the exact flat-config object for the TanStack Table rule disable.
3. Reconcile the phase labels with the actual action for each file, especially where the phase is suppressing rather than refactoring.
