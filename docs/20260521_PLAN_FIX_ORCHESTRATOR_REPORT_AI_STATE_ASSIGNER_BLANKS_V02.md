---
created_at: 2026-05-21
updated_at: 2026-05-21
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Plan: Fix Orchestrator Report `AI Assigned State` Blanks For Null-State Assignments (V02)

## Revision Notes

Revision history relative to `20260521_PLAN_FIX_ORCHESTRATOR_REPORT_AI_STATE_ASSIGNER_BLANKS.md`:

- Codex assessment flagged (moderate severity) that the SQL-text assertion in the Test Plan was listed as "Optional but recommended." Because the workbook-row tests only exercise the mocked return value of `sequelize.query` (not the actual SQL the implementation emits), the original null-state test could still pass against the buggy inner-join SQL. That defeats the purpose of the regression test.
- V02 promotes the SQL-text assertion to a **required** test, with explicit expectations for both the `LEFT JOIN "States"` shape and the `'No state'` sentinel. The workbook-row cases remain, but are now framed as output-shape checks layered on top of the SQL regression guard.
- No other findings in the Codex assessment required changes. The Files To Change, Risks, Rollback, and Acceptance Criteria sections are carried forward, with minor edits to keep them consistent with the new mandatory test.

## Source Issue

Implementation must address every requirement in `docs/20260521_FIX_ORCHESTRATOR_REPORT_AI_STATE_ASSIGNER_BLANKS.md`. Read that issue first; this plan is intentionally narrow and inherits the same acceptance criteria.

## Difficulty and Safety Risk

- Difficulty: very low
- Safety risk of breaking existing functionality: very low
- Rationale:
  - The change is confined to a single SQL string inside one helper (`getArticleRows`) in `worker-node/src/modules/orchestrator/reportWriter.ts`. No new modules, routes, queue behavior, env vars, or DB schema changes are required.
  - The change converts an inner `JOIN "States"` to a `LEFT JOIN "States"` inside an already-`LEFT JOIN LATERAL` subquery and adds a `CASE` that emits the literal `'No state'` when `stateId IS NULL`. Articles with a valid `stateId` still resolve via the same `States` row, so the value for those rows is unchanged. Articles with no `ArticleStateContracts02` row continue to return no inner lateral row at all, so `aiAssignedState` stays `NULL` (blank) for them.
  - The `aiAssignedState` field is consumed only as a display string in `articlesSheet.addRow(row)`. ExcelJS will render the new sentinel `'No state'` identically to any other string, so downstream report consumers do not need to change.
  - One narrow behavior change is worth flagging explicitly: when the *latest* `ArticleStateContracts02` row has `stateId = NULL` but an *older* row had a valid `stateId`, the cell will now show `'No state'` instead of falling back to the older row's state name. This matches the review-page semantics described in the issue (`portal/src/components/tables/TableReviewArticles.tsx` renders `No state` for the latest assignment when its `stateName` is empty). This is the intended correction, not a regression.
  - The test surface is small and well-scoped: the existing report-writer test file already mocks `sequelize.query`, so the new tests only add an extra row shape plus one SQL-text capture — no integration plumbing or DB fixtures.

Implementation may proceed without pausing for Nick.

## Files To Change

1. `worker-node/src/modules/orchestrator/reportWriter.ts` — fix the lateral-join SQL inside `getArticleRows`.
2. `worker-node/tests/modules/orchestrator/reportWriter.test.ts` — add coverage for the three article-state cases (valid state, `stateId = NULL`, no assignment row at all) **and** the mandatory SQL-text regression guard.

Out of scope (do not touch in this change):

- `worker-python/src/modules/ai_approver/repository.py` — the `AI Approver Score` blank for null-state articles is correct per the issue ("Note" section); do not modify the AI Approver eligibility query.
- `api/src/modules/queriesSql.ts` and `portal/src/components/tables/TableReviewArticles.tsx` — already handle this case correctly; leave alone.
- No new "AI Approver Status" / "AI Approver Skipped Reason" column. The issue lists this as optional; defer until explicitly requested.

## Exact Change To `getArticleRows`

In `worker-node/src/modules/orchestrator/reportWriter.ts`, replace the existing state-assignment lateral subquery (currently lines 58–63) with the form below. Only the inner `s` lateral block changes; all surrounding SQL, parameters, types, and the `ArticleReportRow.aiAssignedState: string | null` field stay as-is.

Replace:

```sql
LEFT JOIN LATERAL (
  SELECT st.name FROM "ArticleStateContracts02" asc2
  JOIN "States" st ON st.id = asc2."stateId"
  WHERE asc2."articleId" = a.id
  ORDER BY asc2.id DESC LIMIT 1
) s ON true
```

With:

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

Notes for the implementer:

- Preserve the outer `s.name AS "aiAssignedState"` projection at the top of the SELECT — no rename, no new column.
- Keep the lateral alias as `s` and the inner table aliases as `asc2` and `st` to minimize the diff.
- Do not change `ArticleReportRow` (the field stays typed as `string | null` because the no-assignment case still returns `null`).
- Do not change the `articlesSheet.columns` definitions or the `addRow` call.

## Test Plan

Update `worker-node/tests/modules/orchestrator/reportWriter.test.ts` to cover the article sheet's state column **and** the SQL emitted by `getArticleRows`. The file already mocks `sequelize.query` (`mockSequelizeQuery`) and reads the workbook back with ExcelJS, so the new tests should follow the same pattern.

Add a new `describe('reportWriter articles sheet state column', () => { ... })` block, or extend the existing test file with the four required cases below. Each workbook case constructs `OrchestratorRunRow` with `articleIdMinExclusive`/`articleIdMaxInclusive` set to a non-zero range so `includeArticles` triggers the article query.

### Required workbook-row cases

1. **Valid state** — `mockSequelizeQuery.mockResolvedValueOnce([[{ articleId: 1, title: 't', scrapeStatus: 'completed', aiAssignedState: 'California', aiApproverScore: null, aiGatekeeperDecision: null, aiGatekeeperConfidence: null, aiGatekeeperReasonCode: null, semanticRating: null }], null])`. Expect the `Articles` sheet row's `AI Assigned State` cell to be `'California'`.
2. **Null-state assignment row** — `aiAssignedState: 'No state'`. Expect the cell to read `'No state'`. This documents the expected rendered output for the bug in the issue.
3. **No assignment row at all** — `aiAssignedState: null`. Expect the cell to be empty (ExcelJS represents this as `null`/empty).

Each workbook case should:

- Use `makeRun()` but override `articleIdMinExclusive: 0, articleIdMaxInclusive: 100` so the articles branch fires.
- Use `makeStep()` with `stepName: 'state_assigner'` (or whichever non-google step name avoids triggering the queryResults branch) and `result: null`.
- Read the workbook back with the existing `readWorkbook` helper, locate the `'Articles'` worksheet, and assert on `sheet.getRow(2).getCell(<aiAssignedStateColumnIndex>).value`. The `AI Assigned State` column is the fourth column per the `articlesSheet.columns` definition.

### Required SQL-text regression guard (mandatory)

This test is **required**, not optional. Without it, the three workbook-row cases above only verify ExcelJS rendering of values that the mock has already pre-baked; they cannot detect whether the production query was actually fixed. Per the Codex assessment, this is the primary regression guard for the bug.

4. **SQL emitted by `getArticleRows` matches the null-state-preserving shape** —
   - Set up the same article-branch fixtures as case 1 (any non-empty mock row is fine; the assertion is on the SQL string, not the returned data).
   - After `writeOrchestratorReport` (or whichever entry point exercises `getArticleRows`) is invoked, locate the `mockSequelizeQuery` call that corresponds to the article query. If the file already filters calls by SQL signature (for example by matching on `FROM "Articles"` or `"ArticleStateContracts02"`), reuse that pattern; otherwise inspect `mockSequelizeQuery.mock.calls` and pick the call whose first argument contains `"ArticleStateContracts02"`.
   - Assert that the captured SQL string contains **all** of the following substrings (using `toContain` / `expect.stringContaining` style matchers, whitespace-tolerant — collapse runs of whitespace before comparing if needed):
     - `LEFT JOIN "States"` (proves the inner `JOIN` was converted to a `LEFT JOIN` so null-`stateId` rows survive the lateral).
     - `asc2."stateId" IS NULL` (proves the null check is present).
     - `'No state'` (proves the sentinel literal is present).
     - `LEFT JOIN LATERAL` (proves the lateral subquery structure is preserved).
   - Also assert the SQL does **not** contain a bare `JOIN "States"` pattern that is unqualified by `LEFT` (negative guard against a partial revert). One acceptable form: `expect(sql).not.toMatch(/(?<!LEFT\s)JOIN\s+"States"/i);` — adjust to whatever regex style the existing test file uses.

   Rationale: this is the only test that fails loudly if a future refactor reintroduces the inner-join bug. The workbook-row cases would silently pass because their behavior is dictated by the mocked return value, not by the real SQL.

Do not add a real database round-trip test. The repo's worker-node tests intentionally mock the DB boundary (see `worker-node/AGENTS.md` → "Testing guidance" and the existing mock pattern in this file).

## Verification Commands

Run from the `worker-node/` directory after editing:

```bash
cd worker-node
npx tsc -p tsconfig.json --noEmit
npm test -- tests/modules/orchestrator/reportWriter.test.ts
npm test
```

Expected outcomes:

- `tsc --noEmit` passes (no type changes were made, so this is regression-only).
- The targeted `reportWriter.test.ts` run passes, including the new state-column cases **and** the mandatory SQL-text regression guard.
- Full `npm test` remains green; no other suite touches `aiAssignedState` projection logic, so no cascading edits should be needed.

A manual end-to-end re-verification against the live Postgres database (re-running an orchestrator pass and inspecting the produced `.xlsx`) is optional and may be performed by Nick after merge — it is not required by this plan because the change is purely a string substitution in one query.

## Risks

- Risk: a `States` row with the literal name `'No state'` exists in production data, which would make the new sentinel ambiguous in the report.
  - Mitigation: a quick `SELECT id, name FROM "States" WHERE name = 'No state'` against the prod DB before merge is sufficient. The `States` table is curated (US states + territories), so this collision is not expected, but worth confirming.
- Risk: a future refactor inadvertently reverts the lateral query back to an inner join.
  - Mitigation: the **mandatory** SQL-text regression guard (case 4) will fail immediately if `LEFT JOIN "States"`, `'No state'`, or the null check disappears, and the negative guard will fail if a bare inner `JOIN "States"` is reintroduced.
- Risk: latest-assignment shift (described in the rationale) surprises a downstream consumer that expected the old behavior of "latest *resolved* state name".
  - Mitigation: the issue explicitly requests this alignment with the portal review page. No downstream code reads `aiAssignedState` from the xlsx — the column is only consumed visually.
- Risk: the SQL-text assertion is too strict and fails on benign whitespace/formatting changes.
  - Mitigation: use substring matchers (`toContain` / `stringContaining`) rather than equality. If the existing test file already normalizes whitespace before comparing SQL, reuse that helper.

## Rollback

The change is contained in two files. To revert:

1. Restore the original lateral query in `worker-node/src/modules/orchestrator/reportWriter.ts` (the `JOIN "States"` form shown above under "Replace").
2. Delete the three new article-sheet test cases **and** the SQL-text regression guard from `worker-node/tests/modules/orchestrator/reportWriter.test.ts`.
3. Re-run `npx tsc -p tsconfig.json --noEmit` and `npm test` from `worker-node/` to confirm the revert is clean.

No DB migrations or generated artifacts are involved.

## Acceptance Criteria

Mirrors the issue's acceptance list, with explicit pointers to the verification mechanism for each:

- [ ] Articles with an `ArticleStateContracts02` row and `stateId = NULL` show `No state` in the orchestrator Excel report `Articles` sheet. (Covered by workbook-row case 2 and the SQL-text regression guard in case 4; also confirmed visually on the next orchestrator run.)
- [ ] Articles with a valid `stateId` continue to show the state name. (Covered by workbook-row case 1.)
- [ ] Articles with no `ArticleStateContracts02` row continue to show a blank `AI Assigned State`. (Covered by workbook-row case 3.)
- [ ] Existing `AI Approver Score` behavior remains unchanged unless a separate status/skipped-reason column is explicitly added. (No changes to `worker-python` or to the Articles sheet column list; verified by inspection of the diff.)
- [ ] Add or update report-writer tests to cover the `stateId = NULL` assignment case, including a mandatory SQL-text regression guard for the lateral subquery shape. (Covered by the additions to `reportWriter.test.ts`, specifically case 4.)

## Commit Guidance

Per `AGENTS.md` → "Commit Message Guidance":

- Title (≤50 chars, lowercase, no trailing period): `fix: orchestrator report no-state article cell`
- Body: 2–3 bullets summarizing the lateral-join change in `reportWriter.ts` and the new article-sheet test cases (including the mandatory SQL-text regression guard).
- Append `co-authored-by: codex (gpt-5.5)` (or whichever agent performs the implementation) on a final line, per the project commit convention.
