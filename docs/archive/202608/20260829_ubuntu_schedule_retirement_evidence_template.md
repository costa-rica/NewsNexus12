---
created_at: 2026-08-29T22:03:49Z
updated_at: 2026-08-29T22:03:49Z
created_by: codex (gpt-5.6) nicksmacbookair
modified_by: codex (gpt-5.6) nicksmacbookair
---

# Ubuntu Schedule Retirement Evidence Template

## 1. Use

- Purpose: record sanitized evidence that every existing NewsNexus12 Ubuntu-level schedule was retired
- Execution gate: Operator Gate B in `20260829_legacy_v01_removal_todo_v02.md`
- Contains secrets: no
- Contains unrelated host inventory: no
- Status: not executed

Do not fill this template during Mac workstation implementation. Ubuntu inspection and mutation require separate operator authorization.

## 2. Authorization

- Operator authorization recorded at:
- Authorized operator:
- Host identifier:
- Deployed Git revision:
- Audit started at:
- Audit completed at:

## 3. Pre-retirement Checks

1. Confirm the target is the intended NewsNexus12 Ubuntu host.
2. Confirm no unrelated services are included.
3. Inventory active NewsNexus12 child jobs before stopping triggers.
4. Record how each active child job reached a safe terminal state.

## 4. Systemd Inventory

For every matching timer or service, record:

- Unit name:
- Initial load state:
- Initial active state:
- Initial enabled state:
- Initial next trigger:
- Active child execution:
- Retirement action:
- Final load state:
- Final active state:
- Final enabled state:
- Final next trigger:

Known names to recheck:

- `newsnexus12-worker-node-orchestrator-weekly.timer`
- `newsnexus12-worker-node-orchestrator-weekly.service`
- `newsnexus12-db-manager.timer`
- `newsnexus12-db-manager.service`

## 5. Hermes Inventory

For every matching job, record:

- Job ID:
- Job name:
- Initial enabled state:
- Initial next trigger:
- Retirement action:
- Final enabled state:
- Final next trigger:

Known dated-assessment job to recheck:

- ID: `2c4cdcc53964`
- Name: `NewsNexus12 weekly Google RSS — Friday 5am Pacific`

## 6. Cron Inventory

Record findings separately for:

1. Application-user crontab.
2. Root crontab.
3. `/etc/crontab`.
4. `/etc/cron.d/`.
5. Other `/etc/cron*` locations containing NewsNexus12 entries.

For each entry, record:

- Owner or location:
- Sanitized command description:
- Initial schedule:
- Retirement action:
- Final verification:

## 7. Removal and Reload Evidence

- Obsolete unit files removed:
- Obsolete scheduler definitions removed:
- Systemd daemon reload completed:
- Failed units reset if applicable:
- Remaining NewsNexus12 timers:
- Remaining NewsNexus12 scheduler jobs:
- Remaining NewsNexus12 cron entries:
- Remaining active scheduled executions:

## 8. Exceptions

- Unidentified caller or schedule found:
- Reason it could not be safely retired:
- Deployment stopped: yes or no
- Operator decision required:

## 9. Final Result

- All NewsNexus12 schedules retired:
- No next trigger remains:
- No active scheduled execution remains:
- Evidence reviewed by:
- Review timestamp:
- Notes:
