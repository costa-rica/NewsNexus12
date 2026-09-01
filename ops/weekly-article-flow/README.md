---
created_at: 2026-09-01T02:15:39Z
updated_at: 2026-09-01T02:21:37Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow

This package owns the completion-driven weekly article flow. PostgreSQL is authoritative for recovery. JSONL and the fixed NickVault alert are operator-facing evidence only.

AI Approver V02 is the only approver used here. Internal Python modules named `orchestrator.py` belong to the V02 implementation; they are not the removed cross-service legacy orchestrator feature.

## Modes

1. `dev_canary`
   - manual only
   - destructive maintenance disabled
   - permits a small RSS target
2. `dev_destructive_recovery`
   - manual only
   - destructive maintenance enabled
   - requires the exact development database confirmation
3. `manual_production`
   - manual full production sequence
   - required before timer activation
4. `scheduled_production`
   - full production sequence
   - invoked only by the production systemd timer

Every mode requires `--allow-live-ai`. Development modes require an allowlisted development host and database. Production modes require the `limited_user` runtime and database user.

## Build and test

```bash
npm -C db-models run build
npm -C ops/weekly-article-flow run build
npm -C ops/weekly-article-flow test
ops/weekly-article-flow/install.sh --check
```

The check command runs shell syntax checks. Each Ubuntu installer path runs `systemd-analyze verify` after copying its units. Operators can repeat production verification with:

```bash
sudo systemd-analyze verify \
  /etc/systemd/system/newsnexus12-weekly-article-flow.service \
  /etc/systemd/system/newsnexus12-weekly-article-flow.timer \
  /etc/systemd/system/newsnexus12-publish-weekly-alert.service
```

## Additive schema installation

Configure the intended PostgreSQL connection, build db-models, and run:

```bash
npm -C db-manager run schema:weekly-article-flow
```

The command installs or validates the additive weekly-flow schema. It does not use Sequelize `force` or `alter`.

## Configuration

Copy `.env.example` to a non-versioned environment file and add the required `PG_` connection variables. Never commit credentials or production database values.

Production systemd reads `/etc/newsnexus12/weekly-article-flow.env`. The operator creates and protects that file before installation. The installer never creates, rewrites, or removes it.

Important fixed paths are:

- repository: `/home/limited_user/applications/NewsNexus12`
- resources: `/home/limited_user/project_resources/NewsNexus12`
- JSONL and alert staging: the `weekly-flow/` resources subdirectory
- production environment: `/etc/newsnexus12/weekly-article-flow.env`
- NickVault destination: `/home/nick/NickVault/ALERT-newsnexus12-weekly-cron.md`
- host lock: `/var/lock/newsnexus12-weekly-article-flow.lock`

Review every allowlist, path, timeout, worker URL, and free-disk threshold in `.env.example`. Semantic scoring is limited to four hours. The coordinator is limited to 72 hours, while systemd allows 73 hours.

## Manual development commands

Development creates no schedule.

```bash
ops/weekly-article-flow/bin/run-dev-canary \
  --canary-target 25 \
  --allow-live-ai
```

```bash
ops/weekly-article-flow/bin/run-dev-destructive-recovery \
  --confirm-dev-database newsnexus_dev \
  --allow-live-ai
```

Resume the same authoritative run when recovery evidence says it is safe:

```bash
ops/weekly-article-flow/bin/run-dev-destructive-recovery \
  --resume-run-id 123 \
  --confirm-dev-database newsnexus_dev \
  --allow-live-ai
```

Install only the fixed alert helper on Ubuntu development:

```bash
sudo ops/weekly-article-flow/install.sh --mode development --install-helper
```

Development mode rejects weekly service and timer installation.

## Production installation and activation

Production rollout has separate gates:

1. Install the additive schema.
2. Create `/etc/newsnexus12/weekly-article-flow.env` as a root-managed file.
3. Install and verify the assets. This explicitly leaves the timer disabled.

   ```bash
   sudo ops/weekly-article-flow/install.sh --mode production --install-assets
   ```

4. Run the full flow once under supervision.

   ```bash
   sudo -u limited_user \
     /home/limited_user/applications/NewsNexus12/ops/weekly-article-flow/bin/run-weekly-flow \
     --mode manual_production \
     --allow-live-ai
   ```

5. Inspect PostgreSQL, worker jobs, JSONL, journald, and any fixed alert.
6. Obtain operator approval to activate scheduling.
7. Enable the Friday 5:00 AM `America/Los_Angeles` timer.

   ```bash
   sudo ops/weekly-article-flow/install.sh --mode production --enable-timer
   ```

8. Confirm the next execution with `systemctl list-timers newsnexus12-weekly-article-flow.timer`.

## Monitoring and failure reasons

Use these commands on Ubuntu:

```bash
systemctl status newsnexus12-weekly-article-flow.timer
journalctl -u newsnexus12-weekly-article-flow.service
journalctl -u newsnexus12-publish-weekly-alert.service
```

The coordinator records terminal status in PostgreSQL before attempting final JSONL or alert reporting. Important classified reasons include:

- `failed_worker_result_contract`
- `failure_rss_rate_limited`
- `failure_rss_cohort_mismatch`
- `failure_state_assigner_circuit_breaker`
- `failure_ai_approver_v02`
- stage failure or timeout
- reporting or alert-helper failure

Read the run's `currentStage`, `stageResults`, and `failureReason` first. Then use job IDs and the JSONL path recorded on that same run. Do not infer recovery state from JSONL alone.

## Recovery

1. Keep the fixed alert until the operator resolves or archives it.
2. Determine whether the current stage has authoritative completion evidence.
3. Resume the same run ID only when the coordinator's persisted recovery rules permit it.
4. Never create a replacement run to bypass an active run or ambiguous V02 preview.
5. Never rerun a destructive stage whose successful result is already persisted.
6. If the alert helper fails, inspect its journald unit and leave the staged alert intact.

## Rollback and uninstall

Disable the timer first if production rollback is required:

```bash
sudo systemctl disable --now newsnexus12-weekly-article-flow.timer
```

Remove only this subsystem's installed units and helper assets with:

```bash
sudo ops/weekly-article-flow/uninstall.sh --confirm
```

The uninstaller refuses to proceed while the weekly or alert service is active. It preserves PostgreSQL records, JSONL, staged and published alerts, backups, the environment file, and unrelated schedules.

Schema removal is not part of uninstall. It requires a separately approved destructive migration.
