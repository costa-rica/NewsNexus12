---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# assessment: state assigner codex cli todo v01

The todo aligns with the approved v02 plan at a high level, including backend selection, stdin prompt delivery, queue cancellation registration, local kill escalation, and operator documentation. It should get a v02 before implementation because a few task details leave too much room for failing the phase-by-phase checks or for host-dependent tests.

## Concerns

1. Phase 2 says to move the OpenAI client before the job is rewired in Phase 4.

   Evidence:

   - The todo requires typecheck, tests, and build at the end of every phase.
   - Phase 2 says to create `openAiClient.ts` with `analyzeArticleWithOpenAi(...)` moved from `src/modules/jobs/stateAssignerJob.ts`.
   - Phase 4 later says to remove the now-relocated OpenAI fetch logic from `stateAssignerJob.ts` and wire the job to choose the OpenAI or Codex analyzer.
   - Today `stateAssignerJob.ts` still directly calls the local `analyzeArticleWithOpenAi` from `runLegacyWorkflow`.

   Why this risks success:

   - If an implementer follows "moved" literally in Phase 2 and deletes the local function, the project will not compile until Phase 4 wiring is also done.
   - If they leave a copy behind to keep Phase 2 green, they are no longer literally moving it, and may be unsure what the phase expects.
   - This conflicts with the todo's own instruction to complete checks and commit after each phase.

   Requested v02 change:

   - Make the phase boundary explicit. Either:
     1. Phase 2 creates `responseParsing.ts`, shared types, and a copied/extracted `openAiClient.ts` while leaving `stateAssignerJob.ts` behavior untouched until Phase 4; or
     2. Move the OpenAI client extraction and job import/wiring into the same phase.
   - Add a small shared prompt-building helper or explicitly say both clients should use the same exported helper, so moving OpenAI out of `stateAssignerJob.ts` does not invite duplicated template replacement logic.

2. Route tests require an injectable Codex binary check, but the route tasks do not add an injection seam.

   Evidence:

   - Phase 1 correctly makes the config module's Codex binary check injectable through `resolveStateAssignerAiConfig(..., deps?)`.
   - Phase 5 says `stateAssigner.ts` should call `resolveStateAssignerAiConfig(env)` directly.
   - Phase 5 tests then say to inject the binary check so the Codex path resolves in CI.
   - The current route dependency object only accepts `queueEngine`, `env`, and `buildJobHandler`.

   Why this risks success:

   - Without an explicit route dependency for either the resolver or the resolver deps, the route tests cannot inject the binary check through the route's normal test seam.
   - The implementing agent may fall back to module mocking, rely on a real local `codex` binary, or weaken the config test isolation, any of which makes the tests more brittle than the plan intended.

   Requested v02 change:

   - In Phase 5, explicitly extend `StateAssignerRouteDependencies` with one of these:
     1. `resolveAiConfig?: typeof resolveStateAssignerAiConfig`; or
     2. `aiConfigDeps?: StateAssignerAiConfigDependencies`.
   - State that production defaults use the real resolver and real binary check, while route tests inject a resolver or deps that make the Codex path deterministic without requiring `codex` on `PATH`.

3. The Codex stdin write path needs explicit stream-error handling and a test.

   Evidence:

   - Phase 3 correctly requires writing the full prompt to `child.stdin` and ending the stream.
   - Phase 3 also tests non-zero exit, empty output, non-JSON output, and large prompt delivery.
   - The todo does not say to handle `child.stdin` `error` events or write/end callback errors.

   Why this risks success:

   - If Codex exits early, rejects its flags, or otherwise closes stdin before the prompt is fully written, Node can emit `EPIPE` or another stream error on `child.stdin`.
   - An unhandled stream `error` can crash the worker process instead of producing the bounded per-article failure the plan requires.
   - Large-prompt stdin delivery is specifically part of the design, so this edge belongs in the client contract, not as an implementation guess.

   Requested v02 change:

   - Add Phase 3 tasks to attach an error handler to `child.stdin`, handle write/end callback errors, and settle the client promise deterministically without an unhandled error.
   - Add a Codex client test where the fake child emits a stdin error or closes before stdin finishes, asserting that the client rejects with a descriptive bounded error and still cleans up the temp file.

## Recommendation

Revise the todo to v02 before implementation. The approved plan does not need another plan revision; the todo just needs sharper phase sequencing and test seams.
