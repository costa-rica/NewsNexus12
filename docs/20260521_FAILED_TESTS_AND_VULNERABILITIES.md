---
created_at: 2026-05-21
updated_at: 2026-05-21
created_by: hermes nws-nn12prod (gpt-5.5)
modified_by: hermes nws-nn12prod (gpt-5.5)
---

# Failed Tests and Vulnerability Findings

## Purpose

This document captures the issues found after updating `main` and running the repository test/check gate on 2026-05-21. It is intentionally a markdown tracking document in `docs/`, not a GitHub issue.

## Branch and repository context

- Branch created for this write-up: `dev_09_issues`
- Base branch: `main`
- Repository: `NewsNexus12`
- Relevant current commit observed before branching: `7a64240 fix: orchestrator report no-state article cell`
- Working tree before this documentation change: clean

## Commands run during the gate

The previous test gate included:

```bash
npm install
npm test --workspace @newsnexus/db-manager
npm test --workspace newsnexus12-worker-node
npm test --workspace newsnexus12api
npm run lint --workspace newsnexus12portal
```

A follow-up audit summary was collected with:

```bash
npm audit --json
```

A follow-up targeted rerun was attempted with:

```bash
npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts
npm run lint --workspace newsnexus12portal
```

The targeted API rerun could not reach the original test assertions from the current shell user because Jest global setup attempted to run `dropdb` against local Postgres as role `nick`, and that role does not exist. That environment/setup failure is documented separately below so it does not hide the original API test failure.

## Summary of results

### Passing checks

- `@newsnexus/db-manager` tests passed.
  - Result observed: `146 passed`, `9 test suites passed`.
- `newsnexus12-worker-node` tests passed.
  - Result observed: `166 passed`, `33 test suites passed`.
  - This included `tests/modules/orchestrator/reportWriter.test.ts`, confirming the orchestrator report no-state article cell fix remained covered.

### Failed or blocked checks

- `newsnexus12api` test suite failed in `api/tests/analysis/ai-approver.routes.test.ts` during the original gate.
- `newsnexus12portal` lint failed before linting source files because ESLint could not load the Next.js compiled Babel parser.
- The current shell user's targeted API rerun is additionally blocked by a local Postgres role mismatch in test global setup.

### Build and restart gate status

Builds and service restarts were not run. The requested sequence was: run tests first, build apps only if tests pass, then restart apps. Because the test/check gate failed, the build and restart steps were intentionally skipped.

## Issue 1: API AI Approver route tests expect an older prompt create shape

### Area

- Package/workspace: `newsnexus12api`
- Test file: `api/tests/analysis/ai-approver.routes.test.ts`
- Route implementation: `api/src/routes/analysis/ai-approver.ts`

### Original observed failure

The original API test run reported failures in:

```text
api/tests/analysis/ai-approver.routes.test.ts
```

The failure was an expectation mismatch around calls to:

```ts
AiApproverPromptVersion.create(...)
```

The route now passes additional/default fields that the tests do not currently expect:

```ts
modelName: null
pipelineVersion: null
promptKey: null
promptRole: "category_score"
responseSchemaVersion: null
```

The previous gate summary showed the API workspace had other passing tests, but this file failed due to these object shape mismatches.

### Likely failing test cases

Based on the assertions in `api/tests/analysis/ai-approver.routes.test.ts` and the route implementation, the likely affected tests are the prompt-creation paths that assert an exact `toHaveBeenCalledWith` object:

1. `POST /analysis/ai-approver/prompts creates a prompt row`
2. `POST /analysis/ai-approver/review-page/start-job creates an inactive prompt row and proxies worker request`
3. `POST /analysis/ai-approver/prompts/:promptVersionId/copy copies an existing prompt`

Those tests currently expect only the legacy prompt fields, such as:

```ts
{
  name: "Residential Fire",
  description: "Prompt for house fires",
  promptInMarkdown: "# Task",
  isActive: true,
  endedAt: null,
}
```

The implementation now creates prompt rows with the legacy fields plus prompt metadata fields:

```ts
{
  name: name.trim(),
  description: "...",
  promptInMarkdown: promptInMarkdown.trim(),
  isActive: Boolean(isActive),
  endedAt: null,
  promptRole: "category_score",
  promptKey: null,
  pipelineVersion: null,
  responseSchemaVersion: null,
  modelName: null,
}
```

### Implementation behavior observed in code

`api/src/routes/analysis/ai-approver.ts` now normalizes and persists prompt metadata fields in three places:

- `POST /analysis/ai-approver/prompts`
  - Uses `normalizePromptRole(promptRole)`.
  - Uses `cleanOptionalString(...)` for `promptKey`, `pipelineVersion`, `responseSchemaVersion`, and `modelName`.
- `POST /analysis/ai-approver/review-page/start-job`
  - Uses request metadata when provided.
  - Falls back to metadata from `sourcePromptVersionId` when available.
  - Falls back to null/default role when no source metadata is available.
- `POST /analysis/ai-approver/prompts/:promptVersionId/copy`
  - Copies prompt metadata from the source prompt.
  - Falls back to `promptRole: "category_score"` and null optional metadata when absent.

### Assessment

This appears to be a stale-test issue rather than an obvious route regression. The implementation has intentionally expanded the prompt row create payload to include prompt metadata fields, but the tests still assert exact legacy payloads.

### Recommended resolution

Update the affected tests to expect the new metadata fields. For example, the basic prompt create expectation should include:

```ts
expect(mockAiApproverPromptVersion.create).toHaveBeenCalledWith({
  name: "Residential Fire",
  description: "Prompt for house fires",
  promptInMarkdown: "# Task",
  isActive: true,
  endedAt: null,
  promptRole: "category_score",
  promptKey: null,
  pipelineVersion: null,
  responseSchemaVersion: null,
  modelName: null,
});
```

For the copy and review-page start-job cases, add assertions that match the intended fallback/copy behavior:

- Copy should preserve metadata from `sourcePrompt` when present.
- Copy should default missing `promptRole` to `category_score`.
- Review-page start job should use request metadata first, then source prompt metadata, then null/default values.
- If `sourcePromptVersionId` is supplied in the test request, the test should mock `AiApproverPromptVersion.findByPk(...)` with metadata fields so the fallback path is explicit.

### Suggested verification after fix

Run:

```bash
npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts
npm test --workspace newsnexus12api
```

## Issue 2: API targeted rerun is blocked by local Postgres role `nick`

### Area

- Package/workspace: `newsnexus12api`
- File involved: `api/tests/globalSetup.js`
- Command attempted from repository root:

```bash
npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts
```

### Observed failure

The targeted rerun failed before executing the route assertions:

```text
dropdb: error: connection to server at "localhost" (127.0.0.1), port 5432 failed: FATAL:  role "nick" does not exist
Error: Jest: Got error running globalSetup - /home/limited_user/applications/NewsNexus12/api/tests/globalSetup.js, reason: Command failed: dropdb --if-exists newsnexus_test_api
```

### Assessment

This is a test-environment issue distinct from the original AI Approver assertion mismatch. The test global setup shells out to `dropdb --if-exists newsnexus_test_api` without an explicit database user, so the Postgres CLI defaults to the current OS user. In this execution context that user is `nick`, but local Postgres does not have a matching role.

### Recommended resolution

Pick one of these approaches:

1. Configure the test environment to pass an explicit Postgres user/connection string used by the NewsNexus12 test database.
2. Run API tests from the expected service/deployment user that has a matching local Postgres role.
3. Update `api/tests/globalSetup.js` to use explicit test database credentials from environment variables rather than relying on the OS username.

### Suggested verification after fix

Run the same targeted API command and confirm it reaches the test assertions instead of failing in global setup:

```bash
npm test --workspace newsnexus12api -- --runInBand tests/analysis/ai-approver.routes.test.ts
```

## Issue 3: Portal lint cannot load Next.js compiled Babel parser

### Area

- Package/workspace: `newsnexus12portal`
- Command:

```bash
npm run lint --workspace newsnexus12portal
```

### Observed failure

```text
> newsnexus12portal@0.1.0 lint
> eslint

Oops! Something went wrong! :(

ESLint: 9.39.4

Error: Cannot find module 'next/dist/compiled/babel/eslint-parser'
Require stack:
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/parser.js
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/index.js
- /home/limited_user/applications/NewsNexus12/node_modules/eslint-config-next/dist/core-web-vitals.js
```

The same failure persisted after running `npm install`.

### Dependency context

`portal/package.json` currently includes:

```json
"dependencies": {
  "next": "^16.0.10"
},
"devDependencies": {
  "eslint": "^9.39.4",
  "eslint-config-next": "^16.2.4"
}
```

`npm audit` also reports installed/vulnerable Next.js in the broad range:

```text
next: 9.3.4-canary.0 - 16.3.0-canary.5
```

### Assessment

This appears to be a Next.js / `eslint-config-next` package version or packaging mismatch. `eslint-config-next` is requiring `next/dist/compiled/babel/eslint-parser`, but that module is not present in the installed `next` package layout. Because ESLint fails during config loading, it does not currently validate the portal source code at all.

### Recommended resolution

Investigate and align the portal lint dependencies. Likely options:

1. Align `next` and `eslint-config-next` to the same stable patched Next 16 version.
2. If Next 16 changed the parser packaging path, update ESLint configuration to the recommended Next 16 / ESLint 9 flat-config pattern.
3. Clear and reinstall dependencies after changing versions:

```bash
rm -rf node_modules package-lock.json
npm install
npm run lint --workspace newsnexus12portal
```

Only remove `package-lock.json` if the project owner agrees to regenerate lockfile versions. If the intent is minimal change, update only the affected package versions and keep lockfile churn narrow.

### Suggested verification after fix

Run:

```bash
npm run lint --workspace newsnexus12portal
npm run build --workspace newsnexus12portal
```

## Issue 4: npm audit reports 14 vulnerabilities

### Command

```bash
npm audit --json
```

### Summary

```text
info: 0
low: 0
moderate: 9
high: 5
critical: 0
total: 14
```

### Direct vulnerable packages

The audit report includes these direct dependency findings:

- `axios`
  - Severity: high
  - Direct dependency: yes
  - Affected range: `1.0.0 - 1.15.1`
  - Fix available: yes
  - Notable advisory themes: prototype pollution gadgets, request/response tampering, header injection, no-proxy/SSRF bypasses, streamed body/content limit bypasses, DoS via deeply nested form data.
- `exceljs`
  - Severity: moderate
  - Direct dependency: yes
  - Affected range: `>=3.5.0`
  - Fix available: audit suggests `exceljs@3.4.0` and marks it as semver-major, which is unusual because it is a downgrade. This needs manual review rather than blindly applying `npm audit fix --force`.
  - Via: `uuid`.
- `express-rate-limit`
  - Severity: moderate
  - Direct dependency: yes
  - Affected range: `8.0.1 - 8.5.0`
  - Fix available: yes
  - Via: `ip-address`.
- `next`
  - Severity: high
  - Direct dependency: yes
  - Affected range: `9.3.4-canary.0 - 16.3.0-canary.5`
  - Fix available: yes
  - Notable advisory themes: middleware/proxy bypasses, server-side request forgery with WebSocket upgrades, denial of service in Server Components/Image Optimization/Cache Components, cache poisoning, XSS with CSP nonces or beforeInteractive scripts.
- `sequelize`
  - Severity: moderate
  - Direct dependency: yes
  - Affected range: `0.0.0-development || >=3.30.1`
  - Fix available: audit suggests `sequelize@3.30.0` and marks it as semver-major. This is likely not an acceptable fix for a Sequelize 6 project and needs manual dependency analysis.
  - Via: `uuid`.

### Transitive vulnerable packages

The audit report includes these transitive findings:

- `@babel/plugin-transform-modules-systemjs`
  - Severity: high
  - Affected range: `7.12.0 - 7.29.0`
  - Fix available: yes
  - Advisory: arbitrary code generation when compiling malicious input.
- `@protobufjs/utf8`
  - Severity: moderate
  - Affected range: `<=1.1.0`
  - Fix available: yes
  - Advisory: overlong UTF-8 decoding.
- `basic-ftp`
  - Severity: high
  - Affected range: `<=5.3.0`
  - Fix available: yes
  - Advisory: malicious FTP server can cause client-side denial of service via unbounded multiline response buffering.
- `brace-expansion`
  - Severity: moderate
  - Affected range: `5.0.2 - 5.0.5`
  - Fix available: yes
  - Advisory: large numeric range defeats documented `max` DoS protection.
- `ip-address`
  - Severity: moderate
  - Affected range: `<=10.1.0`
  - Fix available: yes
  - Advisory: XSS in Address6 HTML-emitting methods.
- `postcss`
  - Severity: moderate
  - Affected range: `<8.5.10`
  - Fix available: yes
  - Advisory: XSS via unescaped `</style>` in CSS stringify output.
- `protobufjs`
  - Severity: high
  - Affected range: `<=7.5.7`
  - Fix available: yes
  - Advisory themes: code injection, prototype injection, denial of service through crafted field names, recursive descriptors, unsafe option paths, and unbounded recursion.
- `uuid`
  - Severity: moderate
  - Affected range: `<11.1.1`
  - Fix available: audit points through `exceljs@3.4.0`.
  - Advisory: missing buffer bounds check in v3/v5/v6 when `buf` is provided.
- `ws`
  - Severity: moderate
  - Affected range: `8.0.0 - 8.20.0`
  - Fix available: yes
  - Advisory: uninitialized memory disclosure.

### Recommended remediation approach

Do not blindly run `npm audit fix --force` on this repository. At least two suggested fixes from audit are semver-major and/or downgrades (`exceljs@3.4.0`, `sequelize@3.30.0`) that could break application behavior or conflict with the current Sequelize 6 model layer.

Recommended sequence:

1. Fix the direct high-impact dependencies first:
   - Upgrade `axios` to a patched version outside the affected ranges.
   - Upgrade `next` and align `eslint-config-next` at the same patched compatible version.
2. Re-run portal lint after the Next.js alignment because the current lint failure may be solved by the same dependency update.
3. Review `express-rate-limit` for a patch release that updates `ip-address` transitively.
4. Investigate why `exceljs` and `sequelize` pull vulnerable `uuid` versions and whether package overrides can safely force `uuid >=11.1.1` without downgrading direct packages.
5. Review transitive protobuf findings to identify which top-level package introduces `protobufjs` and whether a top-level upgrade is available.
6. Use package-specific upgrades or `overrides` where appropriate, then run the full test/build gate.

### Suggested verification after dependency remediation

Run:

```bash
npm install
npm audit
npm test --workspace @newsnexus/db-manager
npm test --workspace newsnexus12-worker-node
npm test --workspace newsnexus12api
npm run lint --workspace newsnexus12portal
npm run build
```

## Suggested priority order

1. Fix the API test-environment Postgres role/configuration issue if developers need to reproduce API failures from this shell/user.
2. Update stale AI Approver route tests to match the new prompt metadata fields.
3. Align Next.js and `eslint-config-next` to restore portal lint.
4. Remediate high-severity direct dependencies (`axios`, `next`) and re-run audit.
5. Address remaining moderate transitive vulnerabilities via package upgrades or carefully scoped overrides.
6. Once tests, lint, and audit remediation are stable, run the full root build and then restart services according to the deployment procedure.
