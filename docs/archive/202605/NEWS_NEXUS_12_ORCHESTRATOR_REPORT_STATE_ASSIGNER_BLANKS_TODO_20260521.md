---
created_at: 2026-05-21
updated_at: 2026-05-21
created_by: claude (opus-4.7)
modified_by: codex (gpt-5.5)
---

# News Nexus 12 Orchestrator Report State Assigner Blanks TODO

Implementation checklist for the orchestrator-report `AI Assigned State` null-state fix.

Source issue: [20260521_FIX_ORCHESTRATOR_REPORT_AI_STATE_ASSIGNER_BLANKS.md](20260521_FIX_ORCHESTRATOR_REPORT_AI_STATE_ASSIGNER_BLANKS.md)

Source plan (final, agreed): [20260521_PLAN_FIX_ORCHESTRATOR_REPORT_AI_STATE_ASSIGNER_BLANKS_V02.md](20260521_PLAN_FIX_ORCHESTRATOR_REPORT_AI_STATE_ASSIGNER_BLANKS_V02.md)

Read both before starting. This TODO is the execution checklist, not the design — when this checklist and the plan diverge, the plan wins.

## Goal

Fix `getArticleRows` in `worker-node/src/modules/orchestrator/reportWriter.ts` so the `Articles` sheet of the weekly orchestrator xlsx shows `No state` (instead of blank) when the latest `ArticleStateContracts02` row for an article has `stateId = NULL`. Behavior for articles with a valid `stateId` or with no assignment row at all is unchanged.

Scope is intentionally narrow:

- One SQL string substitution in `getArticleRows` (inner `JOIN "States"` → `LEFT JOIN "States"` + `CASE` over `stateId IS NULL`).
- Three workbook-row tests + one **mandatory** SQL-text regression guard in `worker-node/tests/modules/orchestrator/reportWriter.test.ts`.
- No schema change, no new column, no new export, no DI seam, no AI Approver changes.

## Per-phase workflow

Per [TODO_LIST_GUIDANCE.md](TODO_LIST_GUIDANCE.md), after each phase:

1. `cd worker-node && npx tsc -p tsconfig.json --noEmit` — must pass.
2. `cd worker-node && npm test -- tests/modules/orchestrator/reportWriter.test.ts` — must pass.
3. `cd worker-node && npm test` — must pass (full suite stays green).
4. Check off the phase's completed tasks in this file.
5. Commit. Title format from the plan: `fix: orchestrator report no-state article cell`. Body should reference this file and the phase committed, with a final `co-authored-by: codex (gpt-5.5)` line (or the implementing agent's actual identifier) per `AGENTS.md` → "Commit Message Guidance".

Do not start a later phase before the earlier phase is committed.

## Out of scope (do NOT do as part of this TODO)

These are explicitly excluded by the V02 plan. If implementation pressure tempts the agent toward any of them, STOP and surface the issue rather than expanding scope.

- Editing `worker-python/src/modules/ai_approver/repository.py`. The blank `AI Approver Score` for null-state articles is **correct** per the issue's "AI Approver Score Note" section.
- Editing `api/src/modules/queriesSql.ts` or `portal/src/components/tables/TableReviewArticles.tsx`. Both already render the null-state case correctly.
- Adding a new "AI Approver Status" or "AI Approver Skipped Reason" column to the Articles sheet. The issue lists this as optional; defer until explicitly requested.
- Changing `ArticleReportRow` typing. `aiAssignedState` stays `string | null`.
- Changing the `articlesSheet.columns` definitions or the `addRow` call.
- Renaming the `s.name AS "aiAssignedState"` projection or the lateral alias (`s`) or inner table aliases (`asc2`, `st`).
- Adding a real-database round-trip test for `getArticleRows`. The worker-node tests mock the DB boundary on purpose; see `worker-node/AGENTS.md` → "Testing guidance" and the existing `mockSequelizeQuery` pattern in `reportWriter.test.ts`.
- Adding a new export from `reportWriter.ts` (or a DI seam) just to make `getArticleRows` testable. The SQL-text regression guard reads the SQL via the existing `mockSequelizeQuery.mock.calls`; no new export is required.
- Broader refactors of `reportWriter.ts` (formatting, helper extraction, etc.) bundled with this fix.

---

## Phase 1 — SQL fix in `getArticleRows`

Scope: one SQL string change in `worker-node/src/modules/orchestrator/reportWriter.ts`. No other files in this phase.

### 1.1 Replace the state-assignment lateral subquery

- [x] Open `worker-node/src/modules/orchestrator/reportWriter.ts`. Locate the `getArticleRows` helper (the `const getArticleRows = async (...) => { ... }` block starting around line 34) and within it the second `LEFT JOIN LATERAL (...) s ON true` block (the one currently at roughly lines 58–63).
- [x] Replace **exactly** this block:
  ```sql
  LEFT JOIN LATERAL (
    SELECT st.name FROM "ArticleStateContracts02" asc2
    JOIN "States" st ON st.id = asc2."stateId"
    WHERE asc2."articleId" = a.id
    ORDER BY asc2.id DESC LIMIT 1
  ) s ON true
  ```
  with **exactly** this block:
  ```sql
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN asc2."stateId" IS NULL THEN 'No state'
        ELSE st.name
      END AS name
    FROM "ArticleStateContracts02" asc2
    LEFT JOIN "States" st ON st.id = asc2."stateId"
    WHERE asc2."articleId" = a.id
    ORDER BY asc2.id DESC LIMIT 1
  ) s ON true
  ```

### 1.2 Things that MUST NOT change in this edit

- [x] The outer `s.name AS "aiAssignedState"` projection at the top of the `SELECT` list stays exactly as-is — same alias, no rename, no new column.
- [x] The lateral alias remains `s`; inner aliases remain `asc2` and `st`.
- [x] The surrounding lateral blocks for `ac` (scrape status), `aas` (AI Approver score), and `gk` (gatekeeper) stay byte-for-byte unchanged.
- [x] The `replacements: { minExclusive, maxInclusive }` and `raw: true` options on `sequelize.query` stay byte-for-byte unchanged.
- [x] The `ArticleReportRow` interface (declared above `getArticleRows`) stays unchanged — `aiAssignedState: string | null` is correct because the no-assignment-row case still returns `null`.
- [x] The `articlesSheet.columns` definitions inside `writeReport` (the four-position `AI Assigned State` column) and the `articlesSheet.addRow(row)` call stay unchanged.

### 1.3 Phase exit

- [x] `cd worker-node && npx tsc -p tsconfig.json --noEmit` passes.
- [ ] `cd worker-node && npm test` passes (blocked in this environment before suites run: Postgres role `nick` does not exist during Jest global setup).
- [x] Commit. Suggested title: `fix: orchestrator report no-state article cell`. Body should call out the lateral-join `JOIN` → `LEFT JOIN` change, the new `CASE`/`'No state'` sentinel, and reference this file (Phase 1).

---

## Phase 2 — Tests for `Articles` sheet state column + mandatory SQL regression guard

Scope: extend `worker-node/tests/modules/orchestrator/reportWriter.test.ts` with three workbook-row cases **and** one mandatory SQL-text regression guard. No production-code changes in this phase.

### 2.0 Read the existing test file first

- [x] Open `worker-node/tests/modules/orchestrator/reportWriter.test.ts` and skim the existing helpers (`mockSequelizeQuery`, `makeRun`, `makeStep`, `readWorkbook`, `getHeaderValues`) and `beforeEach`/`afterEach`. The new tests must follow the same mock + workbook-readback pattern (see `worker-node/AGENTS.md` → "Testing guidance").
- [x] Confirm that `writeReport` is the public entry point exercised in the existing suite (not `writeOrchestratorReport` — the V02 plan mentions both names; the actual export is `writeReport`).
- [x] Confirm that `mockSequelizeQuery` is shared across all tests in the file via the file-level `jest.mock('@newsnexus/db-models', ...)` and that `beforeEach` resets it with `mockSequelizeQuery.mockResolvedValue([[], null])`.

### 2.1 Trigger the article branch in tests

The default `makeRun()` returns `articleIdMinExclusive: 0` and `articleIdMaxInclusive: 0`, which causes `writeReport` to skip the Articles sheet (the guard is `run.articleIdMinExclusive !== null && run.articleIdMaxInclusive !== null` — both are non-null, but the `getArticleRows` call only fires meaningfully when the range is non-empty, and the article rows come from `mockSequelizeQuery` regardless). To make the article branch fire and to make the test's intent unambiguous, override the range explicitly in each new case:

- [x] In each new test, build the run with `{ ...makeRun(), articleIdMinExclusive: 0, articleIdMaxInclusive: 100 }`.
- [x] Pair the run with a `makeStep({ stepName: 'state_assigner', stepOrder: 3, result: null })` (or any non-`google_rss` step name) so the Google RSS Queries sheet logic is bypassed and only the Articles sheet logic runs.
- [x] For each test, queue the article-row mock with `mockSequelizeQuery.mockResolvedValueOnce([[ <row> ], null])` **before** calling `writeReport(...)`. Use `mockResolvedValueOnce` (not `mockResolvedValue`) so only the article query in this test is affected; the default empty-array `mockResolvedValue` from `beforeEach` still covers any other `sequelize.query` calls.

### 2.2 Add a new `describe` block for the article-state column

- [x] Add a new top-level `describe('reportWriter articles sheet state column', () => { ... })` block to the file (do not modify the existing `describe('reportWriter google rss query sheet', ...)` block). Re-use the same `beforeEach`/`afterEach` shape (temp dir, env var save/restore, `mockSequelizeQuery.mockReset()`).

### 2.3 Workbook-row case 1 — valid state

- [x] Add an `it('renders the state name when the latest assignment has a non-null stateId', async () => { ... })` test.
- [x] Inside, queue the article-row mock with:
  ```ts
  mockSequelizeQuery.mockResolvedValueOnce([
    [
      {
        articleId: 1,
        title: 't',
        scrapeStatus: 'completed',
        aiAssignedState: 'California',
        aiApproverScore: null,
        aiGatekeeperDecision: null,
        aiGatekeeperConfidence: null,
        aiGatekeeperReasonCode: null,
        semanticRating: null,
      },
    ],
    null,
  ]);
  ```
- [x] Call `writeReport({ ...makeRun(), articleIdMinExclusive: 0, articleIdMaxInclusive: 100 }, [makeStep({ stepName: 'state_assigner', stepOrder: 3, result: null })])`.
- [x] Read the workbook back with `readWorkbook(reportPath!)` and `workbook.getWorksheet('Articles')`.
- [x] Assert `sheet.getRow(2).getCell(4).value === 'California'`. (Column 4 is the `AI Assigned State` column per the `articlesSheet.columns` definition in `reportWriter.ts`.)

### 2.4 Workbook-row case 2 — null-state assignment row

- [x] Add an `it('renders "No state" when the latest assignment has stateId = NULL', async () => { ... })` test.
- [x] Same scaffolding as case 1, but with `aiAssignedState: 'No state'` in the mocked row (this is the value the fixed SQL will return in production for null-state rows).
- [x] Assert `sheet.getRow(2).getCell(4).value === 'No state'`.
- [x] This case documents the **expected rendered output** for the bug in the issue. By itself it does not prove the SQL was fixed (the mock dictates the rendered string); the SQL proof lives in §2.6.

### 2.5 Workbook-row case 3 — no assignment row at all

- [x] Add an `it('leaves the AI Assigned State cell empty when no assignment row exists', async () => { ... })` test.
- [x] Same scaffolding, but with `aiAssignedState: null` in the mocked row.
- [x] Assert the cell value is empty in the way ExcelJS represents missing string cells. Concrete assertion: `expect(sheet.getRow(2).getCell(4).value == null).toBe(true)` (covers both `null` and `undefined`). If a local convention in the existing tests uses a different check for empty cells, prefer that convention.

### 2.6 MANDATORY SQL-text regression guard

This is the primary regression guard for the bug. **Required, not optional.** Per the V02 plan revision notes, the workbook-row cases above only verify ExcelJS rendering of values that the mock pre-baked; they cannot detect whether the production SQL was actually fixed. Without this test, a future refactor could silently revert §1.1 and the suite would still pass.

- [x] Add an `it('emits a null-state-preserving lateral subquery for the article state', async () => { ... })` test.
- [x] Queue the article-row mock with any non-empty row (re-use the case 1 mock; the assertion is on the SQL string, not the returned data).
- [x] Call `writeReport({ ...makeRun(), articleIdMinExclusive: 0, articleIdMaxInclusive: 100 }, [makeStep({ stepName: 'state_assigner', stepOrder: 3, result: null })])`.
- [x] After the call, locate the article-query call inside `mockSequelizeQuery.mock.calls`. The article SQL is identifiable by containing `"ArticleStateContracts02"` in its first argument:
  ```ts
  const articleCall = mockSequelizeQuery.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].includes('"ArticleStateContracts02"')
  );
  expect(articleCall).toBeDefined();
  const sql = articleCall![0] as string;
  ```
- [x] Assert **all** of the following positive substring matches on `sql` (use `toContain` / `expect.stringContaining`; if whitespace varies, collapse runs of whitespace via `sql.replace(/\s+/g, ' ')` before matching, but only if needed — the replacement string in §1.1 is fixed so direct `toContain` should work):
  - [x] `expect(sql).toContain('LEFT JOIN LATERAL')` — proves the lateral subquery structure is preserved.
  - [x] `expect(sql).toContain('LEFT JOIN "States"')` — proves the inner `JOIN "States"` was converted to a `LEFT JOIN` so null-`stateId` rows survive the lateral.
  - [x] `expect(sql).toContain('asc2."stateId" IS NULL')` — proves the null check is present.
  - [x] `expect(sql).toContain(`'No state'`)` — proves the sentinel literal is present. Note the literal must include the SQL single quotes (`'No state'`); in JS source use either backtick template-literal escaping or `expect(sql).toContain("'No state'")` with double-quoted JS string.
- [x] Assert the **negative guard** — no bare inner `JOIN "States"` reintroduced. The cleanest form mirrors the V02 plan:
  ```ts
  expect(sql).not.toMatch(/(?<!LEFT\s)JOIN\s+"States"/i);
  ```
  Rationale: matches `JOIN "States"` only when **not** immediately preceded by `LEFT `. If the existing test file already normalizes whitespace before SQL comparison, reuse that helper; otherwise apply the regex directly to `sql`.
- [x] Do **not** add equality-style assertions (`expect(sql).toEqual(...)` or snapshot tests on the full SQL string). Those are too brittle and will fail on benign whitespace or formatting changes elsewhere in the query.

### 2.7 Phase exit

- [x] `cd worker-node && npx tsc -p tsconfig.json --noEmit` passes.
- [x] `cd worker-node && npm test -- tests/modules/orchestrator/reportWriter.test.ts` passes — all three workbook-row cases AND the SQL-text regression guard. (Verified with `npx jest --runInBand tests/modules/orchestrator/reportWriter.test.ts --globalSetup=` because the default global setup is blocked by missing Postgres role `nick`.)
- [ ] `cd worker-node && npm test` passes (blocked in this environment before suites run: Postgres role `nick` does not exist during Jest global setup).
- [x] Sanity check the negative guard: temporarily revert the §1.1 SQL change locally (do **not** commit the revert), re-run the targeted test file, and confirm the SQL-text regression guard fails loudly while the workbook-row cases would still pass on their own. Then restore the §1.1 change. This is a one-shot verification of the regression guard's discriminating power; the revert must not be committed.
- [x] Commit. Suggested title: `test: orchestrator report state column regression guard` (or fold into the Phase 1 commit's body if both phases are committed together — see "Single-commit option" below). Body should reference this file (Phase 2) and call out the SQL-text regression guard explicitly.

### 2.8 Single-commit option

Per the V02 plan's "Commit Guidance" section, this fix may ship as a single commit titled `fix: orchestrator report no-state article cell` with both the SQL change (Phase 1) and the test additions (Phase 2) in one body. If choosing this option, run the Phase 1 verification steps (§1.3) and the Phase 2 verification steps (§2.7) before committing, and reference both phases in the commit body. Either single-commit or two-commit is acceptable; pick whichever produces the cleaner history given any rebasing the implementer is already doing.

---

## Done criteria

Mirrors the V02 plan's Acceptance Criteria, with explicit pointers to the verification mechanism for each:

- [x] Articles with an `ArticleStateContracts02` row and `stateId = NULL` show `No state` in the orchestrator Excel report `Articles` sheet. (Covered by §2.4 workbook-row case 2 **and** §2.6 SQL-text regression guard.)
- [x] Articles with a valid `stateId` continue to show the state name. (Covered by §2.3 workbook-row case 1.)
- [x] Articles with no `ArticleStateContracts02` row continue to show a blank `AI Assigned State`. (Covered by §2.5 workbook-row case 3.)
- [x] Existing `AI Approver Score` behavior remains unchanged. (No changes to `worker-python` or to the Articles sheet column list; verified by diff inspection — runtime edits are limited to `worker-node/src/modules/orchestrator/reportWriter.ts`, with tests and this TODO updated.)
- [x] Report-writer tests cover the `stateId = NULL` assignment case AND include the mandatory SQL-text regression guard for the lateral subquery shape. (Covered by §2.3–§2.6.)
- [ ] `npx tsc -p tsconfig.json --noEmit` and full `npm test` are green in `worker-node/`. (`tsc` is green; full `npm test` is blocked by missing Postgres role `nick` during Jest global setup.)
- [x] All phase commits reference this file by name and append `co-authored-by: <agent> (<model>)` per `AGENTS.md` → "Commit Message Guidance".

## Risks to watch during implementation

Carried forward from the V02 plan's "Risks" section — surface to Nick before committing if any of these turn out to apply:

- A `States` row with the literal name `'No state'` exists in production data, making the new sentinel ambiguous. The `States` table is curated (US states + territories), so collision is not expected. Out of scope for this TODO to verify against the live DB, but if the implementer happens to have prod read access, a quick `SELECT id, name FROM "States" WHERE name = 'No state'` before merge is a good gut-check.
- The SQL-text assertion in §2.6 is sensitive to whitespace style. The §1.1 replacement string is fixed and matches the matcher substrings literally, so this should not bite — but if any future formatter (Prettier, etc.) is wired into the worker-node SQL, the guard may need a whitespace-collapsing helper.
- The "latest-assignment shift" behavior change: when the latest `ArticleStateContracts02` row has `stateId = NULL` but an *older* row had a valid `stateId`, the cell now shows `'No state'` instead of falling back to the older row's state name. This is intentional and matches portal review-page semantics. No new code reads `aiAssignedState` from the xlsx — the column is consumed visually only — so no downstream code changes are needed.
