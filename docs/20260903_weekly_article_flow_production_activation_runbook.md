---
created_at: 2026-09-03T23:02:51Z
updated_at: 2026-09-04T20:13:04Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow — Production Activation Runbook

## Scope and starting point

Use this runbook only after NewsNexus12 has been pulled, installed, and built; the production database has been recreated and replenished; and the existing API, portal, Node worker, and Python worker services are running.

This runbook follows `docs/20260904_weekly_article_processing_cron_prd_v06.md`. Keep the production timer disabled through configuration validation and one supervised `manual_production` run. Enable scheduling only after that run succeeds and the operator approves activation.

Do not replace the database, create replacement services, change database roles or grants, or edit another package's environment file.

## 1. Validate the production environment

Confirm `/etc/newsnexus12/weekly-article-flow.env` is a regular, non-symlink file owned by `root:root` with mode `0600`:

```bash
sudo test -f /etc/newsnexus12/weekly-article-flow.env
sudo test ! -L /etc/newsnexus12/weekly-article-flow.env
sudo stat -c '%U:%G %a %n' /etc/newsnexus12/weekly-article-flow.env
```

The operator copied this file from development and confirmed it has no populated secrets; `PG_PASSWORD=` may remain blank. The agent may review it, but must not print its contents.

Securely update only the weekly-flow environment before validation:

1. Set `PG_USER=newsnexus_app` for manual and scheduled weekly runs.
2. Keep the intended production `PG_DATABASE` as the only database-name setting.
3. Remove the four obsolete weekly-flow allowlist variables listed in V06 section 5.
4. Verify worker URLs and ports, repository and resource paths, spreadsheet, semantic and state files, backup and journal directories, and disk threshold.

Stop and report any placeholder, development-only value, missing path, inaccessible resource, or database mismatch. Do not guess or bypass preflight checks.

## 2. Confirm the existing applications are healthy

```bash
for svc in \
  newsnexus12-api.service \
  newsnexus12-worker-node.service \
  newsnexus12-worker-python.service \
  newsnexus12-portal.service; do
  systemctl is-active "$svc"
done
```

All four must report `active`. Confirm the Node and Python worker queues are idle and no weekly run is active. Do not stop or recreate these services.

Confirm the weekly timer is not enabled before the supervised run:

```bash
systemctl is-enabled newsnexus12-weekly-article-flow.timer 2>/dev/null || true
```

## 3. Install or validate the additive schema

Load the protected production environment without displaying it, then install/validate only the weekly-flow schema:

```bash
sudo /bin/bash -c '
  set -a
  source /etc/newsnexus12/weekly-article-flow.env
  set +a
  exec /usr/sbin/runuser --user limited_user -- \
    /usr/bin/env PG_USER=newsnexus_boot \
    /usr/bin/npm -C /home/limited_user/applications/NewsNexus12/db-manager \
    run schema:weekly-article-flow
'
```

This one-command override is the only use of `newsnexus_boot`. It must not change `/etc/newsnexus12/weekly-article-flow.env`. The schema command must not use Sequelize `force` or `alter`.

## 4. Install production scheduler assets, leaving the timer disabled

```bash
cd /home/limited_user/applications/NewsNexus12
sudo ops/weekly-article-flow/install.sh --mode production --install-assets
```

This builds only the weekly coordinator, installs/verifies its systemd assets, and explicitly disables the timer. Confirm the timer remains disabled.

Before enabling the timer, verify that `Xenova/paraphrase-MiniLM-L6-v2/onnx/model.onnx` is cached and readable by `limited_user`. If missing, preload it through the installed Transformers.js package and successfully execute one test embedding. Stop if the download is rate-limited or the model remains unreadable.

## 5. Validate configuration and connectivity

Load the protected environment and run the read-only configuration check as `limited_user`:

```bash
sudo /bin/bash -c '
  set -a
  source /etc/newsnexus12/weekly-article-flow.env
  set +a
  exec /usr/sbin/runuser --user limited_user -- \
    /home/limited_user/applications/NewsNexus12/ops/weekly-article-flow/bin/run-config-check \
    --mode manual_production
'
```

The check must report Linux host `nws-nn12prod`, the intended `PG_DATABASE`, and database role `newsnexus_app`. It does not acquire the flow lock, contact workers, create a run, or change database state.

Stop and correct any configuration, identity, or PostgreSQL connection failure. Do not bypass this check.

## 6. Run supervised production

Confirm both worker queues are idle and no weekly run is active. Then keep this command in the foreground:

```bash
sudo /bin/bash -c '
  set -a
  source /etc/newsnexus12/weekly-article-flow.env
  set +a
  exec /usr/sbin/runuser --user limited_user -- \
    /home/limited_user/applications/NewsNexus12/ops/weekly-article-flow/bin/run-weekly-flow \
    --mode manual_production \
    --allow-live-ai
'
```

The September 4 configuration-parser failure created no coordinator run. Do not supply `--resume-run-id` for that attempt.

## 7. Review and approve

Before enabling the timer, review:

1. The `WeeklyArticleFlowRuns` row and stage evidence.
2. Backup path and verification result.
3. Worker job IDs and terminal results.
4. JSONL path and contents.
5. Weekly-flow and alert-helper journald output.
6. Any staged or published alert.

The supervised run must end as `completed` or `completed_no_new_articles`. Obtain explicit operator approval before continuing.

## 8. Activate the Friday production timer

Confirm that the next calendar occurrence is a future Friday at 5:00 AM `America/Los_Angeles`:

```bash
date
systemd-analyze calendar 'Fri *-*-* 05:00:00 America/Los_Angeles'
```

The timer uses `Persistent=true`. If the expected Friday 5:00 AM occurrence has already passed, stop and obtain operator direction rather than risking an immediate catch-up run.

Enable and start the timer:

```bash
cd /home/limited_user/applications/NewsNexus12
sudo ops/weekly-article-flow/install.sh --mode production --enable-timer

systemctl is-enabled newsnexus12-weekly-article-flow.timer
systemctl is-active newsnexus12-weekly-article-flow.timer
systemctl list-timers --all newsnexus12-weekly-article-flow.timer
```

The timer must report both `enabled` and `active`, and its displayed next trigger must be the expected future Friday at 5:00 AM Pacific. Confirm `newsnexus12-weekly-article-flow.service` remains inactive before that trigger.

## Rollback

If activation must be stopped, disable only this timer:

```bash
sudo systemctl disable --now newsnexus12-weekly-article-flow.timer
```

Do not remove the environment file, PostgreSQL evidence, backups, JSONL, or alerts during incident review.

## Completion report

Report the environment-file metadata, deployed revision, configuration-check result, supervised run ID and final status, evidence locations, timer enabled/active state, and next scheduled execution time. Do not report credentials.
