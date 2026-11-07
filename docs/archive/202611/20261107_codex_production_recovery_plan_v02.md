---
created_at: 2026-11-07T16:48:24Z
updated_at: 2026-11-07T16:48:53Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Production Codex recovery plan v02

- Supersedes [v01](20261107_codex_production_recovery_plan_v01.md). Incorporates Claude's assessment and Hermes's review supplied by Nick.
- Run commands as `nick` over SSH on `nws-nn12prod`. No server work has been executed by creating this plan.
- Nick confirms neither AI Approver nor State Assigner will be running. Keep both workflows idle during these steps; no overlapping AI calls are planned.
- Target: one root-owned standalone executable at `/usr/local/bin/codex`, with separate user profiles authenticated to the intended ChatGPT account/workspace.
- Perform numbered steps in order. Run blocks separately; stop on unexpected output or errors. Retain terminal output, excluding credentials.
- Use the same SSH session so `NN12_CODEX_STAGE` and recorded service states remain available. If disconnected, recover those values before continuing.

## Phase A: Align and validate the CLI

### 1. Record installation and service state

- Keep Nick's working private installation until the shared replacement passes validation.
- Record current paths, versions, and service states:

```bash
hostname
type -a codex
codex --version
/usr/local/bin/codex --version
readlink -f /home/limited_user/environments/news_nexus_12/bin/codex
NN12_TIMER_WAS_ACTIVE=$(systemctl show newsnexus-weekly-flow-02.timer -p ActiveState --value)
NN12_NODE_WAS_ACTIVE=$(systemctl show newsnexus12-worker-node.service -p ActiveState --value)
NN12_PYTHON_WAS_ACTIVE=$(systemctl show newsnexus12-worker-python.service -p ActiveState --value)
printf 'timer=%s node=%s python=%s\n' "$NN12_TIMER_WAS_ACTIVE" "$NN12_NODE_WAS_ACTIVE" "$NN12_PYTHON_WAS_ACTIVE"
systemctl list-timers --all newsnexus-weekly-flow-02.timer --no-pager
```

- Expected report baseline: Nick `0.166.0`, shared CLI `0.154.0`, Python symlink pointing to `/usr/local/bin/codex`. If already changed, reconcile before proceeding.
- Ask Hermes to inventory PATH, absolute-path, and extension/bundled copies and verify how Hermes invokes Codex. Start with:

```bash
type -a codex
sudo find /usr/local /home/nick /home/limited_user /opt -type f \( -name codex -o -name 'codex-*-unknown-linux-*' \) -print
```

- Missing directories may produce harmless `find` errors. Have Hermes explain other errors, symlinked locations, or unsearched mounts.
- A cache marked `0.167.0` does not prove another installation still exists. Record provenance as unknown if it cannot be established; do not delete unexplained copies.

### 2. Verify the workers' profiles

- Run while the workers are running. This diagnostic prints selected paths and identity comparisons, not credentials. It invokes no model.

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

- Expected profiles: `/home/limited_user/.codex`; expected executable target: `/usr/local/bin/codex` for both workers.
- Two `true` identity comparisons support matching stored user/workspace identities. They do not prove token validity or model access.
- If a worker is stopped, identity is unknown, or its profile differs, ask Hermes to resolve that before tests. Do not change authentication speculatively.
- HOME and CODEX_HOME may be unset; the profile fallback is inferred. Have Hermes reconcile application environment changes and the actual `SetLoginEnvironment` setting. Do not assume systemd exported HOME.

### 3. Stage and verify the candidate

- Pin standalone `0.166.0` to remove the reported version mismatch. This is not a claim that it is the newest version or that it fixes Luna.
- Stage a root-owned candidate readable and executable by `limited_user`. Leave the production executable untouched.

```bash
NN12_CODEX_STAGE=$(sudo mktemp -d /var/tmp/newsnexus-codex-candidate.XXXXXX)
```

- Confirm the command succeeded, then run:

```bash
(
  set -eu
  test "$(hostname -s)" = nws-nn12prod
  test "$(uname -m)" = x86_64
  test -n "$NN12_CODEX_STAGE"
  nn12_download_dir=$(mktemp -d /tmp/newsnexus-codex-download.XXXXXX)
  cd "$nn12_download_dir"
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
  tar -xzf codex.tar.gz codex-x86_64-unknown-linux-musl
  sudo install -o root -g root -m 0755 \
    codex-x86_64-unknown-linux-musl "$NN12_CODEX_STAGE/codex"
  sudo chmod 0755 "$NN12_CODEX_STAGE"
  sudo -u limited_user "$NN12_CODEX_STAGE/codex" --version | /usr/bin/grep -Fx 'codex-cli 0.166.0'
  printf 'Candidate: %s/codex\n' "$NN12_CODEX_STAGE"
)
```

- Keep the candidate path and checksum result. Missing metadata or a mismatch means stop; do not bypass verification.

### 4. Test both versions before replacement

- Nick must approve the two live calls below before executing this step; see Open Questions.
- Workers may remain running because Nick confirms these workflows will be idle. No extra AI-overlap procedure is needed.
- Pause the weekly timer and enforce idle queues before testing or stopping services:

```bash
(
  set -eu
  sudo systemctl stop newsnexus-weekly-flow-02.timer
  test "$(systemctl show newsnexus-weekly-flow-02.service -p ActiveState --value)" = inactive
  /usr/bin/python3 - <<'PY'
import json, urllib.request
for label, url in [
    ('node', 'http://127.0.0.1:8003/queue-info/queue_status'),
    ('python', 'http://127.0.0.1:8004/queue-info/queue-status'),
]:
    with urllib.request.urlopen(url, timeout=10) as response:
        data = json.load(response)
    summary = data['summary']
    assert type(summary['running']) is int and summary['running'] == 0, label + ': running jobs'
    assert type(summary['queued']) is int and summary['queued'] == 0, label + ': queued jobs'
    assert 'runningJob' in data and data['runningJob'] is None, label + ': active job'
    assert data['queuedJobs'] == [], label + ': queued jobs'
    print(label + ': idle')
PY
)
```

- HTTP errors, unexpected response schemas, or busy queues stop the block. Leave the timer paused and investigate. This gate checks all worker jobs, not only the two AI workflows.
- Run these two calls sequentially, from `/tmp`, with the same verified profile, model, prompt, and environment. Read-only sandboxing still permits CLI authentication/cache updates. Do not log out or copy credentials between tests.
- If Step 2 found a different intended profile, have Hermes adapt these commands before executing them.

```bash
(
  cd /tmp || exit 1
  sudo -u limited_user /usr/bin/env -i \
    HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
    PATH=/usr/bin:/usr/local/bin \
    /usr/local/bin/codex exec --ephemeral --skip-git-repo-check -s read-only -m gpt-6-luna 'Reply with OK'
)
printf 'Old CLI exit status: %s\n' "$?"
```

```bash
(
  cd /tmp || exit 1
  sudo -u limited_user /usr/bin/env -i \
    HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
    PATH=/usr/bin:/usr/local/bin \
    "$NN12_CODEX_STAGE/codex" exec --ephemeral --skip-git-repo-check -s read-only -m gpt-6-luna 'Reply with OK'
)
printf 'Candidate CLI exit status: %s\n' "$?"
```

- Record each version's exit status and exact provider error or successful response. An expected rejection does not prevent running the second comparison call.

| Result | Next action |
| --- | --- |
| Candidate works; old CLI rejects | Strong evidence of version-related compatibility. Proceed with replacement and application validation. |
| Both work | Initial failure is not reproduced. Alignment can proceed; application canaries remain required. |
| Both reject | Keep executable and model settings unchanged. Ask Hermes to investigate model naming, configuration, account/workspace, and provider availability. |
| Old CLI works; candidate rejects | Do not replace production or remove Nick's copy. Investigate the candidate failure. |
| Network/authentication/other unclear failure | Stop and diagnose; the comparison is inconclusive. |

- No automatic fallback model. If Luna remains unavailable, obtain Nick's choice after access and quality testing of an alternative.
- If stopping here, record the result and decide whether to restore only the prior timer state. Do not resume a known-broken weekly flow automatically.

### 5. Replace the shared executable

- Proceed only after the candidate succeeds. Both queues were required idle in Step 4; keep new job submissions paused.
- Stop both workers and preserve the old binary. This does not alter either authentication profile.

```bash
(
  set -eu
  sudo systemctl stop newsnexus12-worker-node.service
  sudo systemctl stop newsnexus12-worker-python.service
  for unit in newsnexus-weekly-flow-02.timer newsnexus-weekly-flow-02.service newsnexus12-worker-node.service newsnexus12-worker-python.service; do
    test "$(systemctl show "$unit" -p ActiveState --value)" = inactive
  done
  test ! -L /usr/local/bin/codex
  /usr/local/bin/codex --version | /usr/bin/grep -Fx 'codex-cli 0.154.0'
  test ! -e /usr/local/bin/codex-0.154.0.pre-upgrade
  "$NN12_CODEX_STAGE/codex" --version | /usr/bin/grep -Fx 'codex-cli 0.166.0'
  sudo cp --preserve=mode,ownership,timestamps \
    /usr/local/bin/codex /usr/local/bin/codex-0.154.0.pre-upgrade
  sudo install -o root -g root -m 0755 \
    "$NN12_CODEX_STAGE/codex" /usr/local/bin/codex.new
  sudo mv -T /usr/local/bin/codex.new /usr/local/bin/codex
  sudo -u limited_user /usr/bin/env -i \
    HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
    PATH=/usr/bin:/usr/local/bin \
    /bin/sh -c 'command -v codex; codex --version'
  sudo -u limited_user /usr/bin/env -i \
    HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
    PATH=/home/limited_user/environments/news_nexus_12/bin \
    /bin/sh -c 'command -v codex; codex --version'
)
```

- Expected: both service paths report `0.166.0`. An existing backup or changed baseline requires investigation, not overwriting or bypassing checks.
- Standalone installation avoids adding a Node.js dependency to Python's restricted PATH.

### 6. Confirm authentication and validate applications

- After verifying current profile selection, have Hermes prepare exact systemd overrides for both workers: `HOME=/home/limited_user`, `CODEX_HOME=/home/limited_user/.codex`.
- Apply reviewed overrides over SSH, reload systemd, and verify effective settings. Preserve current PATHs for the standalone installation. Do not guess if Step 2 selected another profile.
- Check the service-user login without changing credentials:

```bash
sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /usr/local/bin/codex login status
```

- If identity is correct and login valid, preserve it. A wrong/invalid login needs an explicitly chosen service-user device login; no speculative logout or credential copying.
- Start only workers that were previously active, after configuration is verified:

```bash
(
  set -eu
  if test "$NN12_NODE_WAS_ACTIVE" = active; then
    sudo systemctl start newsnexus12-worker-node.service
    systemctl is-active --quiet newsnexus12-worker-node.service
  fi
  if test "$NN12_PYTHON_WAS_ACTIVE" = active; then
    sudo systemctl start newsnexus12-worker-python.service
    systemctl is-active --quiet newsnexus12-worker-python.service
  fi
)
```

- Keep the weekly timer paused. If prior service states were not `active` or `inactive`, investigate rather than interpreting them as a normal baseline.
- Have Hermes prepare exact one-article canary commands and read-only verification queries. Nick approves their selected articles and writes before execution.
- Require durable state-assignment and V02 prediction rows, plus worker health. CLI `OK` and completed queue status alone do not establish application success.

### 7. Remove Nick's private installation last

- Proceed after shared CLI/application validation and confirmation that Hermes does not depend on the private path.
- Finish any Nick/Hermes Codex session using the private executable first.
- Run individually, stopping on errors:

```bash
/usr/local/bin/codex --version
npm list --global --prefix /home/nick/.npm-global --depth=0 @openai/codex
npm uninstall --global --prefix /home/nick/.npm-global @openai/codex
hash -r
type -a codex
command -v codex
codex --version
```

- Expected: Nick resolves `/usr/local/bin/codex`, version `0.166.0`. Preserve both `.codex` profiles; this does not merge authentication.
- If the private package was already removed, verify path/version and skip uninstalling.
- Update the production setup guide and record Phase A results. Workers can serve normal work; weekly scheduling remains paused pending Phases B and C.
- Retain the candidate and old binary as explicit temporary/rollback artifacts. One active installation does not mean deleting recovery copies or extension-managed clients blindly.

### Rollback if Phase A fails after replacement

- Stop both workers first, with queues idle. Keep the timer paused. Restore only the CLI, leaving authentication intact:

```bash
(
  set -eu
  sudo systemctl stop newsnexus12-worker-node.service
  sudo systemctl stop newsnexus12-worker-python.service
  test ! -e /usr/local/bin/codex-0.166.0.failed
  sudo cp --preserve=mode,ownership,timestamps \
    /usr/local/bin/codex /usr/local/bin/codex-0.166.0.failed
  sudo install -o root -g root -m 0755 \
    /usr/local/bin/codex-0.154.0.pre-upgrade /usr/local/bin/codex.rollback
  sudo mv -T /usr/local/bin/codex.rollback /usr/local/bin/codex
  /usr/local/bin/codex --version
)
```

- Expected: `0.154.0`. This restores the previous executable; it does not resolve Luna access. Restore any changed unit settings from the recorded baseline only if needed, then verify service health before restarting prior active workers.

## Phase B: Fix false-success reporting

### 8. Implement and deploy separately

- Delegate implementation and regression tests to a coding agent outside the CLI maintenance window.
- Abort on permanent model/authentication failures; preserve useful counts and failure reasons.
- A nonempty selection with zero completed assignments and failures must block Phase 7 and prevent successful weekly completion.
- Preserve legitimate zero-work and intentional per-article failure tolerance; explain missing-state exclusions.
- Review, test, and deploy in a separate window. Require this gate before bulk repair or re-enabling weekly scheduling.

## Phase C: Repair and resume

### 9. Repair the original cohort

- Have Hermes revalidate article IDs `483764–485310`, current state/prediction rows, and exact-ID targeting support.
- Require a concrete repair command and selection preview before Nick executes it. If targeting is unsupported, implement and review a repair mechanism first.
- Process missing assignments, verify durable results, inspect a fresh V02 preview, and then approve the targeted approval job.
- Do not reopen completed run 6, edit completion flags, or repeat cleanup/ingestion to repair these articles. A newest-count window can drift.

### 10. Restore the weekly schedule

- Require Phases A–C verification, worker health, and recorded repair/failure counts.
- Inspect the timer's next trigger and catch-up behavior before starting it; restoring a persistent timer can trigger overdue work.

```bash
systemctl show newsnexus-weekly-flow-02.timer -p Persistent -p NextElapseUSecRealtime -p LastTriggerUSec
systemctl list-timers --all newsnexus-weekly-flow-02.timer --no-pager
```

- Restore the timer only if previously active and Nick is ready for its next or catch-up invocation. Have Hermes resolve unclear scheduling before running:

```bash
(
  set -eu
  test "$NN12_TIMER_WAS_ACTIVE" = active
  sudo systemctl start newsnexus-weekly-flow-02.timer
  systemctl is-active --quiet newsnexus-weekly-flow-02.timer
)
```

- If previously inactive, leave it inactive. Record the final installation, authentication findings, test results, repair counts, and remaining issues.

## References

- [Runtime/authentication assessment](20261107_NewsNexus12_Codex_Runtime_Authentication_And_Luna_Assessment.md).
- [Weekly failure report](20261107_NewsNexus12_Weekly_Flow_02_Phases_6_7_Failure_Report.md).
- [Claude assessment and responses](20261107_codex_production_recovery_plan_v01_assessment_claude.md).
- Queue schema checked in `worker-node/src/modules/queue/queueStatus.ts` and `worker-python/src/modules/queue/status.py`.

## Open Questions

### For the operator (Nick)

#### 1. Approve live validation calls

May Step 4 run two minimal Luna calls as `limited_user`, one with each CLI version, before replacing the production executable?

##### Operator Response

(codex) Recommend approving the two CLI calls. Application canaries remain a later decision after Hermes supplies exact article selection and commands.

#### 2. Fallback if Luna still fails

If the candidate still rejects Luna, should recovery pause for account/model investigation before considering a tested alternative?

##### Operator Response

(codex) Recommend pausing with settings unchanged. Choose an alternative only after access and application-quality validation; no automatic substitution.

### For Hermes on nws-nn12prod

#### 1. Inventory and invocation paths

Which executable does Hermes invoke, and will it work after Nick's private package is removed? Report other active installations and explain the `0.167.0` cache only if evidence supports its origin.

##### Hermes Response

#### 2. Verified worker profiles

What do the Step 2 diagnostic and unit inspection establish about each worker's profile, identity, HOME/CODEX_HOME, and `SetLoginEnvironment`? Provide exact overrides only after confirming the intended profile.

##### Hermes Response

#### 3. Canary and repair commands

What exact article selections, application commands, and verification queries should Nick use for one-article canaries and exact-cohort repair? Identify unsupported targeting before proposing execution.

##### Hermes Response
