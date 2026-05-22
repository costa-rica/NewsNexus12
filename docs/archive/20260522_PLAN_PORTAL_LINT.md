---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
related_doc: docs/20260521_FAILED_TESTS_AND_VULNERABILITIES.md
branch: dev_09_issues
---

# Portal lint cleanup PLAN

## Background

When Issue 3 (portal ESLint loading failure) was fixed in commit `8ec68c7`,
the lint step started running for the first time in a while and surfaced
**63 pre-existing source-level findings**: 31 errors, 32 warnings.

Triage commit (alongside this doc) did the following so the gate could go
green:

1. Configured `@typescript-eslint/no-unused-vars` to ignore identifiers
   prefixed with `_` (catch parameters etc.). Removed 9 spurious findings.
2. Fixed the 2 real unused-vars:
   - `useAppSelector` import in `portal/src/app/logout/page.tsx`
   - `phoneNumber` param in
     `portal/src/components/form/form-elements/InputGroup.tsx`
3. Downgraded three `react-hooks` rules from `error` → `warn` in
   `portal/eslint.config.mjs`, tracked here for cleanup:
   - `react-hooks/set-state-in-effect`
   - `react-hooks/preserve-manual-memoization`
   - `react-hooks/immutability`

After triage, `npm run lint --workspace newsnexus12portal` exits `0` with
**52 warnings** remaining (down from 63). This document tracks those 52.

## Why these were deferred

Most of these findings reflect real React 19 / React Compiler patterns that
are not safe to "auto-fix":

- `set-state-in-effect` typically means the `useEffect → fetch → setState`
  pattern. Correcting it usually requires switching to event handlers,
  introducing a fetching library (SWR/React Query), or accepting a
  documented exception.
- `incompatible-library` flags third-party hooks that don't satisfy React
  Compiler's purity assumptions.
- `exhaustive-deps` requires reading each effect's intent — adding the
  missing dep may cause an infinite loop in some cases.

This is multi-session refactor work. The acceptance bar for each fix is
**"the page still behaves correctly under React 19 strict mode"**, which
needs manual QA per page.

## Cleanup approach (suggested)

1. **Group by feature area, not by rule.** Pick one feature (e.g. the
   admin-database pages), fix every lint warning in that subtree, manually
   verify the pages still load and behave correctly, commit per feature.
2. **Re-enable the rule as `error` once a category is empty.** When all
   `set-state-in-effect` instances are gone, flip the rule back to `error`
   in `portal/eslint.config.mjs` to prevent regression.
3. **Add a CI guard.** Once the gate is fully green and rules are restored,
   `npm run lint --workspace newsnexus12portal` should be part of the
   required check before merge.

## Items by rule

### `react-hooks/set-state-in-effect` (29)

Likely the same anti-pattern across many files: a `useEffect` that runs on
mount and calls one or more `setState`. Recommended approach per occurrence:

- If the data is fetched once on mount: keep the effect but move the
  `setState` to the resolved branch of a separate function, and verify
  React Compiler is satisfied. Or migrate to SWR/React Query, which avoids
  the rule entirely.
- If the effect is reacting to user input: move the work into the event
  handler that triggered it.
- If the effect is intentional and unavoidable: justify in code with a
  `// eslint-disable-next-line react-hooks/set-state-in-effect` and a
  short comment explaining the constraint.

Locations:

- portal/src/app/(dashboard)/admin-database/backup/page.tsx:124:3
- portal/src/app/(dashboard)/admin-database/delete/page.tsx:87:3
- portal/src/app/(dashboard)/admin-database/main/page.tsx:42:5
- portal/src/app/(dashboard)/admin-database/main/page.tsx:90:5
- portal/src/app/(dashboard)/admin-database/upload/page.tsx:41:3
- portal/src/app/(dashboard)/analysis/approved-article-duplicate/page.tsx:209:5
- portal/src/app/(dashboard)/analysis/approved-chatgpt/page.tsx:177:5
- portal/src/app/(dashboard)/analysis/article-requests/page.tsx:66:5
- portal/src/app/(dashboard)/analysis/count-by-state/page.tsx:66:5
- portal/src/app/(dashboard)/articles/add-delete/page.tsx:123:3
- portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:146:8
- portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:201:3
- portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:205:3
- portal/src/app/(dashboard)/articles/review/page.tsx:97:4
- portal/src/app/(dashboard)/articles/review/page.tsx:442:3
- portal/src/app/(dashboard)/reports/weekly-cpsc/page.tsx:133:3
- portal/src/components/automations/ArticleRequestSpreadsheetsSection.tsx:72:5
- portal/src/components/automations/OrchestratorSection.tsx:229:10
- portal/src/components/automations/OrchestratorSection.tsx:244:12
- portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:147:10
- portal/src/components/automations/WorkerPythonJobStatusPanel.tsx:155:10
- portal/src/components/common/RecentlyApprovedByUser.tsx:62:3
- portal/src/components/common/SummaryStatistics.tsx:51:5
- portal/src/components/form/MultiSelect.tsx:30:5
- portal/src/components/ui/modal/ModalAiApproverDetails.tsx:123:10
- portal/src/components/ui/modal/ModalAiApproverDetails.tsx:168:7
- portal/src/components/ui/modal/ModalReviewArticleContent.tsx:197:3
- portal/src/components/ui/modal/ModalReviewArticleContent.tsx:325:5
- portal/src/components/user-settings/WebBrowserExtensionsSection.tsx:44:5

### `react-hooks/incompatible-library` (13)

All 13 are in `portal/src/components/tables/Table*.tsx` at column 16,
strongly suggesting one shared third-party hook is the source (likely a
`@tanstack/react-table` call site). The fix is probably one shared pattern
applied per table, not 13 independent investigations.

Locations:

- portal/src/components/tables/TableAdaptiveColumnsWithSearch.tsx:59:16
- portal/src/components/tables/TableAdminDatabaseMain.tsx:42:16
- portal/src/components/tables/TableApprovedArticles.tsx:165:16
- portal/src/components/tables/TableApprovedArticlesChatGpt.tsx:160:16
- portal/src/components/tables/TableArticleRequests.tsx:107:16
- portal/src/components/tables/TableDuplicateAnalysis.tsx:342:16
- portal/src/components/tables/TableNewsOrgsGoogleRssFeed.tsx:146:16
- portal/src/components/tables/TableRecentlyApprovedByUser.tsx:179:16
- portal/src/components/tables/TableReportWeeklyCpscStagedArticles.tsx:114:16
- portal/src/components/tables/TableReportsWeeklyCpsc.tsx:248:16
- portal/src/components/tables/TableReportsWeeklyCpscSelectableRows.tsx:102:16
- portal/src/components/tables/TableReviewArticles.tsx:725:16
- portal/src/components/tables/TableReviewStateAssigner.tsx:254:16

### `react-hooks/exhaustive-deps` (8)

For each: either add the missing dep, wrap the value in `useCallback`/
`useMemo`, or add an `eslint-disable-next-line` with an explanation of why
the dep is intentionally omitted. Most likely a mix of all three.

Locations:

- portal/src/components/automations/OrchestratorSection.tsx:208:6
- portal/src/components/automations/OrchestratorSection.tsx:224:6
- portal/src/components/automations/OrchestratorSection.tsx:246:6
- portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:148:6
- portal/src/components/automations/WorkerPythonJobStatusPanel.tsx:156:6
- portal/src/components/tables/TableReviewArticles.tsx:708:3
- portal/src/components/tables/TableReviewStateAssigner.tsx:251:3
- portal/src/components/ui/modal/ModalAiApproverDetails.tsx:124:6

### `react-hooks/immutability` (1)

`handleSelectArticleFromTable` is used on line 453 but declared on line
458. Fix: move the declaration above the `useEffect` that calls it, or
wrap it in `useCallback` defined earlier in the component.

- portal/src/app/(dashboard)/articles/review/page.tsx:453:9

### `react-hooks/preserve-manual-memoization` (1)

React Compiler skipped optimizing this component because the manual
`useMemo`/`useCallback` deps array does not match its inferred deps.
Likely needs a small adjustment to the deps array or removal of the
manual memoization in favor of compiler inference.

- portal/src/app/(dashboard)/analysis/article-requests/page.tsx:21:45

## Verification

After each cleanup pass:

```bash
npm run lint --workspace newsnexus12portal
```

Should print fewer warnings than the previous run. Once a rule's locations
are all empty, flip it from `warn` to `error` in
`portal/eslint.config.mjs` and re-run lint to confirm it stays clean.
