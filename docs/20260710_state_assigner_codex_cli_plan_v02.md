---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# State Assigner Codex CLI Backend Plan (v02)

## Changes from v01

Addresses all three concerns from `20260710_state_assigner_codex_cli_plan_v01_assessment_codex.md`:

1. **Cancellation** — the Codex child process is now registered with the queue engine's `registerCancelableProcess` contract, and the Codex client adds a local `SIGKILL` escalation so a signal-resistant child cannot hang an iteration or block the concurrency-1 queue (§Design 3a).
2. **Migration wording** — the misleading "existing deployments are unaffected" claim is replaced with an explicit migration note: the default backend flips to Codex CLI, and `KEY_OPEN_AI` alone no longer selects the OpenAI API. `worker-node/README.md` and `docs/CTO_ONBOARDING.md` are added to the documentation update list (§Migration note, §Documentation updates).
3. **Prompt size** — the prompt is no longer passed as a positional CLI argument. Verified against codex-cli 0.142.5 (the exact version pinned in `docs/CODEX_CLI_SERVER_SETUP.md`): `codex exec -` reads instructions from stdin. The Codex client writes the prompt to the child's stdin, eliminating OS argv limits (Linux caps a single argument at ~128 KiB, which scraped `ArticleContents02.content` can plausibly exceed) (§Design 2).

## Goal

Modify the `worker-node` state-assigner workflow so it can analyze articles through either the Codex CLI or the OpenAI API, with the Codex CLI as the default backend. This mirrors the backend-selection design already shipped in `worker-python`'s AI approver flow (`worker-python/src/modules/ai_approver/client.py` and `config.py`).

## Current state

- `worker-node/src/modules/jobs/stateAssignerJob.ts` contains `analyzeArticleWithOpenAi`, which calls `https://api.openai.com/v1/chat/completions` with a hardcoded model (`gpt-4o-mini`) using `KEY_OPEN_AI`.
- The per-article analysis loop (`processStateAssignmentsWithTimeout`) already receives `analyzeArticle` as an injected dependency — this is the natural seam for a second backend.
- Each article iteration runs under a hardcoded 10-second timeout (`DEFAULT_ITERATION_TIMEOUT_MS = 10_000`); a timed-out article is skipped and the loop continues.
- `worker-node/src/routes/stateAssigner.ts` validates `KEY_OPEN_AI` and `PATH_TO_STATE_ASSIGNER_FILES` at the route boundary and passes them into the job input.
- `worker-node/src/modules/startup/config.ts` lists `KEY_OPEN_AI` in `REQUIRED_ENV_VARS`, so the process fails fast at startup without it. `KEY_OPEN_AI` is consumed only by the state assigner (no other workflow reads it).
- The queue engine (`src/modules/queue/queueEngine.ts`) exposes `registerCancelableProcess` on `QueueExecutionContext`. On `cancelJob`, the engine sends `SIGTERM` to all registered process handles and schedules `SIGKILL` after `cancelGraceMs` if the cancel is still pending. The current state assigner job handler forwards only `jobId` and `signal` from the queue context — `registerCancelableProcess` is not threaded through.
- The Codex CLI is installed system-wide on the server for both `nick` and the `limited_user` service account (`docs/CODEX_CLI_SERVER_SETUP.md`), validated with `codex exec --ephemeral --skip-git-repo-check -s read-only -m gpt-5.4-mini`.

## Reference behavior to mirror (worker-python AI approver)

Backend selection semantics, kept identical for operator predictability:

1. `USE_OPEN_AI_API=true` and an API key is present → OpenAI API backend.
2. `USE_OPEN_AI_API=true` but the key is empty/missing → Codex CLI backend, with a logged warning.
3. `USE_OPEN_AI_API` unset or `false` → Codex CLI backend (default), even if a key is present.

Codex invocation, adapted (prompt via stdin instead of a positional argument — see §Design 2):

```
codex exec --ephemeral --skip-git-repo-check -s read-only \
  --output-last-message <tempfile> -m <model> -
```

- Run with a neutral working directory (`os.tmpdir()`) so codex does not ingest repository context.
- Write the prompt to the child's stdin, then close stdin.
- Read the model's final message from the temp file, then delete the temp file.
- Parse the output as a JSON object; if direct `JSON.parse` fails, fall back to extracting the substring between the first `{` and the last `}` (codex output can include preamble text).
- Non-zero exit, empty output, unreadable output file, or unparseable JSON → error for that article; include a bounded tail (~400 chars) of stdout/stderr in the error message.

## Migration note (operator-facing, must land in docs with the change)

**The default backend flips with this change.** An existing worker-node deployment that sets `KEY_OPEN_AI` but not `USE_OPEN_AI_API=true` will switch from the OpenAI API to the Codex CLI on its next state-assigner run:

- If `codex` is not on the service user's `PATH`, `/state-assigner/start-job` will return a 400 validation error until either codex is installed (`docs/CODEX_CLI_SERVER_SETUP.md`) or `USE_OPEN_AI_API=true` is set.
- If codex is present, jobs run correctly but substantially slower per article (up to the 180 s codex timeout vs. the previous 10 s cap).
- **To stay on the OpenAI API, an operator must set `USE_OPEN_AI_API=true`** alongside the existing `KEY_OPEN_AI`.

Setting `KEY_OPEN_AI` no longer selects or preserves the API backend by itself. This flip is the point of the change (codex-by-default), but the implementer must carry this note into `worker-node/AGENTS.md`, `worker-node/README.md`, and `docs/CTO_ONBOARDING.md` so operators are not surprised.

## Design

### 1. Environment variables (worker-node `.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `USE_OPEN_AI_API` | no | `false` | `true`-like values (`1,true,yes,on`) opt into the OpenAI API backend |
| `KEY_OPEN_AI` | no (was: yes) | — | OpenAI API key; only meaningful when `USE_OPEN_AI_API=true` |
| `STATE_ASSIGNER_MODEL_NAME` | no | per backend, see below | Model passed to the OpenAI API `model` param or the `codex exec -m` flag |
| `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` | no | `180` | Per-article timeout when the Codex CLI backend is active |

- `USE_OPEN_AI_API` reuses the exact variable name from worker-python for cross-package consistency (each package reads its own `.env`, so there is no collision).
- `STATE_ASSIGNER_MODEL_NAME` follows the worker-python pattern (`AI_APPROVER_MODEL_NAME`) with the workflow's own prefix.
- Model default is per backend: `gpt-4o-mini` for the OpenAI API (preserves current behavior exactly) and `gpt-5.4-mini` for the Codex CLI (the model validated in `docs/CODEX_CLI_SERVER_SETUP.md`). This deviates from worker-python's single shared default deliberately: `gpt-4o-mini` is not a sensible `codex exec -m` value, and a codex-by-default rollout should not require setting a model var to work.
- `KEY_OPEN_AI` is removed from `REQUIRED_ENV_VARS` in `startup/config.ts` and becomes optional in `AppConfig` (`keyOpenAi?: string`). Startup succeeds without it; the route boundary enforces whatever the selected backend actually needs (see §Migration note for the behavioral consequence).

### 2. New module: `src/modules/state-assigner/`

Follows the existing pattern of workflow helper modules (like `src/modules/article-content-02/`).

- `config.ts` — `resolveStateAssignerAiConfig(env)` returns a discriminated config:
  - `{ backend: 'openai', modelName, keyOpenAi }` or
  - `{ backend: 'codex-cli', modelName, codexTimeoutMs }`
  - Implements the three selection rules above. When rule 2 applies (opt-in without key), logs a warning through the project logger, mirroring worker-python's `ai_approver_openai_key_missing` soft fallback.
  - Validates `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` as a positive integer.
  - When the codex backend is selected, verifies the `codex` binary is resolvable (scan `PATH` entries for an executable `codex`, the Node equivalent of Python's `shutil.which`; injectable for tests). Failure surfaces as a validation error at the route boundary — worker-node's convention is route-boundary validation for workflow-specific requirements, unlike worker-python's startup check.
- `openAiClient.ts` — `analyzeArticleWithOpenAi(...)` moved out of `stateAssignerJob.ts` essentially unchanged, except the model comes from config instead of being hardcoded.
- `codexCliClient.ts` — `analyzeArticleWithCodexCli(...)`:
  - Builds the prompt with the same `buildPrompt` template substitution.
  - Spawns `codex exec --ephemeral --skip-git-repo-check -s read-only --output-last-message <tempfile> -m <model> -` via `child_process.spawn` with `cwd: os.tmpdir()`.
  - **Prompt delivery via stdin**: the trailing `-` argument tells codex exec to read instructions from stdin (verified against codex-cli 0.142.5, the version pinned in `docs/CODEX_CLI_SERVER_SETUP.md` — its help text states "If not provided as an argument (or if `-` is used), instructions are read from stdin"). The client writes the full prompt to `child.stdin` and closes it. This removes any OS argv-size ceiling (on Linux a single argument is capped at ~128 KiB via `MAX_ARG_STRLEN`, which large scraped article bodies could exceed). No truncation policy is required; prompt size is bounded only by what the model/CLI accepts, same as the API path.
  - The `--output-last-message` temp file is created under `os.tmpdir()` and always cleaned up in `finally`.
  - Cancellation and kill escalation per §3a.
  - The client's returned promise settles only on the child's `close` event (or spawn `error`), so the job promise cannot resolve while a child is still attached to stdio.
  - Parses and validates output exactly like the OpenAI path (`occuredInTheUS` boolean required, `reasoning` non-empty string required), returning the same `ChatGptResponse` shape. Non-zero exit, empty output, or unreadable output file → descriptive error including a bounded (~400 char) stdout/stderr tail.
- `responseParsing.ts` (or co-located) — shared `parseChatGptResponse(raw)` used by both clients: `JSON.parse` with the first-`{`/last-`}` fallback, plus the field validation currently inlined in `analyzeArticleWithOpenAi`.

### 3. Job changes (`stateAssignerJob.ts`)

- `StateAssignerJobInput` replaces `keyOpenAi: string` with `aiConfig: StateAssignerAiConfig` (the resolved discriminated config). The route resolves everything; the job stays env-free.
- `StateAssignerJobContext` gains `registerCancelableProcess: (handle: CancelableProcessHandle) => void`, forwarded from `QueueExecutionContext` by `createStateAssignerJobHandler` (today only `jobId` and `signal` are forwarded).
- The `analyzeArticle` dependency signature changes from `(keyOpenAi, dirs, promptTemplate, article, signal)` to `(aiConfig, dirs, promptTemplate, article, signal, registerCancelableProcess)`. The OpenAI client ignores the registration hook; the Codex client uses it per §3a.
- `runLegacyWorkflow` picks the analyzer by `aiConfig.backend` and picks the iteration timeout by backend:
  - OpenAI API → keep `DEFAULT_ITERATION_TIMEOUT_MS` (10 s, current behavior).
  - Codex CLI → `aiConfig.codexTimeoutMs` (default 180 s). The existing timeout mechanics (skip article, log, continue) are unchanged — only the duration is backend-aware. The 10 s default would make the codex backend time out on virtually every article, so this is a required change, not an optimization.
- Persistence is untouched: `ArticleStateContract02` rows, prompt sync, targeting, and pre-scrape enrichment all stay as-is. Assignments remain attributed to the `NewsNexusLlmStateAssigner01` `ArtificialIntelligence` entity for both backends (the schema does not record model/backend per row today, and this plan does not change that).

### 3a. Codex child-process cancellation and kill escalation

Two independent termination paths must both work, and neither may leave a live codex child or an unresolved job promise:

1. **Queue cancellation (`POST /queue-info/cancel_job/:jobId`)** — on spawn, the Codex client registers the child (its `kill` method satisfies `CancelableProcessHandle`) through the threaded `registerCancelableProcess`. The queue engine then applies its existing contract: `SIGTERM` to registered handles immediately, `SIGKILL` after `cancelGraceMs` if the cancel is still pending. This keeps the state assigner consistent with the queue's documented child-process cancellation behavior.
2. **Per-article iteration timeout** — `runWithIterationTimeout` aborts the iteration signal after the backend-specific timeout. The Codex client listens on that signal: on abort it sends `SIGTERM` to the child and starts a local grace timer (default 5 s, constant in the client); if the child's `close` event has not fired when the timer elapses, it sends `SIGKILL`. Because the client's promise settles on `close`, a signal-resistant child delays the loop by at most timeout + grace, and cannot block the concurrency-1 queue indefinitely.

Notes:

- The local escalation in path 2 also covers queue cancellation ordering edges: the engine only schedules its `SIGKILL` timer if a handle is registered at the moment `cancelJob` runs, but a queue abort always propagates to the iteration signal (existing `runWithIterationTimeout` wiring), so the client's own SIGTERM→grace→SIGKILL sequence fires regardless of registration timing.
- The iteration `AbortSignal` is **not** passed as the `spawn` `signal` option; the client manages kill signals itself so the escalation sequence is explicit and testable.
- Handles are registered per spawn; the queue engine tolerates `kill` on already-exited processes (`kill` returns `false` harmlessly), so no deregistration API is needed.

### 4. Route changes (`routes/stateAssigner.ts`)

- Replace `resolveOpenAiKey(env)` with `resolveStateAssignerAiConfig(env)` from the new config module. Validation failures (bad boolean, bad timeout integer, codex binary missing when the codex backend is selected) throw `AppError.validation(...)` as today.
- The start-request log line gains the resolved `backend` and `modelName` so operators can confirm which backend a job used from the logs.
- Queue contract is untouched: same endpoint name, same `202 { jobId, status, endpointName }` response.

### 5. Startup config changes (`startup/config.ts`)

- Remove `KEY_OPEN_AI` from `REQUIRED_ENV_VARS`; make `keyOpenAi` optional in `AppConfig`.
- No startup codex-binary check — the route boundary handles it (rationale in §2). This keeps startup behavior identical for all existing deployments regardless of their env contents.

## Out of scope

- No change to worker-python.
- No change to article targeting, pre-scrape enrichment, prompt file syncing, or persistence shape.
- No per-row persistence of which backend/model produced an assignment (would require a db-models change; can be a follow-up if operators need it).
- No change to the portal automations UI or the api proxy routes (queue contract unchanged).
- No retry logic beyond the existing skip-and-continue per-article error handling.

## Testing

Following `worker-node` behavior-focused test conventions (`tests/modules/`, `tests/routes/`):

1. `tests/modules/stateAssignerAiConfig.test.ts` — backend selection matrix: default → codex; `USE_OPEN_AI_API=true`+key → openai; `USE_OPEN_AI_API=true` without key → codex (and warns); invalid boolean / invalid timeout → validation error; codex binary missing → validation error (binary check injectable for tests).
2. `tests/modules/stateAssignerCodexClient.test.ts` — child-process interaction mocked or injected (no real codex binary in CI):
   - spawn invocation shape: args are `exec --ephemeral --skip-git-repo-check -s read-only --output-last-message <path> -m <model> -`, `cwd` is tmpdir;
   - the prompt is written to the child's stdin and stdin is closed (including a large multi-hundred-KiB prompt to pin the stdin path);
   - success path reads the output file and parses;
   - non-zero exit / empty output / non-JSON output → descriptive errors with bounded output tail;
   - the spawned child is registered via `registerCancelableProcess`;
   - on iteration-signal abort: `SIGTERM` sent; if the fake child ignores it past the grace period, `SIGKILL` sent; the client promise still settles once `close` fires;
   - temp file cleaned up on success and on every failure path.
3. `tests/modules/stateAssignerJob.test.ts` — extend existing: analyzer selected by backend; iteration timeout is 10 s for openai and `codexTimeoutMs` for codex; `registerCancelableProcess` forwarded from the queue context into the analyzer; existing timeout-skip test updated for the new `analyzeArticle` signature.
4. `tests/routes/stateAssigner.test.ts` — update: job enqueues with resolved `aiConfig`; missing `KEY_OPEN_AI` is no longer a 400 when the codex backend resolves; `USE_OPEN_AI_API=true` without key still enqueues (fallback); codex binary missing → 400 validation error.
5. `tests/modules/startupConfig.test.ts` — update: startup succeeds without `KEY_OPEN_AI`.
6. Response-parsing tests for the brace-extraction fallback (strict JSON, JSON with preamble/suffix text, garbage → error).

Verification commands: `cd worker-node && npm test && npx tsc -p tsconfig.json --noEmit && npm run build`.

## Documentation updates

- `worker-node/AGENTS.md` — state-assigner section (backend selection, new env vars, migration note; `KEY_OPEN_AI` moves from required to optional) and the environment-variables section.
- `worker-node/README.md` — currently lists `KEY_OPEN_AI` as required and describes only the OpenAI path; update both, and include the migration note.
- Root `AGENTS.md` — the one-line env var summary that lists `KEY_OPEN_AI` as an important worker-node setting.
- `docs/CTO_ONBOARDING.md` — still describes the state assigner as OpenAI API-key based; update to describe backend selection.
- `worker-node/docs/worker-node-api-documentation/API_REFERENCE.md` — state-assigner start-job env prerequisites, if that file documents them.
- `.env` example files if present in `worker-node/`.

## Risks and mitigations

1. **Queue occupancy** — the global queue has concurrency 1, and codex runs are much slower per article (up to 180 s vs 10 s). A large `targetArticleStateReviewCount` batch could hold the queue for a long time, delaying other automations. Mitigation: this matches the accepted worker-python codex behavior; the operator controls batch size per request; cancellation works mid-batch and is now hardened per §3a (worst case per in-flight article: timeout + 5 s kill grace). Called out in AGENTS.md docs update.
2. **Codex output is not guaranteed strict JSON** — mitigated by the same brace-extraction fallback worker-python uses, plus the existing per-article skip-on-error behavior. If skip rates are high in practice, the prompt markdown (operator-managed, synced from `PATH_TO_STATE_ASSIGNER_FILES/prompts/`) may need a "reply with raw JSON only" line — an operational note, not a code change.
3. **Default-backend flip for existing deployments** — see §Migration note. Deployments with `KEY_OPEN_AI` but without `USE_OPEN_AI_API=true` change behavior. Mitigated by explicit operator documentation in AGENTS.md/README/CTO_ONBOARDING and the route's clear 400 validation error naming the codex binary when it is missing.
4. **Relaxing `KEY_OPEN_AI` at startup** — a fresh deployment with neither codex nor a key now boots successfully and only fails at job-start time with a 400 validation error. This is intentional (matches worker-python's route/startup split adapted to worker-node conventions).
5. **Cancellation regression risk** — addressed by design in §3a with both queue-level registration and client-local kill escalation, each covered by explicit tests.
6. **`--ephemeral` / stdin-prompt / flag drift across codex versions** — the flags and the `-` stdin behavior are pinned to codex 0.142.5 as installed per `docs/CODEX_CLI_SERVER_SETUP.md` (stdin behavior verified against that exact version's `codex exec --help`); any future codex upgrade affects worker-python and worker-node equally and should re-verify both.

## Open decisions (with recommendations baked into this plan)

1. Per-backend model defaults (`gpt-4o-mini` / `gpt-5.4-mini`) instead of worker-python's single default — recommended and assumed above.
2. Codex binary check at route boundary rather than startup — recommended and assumed above, per worker-node's stated design rule for workflow-specific validation.
3. Local kill-grace duration (5 s) as a client constant rather than another env var — recommended to avoid env sprawl; make it configurable only if operations demand it.
