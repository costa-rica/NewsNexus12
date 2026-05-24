---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Portal lint cleanup PLAN (v02)

## Background

When Issue 3 (portal ESLint loading failure) was fixed in commit `8ec68c7`,
the lint step started running for the first time in a while and surfaced
**63 pre-existing source-level findings**: 31 errors, 32 warnings.

Triage commit `cf5f531` did the following so the gate could go green:

1. Configured `@typescript-eslint/no-unused-vars` to ignore identifiers
   prefixed with `_` (catch parameters etc.). Removed 9 spurious findings.
2. Fixed the 2 real unused-vars:
   - `useAppSelector` import in `portal/src/app/logout/page.tsx`
   - `phoneNumber` param in
     `portal/src/components/form/form-elements/InputGroup.tsx`
3. Downgraded three `react-hooks` rules from `error` → `warn` in
   `portal/eslint.config.mjs`:
   - `react-hooks/set-state-in-effect`
   - `react-hooks/preserve-manual-memoization`
   - `react-hooks/immutability`

After triage, `npm run lint --workspace newsnexus12portal` exits `0` with
**52 warnings** remaining. This document tracks those 52.

This is **v02** of the cleanup plan, revising v01 in response to a
codex assessment that flagged three problems:

- v01 said the `set-state-in-effect` fix is usually "move setState into the
  resolved branch of a fetch." That is not sufficient — the rule fires on
  any `setState` reachable from an effect body, including via `await` and
  `.then(setState)`. Mount-fetch effects need a different treatment.
- v01 said the 13 TanStack Table `incompatible-library` warnings probably
  need one shared pattern. Closer reading of the rule message shows this is
  a known React Compiler / `useReactTable` interop boundary, not 13 local
  defects. The right move is a policy decision, not a refactor.
- v01 proposed adding `npm run lint` as a required check, but with rules
  downgraded that only prevents new errors, not new warnings.

## Triage matrix for `react-hooks/set-state-in-effect` (29)

Each occurrence falls into one of four sub-patterns. The correct fix
depends on the pattern, not on a generic recipe.

### Pattern A — derived state (use `useMemo` or compute at render)

The effect reads existing state, derives a value, and stores it back with
`setState`. The "derived" value is a pure function of inputs already in
scope — it does not need to live in state at all.

**Example (verified)**: `portal/src/app/(dashboard)/admin-database/main/page.tsx:42`
extracts table keys from `tableData` via `useEffect` and stores them in
`tableKeys`. This is a render-time `useMemo` (or inline computation),
not state.

**Fix**: replace `useState` + `useEffect` with `useMemo`, or compute
inline in the render body. No effect needed.

### Pattern B — event-driven state sync

The effect's deps array contains a value that only changes from a user
event (e.g. a dropdown selection), and the effect's purpose is to react
to that event by fetching new data or updating other state.

**Example (verified)**: `portal/src/app/(dashboard)/admin-database/main/page.tsx:90`
fetches table data when `selectedTable` changes. The right home for the
fetch is the dropdown's `onChange` handler, not a `useEffect` that
mirrors it.

**Fix**: move the `setState` / fetch call into the event handler that
mutates the source state. Remove the effect.

### Pattern C — mount-time data fetching

The effect runs once on mount (deps `[]` or stable refs) and populates
component state from a remote source.

**Example (verified)**: `portal/src/app/(dashboard)/admin-database/backup/page.tsx:124`
calls `fetchBackupList()` and `fetchRowCountsByTable()` on mount; both
ultimately call `setState`.

**Fix options**, in order of preference:

1. Move data loading up to a Next.js Server Component / route loader so
   the page receives data as props. Avoids client-side effect entirely.
2. Adopt a data-fetching library (SWR or React Query). These have
   compiler-friendly hook shapes and silence the rule.
3. Keep the effect but justify with an
   `// eslint-disable-next-line react-hooks/set-state-in-effect`
   comment that names the constraint (e.g. "loaded on mount; no server
   data load path available yet").

Do **not** "fix" by inlining the setState into a then() callback — the
rule still fires.

### Pattern D — polling / subscription / signal-driven fetch

The effect subscribes to an external source (a polling interval, a
WebSocket, a parent-provided signal value) and calls `setState` from the
callback.

**Example (verified)**: `portal/src/components/automations/WorkerNodeJobStatusPanel.tsx:147`
refetches latest job when `endpointName`, `refreshSignal`, or `token`
changes — i.e. when the parent bumps a signal counter.

**Fix options**:

1. If the trigger is a parent-bumped signal, lift the fetch to the parent
   (parent calls fetch and passes the result down).
2. If it is a true polling/subscription, the `setState` happens inside an
   async callback or `setInterval` body, which the rule is allowed to
   accept under certain configurations. Verify the rule still fires; if
   so, suppress with a named comment.

## TanStack Table — policy decision, not a refactor (13)

All 13 `react-hooks/incompatible-library` warnings are at column 16 in
`portal/src/components/tables/Table*.tsx`. That column is the
`useReactTable(...)` call site. The rule fires because
`@tanstack/react-table` returns mutable references that React Compiler
cannot prove pure.

This is a known compatibility boundary between TanStack Table and React
Compiler, not 13 separate defects to fix. Trying to "refactor each table"
will produce large risky changes without improving runtime behavior.

**Decision options** (pick one with the project owner):

- **Accept**: scope-disable `react-hooks/incompatible-library` on the
  `Table*.tsx` files via a targeted ESLint `overrides` block in
  `portal/eslint.config.mjs`. Leaves the rule active everywhere else.
- **Configure the React Compiler / ESLint rule** to treat
  `useReactTable` as opaque, if the rule supports an allow-list.
- **Replace the library** — only if there is a concrete compiler or
  performance bug attributable to it, which we do not currently have
  evidence of.

Recommendation: **Accept** + scope-disable, with a comment in the config
pointing back to this doc.

Locations (all at column 16, all `useReactTable`):

- portal/src/components/tables/TableAdaptiveColumnsWithSearch.tsx:59
- portal/src/components/tables/TableAdminDatabaseMain.tsx:42
- portal/src/components/tables/TableApprovedArticles.tsx:165
- portal/src/components/tables/TableApprovedArticlesChatGpt.tsx:160
- portal/src/components/tables/TableArticleRequests.tsx:107
- portal/src/components/tables/TableDuplicateAnalysis.tsx:342
- portal/src/components/tables/TableNewsOrgsGoogleRssFeed.tsx:146
- portal/src/components/tables/TableRecentlyApprovedByUser.tsx:179
- portal/src/components/tables/TableReportWeeklyCpscStagedArticles.tsx:114
- portal/src/components/tables/TableReportsWeeklyCpsc.tsx:248
- portal/src/components/tables/TableReportsWeeklyCpscSelectableRows.tsx:102
- portal/src/components/tables/TableReviewArticles.tsx:725
- portal/src/components/tables/TableReviewStateAssigner.tsx:254

## CI gating strategy

`npm run lint --workspace newsnexus12portal` currently exits `0` with 52
warnings. Adding that command as-is to CI only protects against new
**errors** — it does nothing to stop new warnings while cleanup is in
flight.

Pick one of these gates and apply it explicitly:

- **Phase 1 (now → cleanup in progress):** add a warning-budget gate.
  Run lint with `--max-warnings=52` so any new warning fails CI but the
  current 52 are tolerated. Lower the budget number with each cleanup
  commit. When it reaches 0, drop the flag.
- **Phase 2 (after cleanup completes):** flip the downgraded rules back
  to `error` in `portal/eslint.config.mjs`, run plain
  `npm run lint --workspace newsnexus12portal` in CI.
- **Alternative:** keep `--max-warnings=0` and only ever pass when the
  count is genuinely zero. Stricter, but blocks any in-progress work.

Recommended: Phase 1 immediately. Phase 2 once each rule's category
list in this doc is empty.

## Remaining warnings, by rule

### `react-hooks/set-state-in-effect` (29) — see triage matrix above

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

When working through this list, annotate each entry with its triage
pattern (A/B/C/D) before fixing, so a reviewer can confirm the chosen
fix matches the pattern.

### `react-hooks/incompatible-library` (13) — TanStack Table policy decision

See the TanStack Table section above. Resolution is a single config
change, not 13 file edits.

### `react-hooks/exhaustive-deps` (8)

For each: either add the missing dep, wrap the dependency in
`useCallback`/`useMemo`, or add an
`eslint-disable-next-line react-hooks/exhaustive-deps` with a comment
explaining why the dep is intentionally omitted. The right answer often
depends on whether adding the dep would cause an infinite loop, which
must be tested.

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

## Cleanup process

1. **Decide the TanStack Table policy first** (one config change in
   `portal/eslint.config.mjs`). This clears 13 of 52 warnings with no
   source edits.
2. **Pick a feature area** (e.g. admin-database pages), annotate each
   `set-state-in-effect` location with pattern A/B/C/D, apply the fix
   matching the pattern, verify the affected pages still work under
   React 19 strict mode, commit per feature.
3. **Update this doc** after each cleanup commit: remove fixed locations,
   lower the `--max-warnings` budget in CI.
4. **When a rule's list is empty,** flip it back from `warn` to `error`
   in `portal/eslint.config.mjs`.

## Verification

After each cleanup pass:

```bash
npm run lint --workspace newsnexus12portal
```

Should print fewer warnings than the previous run. Once a rule's
locations are all empty, flip it from `warn` to `error` in
`portal/eslint.config.mjs` and re-run lint to confirm it stays clean.
