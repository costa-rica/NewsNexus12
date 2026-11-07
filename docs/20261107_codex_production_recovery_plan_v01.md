---
created_at: 2026-11-07T16:15:09Z
updated_at: 2026-11-07T16:21:56Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Production Codex recovery plan

- Host: `nws-nn12prod`. Run terminal commands as `nick` over SSH.
- Goal: one shared executable, verified service authentication, and successful Phases 6 and 7.
- This document records planned work; no server changes have been performed here.
- Stop at any failed check before proceeding.

## 1. Remove Nick's duplicate installation

- Finish any Codex sessions running as Nick first.
- Run these commands individually. Confirm the shared executable works before uninstalling the private package:

```bash
/usr/local/bin/codex --version
npm list --global --prefix /home/nick/.npm-global --depth=0 @openai/codex
npm uninstall --global --prefix /home/nick/.npm-global @openai/codex
hash -r
command -v codex
codex --version
```

- Expected: Nick now resolves `/usr/local/bin/codex`, currently `0.154.0`.
- Preserve `/home/nick/.codex` and `/home/limited_user/.codex`; uninstalling the package should not remove either profile.
- If already removed, verify the expected path and version and continue.

## 2. Verify worker profiles before changing them

- Run this entire block while both workers are running. It reads profile metadata and prints paths and identity comparisons, without displaying credentials or invoking a model.

```bash
sudo /usr/bin/python3 - <<'PY'
import base64, json, os, pathlib, pwd, shutil, subprocess

def identity(home):
    try:
        doc = json.loads((pathlib.Path(home) / 'auth.json').read_text())
        tokens = doc.get('tokens') or {}
        raw = tokens.get('id_token', '')
        claims = {}
        if len(raw.split('.')) == 3:
            segment = raw.split('.')[1]
            claims = json.loads(base64.urlsafe_b64decode(
                segment + '=' * (-len(segment) % 4)))
        auth = claims.get('https://api.openai.com/auth') or {}
        return {
            'workspace': tokens.get('account_id') or auth.get('chatgpt_account_id'),
            'subject': claims.get('sub'),
            'mode': doc.get('auth_mode'),
        }
    except Exception:
        return None

def equal(a, b, key):
    if not a or not b or not a.get(key) or not b.get(key):
        return 'unknown'
    return a[key] == b[key]

nick = identity('/home/nick/.codex')
service = {}
for unit in ['newsnexus12-worker-node.service',
             'newsnexus12-worker-python.service']:
    pid = int(subprocess.check_output(
        ['systemctl', 'show', unit, '-p', 'MainPID', '--value'], text=True))
    if pid <= 0:
        print(unit, 'not running; no process environment')
        continue
    proc = pathlib.Path('/proc') / str(pid)
    env = dict(item.decode().split('=', 1)
               for item in (proc / 'environ').read_bytes().split(b'\0')
               if b'=' in item)
    user = pwd.getpwuid(proc.stat().st_uid)
    profile = env.get('CODEX_HOME') or str(
        pathlib.Path(env.get('HOME') or user.pw_dir) / '.codex')
    executable = shutil.which('codex', path=env.get('PATH', ''))
    print(unit, json.dumps({
        'uid_user': user.pw_name,
        'HOME': env.get('HOME', '<unset>'),
        'PATH': env.get('PATH', '<unset>'),
        'CODEX_HOME': env.get('CODEX_HOME', '<unset>'),
        'resolved_profile': profile,
        'codex': executable,
        'real_codex': os.path.realpath(executable) if executable else None,
    }))
    service[unit] = identity(profile)
    print('nick_comparison', unit, json.dumps({
        'same_chatgpt_workspace': equal(nick, service[unit], 'workspace'),
        'same_user_subject': equal(nick, service[unit], 'subject'),
    }))
a, b = [service.get(x) for x in
        ['newsnexus12-worker-node.service', 'newsnexus12-worker-python.service']]
print('workers_comparison', json.dumps({
    'same_chatgpt_workspace': equal(a, b, 'workspace'),
    'same_user_subject': equal(a, b, 'subject'),
}))
PY
```

- Expected: both workers resolve `/usr/local/bin/codex` and `/home/limited_user/.codex`.
- `true` for both identity comparisons supports the same stored user/workspace. It does not prove valid tokens or model access.
- `false` means identities differ; `unknown` or a stopped worker needs investigation. Ask Hermes to interpret unexpected results before changing profiles.
- HOME/CODEX_HOME may be unset. The printed profile is inferred from environment/passwd data; reconcile any application environment changes before Step 4.

## 3. Pause production and upgrade the shared CLI

### 3.1 Record state and check for active work

- Run individually and retain the output. The queue URLs use the ports recorded in the reports; stop if they do not reach the expected workers.

```bash
hostname
systemctl show newsnexus-weekly-flow-02.timer newsnexus-weekly-flow-02.service newsnexus12-worker-node.service newsnexus12-worker-python.service --property=Id,ActiveState,SubState,UnitFileState
systemctl list-timers --all newsnexus-weekly-flow-02.timer --no-pager
curl --fail --silent --show-error http://127.0.0.1:8003/queue-info/queue_status
curl --fail --silent --show-error http://127.0.0.1:8004/queue-info/queue-status
sudo pgrep -x codex
```

- Confirm host is `nws-nn12prod`, the weekly service is inactive, and both queues have no running or waiting work. Ask Hermes if queue output is unclear.
- `pgrep` should print nothing and exit 1 when no Codex process exists. This expected result is not a failure.
- Finish Nick's Codex sessions too. Do not interrupt jobs to upgrade.

### 3.2 Pause scheduling and stop both workers

- During the maintenance window, run this block. It stops on an error; it does not cancel an already running weekly flow.

```bash
(
  set -eu
  sudo systemctl stop newsnexus-weekly-flow-02.timer
  test "$(systemctl show newsnexus-weekly-flow-02.service -p ActiveState --value)" = inactive
  curl --fail --silent --show-error http://127.0.0.1:8003/queue-info/queue_status
  curl --fail --silent --show-error http://127.0.0.1:8004/queue-info/queue-status
)
```

- Recheck both queue responses are idle after pausing the timer. Keep other job submissions paused during maintenance. Then run:

```bash
(
  set -eu
  sudo systemctl stop newsnexus12-worker-node.service
  sudo systemctl stop newsnexus12-worker-python.service
  for unit in newsnexus-weekly-flow-02.timer newsnexus-weekly-flow-02.service newsnexus12-worker-node.service newsnexus12-worker-python.service; do
    test "$(systemctl show "$unit" -p ActiveState --value)" = inactive
  done
  if sudo pgrep -x codex; then
    echo 'STOP: a Codex process is still running'
    exit 1
  fi
)
```

- Proceed only if the block succeeds. Leave scheduling paused if any check fails.

### 3.3 Download, verify, and replace the shared executable

- Retain the standalone format: Python's current PATH cannot resolve Node.js for an npm launcher.
- This pins `0.166.0`, as recommended in the assessment; it is not a claim that this is the newest release or a proven Luna fix.
- Run the whole block. It checks the archive against official release metadata and preserves the current binary before replacement.

```bash
(
  set -eu
  test "$(hostname -s)" = nws-nn12prod
  test "$(uname -m)" = x86_64
  /usr/local/bin/codex --version | /usr/bin/grep -Fx 'codex-cli 0.154.0'
  test ! -L /usr/local/bin/codex
  test ! -e /usr/local/bin/codex-0.154.0.pre-upgrade
  codex_upgrade_dir=$(mktemp -d /tmp/newsnexus-codex-upgrade.XXXXXX)
  cd "$codex_upgrade_dir"
  curl --fail --location --silent --show-error --output release.json \
    https://api.github.com/repos/openai/codex/releases/tags/rust-v0.166.0
  curl --fail --location --silent --show-error --output codex.tar.gz \
    https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-x86_64-unknown-linux-musl.tar.gz
  /usr/bin/python3 - <<'PY'
import hashlib, json, pathlib
release = json.loads(pathlib.Path('release.json').read_text())
assert release['tag_name'] == 'rust-v0.166.0', 'Unexpected release'
asset = next(a for a in release['assets']
             if a['name'] == 'codex-x86_64-unknown-linux-musl.tar.gz')
actual = 'sha256:' + hashlib.sha256(pathlib.Path('codex.tar.gz').read_bytes()).hexdigest()
assert asset.get('digest') == actual, 'Missing or mismatched official SHA-256; stop'
print('Official release SHA-256 matches')
PY
  tar -xzf codex.tar.gz
  ./codex-x86_64-unknown-linux-musl --version | /usr/bin/grep -Fx 'codex-cli 0.166.0'
  sudo cp --preserve=mode,ownership,timestamps \
    /usr/local/bin/codex /usr/local/bin/codex-0.154.0.pre-upgrade
  sudo install -o root -g root -m 0755 \
    codex-x86_64-unknown-linux-musl /usr/local/bin/codex.new
  sudo mv -T /usr/local/bin/codex.new /usr/local/bin/codex
  /usr/local/bin/codex --version
)
```

- If the backup already exists or any check fails, stop and investigate; do not overwrite it.
- Do not replace or delete authentication files.

### 3.4 Verify all command paths

```bash
command -v codex
codex --version
sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /bin/sh -c 'command -v codex; codex --version'
sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/home/limited_user/environments/news_nexus_12/bin \
  /bin/sh -c 'command -v codex; codex --version'
```

- Expected: all three report `0.166.0`; the environment-bin symlink still leads to `/usr/local/bin/codex`.
- These commands verify version/path only. Leave both workers and the timer stopped until Steps 4 and 5.

### 3.5 Roll back only if the replacement fails

- With both workers stopped, restore the saved executable. Keep the failed replacement for investigation.

```bash
(
  set -eu
  test "$(systemctl show newsnexus12-worker-node.service -p ActiveState --value)" = inactive
  test "$(systemctl show newsnexus12-worker-python.service -p ActiveState --value)" = inactive
  test ! -e /usr/local/bin/codex-0.166.0.failed
  sudo cp --preserve=mode,ownership,timestamps \
    /usr/local/bin/codex /usr/local/bin/codex-0.166.0.failed
  sudo install -o root -g root -m 0755 \
    /usr/local/bin/codex-0.154.0.pre-upgrade /usr/local/bin/codex.rollback
  sudo mv -T /usr/local/bin/codex.rollback /usr/local/bin/codex
  /usr/local/bin/codex --version
)
```

- Expected rollback version: `0.154.0`. Leave the timer paused; this restores the old CLI, not Luna compatibility.

## 4. Make authentication predictable

- Retain separate Linux-user profiles; both may log into the same ChatGPT account. A shared executable does not share authentication.
- After Step 2 confirms profile selection, explicitly set both workers' `HOME=/home/limited_user` and `CODEX_HOME=/home/limited_user/.codex` through systemd overrides; reload systemd and verify the effective settings.
- Use Hermes to prepare exact overrides if needed; apply them manually over SSH.
- Run `codex login status` as `limited_user` with that explicit environment.
- Preserve a correct login. If identity is wrong or credentials are invalid, use the service-user device-login procedure in Section 7 of the runtime assessment, then verify identity again.

## 5. Test model access and application output

- When ready to permit live AI calls, test `gpt-6-luna` as `limited_user` using each worker's environment.
- If rejected, retain the exact error and investigate account/workspace availability with Hermes before bulk processing.
- Start both workers with the weekly timer still paused. Verify health and effective environments.
- Run one-article state-assignment and approval canaries; verify durable state and prediction rows, not only successful job status.

## 6. Fix false-success handling

- Delegate implementation and regression tests to a coding agent; review and deploy before resuming weekly automation.
- Abort promptly on permanent model/authentication errors.
- Block Phase 7 when Phase 6 fails completely, and make the weekly run report failure.
- Preserve legitimate zero-work handling while explaining missing-state exclusions.

## 7. Repair the affected articles

- Ask Hermes to prepare a targeted repair procedure for article IDs `483764–485310`, revalidating current rows and missing outputs.
- Confirm exact-ID targeting support before executing; newest-count selection can drift.
- Process missing assignments, verify results, then inspect a fresh V02 preview before starting approval.
- Do not reopen completed run 6, edit completion flags, or rerun cleanup/ingestion to repair these articles.

## 8. Restore scheduling and document the result

- Restore the timer only after validation passes, considering its previous state and next trigger.
- Update the production setup instructions with the shared installation, upgrade method, and explicit profiles.
- Record versions, canary results, repair counts, and remaining failures.
- If the upgraded CLI cannot start, keep scheduling paused and restore the saved binary while both workers are stopped.

## References

- [Weekly failure report](20261107_NewsNexus12_Weekly_Flow_02_Phases_6_7_Failure_Report.md).
- [Runtime and authentication assessment](20261107_NewsNexus12_Codex_Runtime_Authentication_And_Luna_Assessment.md).
