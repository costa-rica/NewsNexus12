---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# assessment: state assigner codex cli todo v02

The v02 todo resolves the three v01 assessment concerns. It still needs a v03 because two task details can leave stale public documentation or make the required job-wiring tests hard to implement cleanly.

## Concerns

1. Phase 6 points to the API reference index, but the stale state-assigner details are in the endpoint file.

   Evidence:

   - Phase 6 says to update `worker-node/docs/worker-node-api-documentation/API_REFERENCE.md` only if that file documents state-assigner start-job env prerequisites.
   - `API_REFERENCE.md` is just the top-level index.
   - The actual stale content is in `worker-node/docs/worker-node-api-documentation/endpoints/state-assigner.md`: it says `KEY_OPEN_AI` is required, shows a missing-OpenAI-key 400 response, and still describes raw responses being written to `chatgpt_responses/`.

   Why this risks success:

   - An implementer can follow the todo literally, inspect only `API_REFERENCE.md`, decide it does not document prerequisites, and skip the endpoint file.
   - That would leave the API docs contradicting the new behavior: Codex CLI default, `KEY_OPEN_AI` optional unless `USE_OPEN_AI_API=true`, and Codex-binary validation at the route boundary.

   Requested v03 change:

   - Replace the Phase 6 `API_REFERENCE.md` task with an explicit task to update `worker-node/docs/worker-node-api-documentation/endpoints/state-assigner.md`.
   - Require updates to the runtime dependencies, validation bullets, OpenAI-key error example, Codex-binary validation error, backend-selection/migration note, and stale raw-response wording.
   - Keep `API_REFERENCE.md` only as a check that the endpoint link remains valid.

2. Phase 4 requires job-level analyzer and timeout tests but does not specify the injection seam.

   Evidence:

   - Phase 4 asks tests to assert that the OpenAI or Codex analyzer is chosen by backend and that the backend-specific iteration timeout is passed through.
   - The current `StateAssignerJobDependencies` can inject `runLegacyWorkflow`, `selectArticles`, `enrichContent02`, and `getCanonicalContent02Row`, but not analyzer functions or the processing function.
   - Injecting `runLegacyWorkflow` bypasses the default `runLegacyWorkflow` logic, so it cannot prove analyzer selection or timeout selection inside that logic.

   Why this risks success:

   - The implementing agent may need to invent a test seam during Phase 4, use brittle module mocking, or write tests that do not actually cover the behavior the todo asks for.
   - This is the same area that protects the key behavior change: backend-specific analyzer selection and the 10 s versus Codex timeout split.

   Requested v03 change:

   - Add an explicit Phase 4 task to extend `StateAssignerJobDependencies` with narrow test seams, for example:
     1. `analyzeWithOpenAi?: typeof analyzeArticleWithOpenAi`
     2. `analyzeWithCodexCli?: typeof analyzeArticleWithCodexCli`
     3. optionally `processAssignments?: typeof processStateAssignmentsWithTimeout`
   - State that production defaults use the real clients and real processing function, while tests inject fakes to assert backend selection, timeout selection, and `registerCancelableProcess` forwarding without hitting the database or filesystem-heavy workflow setup.

## Recommendation

Revise the todo to v03 before implementation. The plan remains approved; this is only a todo-detail correction.
