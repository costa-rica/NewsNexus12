---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Lint fix plan V01

Fix the current portal `react-hooks/set-state-in-effect` lint failures with the fast, safe approach. Do not refactor data loading architecture in this pass.

## 1. Goal

- Make `npm run lint --workspace newsnexus12portal` pass again.
- Preserve existing portal behavior.
- Keep changes limited to the known lint failures.
- Avoid broad React data-loading rewrites.

## 2. Strategy

- Add scoped `eslint-disable-next-line react-hooks/set-state-in-effect` comments immediately above the known intentional calls inside `useEffect`.
- Each disable should include a short reason, for example:
  - mount fetch
  - refresh fetch
  - controlled/uncontrolled bridge
  - selected article sync
  - modal feedback sync
- Do not lower the rule severity in `portal/eslint.config.mjs`.
- Do not turn off `react-hooks/set-state-in-effect` globally.

## 3. Files to update

Use the file list from `docs/20260522_PORTAL_LINT_SET_STATE_IN_EFFECT_ISSUES.md`.

Expected scope:

1. `portal/src/app/(dashboard)/admin-database/backup/page.tsx`
2. `portal/src/app/(dashboard)/admin-database/delete/page.tsx`
3. `portal/src/app/(dashboard)/admin-database/main/page.tsx`
4. `portal/src/app/(dashboard)/admin-database/upload/page.tsx`
5. `portal/src/app/(dashboard)/analysis/approved-article-duplicate/page.tsx`
6. `portal/src/app/(dashboard)/analysis/approved-chatgpt/page.tsx`
7. `portal/src/app/(dashboard)/analysis/article-requests/page.tsx`
8. `portal/src/app/(dashboard)/analysis/count-by-state/page.tsx`
9. `portal/src/app/(dashboard)/articles/add-delete/page.tsx`
10. `portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx`
11. `portal/src/app/(dashboard)/articles/review/page.tsx`
12. `portal/src/app/(dashboard)/reports/weekly-cpsc/page.tsx`
13. `portal/src/components/automations/ArticleRequestSpreadsheetsSection.tsx`
14. `portal/src/components/automations/OrchestratorSection.tsx`
15. `portal/src/components/automations/WorkerNodeJobStatusPanel.tsx`
16. `portal/src/components/automations/WorkerPythonJobStatusPanel.tsx`
17. `portal/src/components/common/RecentlyApprovedByUser.tsx`
18. `portal/src/components/common/SummaryStatistics.tsx`
19. `portal/src/components/form/MultiSelect.tsx`
20. `portal/src/components/ui/modal/ModalAiApproverDetails.tsx`
21. `portal/src/components/ui/modal/ModalReviewArticleContent.tsx`
22. `portal/src/components/user-settings/WebBrowserExtensionsSection.tsx`

## 4. Implementation steps

1. Run the portal lint command to confirm the current failure:
   - `npm run lint --workspace newsnexus12portal`

2. Add scoped disable comments for the reported lines.
   - Put each comment directly above the flagged call.
   - Keep the comment specific.
   - Do not add unrelated formatting changes.

3. Re-run lint:
   - `npm run lint --workspace newsnexus12portal`

4. Run the portal build:
   - `npm run build --workspace newsnexus12portal`

5. If both pass, commit the code cleanup.

## 5. What not to do

- Do not rewrite these pages to server components.
- Do not replace the existing fetch/state patterns with a new data library.
- Do not lower `--max-warnings=0`.
- Do not change `react-hooks/set-state-in-effect` from `error` to `warn`.
- Do not make broad style or formatting edits.

## 6. Commit guidance

Use a focused commit after lint and build pass.

Suggested title:

```text
fix: suppress intentional portal effect state sync
```

Suggested body:

```text
- add scoped react-hooks/set-state-in-effect suppressions for intentional mount and refresh fetches
- preserve existing portal behavior while restoring the lint gate
```
