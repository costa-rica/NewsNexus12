---
created_at: 2026-07-23
updated_at: 2026-07-23
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# AI Approver V02 Schema Operations

## 1. Scope

The dedicated installer manages only:

- `AiApproverPromptVersionsV02`
- `AiApproverRunsV02`
- `AiApproverArticlePredictionsV02`

It does not use `force` or `alter`. It validates any existing V02 table before creating an absent table and stops before mutation when an existing V02 table is partial or incompatible.

## 2. Prerequisites

1. Build the current db-models package.
2. Build the current db-manager package.
3. Confirm the target environment points to the intended PostgreSQL database.
4. Create and verify a database backup.
5. Confirm the base schema contains `Articles`.
6. Obtain operator approval before running against production.

Required database variables are:

- `PG_HOST`
- `PG_PORT`
- `PG_DATABASE`
- `PG_USER`
- `PG_PASSWORD`, when required
- `PG_SCHEMA`, default `public`

## 3. Workstation Command

From the repository root:

```bash
cd db-models
npm run build
cd ../db-manager
npm run build
npm run schema:ai-approver-v02
```

The command reports each created or retained table. A compatible installation is a successful no-op.

## 4. Production Command

Load the reviewed db-manager production environment, then run:

```bash
cd /home/limited_user/applications/NewsNexus12/db-models
npm run build
cd ../db-manager
npm run build
npm run schema:ai-approver-v02
```

Do not run the production command until the backup and operator-approval prerequisites are satisfied.

## 5. Verification Queries

Verify all three tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'AiApproverPromptVersionsV02',
    'AiApproverRunsV02',
    'AiApproverArticlePredictionsV02'
  )
ORDER BY table_name;
```

Verify indexes:

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'AiApproverPromptVersionsV02',
    'AiApproverRunsV02',
    'AiApproverArticlePredictionsV02'
  )
ORDER BY tablename, indexname;
```

Verify foreign keys:

```sql
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.constraint_schema = kcu.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
 AND tc.constraint_schema = ccu.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'AiApproverRunsV02',
    'AiApproverArticlePredictionsV02'
  )
ORDER BY tc.table_name, kcu.column_name;
```

## 6. Normal Application Rollback

Normal worker, API, or portal rollback must leave all V02 tables intact.

Use application rollback to:

- remove V02 runtime access
- stop new V02 runs
- preserve prompt, run, prediction, and human-review data

## 7. Destructive Schema Rollback

Dropping V02 tables is not part of this installation or normal rollback.

The separate operator-approved procedure is:

- `20260723_ai_approver_v02_destructive_removal_procedure.md`

Do not use that procedure without a verified backup and explicit approval for the destructive action.
