---
created_at: 2026-09-04T17:03:20Z
updated_at: 2026-09-04T17:03:20Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Plan V01

## 1. Plan Basis

This plan implements `docs/20260904_weekly_article_processing_cron_prd_v06.md` for `ops/weekly-article-flow`.

V06 amends the active V03 requirements. Existing stage order, destructive-stage recovery, backup verification, worker checks, run locking, evidence, and production scheduling behavior remain unchanged.

The change removes redundant deployment-identity configuration, corrects the production PostgreSQL role, and adds a read-only configuration check. It does not add infrastructure, database schema, execution modes, or recurring computation.

The operator accepts the reduced safety from removing host and database allowlists and the development database confirmation. Implementation and assessment must treat those removals as settled requirements.

## 2. Configuration and CLI Contract

Simplify `src/config/index.ts` so `WeeklyFlowConfig` no longer contains development or production host and database arrays. `parseWeeklyFlowConfig()` will stop reading the four obsolete environment variables and remove the list and overlap helpers when they have no remaining callers.

`PG_DATABASE` remains owned by the shared `@newsnexus/db-models` connection configuration. The weekly-flow parser will neither duplicate its validation nor introduce another database-name variable.

Remove `expectedDevDatabase` from `WeeklyFlowCliOptions` and remove `--confirm-dev-database` from the accepted CLI flags. The existing unknown-option path will reject old commands rather than silently ignoring them.

The four existing modes remain the only execution selectors. Existing validation for resume IDs, canary targets, and live-AI permission remains in place.

## 3. Shared Production Identity

Add one small shared TypeScript module for the production identity contract. It will expose a function that receives the execution mode, detected Linux username, and configured PostgreSQL user.

For `manual_production` and `scheduled_production`, the function will independently require:

- Linux account `limited_user`
- PostgreSQL role `newsnexus_app`

Each failure will use the exact distinct message specified by V06. Development modes will pass without production identity enforcement.

Both normal preflight and the configuration-check entry point will call this function. Constants, conditions, and messages will not be duplicated between those callers.

## 4. Normal Preflight Changes

`runPreflight()` will stop selecting or comparing host and database allowlists. It will also stop comparing a destructive-development confirmation value with `PG_DATABASE`.

Preflight will continue detecting the hostname and reading `PG_DATABASE` and `PG_USER` for evidence. The configured environment supplied by the coordinator will be used consistently so identity checks and recorded evidence reflect the same runtime configuration.

Production identity validation will run through the shared function before expensive resource, worker, and database checks. All retained checks continue afterward, including:

- explicit live-AI permission
- required files and directories
- executable and disk-space checks
- worker health and idle-state checks
- PostgreSQL authentication
- the single active AI Approver V02 prompt
- source-revision resolution

Preflight evidence will keep the detected host, database name, database user, and revision. The coordinator and repository will continue using host, database, mode, and revision when creating or resuming a run.

## 5. Read-only Configuration Check

Add `src/configCheck.ts` as a separate executable entry point compiled to `dist/configCheck.js`. Add `bin/run-config-check` as a thin Bash wrapper that resolves the package directory and forwards arguments directly to that compiled file.

The configuration check will:

1. Accept one of the four existing modes through `--mode`.
2. Parse the normal weekly-flow environment configuration.
3. Load the shared PostgreSQL connection configuration.
4. Detect the hostname and Linux username.
5. Apply the shared production identity function.
6. Authenticate with PostgreSQL using a read-only connection query.
7. Print only mode, hostname, database name, and database user on success.
8. Close Sequelize in a `finally` path after connection handling succeeds or fails.

The entry point will expose dependency seams for unit tests so tests can prove behavior without reaching a live database.

This command will not initialize workflow models, call `sequelize.sync()`, construct the coordinator, create a repository or worker client, acquire the host lock, inspect resource paths, require live-AI permission, or create run evidence.

The wrapper will remain independent from `run-weekly-flow`; therefore it will never inherit that wrapper's `flock` behavior.

## 6. Operational Assets

Add `bin/run-config-check` to `install.sh` source validation and Bash syntax checks. The installer will continue treating production asset installation and timer activation as separate actions.

Extend the shell-wrapper test matrix to require the new wrapper to be executable, forward `"$@"` safely, and contain no scheduler controls. Add an explicit assertion that it neither invokes `run-weekly-flow` nor references the weekly-flow lock.

The systemd service and timer need no behavioral change. The service will continue passing `--mode scheduled_production --allow-live-ai` and running as `limited_user`.

## 7. Tests

Update shared configuration fixtures in unit, coordinator, and integration tests to remove the four allowlist fields. Remove `expectedDevDatabase` from CLI and coordinator fixtures.

Configuration tests will establish that:

- parsing succeeds without the obsolete variables
- old allowlist overlap behavior is gone
- remaining required settings still fail clearly when absent or invalid
- `--confirm-dev-database` is rejected as unknown
- production still rejects a canary target

Preflight tests will replace allowlist and development-confirmation cases with separate Linux-user and database-role cases. They will preserve coverage for live-AI permission, workers, resources, authentication, prompt state, and revision evidence.

Add focused tests for the shared identity function and configuration-check entry point. These will prove both entry points return the same production identity errors and that configuration checking closes the database connection on success and failure.

Configuration-check tests will also prove that all four modes are accepted and that no lock, run row, model synchronization, resource validation, worker request, or live-AI permission is involved.

Existing repository and coordinator recovery tests will retain their hostname, database, mode, and source-revision mismatch coverage. Integration tests will continue targeting only the isolated weekly-flow test database.

## 8. Configuration and Documentation

Update `ops/weekly-article-flow/.env.example` to remove the four obsolete variables. Add a credential-free comment that production weekly-flow execution expects `PG_USER=newsnexus_app`; do not add a duplicate weekly-flow database variable.

Update `ops/weekly-article-flow/README.md` and the Ubuntu development runbook to remove allowlist and confirmation instructions. Development commands will rely on their fixed wrapper modes and continue requiring `--allow-live-ai` for actual runs.

Revise the production activation runbook so it:

1. Keeps the timer disabled throughout configuration and supervised validation.
2. Sets the weekly-flow environment to `PG_USER=newsnexus_app`.
3. Removes obsolete allowlist entries while the timer is disabled.
4. Runs schema installation with a one-command `PG_USER=newsnexus_boot` override.
5. Runs the protected `run-config-check --mode manual_production` command.
6. Completes and reviews one supervised `manual_production` run.
7. Requires operator approval before enabling the timer.
8. Confirms the next Friday 5:00 AM Pacific trigger after activation.

The runbook will not instruct an agent to display the protected environment or change roles, grants, services, or another package's environment.

## 9. Verification and Rollout

Local verification will run in dependency order:

1. Build `db-models`.
2. Run weekly-flow unit tests.
3. Run weekly-flow integration tests against the isolated test database.
4. Build `ops/weekly-article-flow`.
5. Run `install.sh --check` for operational assets and shell syntax.
6. Search the active package and runbooks for removed variables, fields, and CLI arguments.

Production rollout will follow the revised activation runbook. Compatible code is deployed before obsolete environment entries are removed. The failed September 4 parser attempt is not resumed because it created no coordinator run.

Scheduling remains disabled until the configuration check and supervised production run succeed, evidence is reviewed, and the operator explicitly approves timer activation.

## 10. Expected Result

The same `PG_DATABASE` name may be used on development and production without a false overlap failure. Execution behavior will depend only on the explicit mode.

Production runtime work will use Linux user `limited_user` and PostgreSQL role `newsnexus_app`. Only the separately invoked schema command will use `newsnexus_boot`.

The new configuration check will catch parser, connection, and production identity failures before a real run while adding no lock, worker traffic, database mutation, or scheduled workload.
