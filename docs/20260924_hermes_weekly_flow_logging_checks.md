---
created_at: 2026-09-24T22:11:40Z
updated_at: 2026-09-24T22:11:40Z
created_by: codex (gpt-6) macbook-air
modified_by: codex (gpt-6) macbook-air
---

# Hermes: weekly flow production checks

## Purpose and limits

1. Inspect production evidence related to weekly run `3`, semantic job `0257`, and the failed alert publication on September 19, 2026.
2. Determine whether production can capture useful diagnostics on another failure and identify any alert-delivery blockers.
3. Perform read-only checks. The only permitted edit is filling in this document's findings sections and updating its `updated_at` and `modified_by` frontmatter. Preserve `created_at` and `created_by`.
4. Do not deploy, build, install, repair permissions, edit configuration, restart services, change timers, cancel jobs, or rerun the workflow.
5. Do not start the alert publisher, execute its helper, create a test alert, or run Obsidian sync. These actions write files or change production state.
6. Use existing authorized read access. If a check is denied, record the exact denial and stop that check. Do not change privileges to complete it.
7. Record concise, sanitized evidence. Never include credentials, complete environment files, authorization headers, or article contents. Do not create separate output files.

## Background

- The incident report establishes that one failed status request caused immediate cancellation. It does not establish the underlying connection failure.
- The failed publisher start suggests a permission problem, but its precise cause remains unconfirmed.
- Development logging changes are limited to `ops/weekly-article-flow`. They preserve request diagnostics, cancellation outcomes, publisher stderr, and failed-stage diagnostics. They introduce no retries or timeout changes.
- Those changes were not deployed during the development task. Check actual production source and compiled output rather than assuming they are installed.

## Checks and findings

For each finding, use `confirmed`, `suspected`, `not found`, or `unable to verify`. Include the command or evidence source, relevant timestamp, a short excerpt, and its interpretation. Missing evidence does not prove that an event did not occur.

### 1. Production identity and deployed logging

1. Record hostname, UTC inspection time, production checkout path, and Git revision using read-only commands.
2. Inspect the installed weekly service with `systemctl cat` and `systemctl show`. Record its user, working directory, executable, environment-file path, and drop-ins. Do not print environment contents.
3. Inspect its launcher to determine which compiled JavaScript it executes.
4. Check source and the actual compiled output for these event names:
   - `weekly_flow_poll_failed`
   - `weekly_flow_cancel_request_succeeded`
   - `weekly_flow_cancel_request_failed`
   - `weekly_flow_failed`
   - `weekly_flow_alert_failed`
5. Check for request cause/code, duration, endpoint, run/job context, publisher stderr, and failed-stage diagnostics. Report whether source and compiled output agree. Do not build or deploy.

#### Hermes findings

- Status:
- Host, UTC time, checkout, and revision:
- Installed service and executed build:
- Logging present or missing:
- Evidence and interpretation:

### 2. Publisher permission and service restrictions

1. Inspect the installed publisher unit, its drop-ins, helper, and `/etc/sudoers.d/newsnexus12-publish-weekly-alert` if readable.
2. Compare installed assets with the repository's `systemd/`, `libexec/`, and `sudoers/` files under `ops/weekly-article-flow`.
3. Verify that the effective sudo policy permits `limited_user` to run exactly `/usr/bin/systemctl start newsnexus12-publish-weekly-alert.service` as root without a password. Use policy listing only, never execute that command.
4. If already authorized, use `sudo -n -l -U limited_user` for policy inspection and `visudo -c` for syntax validation. Record denials; do not prompt for credentials or edit policy.
5. Inspect effective `NoNewPrivileges` and other restrictions on the weekly service. The repository template sets `NoNewPrivileges=true`; this can prevent sudo privilege elevation even when sudoers is correct.
6. If the weekly process is already running, inspect `NoNewPrivs` in `/proc/<MainPID>/status` if accessible. Do not start a process to reproduce this condition.
7. Distinguish shell-level sudo permission from permission inside the systemd service. A successful policy listing alone does not prove the service can elevate privileges.

#### Hermes findings

- Status:
- Effective sudo rule and syntax result:
- Service restrictions and process evidence:
- Installed/repository differences:
- Evidence and likely blocker, if any:

### 3. Alert paths and existing delivery evidence

1. Read the installed helper to confirm its actual paths. Repository defaults are:
   - Staged alert: `/home/limited_user/project_resources/NewsNexus12/weekly-flow/ALERT-newsnexus12-weekly-cron.md`
   - Vault: `/home/nick/NickVault`
   - Published alert: `/home/nick/NickVault/ALERT-newsnexus12-weekly-cron.md`
   - Temporary alert: `/home/nick/NickVault/.ALERT-newsnexus12-weekly-cron.md.tmp`
   - Sync executable: `/home/nick/.npm-global/bin/ob`
2. Inspect ownership, modes, symlinks, parent-directory traversal permissions, and relevant ACLs with read-only tools such as `stat`, `namei -l`, and `getfacl`.
3. Check whether the staged alert is readable by `limited_user`, the vault is writable by `nick` according to permissions, and the sync executable exists and is executable. Do not test by writing.
4. Check for a leftover temporary alert; report it without removing it.
5. Inspect existing staged/published alert timestamps and run IDs, plus publisher journal entries. Avoid assuming an existing alert belongs to run `3`.
6. Mark end-to-end publishing and sync as unverified unless existing evidence proves a specific past delivery. This task cannot verify a fresh delivery without prohibited writes.

#### Hermes findings

- Status:
- Paths, ownership, permissions, and temporary-file state:
- Existing delivery evidence and associated run:
- Checks unavailable without a write:

### 4. Incident and worker evidence

1. Inspect existing journals in UTC for `2026-09-19 08:09:30` through `08:11:00` for:
   - `newsnexus12-weekly-article-flow.service`
   - `newsnexus12-worker-node.service`
   - `newsnexus12-publish-weekly-alert.service`
2. Expand the window only if needed. Look for the original fetch error, sudo stderr, cancellation response, process restarts, and publisher launch evidence.
3. Inspect retained kernel/system evidence for memory exhaustion, killed processes, or resource pressure near that time. Current resource usage does not establish historical pressure.
4. If available through established read-only database access, inspect run `3` and its stage evidence, including the primary failure and reporting failure. Do not run application commands that initialize or synchronize the database.
5. Separate confirmed facts from possible explanations. Do not call the fetch failure transient, or attribute it to competing requests, without evidence.

#### Hermes findings

- Status:
- Primary failure evidence:
- Publisher failure evidence:
- Worker/system evidence:
- Confirmed explanation versus remaining uncertainty:

### 5. Log capture, retention, and deadlines

1. Verify the installed weekly and publisher units route stdout/stderr to journald.
2. Inspect effective journald storage/retention settings, available historical entries, disk usage, and rate-limit suppression messages. Do not rotate, vacuum, or change logs.
3. Check the configured weekly JSONL directory's existence and access permissions, plus existing run evidence. Do not create a test file.
4. Read only these non-secret configuration values from the installed environment file if authorized:
   - `WEEKLY_FLOW_SEMANTIC_TIMEOUT_SECONDS`
   - `WEEKLY_FLOW_RUN_TIMEOUT_SECONDS`
5. Report the configured durations in hours. Confirm the installed polling error behavior from code; do not infer that development recommendations introduced retries.

#### Hermes findings

- Status:
- Journal destinations, retention, and historical availability:
- JSONL location and access evidence:
- Semantic/run deadlines and current retry behavior:
- Remaining logging gaps:

## Hermes final assessment

1. Confirmed blockers:
   -
2. Suspected causes and supporting evidence:
   -
3. Evidence still missing or inaccessible:
   -
4. Recommended follow-up actions for operator review; do not execute:
   -
5. Can the currently deployed workflow capture a more informative recurrence? Explain briefly:
   -
6. Production changes made:
   - Confirm that no production changes were made and only this report was edited. Disclose any unintended action.
