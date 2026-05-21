---
created_at: 2026-05-21
updated_at: 2026-05-21
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Assessment: Plan Fix Orchestrator Report AI State Assigner Blanks

## Finding 1: SQL regression coverage is optional but should be required

Severity: moderate

The plan's required test cases mock `sequelize.query` to return rows that already contain `aiAssignedState: 'California'`, `'No state'`, or `null`, then verify those mocked values appear in the workbook. Those tests are useful for workbook rendering, but they do not exercise the actual root-cause fix in `getArticleRows`.

With the current implementation's inner join still present, the proposed null-state test would still pass if the mock returned `aiAssignedState: 'No state'`. That means an implementer could follow the non-optional test plan, skip the optional SQL assertion, and still have no meaningful regression guard for the bug described in the issue.

Actionable fix:

- Make the SQL-text assertion mandatory, not optional.
- Assert that the SQL passed to `mockSequelizeQuery` contains the null-state sentinel and the left join shape that preserves null `stateId` rows, for example `LEFT JOIN "States" st ON st.id = asc2."stateId"` and `WHEN asc2."stateId" IS NULL THEN 'No state'`.
- Keep the workbook-row tests, but treat them as output-shape checks rather than the primary regression test.

Without this adjustment, the implementation may appear tested while still allowing the original SQL bug to return.

## Overall Assessment

The implementation approach is otherwise narrow and consistent with the issue: changing the lateral state-assignment subquery is the correct architecture point, and leaving AI Approver score behavior unchanged matches the documented requirement.

Difficulty: very low

Safety risk of breaking existing functionality: low

Rationale: The production code change is confined to one report query and preserves existing report columns and row shape. The main risk is not runtime breakage; it is insufficient required test coverage for the SQL behavior that caused the blank `AI Assigned State` cells.
