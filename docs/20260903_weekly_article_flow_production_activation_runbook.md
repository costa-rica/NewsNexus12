---
created_at: 2026-09-03T23:02:51Z
updated_at: 2026-09-03T23:22:51Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow — Production Activation Runbook

## Scope and starting point

Use this runbook only after NewsNexus12 has been pulled, installed, and built; the production database has been recreated and replenished; and the existing API, portal, Node worker, and Python worker services are running.

Do not pull code, rebuild those applications, replace the database, create replacement services, or use any development or manual-production mode. The production flow must start only as `scheduled_production` through the Friday systemd timer.

## 1. Validate the production environment

Confirm `/etc/newsnexus12/weekly-article-flow.env` is a regular, non-symlink file owned by `root:root` with mode `0600`:

```bash
sudo test -f /etc/newsnexus12/weekly-article-flow.env
sudo test ! -L /etc/newsnexus12/weekly-article-flow.env
sudo stat -c '%U:%G %a %n' /etc/newsnexus12/weekly-article-flow.env
```

The operator copied this file from development and confirmed it has no populated secrets; `PG_PASSWORD=` may remain blank. The agent may review it, but must not print its contents. Verify that production host/database allowlists, PostgreSQL identity, worker URLs and ports, repository/resource paths, spreadsheet, semantic/state files, backup directory, journal directory, and disk threshold are correct for production.

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
    /usr/bin/npm -C /home/limited_user/applications/NewsNexus12/db-manager \
    run schema:weekly-article-flow
'
```

This command must not use Sequelize `force` or `alter`.

## 4. Install production scheduler assets, leaving the timer disabled

```bash
cd /home/limited_user/applications/NewsNexus12
sudo ops/weekly-article-flow/install.sh --mode production --install-assets
```

This builds only the weekly coordinator, installs/verifies its systemd assets, and explicitly disables the timer. Confirm the timer remains disabled.

Before enabling the timer, verify that `Xenova/paraphrase-MiniLM-L6-v2/onnx/model.onnx` is cached and readable by `limited_user`. If missing, preload it through the installed Transformers.js package and successfully execute one test embedding. Stop if the download is rate-limited or the model remains unreadable.

## 5. Activate the Friday production timer

Do not run the flow manually. Confirm that the next calendar occurrence is a future Friday at **5:00 AM America/Los_Angeles**:

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

The timer must report both `enabled` and `active`, and its displayed next trigger must be the expected future Friday at 5:00 AM Pacific. Confirm `newsnexus12-weekly-article-flow.service` remains inactive before that trigger. Do not manually start it. Implementation is complete after these static checks; do not wait for, trigger, or monitor the scheduled flow.

## Rollback

If activation must be stopped, disable only this timer:

```bash
sudo systemctl disable --now newsnexus12-weekly-article-flow.timer
```

Do not remove the environment file, PostgreSQL evidence, backups, JSONL, or alerts during incident review.

## Completion report

Report the environment-file metadata (not values), service health, schema result, timer enabled/active state, and next scheduled execution time. Stop after this implementation report; runtime verification will be requested separately by the operator.
