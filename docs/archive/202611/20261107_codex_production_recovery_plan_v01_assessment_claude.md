---
created_at: 2026-11-07T16:27:49Z
updated_at: 2026-11-07T16:35:10Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: codex (gpt-6) nicksmacbookair
---

# Assessment: production Codex recovery plan v01

## Verdict

The direction is right: one pinned standalone binary at `/usr/local/bin/codex`, separate per-user profiles, canaries before bulk work, fix false success, targeted repair. The standalone-over-npm choice is correct given worker-python's PATH.

Three concerns qualify under plan-and-vet: one risk to existing functionality, one goal the plan may not achieve, and one missing decision branch that makes the maintenance window possibly wasted.

## Concern 1: Step 1 is ordered wrong (risk to existing functionality)

Step 1 removes Nick's working 0.166.0 install before the shared binary is upgraded. Until Step 3 completes, Nick and anything running as Nick resolve 0.154.0.

- Hermes uses Codex as Nick (the failure report says it "used Codex for an independent source review"). Hermes would silently move to the old CLI.
- `/home/nick/.codex` has been written by 0.166.0 and, per the cache metadata, a 0.167.0 client. Running 0.154.0 against a profile written by newer clients is an untested downgrade.
- Nothing in Steps 2–3 needs Nick's install gone. The duplicate causes no harm to the workers.

Recommendation: move the uninstall to the end of Step 3, after 3.4 verifies `/usr/local/bin/codex` is 0.166.0. Nick then moves 0.166.0 → 0.166.0, a no-op.

## Concern 2: "One installation" is not proven by the inventory

Hermes found Nick's model cache stamped with client version **0.167.0**, while Nick's npm install is 0.166.0 and the shared binary is 0.154.0. Some 0.167.0 client wrote to Nick's profile. That is a third installation (IDE extension, Hermes-bundled copy, a since-replaced npm version, or other) that the plan doesn't account for.

Step 1's `command -v codex` only shows the first hit on one PATH. It won't find copies on other PATHs or launched by absolute path.

Recommendation: before removing anything, take a full inventory as Nick and with sudo:

```bash
type -a codex
sudo find / -xdev \( -name codex -o -name 'codex-*-unknown-linux-*' \) -type f 2>/dev/null
ls -la ~/.vscode-server/extensions 2>/dev/null | grep -i -e openai -e codex
```

## Concern 3: The plan swaps production before testing the hypothesis, and has no branch if it's wrong

Hermes said the upgrade is "not yet proven" to fix the rejection. The error text (`not supported when using Codex with a ChatGPT account`) fits an account/plan entitlement problem as well as an old-client problem. The plan stops production, swaps the binary, and only in Step 5 learns which one it is. If Luna is still rejected, Step 5 says "investigate with Hermes" and the window ends with nothing recovered.

Two changes fix this:

1. **Test the candidate binary before the maintenance window, without touching production.** Download and verify 0.166.0 to a temp dir (the Step 3.3 download/digest steps), then, once live calls are authorized, run one tiny call by absolute path as `limited_user` while the workers keep running:

   ```bash
   sudo -u limited_user env -i HOME=/home/limited_user CODEX_HOME=/home/limited_user/.codex PATH=/usr/bin:/usr/local/bin \
     /tmp/<dir>/codex-x86_64-unknown-linux-musl exec --ephemeral --skip-git-repo-check -s read-only -m gpt-6-luna 'Reply OK'
   ```

   Run the same prompt with `/usr/local/bin/codex` (0.154.0). Same account, same model, only the client differs: a clean A/B. (The temp dir must be readable by `limited_user`.)

2. **Add an explicit decision point to the plan:**
   - 0.166.0 accepts, 0.154.0 rejects → client version is the cause. Proceed with Step 3.
   - Both reject → entitlement or workspace problem. Upgrading still removes version drift, but recovery needs a different model. The operator chooses a supported model (e.g. `gpt-5.6-luna`, which is in the 0.154.0 catalog) for **both** `STATE_ASSIGNER_MODEL_NAME` and `AI_APPROVER_V02_MODEL_NAME`, or fixes the account.

The workers' Codex flags (`exec --ephemeral --skip-git-repo-check -s read-only --output-last-message -m`) are in both versions' basic CLI. I see no parsing risk from the version change. The one-article canary in Step 5 still covers it.

## Minor notes (not blocking)

- Step 4's HOME overrides are probably already true in effect. systemd sets `HOME` for units with `User=` unless `SetLoginEnvironment` is explicitly off in the unit file. The `systemctl show` value `no` may be the reported default, not an explicit setting. Also, the incident's ChatGPT-account error shows the workers did find a logged-in profile. Explicit overrides are fine as hardening. Step 2's procfs read will settle it.
- Step 3.2's `curl` calls inside `set -eu` print queue status but don't check that it's idle. The operator must read them. I checked the routes: worker-node `/queue-info/queue_status` and worker-python `/queue-info/queue-status` are both correct.
- Step 6 should land before Step 7. If the repair run hits a permanent model error, it should fail fast instead of burning another hour.

## Open Questions

### For the operator (Nick)

#### 1. Shared or private installation

Do you want Nick's own Codex to stay on the shared root-owned binary going forward? Then every upgrade needs sudo and a worker maintenance window. Or is a pinned parity check enough (Nick's version == workers' version) while you keep a private install?

##### Operator Response

(codex) Recommend one shared executable at `/usr/local/bin/codex`, with separate user profiles. Upgrade and verify it before removing Nick’s private installation.

#### 2. Authorize the two-call test

Will you authorize the two-call A/B test in Concern 3 before the maintenance window?

##### Operator Response

(codex) Recommend authorizing two minimal Luna test calls as `limited_user`, one per CLI version, before replacing production. Keep the account, model, and prompt identical.

#### 3. Accept an alternative model

If Luna turns out to be unavailable to the account, is `gpt-5.6-luna` (or another model) acceptable for both workers?

##### Operator Response

(codex) Recommend deferring model substitution until Luna testing finishes. If unavailable, test a supported alternative for access and application quality before selecting it for both workers.

### For Hermes on nws-nn12prod

#### 1. Hermes executable selection

How does Hermes invoke Codex: Nick's PATH, a bundled copy, or an absolute path? Will it keep working after Nick's npm package is removed?

##### Hermes Response

#### 2. Source of the 0.167.0 cache

What wrote the 0.167.0 client version into Nick's model cache? Please run the inventory in Concern 2 and report every `codex` binary with its version and owner.

##### Hermes Response

#### 3. Worker login environment setting

Is `SetLoginEnvironment` explicitly set in either worker unit file, or is `no` only the reported default?

##### Hermes Response
