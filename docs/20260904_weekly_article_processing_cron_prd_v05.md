---
created_at: 2026-09-04T16:45:36Z
updated_at: 2026-09-04T16:45:36Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Processing Cron PRD V05

## Status

- Status: revised requirements amendment
- Base requirements: `docs/20260829_weekly_article_processing_cron_prd_v03.md`
- Supersedes: `docs/20260904_weekly_article_processing_cron_prd_v04.md`
- Assessment incorporated: `docs/20260904_weekly_article_processing_cron_prd_v04_assessment_claude.md`
- Reason: simplify environment selection and correct the production database-role contract
- Scope: `ops/weekly-article-flow` and its operator documentation

This V05 amendment supersedes only the conflicting host allowlist, database allowlist, development database confirmation, production database-role, and rollout-validation requirements in V03.

All other V03 requirements remain active, including execution modes, destructive-stage recovery, backup verification, worker checks, run locking, evidence, supervised production validation, and production timer rules.

## 1. Summary

The weekly flow will no longer maintain separate development and production host or database allowlists.

The flow will use the existing `PG_DATABASE` connection variable as its only configured database name. It will not introduce a replacement weekly-flow database-name variable.

Development and production behavior will continue to be selected by the explicit CLI execution mode. Development is manually initiated. Production is initiated manually or by the source-controlled systemd timer.

The production weekly flow will connect as `newsnexus_app`. The Linux process will continue running as `limited_user`. One-time schema installation will explicitly override the database role to `newsnexus_boot` for that command only.

A separate read-only `run-config-check` wrapper will validate configuration and PostgreSQL connectivity before a production run. It will not acquire the weekly-flow lock, create a run, execute stages, or contact workers.

## 2. Operator Decisions

### 2.1 Accepted Safety Trade-off

The operator's intent is clear. The operator understands and accepts the reduced safety caused by removing the host allowlists, database allowlists, and destructive-development confirmation argument.

Development runs, supervised production runs, and production timer activation are deliberate and carefully planned actions. The operator considers the removed checks over-engineered precautions that add configuration complexity without enough value for this deployment model.

During plan-and-vet review, agents must treat these removals as resolved. Agents must not flag the absence of these specific checks or recommend restoring them.

Agents may still flag implementation deviations, removal of other retained controls, or risks unrelated to these resolved decisions.

### 2.2 Configuration Validation

The operator accepts the assessment recommendation for a separate `bin/run-config-check` wrapper.

The wrapper will verify parsed weekly-flow configuration and PostgreSQL connectivity. It will remain independent from the host lock and normal coordinator execution.

### 2.3 Production Database Role

The production weekly flow will use `PG_USER=newsnexus_app`.

The preflight must require:

1. Linux runtime account `limited_user` for production modes.
2. PostgreSQL role `newsnexus_app` for production modes.

The schema installer alone will receive an explicit, one-command `PG_USER=newsnexus_boot` override.

Do not create or alter database roles. Do not change environment files or configuration for any package outside `ops/weekly-article-flow`.

## 3. Goals

1. Remove redundant environment configuration.
2. Eliminate the name-only database comparison that blocked the production timer.
3. Keep one authoritative database name in `PG_DATABASE`.
4. Keep execution mode selection explicit and auditable.
5. Use the established application database role for weekly runtime work.
6. Separate the Linux service account from the PostgreSQL role.
7. Provide a defined, non-mutating rollout validation command.
8. Preserve automatic hostname and database evidence for run history and recovery.
9. Preserve all unrelated weekly-flow safety and recovery behavior.
10. Avoid new infrastructure and unnecessary runtime work.

## 4. Non-goals

- Changing the weekly processing stages or their order.
- Changing which stages are destructive.
- Removing backup creation or verification.
- Removing the host lock or active-run database lock.
- Removing worker health, queue-idle, resource-path, disk-space, or timeout checks.
- Changing the Friday production schedule.
- Adding automatic environment detection.
- Adding a replacement database-name variable.
- Renaming either server's PostgreSQL database.
- Creating, altering, or granting database roles.
- Changing another package's environment file or database configuration.
- Making the configuration check contact workers or execute coordinator stages.

## 5. Removed Environment Variables

Remove these variables from the weekly-flow configuration contract:

```text
WEEKLY_FLOW_DEV_HOSTS
WEEKLY_FLOW_PRODUCTION_HOSTS
WEEKLY_FLOW_DEV_DATABASES
WEEKLY_FLOW_PRODUCTION_DATABASES
```

The coordinator must not require, parse, compare, or retain these values.

Remove them from:

1. `ops/weekly-article-flow/.env.example`
2. Development weekly-flow `.env` files
3. `/etc/newsnexus12/weekly-article-flow.env`
4. TypeScript configuration types and parsing
5. Unit and integration test fixtures
6. README and operator runbooks

Removing obsolete entries from deployed environment files is cleanup after compatible code is deployed. Their removal is not a gate because the revised parser ignores them.

The production systemd service will continue loading `/etc/newsnexus12/weekly-article-flow.env` for the remaining weekly-flow and PostgreSQL settings.

## 6. Authoritative Database Configuration

`PG_DATABASE` is the only database-name configuration used by the weekly flow.

The coordinator will continue using the established PostgreSQL variables required by `@newsnexus/db-models`, including `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, and any required authentication or schema values.

The weekly flow must not add `WEEKLY_FLOW_DATABASE_NAME`, `WEEKLY_FLOW_DATABASES_NAME`, or an equivalent duplicate.

The shared database connection already rejects a missing or empty `PG_DATABASE`. Do not add a duplicate `PG_DATABASE` requirement to `parseWeeklyFlowConfig()`.

## 7. Removed CLI Argument

Remove this CLI argument:

```text
--confirm-dev-database
```

Remove its corresponding `expectedDevDatabase` field and the preflight comparison against `PG_DATABASE`.

After migration, passing `--confirm-dev-database` must produce the normal unknown-option error. An outdated command must not appear to succeed while the argument is ignored.

Update the development destructive-recovery command to:

```bash
./bin/run-dev-destructive-recovery \
  --canary-target 25 \
  --allow-live-ai
```

## 8. Execution Mode Selection

Host or database allowlists are not needed to select the execution path.

The explicit `--mode` value remains authoritative:

1. `dev_canary`

   - Started manually through the development canary wrapper.
   - Keeps destructive maintenance disabled.

2. `dev_destructive_recovery`

   - Started manually through the destructive development wrapper.
   - Enables the planned destructive and recovery sequence.

3. `manual_production`

   - Started manually for the required supervised production run.
   - Uses the full production sequence.

4. `scheduled_production`

   - Started by the production systemd service and timer.
   - Uses the full production sequence.

The systemd unit must continue specifying `--mode scheduled_production`. Manual wrappers must continue supplying their fixed development modes.

No code should infer a mode from hostname, database name, environment-file location, or the presence of systemd.

## 9. Production Identity Contract

The production weekly-flow process has two separate identities:

1. Linux runtime account: `limited_user`
2. PostgreSQL runtime role: `newsnexus_app`

Split the existing combined preflight condition into two checks with distinct errors:

```text
production weekly flow must run as the limited_user account
production weekly flow must connect as the newsnexus_app database role
```

The weekly flow passes its runtime environment to its db-manager maintenance subprocesses. Those cleanup, backup, and deletion commands must therefore run as `newsnexus_app`.

Production evidence confirms `newsnexus_app` already has the required table and sequence privileges. This PRD does not authorize grant changes.

## 10. Schema Installation Contract

Schema installation is a one-time administrative action and is not part of the scheduled weekly flow.

The production activation runbook must source the protected weekly-flow environment, then override only `PG_USER` for the schema command:

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

The override must apply only to this command. `/etc/newsnexus12/weekly-article-flow.env` must retain `PG_USER=newsnexus_app` for manual and scheduled weekly runs.

## 11. Normal Preflight Behavior

Remove these preflight checks:

1. Current hostname is present in a mode-specific host allowlist.
2. `PG_DATABASE` is present in a mode-specific database allowlist.
3. Destructive development mode received an exact database confirmation argument.

Retain the remaining preflight checks required by V03, including:

- PostgreSQL connectivity and authentication
- separate production Linux and PostgreSQL identity checks
- required directories and files
- worker health and idle queues
- active AI Approver V02 prompt state
- executable availability
- disk-space threshold
- explicit live-AI permission

## 12. Configuration Check Command

### 12.1 Interface

Add this executable wrapper:

```text
ops/weekly-article-flow/bin/run-config-check
```

Invocation requires one of the existing execution modes:

```bash
./bin/run-config-check --mode <existing_mode>
```

The command is a separate entry point. It must not add a fifth `WeeklyArticleFlowMode` or route through `bin/run-weekly-flow`.

### 12.2 Required Checks

The command must:

1. Parse the normal weekly-flow configuration.
2. Load the shared PostgreSQL connection configuration.
3. Verify PostgreSQL connectivity with a read-only authentication query.
4. For production modes, require Linux account `limited_user`.
5. For production modes, require `PG_USER=newsnexus_app`.
6. Print a secret-free success summary containing the mode, detected hostname, database name, and database user.
7. Exit nonzero with a clear, secret-free message when a check fails.
8. Close its PostgreSQL connection before exiting.

### 12.3 Explicitly Skipped Work

The command must not:

- acquire the weekly-flow `flock`
- initialize or synchronize database tables
- create or update a `WeeklyArticleFlowRuns` row
- execute cleanup, backup, deletion, RSS, semantic, state, V02, reporting, or alert stages
- contact worker-node or worker-python
- require idle worker queues
- require `--allow-live-ai`
- inspect workflow resource files or directories
- alter data, schema, services, timers, or environment files

### 12.4 Production Invocation

Because the production environment file is root-owned with mode `0600`, use the established protected loading pattern:

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

Do not print or inspect the complete environment file during validation.

## 13. Run Evidence and Recovery

The coordinator must continue discovering the operating-system hostname automatically.

For each run, retain:

- detected hostname
- `PG_DATABASE` value
- source revision
- execution mode
- start and end evidence

These values are evidence, not environment allowlists.

Resume validation must continue requiring the current detected hostname, `PG_DATABASE`, execution mode, and source revision to match the persisted run context.

Removing configuration allowlists must not permit a run created elsewhere to be resumed accidentally.

## 14. Implementation Requirements

1. Remove the four allowlist fields from `WeeklyFlowConfig`.
2. Remove allowlist parsing and overlap rejection from `parseWeeklyFlowConfig()`.
3. Remove `expectedDevDatabase` from `WeeklyFlowCliOptions`.
4. Remove parsing for `--confirm-dev-database`.
5. Remove the three obsolete preflight checks.
6. Split production Linux and database identity checks.
7. Change the expected production database role to `newsnexus_app`.
8. Add the defined `run-config-check` wrapper and implementation.
9. Preserve automatic host and database evidence.
10. Preserve resume-context matching.
11. Update all affected test helpers and fixtures.
12. Update `.env.example`, README, development runbook, and production activation runbook.
13. Keep implementation changes inside `ops/weekly-article-flow` and its runbooks.

This change requires no database migration and no new service, timer, worker, table, database role, or environment variable.

## 15. Test Requirements

### 15.1 Configuration Tests

- Configuration succeeds without the four removed variables.
- Development and production database names are no longer modeled or compared.
- Missing required remaining configuration still fails clearly.
- `--confirm-dev-database` is rejected as unknown.
- No duplicate `PG_DATABASE` validation is added to the weekly-flow parser.

### 15.2 Mode Tests

- Each development wrapper supplies its intended fixed mode.
- Manual production accepts `--resume-run-id` and `--allow-live-ai`.
- Manual production rejects `--canary-target`.
- The systemd service supplies `scheduled_production`.

### 15.3 Preflight Tests

- Preflight does not compare the hostname with a configured hostname.
- Preflight does not compare `PG_DATABASE` with a second database variable.
- Destructive development mode does not require database confirmation.
- Production rejects a Linux runtime account other than `limited_user` with the Linux identity error.
- Production rejects a `PG_USER` other than `newsnexus_app` with the database identity error.
- Remaining production and resource checks still run.

### 15.4 Configuration Check Tests

- The wrapper does not route through `run-weekly-flow` or acquire its lock.
- All four existing modes are accepted without creating a new mode.
- Valid configuration plus successful PostgreSQL authentication exits zero.
- Configuration or authentication failure exits nonzero without secrets.
- Production identity checks use `limited_user` and `newsnexus_app`.
- No run row, database mutation, worker request, resource check, or live-AI permission occurs.
- The database connection closes on success and failure.

### 15.5 Recovery Tests

- Run creation still records detected hostname and `PG_DATABASE`.
- Resume succeeds when persisted context matches.
- Resume fails when hostname, database name, mode, or source revision differs.

### 15.6 Verification

1. Build `db-models` first.
2. Run weekly-flow unit tests.
3. Run weekly-flow integration tests against the isolated test database.
4. Build the weekly-flow package.
5. Run operational asset checks.
6. Confirm no test targets a development or production database.

## 16. Rollout Requirements

1. Keep the production timer disabled during implementation and validation.
2. Deploy code, tests, `.env.example`, and runbook changes together.
3. Set `PG_USER=newsnexus_app` only in the weekly-flow production environment.
4. Run schema validation with the one-command `newsnexus_boot` override.
5. Run `run-config-check` through the protected `runuser` invocation.
6. Confirm worker queues are idle and no weekly run is active.
7. Complete one supervised `manual_production` run as required by V03.
8. Review PostgreSQL, backup, worker, JSONL, journald, and alert evidence.
9. Obtain operator approval.
10. Enable the production timer.
11. Confirm its next Friday 5:00 AM Pacific trigger.
12. Remove obsolete allowlist entries from weekly-flow environment files as cleanup.
13. Remove `--confirm-dev-database` from saved development commands.

Do not change database roles, grants, or another package's environment file during rollout.

The failed September 4 timer attempt created no resumable coordinator run. Do not use `--resume-run-id` for that configuration-parser failure.

## 17. Acceptance Criteria

1. The coordinator starts without the four removed environment variables.
2. No weekly-flow host or database allowlist remains in runtime configuration.
3. `PG_DATABASE` is the only configured database name used by the coordinator.
4. `--confirm-dev-database` and `expectedDevDatabase` no longer exist.
5. Execution behavior is selected only by the explicit CLI mode.
6. Production runs as Linux user `limited_user` and PostgreSQL role `newsnexus_app`.
7. Schema validation alone uses the explicit `newsnexus_boot` override.
8. Production identity failures identify the failed identity separately.
9. `run-config-check` satisfies every boundary in section 12.
10. Hostname and database name remain recorded as run evidence.
11. Resume-context validation remains intact.
12. All unrelated V03 preflight and recovery safeguards remain intact.
13. `.env.example` has no parser contradiction or obsolete allowlist.
14. Development documentation contains no removed variables or argument.
15. Production documentation restores the supervised manual-production gate.
16. All affected tests, builds, integration checks, and operational checks pass.
17. Production scheduling remains disabled until the supervised production run succeeds and the operator approves activation.
