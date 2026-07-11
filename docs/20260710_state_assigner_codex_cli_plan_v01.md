---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# State Assigner Codex CLI Backend Plan (v01)

## Goal

Modify the `worker-node` state-assigner workflow so it can analyze articles through either the Codex CLI or the OpenAI API, with the Codex CLI as the default backend. This mirrors the backend-selection design already shipped in `worker-python`'s AI approver flow (`worker-python/src/modules/ai_approver/client.py` and `config.py`).

## Current state

- `worker-node/src/modules/jobs/stateAssignerJob.ts` contains `analyzeArticleWithOpenAi`, which calls `https://api.openai.com/v1/chat/completions` with a hardcoded model (`gpt-4o-mini`) using `KEY_OPEN_AI`.
- The per-article analysis loop (`processStateAssignmentsWithTimeout`) already receives `analyzeArticle` as an injected dependency — this is the natural seam for a second backend.
- Each article iteration runs under a hardcoded 10-second timeout (`DEFAULT_ITERATION_TIMEOUT_MS = 10_000`); a timed-out article is skipped and the loop continues.
- `worker-node/src/routes/stateAssigner.ts` validates `KEY_OPEN_AI` and `PATH_TO_STATE_ASSIGNER_FILES` at the route boundary and passes them into the job input.
- `worker-node/src/modules/startup/config.ts` lists `KEY_OPEN_AI` in `REQUIRED_ENV_VARS`, so the process fails fast at startup without it. `KEY_OPEN_AI` is consumed only by the state assigner (no other workflow reads it).
- The Codex CLI is installed system-wide on the server for both `nick` and the `limited_user` service account (`docs/CODEX_CLI_SERVER_SETUP.md`), validated with `codex exec --ephemeral --skip-git-repo-check -s read-only -m gpt-5.4-mini`.

## Reference behavior to mirror (worker-python AI approver)

Backend selection semantics, kept identical for operator predictability:

1. `USE_OPEN_AI_API=true` and an API key is present → OpenAI API backend.
2. `USE_OPEN_AI_API=true` but the key is empty/missing → Codex CLI backend, with a logged warning.
3. `USE_OPEN_AI_API` unset or `false` → Codex CLI backend (default), even if a key is present.

Codex invocation, kept identical:

```
codex exec --ephemeral --skip-git-repo-check -s read-only \
  --output-last-message <tempfile> -m <model> <prompt>
```

- Run with a neutral working directory (`os.tmpdir()`) so codex does not ingest repository context.
- Read the model's final message from the temp file, then delete the temp file.
- Parse the output as a JSON object; if direct `JSON.parse` fails, fall back to extracting the substring between the first `{` and the last `}` (codex output can include preamble text).
- Non-zero exit, empty output, unreadable output file, or unparseable JSON → error for that article; include a bounded tail (~400 chars) of stdout/stderr in the error message.

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
- `KEY_OPEN_AI` is removed from `REQUIRED_ENV_VARS` in `startup/config.ts` and becomes optional in `AppConfig` (`keyOpenAi?: string`). Existing deployments that still set it are unaffected.

### 2. New module: `src/modules/state-assigner/`

Follows the existing pattern of workflow helper modules (like `src/modules/article-content-02/`).

- `config.ts` — `resolveStateAssignerAiConfig(env)` returns a discriminated config:
  - `{ backend: 'openai', modelName, keyOpenAi }` or
  - `{ backend: 'codex-cli', modelName, codexTimeoutMs }`
  - Implements the three selection rules above. When rule 2 applies (opt-in without key), logs a warning through the project logger, mirroring worker-python's `ai_approver_openai_key_missing` soft fallback.
  - Validates `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` as a positive integer.
  - When the codex backend is selected, verifies the `codex` binary is resolvable (scan `PATH` entries for an executable `codex`, the Node equivalent of Python's `shutil.which`). Failure surfaces as a validation error at the route boundary — worker-node's convention is route-boundary validation for workflow-specific requirements, unlike worker-python's startup check.
- `openAiClient.ts` — `analyzeArticleWithOpenAi(...)` moved out of `stateAssignerJob.ts` essentially unchanged, except the model comes from config instead of being hardcoded.
- `codexCliClient.ts` — `analyzeArticleWithCodexCli(...)`:
  - Builds the prompt with the same `buildPrompt` template substitution.
  - Writes nothing to disk except the `--output-last-message` temp file (created via `fs.mkdtemp`/`os.tmpdir()`, always cleaned up in `finally`).
  - Spawns `codex` via `child_process.spawn` with `cwd: os.tmpdir()` and the iteration `AbortSignal` passed as the spawn `signal` option, so queue cancellation and iteration timeout both terminate the child process (SIGTERM). Captures bounded stdout/stderr for error messages.
  - Parses and validates the JSON exactly like the OpenAI path (`occuredInTheUS` boolean required, `reasoning` non-empty string required), returning the same `ChatGptResponse` shape.
- `responseParsing.ts` (or co-located) — shared `parseChatGptResponse(raw)` used by both clients: `JSON.parse` with the first-`{`/last-`}` fallback, plus the field validation currently inlined in `analyzeArticleWithOpenAi`.

### 3. Job changes (`stateAssignerJob.ts`)

- `StateAssignerJobInput` replaces `keyOpenAi: string` with `aiConfig: StateAssignerAiConfig` (the resolved discriminated config). The route resolves everything; the job stays env-free.
- The `analyzeArticle` dependency signature changes from `(keyOpenAi, dirs, promptTemplate, article, signal)` to `(aiConfig, dirs, promptTemplate, article, signal)`.
- `runLegacyWorkflow` picks the analyzer by `aiConfig.backend` and, critically, picks the iteration timeout by backend:
  - OpenAI API → keep `DEFAULT_ITERATION_TIMEOUT_MS` (10 s, current behavior).
  - Codex CLI → `aiConfig.codexTimeoutMs` (default 180 s). The existing timeout mechanics (skip article, log, continue) are unchanged — only the duration is backend-aware. The 10 s default would make the codex backend time out on virtually every article, so this is a required change, not an optimization.
- Persistence is untouched: `ArticleStateContract02` rows, prompt sync, targeting, and pre-scrape enrichment all stay as-is. Assignments remain attributed to the `NewsNexusLlmStateAssigner01` `ArtificialIntelligence` entity for both backends (the schema does not record model/backend per row today, and this plan does not change that).

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
2. `tests/modules/stateAssignerCodexClient.test.ts` — spawn invocation shape (args include `exec --ephemeral --skip-git-repo-check -s read-only --output-last-message ... -m <model>`, `cwd` is tmpdir); success path reads output file and parses; non-zero exit / empty output / non-JSON output → descriptive errors; abort signal terminates the child; temp file cleaned up. Child-process interaction mocked or injected — no real codex binary in CI.
3. `tests/modules/stateAssignerJob.test.ts` — extend existing: analyzer selected by backend; iteration timeout is 10 s for openai and `codexTimeoutMs` for codex; existing timeout-skip test updated for the new `analyzeArticle` signature.
4. `tests/routes/stateAssigner.test.ts` — update: job enqueues with resolved `aiConfig`; missing `KEY_OPEN_AI` is no longer a 400 when the codex backend resolves; `USE_OPEN_AI_API=true` without key still enqueues (fallback); codex binary missing → 400 validation error.
5. `tests/modules/startupConfig.test.ts` — update: startup succeeds without `KEY_OPEN_AI`.
6. Response-parsing tests for the brace-extraction fallback (strict JSON, JSON with preamble/suffix text, garbage → error).

Verification commands: `cd worker-node && npm test && npx tsc -p tsconfig.json --noEmit && npm run build`.

## Documentation updates

- `worker-node/AGENTS.md` — state-assigner section (backend selection, new env vars; `KEY_OPEN_AI` moves from required to optional) and the environment-variables section.
- Root `AGENTS.md` — the one-line env var summary that lists `KEY_OPEN_AI` as an important worker-node setting.
- `worker-node/docs/worker-node-api-documentation/API_REFERENCE.md` — state-assigner start-job env prerequisites, if that file documents them.
- `.env` example files if present in `worker-node/`.

## Risks and mitigations

1. **Queue occupancy** — the global queue has concurrency 1, and codex runs are much slower per article (up to 180 s vs 10 s). A large `targetArticleStateReviewCount` batch could hold the queue for a long time, delaying other automations. Mitigation: this matches the accepted worker-python codex behavior; the operator controls batch size per request; cancellation works mid-batch (cooperative abort kills the in-flight codex child). Called out in AGENTS.md docs update.
2. **Codex output is not guaranteed strict JSON** — mitigated by the same brace-extraction fallback worker-python uses, plus the existing per-article skip-on-error behavior. If skip rates are high in practice, the prompt markdown (operator-managed, synced from `PATH_TO_STATE_ASSIGNER_FILES/prompts/`) may need a "reply with raw JSON only" line — an operational note, not a code change.
3. **Relaxing `KEY_OPEN_AI` at startup** — a fresh deployment with neither codex nor a key now boots successfully and only fails at job-start time with a 400 validation error. This is intentional (matches worker-python's route/startup split adapted to worker-node conventions) and strictly less brittle than today for codex-only servers.
4. **Cancellation regression risk** — the codex child must not outlive a canceled job. Mitigated by passing the iteration `AbortSignal` directly to `spawn`, which is wired to both the queue signal and the iteration timer by the existing `runWithIterationTimeout`; covered by an explicit test.
5. **`--ephemeral` / flag drift across codex versions** — the flags are pinned to the behavior of codex 0.142.5 installed per `docs/CODEX_CLI_SERVER_SETUP.md`, the same contract worker-python already depends on in production; any future codex upgrade affects both packages equally.

## Open decisions (with recommendations baked into this plan)

1. Per-backend model defaults (`gpt-4o-mini` / `gpt-5.4-mini`) instead of worker-python's single default — recommended and assumed above.
2. Codex binary check at route boundary rather than startup — recommended and assumed above, per worker-node's stated design rule for workflow-specific validation.
