---
created_at: 2026-09-04T20:21:08Z
updated_at: 2026-09-04T20:21:08Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Dev Deployment and Validation

## Purpose

Deploy and validate the completed Mac implementation from phases 1–3 of `docs/20260904_weekly_article_flow_todo_v01.md` on the Ubuntu development server.

## Steps

1. Pull the branch.

   ```bash
   cd /home/limited_user/applications/NewsNexus12
   git switch dev_31_weekly_cron_fix
   git pull --ff-only origin dev_31_weekly_cron_fix
   ```

2. Remove these entries from `ops/weekly-article-flow/.env`:

   ```text
   WEEKLY_FLOW_DEV_HOSTS
   WEEKLY_FLOW_PRODUCTION_HOSTS
   WEEKLY_FLOW_DEV_DATABASES
   WEEKLY_FLOW_PRODUCTION_DATABASES
   ```

3. Build and test.

   ```bash
   npm -C db-models run build
   npm -C ops/weekly-article-flow test
   npm -C ops/weekly-article-flow run build
   ops/weekly-article-flow/install.sh --check
   ```

4. Check configuration and PostgreSQL connectivity.

   ```bash
   cd ops/weekly-article-flow
   ./bin/run-config-check --mode dev_destructive_recovery
   ```

5. Run the manual development flow using `docs/20260903_weekly_article_flow_dev_test_runbook.md`.

6. Report the revision, test results, configuration-check result, run ID, final status, and evidence paths.
