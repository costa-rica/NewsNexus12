---
created_at: 2026-11-07T16:04:04Z
updated_at: 2026-11-07T16:04:04Z
created_by: hermes (gpt-6.1-sol) nws-nn12prod
modified_by: hermes (gpt-6.1-sol) nws-nn12prod
---

# Codex runtime, authentication, and Luna assessment

## Summary

Nick and the production workers do not use the same Codex installation. Nick resolves npm-installed 0.166.0; both workers' configured executable paths resolve to the root-owned standalone 0.154.0 binary.

The older release's bundled model catalog includes `gpt-5.6-luna` but not `gpt-6-luna`. Version 0.166.0 includes both. The version mismatch is a credible compatibility factor and should be removed before concluding that the account can never use GPT-6-Luna.

It is not yet proven that an upgrade will fix the incident. A server rejection mentioning ChatGPT-account support does not by itself distinguish client compatibility, account/workspace entitlement, or model availability.

Whether Nick and `limited_user` authenticate to the same ChatGPT identity could not be established with the available read permissions. Reporting both as ChatGPT-authenticated is not proof that they are the same account.

An additional upgrade hazard was found: worker-python's PATH contains only its environment bin directory and cannot resolve `node`. Replacing the standalone binary with the standard npm launcher without correcting that PATH could break AI Approver V02 before it reaches authentication.

## Read-only boundary

- Host checked: `nws-nn12prod`, November 7, 2026.
- No installs, authentication changes, credential copies, service restarts, model calls, or application job submissions were performed.
- Only CLI `--version`, help, and Nick's `login status` were invoked; these are not model invocations.
- No Codex analysis session was launched because the operator prohibited model invocation.
- Credential material was not displayed, copied, hashed, or included in this report.
- NickVault was synchronized before report creation. The requested post-write sync is verified separately in the completion message.

## 1. Current setup documentation

Read the non-archive documents:

- `docs/CODEX_CLI_SERVER_SETUP.md`.
- `docs/20261006_CODEX_CLI_SERVER_SETUP.md`.
- Relevant worker-node README sections and both workers' current Codex invocation code.
- Repository and vault instruction files already read in this session remain applicable.

Archive contents were excluded from this investigation. A filename search returned archive paths, but their contents were not read or used as authority.

### Documentation discrepancies

The undated setup guide describes a standalone 0.142.5 installation and copying Nick's credentials into the service account. The dated guide recommends an explicit `/usr/local` npm installation, retaining separate profiles, and verifying the service user's version.

Both setup guides say their commands target `nws-nn12dev`, not this production host. Neither is a verified production runbook as written.

The dated guide's model example is `gpt-5.6-luna`, not the production setting `gpt-6-luna`. It stops only worker-node even though worker-python also invokes the shared Codex executable.

Its npm conversion requires adaptation on production: Python's restricted PATH lacks Node.js. Its model test must not be run under the current no-model-invocation restriction.

## 2. Executables and runtime environments

### Nick's current operator environment

Verified directly in the Hermes command environment running as Nick:

- Command resolution: `/home/nick/.npm-global/bin/codex`.
- Resolved launcher: `/home/nick/.npm-global/lib/node_modules/@openai/codex/bin/codex.js`.
- CLI version: `codex-cli 0.166.0`.
- HOME: `/home/nick`.
- CODEX_HOME: unset.
- Expected Codex home: `/home/nick/.codex`.
- PATH: `/home/nick/.local/bin:/home/nick/.local/bin:/home/nick/.hermes/hermes-agent/venv/bin:/home/nick/.hermes/hermes-agent/node_modules/.bin:/usr/bin:/home/nick/.local/bin:/home/nick/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin`.

This is the inspected command environment, not a claim that every interactive Nick shell has identical PATH entries.

### Worker-node

Verified effective systemd configuration:

- Unit: `newsnexus12-worker-node.service`.
- Main PID at inspection: 1248801.
- User/group: `limited_user:limited_user`.
- Working directory: `/home/limited_user/applications/NewsNexus12/worker-node`.
- ExecStart: `/usr/bin/node dist/server.js`.
- PATH: `/usr/bin:/usr/local/bin`.
- Codex resolution on that PATH: `/usr/local/bin/codex`.
- Resolved target: `/usr/local/bin/codex`, root-owned mode 755, version 0.154.0.
- HOME and CODEX_HOME: no explicit assignment in unit or package environment file.
- `SetLoginEnvironment=no`; no PAM configuration or unit drop-ins.

Node's Codex spawn passes no environment override, so it inherits the worker's environment. The relevant compiled client and source use the bare executable name `codex`.

### Worker-python

Verified effective systemd configuration:

- Unit: `newsnexus12-worker-python.service`.
- Main PID at inspection: 1248817.
- User/group: `limited_user:limited_user`.
- Working directory: `/home/limited_user/applications/NewsNexus12/worker-python`.
- ExecStart: `/home/limited_user/environments/news_nexus_12/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 8004`.
- PATH: `/home/limited_user/environments/news_nexus_12/bin`.
- Codex resolution: `/home/limited_user/environments/news_nexus_12/bin/codex`.
- That symlink resolves to `/usr/local/bin/codex`, version 0.154.0.
- HOME and CODEX_HOME: no explicit assignment in unit or package environment file.
- `SetLoginEnvironment=no`; no PAM configuration or unit drop-ins.

V02's Python subprocess passes no environment override and invokes `codex` by name. It therefore inherits the worker environment.

### What is verified versus inferred

The above PATH values come from `systemctl show`, privileged reads of the unit files, and allowlisted inspection of their environment files. Neither environment file overrides HOME, PATH, or CODEX_HOME. The system manager environment has no HOME or CODEX_HOME setting.

Direct reads of `/proc/1248801/environ` and `/proc/1248817/environ` were denied. Therefore live process HOME and CODEX_HOME were not independently verified. With `SetLoginEnvironment=no`, do not claim the units automatically export `HOME=/home/limited_user`.

The passwd home for `limited_user` is `/home/limited_user`. Its default Codex profile is expected to resolve there through home-directory fallback when HOME is absent, but a privileged runtime probe is required to close the verification gap.

For operational clarity, future maintenance should explicitly set HOME and CODEX_HOME for both workers after confirming that this preserves their current profile selection.

## 3. Authentication and account identity

### Verified

- Nick's CLI reports `Logged in using ChatGPT`.
- Nick's local auth file has ChatGPT auth mode and contains account and subject metadata.
- JWT payload metadata was decoded locally only to verify field presence. No token, account ID, email, or subject was emitted. JWT signatures were not independently validated.
- Nick's config does not explicitly set a credential-store override, provider override, or forced ChatGPT workspace constraint.
- `/home/nick/.codex/auth.json` is owned by Nick, mode 600.
- `/home/nick/.codex` is mode 775: a broader directory permission than the service-user setup guide recommends. Restricting it can be considered separately after checking legitimate shared access.
- `/home/limited_user/.codex` is owned by `limited_user`, mode 700, and cannot be traversed by Nick.

### Not established

The supplied observation says `limited_user` reports `Logged in using ChatGPT`. This is consistent with the incident's ChatGPT-account provider rejection, but the service-user login-status check could not be repeated in this investigation: noninteractive sudo required a password.

Nick cannot read the service-user auth file. Its contents, file mode, account identity, and workspace constraints were not inspected. The operator's statement is retained as supplied evidence, not mislabeled as a new successful probe.

Conclusion: same ChatGPT account is unknown. The two workers are expected to share the same service-user profile; neither that expectation nor old credential-copy instructions establish that it matches Nick's current identity.

Matching email alone is insufficient where a user can select different workspaces. Compare both stable user identity and ChatGPT account/workspace identity. The diagnostic below prints only comparisons and paths, never identifiers or credentials.

## 4. Does the older CLI explain Luna's rejection?

### Evidence supporting a compatibility explanation

Official release evidence was read without invoking a model:

- 0.154.0 release: published September 9, 2026.
- 0.166.0 release: published October 29, 2026.
- 0.154.0 bundled catalog: `gpt-5.6-luna` present; `gpt-6-luna` absent.
- 0.166.0 bundled catalog: both Luna names present.
- Both production model settings explicitly name `gpt-6-luna`.

Nick's existing model cache also lists `gpt-6-luna`, but its metadata says client version 0.167.0. That cache is not proof that Nick's 0.166.0 executable successfully invoked the model, or that the service account has identical access.

### Why this is not conclusive

Catalog inclusion is not the same as account entitlement. Codex can use remote catalogs, and an absent bundled entry is not proof that an explicit `-m` request must fail. No controlled same-account, same-model comparison across versions was authorized or performed.

The incident response was HTTP 400 `model_not_found`: `The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.` It was not an explicit message stating a minimum CLI version.

Assessment: the CLI is materially out of date relative to the configured model, and an upgrade is justified. The older CLI may contribute, but the root explanation cannot yet be narrowed to version alone. Do not repeat the earlier unsupported assumption that this account can never use Luna.

Upgrade while preserving authentication first. Verify identity before reauthenticating. A later, separately authorized model canary is required to establish that the rejection is resolved.

## 5. Credential-safe privileged diagnostic

Not executed. Nick can run this read-only command with interactive sudo to verify the missing live environment and compare identities. It reads only environment/profile data and emits booleans and non-secret paths. It invokes no CLI or model.

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

Interpretation: two true comparisons support the same stored user/workspace identity. A false comparison establishes a difference in stored identity. Unknown means insufficient readable metadata or a non-file credential backend. Local decoding does not verify token validity or live entitlements.

This probe reads the process's initial environment from procfs. If an application mutates environment variables after startup, reconcile those mutations with code and configuration before treating procfs as a complete runtime snapshot.

## 6. Exact recommended upgrade sequence

These are recommendations only. Every mutating command below requires separate approval and a maintenance window. The present task does not authorize execution.

### Preflight and pause

1. Run the privileged diagnostic above and retain its sanitized output.
2. Confirm both worker queues are idle and no child Codex process is active. Do not interrupt production work to upgrade.
3. The weekly timer is currently enabled and active; pause its scheduling only during the approved window, and record its prior state.
4. Stop both workers, not just worker-node.

After these gates pass:

```bash
sudo systemctl stop newsnexus-weekly-flow-02.timer
sudo systemctl stop newsnexus12-worker-node.service
sudo systemctl stop newsnexus12-worker-python.service
```

Confirm all three are inactive before replacing the executable. Stop on any conflict or failure.

### Preferred production-safe option: pinned standalone 0.166.0

The host is x86_64. Keep the existing standalone topology so Python does not acquire a new Node.js PATH dependency. Pin 0.166.0 to remove the known version split; this is not a claim that it is the newest release or a proven Luna fix.

Run as Nick after the approved stop/preflight:

```bash
set -eu
workdir=$(mktemp -d /tmp/newsnexus-codex-upgrade.XXXXXX)
cd "$workdir"
curl --fail --location --output codex.tar.gz \
  https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-x86_64-unknown-linux-musl.tar.gz
printf '%s  %s\n' \
  a0bf572d2f93f056c6712a6da348e96078dc84f3885fd7be67807ef389cb3978 \
  codex.tar.gz | sha256sum --check -
tar -xzf codex.tar.gz
./codex-x86_64-unknown-linux-musl --version
test ! -e /usr/local/bin/codex-0.154.0.pre-upgrade
sudo cp --preserve=mode,ownership,timestamps \
  /usr/local/bin/codex /usr/local/bin/codex-0.154.0.pre-upgrade
sudo install -o root -g root -m 0755 \
  codex-x86_64-unknown-linux-musl /usr/local/bin/codex.new
sudo mv -T /usr/local/bin/codex.new /usr/local/bin/codex
/usr/local/bin/codex --version
/home/limited_user/environments/news_nexus_12/bin/codex --version
```

The archive digest above was read from the official GitHub release asset metadata during this investigation. Verify against the release again at execution time. Stop if the backup exists; do not overwrite a previous recovery artifact.

No authentication file should be replaced or deleted by this upgrade. Nick can retain his private 0.166.0 installation; there is no need to uninstall it merely to repair the workers.

### Alternative: npm installation

The dated setup guide's correct prefix is explicit:

```bash
sudo /usr/bin/npm install --global --prefix /usr/local @openai/codex@0.166.0
```

Do not run that over the present standalone binary without first preserving and removing the filename collision in the approved maintenance procedure.

Before adopting npm, change worker-python's service PATH to include `/usr/bin` and `/usr/local/bin` while retaining its environment bin first. Set explicit HOME/CODEX_HOME if the diagnostic confirms the intended profile. Example approved unit override:

```ini
[Service]
Environment="PATH=/home/limited_user/environments/news_nexus_12/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=/home/limited_user"
Environment="CODEX_HOME=/home/limited_user/.codex"
```

An analogous explicit HOME/CODEX_HOME assignment can make worker-node deterministic. Unit edits require `sudo systemctl daemon-reload` and verified configuration before starting workers. This alternative is more invasive than retaining a standalone binary.

### Verify before restoring scheduling

Non-model checks under explicit service profiles:

```bash
sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /usr/local/bin/codex --version

sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/home/limited_user/environments/news_nexus_12/bin \
  /home/limited_user/environments/news_nexus_12/bin/codex --version

sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /usr/local/bin/codex login status
```

All versions should match 0.166.0. The Python-PATH version check will fail for an npm launcher unless its PATH has been corrected; use the revised PATH in that alternative.

A later model canary requires a separate authorization that explicitly lifts the no-model restriction. Verify it as `limited_user`, using the exact selected model, then require a one-article application canary with durable database output before bulk recovery.

Only after approved validation:

```bash
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl start newsnexus12-worker-python.service
sudo systemctl status newsnexus12-worker-node.service --no-pager
sudo systemctl status newsnexus12-worker-python.service --no-pager
sudo systemctl start newsnexus-weekly-flow-02.timer
```

Starting the timer restores scheduling, not authorization to rerun a weekly pipeline now. Restore it only if it was active before maintenance and the next trigger is understood.

## 7. Authentication recommendation

Do not reauthenticate merely because the executable was upgraded. Do not infer bad credentials from a model-support rejection.

First compare stored identity and run the service-user login-status check. If the service identity is correct and logged in, preserve it. The setup guide's historical credential-copy procedure is not a reason to overwrite it now.

If a separate approval authorizes changing to the intended account, prefer a direct service-user device login rather than copying Nick's refresh-token store. With workers stopped and the intended workspace confirmed:

```bash
sudo -u limited_user /usr/bin/env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/codex login --device-auth
```

Complete the browser/device flow using the intended ChatGPT account and workspace. Treat the device code as sensitive; do not paste it into reports or chat logs. `--device-auth` was verified in the installed CLI's help, but the login itself was not invoked.

If explicit logout is required after diagnosing a wrong or invalid session, obtain approval before running the same environment command with `codex logout`; it deletes the current login. Do not log out speculatively.

Then verify `login status` and rerun the safe identity comparison. Repair ownership/modes only if inspection shows a problem:

```bash
sudo chown limited_user:limited_user /home/limited_user/.codex
sudo chmod 700 /home/limited_user/.codex
sudo chown limited_user:limited_user /home/limited_user/.codex/auth.json
sudo chmod 600 /home/limited_user/.codex/auth.json
```

Those mode commands apply to a file-backed profile only. Missing auth files or keyring storage require diagnosis, not blind file creation. Authentication success still does not prove Luna access; that remains a separately authorized canary.

## Evidence and sources

Local:

- `systemctl show` for both worker units, allowlisted unit-file reads, environment-file checks, executable symlink resolution, CLI version/help commands, passwd metadata, and Nick's sanitized auth/profile metadata.
- `worker-node/src/modules/state-assigner/codexCliClient.ts:197–215` and compiled counterpart: inherited environment and bare `codex` spawn.
- `worker-python/src/modules/ai_approver_v02/client.py:64–86`: inherited environment and bare `codex` subprocess.
- `docs/CODEX_CLI_SERVER_SETUP.md` and `docs/20261006_CODEX_CLI_SERVER_SETUP.md`.
- [[20261107_NewsNexus12_Weekly_Flow_02_Phases_6_7_Failure_Report]] for the prior incident evidence.

Official OpenAI repository, read-only HTTP retrieval:

- https://github.com/openai/codex/releases/tag/rust-v0.154.0
- https://github.com/openai/codex/releases/tag/rust-v0.166.0
- https://raw.githubusercontent.com/openai/codex/rust-v0.154.0/codex-rs/models-manager/models.json
- https://raw.githubusercontent.com/openai/codex/rust-v0.166.0/codex-rs/models-manager/models.json
- https://api.github.com/repos/openai/codex/releases/tags/rust-v0.166.0 for the pinned asset URL and SHA-256 digest.

## Remaining verification gaps

1. Live worker HOME/CODEX_HOME and any post-start environment mutations.
2. Same stored ChatGPT user/workspace between Nick and the service profile.
3. Current service-user token validity and actual model entitlement.
4. Whether upgrading alone eliminates the exact rejection.

The first two can be narrowed with the supplied read-only privileged diagnostic. The latter two require separately approved authentication/network validation and, for model access, a model invocation. No unsupported certainty is claimed here.
