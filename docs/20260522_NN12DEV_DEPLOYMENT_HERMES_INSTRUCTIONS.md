---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: hermes (gpt-5.5)
---

# nn12dev deployment instructions for Hermes

This file instructs the Hermes AI agent on nn12dev how to install, build, verify, and restart NewsNexus12 after pulling the Issue 4 audit-remediation branch.

These steps reflect the actual nn12dev service layout observed during the `dev_11_issue_4` deployment attempt.

## 1. Important context

- Target server: nn12dev, Ubuntu.
- Expected repo path: `/home/limited_user/applications/NewsNexus12`.
- Runtime app services on nn12dev:
  - `newsnexus12-api.service`
  - `newsnexus12-worker-node.service`
  - `newsnexus12-worker-python.service`
  - `newsnexus12-portal.service`
- Do **not** deploy `newsnexus12-db-manager.service` as a long-running app. The db-manager is a CLI/maintenance app and should remain outside the normal runtime restart set unless Nick explicitly says otherwise.
- This branch includes Node dependency and lockfile changes.
- This branch does not require a database drop, restore, or manual migration.
- The root audit is expected to still report 5 moderate residual findings. Do not treat that alone as a deploy blocker. See `docs/20260522_WEEKLY_RESIDUAL_AUDIT_CHECK_SERVER_AGENT.md`.
- Do not run `npm audit fix --force`.

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

- If `git status --short --branch` shows uncommitted local changes, stop and report them to Nick before pulling or switching branches.
- If Node is below v20, stop and report it. Next 16 and the root package require Node 20 or newer.
- If the service names differ from the expected names, use the actual `newsnexus12*` names from `systemctl list-units`.
- On nn12dev, Hermes may not have passwordless `sudo systemctl` access directly. If `sudo -n true` prints `sudo_needs_password`, use TheServerManager service-control path described below, or ask Nick to run the privileged systemctl commands.

## 3. Pull the branch

Use the branch Nick requests for the deployment. For the current Issue 4 work, the branch is expected to be:

```bash
dev_11_issue_4
```

Run:

```bash
git fetch origin dev_11_issue_4
git switch dev_11_issue_4
git pull --ff-only origin dev_11_issue_4
git status --short --branch
git log --oneline -5
```

If `git pull --ff-only` fails, stop and report the branch divergence to Nick.

## 4. Stop app services before install

Because this branch changes the root npm workspace lockfile and dependency layout, stop app services before changing `node_modules`.

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

### nn12dev Hermes fallback: TheServerManager service control

If direct `sudo systemctl` requires a password, control the four runtime services through the already-running TheServerManager API or dashboard. The sudoers CSV on nn12dev permits `start`, `stop`, and `status` for the four NewsNexus12 runtime services but does not grant `restart`, so perform a stop followed by a start rather than `restart`.

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

Run:

```bash
npm ci
```

Expected result on `dev_11_issue_4`:

- Install succeeds.
- Root install may print `5 moderate severity vulnerabilities`.

If `npm ci` fails because of a lockfile/package mismatch, stop and report the failure. Do not fall back to `npm install` unless Nick explicitly approves it.

## 6. Verify builds and checks

Run the ordered root build:

```bash
npm run build
```

Expected result on `dev_11_issue_4`:

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

Current known nn12dev result after the Issue 4 dependency fix:

- The old `Cannot find module 'next/dist/compiled/babel/eslint-parser'` failure should be gone.
- Lint currently still fails with `react-hooks/set-state-in-effect` errors. This means the parser/dependency issue is fixed, but the lint gate itself is not yet green.
- Treat new parser/module-resolution failures, high-severity lint config failures, or a different lint error family as deployment blockers to report.
- Treat the known `react-hooks/set-state-in-effect` failures as a remaining code/lint-cleanup issue, not as evidence that `npm ci` or Next package resolution is broken.

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

If root audit shows high or critical findings, stop and report them to Nick. Do not apply broad fixes during deployment.

## 7. Optional test gate

If nn12dev has the required test database credentials and this deployment window allows extra verification, use the db-manager bootstrap environment and safe throwaway test database names. Do not point tests at a production-like database name.

Run from repo root:

```bash
bash -lc 'set -a; source db-manager/.env; set +a; PG_DATABASE=newsnexus_test_api_issue4 NODE_ENV=test npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts'

bash -lc 'set -a; source db-manager/.env; set +a; PG_DATABASE=newsnexus_test_worker_issue4 NODE_ENV=test npm test --workspace newsnexus12-worker-node -- --runInBand'

bash -lc 'set -a; source db-manager/.env; set +a; PG_DATABASE=newsnexus_test_dbm_issue4 NODE_ENV=test npm test --workspace @newsnexus/db-manager -- --runInBand'
```

Expected result observed on nn12dev:

- API targeted AI Approver route test: `20/20` tests pass.
- Worker-node tests: `33/33` suites and `166/166` tests pass. Jest may still print the known async-handle warning after success; if the process exits `0`, record it as a warning, not a failure.
- db-manager tests: `9/9` suites and `146/146` tests pass.

If these fail because local test database roles or permissions are missing, report the exact failure. Do not modify production-like databases to make tests pass unless Nick explicitly approves that action.

## 8. Worker-node browser check

This branch should not require a new Puppeteer browser install. If worker-node logs later show missing browser errors, run the browser install as the service user:

```bash
cd /home/limited_user/applications/NewsNexus12/worker-node
sudo -u limited_user npm run puppeteer:browsers:install
```

Do not run this unless needed or requested; it is not part of the default deploy.

## 9. Start services

After install and build verification pass, start the four runtime services. Use direct `sudo systemctl start ...` only if sudo works from the current shell. Otherwise use TheServerManager service control.

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

Use the actual nn12dev service ports, not the old workstation defaults.

Observed nn12dev ports:

- API: `8001`
- Portal: `8002`
- Worker-node: `8003`
- Worker-python: `8004`

Run:

```bash
curl -I http://127.0.0.1:8001
curl -I http://127.0.0.1:8002
curl -I http://127.0.0.1:8003
curl http://127.0.0.1:8004/
```

Expected result observed on nn12dev:

- API `HEAD /`: `HTTP 200`
- Portal `HEAD /`: `HTTP 200`
- Worker-node `HEAD /`: `HTTP 200`
- Worker-python `GET /`: `HTTP 200`

Do not use `HEAD /` as the worker-python health check. It can return `405 Method Not Allowed` even when the service is healthy.

Connection refused, repeated 5xx errors, or systemd crash loops are failures.

## 11. Report to Nick

After the deployment attempt, report back in the current Hermes/Telegram conversation. Do not write Telegram credentials into this repository.

Successful deployment with known lint cleanup still open:

```text
nn12dev deploy completed for NewsNexus12 dev_11_issue_4. npm ci, build, portal audit, root audit verification, targeted tests, service stop/start, and smoke checks completed. Root audit still has only the documented 5 moderate residual findings. The old Next ESLint parser-resolution failure is fixed, but portal lint still fails on react-hooks/set-state-in-effect cleanup items.
```

Fully green success message, only if lint passes too:

```text
nn12dev deploy complete for NewsNexus12 dev_11_issue_4. npm ci, build, portal lint, portal audit, root audit verification, targeted tests, service stop/start, and smoke checks completed. Root audit still has only the documented 5 moderate residual findings.
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
- Do not restart or enable `newsnexus12-db-manager.service` unless Nick explicitly overrides the normal deployment rule.
- Do not commit server-generated files unless Nick explicitly asks.
- Keep a short deployment note with command results if anything fails.
