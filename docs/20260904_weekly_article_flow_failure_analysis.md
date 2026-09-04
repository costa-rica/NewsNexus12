---
created_at: 2026-09-04T15:30:09Z
updated_at: 2026-09-04T15:30:09Z
created_by: codex (gpt-5.6-sol) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Flow Production Failure Analysis

## Conclusion

The production timer and systemd service worked. The coordinator refused to start because its configuration parser found `newsnexus_prod` in both the development and production database allowlists.

This was a safe failure. Configuration parsing stopped the process before database authentication, run creation, cleanup, backup, deletion, RSS collection, or AI processing. No failed weekly run row should have been created by this attempt.

The immediate error is caused by a mismatch between the safety rule and the server topology. Both servers use the database name `newsnexus_prod`, but they appear to be separate PostgreSQL instances on separate hosts.

There is also a deployment-process defect. The production activation runbook skipped the supervised manual-production gate required by the PRD, so the timer became the first production execution to validate this configuration.

## What Failed

The production service loaded these values from `/etc/newsnexus12/weekly-article-flow.env`:

```text
WEEKLY_FLOW_DEV_DATABASES=newsnexus_prod
WEEKLY_FLOW_PRODUCTION_DATABASES=newsnexus_prod
```

During startup, `parseWeeklyFlowConfig()` compares the two lists. It throws this error when any literal database name appears in both:

```text
development and production databases must not overlap: newsnexus_prod
```

The CLI parses configuration before it constructs or runs the coordinator. The failure therefore occurred earlier than the coordinator preflight described in the runbooks.

## Why Development Passed

The development `.env` used a placeholder for the production database:

```text
WEEKLY_FLOW_DEV_DATABASES=newsnexus_prod
WEEKLY_FLOW_PRODUCTION_DATABASES=replace_with_production_database
```

Those strings do not overlap, so configuration parsing succeeded. Development mode then accepted `newsnexus_prod` because it was in the development allowlist.

This result proved the development flow, but it did not prove that the completed production environment file could pass configuration parsing.

## Which Production File Matters

The scheduled systemd service declares:

```text
EnvironmentFile=/etc/newsnexus12/weekly-article-flow.env
```

That root-managed file is the production timer's authoritative source. Editing `ops/weekly-article-flow/.env` alone will not correct the scheduled service.

The committed `.env.example` also currently contains `newsnexus_prod` in both lists. It cannot pass the parser that it is intended to configure. Copying it to production reproduces the failure.

## Root Causes

1. The parser treats a database name as a globally unique database identity.

   - That assumption is valid only if development and production share one PostgreSQL cluster or follow globally distinct naming.
   - The reported servers instead appear to use the same database name on separate hosts and separate local PostgreSQL clusters.

2. The committed `.env.example` contradicts the parser.

   - The parser rejects overlapping database names.
   - The example assigns `newsnexus_prod` to both environments.

3. The production activation runbook contradicts the PRD.

   - PRD section 8.3 requires one supervised `manual_production` run before enabling the timer.
   - The production activation runbook says not to use manual-production mode and enables the timer without that run.

4. The rollout had no non-mutating configuration-validation gate.

   - File ownership, service health, schema, and timer timing were checked.
   - The exact environment consumed by systemd was not passed through the coordinator's parser before scheduling.

## Recommended Resolution

### 1. Pause scheduling

Disable the weekly timer while the configuration contract and rollout steps are corrected:

```bash
sudo systemctl disable --now newsnexus12-weekly-article-flow.timer
```

Preserve the service journal and failure report. Resetting the failed service state is cosmetic and can wait until after the correction.

### 2. Confirm the database topology

The production server agent should confirm, without printing passwords:

1. The operating-system hostname on each server.
2. `PG_HOST`, `PG_PORT`, and `PG_DATABASE` on each server.
3. Whether each server connects to its own PostgreSQL cluster.
4. The configured production `PG_USER`.

If both environments are separate PostgreSQL clusters, `newsnexus_prod` on development and `newsnexus_prod` on production are different database identities despite sharing a name.

### 3. Correct the safety model

For separate clusters on distinct operating-system hosts, update the coordinator so identical database names are allowed when the development and production host allowlists are disjoint.

The minimal safe correction is:

1. Keep rejection of overlapping development and production operating-system hosts.
2. Keep mode-specific checks requiring both the current host and `PG_DATABASE` to be allowlisted.
3. Remove the global name-only rejection between development and production database lists.
4. Add a test proving the same database name is accepted on disjoint host allowlists.
5. Retain tests rejecting overlapping host allowlists and a database not allowed for the selected mode.

For stronger protection, model an environment target as an explicit host-and-database pair. This avoids treating a database name alone as an identity and avoids accidental Cartesian combinations when multiple hosts or databases are configured.

Do not resolve this by putting a knowingly false development database name in the production file. That makes the parser pass but leaves the safety configuration inaccurate.

Renaming the development database to `newsnexus_dev` is another valid resolution. It is more operationally invasive because every development application, tool, and resource referring to the current database must be updated and retested.

### 4. Correct the example and runbook

Update `.env.example` so it agrees with the chosen safety model. It should pass the configuration parser before it is committed.

Update the production activation runbook to restore these gates:

1. Keep the timer disabled.
2. Validate the root-managed environment through a non-mutating configuration-check command.
3. Run the full production flow once under supervision in `manual_production` mode, as required by PRD section 8.3.
4. Review PostgreSQL evidence, backup verification, worker results, JSONL, journald, and any alert.
5. Enable the timer only after operator approval.

A dedicated `config:check` command is preferable to using the normal CLI because it can parse configuration and verify the selected environment without creating a run or executing a stage.

### 5. Check the next likely preflight failure

Production preflight requires both the operating-system user and `PG_USER` to equal `limited_user`.

The general Ubuntu PostgreSQL setup document uses `newsnexus_app` for application connections. Confirm the weekly production environment intentionally uses a database role named `limited_user` with the required privileges.

Do not weaken this check merely to get past preflight. Resolve the intended database-role contract first if production currently uses `newsnexus_app`.

### 6. Revalidate before activation

After the source, environment, and runbook corrections:

1. Build and run the weekly-flow unit tests.
2. Install the corrected production assets while leaving the timer disabled.
3. Run the non-mutating configuration check using `/etc/newsnexus12/weekly-article-flow.env` as `limited_user`.
4. Confirm the worker queues are idle and no weekly run is active.
5. Complete the supervised manual-production run.
6. Inspect all required evidence.
7. Obtain operator approval.
8. Enable the timer and confirm the next Friday 5:00 AM Pacific trigger.

Do not resume the failed timer attempt. It failed before a coordinator run existed, so there is no run ID or persisted stage state to resume.

## Open Questions

### 1. Separate PostgreSQL clusters

Do `nws-nn12dev` and `nws-nn12prod` each connect to their own PostgreSQL cluster, even though both databases are named `newsnexus_prod`?

#### Operator Response

(codex) Ask each server agent to report hostname, PG host, port, and database name without credentials.

### 2. Production database role

What is `PG_USER` in `/etc/newsnexus12/weekly-article-flow.env`, and was that role intentionally created as `limited_user`?

#### Operator Response

(codex) Confirm this before the supervised run because it is the next explicit production preflight gate.

### 3. Manual production evidence

Has any complete `manual_production` run already succeeded on `nws-nn12prod` with evidence recorded in PostgreSQL and JSONL?

#### Operator Response

(codex) If not, keep the timer disabled until this PRD-required gate succeeds.

### 4. Preferred identity model

Should the implementation allow the same database name on disjoint hosts, or should the development database be renamed to `newsnexus_dev`?

#### Operator Response

(codex) Recommend host-and-database identity validation; avoid renaming a working development database solely for this parser rule.
