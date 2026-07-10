# Codex CLI Server Setup

Install the Codex CLI system-wide on a server so both `nick` and the `limited_user` systemd service can use it. Performed on `nws-nn12dev`.

## 1. Install codex system-wide

```
# as nick, on nws-nn12dev
cd /tmp
curl -LO https://github.com/openai/codex/releases/download/rust-v0.142.5/codex-x86_64-unknown-linux-musl.tar.gz
tar xzf codex-x86_64-unknown-linux-musl.tar.gz
sudo install -m 755 codex-x86_64-unknown-linux-musl /usr/local/bin/codex
codex --version   # should print codex-cli 0.142.5
```

## 2. Authorize the service user

Copies nick's Codex credentials to `limited_user`.

```
sudo mkdir -p /home/limited_user/.codex
sudo cp /home/nick/.codex/auth.json /home/limited_user/.codex/auth.json
sudo chown -R limited_user:limited_user /home/limited_user/.codex
sudo chmod 700 /home/limited_user/.codex && sudo chmod 600 /home/limited_user/.codex/auth.json
```

## 3. Add codex to the service PATH

```
sudo ln -sf /usr/local/bin/codex /home/limited_user/environments/news_nexus_12/bin/codex
```

## 4. Verify as the service user

```
sudo -u limited_user env HOME=/home/limited_user \
  PATH=/home/limited_user/environments/news_nexus_12/bin \
  codex exec --ephemeral --skip-git-repo-check -s read-only -m gpt-5.4-mini "Reply with OK"
```

Expected response:

```
OpenAI Codex v0.142.5
--------
workdir: /tmp
model: gpt-5.4-mini
provider: openai
approval: never
sandbox: read-only
reasoning effort: none
reasoning summaries: none
session id: 019f4e48-142c-7b82-9745-d2a6005a3885
--------
user
Reply with OK
warning: Codex could not find bubblewrap on PATH. Install bubblewrap with your OS package manager. See the sandbox prerequisites: https://developers.openai.com/codex/concepts/sandboxing#prerequisites. Codex will use the bundled bubblewrap in the meantime.
codex
OK
```
