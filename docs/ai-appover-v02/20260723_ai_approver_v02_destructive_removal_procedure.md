---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Destructive Removal Procedure

## 1. Status

- This procedure is not approved by creating or merging this document.
- It is not part of normal deployment or application rollback.
- Running it destroys V02 prompt, run, prediction, and human-review data.
- Stop unless the operator explicitly approves this exact destructive action.

## 2. Required evidence

- [ ] Separate operator approval names all three V02 tables.
- [ ] A verified backup exists.
- [ ] A restore test completed successfully.
- [ ] Worker-python, API, and portal V02 access is disabled.
- [ ] No V02 run is queued or running.
- [ ] Retention requirements permit deletion.
- [ ] The target host, database, and schema were independently confirmed.

## 3. Final inventory

```sql
SELECT
  (SELECT COUNT(*) FROM "AiApproverPromptVersionsV02") AS prompts,
  (SELECT COUNT(*) FROM "AiApproverRunsV02") AS runs,
  (SELECT COUNT(*) FROM "AiApproverArticlePredictionsV02") AS predictions;
```

Save the result with the approval record.

## 4. Removal

Only after every required item is complete:

```sql
BEGIN;

DROP TABLE "AiApproverArticlePredictionsV02";
DROP TABLE "AiApproverRunsV02";
DROP TABLE "AiApproverPromptVersionsV02";

COMMIT;
```

If any target, approval, or backup detail is uncertain, do not begin the transaction.

## 5. Verification

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'AiApproverPromptVersionsV02',
    'AiApproverRunsV02',
    'AiApproverArticlePredictionsV02'
  );
```

The query returns zero rows only after an approved removal.
