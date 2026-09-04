---
created_at: 2026-09-04T15:53:06Z
updated_at: 2026-09-04T15:59:05Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Processing Cron PRD V04

## Status

- Status: requirements amendment
- Base requirements: `docs/20260829_weekly_article_processing_cron_prd_v03.md`
- Reason: simplify environment selection after the first production timer failure
- Scope: weekly-flow host checks, database checks, CLI controls, configuration, tests, and operator documentation

This V04 amendment supersedes only the conflicting host allowlist, database allowlist, and development database confirmation requirements in V03.

All other V03 requirements remain active, including execution modes, destructive-stage recovery, backup verification, worker checks, run locking, evidence, supervised production validation, and production timer rules.

## 1. Summary

The weekly flow will no longer maintain separate development and production host or database allowlists.

The flow will use the existing `PG_DATABASE` connection variable as its only configured database name. It will not introduce a replacement weekly-flow database-name variable.

Development and production behavior will continue to be selected by the explicit CLI execution mode. Development is manually initiated. Production is initiated manually or by the source-controlled systemd timer.

## 2. Operator Decision

The operator accepts responsibility for configuring the intended PostgreSQL connection on each server and deliberately selecting the correct execution mode.

The following configuration checks are unnecessary for this deployment model:

1. Comparing development and production operating-system hostnames.
2. Comparing development and production database names.
3. Requiring a second CLI copy of the development database name before a destructive development run.

The development and production servers may use the same database name because each server connects to its own configured PostgreSQL environment.

### Accepted Safety Trade-off

The operator's intent is clear: the operator understands and accepts the reduced safety created by removing these checks.

Development runs, supervised production runs, and production timer activation are deliberate, carefully planned operator actions. The operator considers the removed host allowlists, database allowlists, and duplicate database confirmation to be over-engineered precautions that add configuration complexity without sufficient value for this operating model.

During plan-and-vet review, agents must treat this decision as resolved. They must not flag the removal or absence of these specific checks as a safety concern or recommend restoring them.

Agents may still flag an implementation that exceeds this amendment, removes another retained safeguard, or fails to follow the deliberate execution and rollout process.

## 3. Goals

1. Remove redundant environment configuration.
2. Eliminate the name-only database comparison that blocked the production timer.
3. Keep one authoritative database name in `PG_DATABASE`.
4. Keep execution mode selection explicit and easy to audit.
5. Preserve automatic hostname and database-name evidence for run history and recovery.
6. Preserve all unrelated weekly-flow safety and recovery behavior.
7. Avoid new runtime computation or infrastructure.

## 4. Non-goals

- Changing the weekly processing stages or their order.
- Changing which stages are destructive.
- Removing backup creation or backup verification.
- Removing the host lock or active-run database lock.
- Removing worker health, queue-idle, resource-path, disk-space, or timeout checks.
- Removing production service-account or database-role checks.
- Changing the Friday production schedule.
- Adding automatic environment detection.
- Adding a replacement database variable.
- Renaming either server's PostgreSQL database.

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

The production systemd service will continue loading `/etc/newsnexus12/weekly-article-flow.env` for the remaining weekly-flow and PostgreSQL settings.

## 6. Authoritative Database Configuration

`PG_DATABASE` is the only database-name configuration used by the weekly flow.

The coordinator must continue using the established PostgreSQL variables required by `@newsnexus/db-models`, including `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, and any required authentication or schema values.

The weekly flow must not add `WEEKLY_FLOW_DATABASE_NAME`, `WEEKLY_FLOW_DATABASES_NAME`, or an equivalent duplicate.

Normal configuration validation must still reject a missing or empty `PG_DATABASE` when the database layer requires it.

## 7. Removed CLI Argument

Remove this CLI argument:

```text
--confirm-dev-database
```

Remove its corresponding `expectedDevDatabase` field and the preflight comparison against `PG_DATABASE`.

After migration, passing `--confirm-dev-database` must produce the normal unknown-option error. This prevents outdated commands from appearing to succeed while being ignored.

Update the development destructive-recovery command to this form:

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

   - Started manually on production for the required supervised production run.
   - Uses the full production sequence.

4. `scheduled_production`

   - Started by the production systemd service and timer.
   - Uses the full production sequence.

The systemd unit must continue specifying `--mode scheduled_production`. The manual wrappers must continue supplying their fixed development modes.

No code should infer a mode from hostname, database name, environment-file location, or the presence of systemd.

## 9. Preflight Behavior

Remove these preflight checks:

1. Current hostname is present in the mode-specific host allowlist.
2. `PG_DATABASE` is present in the mode-specific database allowlist.
3. Destructive development mode received an exact database confirmation argument.

Retain the remaining preflight checks required by V03, including:

- PostgreSQL connectivity and authentication
- production runtime and database identities
- required directories and files
- worker health and idle queues
- active AI Approver V02 prompt state
- executable availability
- disk-space threshold
- explicit live-AI permission

## 10. Run Evidence and Recovery

The coordinator must continue discovering the operating-system hostname automatically.

For each run, retain:

- detected hostname
- `PG_DATABASE` value
- source revision
- execution mode
- start and end evidence

These values are evidence, not environment allowlists.

Resume validation must continue requiring the current detected hostname, `PG_DATABASE`, execution mode, and source revision to match the persisted run context. Removing configuration allowlists must not permit a run created elsewhere to be resumed accidentally.

## 11. Implementation Requirements

1. Remove the four allowlist fields from `WeeklyFlowConfig`.
2. Remove allowlist parsing and overlap rejection from `parseWeeklyFlowConfig()`.
3. Remove `expectedDevDatabase` from `WeeklyFlowCliOptions`.
4. Remove parsing for `--confirm-dev-database`.
5. Remove the three obsolete preflight checks.
6. Preserve automatic host and database evidence.
7. Preserve resume-context matching.
8. Update all affected test helpers and fixtures.
9. Update `.env.example`, README, development runbook, and production activation runbook.
10. Add a non-mutating configuration validation command for rollout use.

This change requires no database migration and no new service, timer, worker, table, or environment variable.

## 12. Test Requirements

### 12.1 Configuration tests

- Configuration succeeds without the four removed variables.
- Identical database names across development and production are no longer modeled or compared.
- Missing required remaining configuration still fails clearly.
- The removed CLI argument is rejected as unknown.

### 12.2 Mode tests

- Each development wrapper supplies its intended fixed mode.
- Manual production accepts only the existing production controls.
- The systemd service supplies `scheduled_production`.
- Production continues rejecting a canary target.

### 12.3 Preflight tests

- Preflight does not compare the detected hostname with a configured hostname.
- Preflight does not compare `PG_DATABASE` with a second database-name variable.
- Destructive development mode does not require database confirmation.
- Remaining production identity and resource checks still run.

### 12.4 Recovery tests

- Run creation still records the detected hostname and `PG_DATABASE`.
- Resume succeeds when persisted context matches.
- Resume fails when hostname, database name, mode, or source revision differs.

### 12.5 Verification

1. Build `db-models` first.
2. Run the weekly-flow unit tests.
3. Run the weekly-flow integration tests against the isolated test database.
4. Build the weekly-flow package.
5. Run the operational asset checks.
6. Confirm no test targets a development or production database.

## 13. Rollout Requirements

1. Keep the production timer disabled during implementation and validation.
2. Deploy the code, tests, `.env.example`, and runbook changes together.
3. Remove the four obsolete variables from each server's weekly-flow environment file.
4. Remove `--confirm-dev-database` from saved development commands.
5. Validate the completed production environment without executing a flow.
6. Complete one supervised `manual_production` run as required by V03.
7. Review PostgreSQL, backup, worker, JSONL, journald, and alert evidence.
8. Obtain operator approval.
9. Enable the production timer.
10. Confirm its next Friday 5:00 AM Pacific trigger.

The failed September 4 timer attempt created no resumable coordinator run. Do not use `--resume-run-id` for that configuration-parser failure.

## 14. Acceptance Criteria

1. The coordinator starts without the four removed environment variables.
2. No weekly-flow host or database allowlist remains in runtime configuration.
3. `PG_DATABASE` is the only configured database name used by the coordinator.
4. `--confirm-dev-database` and `expectedDevDatabase` no longer exist.
5. Execution behavior is selected only by the explicit CLI mode.
6. Hostname and database name remain recorded as run evidence.
7. Resume-context validation remains intact.
8. All unrelated V03 preflight and recovery safeguards remain intact.
9. `.env.example` can be used without creating a parser contradiction.
10. Development documentation contains no removed variables or argument.
11. Production documentation restores the supervised manual-production gate.
12. All affected tests, builds, integration checks, and operational checks pass.
13. Production scheduling remains disabled until the supervised production run succeeds and the operator approves activation.
