---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# assessment: state assigner codex cli plan v01

The plan is feasible and the main backend-selection design fits the current worker-node state assigner. It should get a v02 before implementation, because a few details would otherwise leave cancellation weaker than the existing queue contract and make the default-backend migration easy to misunderstand.

## Concerns

1. Codex child-process cancellation is not tied to the queue's cancelable-process contract.

   Evidence:

   - The plan says the Codex client should pass the iteration `AbortSignal` to `child_process.spawn`, and treats that as enough for queue cancellation and iteration timeout termination.
   - The worker-node queue already has a stronger child-process pattern: jobs can register process handles through `registerCancelableProcess`, and queue cancellation sends `SIGTERM`, then `SIGKILL` after the grace period if the process is still registered.
   - The current state assigner job context only forwards `jobId` and `signal` into the workflow. The v01 plan changes the analyzer signature to include `aiConfig`, but still does not add a route for `queueContext.registerCancelableProcess` to reach the Codex spawn.

   Why this risks success:

   - `spawn(..., { signal })` sends a termination signal on abort, but it does not use the queue engine's existing `SIGKILL` fallback.
   - Iteration timeout is separate from queue cancellation. Even if the queue handle is registered, the queue only schedules force-kill when `cancelJob` is called, not when `runWithIterationTimeout` aborts one article.
   - A hung or signal-resistant Codex child could keep the job promise unresolved and block the global concurrency-1 queue, which is exactly the operational risk this plan is trying to bound.

   Requested v02 change:

   - Pass a child-process registration or kill hook from `QueueExecutionContext` through `StateAssignerJobContext` into the Codex client, or add an explicit local kill escalation inside the Codex client.
   - Cover both cancellation paths:
     1. queue cancellation should register the spawned Codex process so the existing queue `SIGTERM` and `SIGKILL` behavior still applies;
     2. per-article iteration timeout should also have a local fallback that sends `SIGKILL` if the child does not exit after a short grace period.
   - Add tests that prove a spawned child is registered for queue cancellation and that iteration timeout cannot leave the Codex child unresolved.

2. The migration wording understates the default-backend behavior change.

   Evidence:

   - The selection rules correctly say `USE_OPEN_AI_API` unset or false means Codex CLI, even when `KEY_OPEN_AI` is present.
   - The environment section then says existing deployments that still set `KEY_OPEN_AI` are unaffected.
   - Current worker-node docs still describe the state assigner as sending content to OpenAI and list `KEY_OPEN_AI` as required.

   Why this risks success:

   - An existing worker-node deployment with `KEY_OPEN_AI` set but no `USE_OPEN_AI_API=true` will switch from the OpenAI API path to the Codex CLI path.
   - If Codex is not on that service user's `PATH`, the start-job route will begin returning validation errors. If Codex is present, the job will run much slower by default.
   - That default flip may be intended, but the v01 wording could lead the implementer to skip the migration note operators need.

   Requested v02 change:

   - Replace the "unaffected" wording with an explicit migration note: setting `KEY_OPEN_AI` no longer preserves the API backend; set `USE_OPEN_AI_API=true` to stay on the OpenAI API.
   - Add `worker-node/README.md` to the documentation update list, because it currently lists `KEY_OPEN_AI` as required and describes only the OpenAI path.
   - Consider updating `docs/CTO_ONBOARDING.md` as well, since it still describes the state assigner as OpenAI API-key based.

3. Passing full article prompts as a positional CLI argument needs a size policy.

   Evidence:

   - The plan mirrors worker-python by passing the full prompt as the final `codex exec` argument.
   - The state assigner prompt is built from article title plus article content.
   - `ArticleContents02.content` is stored as `TEXT`, and the article parser does not impose a maximum content length.

   Why this risks success:

   - Unlike the current API request body, a positional CLI argument is subject to OS argv size limits. A large scraped page or body-text fallback can make `spawn` fail before Codex starts.
   - Under Codex-default behavior, those articles would be skipped or repeatedly fail with process-spawn errors, even though the previous OpenAI API path could at least attempt the request.

   Requested v02 change:

   - Define a Codex prompt-size policy before implementation.
   - Preferred options:
     1. if Codex CLI supports reading the prompt from stdin or a prompt file, use that instead of a giant positional argument;
     2. otherwise, preflight the prompt byte length and either truncate article content at a documented limit or fail the article with a clear bounded error before calling `spawn`.
   - Add tests for the chosen path, including a prompt above the configured limit.

## Recommendation

Revise the plan to v02 before creating the todo. The backend-selection shape, per-backend model defaults, route-boundary Codex binary check, shared response parser, and backend-aware iteration timeout are all sound once the cancellation and migration details above are pinned down.
