---
created_at: 2026-09-04T17:05:31Z
updated_at: 2026-09-04T20:15:01Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Todo V01

## 1. Authority and Working Rules

This checklist implements:

- `docs/20260904_weekly_article_processing_cron_prd_v06.md`
- `docs/20260904_weekly_article_flow_plan_v01.md`

V06 amends only the identified V03 requirements. Preserve the existing weekly-flow stages, recovery rules, backup verification, worker checks, locking, evidence, alerts, and production schedule.

The operator accepts removal of the host allowlists, database allowlists, and development database confirmation. Do not restore or replace those controls.

Implementation rules:

- [ ] Preserve unrelated working-tree changes and inspect the diff before staging each phase.
- [ ] Keep implementation changes inside `ops/weekly-article-flow` and the two weekly-flow runbooks named by V06.
- [ ] Do not add a database migration, role, grant, service, timer, execution mode, or replacement database-name variable.
- [ ] Do not call `sequelize.sync()` from the configuration check.
- [ ] Keep the production timer disabled throughout implementation and supervised validation.
- [ ] Build `db-models` before testing or building the weekly-flow package.
- [ ] Use only an isolated test database for integration tests; never target development or production.
- [ ] Fix every regression introduced by a phase and rerun affected checks before committing.
- [ ] Update this todo's `updated_at` and `modified_by` whenever checking off tasks.
- [ ] Stage only files belonging to the completed phase and inspect `git diff --cached` before committing.
- [ ] Use a lowercase commit title of 50 characters or fewer.
- [ ] Include a concise commit body referencing this todo and the completed phase.
- [ ] Append one lowercase `co-authored-by: <agent name> (<model>)` line for each contributing agent.

## Phase 1: Configuration and Identity Contract

### Configuration types and parsing

- [x] Remove `devHosts`, `productionHosts`, `devDatabases`, and `productionDatabases` from `WeeklyFlowConfig`.
- [x] Stop parsing `WEEKLY_FLOW_DEV_HOSTS`, `WEEKLY_FLOW_PRODUCTION_HOSTS`, `WEEKLY_FLOW_DEV_DATABASES`, and `WEEKLY_FLOW_PRODUCTION_DATABASES`.
- [x] Remove the now-unused list and overlap helpers.
- [x] Do not add weekly-flow validation that duplicates the shared `PG_DATABASE` requirement.
- [x] Remove `expectedDevDatabase` from `WeeklyFlowCliOptions`.
- [x] Remove `--confirm-dev-database` from accepted CLI value flags and result construction.
- [x] Confirm the existing unknown-option error rejects `--confirm-dev-database`.
- [x] Preserve all four execution modes and the existing resume, canary-target, production-target, and live-AI option behavior.

### Shared production identity

- [x] Add one shared production identity function in a focused weekly-flow module.
- [x] Pass the execution mode, detected Linux username, and configured PostgreSQL user into the function.
- [x] Require Linux user `limited_user` only for production modes.
- [x] Require PostgreSQL role `newsnexus_app` only for production modes.
- [x] Use `production weekly flow must run as the limited_user account` for a Linux-user failure.
- [x] Use `production weekly flow must connect as the newsnexus_app database role` for a database-role failure.
- [x] Keep development modes free of production identity enforcement.
- [x] Export and reuse the function rather than duplicating constants, conditions, or messages.

### Normal preflight

- [x] Remove hostname allowlist selection and comparison from `runPreflight()`.
- [x] Remove database allowlist selection and comparison from `runPreflight()`.
- [x] Remove the destructive-development database confirmation check.
- [x] Route production Linux and PostgreSQL identity validation through the shared function.
- [x] Make preflight read hostname, `PG_DATABASE`, and `PG_USER` from the coordinator's effective runtime environment and injected identity dependencies consistently.
- [x] Preserve hostname, database name, database user, and source revision in preflight evidence.
- [x] Preserve explicit live-AI, resource, executable, disk, worker, database-authentication, active-prompt, and revision checks.
- [x] Preserve run creation and resume matching on mode, hostname, `PG_DATABASE`, and source revision.

### Tests

- [x] Remove obsolete allowlist fields from configuration, coordinator, preflight, and integration fixtures.
- [x] Remove `expectedDevDatabase` from CLI and coordinator test options.
- [x] Test successful configuration parsing when all four obsolete variables are absent.
- [x] Remove the obsolete overlap-rejection test and confirm matching database names no longer affect parsing.
- [x] Test that missing or invalid remaining configuration still fails clearly.
- [x] Test that `--confirm-dev-database` now produces the unknown-option error.
- [x] Preserve tests for four-mode parsing, resume IDs, canary targets, and production target rejection.
- [x] Test the two production identity failures independently with their exact messages.
- [x] Test that valid `limited_user` and `newsnexus_app` production identities proceed to retained checks.
- [x] Test that development destructive recovery no longer requires database confirmation.
- [x] Preserve coverage for live-AI permission, worker state, database authentication, prompt state, resources, disk, and revision evidence.
- [x] Preserve repository recovery tests for hostname, database, mode, and revision mismatches.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Run the focused weekly-flow configuration, preflight, coordinator, and repository tests.
- [x] Run `npm -C ops/weekly-article-flow test`.
- [x] Run `npm -C ops/weekly-article-flow run build`.
- [x] Fix failures and rerun every affected check.
- [x] Search TypeScript source and tests for obsolete fields and variables; allow `--confirm-dev-database` only in the regression test proving it is rejected.
- [x] Confirm the search retains hostname and database evidence and resume-context checks.
- [x] Check off completed Phase 1 tasks and update this document's modification metadata.
- [x] Stage only Phase 1 files and inspect `git diff --cached`.
- [x] Commit Phase 1 with a message referencing `20260904_weekly_article_flow_todo_v01.md` Phase 1.

## Phase 2: Read-only Configuration Check

### TypeScript entry point

- [x] Add a separate `src/configCheck.ts` entry point that compiles to `dist/configCheck.js`.
- [x] Accept `--mode` with one of the four existing `WeeklyArticleFlowMode` values without creating a fifth mode.
- [x] Parse the normal weekly-flow configuration and load the shared PostgreSQL connection configuration.
- [x] Detect the hostname and Linux username without consulting a host allowlist.
- [x] Call the Phase 1 shared production identity function.
- [x] Authenticate with PostgreSQL using a read-only connection query.
- [x] Print a secret-free success summary containing only mode, hostname, database name, and database user.
- [x] Exit nonzero with a clear, secret-free error when parsing, identity, or authentication fails.
- [x] Close Sequelize after successful authentication.
- [x] Close Sequelize after an authentication or later validation failure.
- [x] Add dependency seams so unit tests do not contact a live database.

### Command boundaries

- [x] Keep the configuration check separate from the coordinator and `run-weekly-flow`.
- [x] Do not acquire the weekly-flow `flock`.
- [x] Do not initialize workflow models or call `sequelize.sync()`.
- [x] Do not construct a weekly-flow repository or create or update a run row.
- [x] Do not construct a worker client or contact worker-node or worker-python.
- [x] Do not inspect resource files or directories.
- [x] Do not require worker queues to be idle.
- [x] Do not require `--allow-live-ai`.
- [x] Do not execute stages, change schema or data, or control services and timers.

### Shell and installer assets

- [x] Add executable `bin/run-config-check` with `set -euo pipefail`.
- [x] Resolve the package directory from the wrapper location.
- [x] Execute `dist/configCheck.js` directly and forward `"$@"` safely.
- [x] Add the wrapper to `install.sh` source-presence and Bash syntax checks.
- [x] Keep the production service and timer behavior unchanged.

### Tests

- [x] Test all four existing modes through the configuration-check entry point.
- [x] Test valid configuration and authentication return success.
- [x] Test configuration and authentication failures return nonzero without exposing secrets.
- [x] Test production uses `limited_user` and `newsnexus_app` through the shared identity function.
- [x] Test normal preflight and configuration check reject the same invalid identities with the same exact messages.
- [x] Test Sequelize closes on success and failure.
- [x] Assert that configuration checking does not initialize models, synchronize schema, create run state, contact workers, inspect resources, or require live-AI permission.
- [x] Add `run-config-check` to the shell-wrapper executable, safe-forwarding, and no-scheduler test matrix.
- [x] Assert the wrapper does not invoke `run-weekly-flow` or reference its lock.
- [x] Test that `install.sh --check` syntax-checks the new wrapper.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Run focused shared-identity, configuration-check, wrapper, and operational-asset tests.
- [x] Run `npm -C ops/weekly-article-flow test`.
- [x] Run `npm -C ops/weekly-article-flow run build`.
- [x] Run `ops/weekly-article-flow/install.sh --check`.
- [x] Fix failures and rerun every affected check.
- [x] Inspect `dist/configCheck.js` only as a generated build artifact and confirm the source entry point does not import coordinator, repository, worker, or stage modules.
- [x] Check off completed Phase 2 tasks and update this document's modification metadata.
- [x] Stage only Phase 2 files and inspect `git diff --cached`.
- [x] Commit Phase 2 with a message referencing `20260904_weekly_article_flow_todo_v01.md` Phase 2.

## Phase 3: Environment and Operator Documentation

### Environment example and package README

- [x] Remove all four obsolete allowlist variables from `ops/weekly-article-flow/.env.example`.
- [x] Add a credential-free comment stating that production weekly-flow execution expects `PG_USER=newsnexus_app`.
- [x] Do not add `WEEKLY_FLOW_DATABASE_NAME`, `WEEKLY_FLOW_DATABASES_NAME`, or another duplicate database variable.
- [x] Update the package README mode descriptions to remove allowlist and database-confirmation requirements.
- [x] Remove `--confirm-dev-database` from new-run and resume examples.
- [x] Document `run-config-check` as read-only and independent from locks, workers, stages, and live-AI permission.
- [x] Document that schema installation alone uses `newsnexus_boot`, while manual and scheduled production runs use `newsnexus_app`.

### Development runbook

- [x] Update `docs/20260903_weekly_article_flow_dev_test_runbook.md` to cite V06 as the current amendment.
- [x] Remove host and database allowlist checks and explanations.
- [x] Remove `--confirm-dev-database` from trigger and resume commands.
- [x] Keep explicit manual execution, target review, idle queues, destructive-stage warnings, evidence review, and isolated-test-database warnings.
- [x] Use `PG_DATABASE` as the only documented database name.

### Production activation runbook

- [x] Update `docs/20260903_weekly_article_flow_production_activation_runbook.md` to cite V06 and keep the timer disabled during all pre-activation work.
- [x] Require weekly-flow runtime configuration to use `PG_USER=newsnexus_app` without displaying the protected environment.
- [x] Remove the four obsolete allowlist entries while the timer is disabled.
- [x] Replace the schema command with the protected environment-loading invocation that overrides only `PG_USER=newsnexus_boot` for that command.
- [x] Add the protected `run-config-check --mode manual_production` invocation from V06.
- [x] Confirm the configuration check runs as Linux user `limited_user` and reports database role `newsnexus_app`.
- [x] Restore the required supervised `manual_production --allow-live-ai` run before activation.
- [x] Require idle worker queues and no active weekly run before the supervised run.
- [x] Require review of PostgreSQL, backup, worker, JSONL, journald, and alert evidence.
- [x] Require explicit operator approval before enabling the timer.
- [x] Preserve the future Friday 5:00 AM Pacific trigger check and `Persistent=true` catch-up warning.
- [x] State that the September 4 parser failure created no resumable run and must not use `--resume-run-id`.
- [x] Do not authorize role or grant changes, another package's environment changes, or replacement services.

### Phase verification and commit

- [x] Run `npm -C db-models run build`.
- [x] Run `npm -C ops/weekly-article-flow test`.
- [x] Run `npm -C ops/weekly-article-flow run test:integration` only with the isolated weekly-flow test database configured.
- [x] Confirm the integration harness tears down its disposable database.
- [x] Run `npm -C ops/weekly-article-flow run build`.
- [x] Run `ops/weekly-article-flow/install.sh --check`.
- [x] Search active weekly-flow source, tests, `.env.example`, README, and both runbooks for all four removed variables, `expectedDevDatabase`, and `--confirm-dev-database`.
- [x] Confirm remaining matches exist only in the explicit unknown-option regression test or historical PRDs, plans, todos, assessments, and incident reports.
- [x] Search the implementation for `sequelize.sync`, new database-name variables, new modes, and unexpected scheduler controls.
- [x] Inspect the complete diff for secrets, production values, unrelated changes, and accidental generated-file drift.
- [x] Fix failures and rerun every affected check.
- [x] Check off completed Phase 3 tasks and update this document's modification metadata.
- [x] Stage only Phase 3 files and inspect `git diff --cached`.
- [x] Commit Phase 3 with a message referencing `20260904_weekly_article_flow_todo_v01.md` Phase 3.

## Phase 4: Operator-gated Production Rollout

Do not begin this phase without explicit operator authorization to act on the production server.

### Safe deployment and validation

- [ ] Confirm the production timer is disabled before deployment or environment edits.
- [ ] Deploy the reviewed code, tests, environment example, README, and runbooks together.
- [ ] Confirm `/etc/newsnexus12/weekly-article-flow.env` remains a root-owned, non-symlink file with mode `0600`.
- [ ] Set only the weekly-flow production environment to `PG_USER=newsnexus_app`.
- [ ] Remove the four obsolete allowlist entries from weekly-flow environment files as cleanup.
- [ ] Do not change database roles, grants, or another package's environment.
- [ ] Build `db-models` before building the deployed weekly-flow package.
- [ ] Install or validate the weekly-flow schema with the one-command `PG_USER=newsnexus_boot` override.
- [ ] Install and verify production scheduler assets while leaving the timer disabled.
- [ ] Run the protected configuration check in `manual_production` mode.
- [ ] Stop and correct any configuration, identity, or PostgreSQL connection failure before running the flow.

### Supervised production run and activation

- [ ] Confirm worker queues are idle and no weekly run is active.
- [ ] Complete one supervised `manual_production --allow-live-ai` run.
- [ ] Do not resume the September 4 parser failure because it created no coordinator run.
- [ ] Review the run row, stage evidence, backup, worker jobs, JSONL, journald, and alert outcome.
- [ ] Correct failures and repeat validation only under the documented recovery rules.
- [ ] Obtain explicit operator approval after the supervised run succeeds.
- [ ] Confirm the next calendar occurrence is a future Friday at 5:00 AM `America/Los_Angeles`.
- [ ] Enable the production timer only after approval.
- [ ] Confirm the timer is enabled and active and reports the expected next trigger.
- [ ] Confirm the service remains inactive before the scheduled trigger.

### Phase verification and completion

- [ ] Record the deployed revision, configuration-check result, supervised run ID, final status, evidence locations, and timer state without recording secrets.
- [ ] Confirm no source changes were made directly on production.
- [ ] If rollout required repository corrections, return them to the normal test, review, staging, and commit process before redeployment.
- [ ] Check off completed Phase 4 tasks and update this document's modification metadata.
- [ ] Commit only if Phase 4 produced reviewed repository changes; otherwise report that deployment created no source commit.
