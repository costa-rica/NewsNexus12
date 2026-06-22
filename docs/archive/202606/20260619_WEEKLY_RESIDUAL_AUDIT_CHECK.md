---
created_at: 2026-06-19
updated_at: 2026-06-19
created_by: codex (gpt-5.5)
modified_by: codex (gpt-5.5)
---

# Weekly residual audit check - 2026-06-19

## Date checked

2026-06-19 09:00:09 UTC +0000

## Branch and commit checked

- Branch: `dev_03_articles_table`
- Commit: `87ae1bdbc6a64fab4350ab51054a5a4c29db9fc7`
- Status before report: `## dev_03_articles_table`; ` M portal/src/components/tables/TableReviewArticles.tsx`; `?? docs/20260612_WEEKLY_RESIDUAL_AUDIT_CHECK.md`
- Note: requested reference path was not present at `docs/20260522_WEEKLY_RESIDUAL_AUDIT_CHECK_SERVER_AGENT.md`; archived copy was found at `docs/archive/202605/20260522_WEEKLY_RESIDUAL_AUDIT_CHECK_SERVER_AGENT.md`.

## Audit command results

- `npm --version`: `11.13.0`
- Root `npm audit --audit-level=moderate --json`: not clean; 32 total vulnerabilities: 2 low, 25 moderate, 5 high, 0 critical.
  - Known residual moderate: `next` / `postcss` advisory GHSA-qx2v-qp2m-jg93.
  - Known residual moderate: `uuid` via `exceljs` and `sequelize` advisory GHSA-w5hq-g745-h8pq.
  - New/severe root findings requiring review include high `form-data`, `multer`, `nodemailer`, `tmp`, and `undici`; moderate families also include Jest/ts-jest/js-yaml, `protobufjs`, and `tar`; low families include `@babel/core` and `esbuild`.
- Portal `npm audit --prefix portal --audit-level=moderate --json`: not clean; 2 total vulnerabilities: 1 low, 1 moderate, 0 high, 0 critical.
  - Portal findings: low `@babel/core` and moderate `js-yaml`.

## Upstream package versions checked

- `next@latest`: `16.2.9`; `dependencies.postcss`: `8.4.31`.
- `exceljs@latest`: `4.4.0`; `dependencies.uuid`: `^8.3.0`.
- `sequelize@latest`: `6.37.8`; `dependencies.uuid`: `^8.3.2`.

## Safe-fix assessment

- NewsNexus12 is not at 0 vulnerabilities.
- Findings are not only the accepted residual moderate families; there are new high root findings and new portal findings.
- No safe upstream fix is visible yet for the known Next/PostCSS or UUID via ExcelJS/Sequelize residuals. npm audit still reports unsafe downgrade-style fixes for those families (`next@9.3.3`, `exceljs@3.4.0`, `sequelize@3.30.0`).
- Safe non-forced fixes appear likely for multiple new findings because npm audit marks several as fixable without forcing, but this scheduled audit did not modify package files.

## Recommended next action

Create a normal dependency-update/security branch from a clean working tree. First review the current uncommitted work, then update dependency manifests/lockfiles without `npm audit fix --force` to address the new high findings (`form-data`, `multer`, `nodemailer`, `tmp`, `undici`) plus portal `js-yaml`/`@babel/core`, then rerun root and portal audits and the normal test suite. Keep the known Next/PostCSS and UUID findings as residuals until upstream releases remove those paths without downgrades.

## Notification status

Report written for the scheduled job response. No package files were changed and no separate notification command was run.
