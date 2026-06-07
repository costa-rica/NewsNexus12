---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Weekly residual audit check for nn12dev server agent

This file instructs the nn12dev server AI agent to check once per week whether the accepted residual audit findings have become safely fixable.

## 1. Purpose

- Check whether upstream packages now provide safe fixes for the remaining root npm audit findings.
- Do not run forced audit remediation.
- If a safe fix exists, write a dated report and notify Nick on Telegram.
- If no safe fix exists, update the report only if useful and leave the code unchanged.

## 2. Scope

- Repository: NewsNexus12 on nn12dev.
- Current residual findings:
  - `postcss <8.5.10` through `next`.
  - `uuid <11.1.1` through `exceljs` and `sequelize`.

## 3. Weekly commands

Run these from the repository root:

```bash
git status --short
npm --version
npm audit --audit-level=moderate
npm audit --prefix portal --audit-level=moderate
npm view next version
npm view next@latest dependencies.postcss --json
npm view exceljs version
npm view exceljs@latest dependencies.uuid --json
npm view sequelize version
npm view sequelize@latest dependencies.uuid --json
```

## 4. Decision rules

1. If root audit still reports only the two known residual families:
   - Do not change package files.
   - Do not run `npm audit fix --force`.
   - Note that no safe upstream fix is available yet.

2. If root audit reports new high or critical findings:
   - Write a report.
   - Notify Nick on Telegram.
   - Do not apply broad fixes without a separate implementation branch or explicit approval.

3. If `next@latest` is newer than the currently installed version and appears to remove or update the internal vulnerable `postcss` path:
   - Write a report explaining the available Next update.
   - Notify Nick on Telegram.
   - Recommend a normal dependency-update branch.

4. If `exceljs@latest` or `sequelize@latest` updates from `uuid@8` to a patched compatible version:
   - Write a report explaining which package now has a safe upstream fix.
   - Notify Nick on Telegram.
   - Recommend a normal dependency-update branch.

5. If `npm audit fix --force` still proposes downgrades such as `next@9.3.3`, `exceljs@3.4.0`, or `sequelize@3.30.0`:
   - Treat that as not safe.
   - Do not apply it.

## 5. Report file

When a report is warranted, create:

```text
docs/YYYYMMDD_WEEKLY_RESIDUAL_AUDIT_CHECK.md
```

Use the standard docs frontmatter. Include:

1. Date checked.
2. Branch and commit checked.
3. Audit command results.
4. Upstream package versions checked.
5. Whether a safe fix is available.
6. Recommended next action.
7. Telegram notification status.

## 6. Current residual findings

### 6.1 postcss@<8.5.10 via next

- Advisory: GHSA-qx2v-qp2m-jg93, https://github.com/advisories/GHSA-qx2v-qp2m-jg93
- Severity: moderate
- Path: `node_modules/next/node_modules/postcss`
- Exposure rationale: The advisory concerns CSS stringification. NewsNexus does not currently accept attacker-controlled CSS for the portal build pipeline. The portal standalone audit is clean, but the root workspace lockfile still includes `next@16.2.6` with internal `postcss@8.4.31`.
- Current decision: accepted residual
- Revisit trigger: Next publishes a compatible patch after `16.2.6` that updates or removes its internal `postcss@8.4.31` dependency, or npm audit stops reporting the `next`/`postcss` path.
- Override spike result: Tried root `overrides` with `postcss: ^8.5.10` using npm `11.6.1`; npm still retained `node_modules/next/node_modules/postcss`, so the override did not reify cleanly.
- Last verified: 2026-05-22

### 6.2 uuid@<11.1.1 via exceljs and sequelize

- Advisory: GHSA-w5hq-g745-h8pq, https://github.com/advisories/GHSA-w5hq-g745-h8pq
- Severity: moderate
- Path: `node_modules/exceljs/node_modules/uuid`
- Path: `node_modules/sequelize/node_modules/uuid`
- Exposure rationale: The advisory concerns missing buffer bounds checks in UUID v3/v5/v6 when a caller provides a buffer. Source reachability checks showed ExcelJS uses `uuid.v4`, and Sequelize uses `uuid.v1` and `uuid.v4`; the scan did not show ExcelJS or Sequelize calling `uuid.v3` or `uuid.v5` from normal library code. Practical exposure appears low for current NewsNexus usage.
- Current decision: accepted residual
- Revisit trigger: ExcelJS publishes a compatible v4 patch that updates from `uuid@8`, Sequelize publishes a compatible v6 patch that updates from `uuid@8`, or npm audit stops reporting the nested UUID paths.
- Override spike result: Tried root `overrides` with `uuid: ^11.1.1` using npm `11.6.1`; npm still retained `node_modules/exceljs/node_modules/uuid` and `node_modules/sequelize/node_modules/uuid`, so the override did not reify cleanly.
- Last verified: 2026-05-22

## 7. Telegram notification

Use the server's existing Telegram notification mechanism or configured secrets. Do not write Telegram tokens, chat IDs, or credentials into this repository.

Suggested message when no safe fix is available:

```text
NewsNexus12 weekly residual audit check: no safe upstream fix yet. Root audit still has the known moderate Next/PostCSS and UUID findings. No action taken.
```

Suggested message when a safe fix may be available:

```text
NewsNexus12 weekly residual audit check: possible safe dependency fix available. See docs/YYYYMMDD_WEEKLY_RESIDUAL_AUDIT_CHECK.md before applying changes.
```

Suggested message for new severe findings:

```text
NewsNexus12 weekly residual audit check: new high/critical npm audit finding detected. See docs/YYYYMMDD_WEEKLY_RESIDUAL_AUDIT_CHECK.md.
```

## 8. Guardrails

- Do not run `npm audit fix --force`.
- Do not downgrade `next`, `exceljs`, or `sequelize`.
- Do not commit package changes from the weekly check unless Nick explicitly asks for implementation.
- Do not store Telegram secrets in git.
- Keep reports factual and short.
