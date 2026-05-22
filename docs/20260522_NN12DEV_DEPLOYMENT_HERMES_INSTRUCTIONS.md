---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# nn12dev deployment instructions for Hermes

This file instructs the Hermes AI agent on nn12dev how to install, build, verify, and restart NewsNexus12 after pulling the Issue 4 audit-remediation branch.

## 1. Important context

- Target server: nn12dev, Ubuntu.
- Expected repo path: `/home/limited_user/applications/NewsNexus12`.
- Expected systemd services:
  - `newsnexus12-api.service`
  - `newsnexus12-worker-node.service`
  - `newsnexus12-worker-python.service`
  - `newsnexus12-portal.service`
- This branch includes Node dependency and lockfile changes.
- This branch does not require a database drop, restore, or manual migration.
- The root audit is expected to still report 5 moderate residual findings. Do not treat that alone as a deploy blocker. See `docs/20260522_WEEKLY_RESIDUAL_AUDIT_CHECK_SERVER_AGENT.md`.
- Do not run `npm audit fix --force`.

## 2. Preflight checks

Run:

```bash
cd /home/limited_user/applications/NewsNexus12
git status --short
git branch --show-current
node --version
npm --version
systemctl list-units 'newsnexus12*' --type=service --all
```

Rules:

- If `git status --short` shows uncommitted local changes, stop and report them to Nick before pulling.
- If Node is below v20, stop and report it. Next 16 and the root package require Node 20 or newer.
- If the service names differ from the expected names, use the actual `newsnexus12*` names from `systemctl list-units`.

## 3. Pull the branch

Use the branch Nick requests for the deployment. For the current Issue 4 work, the branch is expected to be:

```bash
dev_11_issue_4
```

Run:

```bash
git fetch origin
git checkout dev_11_issue_4
git pull --ff-only origin dev_11_issue_4
git log --oneline -5
```

If `git pull --ff-only` fails, stop and report the branch divergence to Nick.

## 4. Stop app services before install

Because this branch changes the root npm workspace lockfile and dependency layout, stop app services before changing `node_modules`.

Run:

```bash
sudo systemctl stop newsnexus12-api.service
sudo systemctl stop newsnexus12-worker-node.service
sudo systemctl stop newsnexus12-portal.service
sudo systemctl stop newsnexus12-worker-python.service
```

Then verify:

```bash
sudo systemctl status newsnexus12-api.service newsnexus12-worker-node.service newsnexus12-portal.service newsnexus12-worker-python.service
```

Stopped services may show `inactive`; that is expected.

## 5. Install dependencies

Prefer root `npm ci` because the root lockfile is committed and should be authoritative for the workspaces.

Run:

```bash
npm ci
```

If `npm ci` fails because of a lockfile/package mismatch, stop and report the failure. Do not fall back to `npm install` unless Nick explicitly approves it.

## 6. Verify builds and checks

Run the ordered root build:

```bash
npm run build
```

Run the portal lint gate:

```bash
npm run lint --workspace newsnexus12portal
```

Run targeted audit checks:

```bash
npm audit --prefix portal --audit-level=moderate
npm audit --audit-level=moderate
```

Expected audit results:

- `npm audit --prefix portal --audit-level=moderate` should report `0 vulnerabilities`.
- Root `npm audit --audit-level=moderate` is expected to fail with only the documented 5 moderate residual findings:
  - `postcss <8.5.10` through `next`
  - `uuid <11.1.1` through `exceljs` and `sequelize`

If root audit shows new high or critical findings, stop and report them to Nick. Do not apply broad fixes during deployment.

## 7. Optional test gate

If nn12dev has the required test database credentials and this deployment window allows extra verification, run:

```bash
npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts
npm test --workspace newsnexus12-worker-node -- --runInBand
npm test --workspace @newsnexus/db-manager -- --runInBand
```

If these fail because local test database roles or permissions are missing, report the exact failure. Do not modify production-like databases to make tests pass unless Nick explicitly approves that action.

## 8. Worker-node browser check

This branch should not require a new Puppeteer browser install. If worker-node logs later show missing browser errors, run the browser install as the service user:

```bash
cd /home/limited_user/applications/NewsNexus12/worker-node
sudo -u limited_user npm run puppeteer:browsers:install
```

Do not run this unless needed or requested; it is not part of the default deploy.

## 9. Restart services

After install and build verification pass, restart services:

```bash
sudo systemctl start newsnexus12-worker-python.service
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl start newsnexus12-api.service
sudo systemctl start newsnexus12-portal.service
```

Then verify status:

```bash
sudo systemctl status newsnexus12-worker-python.service newsnexus12-worker-node.service newsnexus12-api.service newsnexus12-portal.service
```

If a service is not active, inspect logs before retrying:

```bash
journalctl -u newsnexus12-api.service -n 100 --no-pager
journalctl -u newsnexus12-worker-node.service -n 100 --no-pager
journalctl -u newsnexus12-worker-python.service -n 100 --no-pager
journalctl -u newsnexus12-portal.service -n 100 --no-pager
```

## 10. Smoke checks

Run whichever local health checks are available on nn12dev. At minimum:

```bash
curl -I http://localhost:3000
curl -I http://localhost:3001
curl -I http://localhost:3002
curl -I http://localhost:5000
```

Interpretation depends on the service routes and reverse proxy, so a non-200 status is not automatically a failure. Connection refused, repeated 5xx errors, or systemd crash loops are failures.

## 11. Telegram report to Nick

After the deployment attempt, message Nick on Telegram using the server's existing Telegram notification mechanism. Do not write Telegram credentials into this repository.

Success message:

```text
nn12dev deploy complete for NewsNexus12 dev_11_issue_4. npm ci, build, portal lint, portal audit, and service restart completed. Root audit still has only the documented 5 moderate residual findings.
```

Blocked message:

```text
nn12dev deploy blocked for NewsNexus12 dev_11_issue_4. See server report/logs: <brief reason>.
```

## 12. Guardrails

- Do not run `npm audit fix --force`.
- Do not downgrade `next`, `exceljs`, or `sequelize`.
- Do not drop, recreate, restore, or mutate the database for this deployment.
- Do not run `npm install` if `npm ci` fails unless Nick approves.
- Do not commit server-generated files unless Nick explicitly asks.
- Keep a short deployment note with command results if anything fails.
