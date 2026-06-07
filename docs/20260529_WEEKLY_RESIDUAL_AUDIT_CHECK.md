---
created_at: 2026-05-29
updated_at: 2026-05-29
created_by: codex (gpt-5.5)
modified_by: codex (gpt-5.5)
---

# Weekly residual audit check - 2026-05-29

## Date checked

2026-05-29 09:00:58 UTC +0000

## Branch and commit checked

- Branch: `dev_14_fix`
- Commit: `ff72b6d3f5f6bde7229f8ca09a2641ef0c805204`
- Status before report: `## dev_14_fix...origin/dev_14_fix`; ` M package-lock.json`

## Audit command results

- `npm --version`: `11.12.1`
- Root `npm audit --audit-level=moderate --json`: not clean; 6 total vulnerabilities: 0 low, 5 moderate, 1 high, 0 critical.
  - Known residual moderate: `next` / `postcss` advisory GHSA-qx2v-qp2m-jg93.
  - Known residual moderate: `uuid` via `exceljs` and `sequelize` advisory GHSA-w5hq-g745-h8pq.
  - New high finding: `tmp <0.2.6` advisory GHSA-ph9p-34f9-6g65 at `node_modules/tmp`, reached through `exceljs@4.4.0`.
- Portal `npm audit --prefix portal --audit-level=moderate --json`: clean; 0 vulnerabilities.

## Upstream package versions checked

- `next@latest`: `16.2.6`; `dependencies.postcss`: `8.4.31`.
- `exceljs@latest`: `4.4.0`; `dependencies.uuid`: `^8.3.0`.
- `sequelize@latest`: `6.37.8`; `dependencies.uuid`: `^8.3.2`.
- `tmp@latest`: `0.2.7`; patched `0.2.6` exists.

## Safe-fix assessment

- NewsNexus12 is not at 0 vulnerabilities.
- Findings are not only the accepted residual families; a new high `tmp` finding is present and requires immediate review.
- No safe upstream fix is visible yet for the known Next/PostCSS or UUID via ExcelJS/Sequelize residuals; npm still proposes unsafe downgrades for those families (`next@9.3.3`, `exceljs@3.4.0`, `sequelize@3.30.0`).
- A safe non-forced fix appears likely for `tmp`: `exceljs` depends on `tmp` as `^0.2.0`, and patched `tmp@0.2.6`/`0.2.7` exists. Because the working tree already had an uncommitted `package-lock.json`, this audit job did not modify dependency files.

## Recommended next action

Create a normal dependency-update branch from a clean working tree and update the lockfile/transitive resolution so `tmp` resolves to a patched version, then run full root and portal npm audits plus the normal test suite. Leave the known residual Next/PostCSS and UUID findings accepted unless a future upstream release removes those paths without downgrades.

## Notification status

Report written for the scheduled job response. No package files were changed and no separate notification command was run.
