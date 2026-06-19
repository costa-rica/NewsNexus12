---
created_at: 2026-06-12
updated_at: 2026-06-12
created_by: codex (gpt-5.5)
modified_by: codex (gpt-5.5)
---

# Weekly residual audit check - 2026-06-12

## Date checked

2026-06-12 09:01:13 UTC +0000

## Branch and commit checked

- Branch: `main`
- Commit: `87ae1bdbc6a64fab4350ab51054a5a4c29db9fc7`
- Status before report: `## main...origin/main`

## Audit command results

- `npm --version`: `11.12.1`
- Root `npm audit --audit-level=moderate --json`: not clean; 6 total vulnerabilities: 0 low, 5 moderate, 1 high, 0 critical.
  - Known residual moderate: `next` / `postcss` advisory GHSA-qx2v-qp2m-jg93.
  - Known residual moderate: `uuid` via `exceljs` and `sequelize` advisory GHSA-w5hq-g745-h8pq.
  - High finding requiring review: `tmp <0.2.6` advisory GHSA-ph9p-34f9-6g65 at `node_modules/tmp`, reached through `exceljs@4.4.0`.
- Portal `npm audit --prefix portal --audit-level=moderate --json`: clean; 0 vulnerabilities.

## Upstream package versions checked

- `next@latest`: `16.2.9`; `dependencies.postcss`: `8.4.31`.
- Installed portal `next`: `16.2.6`.
- `exceljs@latest`: `4.4.0`; `dependencies.uuid`: `^8.3.0`; transitive `tmp` currently resolves to `0.2.5`.
- `sequelize@latest`: `6.37.8`; `dependencies.uuid`: `^8.3.2`.
- `tmp@latest`: `0.2.7`; patched `0.2.6`+ exists.

## Safe-fix assessment

- NewsNexus12 is not at 0 vulnerabilities.
- Findings are not only the accepted residual moderate families because a high `tmp` advisory is present.
- No safe upstream fix is visible yet for the known Next/PostCSS or UUID via ExcelJS/Sequelize residuals; npm still proposes unsafe downgrades for those families (`next@9.3.3`, `exceljs@3.4.0`, `sequelize@3.30.0`).
- A safe non-forced fix appears likely for `tmp`: `exceljs` depends on `tmp` as `^0.2.0`, and patched `tmp@0.2.6`/`0.2.7` exists. This audit job did not modify dependency files.

## Recommended next action

Create a normal dependency-update branch from a clean working tree and update the lockfile/transitive resolution so `tmp` resolves to a patched version (`>=0.2.6`, preferably current `0.2.7`), then run root and portal npm audits plus the normal test suite. Keep the known Next/PostCSS and UUID findings as residuals until upstream releases remove those paths without downgrades.

## Notification status

Report written for the scheduled job response. No package files were changed and no separate notification command was run.
