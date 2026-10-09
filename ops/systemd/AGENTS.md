# Systemd Unit Instructions

## Scope

- This directory is only for files intended to be installed in Ubuntu's `/etc/systemd/system/` directory.
- Keep repository copies of NewsNexus12 systemd unit files here, including `.service` and future `.timer` files.
- Do not store application source code, shell launchers, environment files, credentials, logs, or generated runtime files here.

## Unit Requirements

- Use absolute Ubuntu paths in unit directives.
- Run NewsNexus12 application processes as `limited_user` unless the operator explicitly approves another identity.
- Use the guarded workflow launcher rather than invoking compiled weekly-flow JavaScript directly.
- Do not configure automatic restarts for weekly-flow-02.
- Treat weekly-flow-02 exit status 75 as an expected no-op because it means another invocation holds the workflow lock.
- Preserve normal systemd process-group termination behavior so stopping a unit terminates its child processes.
- Never include secrets directly in a unit file.

## Installation

- Files in this directory are repository templates. Copy reviewed units to `/etc/systemd/system/` on the Ubuntu server.
- Run `sudo systemctl daemon-reload` after installing or changing a unit.
- Do not enable, start, stop, restart, or schedule a unit unless the operator explicitly requests it.
