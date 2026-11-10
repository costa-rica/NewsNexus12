---
created_at: 2026-11-09T23:30:00Z
updated_at: 2026-11-10T00:17:17Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: nick
---

# Codex CLI dev server setup v01

These steps set up Codex on `nws-nn12dev` the way it is set up on production. The production setup is described in `docs/CODEX_CLI_PRODUCTION_RUNBOOK.md`, Section 1.

Target:

- One standalone binary at `/usr/local/bin/codex`, version `0.166.0`, owned by `root:root`, mode `0755`.
- No npm install of Codex for any user.
- worker-python's `codex` symlink points to `/usr/local/bin/codex`.
- `limited_user` and `nick` each have their own login, made with `codex login --device-auth`.

Run every command on `nws-nn12dev` as `nick` over SSH. Paste each output under its step's **Terminal response**. Never paste `auth.json` contents, tokens, or device-login codes.

## Step 1. See what is installed

```bash
hostname -s
uname -m
type -a codex
for c in $(which -a codex); do echo "$c -> $(readlink -f "$c")"; "$c" --version; done
ls -l /usr/local/bin/codex*
npm list -g --depth=0 @openai/codex
sudo npm list -g --depth=0 --prefix /usr/local @openai/codex
sudo -u limited_user env -i HOME=/home/limited_user PATH=/usr/bin:/usr/local/bin /bin/sh -c 'command -v codex; codex --version; codex login status'
readlink -f /home/limited_user/environments/news_nexus_12/bin/codex
systemctl cat newsnexus12-worker-node.service newsnexus12-worker-python.service | grep -E '^(# /|User=|Environment|WorkingDirectory=|ExecStart=)'
```

This shows every `codex` on Nick's PATH, whether npm installed any of them, what `limited_user` sees, where the worker-python symlink points, and the dev unit settings.

### Terminal response

```text
nws-nn12dev
x86_64
codex is /usr/local/bin/codex
codex -> /home/limited_user/applications/NewsNexus12/codex
codex-cli 0.160.1
is -> /home/limited_user/applications/NewsNexus12/is
zsh: command not found: is
/usr/local/bin/codex -> /usr/local/lib/node_modules/@openai/codex/bin/codex.js
codex-cli 0.160.1
lrwxrwxrwx 1 root root        46 Oct  6 16:28 /usr/local/bin/codex -> ../lib/node_modules/@openai/codex/bin/codex.js
-rwxr-xr-x 1 root root 285929520 Jul 10 23:04 /usr/local/bin/codex-0.142.5
/home/nick/.npm-global/lib
└── (empty)

[sudo] password for nick: 
/usr/local/lib
└── @openai/codex@0.160.1

/usr/local/bin/codex
codex-cli 0.160.1
Logged in using ChatGPT
/usr/local/lib/node_modules/@openai/codex/bin/codex.js
# /etc/systemd/system/newsnexus12-worker-node.service
User=limited_user
WorkingDirectory=/home/limited_user/applications/NewsNexus12/worker-node
Environment="NODE_ENV=production"
Environment="PATH=/usr/bin:/usr/local/bin"
EnvironmentFile=/home/limited_user/applications/NewsNexus12/worker-node/.env
ExecStart=/usr/bin/node dist/server.js
# /etc/systemd/system/newsnexus12-worker-python.service
User=limited_user
WorkingDirectory=/home/limited_user/applications/NewsNexus12/worker-python
Environment="PATH=/home/limited_user/environments/news_nexus_12/bin:/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=/home/limited_user/applications/NewsNexus12/worker-python/.env
ExecStart=/home/limited_user/environments/news_nexus_12/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 8004
```

## Step 2. Pause the workers

```bash
systemctl is-active newsnexus-weekly-flow-02.timer
sudo systemctl stop newsnexus-weekly-flow-02.timer
sudo systemctl stop newsnexus12-worker-node.service newsnexus12-worker-python.service
sudo pgrep -a -x codex
```

Note whether the timer was `active`. No output from `pgrep` is expected.

### Terminal response

```text
inactive
Failed to stop newsnexus-weekly-flow-02.timer: Unit newsnexus-weekly-flow-02.timer not loaded.
```

## Step 3. Remove the npm installs

Run only the lines whose `npm list` in Step 1 showed `@openai/codex`.

Nick's private npm copy:

```bash
npm uninstall -g @openai/codex
```

The system npm copy under `/usr/local`:

```bash
sudo npm uninstall -g --prefix /usr/local @openai/codex
```

Then check what is left:

```bash
hash -r
type -a codex
ls -l /usr/local/bin/codex*
```

Expected: no `codex` under `/home/nick`. `/usr/local/bin/codex` is either gone or an old standalone binary, which Step 4 replaces. Old backups such as `/usr/local/bin/codex-0.142.5` can stay.

### Terminal response

```text
codex not found
-rwxr-xr-x 1 root root 285929520 Jul 10 23:04 /usr/local/bin/codex-0.142.5
```

## Step 4. Install the standalone binary

This downloads `0.166.0`, checks it against the release's official SHA-256, and installs it at `/usr/local/bin/codex`.

```bash
(
  set -eu
  v=0.166.0
  work=$(mktemp -d /tmp/newsnexus-codex.XXXXXX)
  cd "$work"
  curl -fsSL -o release.json "https://api.github.com/repos/openai/codex/releases/tags/rust-v${v}"
  curl -fsSL -o codex.tar.gz "https://github.com/openai/codex/releases/download/rust-v${v}/codex-x86_64-unknown-linux-musl.tar.gz"
  expected=$(/usr/bin/python3 -c "import json; print(next(a['digest'] for a in json.load(open('release.json'))['assets'] if a['name']=='codex-x86_64-unknown-linux-musl.tar.gz'))")
  actual="sha256:$(sha256sum codex.tar.gz | awk '{print $1}')"
  test "$expected" = "$actual"
  echo "SHA-256 matches"
  tar -xzf codex.tar.gz codex-x86_64-unknown-linux-musl
  sudo rm -f /usr/local/bin/codex
  sudo install -o root -g root -m 0755 codex-x86_64-unknown-linux-musl /usr/local/bin/codex
  ls -l /usr/local/bin/codex
  /usr/local/bin/codex --version
)
```

Expected: `SHA-256 matches`, `-rwxr-xr-x 1 root root ... /usr/local/bin/codex`, and `codex-cli 0.166.0`. If the script stops before `SHA-256 matches`, paste the output and do not continue.

### Terminal response

```text
SHA-256 matches
-rwxr-xr-x 1 root root 319346888 Nov 10 00:04 /usr/local/bin/codex
codex-cli 0.166.0
```

## Step 5. Point worker-python at it

Skip this step if Step 1 showed the symlink already resolves to `/usr/local/bin/codex`.

```bash
sudo -u limited_user ln -sfn /usr/local/bin/codex /home/limited_user/environments/news_nexus_12/bin/codex
readlink -f /home/limited_user/environments/news_nexus_12/bin/codex
```

Expected: `/usr/local/bin/codex`. If Step 1 showed a different worker-python PATH in the unit, use that directory instead.

### Terminal response

```text
/usr/local/bin/codex
```

## Step 6. Log in limited_user

```bash
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/codex login --device-auth
```

1. Open the URL it prints in a browser on the Mac.
2. Sign in with the ChatGPT account the workers should use.
3. Enter the code. Do not paste the code below.

Then fix the profile's ownership and modes:

```bash
sudo chown limited_user:limited_user /home/limited_user/.codex /home/limited_user/.codex/auth.json
sudo chmod 700 /home/limited_user/.codex
sudo chmod 600 /home/limited_user/.codex/auth.json
sudo ls -ld /home/limited_user/.codex
sudo ls -l /home/limited_user/.codex/auth.json
```

### Terminal response

```text
drwx--S---+ 9 limited_user limited_user 4096 Nov 10 00:06 /home/limited_user/.codex
-rw------- 1 limited_user limited_user 4112 Nov 10 00:06 /home/limited_user/.codex/auth.json
```

## Step 7. Log in nick

Skip the login line if `codex login status` already prints `Logged in using ChatGPT`.

```bash
codex login status
codex login --device-auth
codex login status
```

### Terminal response

```text
Successfully logged in
Logged in using ChatGPT
```

## Step 8. Verify both users

```bash
command -v codex; codex --version; codex login status
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/usr/bin:/usr/local/bin \
  /bin/sh -c 'command -v codex; codex --version; codex login status'
sudo -u limited_user env -i \
  HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex \
  PATH=/home/limited_user/environments/news_nexus_12/bin \
  /bin/sh -c 'command -v codex; codex --version'
```

Expected: every version line is `codex-cli 0.166.0`, and both login checks print `Logged in using ChatGPT`.

Then make one model call as `limited_user`. Replace `gpt-6-luna` if the dev `.env` files use another model:

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

Expected: `OK` after the bubblewrap and Code Mode warnings.

### Terminal response

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
session id: 01a1c2ca-4388-7e43-ae38-693682390640
--------
user
Reply with OK
warning: Code Mode is unavailable because failed to spawn code-mode host /usr/local/bin/codex-code-mode-host: host executable was not found. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.
codex
OK
tokens used
1,938
```

## Step 9. Resume

```bash
sudo systemctl start newsnexus12-worker-node.service newsnexus12-worker-python.service
systemctl is-active newsnexus12-worker-node.service newsnexus12-worker-python.service
```

Start the timer only if Step 2 showed it was `active`:

```bash
sudo systemctl start newsnexus-weekly-flow-02.timer
```

### Terminal response

```text

```
