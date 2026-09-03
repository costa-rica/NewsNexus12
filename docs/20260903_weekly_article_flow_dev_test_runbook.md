---
created_at: 2026-09-03T19:40:05Z
updated_at: 2026-09-03T19:43:58Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Dev Test Runbook

## Purpose

Use this runbook to trigger and assess one complete weekly article flow on the Ubuntu development server. It runs destructive maintenance, creates a verified database backup, and then runs Google RSS, semantic scorer, state assigner, and AI Approver V02.

Background documents:

- [Weekly Article Processing Cron PRD V03](./20260829_weekly_article_processing_cron_prd_v03.md) defines the approved behavior, safety requirements, execution modes, and acceptance criteria.
- [Weekly Article Flow Todo V02](./20260831_weekly_article_flow_todo_v02.md) records the implementation phases and Ubuntu development testing work.

## Preconditions

- Run commands as `limited_user`.
- Use the `dev_30_weekly_cron` revision intended for testing.
- Keep the API, worker-node, and worker-python services running.
- Confirm the replenished development database contains the `WeeklyArticleFlowRuns` table.
- Configure `ops/weekly-article-flow/.env` from `.env.example` without committing it.
- Confirm its `PG_DATABASE`, development host allowlist, development database allowlist, resource paths, worker URLs, and backup path are correct.
- Do not install or enable the production timer during this test.

## 1. Confirm the target

```bash
cd /home/limited_user/applications/NewsNexus12/ops/weekly-article-flow
hostname
grep -E '^(PG_DATABASE|WEEKLY_FLOW_DEV_HOSTS|WEEKLY_FLOW_DEV_DATABASES)=' .env
curl --fail http://127.0.0.1:3002/queue-info/queue_status
curl --fail http://127.0.0.1:5000/queue-info/queue-status
```

The hostname and database must exactly match their development allowlists. Both queues must be idle. Do not print or share database passwords or API keys.

## 2. Trigger the full flow

Replace `<exact_dev_database>` with the `PG_DATABASE` value confirmed above. Keep the command in the foreground.

```bash
./bin/run-dev-destructive-recovery \
  --confirm-dev-database <exact_dev_database> \
  --canary-target 25 \
  --allow-live-ai
```

This executes the following sequence:

1. Duplicate cleanup.
2. Verified database backup.
3. Old-article deletion.
4. Google RSS collection, targeting 25 added articles.
5. Semantic scoring, with a four-hour limit.
6. State assignment for the run cohort.
7. AI Approver V02 Mode A.
8. Reconciliation and reporting.

## 3. Monitor authoritative status

In another terminal, connect to the same database and inspect the newest run. Supply the actual PostgreSQL connection values when prompted.

```bash
psql -h <host> -p <port> -U <user> -d <exact_dev_database>
```

```sql
SELECT
  "id",
  "mode",
  "status",
  "currentStage",
  "rssArticlesAddedCount",
  "cohortArticleCount",
  "failureReason",
  "jsonlFilePath",
  "startedAt",
  "endedAt"
FROM "WeeklyArticleFlowRuns"
ORDER BY "id" DESC
LIMIT 3;
```

For detailed evidence, replace `<run_id>`:

```sql
SELECT jsonb_pretty("stageResults")
FROM "WeeklyArticleFlowRuns"
WHERE "id" = <run_id>;
```

PostgreSQL is authoritative. Use the JSONL path recorded on that run and the API and worker logs only as supporting evidence.

## 4. Decide whether the test passed

The test passes when:

- The run ends as `completed` or `completed_no_new_articles`.
- Every required stage has terminal, internally consistent evidence.
- `rssArticlesAddedCount` and `cohortArticleCount` reconcile as documented in the stage evidence.
- Semantic scorer, state assigner, and both AI Approver V02 phases complete without a circuit breaker, timeout, or failed worker contract.
- The recorded backup exists and its verification succeeded.
- No secret appears in PostgreSQL evidence, JSONL, or logs.

## 5. Handle an interruption or failure

1. Record the run ID, status, current stage, failure reason, stage evidence, worker job IDs, and JSONL path.
2. Do not start a replacement run to bypass the failed or active run.
3. Correct the underlying issue.
4. Resume only when the persisted recovery evidence permits it.

```bash
./bin/run-dev-destructive-recovery \
  --resume-run-id <run_id> \
  --confirm-dev-database <exact_dev_database> \
  --canary-target 25 \
  --allow-live-ai
```

If resume is refused, preserve the exact error and database evidence for review. Do not manually mark stages complete or rerun a destructive stage whose completion is already recorded.

## Test handoff

Report:

- Hostname, database name, git revision, and run ID.
- Start and end times, final status, and failure reason if any.
- RSS added count and cohort count.
- Per-stage result and worker job IDs.
- Backup verification result and path.
- JSONL path and the first actionable error, if present.
- Confirmation that no timer was installed or enabled.
