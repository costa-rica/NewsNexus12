---
created_at: 2026-10-06T16:24:12Z
updated_at: 2026-10-06T16:24:12Z
created_by: codex (gpt-6.1-sol) nicksmacbookair
modified_by: codex (gpt-6.1-sol) nicksmacbookair
---

# Codex CLI Server Setup

This guide installs one system-wide Codex CLI executable on the Ubuntu server for both `nick` and `limited_user`.

The shared executable does not merge the users' profiles. Each account continues to use its own `HOME`, `.codex` directory, authentication, configuration, and session data.

## Scope

- Run every command in this guide on the Ubuntu server `nws-nn12dev`.
- Do not run these installation commands on the Mac workstation.
- The shared executable is `/usr/local/bin/codex`.
- The worker service reaches it through `/home/limited_user/environments/news_nexus_12/bin/codex`.
- The service user's Codex data remains under `/home/limited_user/.codex`.
- Nick's Codex data remains under `/home/nick/.codex`.

## 1. Confirm the Existing Paths

Run these commands as `nick` from any directory on the Ubuntu server:

```bash
npm config get prefix
readlink -f /home/limited_user/environments/news_nexus_12/bin/codex
ls -l /usr/local/bin/codex
type -a codex
```

Expected observations:

1. Nick's npm prefix may be `/home/nick/.npm-global`.
2. The service-user link should resolve to `/usr/local/bin/codex` before the npm conversion.
3. `/usr/local/bin/codex` should be the manually installed Codex `0.142.5` binary.
4. `type -a codex` shows whether Nick has another Codex earlier in `PATH`.

A plain `npm install -g` run as `nick` uses Nick's npm prefix. It does not update `/usr/local/bin/codex` when the prefix is `/home/nick/.npm-global`.

## 2. Stop the Worker Service

Stop worker-node so it cannot start a Codex process while the executable is being replaced:

```bash
sudo systemctl stop newsnexus12-worker-node.service
```

Confirm that it stopped:

```bash
sudo systemctl status newsnexus12-worker-node.service --no-pager -l
```

## 3. Preserve the Existing Binary

Confirm that the backup destination does not already exist:

```bash
ls -l /usr/local/bin/codex-0.142.5
```

If the command reports that the file does not exist, preserve the current binary:

```bash
sudo mv /usr/local/bin/codex /usr/local/bin/codex-0.142.5
```

The backup provides a direct rollback path.

## 4. Install Codex System-Wide

Install the current npm release with an explicit `/usr/local` prefix:

```bash
sudo npm install --global --prefix /usr/local @openai/codex@latest
```

The explicit prefix is required on this server because Nick's normal npm prefix is `/home/nick/.npm-global`.

Official OpenAI documentation identifies `@openai/codex@latest` as the npm package used to install or update Codex:

- https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex

## 5. Verify the Shared Executable

Verify the system-wide installation directly:

```bash
/usr/local/bin/codex --version
ls -l /usr/local/bin/codex
```

Verify the version seen through the worker service's path:

```bash
sudo -u limited_user env \
  HOME=/home/limited_user \
  PATH=/home/limited_user/environments/news_nexus_12/bin:/usr/local/bin:/usr/bin:/bin \
  codex --version
```

Both commands must report the same Codex version.

After an npm installation, `readlink -f` may resolve through `/usr/local/bin/codex` into the npm package directory. That is expected. The important requirement is that both accounts report the same version.

## 6. Verify Nick Uses the Shared Copy

Check Nick's normal command resolution:

```bash
command -v codex
type -a codex
codex --version
```

The preferred result is `/usr/local/bin/codex` with the same version reported for `limited_user`.

If `/home/nick/.npm-global/bin/codex` appears first, determine whether Nick also has a private npm installation:

```bash
npm list -g --depth=0 @openai/codex
```

If that command lists `@openai/codex`, uninstall only Nick's private copy:

```bash
npm uninstall -g @openai/codex
hash -r
command -v codex
codex --version
```

Do not uninstall the private copy unless `npm list` confirms that it exists.

## 7. Confirm Service-User Authentication

The executable is shared, but authentication remains account-specific. Confirm the service user's credential file and permissions without displaying its contents:

```bash
sudo ls -ld /home/limited_user/.codex
sudo ls -l /home/limited_user/.codex/auth.json
```

Expected permissions:

- `/home/limited_user/.codex`: owned by `limited_user:limited_user`, mode `700`.
- `/home/limited_user/.codex/auth.json`: owned by `limited_user:limited_user`, mode `600`.

The CLI upgrade should not replace or remove this authentication data.

## 8. Test the Required Model

Run a small read-only test as the service user:

```bash
sudo -u limited_user -H sh -lc 'cd /tmp && PATH=/home/limited_user/environments/news_nexus_12/bin:/usr/local/bin:/usr/bin:/bin codex exec --ephemeral --skip-git-repo-check -s read-only -m gpt-5.6-luna "Reply with OK"'
```

The test must complete without reporting that the model requires a newer Codex version.

## 9. Restart Worker-Node

Start the service after the CLI and model checks pass:

```bash
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl status newsnexus12-worker-node.service --no-pager -l
```

Verify the next state-assigner job logs the intended model and does not report a Codex version error.

## 10. Roll Back if Necessary

If the npm-installed Codex does not run correctly, stop worker-node and preserve the failed installation before restoring the old binary:

```bash
sudo systemctl stop newsnexus12-worker-node.service
sudo mv /usr/local/bin/codex /usr/local/bin/codex-npm-failed
sudo mv /usr/local/bin/codex-0.142.5 /usr/local/bin/codex
sudo chmod 755 /usr/local/bin/codex
```

Verify the restored version before restarting the service:

```bash
sudo -u limited_user env \
  HOME=/home/limited_user \
  PATH=/home/limited_user/environments/news_nexus_12/bin:/usr/local/bin:/usr/bin:/bin \
  codex --version

sudo systemctl start newsnexus12-worker-node.service
```
