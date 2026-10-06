---
created_at: 2026-10-06T19:30:00Z
updated_at: 2026-10-06T19:30:00Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops AI Approver V02 Todo V01 Assessment

## Summary

The todo follows plans V02 and V03 closely. Every V03 identity correction has a task and a test:

- clearing the job mirror;
- binding and adoption;
- exact-identity completion;
- single-clock chronology;
- missing queue evidence.

The V02 rules are also covered:

- unlimited continuation;
- acceptance-aware 404 handling;
- start conflicts;
- monitoring-limit disqualification.

The paths and commands match the repository:

- `worker-python/tests/unit/ai_approver_v02` and `tests/integration/test_ai_approver_v02_routes.py` exist.
- `worker-python/AGENTS.md` exists.
- `persistenceTestSupport.ts` and `persistence.test.ts` exist.
- The ops test command is the explicit list in `ops/package.json`.
- The phase-numbered file naming matches Phases 4–6.

One concern qualifies. It is in Phase 5, the coordinator integration.

## Concern 1: Phase 5 will break existing coordinator tests and does not say how to keep them worker-free

Criteria: a task will break existing code, and an implementing agent would have to guess at an important constraint.

### 1a. The existing tests that assert the Phase 7 boundary are not identified

The coordinator tests are not in a coordinator test file. They are in `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`. At least five tests there assert the boundary log message `'Phase 7 boundary'`, at lines 434/506, 679, 757, 1163, and 1287. Others assert that it is absent, at lines 1096 and 1202. The test at line 434 is named "runs Phases 1 through 6 in order and stops at the Phase 7 boundary".

Phase 5 says "Replace the existing Phase 7 boundary stop with Phase 7 execution", so all of these tests change behavior. The todo only says "Extend coordinator tests for the complete Phase 1 through Phase 7 order". It does not name the file, and it does not say that the existing boundary assertions must be rewritten. An agent searching for a coordinator test file will not find one. Updating those tests then becomes unplanned failure-fixing in the Phase 5 verification step.

### 1b. The Phase 7 worker must be built on the coordinator's injected `request`

Each existing phase worker is created from the coordinator's shared `request` dependency, for example `createStateAssignerWorker(config, request)`. Production defaults that dependency to `globalThis.fetch`, and the tests replace it with a fake `WorkerRequest`. That is why existing coordinator tests that reach Phase 6 make no real HTTP calls.

The todo says "Create the production Phase 7 client from the configured worker-python base URL and Phase 7 request timeout." It does not say to build the client on the injected `request`. If an implementer gives the Phase 7 client its own `fetch` or default transport, then every existing coordinator test that completes Phase 6 will send a real request to the test config's worker-python URL. That breaks the "database-free and worker-free" guardrail. The single task "Test injected dependencies prevent real worker or database access" would not catch this if the new tests inject the Phase 7 worker explicitly while the old tests do not.

### Recommendation

Add these Phase 5 tasks:

- Add `runAiApprover` and `aiApproverWorker` (or names matching the existing `runState`/`stateWorker` pattern) to `CoordinatorDependencies`. Default the worker to a `createAiApproverV02Worker(config, request)` factory that uses the coordinator's injected `request`, as Phases 4–6 do. Do not use `fetch` directly in the client.
- Name `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts` as the location of the coordinator tests.
- Rewrite every existing assertion of the `'Phase 7 boundary'` log message. Tests that reach Phase 7 must inject a controlled Phase 7 runner or worker that reaches a stated outcome. Rename the "runs Phases 1 through 6 … stops at the Phase 7 boundary" test to match.
- Add a test showing that a coordinator test that injects only `request` still sends no real worker-python request at Phase 7.

## Non-blocking notes

1. **Clock injection.** Phase 4's "Inject the client, persistence, clock, delay, and event callback" should follow the existing `RunStateAssignmentDependencies` shape (`persistence`, `worker`, `now`, `delay`, `onEvent`). The coordinator can then call the Phase 7 runner exactly as it calls Phase 6.
2. **Error category names.** Phase 2 lists client error categories in prose ("Transient request", "Start conflict"). Specify the literal snake_case values, such as `transient_request` and `start_conflict`. The existing `phaseFailureCategory` returns those values, and V02's logs and stored failures depend on them being stable.
3. **Fake-timer polling tests.** A 12-hour limit with a 5-minute interval means 144 polls per runner test. The runner tests should use the injected `now` and `delay`, as the Phase 6 tests do, and should never use real timers.
