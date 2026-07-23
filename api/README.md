# NewsNexus12API - Type Script

## Overview

This project is the migration of the NewsNexus12API project to TypeScript

## AI Approver route versions

- Existing AI Approver routes are V01 and retain their source names and route contracts.
- V02 worker proxy routes use `/automations/ai-approver-v02`.
- V02 prompt, prediction, and review routes use `/analysis/ai-approver-v02`.
- V02 routes require the existing JWT authentication middleware.
- V02 review updates affect only V02 prediction review fields.
- V02 does not write article approval, relevance, report, or orchestration data.

## Tests

Testing currently uses Jest, with Supertest for endpoint smoke checks.

1. test suites currently in this repo

- `tests/smoke/app.bootstrap.test.ts`
  - verifies app boot and basic health routes
  - checks `GET /health` returns `200`
  - checks `GET /` returns `200`
- `tests/middleware/globalSecurity.test.ts`
  - verifies input sanitization behavior for params, query, and body
  - checks protection logic for script/traversal style input
- `tests/middleware/fileSecurity.test.ts`
  - verifies safe file and directory path validation helpers
  - checks valid and invalid extension/path cases
- `tests/middleware/rateLimiting.test.ts`
  - verifies rate limiting behavior for login attempts
  - checks that repeated failed calls are blocked with `429`

2. run all tests

- command: `npm test`

3. run endpoint smoke tests only

- command: `npm run test:endpoints`

4. run smoke + middleware tests together

- command: `npm test -- --testPathPatterns="tests/smoke|tests/middleware"`

5. test file organization

- all tests are stored under root `/tests`
- helper utilities are under `/tests/helpers`
- migration adds new domain tests incrementally (users, articles, reports, analysis, admin)

## Migration Complete

The TypeScript migration is complete for the API source under `/src`.

1. current status

- all `src` runtime code is now TypeScript (`.ts`)
- strict TypeScript mode is enabled in `tsconfig.json`
- temporary migration compiler shims were removed (`allowJs`, `checkJs`)
- migration documentation is in `docs/migration-to-ts/`
- migration checklist is complete in `docs/migration-to-ts/MIGRATION_TODO.md`
- migration analysis is in `docs/migration-to-ts/REFACTOR_TO_TS_ANALYSIS.md`

2. validation gates used

- build: `npm run build`
- full tests: `npm test`
- endpoint smoke tests: `npm run test:endpoints`

3. current test baseline

- `15` passing test suites
- `64` passing tests
