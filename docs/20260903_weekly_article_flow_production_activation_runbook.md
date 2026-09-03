---
created_at: 2026-09-03T23:02:51Z
updated_at: 2026-09-03T23:02:51Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow — Production Activation Runbook

## Scope and starting point

Use this runbook only after NewsNexus12 has been pulled, installed, and built; the production database has been recreated and replenished; and the existing API, portal, Node worker, and Python worker services are running.

Do not pull code, rebuild those applications, replace the database, create replacement services, or use any development mode. Production must use `manual_production` for the supervised run and `scheduled_production` through systemd afterward.

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

Before running the flow, verify that `Xenova/paraphrase-MiniLM-L6-v2/onnx/model.onnx` is cached and readable by `limited_user`. If missing, preload it through the installed Transformers.js package and successfully execute one test embedding. Stop if the download is rate-limited or the model remains unreadable.

## 5. Run one supervised production flow

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

Remain attached until the coordinator exits. Do not start another run concurrently.

## 6. Verify the supervised run

Before enabling scheduling, confirm all of the following:

- The authoritative `WeeklyArticleFlowRuns` row is terminal with `status=completed`.
- Every stage has persisted completion evidence and reconciled counts.
- The backup exists at the persisted path and its integrity/hash verification passed.
- RSS cohort counts reconcile with the run record.
- Semantic, state assignment, and AI Approver V02 jobs completed successfully.
- Node and Python worker queues returned to idle.
- JSONL reporting exists and agrees with PostgreSQL.
- No unresolved staged alert exists.
- All four existing application services remain healthy.

If any check fails, keep the timer disabled and report the exact run ID, stage, job ID, failure reason, and evidence. Never edit run records, create a replacement run, or rerun a destructive stage to bypass recovery rules.

## 7. Enable and verify the production timer

Only after the supervised run passes:

```bash
cd /home/limited_user/applications/NewsNexus12
sudo ops/weekly-article-flow/install.sh --mode production --enable-timer

systemctl is-enabled newsnexus12-weekly-article-flow.timer
systemctl is-active newsnexus12-weekly-article-flow.timer
systemctl list-timers --all newsnexus12-weekly-article-flow.timer
```

Expected schedule: Friday at **5:00 AM America/Los_Angeles**, with persistence enabled. Confirm the displayed next trigger before declaring production activation complete.

## Rollback

If activation must be stopped, disable only this timer:

```bash
sudo systemctl disable --now newsnexus12-weekly-article-flow.timer
```

Do not remove the environment file, PostgreSQL evidence, backups, JSONL, or alerts during incident review.

## Completion report

Report the environment-file metadata (not values), service health, schema result, supervised run ID/status and stage counts, backup/hash evidence, worker job IDs, JSONL path, timer enabled/active state, and next scheduled execution.
