---
created_at: 2026-09-24T22:11:40Z
updated_at: 2026-09-24T23:32:58Z
created_by: codex (gpt-6) macbook-air
modified_by: hermes nws-nn12prod (gpt-5.6-sol)
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

- Status: confirmed.
- Host, UTC time, checkout, and revision: `nws-nn12prod`; inspected at `2026-09-24T23:09:56Z`; checkout `/home/limited_user/applications/NewsNexus12`; revision `7a95dd8b0ef8e76bed53a5bbcb1f6d2001b7ba76` on `dev_31_weekly_cron_fix`.
- Installed service and executed build: `systemctl cat/show newsnexus12-weekly-article-flow.service` confirms `User/Group=limited_user`, working directory at the checkout, environment file `/etc/newsnexus12/weekly-article-flow.env`, no drop-ins, and launcher `ops/weekly-article-flow/bin/run-weekly-flow`. The launcher executes `ops/weekly-article-flow/dist/cli.js`.
- Logging present or missing: all five requested event names and bounded request/cause/context diagnostics are present in `src`, including worker, method, endpoint, duration, timeout, status, nested cause/code, run/stage/job context, cancellation outcome, publisher stderr, and failed-stage diagnostics. None of the five event names is present in `dist`; compiled publisher errors also omit duration and stderr.
- Evidence and interpretation: `src/http/client.ts`, `src/stages/workers.ts`, `src/coordinator/index.ts`, and `src/alerts/index.ts` contain the new diagnostics. `dist/http/client.js`, `dist/stages/workers.js`, `dist/coordinator/index.js`, and `dist/alerts/index.js` remain dated September 4 and implement the old behavior. Source and compiled output do not agree, so the scheduled service will not use the new logging unless a separate build/deployment occurs.

### 2. Publisher permission and service restrictions

1. Inspect the installed publisher unit, its drop-ins, helper, and `/etc/sudoers.d/newsnexus12-publish-weekly-alert` if readable.
2. Compare installed assets with the repository's `systemd/`, `libexec/`, and `sudoers/` files under `ops/weekly-article-flow`.
3. Verify that the effective sudo policy permits `limited_user` to run exactly `/usr/bin/systemctl start newsnexus12-publish-weekly-alert.service` as root without a password. Use policy listing only, never execute that command.
4. If already authorized, use `sudo -n -l -U limited_user` for policy inspection and `visudo -c` for syntax validation. Record denials; do not prompt for credentials or edit policy.
5. Inspect effective `NoNewPrivileges` and other restrictions on the weekly service. The repository template sets `NoNewPrivileges=true`; this can prevent sudo privilege elevation even when sudoers is correct.
6. If the weekly process is already running, inspect `NoNewPrivs` in `/proc/<MainPID>/status` if accessible. Do not start a process to reproduce this condition.
7. Distinguish shell-level sudo permission from permission inside the systemd service. A successful policy listing alone does not prove the service can elevate privileges.

#### Hermes findings

- Status: confirmed configuration conflict; exact historical sudo stderr is unavailable.
- Effective sudo rule and syntax result: `sudo -n -l -U limited_user` confirms exactly `(root) NOPASSWD: /usr/bin/systemctl start newsnexus12-publish-weekly-alert.service`. Direct `sudo -n /usr/sbin/visudo -c` and reading `/etc/sudoers.d/newsnexus12-publish-weekly-alert` were denied with `sudo: a password is required`, so syntax could not be independently validated. The successful policy parse is supporting, not conclusive, syntax evidence.
- Service restrictions and process evidence: the weekly unit has effective `NoNewPrivileges=yes`; it is currently inactive with `MainPID=0`, so `/proc/<MainPID>/status` evidence is unavailable. The publisher unit is a root/root oneshot with no drop-ins, executes `/usr/local/libexec/newsnexus12-publish-weekly-alert`, and writes stdout/stderr to journald.
- Installed/repository differences: SHA-256 hashes match for the installed and repository publisher unit (`908c1907…e011`) and helper (`2b045e3c…6a6e`). The installed sudoers file was not readable for a hash comparison; policy listing matches the repository rule.
- Evidence and likely blocker, if any: the deployed coordinator invokes `/usr/bin/sudo -n /usr/bin/systemctl start …`. `NoNewPrivileges=yes` prevents a child from gaining privileges through setuid sudo even when sudoers authorizes the command. This is a confirmed configuration conflict and the likely reason the publisher unit never started, but the old compiled code discarded sudo stderr, so the September 19 cause cannot be proven from retained logs.

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

- Status: confirmed for static path prerequisites; end-to-end publication remains unverified.
- Paths, ownership, permissions, and temporary-file state: the installed helper uses the five documented fixed paths. The staging directory is `limited_user:limited_user` mode `2770`; the staged alert exists as `limited_user:limited_user` mode `0600`, so its owner can read it. NickVault is `nick:nick` mode `0775`, and `nick` has write permission. `/home/nick/.npm-global/bin/ob` resolves to an executable `nick:nick` CLI. Neither the published alert nor the fixed temporary file exists. `namei -l` and `getfacl` found no conflicting ACLs on existing paths.
- Existing delivery evidence and associated run: the staged alert mtime is `2026-09-19T08:09:52Z`. Database run `3` reporting evidence records the same staging path, helper events `staged` then `failed`, and `alert: weekly alert publisher failed with exit code 1`. The publisher unit has no journal entries in the inspected September 18–25 window, and no published alert exists. The staged file is mode `0600`, so its contents/run ID were not readable by the inspecting user; mtime and database evidence associate it with run `3` without proving current contents.
- Checks unavailable without a write: no publisher start, helper execution, test alert, vault write, or Obsidian sync was performed. Fresh end-to-end copy and sync therefore remain unverified.

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

- Status: confirmed incident sequence; root cause of the fetch failure remains unknown.
- Primary failure evidence: the weekly journal records `fetch failed` at `2026-09-19T08:09:52.453006Z`. Read-only PostgreSQL evidence for run `3` records status `failed`, stage `reporting`, primary `failureReason: fetch failed`, and semantic scorer job `0257` failed for the same reason.
- Publisher failure evidence: the weekly journal records `weekly flow alert failure: weekly alert publisher failed with exit code 1` at `08:09:52.431671Z`. Run `3` reporting evidence records the staged path and the same publisher failure. The publisher unit has no launch journal entry, consistent with failure before systemd started it.
- Worker/system evidence: worker-node logged job `0257` enqueue/start, successful status GETs at `08:09:40` and `08:09:43`, a successful cancellation POST at `08:09:52.320022Z`, and terminal cancellation after the run returned at `08:09:55`. No worker restart, kernel OOM, killed process, or nearby resource-pressure event was found. The weekly unit later reported a 2.9 GB memory peak.
- Confirmed explanation versus remaining uncertainty: a polling request failed, the coordinator immediately requested cancellation, and cancellation succeeded. Retained evidence does not expose the failed request's exception cause, code, endpoint, or duration, so it cannot establish network transience, contention, timeout, or another cause. The publisher's `NoNewPrivileges` conflict is strongly supported but historical stderr is missing.

### 5. Log capture, retention, and deadlines

1. Verify the installed weekly and publisher units route stdout/stderr to journald.
2. Inspect effective journald storage/retention settings, available historical entries, disk usage, and rate-limit suppression messages. Do not rotate, vacuum, or change logs.
3. Check the configured weekly JSONL directory's existence and access permissions, plus existing run evidence. Do not create a test file.
4. Read only these non-secret configuration values from the installed environment file if authorized:
   - `WEEKLY_FLOW_SEMANTIC_TIMEOUT_SECONDS`
   - `WEEKLY_FLOW_RUN_TIMEOUT_SECONDS`
5. Report the configured durations in hours. Confirm the installed polling error behavior from code; do not infer that development recommendations introduced retries.

#### Hermes findings

- Status: confirmed partial capture; deployed diagnostic detail is insufficient for the original polling cause.
- Journal destinations, retention, and historical availability: both installed units set `StandardOutput=journal` and `StandardError=journal`. Journald is active with persistent `/var/log/journal`; no explicit effective retention/rate override was found. It uses 959.7 MB and retains entries back to April 19, including the September 19 incident. No `Suppressed N messages` entry was found since September 1.
- JSONL location and access evidence: database run `3` identifies `/home/limited_user/project_resources/NewsNexus12/weekly-flow/weekly-flow-20260919.jsonl`. It exists as `limited_user:limited_user` mode `0600`, size 6,187 bytes, mtime `2026-09-19T08:09:52Z`. The inspecting user could stat but not read it (`PermissionError`); database stage results independently preserve the primary and reporting failures.
- Semantic/run deadlines and current retry behavior: `/etc/newsnexus12/weekly-article-flow.env` is root/root mode `0600`; reading the two requested values was denied, so their installed durations cannot be verified. The systemd outer timeout is 73 hours. Both source and deployed `pollQueueJob()` perform one status request per poll and immediately propagate any request error; there is no transient-error retry.
- Remaining logging gaps: the new source diagnostics are not in deployed `dist`. A recurrence would still leave journald, worker request logs, database stage results, and JSONL, but the weekly journal would likely retain only generic `fetch failed`; cancellation result, nested request cause/code, endpoint/duration, publisher stderr, and structured failed-stage context would remain absent.

## Hermes final assessment

1. Confirmed blockers:
   - The new diagnostic source is not compiled into the `dist` build executed by production.
   - `NoNewPrivileges=yes` conflicts with the weekly process's sudo-based publisher invocation; no published alert exists for run `3`.
2. Suspected causes and supporting evidence:
   - The alert failure was probably sudo privilege elevation blocked by `NoNewPrivileges`; exact sudo stderr was discarded by the deployed build.
   - The semantic failure originated in one status-poll request, but retained evidence does not establish why that request failed.
3. Evidence still missing or inaccessible:
   - Installed semantic and run timeout values, sudoers-file syntax/hash, staged alert contents, JSONL contents, and the original fetch exception cause.
   - Fresh publisher copy and Obsidian sync behavior cannot be verified without prohibited writes.
4. Recommended follow-up actions for operator review; do not execute:
   - Build, test, and deploy the logging commit before Friday, then verify the deployed `dist` contains all five event names.
   - Resolve the `NoNewPrivileges`/sudo design conflict, validate sudoers syntax as root, and perform a controlled publisher test outside this read-only task.
   - Add bounded, deadline-aware retries for transient poll failures if reducing recurrence risk is desired; the logging-only change does not add resilience.
5. Can the currently deployed workflow capture a more informative recurrence? Explain briefly:
   - Only partially. Journald, worker logs, database stage state, and JSONL should identify the stage/job and cancellation request. The currently executed build will not capture the new exception cause/code, request duration/endpoint, cancellation outcome event, publisher stderr, or structured final failure context.
6. Production changes made:
   - No production code, build output, configuration, permissions, services, timers, queues, databases, alerts, or vault files were changed. Only this report was edited. The pre-existing modified `package-lock.json` was not touched.
