---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (sonnet-4.6)
modified_by: claude (sonnet-4.6)
---

# Portal Lint Issues: react-hooks/set-state-in-effect (2026-05-22)

## Summary

The portal package currently fails ESLint with **25 errors across 22 files**, all from the same rule: `react-hooks/set-state-in-effect`. Lint passes with zero warnings allowed (`--max-warnings=0`), so the CI/build gate is blocked.

## Command Run

```bash
npm run lint --workspace newsnexus12portal
# equivalent to:
cd portal && npx eslint --max-warnings=0 .
```

**Result:** exit code 1 — `✖ 25 problems (25 errors, 0 warnings)`

## Failure Category

| Rule | Count | Severity |
|------|-------|----------|
| `react-hooks/set-state-in-effect` | 25 | error |

This is **not** the old Next.js parser-resolution issue (which manifested as ESLint being unable to parse TypeScript/JSX files). The parser resolves correctly. These are **code lint-cleanup issues**: the ESLint `react-hooks` plugin flags calls to functions that internally call `setState` (or are named with data-fetching patterns) when they are invoked synchronously at the top level of a `useEffect` body.

The typical pattern triggering the rule:

```tsx
useEffect(() => {
    fetchSomeData();          // ← flagged: calls setState internally
}, [fetchSomeData]);
```

## Affected Files (22 files, 25 errors)

| File | Errors |
|------|--------|
| `src/app/(dashboard)/admin-database/backup/page.tsx` | 1 |
| `src/app/(dashboard)/admin-database/delete/page.tsx` | 1 |
| `src/app/(dashboard)/admin-database/main/page.tsx` | 1 |
| `src/app/(dashboard)/admin-database/upload/page.tsx` | 1 |
| `src/app/(dashboard)/analysis/approved-article-duplicate/page.tsx` | 1 |
| `src/app/(dashboard)/analysis/approved-chatgpt/page.tsx` | 1 |
| `src/app/(dashboard)/analysis/article-requests/page.tsx` | 1 |
| `src/app/(dashboard)/analysis/count-by-state/page.tsx` | 1 |
| `src/app/(dashboard)/articles/add-delete/page.tsx` | 1 |
| `src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx` | 1 |
| `src/app/(dashboard)/articles/review/page.tsx` | 2 |
| `src/app/(dashboard)/reports/weekly-cpsc/page.tsx` | 1 |
| `src/components/automations/ArticleRequestSpreadsheetsSection.tsx` | 1 |
| `src/components/automations/OrchestratorSection.tsx` | 2 |
| `src/components/automations/WorkerNodeJobStatusPanel.tsx` | 1 |
| `src/components/automations/WorkerPythonJobStatusPanel.tsx` | 1 |
| `src/components/common/RecentlyApprovedByUser.tsx` | 1 |
| `src/components/common/SummaryStatistics.tsx` | 1 |
| `src/components/form/MultiSelect.tsx` | 1 |
| `src/components/ui/modal/ModalAiApproverDetails.tsx` | 2 |
| `src/components/ui/modal/ModalReviewArticleContent.tsx` | 1 |
| `src/components/user-settings/WebBrowserExtensionsSection.tsx` | 1 |

All paths are relative to `portal/`.

## Issue Classification

This is a **code lint-cleanup issue**, not a tooling or parser regression. The `react-hooks/set-state-in-effect` rule was likely enabled (or its severity raised to `error`) during a recent ESLint config update, exposing an existing pattern used throughout the codebase: calling data-fetch functions — which internally call `setState` — directly inside `useEffect` bodies.

## Recommended Next Steps

1. **Decide on the fix strategy** before touching code. Two valid approaches:
   - **Disable per-site with comments** (`// eslint-disable-next-line react-hooks/set-state-in-effect`) — fastest, preserves behavior, but suppresses a real React performance warning.
   - **Refactor to `useCallback`-wrapped async functions** that return data and let the effect call `setState` explicitly — aligns with the rule intent and React docs recommendation, but requires more work per file.

2. **Batch the fix** — all 22 files share the same pattern; a find-and-fix pass is feasible. Start with components (`src/components/`) as they are shared across multiple pages.

3. **Do not downgrade the rule to `warn`** unless the team explicitly decides so; the current `--max-warnings=0` flag means any warning also blocks the build.

4. **Re-run lint after each file batch** to confirm error count drops as expected.

5. **Track progress** in a follow-up issue or PR so the cleanup can be reviewed incrementally.
