---
created_at: 2026-05-22
updated_at: 2026-05-22
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# Residual audit risks

This register tracks accepted npm audit findings that remain after safe remediation. These entries should be revisited on the cadence chosen by the project owner and whenever the named upstream packages publish compatible fixes.

## postcss@<8.5.10 via next

- Advisory: GHSA-qx2v-qp2m-jg93, https://github.com/advisories/GHSA-qx2v-qp2m-jg93
- Severity: moderate
- Path: `node_modules/next/node_modules/postcss`
- Exposure rationale: The advisory concerns CSS stringification. NewsNexus does not currently accept attacker-controlled CSS for the portal build pipeline. The portal standalone audit is clean, but the root workspace lockfile still includes `next@16.2.6` with internal `postcss@8.4.31`.
- Current decision: accepted residual
- Revisit trigger: Next publishes a compatible patch after `16.2.6` that updates or removes its internal `postcss@8.4.31` dependency, or npm audit stops reporting the `next`/`postcss` path.
- Override spike result: Tried root `overrides` with `postcss: ^8.5.10` using npm `11.6.1`; npm still retained `node_modules/next/node_modules/postcss`, so the override did not reify cleanly.
- Last verified: 2026-05-22

## uuid@<11.1.1 via exceljs and sequelize

- Advisory: GHSA-w5hq-g745-h8pq, https://github.com/advisories/GHSA-w5hq-g745-h8pq
- Severity: moderate
- Path: `node_modules/exceljs/node_modules/uuid`
- Path: `node_modules/sequelize/node_modules/uuid`
- Exposure rationale: The advisory concerns missing buffer bounds checks in UUID v3/v5/v6 when a caller provides a buffer. Source reachability checks showed ExcelJS uses `uuid.v4`, and Sequelize uses `uuid.v1` and `uuid.v4`; the scan did not show ExcelJS or Sequelize calling `uuid.v3` or `uuid.v5` from normal library code. Practical exposure appears low for current NewsNexus usage.
- Current decision: accepted residual
- Revisit trigger: ExcelJS publishes a compatible v4 patch that updates from `uuid@8`, Sequelize publishes a compatible v6 patch that updates from `uuid@8`, or npm audit stops reporting the nested UUID paths.
- Override spike result: Tried root `overrides` with `uuid: ^11.1.1` using npm `11.6.1`; npm still retained `node_modules/exceljs/node_modules/uuid` and `node_modules/sequelize/node_modules/uuid`, so the override did not reify cleanly.
- Last verified: 2026-05-22

## Review cadence

1. Project owner still needs to choose the mechanical cadence.
2. Monthly review is recommended while these findings are open.
3. Quarterly review is acceptable if lower maintenance overhead is preferred.
4. On each review, run:
   - `npm audit --audit-level=moderate`
   - `npm audit --prefix portal --audit-level=moderate`
5. If the findings remain and no compatible upstream fix exists, update `Last verified`.
