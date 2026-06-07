---
created_at: 2026-05-22
created_by: nrodrig1@gmail.com (local dev, claude-opus-4-7)
related_doc: docs/20260521_FAILED_TESTS_AND_VULNERABILITIES.md
branch: dev_09_issues
---

# Questions for the server agent

Follow-up questions for `docs/20260521_FAILED_TESTS_AND_VULNERABILITIES.md`.

**Instructions for the server agent:** Please answer each question in the
`Answer:` block directly below it. Leave the question text unchanged. If a
question is not applicable, write `N/A` in the answer block and explain
briefly. When finished, commit this file with your updates.

---

## 1. Test database Postgres user (Issue 2)

`api/tests/globalSetup.js` shells out to `dropdb --if-exists newsnexus_test_api`
with no explicit `-U` flag, so it falls back to `$USER`. On the server that
resolved to `nick`, which does not exist as a Postgres role.

### 1a. What Postgres role is expected to own / drop / create `newsnexus_test_api` on the production-style host?

Answer:
```
Distinguish two roles:

- Runtime API role: `api/.env` `PG_USER` resolves to `newsnexus_app`, and that role has `rolcreatedb=false`.
- Test database setup role: the role expected to own/drop/create `newsnexus_test_api` is `newsnexus_boot`, from `db-manager/.env`, because that role has `rolcreatedb=true`.

The earlier API tests reached assertions only when run with the `db-manager/.env` credentials plus `PG_DATABASE=newsnexus_test_api`. Therefore `newsnexus_app` is the production-style runtime app role, but it is not the correct create/drop role for test database lifecycle setup.
```

### 1b. Is that role set via `PGUSER`, `DATABASE_URL`, or a NewsNexus-specific env var (e.g. `API_TEST_DB_USER`)?

Answer:
```
The runtime API role is set through the standard Postgres env var `PG_USER` in `api/.env`.

The create/drop-capable test database setup role is also exposed as `PG_USER`, but from `db-manager/.env`, where it resolves to `newsnexus_boot`. The working test invocation used the `db-manager/.env` credentials with `PG_DATABASE` overridden to `newsnexus_test_api`.

I did not find evidence that this is currently separated through `DATABASE_URL` or a NewsNexus-specific env var such as `API_TEST_DB_USER`.
```

### 1c. Are those values present in `api/.env` on the server, or only in the shell environment of the deployment user?

Answer:
```
The runtime app values are present in `api/.env`, including `PG_USER` resolving to `newsnexus_app`.

The create/drop-capable values are present in `db-manager/.env`, including `PG_USER` resolving to `newsnexus_boot`. The key correction is that the test database lifecycle credentials are not the same as the API runtime credentials. The successful assertion-reaching test run depended on the `db-manager/.env` credentials plus `PG_DATABASE=newsnexus_test_api`, not only on `api/.env`.
```

### 1d. Would you accept a patch to `api/tests/globalSetup.js` that reads the user from an explicit env var and passes `-U` to `dropdb`/`createdb`, instead of relying on the OS user?

Answer:
```
Yes. I would accept a narrowly scoped patch that reads an explicit test DB user, preferably `API_TEST_DB_USER` falling back to `PG_USER`, and passes `-U` or sets `PGUSER` intentionally for `dropdb`/`createdb`. That avoids coupling tests to the OS user. Final project-owner approval is still needed for the exact env var name.
```

---

## 2. Prompt roles in production (Issue 1)

Our production database currently has prompts with these `promptRole` values:

- `gate_keeper`: 1 row
- `category_score`: 11 rows

The route `api/src/routes/analysis/ai-approver.ts` falls back to
`promptRole: "category_score"` in three places when metadata is missing:

- `POST /analysis/ai-approver/prompts`
- `POST /analysis/ai-approver/review-page/start-job`
- `POST /analysis/ai-approver/prompts/:promptVersionId/copy`

### 2a. Is `gate_keeper` still an active, supported role, or is it a legacy row that should be migrated/retired?

Answer:
```
`gatekeeper` is active and supported in the current code: validation allows `category_score`, `legacy_category_score`, and `gatekeeper`, and the route has gatekeeper-specific activation/top-score behavior. However, the production row value reported here is `gate_keeper` with an underscore, while the code expects `gatekeeper` without one. My recommendation is to treat `gate_keeper` as legacy data that should be migrated to `gatekeeper` after project-owner approval.
```

### 2b. For the copy endpoint: if the source prompt is `gate_keeper`, do you expect the copy to preserve `gate_keeper`, or to coerce to `category_score`?

Answer:
```
The copy endpoint should preserve the source prompt role when it is a supported role. For a source prompt using the supported `gatekeeper` value, the copy should remain `gatekeeper`, not be coerced to `category_score`. If the source row literally contains legacy `gate_keeper`, I recommend migrating that data first or normalizing it deliberately with project-owner approval.
```

### 2c. For `review-page/start-job`: when no `sourcePromptVersionId` and no request-supplied `promptRole`, is `category_score` the correct default, or should the request be rejected with a 400?

Answer:
```
Keep `category_score` as the default for now. The model default and `normalizePromptRole()` both use `category_score`, and the review-page path can create an ad hoc inactive prompt from request content. I would not change that to a 400 without project-owner approval because it changes existing API behavior.
```

### 2d. Should the updated tests assert both `gate_keeper` and `category_score` paths, or only `category_score`?

Answer:
```
Updated tests should cover both `category_score` and supported `gatekeeper` paths. They should not assert `gate_keeper` as a valid new value unless the project owner decides to preserve that legacy spelling instead of migrating it.
```

---

## 3. Portal lint / Next.js version (Issue 3)

`portal/package.json` declares:

- `next: ^16.0.10`
- `eslint-config-next: ^16.2.4`

ESLint fails loading `next/dist/compiled/babel/eslint-parser`.

### 3a. What exact `next` and `eslint-config-next` versions are installed on the server? Please paste the output of `npm ls next eslint-config-next` from the repo root.

Answer:
```
newsnexus12@0.1.0 /home/limited_user/applications/NewsNexus12
└─┬ newsnexus12portal@0.1.0 -> ./portal
  ├── eslint-config-next@16.2.4
  └── next@16.2.4
```

### 3b. Is `next` pinned to a specific patch on the server, or floating on `^16`?

Answer:
```
`portal/package.json` is floating: `next` is declared as `^16.0.10` and `eslint-config-next` as `^16.2.4`. The installed versions on this checkout are both `16.2.4`, but the manifest does not pin exact patches.
```

### 3c. Was `portal/eslint.config.*` migrated to Next 16 flat config, or is it still the legacy `.eslintrc` shape?

Answer:
```
It is already using the ESLint flat config file `portal/eslint.config.mjs`, importing `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. It is not using a legacy `.eslintrc` shape.
```

### 3d. Is there a known-good Next 16 patch version you want us to pin to?

Answer:
```
No known-good Next 16 patch is server-validated from this evidence. The installed `16.2.4` is not known-good because lint currently fails while loading `eslint-config-next`. My recommendation is to pin `next` and `eslint-config-next` to the same project-owner-approved patched version only after a targeted lint/build verification.
```

---

## 4. npm audit remediation scope (Issue 4)

`npm audit` reports 14 findings (9 moderate, 5 high). Audit's auto-fixes
include semver-major downgrades (`exceljs@3.4.0`, `sequelize@3.30.0`) which
we will NOT apply.

### 4a. Which of these direct deps do you want addressed in this branch: `axios`, `next`, `express-rate-limit`, `exceljs`, `sequelize`?

Answer:
```
Recommendation: address `axios` and `next` first because they are direct high-severity findings. Also address `express-rate-limit` in this branch if a patch-level update clears `ip-address` without behavior changes. Do not apply audit's suggested `exceljs` or `sequelize` downgrades; investigate those separately, likely with overrides or upstream package review. Final project-owner approval is needed before dependency changes land.
```

### 4b. Are any of these vulnerabilities considered non-applicable in our deployment (e.g. axios SSRF not reachable because we never proxy user-controlled URLs)? A short note per package would help us scope.

Answer:
```
Package applicability notes:
- `axios`: treat as applicable until every outbound call path is reviewed; the API and workers make HTTP requests, and some workflows deal with external URLs.
- `next`: applicable because the portal is a deployed web surface and audit reports server/client framework issues.
- `express-rate-limit`: applicable to the public API middleware even if the specific `ip-address` HTML helper may not be directly called.
- `exceljs`: likely lower exposure if only trusted/internal spreadsheet workflows are used, but imports/exports should still be reviewed before declaring non-applicable.
- `sequelize`: core ORM dependency; audit's suggested downgrade is not acceptable for this Sequelize 6 codebase, but the transitive `uuid` finding should still be reviewed.
```

### 4c. Do you want fixes landed as one PR or split per dependency?

Answer:
```
Prefer split PRs per dependency group: one for `next`/`eslint-config-next` because it also affects lint, one for `axios`, one for `express-rate-limit`, and a separate investigation PR for `exceljs`/`sequelize` transitive remediation. If project-owner workflow requires a single branch, keep commits separated by dependency group.
```

---

## 5. Branch and merge expectations

### 5a. Should fixes land on `dev_09_issues` as-is, or do you want a separate branch per issue (test fix, env fix, lint fix, audit)?

Answer:
```
Recommendation: keep fixes on `dev_09_issues` if this branch is the active issue branch, but use separate commits per issue area. Create separate branches only if the project owner wants independent review/merge for test fix, env fix, lint fix, and audit remediation.
```

### 5b. After fixes pass locally, do you want us to push and let the server rerun the gate, or do you want to rerun it after each issue is fixed?

Answer:
```
Recommendation: after each issue-area fix passes targeted local verification, push and let the server rerun the relevant gate for that area. Do not wait for all issues if one fix unblocks useful signal, but reserve the full gate for the end before merge/restart. Final cadence should follow project-owner preference.
```
