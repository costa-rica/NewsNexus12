---
created_at: 2026-11-07T17:23:52Z
updated_at: 2026-11-07T17:23:52Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Codex CLI production runbook

This runbook covers how the NewsNexus12 workers on `nws-nn12prod` use the Codex CLI, and how to re-authenticate, upgrade, and roll back.

- It replaces `docs/CODEX_CLI_SERVER_SETUP.md` and `docs/20261006_CODEX_CLI_SERVER_SETUP.md`. Both were written for `nws-nn12dev` and are archived.
- Run every command on `nws-nn12prod`, as `nick` over SSH, unless a step says otherwise.
- Never copy, print, paste, or hash `auth.json` files, tokens, or device-login codes.

## 1. Current production setup

Verified on November 7, 2026, during the Codex recovery (see `docs/archive/202611/20261107_codex_production_recovery_plan_v03.md`).

### 1.1 One shared executable

- Path: `/usr/local/bin/codex`.
- Format: standalone musl binary from the official GitHub release, not the npm package.
- Version: `codex-cli 0.166.0`.
- Owner and mode: `root:root`, `0755`.
- Nick's private npm install was removed. `command -v codex` as Nick resolves `/usr/local/bin/codex`.

Keep the standalone format. The npm launcher needs `node`, and worker-python's service PATH cannot find it.

### 1.2 Separate login profiles

The binary is shared. Authentication is not.

| Linux user     | Codex profile                 | Used by                      |
| -------------- | ----------------------------- | ---------------------------- |
| `limited_user` | `/home/limited_user/.codex`   | worker-node and worker-python |
| `nick`         | `/home/nick/.codex`           | Nick's shell and Hermes      |

- Both profiles report `Logged in using ChatGPT`.
- That does not prove they use the same ChatGPT account or workspace.
- Re-authenticating one profile does not affect the other.

### 1.3 How each worker reaches Codex

| Setting           | worker-node                                 | worker-python                                               |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Unit              | `newsnexus12-worker-node.service`           | `newsnexus12-worker-python.service`                         |
| Service user      | `limited_user`                              | `limited_user`                                              |
| Service PATH      | `/usr/bin:/usr/local/bin`                   | `/home/limited_user/environments/news_nexus_12/bin`         |
| `codex` resolves  | `/usr/local/bin/codex`                      | `.../news_nexus_12/bin/codex`, a symlink to `/usr/local/bin/codex` |
| Feature           | State assigner (Phase 6)                    | AI Approver V02 (Phase 7)                                   |
| Model setting     | `STATE_ASSIGNER_MODEL_NAME`                 | `AI_APPROVER_V02_MODEL_NAME`                                |
| Timeout setting   | `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS`      | `AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS`                     |
| Prompt delivery   | stdin                                       | command argument                                            |

- Both production model settings are `gpt-6-luna`.
- Neither unit sets `HOME` or `CODEX_HOME` explicitly. The profile resolves to `/home/limited_user/.codex` through the service user's home directory.
- Both workers run `codex` by bare name and pass no environment override, so each Codex process inherits the worker's PATH and HOME.
- worker-node uses Codex only when `USE_OPEN_AI_API` is unset or false-like. See `worker-node/AGENTS.md`.

### 1.4 Command the workers run

Both workers start a new Codex process for each article:

```bash
codex exec --ephemeral --skip-git-repo-check -s read-only --output-last-message <tempfile> -m <model> <prompt or ->
```

- Each call reads the profile fresh. A login change takes effect on the next call without a worker restart.
- Each call runs from the system temp directory, not the repository.

### 1.5 Expected warnings

These appear on stderr in every call and are harmless today:

- `Codex could not find bubblewrap on PATH`. Codex uses its bundled copy.
- `Code Mode is unavailable because failed to spawn code-mode host`. The workers do not use Code Mode.

## 2. Telling failures apart

Look at the worker journals first:

```bash
sudo journalctl -u newsnexus12-worker-node.service --since "1 hour ago" --no-pager | tail -n 100
sudo journalctl -u newsnexus12-worker-python.service --since "1 hour ago" --no-pager | tail -n 100
```

| Symptom                                                                 | Likely cause                          | Go to      |
| ----------------------------------------------------------------------- | ------------------------------------- | ---------- |
| `login status` is not `Logged in using ChatGPT`, or errors mention login, refresh, or 401 | Expired or missing login | Section 4  |
| `model_not_found` or `model is not supported when using Codex with a ChatGPT account` | Model not available to this client or account | Section 5, then the account |
| `codex CLI not found on PATH` (worker-node) or `codex_process_error` (worker-python) | Binary missing or PATH changed | Section 3  |
| `codex_timeout` or Codex timeout errors                                 | Slow model or network; not auth      | Timeout settings |

- The exact error text for an expired login has not been captured on this server yet. Add it here the first time it happens.
- A model rejection is not an auth failure. Do not re-authenticate because of `model_not_found` alone.
- Both workers keep going after each failed article. One bad setting can fail a whole batch while the job still shows as completed. Check the failed counts.

## 3. Health check without a model call

Safe at any time. These do not call a model or change anything.

```bash
command -v codex
codex --version
codex login status
```

```bash
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /bin/sh -c 'command -v codex; codex --version; codex login status'
```

```bash
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/home/limited_user/environments/news_nexus_12/bin \
  /bin/sh -c 'command -v codex; codex --version'
```

```bash
readlink -f /home/limited_user/environments/news_nexus_12/bin/codex
sudo ls -ld /home/limited_user/.codex
sudo ls -l /home/limited_user/.codex/auth.json
```

Expected:

1. Every version line matches.
2. The symlink resolves to `/usr/local/bin/codex`.
3. Both login checks print `Logged in using ChatGPT`.
4. `/home/limited_user/.codex` is `limited_user:limited_user`, mode `700`.
5. `auth.json` is `limited_user:limited_user`, mode `600`.

## 4. Re-authenticate the service user

Do this when Section 2 points to an expired or missing login.

### 4.1 Pause work

1. Check that no job is running or waiting:

   ```bash
   systemctl show newsnexus-weekly-flow-02.timer newsnexus-weekly-flow-02.service --property=Id,ActiveState,UnitFileState
   curl --fail --silent --show-error http://127.0.0.1:8003/queue-info/queue_status
   curl --fail --silent --show-error http://127.0.0.1:8004/queue-info/queue-status
   ```

2. Note whether the timer was active. Then pause scheduling and stop both workers:

   ```bash
   sudo systemctl stop newsnexus-weekly-flow-02.timer
   sudo systemctl stop newsnexus12-worker-node.service
   sudo systemctl stop newsnexus12-worker-python.service
   ```

3. Confirm no Codex process is left. No output is the expected result:

   ```bash
   sudo pgrep -a -x codex
   ```

Stopping the workers is not strictly needed for the login to apply. It keeps a running job from failing articles partway through the login change.

### 4.2 Log in with a device code

```bash
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/codex login --device-auth
```

1. Open the URL it prints on any browser, such as on the Mac.
2. Sign in with the ChatGPT account and workspace the workers should use.
3. Enter the code. Treat the code as secret.

- Device login avoids the browser callback on `localhost`, which a headless server cannot receive.
- Do not run `codex logout` first unless the current login is for the wrong account. It deletes the login.
- Do not copy Nick's `auth.json` into the service profile. That was the old setup method and is retired.

### 4.3 Verify

```bash
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/codex login status
sudo ls -ld /home/limited_user/.codex
sudo ls -l /home/limited_user/.codex/auth.json
```

Fix ownership or modes only if they are wrong:

```bash
sudo chown limited_user:limited_user /home/limited_user/.codex /home/limited_user/.codex/auth.json
sudo chmod 700 /home/limited_user/.codex
sudo chmod 600 /home/limited_user/.codex/auth.json
```

### 4.4 Test the model as the service user

This makes one live model call. It does not process articles.

```bash
(
  cd /tmp || exit 1
  sudo -u limited_user env -i \
    HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
    PATH=/usr/local/bin:/usr/bin:/bin \
    /usr/local/bin/codex exec --ephemeral --skip-git-repo-check \
      -s read-only -m gpt-6-luna 'Reply with OK'
)
```

- Expected: `OK` after the warnings in Section 1.5.
- Use the model from the worker `.env` files if it has changed from `gpt-6-luna`.

### 4.5 Resume

```bash
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl start newsnexus12-worker-python.service
systemctl is-active newsnexus12-worker-node.service newsnexus12-worker-python.service
```

1. Optionally run a small state-assigner and AI Approver V02 job, and check durable rows, not only job status.
2. Restart the timer only if it was active before Section 4.1:

   ```bash
   sudo systemctl start newsnexus-weekly-flow-02.timer
   systemctl list-timers --all newsnexus-weekly-flow-02.timer --no-pager
   ```

### 4.6 Re-authenticate Nick

Nick's login is separate and does not affect the workers. As `nick`:

```bash
codex login --device-auth
codex login status
```

## 5. Upgrade the shared executable

Upgrade when a model needs a newer client, or to stay current. Pin an exact version each time.

1. Pause work as in Section 4.1.
2. Set the version and replace the binary. This checks the download against the release's official SHA-256 and keeps the current binary as a backup:

   ```bash
   (
     set -eu
     new_version=0.000.0   # set to the exact target release, for example 0.170.0
     test "$(hostname -s)" = nws-nn12prod
     test "$(uname -m)" = x86_64
     test ! -L /usr/local/bin/codex
     old_version=$(/usr/local/bin/codex --version | awk '{print $2}')
     test ! -e "/usr/local/bin/codex-${old_version}.pre-upgrade"
     work=$(mktemp -d /tmp/newsnexus-codex.XXXXXX)
     cd "$work"
     curl --fail --location --silent --show-error --output release.json \
       "https://api.github.com/repos/openai/codex/releases/tags/rust-v${new_version}"
     curl --fail --location --silent --show-error --output codex.tar.gz \
       "https://github.com/openai/codex/releases/download/rust-v${new_version}/codex-x86_64-unknown-linux-musl.tar.gz"
     NEW_VERSION="$new_version" /usr/bin/python3 - <<'PY'
   import hashlib, json, os, pathlib
   release = json.loads(pathlib.Path('release.json').read_text())
   assert release['tag_name'] == 'rust-v' + os.environ['NEW_VERSION'], 'Unexpected release'
   asset = next(a for a in release['assets']
                if a['name'] == 'codex-x86_64-unknown-linux-musl.tar.gz')
   actual = 'sha256:' + hashlib.sha256(pathlib.Path('codex.tar.gz').read_bytes()).hexdigest()
   assert asset.get('digest') == actual, 'Missing or mismatched SHA-256; stop'
   print('SHA-256 matches the official release')
   PY
     tar -xzf codex.tar.gz codex-x86_64-unknown-linux-musl
     ./codex-x86_64-unknown-linux-musl --version | grep -Fx "codex-cli ${new_version}"
     sudo cp --preserve=mode,ownership,timestamps \
       /usr/local/bin/codex "/usr/local/bin/codex-${old_version}.pre-upgrade"
     sudo install -o root -g root -m 0755 \
       codex-x86_64-unknown-linux-musl /usr/local/bin/codex.new
     sudo mv -T /usr/local/bin/codex.new /usr/local/bin/codex
     /usr/local/bin/codex --version
   )
   ```

3. Run the health check in Section 3. All versions must match the new one.
4. Run the model test in Section 4.4.
5. Resume as in Section 4.5.
6. Update the version in Section 1.1 of this runbook.

- Upgrading does not change either login. Do not re-authenticate just because of an upgrade.
- Before choosing a new model name, confirm the target version's bundled catalog lists it: `https://raw.githubusercontent.com/openai/codex/rust-v<version>/codex-rs/models-manager/models.json`.

### 5.1 Roll back

With both workers stopped, restore the saved binary and keep the failed one:

```bash
(
  set -eu
  old_version=0.000.0   # the version saved as .pre-upgrade
  failed_version=$(/usr/local/bin/codex --version | awk '{print $2}')
  test ! -e "/usr/local/bin/codex-${failed_version}.failed"
  sudo cp --preserve=mode,ownership,timestamps \
    /usr/local/bin/codex "/usr/local/bin/codex-${failed_version}.failed"
  sudo install -o root -g root -m 0755 \
    "/usr/local/bin/codex-${old_version}.pre-upgrade" /usr/local/bin/codex.rollback
  sudo mv -T /usr/local/bin/codex.rollback /usr/local/bin/codex
  /usr/local/bin/codex --version
)
```

Then run Section 3 before starting the workers.

## 6. Rules

1. Keep exactly one Codex executable on the server: `/usr/local/bin/codex`. Do not install Codex with npm for any user.
2. Keep the worker-python symlink at `/home/limited_user/environments/news_nexus_12/bin/codex` pointing to `/usr/local/bin/codex`.
3. Keep one login profile per Linux user. Log each one in directly; never copy credentials between them.
4. Change both model settings together unless there is a reason not to.
5. Stop both workers, not just worker-node, before replacing the binary.

## Open Questions

### 1. Explicit HOME and CODEX_HOME in units

Should both worker units set `HOME=/home/limited_user` and `CODEX_HOME=/home/limited_user/.codex` through systemd overrides, so profile selection does not depend on defaults?

#### Operator Response

(claude) Optional hardening. It works today; add it the next time the units change.

### 2. Install bubblewrap

Should `bubblewrap` be installed with apt to remove the sandbox warning in every call?

#### Operator Response

(claude) Low priority. Codex already uses its bundled copy.

### 3. Nick's profile directory mode

Hermes found `/home/nick/.codex` at mode `775`. Should it be tightened to `700`?

#### Operator Response

(claude) Yes, after confirming nothing else reads it. It holds Nick's login.

### 4. Expired-login error text

When a login next expires, should the exact worker error text be added to Section 2?

#### Operator Response

(claude) Yes. It makes the next diagnosis quicker.
