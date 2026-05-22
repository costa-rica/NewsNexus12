---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Portal lint cleanup TODO

Implementation checklist derived from
`docs/20260522_PLAN_PORTAL_LINT_V03.md`. Each phase is a discrete, testable
unit of work. Complete phases in order. After every phase: run lint,
confirm the warning count dropped by the expected amount, type-check the
portal, and commit referencing this file and the phase.

## Locked-in decisions

These were deferred in v03; resolve them before implementation starts.

- **TanStack Table** (`react-hooks/incompatible-library`, 13 hits): scope-
  disable the rule on `portal/src/components/tables/Table*.tsx` via an
  ESLint `overrides` block. Do not rewrite the tables.
- **Pattern C default** (`set-state-in-effect`, mount-fetch, 16 hits):
  scope-suppress with a named comment of the form
  `// eslint-disable-next-line react-hooks/set-state-in-effect -- client-side auth; pending SWR migration`.
  Server Component / route-loader migration is **out of scope** for this
  cleanup — it requires a separate auth/data-loading refactor.
- **Pattern D default** (`set-state-in-effect`, signal/polling, 4 hits):
  scope-suppress with a named comment. Only lift to parent when the
  trigger is a single parent-bumped signal AND the parent already owns
  the fetch.
- **CI gating** (deferred to Phase 8): once cleanup completes, restore
  the three downgraded rules from `warn` to `error` in
  `portal/eslint.config.mjs`. Plain `npm run lint` becomes the CI gate.
  A warning-budget gate during cleanup is optional; per-phase manual
  count checks are the primary control.

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

## Per-phase workflow

After each phase:

```bash
npm run lint --workspace newsnexus12portal           # confirm new count
npm run build --workspace newsnexus12portal          # type-check + build
```

Then check off the phase's tasks and commit. Commit message format:

```
chore(portal-lint): phase N – <short description>

Refs docs/20260522_TODO_PORTAL_LINT.md phase N.
```

For phases that change React effect behavior (Phases 2, 3, 6), also run
the dev server and load each affected page in a browser to verify no
regression:

```bash
npm run dev --workspace newsnexus12portal
```

## Phase 1 — TanStack scope-disable

Single config change. Drops 13 warnings.

- [ ] Edit `portal/eslint.config.mjs`. Add an `overrides`-style entry at
      the end of the array, scoped to `Table*.tsx`, disabling
      `react-hooks/incompatible-library`. Add a code comment pointing to
      this TODO and noting "TanStack `useReactTable` returns mutable
      refs that React Compiler cannot prove pure."
- [ ] Verify lint count: **52 → 39** (`-13`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 2 — Pattern A: derived state → useMemo

3 locations. Replace `useState + useEffect` with `useMemo` (or remove
state and compute inline). Drops 3 warnings.

- [ ] **`portal/src/app/(dashboard)/admin-database/main/page.tsx:42`** —
      `tableKeys` is computed by an effect from `tableData`. Delete the
      `useState<string[]>` for `tableKeys` and the effect on line 38–43.
      Replace usages with
      `const tableKeys = useMemo(() => tableData.length === 0 ? [] : Object.keys(tableData[0]).filter(k => k !== "id"), [tableData]);`
- [ ] **`portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:205`** —
      effect clamps `currentPage` to `totalPages`. Remove the effect.
      Replace `currentPage` usages with a derived
      `const safeCurrentPage = Math.min(currentPage, totalPages);`
      where the value is read. Keep `setCurrentPage` for direct setters.
- [ ] **`portal/src/app/(dashboard)/articles/review/page.tsx:97`** —
      `hasFilterChanges` is computed by comparing current filters to
      `initialFiltersRef`. Delete `useState` for `hasFilterChanges`,
      replace with a `useMemo` returning the same boolean comparison.
      Audit any consumer that calls `setHasFilterChanges(false)`
      explicitly — they need to either reset the ref or be removed.
- [ ] Run dev server, manually verify: admin-database/main loads and
      switches tables; ai-approver-prompts paginates correctly;
      articles/review filter UI lights up correctly when filters
      change.
- [ ] Verify lint count: **39 → 36** (`-3`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 3 — Pattern B: event-driven → handler or prop

6 locations. Move the `setState`/fetch into the event/prop handler that
mutates the source, or restructure to avoid the mirror pattern. Drops 6.

- [ ] **`portal/src/app/(dashboard)/admin-database/main/page.tsx:90`** —
      effect fetches when `selectedTable` changes. Move
      `fetchTableData(selectedTable)` into the dropdown's `onChange`
      (search for `setSelectedTable` and call the fetch after it).
      Remove the effect. Keep an initial fetch for the default table by
      calling `fetchTableData(initialTable)` once in a Pattern-C-style
      mount effect with scope suppression — or skip if the page can
      render empty until first selection.
- [ ] **`portal/src/app/(dashboard)/analysis/article-requests/page.tsx:66`** —
      effect refetches when `dateRequestsLimit` changes. Move the
      refetch into the date-limit input's change handler. Keep mount
      fetch as Pattern C if needed.
- [ ] **`portal/src/app/(dashboard)/articles/automations/ai-approver-prompts/page.tsx:201`** —
      effect resets `currentPage` to 1 when `showActiveOnly` or
      `pageSize` change. Move the `setCurrentPage(1)` into the
      respective change handlers (`onChange` of the "active only"
      toggle and the page size selector). Remove the effect.
- [ ] **`portal/src/components/form/MultiSelect.tsx:30`** — prop-mirror
      anti-pattern (`useEffect` setting state from `defaultSelected`).
      Cleanest fix: remove the internal `selectedOptions` mirror and
      lift selection to the parent (controlled component). If that is
      out of scope, add scope suppression with comment
      `react-hooks/set-state-in-effect -- controlled-uncontrolled bridge; see PLAN V03 Pattern B`.
- [ ] **`portal/src/components/ui/modal/ModalAiApproverDetails.tsx:123`** —
      effect fetches details when `articleId`/`token` change. This is
      legitimately event-driven (modal opens with a new articleId).
      Restructure: parent should pass already-fetched details in, OR
      this stays as scope-suppressed Pattern C-style. Suppress with
      comment `react-hooks/set-state-in-effect -- modal data load on articleId change; pending SWR migration`.
- [ ] **`portal/src/components/ui/modal/ModalAiApproverDetails.tsx:168`** —
      effect resets `humanApprovalValue` and `reasonHumanRejected` when
      `topEligibleScore` changes. Restructure to compute initial values
      from `topEligibleScore` in a `useMemo` and use `key` reset on the
      form section instead, OR suppress with comment.
- [ ] Run dev server, manually verify: admin-database/main dropdown
      still refetches; analysis/article-requests date filter still
      works; ai-approver-prompts pagination resets correctly;
      multi-select still updates from parent; AI Approver modal still
      loads + resets fields when reopened on a different article.
- [ ] Verify lint count: **36 → 30** (`-6`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 4 — Pattern C: mount-fetch scope-suppress

16 locations. Each gets a single comment line added above the offending
`useEffect`. Drops 16. No behavior changes.

For each task below, insert the line directly above the `useEffect(` at
the listed line number:

```
// eslint-disable-next-line react-hooks/set-state-in-effect -- client-side auth mount fetch; pending SWR migration
```

(Adjust trailing reason if the page has a more specific constraint, but
the default reason above is correct for most.)

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
- [ ] `portal/src/components/ui/modal/ModalReviewArticleContent.tsx:197`
- [ ] `portal/src/components/user-settings/WebBrowserExtensionsSection.tsx:44`
- [ ] Verify lint count: **30 → 14** (`-16`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 5 — Pattern D: signal/polling scope-suppress

4 locations. Same comment pattern as Phase 4, but with a different
reason naming the polling/signal nature. Drops 4.

Insert above each `useEffect`:

```
// eslint-disable-next-line react-hooks/set-state-in-effect -- signal/polling fetch; rule cannot statically verify
```

- [ ] `portal/src/components/automations/OrchestratorSection.tsx:244`
      (refetch past runs when active run finishes)
- [ ] `portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:147`
      (parent `refreshSignal` triggers refetch)
- [ ] `portal/src/components/automations/WorkerPythonJobStatusPanel.tsx:155`
      (parent `refreshSignal` triggers refetch)
- [ ] `portal/src/components/ui/modal/ModalReviewArticleContent.tsx:325`
      (`setInterval` polling for queued job status)
- [ ] Verify lint count: **14 → 10** (`-4`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 6 — `react-hooks/exhaustive-deps`

8 locations. Per-location action below. Drops 8.

- [ ] **`portal/src/components/automations/OrchestratorSection.tsx:208`** —
      `useCallback` for `fetchActiveRun` is missing `authHeaders` in
      deps. Either add `authHeaders` to deps, OR move the
      `authHeaders` computation inside the callback. Verify no
      infinite-loop side effect.
- [ ] **`portal/src/components/automations/OrchestratorSection.tsx:224`** —
      same pattern as above for `fetchPastRuns`. Apply the same fix.
- [ ] **`portal/src/components/automations/OrchestratorSection.tsx:246`** —
      effect deps are `[activeRun?.status]` but body uses
      `activeRun` and `fetchPastRuns`. Add both to deps; check if the
      effect now fires too often (if so, suppress with a named
      comment).
- [ ] **`portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:148`** —
      effect calls `fetchLatestJob` but the deps array does not
      include it. Either add it, OR wrap `fetchLatestJob` in
      `useCallback` and add that, OR keep as-is and suppress.
- [ ] **`portal/src/components/automations/WorkerPythonJobStatusPanel.tsx:156`** —
      same pattern as above.
- [ ] **`portal/src/components/tables/TableReviewArticles.tsx:708`** —
      `useMemo` deps list at line 708 is probably missing one of the
      handlers it references. Inspect and add. If adding causes
      excessive recomputes, wrap handlers in `useCallback`.
- [ ] **`portal/src/components/tables/TableReviewStateAssigner.tsx:251`** —
      same pattern; columns `useMemo` deps may be missing.
- [ ] **`portal/src/components/ui/modal/ModalAiApproverDetails.tsx:124`** —
      effect deps `[articleId, token]` but body calls `fetchDetails`.
      Either add `fetchDetails` (and wrap it in `useCallback`), OR
      suppress.
- [ ] Run dev server, manually verify each affected page still
      behaves: no infinite request loops in the network tab, no
      visible UI regressions.
- [ ] Verify lint count: **10 → 2** (`-8`).
- [ ] Verify build passes.
- [ ] Commit.

## Phase 7 — `immutability` + `preserve-manual-memoization`

2 locations. Drops 2.

- [ ] **`portal/src/app/(dashboard)/articles/review/page.tsx:453`**
      (`react-hooks/immutability`): `handleSelectArticleFromTable` is
      called on line 453 but declared on line 458. Wrap the function
      in `useCallback` and move its declaration above the
      `useEffect` that calls it (around line 440). Update any other
      callers as needed.
- [ ] **`portal/src/app/(dashboard)/analysis/article-requests/page.tsx:21`**
      (`react-hooks/preserve-manual-memoization`): inspect the
      `useMemo`/`useCallback` at line 21. Either align its deps to
      the React Compiler-inferred deps, or remove the manual
      memoization and let the compiler infer. If unclear, suppress
      with a named comment referencing this TODO.
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
- [ ] Update the comment above those rules: remove the "tracked for
      cleanup" pointer (or update it to say "kept as error to
      prevent regression").
- [ ] Run `npm run lint --workspace newsnexus12portal`. Confirm exit
      code 0, zero warnings.
- [ ] Verify build passes.
- [ ] Optionally add `--max-warnings=0` to the `lint` script in
      `portal/package.json` so future warnings also fail.
- [ ] Move the TanStack scope-disable comment in `eslint.config.mjs`
      from "tracked in PLAN V03" to a permanent reason since the
      decision is final.
- [ ] Commit.
- [ ] Delete or archive `docs/20260522_PLAN_PORTAL_LINT.md`,
      `docs/20260522_PLAN_PORTAL_LINT_V02.md`,
      `docs/20260522_PLAN_PORTAL_LINT_V03.md`, and the codex
      assessment files. They are historical at this point. Project
      owner decides whether to delete or move to `docs/archive/`.

## When complete

- `npm run lint --workspace newsnexus12portal` exits 0 with 0 warnings.
- All three downgraded rules are back to `error`.
- TanStack tables remain scope-disabled by policy (documented).
- This TODO can be deleted or archived.
