---
created_at: 2026-05-21
updated_at: 2026-05-21
created_by: claude (opus-4.7)
modified_by: claude (opus-4.7)
---

# Plan: Fix Orchestrator Report `AI Assigned State` Blanks For Null-State Assignments

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
  - The test surface is small and well-scoped: the existing report-writer test file already mocks `sequelize.query`, so the new test only adds an extra row shape — no integration plumbing or DB fixtures.

Implementation may proceed without pausing for Nick.

## Files To Change

1. `worker-node/src/modules/orchestrator/reportWriter.ts` — fix the lateral-join SQL inside `getArticleRows`.
2. `worker-node/tests/modules/orchestrator/reportWriter.test.ts` — add coverage for the three article-state cases (valid state, `stateId = NULL`, no assignment row at all).

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

Update `worker-node/tests/modules/orchestrator/reportWriter.test.ts` to cover the article sheet's state column. The file already mocks `sequelize.query` (`mockSequelizeQuery`) and reads the workbook back with ExcelJS, so the new tests should follow the same pattern.

Add a new `describe('reportWriter articles sheet state column', () => { ... })` block, or extend the existing test file with three focused cases. Each case constructs `OrchestratorRunRow` with `articleIdMinExclusive`/`articleIdMaxInclusive` set to a non-zero range so `includeArticles` triggers the article query.

Cases (all should be added):

1. Valid state — `mockSequelizeQuery.mockResolvedValueOnce([[{ articleId: 1, title: 't', scrapeStatus: 'completed', aiAssignedState: 'California', aiApproverScore: null, aiGatekeeperDecision: null, aiGatekeeperConfidence: null, aiGatekeeperReasonCode: null, semanticRating: null }], null])`. Expect the `Articles` sheet row's `AI Assigned State` cell to be `'California'`.
2. Null-state assignment row — `aiAssignedState: 'No state'`. Expect the cell to read `'No state'`. This is the regression-prevention test for the bug in the issue.
3. No assignment row at all — `aiAssignedState: null`. Expect the cell to be empty (ExcelJS represents this as `null`/empty).

Each case should:

- Use `makeRun()` but override `articleIdMinExclusive: 0, articleIdMaxInclusive: 100` so the articles branch fires.
- Use `makeStep()` with `stepName: 'state_assigner'` (or whichever non-google step name avoids triggering the queryResults branch) and `result: null`.
- Read the workbook back with the existing `readWorkbook` helper, locate the `'Articles'` worksheet, and assert on `sheet.getRow(2).getCell(<aiAssignedStateColumnIndex>).value`. The `AI Assigned State` column is the fourth column per the `articlesSheet.columns` definition.

Optional but recommended:

- Add one assertion that captures the SQL string passed to `mockSequelizeQuery` and verifies it contains both `LEFT JOIN "States"` and the `'No state'` literal. This locks the fix into the query text and will fail loudly if a future refactor reintroduces the inner join.

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
- The targeted `reportWriter.test.ts` run passes, including the new state-column cases.
- Full `npm test` remains green; no other suite touches `aiAssignedState` projection logic, so no cascading edits should be needed.

A manual end-to-end re-verification against the live Postgres database (re-running an orchestrator pass and inspecting the produced `.xlsx`) is optional and may be performed by Nick after merge — it is not required by this plan because the change is purely a string substitution in one query.

## Risks

- Risk: a `States` row with the literal name `'No state'` exists in production data, which would make the new sentinel ambiguous in the report.
  - Mitigation: a quick `SELECT id, name FROM "States" WHERE name = 'No state'` against the prod DB before merge is sufficient. The `States` table is curated (US states + territories), so this collision is not expected, but worth confirming.
- Risk: a future refactor inadvertently reverts the lateral query back to an inner join.
  - Mitigation: the optional SQL-text assertion above; otherwise the new behavioral test in case 2 will fail.
- Risk: latest-assignment shift (described in the rationale) surprises a downstream consumer that expected the old behavior of "latest *resolved* state name".
  - Mitigation: the issue explicitly requests this alignment with the portal review page. No downstream code reads `aiAssignedState` from the xlsx — the column is only consumed visually.

## Rollback

The change is contained in two files. To revert:

1. Restore the original lateral query in `worker-node/src/modules/orchestrator/reportWriter.ts` (the `JOIN "States"` form shown above under "Replace").
2. Delete the three new article-sheet test cases (and the optional SQL-text assertion) from `worker-node/tests/modules/orchestrator/reportWriter.test.ts`.
3. Re-run `npx tsc -p tsconfig.json --noEmit` and `npm test` from `worker-node/` to confirm the revert is clean.

No DB migrations or generated artifacts are involved.

## Acceptance Criteria

Mirrors the issue's acceptance list, with explicit pointers to the verification mechanism for each:

- [ ] Articles with an `ArticleStateContracts02` row and `stateId = NULL` show `No state` in the orchestrator Excel report `Articles` sheet. (Covered by new test case 2 and confirmed visually on the next orchestrator run.)
- [ ] Articles with a valid `stateId` continue to show the state name. (Covered by new test case 1.)
- [ ] Articles with no `ArticleStateContracts02` row continue to show a blank `AI Assigned State`. (Covered by new test case 3.)
- [ ] Existing `AI Approver Score` behavior remains unchanged unless a separate status/skipped-reason column is explicitly added. (No changes to `worker-python` or to the Articles sheet column list; verified by inspection of the diff.)
- [ ] Add or update report-writer tests to cover the `stateId = NULL` assignment case. (Covered by the additions to `reportWriter.test.ts`.)

## Commit Guidance

Per `AGENTS.md` → "Commit Message Guidance":

- Title (≤50 chars, lowercase, no trailing period): `fix: orchestrator report no-state article cell`
- Body: 2–3 bullets summarizing the lateral-join change in `reportWriter.ts` and the new article-sheet test cases.
- Append `co-authored-by: codex (gpt-5.5)` (or whichever agent performs the implementation) on a final line, per the project commit convention.
