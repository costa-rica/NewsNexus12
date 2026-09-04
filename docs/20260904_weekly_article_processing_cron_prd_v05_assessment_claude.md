---
created_at: 2026-09-04T16:52:04Z
updated_at: 2026-09-04T16:54:30Z
created_by: claude (claude-opus-5) nicksmacbookair
modified_by: codex (gpt-5.6-sol) nicksmacbookair
---

# Weekly Article Processing Cron PRD V05 — Assessment (claude)

## Threshold Decision

An assessment is warranted, but the bar is much closer this time.

Both V04 concerns are resolved. The two concerns below are narrower and neither blocks the rollout. They are worth one more pass because both sit inside the new configuration-check command, which is the control that is supposed to stop the September 4 class of failure from recurring.

If the operator prefers, both can be handled as implementation notes rather than a V06.

## Scope Of This Review

The removal of the host allowlists, the database allowlists, and `--confirm-dev-database` is treated as a resolved operator decision per PRD section 2.1. Nothing below flags those removals.

## What V04's Assessment Raised, And Where It Landed

Concern 1, the undefined validation command, is resolved. Section 12 now specifies the name, the location, the invocation, the required checks, the explicitly skipped work, and the production invocation pattern. It has tests in section 15.4 and an acceptance criterion at 17.9.

Concern 2, the production database role, is resolved. Sections 9 and 10 separate the Linux account from the PostgreSQL role, and section 10 scopes the bootstrap override to the schema command alone.

Both V04 minor notes are also addressed. Section 6 now tells the implementer not to add a duplicate `PG_DATABASE` check. Section 9 splits the identity error into two messages. Section 15.2 names concrete controls instead of the untestable V04 wording.

## Verified Against The Code

- The `ensureSchemaReady` auto-sync path in `db-manager/src/index.ts` cannot fire under `newsnexus_app`. Its required tables are only `Articles`, `Users` and `States`, all present on production and all readable by the app role. The role change does not reach `sequelize.sync()`.
- `parseWeeklyFlowConfig()` performs no filesystem access. `absolutePath()` only calls `path.isAbsolute` and `path.normalize`. So section 12.2.1 does not conflict with the section 12.3 ban on inspecting resource directories.
- `sequelize.authenticate()` issues a read-only query, satisfying section 12.2.3 without violating section 12.3.
- `parseWeeklyFlowCli` does not require `--allow-live-ai`, so section 12.3 can reuse the existing parser.
- The section 10 override works as written. db-manager calls plain `dotenv.config()`, which does not override an inherited variable, so `env PG_USER=newsnexus_boot` wins over `db-manager/.env`.
- The four unused config helpers left behind still will not break the build.

## Concern 1 — The identity rules are specified twice and can drift

Section 9 defines the production identity contract for preflight. Section 12.2, items 4 and 5, defines the same contract again for `run-config-check`.

Both say production requires Linux account `limited_user` and PostgreSQL role `newsnexus_app`. Nothing in section 14 says the two must share one implementation.

### Why this matters more than ordinary duplication

`run-config-check` is a certification gate. Rollout step 16.5 runs it, and the operator treats a zero exit as evidence that production is correctly configured before the supervised run.

If the two copies drift, the gate certifies a configuration that preflight then rejects. That is the same shape as the September 4 failure, where one surface passed and the enforcing surface failed.

Drift is easy here. A future role change touches section 9's constant, and the section 12 copy keeps the old value. Both have their own tests, in 15.3 and 15.4, so both test suites stay green while disagreeing.

### Suggested resolution

Add one implementation requirement to section 14.

- Export a single production identity check from a shared module.
- Have both `runPreflight()` and `run-config-check` call it.
- Add a test asserting both surfaces reject the same wrong role with the same message.

This costs one small function and removes the failure mode entirely.

## Concern 2 — The new wrapper escapes the operational asset checks

Section 12.1 adds `ops/weekly-article-flow/bin/run-config-check`. Section 14 has thirteen implementation items and none of them mentions `install.sh`.

Two existing checks enumerate the wrappers by name and would not see the new one.

1. `install.sh`, in `check_sources()`, runs `/bin/bash -n` against exactly three files: `run-weekly-flow`, `run-dev-canary`, and `run-dev-destructive-recovery`.
2. `tests/shellWrappers.test.ts` uses `it.each` over the same three names. It asserts the executable bit is set, that the script forwards `"$@"`, and that it does not reference systemd.

Section 15.4 tests the command's behavior, but none of its bullets covers shell syntax or the executable bit.

### The concrete failure

A `run-config-check` committed without the executable bit, or with a shell syntax error, ships green. Unit tests pass. `install.sh --check` passes. Acceptance criterion 17.16 is satisfied.

The operator discovers it at rollout step 16.5, under `sudo` and `runuser`, at the exact gate the command exists to provide.

### Suggested resolution

1. Add an implementation requirement to update `check_sources()` in `install.sh` to syntax-check the new wrapper.
2. Add `run-config-check` to the `it.each` list in `tests/shellWrappers.test.ts`.

Note that the third assertion in that test rejects any wrapper matching `systemctl`, `crontab` or `timer`. `run-config-check` does not need those, so it should pass unchanged.

## Minor Notes

These do not justify a rewrite on their own.

### Rollout step 16.12 edits production config after the timer is live

Step 16.10 enables the timer. Step 16.12 then removes the obsolete allowlist entries from the weekly-flow environment files.

Section 5 is right that the removal is not a gate, since the revised parser ignores the leftovers. But the edit still touches the file the live scheduled service reads, after scheduling is active.

Moving the cleanup before step 16.10 keeps every environment-file edit inside the window when the timer is disabled. This costs nothing.

### `.env.example` gives no prompt for `PG_USER`

The whole amendment depends on production carrying `PG_USER=newsnexus_app`, yet `.env.example` contains no `PG_` variables at all, and section 5 only removes entries from it.

An operator setting up a future server gets no cue. Preflight now fails clearly, so this is a convenience issue rather than a correctness one.

Consider adding a commented `PG_USER` line to `.env.example` recording the expected production role.

### Section 12.3 wording is slightly ambiguous

The bullet reads "initialize or synchronize database tables."

The intent is clear enough, since `sequelize.sync()` is the thing being banned. But `initModels()` is also commonly described as initializing models, and it is harmless and may be unnecessary here.

Saying "must not call `sequelize.sync()`" would remove the ambiguity.

## Open Questions

### 1. Shared identity check

Should the production identity rules live in one shared function called by both preflight and `run-config-check`?

#### Operator Response

Yes. Use one shared production identity function for both preflight and `run-config-check`. This keeps both checks consistent without restoring the removed environment safeguards.
