---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Portal lint cleanup TODO (v02)

Implementation checklist derived from
`docs/20260522_PLAN_PORTAL_LINT_V03.md`. This is **v02**, correcting
three issues raised by a codex review of v01:

1. **Suppression placement bug.** v01 told the agent to insert
   `// eslint-disable-next-line` above the `useEffect(` line. The rule
   actually fires on the setter/call inside the effect body, so v01's
   comments would have suppressed the wrong line and Phase 4 would have
   failed its expected count. v02 puts every suppression comment
   immediately above the lint-highlighted statement, and adds a
   re-verification step after each suppression.
2. **Flat-config syntax was vague.** v01 said "overrides-style entry,"
   which could lead an agent to use the legacy `.eslintrc` `overrides`
   key. v02 shows the exact flat-config object.
3. **Two phase miscategorizations.**
   - `ModalReviewArticleContent.tsx:197` is a derived-state clamp
     (`setCurrentPage(c => Math.min(c, totalPages))`). Moved from
     Phase 4 (Pattern C) to Phase 2 (Pattern A).
   - `ModalAiApproverDetails.tsx:123` is keyed data loading
     (`fetchDetails` on `articleId`/`token` change). Moved from
     Phase 3 (Pattern B) to Phase 4 (Pattern C).

Each phase is a discrete, testable unit of work. Complete phases in
order. After every phase: run lint, confirm the warning count dropped
by the expected amount, type-check the portal, and commit.

## Locked-in decisions

- **TanStack Table** (`react-hooks/incompatible-library`, 13 hits):
  scope-disable on `Table*.tsx`. Do not rewrite the tables.
- **Pattern C default** (`set-state-in-effect`, mount-fetch / keyed
  data load, 16 hits): scope-suppress with a named comment placed
  directly above the flagged statement. The default reason is
  `client-side auth mount fetch; pending SWR migration`. Server
  Component / route-loader migration is **out of scope**.
- **Pattern D default** (`set-state-in-effect`, signal/polling, 4 hits):
  scope-suppress with a named comment placed directly above the
  flagged statement. The default reason is
  `signal/polling fetch; rule cannot statically verify`.
- **CI gating** (Phase 8): once cleanup completes, restore the three
  downgraded rules to `error`. Optionally add `--max-warnings=0` to
  the lint script. A warning-budget gate during cleanup is optional;
  per-phase count checks are the primary control.

## Starting state

After commit `cf5f531`:

```
npm run lint --workspace newsnexus12portal  # exits 0, 52 warnings
```

Per-rule baseline:
- `react-hooks/set-state-in-effect`: 29
- `react-hooks/incompatible-library`: 13
- `react-hooks/exhaustive-deps`: 8
- `react-hooks/immutability`: 1
- `react-hooks/preserve-manual-memoization`: 1

Total: 52.

## How to apply a `set-state-in-effect` suppression correctly

This is the critical mechanic for Phases 3, 4, and 5.

The lint warning's `file:line` points to the **specific statement
inside the effect body** that calls `setState` (or a function that
ultimately sets state). For example:

```text
portal/src/app/(dashboard)/admin-database/backup/page.tsx:124:3
                                                          ^^^
                                                   line 124, col 3
```

In that file, line 124 is `fetchBackupList();`, NOT the `useEffect(`
line. To suppress this warning, the comment goes immediately above
line 124:

```ts
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- client-side auth mount fetch; pending SWR migration
  fetchBackupList();
  fetchRowCountsByTable();
}, [fetchBackupList, fetchRowCountsByTable]);
```

If after suppressing one statement the same effect produces another
warning at a different line (e.g. `fetchRowCountsByTable()`), repeat:
add a second `eslint-disable-next-line` above that line. Alternatively,
wrap the entire effect body with a block disable:

```ts
useEffect(() => {
  /* eslint-disable react-hooks/set-state-in-effect -- reason */
  fetchBackupList();
  fetchRowCountsByTable();
  /* eslint-enable react-hooks/set-state-in-effect */
}, [fetchBackupList, fetchRowCountsByTable]);
```

**After every suppression, rerun lint and confirm the targeted
warning is gone before moving to the next file.** The line/column in
the lint output is the source of truth.

## Per-phase workflow

After each phase:

```bash
npm run lint --workspace newsnexus12portal           # confirm new count
npm run build --workspace newsnexus12portal          # type-check + build
```

Then check off the phase's tasks and commit. Commit message format:

```
chore(portal-lint): phase N – <short description>

Refs docs/20260522_TODO_PORTAL_LINT_V02.md phase N.
```

For phases that change React effect behavior (Phases 2, 3, 6), also
run the dev server and manually load each affected page:

```bash
npm run dev --workspace newsnexus12portal
```

## Phase 1 — TanStack scope-disable

Single config change. Drops 13 warnings.

- [x] Edit `portal/eslint.config.mjs`. Add the following object as the
      final entry in the exported config array (after the existing
      rules block):

      ```js
      {
        files: ["src/components/tables/Table*.tsx"],
        rules: {
          // TanStack `useReactTable` returns mutable refs that React
          // Compiler cannot prove pure. Decision documented in
          // docs/20260522_PLAN_PORTAL_LINT_V03.md.
          "react-hooks/incompatible-library": "off",
        },
      },
      ```

      The `files` glob is relative to the ESLint config file
      (`portal/eslint.config.mjs`), so `src/components/tables/Table*.tsx`
      is correct when the lint command runs from the portal workspace.
- [x] Verify lint count: **52 → 39** (`-13`).
- [x] Verify build passes.
- [x] Commit.

## Phase 2 — Pattern A: derived state → useMemo

4 locations. Replace `useState + useEffect` with `useMemo` (or remove
state and compute inline). Drops 4 warnings.

- [x] **`portal/src/app/(dashboard)/admin-database/main/page.tsx:42`** —
      `tableKeys` is computed by an effect from `tableData`. Delete the
      `useState<string[]>` for `tableKeys` and the effect at 38–43.
      Replace usages with:

      ```ts
      const tableKeys = useMemo(
        () =>
          tableData.length === 0
            ? []
            : Object.keys(tableData[0]).filter((k) => k !== "id"),
        [tableData],
      );
      ```
- [x] **`portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:205`** —
      effect clamps `currentPage` to `totalPages`. Remove the effect.
      Where the value is read, use
      `Math.min(currentPage, totalPages)` directly or a derived
      `const safeCurrentPage = Math.min(currentPage, totalPages);`.
      Keep `setCurrentPage` for explicit setters elsewhere.
- [x] **`portal/src/app/(dashboard)/articles/review/page.tsx:97`** —
      `hasFilterChanges` is computed by comparing current filters to
      `initialFiltersRef`. Replace the `useState` and effect with a
      `useMemo` returning the same boolean. Audit any caller that
      does `setHasFilterChanges(false)` explicitly — they need to be
      removed or replaced with a ref reset.
- [x] **`portal/src/components/ui/modal/ModalReviewArticleContent.tsx:197`** —
      effect clamps `currentPage` to `totalPages` (same pattern as the
      ai-approver-prompts case). Remove the effect, use
      `Math.min(currentPage, totalPages)` at read sites.
- [x] Run dev server, manually verify: admin-database/main loads and
      switches tables; ai-approver-prompts paginates correctly;
      articles/review filter UI lights up when filters change; the
      review-article-content modal still paginates correctly.
- [x] Verify lint count: **39 → 35** (`-4`).
- [x] Verify build passes.
- [x] Commit.

## Phase 3 — Pattern B: event-driven → handler or restructure

5 locations. Drops 5.

- [ ] **`portal/src/app/(dashboard)/admin-database/main/page.tsx:90`** —
      effect fetches when `selectedTable` changes. Move
      `fetchTableData(selectedTable)` into the dropdown's `onChange`
      handler (alongside `setSelectedTable`). Remove the effect.
      Initial load: either call `fetchTableData(initialTable)` once
      in a Pattern-C suppressed mount effect, or render empty until
      first selection.
- [ ] **`portal/src/app/(dashboard)/analysis/article-requests/page.tsx:66`** —
      effect refetches when `dateRequestsLimit` changes. Move the
      refetch into the date-limit input's change handler. If a
      mount-only initial fetch is still needed, add a Pattern-C
      suppressed effect for that purpose only.
- [ ] **`portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:201`** —
      effect resets `currentPage` to 1 when `showActiveOnly` or
      `pageSize` change. Move the `setCurrentPage(1)` into the
      respective change handlers (the "active only" toggle's
      `onChange` and the page-size selector's `onChange`). Remove
      the effect.
- [ ] **`portal/src/components/form/MultiSelect.tsx:30`** — prop-mirror
      anti-pattern. Cleanest fix: lift selection to the parent
      (controlled component). If out of scope for this commit, apply
      a scope suppression directly above the flagged statement
      (line 30, `setSelectedOptions(defaultSelected)`):

      ```ts
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled/uncontrolled bridge; see PLAN V03 Pattern B
      ```
- [ ] **`portal/src/components/ui/modal/ModalAiApproverDetails.tsx:168`** —
      effect resets `humanApprovalValue` and `reasonHumanRejected`
      when `topEligibleScore` changes. Restructure: compute initial
      values from `topEligibleScore` in a `useMemo`, or apply a
      `key` reset to the form section to remount it. If neither is
      desirable, scope-suppress with a Pattern-B reason.
- [ ] Run dev server, manually verify: admin-database/main dropdown
      still refetches; analysis/article-requests date filter still
      works; ai-approver-prompts pagination resets correctly;
      multi-select still updates when parent passes new
      `defaultSelected`; AI Approver modal still resets fields when
      `topEligibleScore` changes.
- [ ] Verify lint count: **35 → 30** (`-5`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 4 — Pattern C: mount-fetch / keyed-load scope-suppress

16 locations. Each gets a suppression comment placed **immediately
above the flagged line** (not above `useEffect(`). Default reason:
`client-side auth mount fetch; pending SWR migration`. Drops 16.

For each task: locate the line shown in the lint output, insert
directly above it:

```ts
// eslint-disable-next-line react-hooks/set-state-in-effect -- client-side auth mount fetch; pending SWR migration
```

Then rerun lint locally and confirm that file's warning is cleared
before moving on. If after suppression the same effect produces
another warning at a different line, repeat at that line OR convert
to a block disable around the effect body.

- [ ] `portal/src/app/(dashboard)/admin-database/backup/page.tsx:124`
- [ ] `portal/src/app/(dashboard)/admin-database/delete/page.tsx:87`
- [ ] `portal/src/app/(dashboard)/admin-database/upload/page.tsx:41`
- [ ] `portal/src/app/(dashboard)/analysis/approved-article-duplicate/page.tsx:209`
- [ ] `portal/src/app/(dashboard)/analysis/approved-chatgpt/page.tsx:177`
- [ ] `portal/src/app/(dashboard)/analysis/count-by-state/page.tsx:66`
- [ ] `portal/src/app/(dashboard)/articles/add-delete/page.tsx:123`
- [ ] `portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:146`
- [ ] `portal/src/app/(dashboard)/articles/review/page.tsx:442`
- [ ] `portal/src/app/(dashboard)/reports/weekly-cpsc/page.tsx:133`
- [ ] `portal/src/components/automations/ArticleRequestSpreadsheetsSection.tsx:72`
- [ ] `portal/src/components/automations/OrchestratorSection.tsx:229`
- [ ] `portal/src/components/common/RecentlyApprovedByUser.tsx:62`
- [ ] `portal/src/components/common/SummaryStatistics.tsx:51`
- [ ] `portal/src/components/ui/modal/ModalAiApproverDetails.tsx:123` —
      reason variant: `modal data load on articleId change; pending SWR migration`
- [ ] `portal/src/components/user-settings/WebBrowserExtensionsSection.tsx:44`
- [ ] Verify lint count: **30 → 14** (`-16`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 5 — Pattern D: signal/polling scope-suppress

4 locations. Same mechanic as Phase 4. Insert directly above the
flagged line:

```ts
// eslint-disable-next-line react-hooks/set-state-in-effect -- signal/polling fetch; rule cannot statically verify
```

Drops 4.

- [ ] `portal/src/components/automations/OrchestratorSection.tsx:244` —
      refetch past runs when active run finishes
- [ ] `portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:147` —
      parent `refreshSignal` triggers refetch
- [ ] `portal/src/components/automations/WorkerPythonJobStatusPanel.tsx:155` —
      parent `refreshSignal` triggers refetch
- [ ] `portal/src/components/ui/modal/ModalReviewArticleContent.tsx:325` —
      `setInterval` polling for queued job status
- [ ] Verify lint count: **14 → 10** (`-4`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 6 — `react-hooks/exhaustive-deps`

8 locations. Drops 8.

- [ ] **`portal/src/components/automations/OrchestratorSection.tsx:208`** —
      `useCallback` for `fetchActiveRun` is missing `authHeaders` in
      deps. Add `authHeaders` to the deps array, OR move the
      `authHeaders` computation inside the callback. Verify no
      infinite-loop side effect on the page.
- [ ] **`portal/src/components/automations/OrchestratorSection.tsx:224`** —
      same pattern for `fetchPastRuns`. Apply the same fix.
- [ ] **`portal/src/components/automations/OrchestratorSection.tsx:246`** —
      effect deps are `[activeRun?.status]` but the body uses
      `activeRun` and `fetchPastRuns`. Add both; if the effect now
      fires too often, suppress with a named comment placed above
      the flagged statement.
- [ ] **`portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:148`** —
      effect calls `fetchLatestJob` but deps array does not include
      it. Add it (and wrap `fetchLatestJob` in `useCallback` if it
      causes excessive re-runs), OR suppress.
- [ ] **`portal/src/components/automations/WorkerPythonJobStatusPanel.tsx:156`** —
      same pattern.
- [ ] **`portal/src/components/tables/TableReviewArticles.tsx:708`** —
      `useMemo` deps list is missing one or more handlers it
      references. Inspect, add. If wrapping handlers in
      `useCallback` is needed to avoid recompute storms, do that
      too.
- [ ] **`portal/src/components/tables/TableReviewStateAssigner.tsx:251`** —
      same pattern; columns `useMemo` deps may be missing.
- [ ] **`portal/src/components/ui/modal/ModalAiApproverDetails.tsx:124`** —
      effect deps `[articleId, token]` but body calls `fetchDetails`.
      Either add `fetchDetails` (wrap in `useCallback`), OR suppress.
- [ ] Run dev server, manually verify each affected page: no
      infinite request loops in the network tab, no visible UI
      regressions.
- [ ] Verify lint count: **10 → 2** (`-8`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 7 — `immutability` + `preserve-manual-memoization`

2 locations. Drops 2.

- [ ] **`portal/src/app/(dashboard)/articles/review/page.tsx:453`**
      (`react-hooks/immutability`): `handleSelectArticleFromTable` is
      called on line 453 but declared on line 458. Wrap the function
      in `useCallback` and move the declaration above the
      `useEffect` that calls it (around line 440). Update any other
      callers as needed.
- [ ] **`portal/src/app/(dashboard)/analysis/article-requests/page.tsx:21`**
      (`react-hooks/preserve-manual-memoization`): inspect the
      `useMemo`/`useCallback` at line 21. Either align its deps to
      the React Compiler-inferred deps, or remove the manual
      memoization and let the compiler infer. If unclear, suppress
      with a named comment placed above the relevant call.
- [ ] Verify lint count: **2 → 0** (`-2`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 8 — restore rules to `error` + lock the gate

No source changes. Restores strictness so regressions break CI.

- [ ] Edit `portal/eslint.config.mjs`: change the three downgraded
      rules from `"warn"` back to `"error"`:
      - `react-hooks/set-state-in-effect`
      - `react-hooks/preserve-manual-memoization`
      - `react-hooks/immutability`
- [ ] Update the comment block above those rules: remove the
      "tracked for cleanup" pointer (or replace with "kept as error
      to prevent regression").
- [ ] Update the TanStack scope-disable block's comment to remove
      the "tracked in PLAN V03" pointer since the decision is now
      final.
- [ ] Run `npm run lint --workspace newsnexus12portal`. Confirm exit
      code 0, zero warnings.
- [ ] Verify build passes.
- [ ] Optionally add `--max-warnings=0` to the `lint` script in
      `portal/package.json` so any future warning also fails.
- [ ] Commit.
- [ ] Delete or archive the PLAN docs
      (`docs/20260522_PLAN_PORTAL_LINT*.md`) and codex assessment
      files. Project owner decides whether to delete outright or
      move to `docs/archive/`.

## When complete

- `npm run lint --workspace newsnexus12portal` exits 0, zero warnings.
- The three downgraded rules are back to `error`.
- TanStack tables remain scope-disabled by policy (documented in
  config comment).
- This TODO and the PLAN series can be archived.
