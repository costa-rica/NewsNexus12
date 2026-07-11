---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# assessment: state assigner codex cli todo v03

The v03 todo resolves the v02 assessment concerns around endpoint documentation and analyzer test seams. One Phase 4 detail still needs a v04 before implementation because the required job-wiring tests remain ambiguous.

## Concerns

1. Phase 4 still leaves the backend timeout/assertion seam partly optional and underspecifies the setup for real `runLegacyWorkflow` tests.

   Evidence:

   - Phase 4 says `processAssignments?: typeof processStateAssignmentsWithTimeout` is optional.
   - The required tests then say to assert that injected `processAssignments` receives `iterationTimeoutMs` of `10_000` for OpenAI and `codexTimeoutMs` for Codex.
   - The analyzer-selection test says to run the real `runLegacyWorkflow` with fake analyzers, fake article selection/enrichment/content lookup, and "whatever DB/prompt setup stubbing the existing tests use."
   - The existing `stateAssignerJob.test.ts` does not currently stub or seed the database/prompt setup for `runLegacyWorkflow`; it only tests the handler passthrough and `processStateAssignmentsWithTimeout`.

   Why this risks success:

   - If `processAssignments` remains optional and the implementer omits it, the timeout-selection test described in the todo cannot be written as specified.
   - If the implementer follows the real `runLegacyWorkflow` instruction literally, the test still has to pass through `ensureDbReady`, prompt directory sync, `ArtificialIntelligence` / `EntityWhoCategorizedArticle` lookup, and `Prompt` lookup before it reaches analyzer selection.
   - The todo currently leaves the implementer to discover whether to add more narrow dependencies, seed the test database and temp prompt directory, or use module mocking despite saying not to use module mocking for these tests.

   Requested v04 change:

   - Make `processAssignments` a required Phase 4 dependency seam, not optional, if the timeout-selection test is expected to assert its arguments.
   - Explicitly choose one setup strategy for the real `runLegacyWorkflow` tests:
     1. seed the test database with the required `ArtificialIntelligence`, `EntityWhoCategorizedArticle`, and `Prompt` rows and use a temp `PATH_TO_STATE_ASSIGNER_FILES` prompt directory; or
     2. add explicit narrow dependency seams for `ensureDbReady`, directory/prompt sync, entity resolution, and prompt loading so the tests stay pure.
   - Update the Phase 4 test bullets to name that chosen strategy, so the implementer does not have to infer it mid-implementation.

## Recommendation

Revise the todo to v04 before implementation. The approved plan is still fine; this is a final testability clarification.
