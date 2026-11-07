---
created_at: 2026-11-07T16:59:01Z
updated_at: 2026-11-07T16:59:01Z
created_by: codex (gpt-6) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Codex server alignment: living plan v03

- This simpler plan replaces v02 for the CLI alignment work.
- Run commands as `nick` over SSH on `nws-nn12prod`, not on the Mac.
- Nick confirms State Assigner and AI Approver will not be running.
- Keep both users' `.codex` directories; they contain authentication and settings.
- Start with Step 1, paste its output below, and return to this chat. We will review it before deciding how to proceed with the remaining steps or document versions.
- No commands in this document have been executed by Codex. If a command fails, paste the error before continuing.
- When editing this file, update `updated_at` with the current UTC timestamp and set `modified_by: nick`. Preserve `created_at` and `created_by`.

## 1. Remove Nick's separate installation

- Remove `/home/nick/.npm-global/bin/codex` through npm.
- Keep the system-wide executable at `/usr/local/bin/codex`.
- Run these commands individually:

```bash
npm uninstall --global --prefix /home/nick/.npm-global @openai/codex
hash -r
command -v codex
codex --version
```

- Expected: `/usr/local/bin/codex`, currently `codex-cli 0.154.0` according to the report. Nick will temporarily use that older version until Step 2.

### Terminal Response

```text
removed 2 packages in 5s
/usr/local/bin/codex
codex-cli 0.154.0
```

## 2. Upgrade the shared executable

- Install standalone `0.166.0`, the version previously used by Nick. This avoids Python's missing-Node PATH issue.
- Run this whole block after reviewing Step 1. It downloads to a temporary directory and replaces `/usr/local/bin/codex`.

```bash
(
  set -eu
  nn12_codex_download=$(mktemp -d /tmp/newsnexus-codex.XXXXXX)
  cd "$nn12_codex_download"
  curl --fail --location --output codex.tar.gz \
    https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-x86_64-unknown-linux-musl.tar.gz
  tar -xzf codex.tar.gz codex-x86_64-unknown-linux-musl
  ./codex-x86_64-unknown-linux-musl --version
  sudo install -o root -g root -m 0755 \
    codex-x86_64-unknown-linux-musl /usr/local/bin/codex.new
  sudo mv -T /usr/local/bin/codex.new /usr/local/bin/codex
  /usr/local/bin/codex --version
)
```

- Expected: `codex-cli 0.166.0`. Authentication files are not changed by this installation.

### Terminal Response

```text
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
  0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0
100  116M  100  116M    0     0  50.3M      0  0:00:02  0:00:02 --:--:-- 61.7M
codex-cli 0.166.0
[sudo] password for nick: 
codex-cli 0.166.0
```

## 3. Confirm both users use the shared copy

- Check Nick and the two worker PATHs:

```bash
command -v codex
codex --version
sudo -u limited_user env \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /bin/sh -c 'command -v codex; codex --version'
sudo -u limited_user env \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/home/limited_user/environments/news_nexus_12/bin \
  /bin/sh -c 'command -v codex; codex --version'
readlink -f /home/limited_user/environments/news_nexus_12/bin/codex
```

- Expected: all three report `0.166.0`. The environment-bin symlink resolves to `/usr/local/bin/codex`.

### Terminal Response

```text
/usr/local/bin/codex
codex-cli 0.166.0
/usr/local/bin/codex
codex-cli 0.166.0
/home/limited_user/environments/news_nexus_12/bin/codex
codex-cli 0.166.0
/usr/local/bin/codex
```

## 4. Check authentication

- Each Linux user keeps its own login profile, even with one shared executable.

```bash
codex login status
sudo -u limited_user env \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/codex login status
```

- Expected: both report `Logged in using ChatGPT`. This confirms the authentication method, not that both use the same ChatGPT account/workspace.
- If a login is missing or account identity needs checking, review the output with Codex or Hermes before adding login commands.
- Paste status output only; never paste authentication files, tokens, or device-login codes.

### Terminal Response

```text
Logged in using ChatGPT
Logged in using ChatGPT
```

## 5. Test Luna as the service user

- This makes one live model call using `limited_user`'s profile. It does not submit an article-processing job.

```bash
(
  cd /tmp || exit 1
  sudo -u limited_user env \
    HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
    PATH=/usr/local/bin:/usr/bin:/bin \
    /usr/local/bin/codex exec --ephemeral --skip-git-repo-check \
      -s read-only -m gpt-6-luna 'Reply with OK'
)
```

- Expected: an `OK` response. If rejected, preserve the exact error; investigate account/model access instead of repeatedly reinstalling.
- After reviewing these results, prepare one-article state-assignment and approval tests. Exact application commands and article selection will be added then. Bulk recovery and code fixes are separate work.

### Terminal Response

```text
OpenAI Codex v0.166.0
--------
workdir: /tmp
model: gpt-6-luna
provider: openai
approval: never
sandbox: read-only
reasoning effort: none
reasoning summaries: none
session id: 01a1b6f7-e26f-7f31-a356-6ab3cece4953
--------
user
Reply with OK
warning: Codex could not find bubblewrap on PATH. Install bubblewrap with your OS package manager. See the sandbox prerequisites: https://developers.openai.com/codex/concepts/sandboxing#prerequisites. Codex will use the bundled bubblewrap in the meantime.
warning: Code Mode is unavailable because failed to spawn code-mode host /usr/local/bin/codex-code-mode-host: host executable was not found. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.
codex
OK
tokens used
2,834

```

## Follow-up Notes

- Add findings and agreed next actions here after reviewing terminal responses.
