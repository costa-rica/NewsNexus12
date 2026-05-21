---
created_at: 2026-05-21
updated_at: 2026-05-21
created_by: codex (gpt-5.5)
modified_by: codex (gpt-5.5)
---

# Issue: Orchestrator report leaves AI State Assigner null-state results blank

## Summary

The weekly orchestrator Excel report can show a blank `AI Assigned State` value even when the AI State Assigner successfully analyzed an article and persisted an `ArticleStateContracts02` row.

This happens for articles where the state assigner determines that the article did not occur in the United States, or otherwise cannot assign a concrete state. In those cases, the state assignment row is intentionally saved with `stateId = NULL`. The review page represents this case as `No state`, but the Excel report currently drops that signal and leaves the cell blank.

## Example Evidence

Observed during an abbreviated weekly orchestrator test run:

- Orchestrator run ID: `5`
- Report file: `/home/limited_user/project_resources/NewsNexus12/utilities/orchestrator/reports/2026-05-21-185349-orchestration-report.xlsx`
- Article ID: `373636`
- Article title: `Maggie Andrew, DeeDee Austin each receive three ECMA award nominations - The Laker News`

Database state for article `373636`:

- `ArticleStateContracts02.id = 166467`
- `articleId = 373636`
- `stateId = NULL`
- `occuredInTheUS = false`
- `isDeterminedToBeError = false`
- Reasoning: `The events described in the article take place in Sydney, Cape Breton, which is located in Canada, not the United States.`

Excel report row for article `373636`:

- `AI Assigned State`: blank
- `AI Approver Score`: blank
- `AI Gatekeeper Decision`: blank
- `Semantic Rating`: populated

Review page behavior:

- The `/articles/review` table displays the AI state assignment as `No state` because the state assignment object exists but has no `stateName`.

## Expected Behavior

If an article has an `ArticleStateContracts02` row with `stateId = NULL`, the orchestrator Excel report should show `No state` in the `AI Assigned State` column.

This would align the report with the review page and make it clear that the AI State Assigner did analyze the article.

## Actual Behavior

The orchestrator Excel report leaves `AI Assigned State` blank when the latest `ArticleStateContracts02` row has `stateId = NULL`.

This makes the row look like the AI State Assigner did not run, even though it did.

## Root Cause

The report query in `worker-node/src/modules/orchestrator/reportWriter.ts` uses an inner join from `ArticleStateContracts02` to `States` inside the state-assignment lateral subquery:

```sql
LEFT JOIN LATERAL (
  SELECT st.name FROM "ArticleStateContracts02" asc2
  JOIN "States" st ON st.id = asc2."stateId"
  WHERE asc2."articleId" = a.id
  ORDER BY asc2.id DESC LIMIT 1
) s ON true
```

When `asc2."stateId"` is `NULL`, the inner `JOIN "States"` returns no row. The outer query therefore receives `NULL` for `aiAssignedState`, even though the `ArticleStateContracts02` assignment row exists.

The review page path preserves this case differently:

- `api/src/modules/queriesSql.ts` left joins `ArticleStateContracts02` and `States`, preserving assignment rows with null `stateId`.
- `portal/src/components/tables/TableReviewArticles.tsx` renders `No state` when `row.stateAssignment` exists but `stateAssignment.stateName` is empty.

## Recommended Solution

Update the state-assignment lateral query in `worker-node/src/modules/orchestrator/reportWriter.ts` to preserve null-state assignment rows and map them to `No state`.

Recommended SQL shape:

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
  ORDER BY asc2.id DESC
  LIMIT 1
) s ON true
```

This keeps the existing report column name and output type while aligning the report with the portal behavior.

## AI Approver Score Note

The blank `AI Approver Score` for article `373636` appears to be expected for this test run.

The AI Approver eligibility query in `worker-python/src/modules/ai_approver/repository.py` requires a non-null state assignment when `require_state_assignment` is true:

```sql
EXISTS (
  SELECT 1
  FROM "ArticleStateContracts02" asc2
  WHERE asc2."articleId" = a.id
    AND asc2."stateId" IS NOT NULL
    AND asc2."isDeterminedToBeError" = FALSE
)
```

Because article `373636` has `stateId = NULL`, it is excluded from AI Approver processing. The run result also showed `articleCount = 0` and `attemptCount = 0` for the AI Approver step.

Do not populate `AI Approver Score` unless an actual category-score row exists in `AiApproverArticleScores`. If clearer reporting is desired, add a separate explanatory column such as `AI Approver Status` or `AI Approver Skipped Reason` instead of reusing the numeric score column.

## Acceptance Criteria

- [ ] Articles with an `ArticleStateContracts02` row and `stateId = NULL` show `No state` in the orchestrator Excel report `Articles` sheet.
- [ ] Articles with a valid `stateId` continue to show the state name.
- [ ] Articles with no `ArticleStateContracts02` row continue to show a blank `AI Assigned State`.
- [ ] Existing `AI Approver Score` behavior remains unchanged unless a separate status/skipped-reason column is explicitly added.
- [ ] Add or update report-writer tests to cover the `stateId = NULL` assignment case.
