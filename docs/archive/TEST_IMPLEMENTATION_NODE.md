# Node API Test Implementation Guide (Jest)

This guide captures the testing approach used in the `api/` project and translates it into a reusable pattern for other Node.js API projects using Jest. The goal is stable, behavior-focused tests that run quickly and remain easy to maintain as the API grows.

## 1. Testing goals

1. Validate API behavior and contract, not internal implementation details.
2. Keep tests deterministic by controlling dependencies at module boundaries.
3. Make failures local and actionable by testing one responsibility per suite.
4. Keep the suite friendly for local development and CI.

## 2. Recommended suite layout

- Keep all tests under a top-level `tests/` directory.
- Group files by behavior area instead of by technical layer only.
- Use `*.test.ts` naming so Jest discovers files consistently.

Suggested structure:

- `tests/smoke/`
  - minimal app boot and baseline route checks
- `tests/helpers/`
  - shared test bootstrap utilities
- `tests/<domain>/`
  - route contract tests by domain
- `tests/middleware/`
  - middleware control-flow and security behavior
- `tests/modules/` (and optional domain utility folders)
  - pure and near-pure module tests

## 3. Jest and TypeScript baseline

- Use `jest` with `ts-jest` for TypeScript test files.
- Set `testEnvironment` to `node` for API work.
- Point Jest `roots` to `tests` to avoid scanning non-test folders.
- Enable `clearMocks` to reduce mock leakage between tests.
- Set a reasonable `testTimeout` for async route and IO behavior.
- Keep a dedicated `tests/tsconfig.json` that includes:
  - Jest globals (`types: ["node", "jest"]`)
  - source files needed for type resolution
  - `noEmit: true` for type-check-only validation

## 4. Test types and when to use them

1. Smoke tests
- Purpose: prove the app boots and baseline responses work.
- Scope: app-level health and top-level response checks only.
- Pattern: import a test app helper that sets critical env flags before importing app code.

2. Route contract tests
- Purpose: verify request/response contracts and critical side effects.
- Scope: status code, payload shape, and key dependency calls.
- Pattern: create a minimal Express app per suite and mount only the router under test.

3. Middleware tests
- Purpose: verify pass, block, and sanitize behavior.
- Scope: control-flow (`next`), rejection behavior, and edge-case inputs.
- Pattern: test helper functions directly when possible, and use a tiny app when middleware behavior depends on the HTTP pipeline.

4. Utility/module tests
- Purpose: validate transformations, validation logic, and normalization.
- Scope: pure input/output behavior and error handling.
- Pattern: use direct imports and small, explicit fixtures.

## 5. Route test implementation pattern

1. Mock non-target dependencies first.
- Replace logging, auth middleware, rate limiting, mailers, and database modules with local Jest doubles unless they are the subject of the test.
- Keep passthrough middleware stubs for concerns not under test to avoid unrelated failures.

2. Import or require the router after mocks are declared.
- This ensures the route module resolves mocked dependencies instead of real ones.

3. Build a local app factory.
- Create `buildApp()` that mounts JSON middleware and only the route prefix being tested.
- Avoid loading the full production app for domain route contract tests.

4. Reset state before each test.
- Use `beforeEach(() => jest.clearAllMocks())`.
- Reapply environment variables needed by the route path being tested.

5. Assert behavior in a consistent order.
- Status code first.
- Response contract shape second.
- Key side effects third (for example, expected model method calls).

## 6. Mocking boundaries and dependency control

- Mock data layer modules as explicit objects of `jest.fn()` methods.
- Set per-test return values with `mockResolvedValue`, `mockRejectedValue`, and `mockReturnValue`.
- Mock external HTTP integrations by stubbing `fetch` or module HTTP clients.
- Restore global spies (for example `global.fetch`) after each test that creates them.
- For filesystem logic, use temporary directories/files and clean up in `afterEach`.

Recommended principle:

- Mock at the boundary where your module exits your control (DB, network, file system, third-party services), but keep internal business logic real whenever possible.

## 7. Assertions that age well

- Prefer partial object assertions for API contracts:
  - `expect.objectContaining(...)`
  - `toMatchObject(...)`
- Use exact equality for strict values only.
- For HTML/text endpoints, assert:
  - status code
  - content type
  - a few stable response markers
- For validation errors, assert:
  - status code
  - stable error code or message contract

## 8. Environment handling strategy

- Set required env vars inside `beforeEach` for suites that depend on them.
- For smoke tests, set env overrides before importing the app module.
- Keep env assumptions explicit in each suite to avoid hidden coupling.
- Do not rely on local machine defaults for required config in tests.

## 9. Common pitfalls to avoid

1. Importing routers before mocks are declared.
2. Sharing mutable mock state across files.
3. Testing too many behavior paths in one test case.
4. Asserting full payload snapshots when only key contract fields matter.
5. Running full app boot for every route test instead of minimal local apps.

## 10. Commands for day-to-day workflow

1. Run full suite:
- `npm test`

2. Run smoke-only checks:
- `npm run test:endpoints`

3. Run a single test file:
- `npx jest tests/<domain>/<file>.test.ts`

4. Validate test TypeScript config:
- `npx tsc -p tests/tsconfig.json --noEmit`

## 11. Definition of done for a new test suite

1. Test file is in the correct `tests/` folder and named `*.test.ts`.
2. Happy-path and at least one failure-path are covered.
3. External boundaries are mocked or intentionally exercised.
4. Assertions verify status, contract, and meaningful side effects.
5. Mocks and env are reset so test order does not matter.
6. Suite passes locally with `npm test`.

This approach keeps test behavior predictable while still giving high confidence in route contracts and core API logic. It scales well for monolith APIs and modular Node services as long as dependency boundaries remain explicit and test setup stays minimal.
