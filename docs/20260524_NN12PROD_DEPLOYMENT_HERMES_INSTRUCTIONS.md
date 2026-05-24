---
created_at: 2026-05-24
updated_at: 2026-05-24
created_by: hermes (gpt-5.5)
modified_by: hermes (gpt-5.5)
---

# nn12prod deployment instructions for Hermes

This file instructs the Hermes AI agent on `nn12prod` how to pull the production `main` branch, install dependencies, build, verify, and stop/start the NewsNexus12 runtime apps.

These instructions are intentionally production-specific. They were adapted from the nn12dev deployment instructions in `docs/20260522_NN12DEV_DEPLOYMENT_HERMES_INSTRUCTIONS.md`, but the production server should pull `main`, not a development branch.

## 1. Important context

- Target server: `nn12prod`, Ubuntu.
- Expected repo path: `/home/limited_user/applications/NewsNexus12`.
- Production deploy branch: `main`.
- The production PostgreSQL database name is the same as the development database name, but the production database must be treated as live production data.
- Runtime app services expected on production:
  - `newsnexus12-api.service`
  - `newsnexus12-worker-node.service`
  - `newsnexus12-worker-python.service`
  - `newsnexus12-portal.service`
- Do **not** deploy `newsnexus12-db-manager.service` as a long-running app. The db-manager is a CLI/maintenance app and should remain outside the normal runtime restart set unless Nick explicitly says otherwise.
- The merged production changes include Node dependency and lockfile changes.
- This deploy is not expected to require a database drop, restore, seed, or manual migration.
- Do not run `npm audit fix --force`.
- Use stop followed by start for runtime services. Do not use `restart` unless Nick explicitly approves it and the server permissions support it.

## 2. Preflight checks

Run:

```bash
cd /home/limited_user/applications/NewsNexus12
git status --short --branch
git branch --show-current
git remote get-url origin
node --version
npm --version
systemctl list-units 'newsnexus12*' --type=service --all --no-pager
sudo -n true && echo sudo_ok || echo sudo_needs_password
```

Rules:

- If the repo path does not exist, stop and report the actual layout to Nick.
- If `git status --short --branch` shows uncommitted local changes, stop and report them to Nick before pulling or switching branches.
- If the current branch is not `main`, switch to `main` only after confirming the working tree is clean.
- If Node is below v20, stop and report it. Next 16 and the root package require Node 20 or newer.
- If the service names differ from the expected names, use the actual `newsnexus12*` names from `systemctl list-units` and report the difference.
- If direct `sudo systemctl` access requires a password, use the approved server-management path for nn12prod if available, or ask Nick to run the privileged service-control commands. Do not invent a new privilege path.

## 3. Pull production main

Production should pull `main` with the merged changes.

Run:

```bash
git fetch origin main
git switch main
git pull --ff-only origin main
git status --short --branch
git log --oneline -5
```

If `git pull --ff-only` fails, stop and report the branch divergence to Nick. Do not merge, rebase, reset, or force-pull production without explicit approval.

## 4. Stop app services before install

Because the merged changes include root npm workspace lockfile and dependency changes, stop runtime app services before changing `node_modules`.

### Preferred if direct sudo works

Run only for the runtime services:

```bash
sudo systemctl stop newsnexus12-api.service
sudo systemctl stop newsnexus12-worker-node.service
sudo systemctl stop newsnexus12-portal.service
sudo systemctl stop newsnexus12-worker-python.service
systemctl is-active newsnexus12-api.service newsnexus12-worker-node.service newsnexus12-portal.service newsnexus12-worker-python.service || true
```

Stopped services should show `inactive`.

### If direct sudo does not work

If direct `sudo systemctl` requires a password, use the approved nn12prod server-management path if one is configured. If no approved path is documented or available, stop and ask Nick to run these privileged commands.

Runtime services to stop:

```text
newsnexus12-api.service
newsnexus12-worker-node.service
newsnexus12-portal.service
newsnexus12-worker-python.service
```

Do not stop/start `newsnexus12-db-manager.service` during normal deployment.

After stopping, verify:

```bash
systemctl is-active newsnexus12-api.service newsnexus12-worker-node.service newsnexus12-portal.service newsnexus12-worker-python.service || true
```

## 5. Install dependencies

Prefer root `npm ci` because the root lockfile is committed and should be authoritative for the workspaces.

Run from repo root:

```bash
npm ci
```

Expected result:

- Install succeeds.
- Root install may print moderate vulnerability findings already documented in the repository.

If `npm ci` fails because of a lockfile/package mismatch, stop and report the failure. Do not fall back to `npm install` unless Nick explicitly approves it.

## 6. Verify builds and checks

Run the ordered root build:

```bash
npm run build
```

Expected result:

- `@newsnexus/db-models` build passes.
- `@newsnexus/db-manager` build passes.
- `newsnexus12api` build passes.
- `newsnexus12-worker-node` build passes.
- `newsnexus12portal` build passes.

The portal build may warn about multiple lockfiles/root inference. Treat that as a warning unless the build exits non-zero.

Run the portal lint gate:

```bash
npm run lint --workspace newsnexus12portal
```

Expected result for production `main` after merging `dev_12_lint_issues`:

- Portal lint should pass.
- The old `Cannot find module 'next/dist/compiled/babel/eslint-parser'` failure should not appear.
- If lint fails, report the exact failure family before continuing. Do not edit production files to work around lint unless Nick explicitly approves.

Run targeted audit checks:

```bash
npm audit --prefix portal --audit-level=moderate
npm audit --audit-level=moderate
```

Expected audit results:

- `npm audit --prefix portal --audit-level=moderate` should report `0 vulnerabilities`.
- Root `npm audit --audit-level=moderate` may fail with only the documented moderate residual findings. See `docs/20260522_WEEKLY_RESIDUAL_AUDIT_CHECK_SERVER_AGENT.md`.

If root audit shows high or critical findings, stop and report them to Nick. Do not apply broad fixes during deployment.

## 7. Production database and test guardrails

The production database name is the same as the development database name. This is expected, but it increases the importance of environment awareness.

Before running any test command that loads `.env` files or overrides database variables, inspect the command and environment carefully.

Rules:

- Do not run optional Jest tests against the live production database.
- Do not create, drop, restore, seed, truncate, or mutate the production database during this deployment.
- Do not run db-manager maintenance commands unless Nick explicitly approves the exact command.
- Do not change production `.env` database settings unless Nick explicitly approves the exact edit.
- If extra tests are desired, use a clearly throwaway test database name, not the production database name, and confirm the target database before running the tests.

Optional test gate only if a safe throwaway test database is configured:

```bash
bash -lc 'set -a; source db-manager/.env; set +a; PG_DATABASE=newsnexus_test_api_prod_deploy NODE_ENV=test npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts'

bash -lc 'set -a; source db-manager/.env; set +a; PG_DATABASE=newsnexus_test_worker_prod_deploy NODE_ENV=test npm test --workspace newsnexus12-worker-node -- --runInBand'

bash -lc 'set -a; source db-manager/.env; set +a; PG_DATABASE=newsnexus_test_dbm_prod_deploy NODE_ENV=test npm test --workspace @newsnexus/db-manager -- --runInBand'
```

If these fail because local test database roles or permissions are missing, report the exact failure. Do not modify production-like databases to make tests pass unless Nick explicitly approves that action.

## 8. Worker-node browser check

This deploy should not require a new Puppeteer browser install. If worker-node logs later show missing browser errors, run the browser install as the service user:

```bash
cd /home/limited_user/applications/NewsNexus12/worker-node
sudo -u limited_user npm run puppeteer:browsers:install
```

Do not run this unless needed or requested; it is not part of the default deploy.

## 9. Start services

After install and build verification pass, start the four runtime services. Use direct `sudo systemctl start ...` only if sudo works from the current shell. Otherwise use the approved nn12prod service-control path or ask Nick to run the privileged commands.

Start order:

```text
newsnexus12-worker-python.service
newsnexus12-worker-node.service
newsnexus12-api.service
newsnexus12-portal.service
```

Direct sudo version:

```bash
sudo systemctl start newsnexus12-worker-python.service
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl start newsnexus12-api.service
sudo systemctl start newsnexus12-portal.service
```

Then verify status:

```bash
systemctl is-active newsnexus12-worker-python.service newsnexus12-worker-node.service newsnexus12-api.service newsnexus12-portal.service
systemctl status newsnexus12-worker-python.service newsnexus12-worker-node.service newsnexus12-api.service newsnexus12-portal.service --no-pager -l --lines=30
```

If a service is not active, inspect logs before retrying:

```bash
journalctl -u newsnexus12-api.service -n 100 --no-pager -l
journalctl -u newsnexus12-worker-node.service -n 100 --no-pager -l
journalctl -u newsnexus12-worker-python.service -n 100 --no-pager -l
journalctl -u newsnexus12-portal.service -n 100 --no-pager -l
```

## 10. Smoke checks

Use the actual nn12prod service ports, not workstation defaults. First discover listening ports and service configuration if needed:

```bash
systemctl show newsnexus12-api.service newsnexus12-worker-node.service newsnexus12-worker-python.service newsnexus12-portal.service -p FragmentPath -p WorkingDirectory -p ExecStart --no-pager
ss -ltnp | grep -E ':(8001|8002|8003|8004|3000|3001|3002|5000)\b' || true
```

If production matches the observed nn12dev layout, expected ports are:

- API: `8001`
- Portal: `8002`
- Worker-node: `8003`
- Worker-python: `8004`

Run with the actual production ports:

```bash
curl -I http://127.0.0.1:8001
curl -I http://127.0.0.1:8002
curl -I http://127.0.0.1:8003
curl http://127.0.0.1:8004/
```

Expected result if ports match the standard layout:

- API `HEAD /`: `HTTP 200` or the service's documented healthy response.
- Portal `HEAD /`: `HTTP 200`.
- Worker-node `HEAD /`: `HTTP 200` or the service's documented healthy response.
- Worker-python `GET /`: `HTTP 200`.

Do not use `HEAD /` as the worker-python health check. It can return `405 Method Not Allowed` even when the service is healthy.

Connection refused, repeated 5xx errors, or systemd crash loops are failures.

## 11. Report to Nick

After the deployment attempt, report back in the current Hermes/Telegram conversation. Do not write Telegram credentials into this repository.

Successful deployment message:

```text
nn12prod deploy completed for NewsNexus12 main. git pull, npm ci, build, portal lint, audit checks, runtime service stop/start, and smoke checks completed. Root audit has only the documented residual moderate findings, if any.
```

Successful deployment with warning message:

```text
nn12prod deploy completed for NewsNexus12 main with warnings: <brief warning>. Service stop/start and smoke checks completed.
```

Blocked message:

```text
nn12prod deploy blocked for NewsNexus12 main. See server report/logs: <brief reason>.
```

## 12. Guardrails

- Do not run `npm audit fix --force`.
- Do not downgrade `next`, `exceljs`, or `sequelize`.
- Do not drop, recreate, restore, seed, truncate, or otherwise mutate the production database for this deployment.
- Do not run tests against the production database name.
- Do not run `npm install` if `npm ci` fails unless Nick approves.
- Do not restart or enable `newsnexus12-db-manager.service` unless Nick explicitly overrides the normal deployment rule.
- Do not commit server-generated files unless Nick explicitly asks.
- Do not use `git reset --hard`, force-pull, rebase, or merge on production unless Nick explicitly approves the exact action.
- Keep a short deployment note with command results if anything fails.
