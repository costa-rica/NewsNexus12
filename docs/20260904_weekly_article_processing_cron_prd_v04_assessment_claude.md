---
created_at: 2026-09-04T16:03:48Z
updated_at: 2026-09-04T16:42:11Z
created_by: claude (claude-opus-5) nicksmacbookair
modified_by: claude (claude-opus-5) nicksmacbookair
---

# Weekly Article Processing Cron PRD V04 — Assessment (claude)

## Threshold Decision

An assessment is warranted.

Two concerns meet the plan-and-vet criteria. Concern 1 introduces a required deliverable that has no implementable definition and touches existing contracts. Concern 2 is a confirmed blocker sitting inside the rollout sequence this PRD claims will finish at timer activation.

The rest of the amendment is sound. The removals are accurate against the code, and the retained behavior it names is really there.

Amended 2026-09-04 after production evidence. Concern 2 was an open question when this assessment was first written. The operator has since read the production environment file, and the answer converts it into a confirmed blocker plus a standing over-privilege problem. Concern 2 is rewritten below.

## Scope Of This Review

The removal of the host allowlists, the database allowlists, and `--confirm-dev-database` is treated as a resolved operator decision per PRD section 2. Nothing below flags those removals, and nothing below recommends restoring them.

This review checked the amendment against the actual package at `ops/weekly-article-flow`.

Verified accurate:

- `WeeklyFlowConfig` really carries `devHosts`, `productionHosts`, `devDatabases`, `productionDatabases`.
- `parseWeeklyFlowConfig()` really parses all four and calls `rejectOverlap` twice.
- `expectedDevDatabase` and `--confirm-dev-database` exist exactly where the PRD says.
- The three preflight checks targeted for removal are the only consumers of the four config fields.
- `.env.example` really does set `newsnexus_prod` in both database lists, so it cannot pass its own parser.
- Resume validation already compares mode, host, source revision, and database name, matching section 10.
- Removing the four fields leaves no other caller, so the change is contained.
- `--canary-target 25` in the section 7 command form is correct. `dev_destructive_recovery` does honor a configured target.
- The four unused helpers left behind will not break the build. `tsconfig.json` does not set `noUnusedLocals` and the package has no lint step.

## Concern 1 — The new validation command has no definition

Implementation requirement 11.10 says only this:

> Add a non-mutating configuration validation command for rollout use.

That is the entire specification. It is a new operator-facing command with no name, no invocation surface, no scope boundary, and no verification.

Rollout requirement 13.5 depends on it. Acceptance criterion 14.12 requires its tests to pass. Section 12 defines no test for it, and section 14 has no acceptance criterion for it.

### Why this rises above ordinary vagueness

Every plausible shape an implementing agent might pick collides with something the PRD retains.

1. As a fifth `--mode` value

   - Section 8 lists exactly four modes and calls the mode list authoritative.
   - `WeeklyArticleFlowMode` lives in the shared `db-models` package, not in the weekly-flow package.
   - No database migration would be needed, since `mode` is `STRING(64)` validated by `isIn`. The contract change is still cross-package and still contradicts section 8.

2. As a flag on the existing entry point

   - `bin/run-weekly-flow` takes the exclusive `flock` on `/var/lock/newsnexus12-weekly-article-flow.lock` before it execs the CLI.
   - A validation run routed through that wrapper would exit 75 whenever a flow is active, which is one of the times an operator most wants to check configuration.

3. As configuration parsing only

   - `parseWeeklyFlowConfig()` never reads any `PG_` variable.
   - A parse-only command would therefore prove nothing about the PostgreSQL connection, which is the class of defect that caused the September 4 failure to matter.

### The invocation problem is not addressed either

Rollout requirement 13.5 says to validate the completed production environment. The production environment file is `root:root` mode `0600`, per the activation runbook section 1. `limited_user` cannot read it directly.

The repository already has a working pattern for this, in activation runbook section 3: `sudo /bin/bash -c 'set -a; source ...; set +a; exec runuser --user limited_user -- <command>'`.

The PRD does not reference that pattern. If the command is instead run plainly under `sudo`, and if it reuses preflight, the retained production identity check will reject it because the runtime user will not be `limited_user`.

### Suggested resolution

Specify the command concretely in a V05. At minimum:

1. A fixed name. The failure analysis proposed `config:check`, which is a reasonable choice.
2. Where it lives. A package script or a `bin/` wrapper, explicitly not a new `--mode` value.
3. Whether it acquires the host lock. Recommend that it does not.
4. Exactly which checks it performs, and which it deliberately skips.
5. The documented production invocation, reusing the existing `runuser` pattern.
6. One test requirement in section 12 and one acceptance criterion in section 14.

## Concern 2 — Production `PG_USER` blocks the rollout and is over-privileged

Confirmed on the production server on 2026-09-04:

```text
PG_USER=newsnexus_boot
```

Section 9 retains the production identity check. In code, `src/stages/preflight.ts` line 87 requires both `PG_USER` and the operating-system user to equal `limited_user`.

`newsnexus_boot` is not `limited_user`. The supervised `manual_production` run in rollout step 13.6 will throw in the first stage, before any other work. The rollout cannot reach timer activation as written.

### Three requirements sit on one variable

1. Preflight demands `limited_user`.

   - No Postgres role by that name is created anywhere in the repository.
   - `CREATE ROLE` appears only in `docs/db-models/POSTGRES_SETUP_UBUNTU.md` and `POSTGRES_SETUP_LOCAL.md`, and neither creates it.
   - V03 uses `limited_user` only for the Linux service account, for example at line 687 and line 552.
   - The check appears to conflate the operating-system account with the database role.

2. The schema installer needs `newsnexus_boot`.

   - Activation runbook section 3 sources the weekly-flow environment file to run `npm -C db-manager run schema:weekly-article-flow`.
   - That installer calls `run.sync()`, which issues CREATE TABLE.
   - Only `newsnexus_boot` holds CREATE on schema public.

3. The documented least-privilege contract wants `newsnexus_app`.

   - `POSTGRES_SETUP_UBUNTU.md` states that db-manager uses the bootstrap role because it runs schema rebuilds, and that all other apps use the app role.

### How the owner role became the standing credential

The weekly flow spawns db-manager as a subprocess and passes its own environment down. See `src/stages/maintenance.ts`, which sets `env: context.env`.

db-manager calls plain `dotenv.config()`, which does not override variables already present in the environment. The inherited `PG_USER` therefore wins over `db-manager/.env`.

Combined with the runbook sourcing the same file for the schema install, the database owner role became the credential used by every scheduled Friday run.

### The privilege is not needed

The three db-manager commands the weekly flow invokes are pure DML:

- `clearDuplicateAnalyses.ts` uses `findAll` and `destroy`.
- `deleteArticles.ts` uses `findAll` and `destroy`.
- `backup.ts` uses `findAll` only.

None issue DDL. No `sequelize.sync()`, no DROP SCHEMA, no GRANT. Those live in `zipImport.ts` and the two `install*Schema.ts` modules, which the weekly flow never calls.

`WeeklyArticleFlowRuns` already exists on production, so the schema install has already run. The one-time need for the bootstrap role is served.

### Privilege check completed

Verified on production on 2026-09-04. `newsnexus_app` has SELECT, INSERT, UPDATE and DELETE on all 31 public tables, and USAGE, SELECT and UPDATE on all 31 sequences.

Switching to the app role is safe on the privilege side. No grants are missing.

### Suggested resolution

This is two fixes, and only the first is configuration.

1. Set `PG_USER=newsnexus_app` in `/etc/newsnexus12/weekly-article-flow.env`.
2. Stop the schema installer from inheriting that value. Give runbook section 3 an explicit one-off `PG_USER=newsnexus_boot` override.
3. Correct the preflight check so it names the database role that actually exists, and keeps the separate operating-system account requirement.

Item 3 is a code change to a safeguard section 9 retains, which places it outside the amendment scope V04 declares. That is the main reason a V05 is likely needed.

Do not resolve this by relaxing the identity check into an unchecked value. The check is worth keeping once it names a real role.

## Minor Notes

These do not by themselves justify a rewrite. Fold them in if a V05 is written for Concern 1.

### Section 6 hedge invites a redundant check

Section 6 says validation must reject a missing or empty `PG_DATABASE` "when the database layer requires it."

That is already satisfied. `db-models/src/models/_connection.ts` calls `readRequired("PG_DATABASE")` at module load, and `src/stages/preflight.ts` imports the package at the top of the file. A missing value throws before any weekly-flow code runs.

Stating that no new check is added would stop an implementing agent from adding a duplicate guard in `parseWeeklyFlowConfig()`.

### Rollout step 13.3 is hygiene, not a gate

The parser ignores unrecognized environment variables. Leaving the four obsolete names in a server file will not break the new code.

The ordering in the PRD is already the safe one, since code ships before the environment files are cleaned. Marking step 13.3 as cleanup would prevent an implementing agent from treating it as a hard prerequisite.

### The identity error cannot say which half failed

`src/stages/preflight.ts` line 87 tests the operating-system account and the database role in one condition, then throws a single message naming both.

An operator hitting it cannot tell which identity was wrong without reading the source. Splitting it into two checks with two messages would shorten exactly this kind of diagnosis:

- production weekly flow must run as the limited_user account
- production weekly flow must connect as the expected database role

### Test 12.2 wording is untestable as written

"Manual production accepts only the existing production controls" does not name the controls. The adjacent bullets name concrete behavior. This one should too.

## Open Questions

### 1. Validation command shape

How should the non-mutating configuration validation command be invoked, and how far should it go?

- A package script, a `bin/` wrapper, or a flag on the existing entry point.
- Configuration parsing only, or configuration plus a PostgreSQL connection check.
- Whether it may reach the workers, which would make it non-trivial but far more useful.

#### Operator Response

(claude) Recommend a `bin/` wrapper named `run-config-check` that skips the host lock and verifies configuration plus PostgreSQL connectivity.

### 2. Scope of the role correction

Answered: production is `newsnexus_boot`. The remaining decision is how to correct it.

- Fix the environment file only, and leave preflight demanding a role that does not exist.
- Fix both, which means changing a retained V03 safeguard and therefore widening V04.
- Split it, so V04 ships the allowlist removal and a separate amendment handles the role contract.

#### Operator Response

Use `newsnexus_app` for the weekly flow.

Correct the preflight check to match, because changing the environment file alone still fails preflight and would not unblock the supervised run.

Keep every change inside `ops/weekly-article-flow` and its own runbooks. The rest of the monorepo is working. Do not change database roles, environment files, or configuration for any other package.
