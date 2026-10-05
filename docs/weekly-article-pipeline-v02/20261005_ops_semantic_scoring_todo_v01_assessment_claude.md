---
created_at: 2026-10-05T21:41:58Z
updated_at: 2026-10-05T21:41:58Z
created_by: claude (opus-5.5) nicksmacbookair
modified_by: claude (opus-5.5) nicksmacbookair
---

# Ops Semantic Scoring Todo V01 Assessment

## Summary

The todo matches plan V03 closely. Its two "Final Review Decisions" settle both of my V03 notes:

- A dedicated `recordPhaseFiveCompleted` checks the marker inside persistence, and the generic completion path rejects Phase 5.
- A status 404 uses the normal replacement rule, because there is no record to compare with the marker.

The phases are in a sensible order: client, persistence, phase module, coordinator, docs. Each ends with the standard checkpoint. Other details also check out against the code:

- The config-helper task is accurate. `optionalPositiveInteger` currently hard-codes a default of 5.
- The explicit test list in `ops/package.json` is called out for both new test files.

One concern qualifies. It is in todo Phase 4.

## Concern 1: Coordinator test tasks miss where the tests live and which existing tests break

Criteria: the task leaves too much ambiguity, and it will break existing tests without saying how to handle them.

### Where the coordinator tests are

Todo Phase 4 says "Extend coordinator tests for: …" but does not name a file. There is no `coordinator.test.ts`. The `runCoordinator` tests live in a `describe('runCoordinator')` block inside `ops/tests/weekly-flow-02/01_clearDuplicateAnalyses.test.ts`.

An implementing agent that does not find a coordinator test file may create `coordinator.test.ts`. `ops/package.json` lists test files explicitly. Unlike Phases 1 and 3, todo Phase 4 has no task to add a file to that list. A new file would compile and then never run, and the checkpoint would still pass.

### Existing tests that will fail

Connecting Phase 5 changes what several existing coordinator tests expect:

- `runs Phases 1 through 4 in order and stops at the Phase 5 boundary` asserts a "Phase 5 boundary" log. Its injected `request` returns the dedupe success body for every URL. Once Phase 5 runs, the default semantic client would send its start request through that fake. It would get an invalid start response, and the test would throw.
- `continues a recent run at the Phase 4 boundary…` and `continues within 72 hours and replaces an older timed-out Phase 4 job` also complete Phase 4 with a positive count. They will now go on into Phase 5.
- `coordinatorConfig` in that file, and the config in `entrypoint.test.ts`, need the three new `OpsConfig` fields if the type declares them as required.

The checkpoint's "fix failures" step would surface these failures, but the todo gives no direction for fixing them. An agent could inject a fake that skips Phase 5, or loosen the assertions. Both would hide the change in coordinator behavior that these tests should now prove.

Recommendation: in todo Phase 4, add tasks to:

- Add the new coordinator tests to the existing `describe('runCoordinator')` block in `01_clearDuplicateAnalyses.test.ts`. If a new file is preferred, add it to the explicit `ops/package.json` test list.
- Update the existing coordinator tests that complete Phase 4 with a positive count. Inject a fake semantic-scorer client that completes. Replace the "Phase 5 boundary" assertion with Phase 5 completion and the "Phase 6 boundary" log.
- Add a case where a fake semantic client fails. It should confirm Phase 4 still completes and the failure is recorded with `phase: 5`.
- Add the new Phase 5 config fields to every test `OpsConfig` fixture, or construct them through the defaults.
- Make sure no coordinator test reaches the default semantic client, so default tests never use real `fetch`.

## Non-blocking notes

- The guardrail "Preserve the operator's unrelated working-tree changes, including the current archive moves" is accurate. The working tree currently shows the Phase 4 RSS plan and todo files deleted from this folder. The implementing agent should not restore them or include them in a commit.
- Phase 6 of the todo asks to confirm that "default tests do not open network connections." The recommended Phase 4 tasks above are what make that check pass. Without them, the check would be the first place the problem shows up.
