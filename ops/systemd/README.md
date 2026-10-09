---
created_at: 2026-10-09T21:56:01Z
updated_at: 2026-10-09T21:56:01Z
created_by: codex (gpt-5.6-sol-pro) nicksmacbookair
modified_by: codex (gpt-5.6-sol-pro) nicksmacbookair
---

# Systemd Service Directives

This document explains selected directives in `newsnexus-weekly-flow-02.service`.

## `SuccessExitStatus=75`

Systemd normally treats only exit code `0` as success. This directive tells systemd to also treat exit code `75` as successful.

The guarded weekly-flow launcher returns `75` when another process already holds the workflow lock. The new invocation safely does nothing and is not reported as failed.

## `Restart=no`

Systemd does not automatically restart the service after it exits, whether it succeeds or fails.

After a failure, another run occurs only when an operator starts the service, the timer triggers it, or another systemd unit requests it.

## `TimeoutStartSec=infinity`

For this `Type=oneshot` service, systemd treats the complete workflow execution as its startup operation. This directive prevents systemd from terminating it because of an overall startup deadline.

The workflow's own phase-specific limits still apply.

## `KillMode=control-group`

When the service is stopped, systemd terminates all local processes in the service's control group, not only its main npm process.

This can include the shell launcher, Node.js process, and local child processes. It does not directly terminate jobs running in separate worker services.

## `StandardOutput=journal`

Systemd records the service's standard output in the systemd journal. This allows normal output to be retained without an open terminal.

View it with:

```bash
sudo journalctl -u newsnexus-weekly-flow-02.service
```

Follow new output with:

```bash
sudo journalctl -fu newsnexus-weekly-flow-02.service
```

## `StandardError=journal`

Systemd also records the service's standard error in the journal. This generally includes errors, warnings sent to standard error, launcher guard messages, and unhandled runtime errors.

Standard output and standard error appear in the same unit journal, with metadata identifying their original streams.
