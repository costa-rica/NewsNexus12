---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# State Assigner Codex CLI Backend Todo (v01)

Implements `docs/20260710_state_assigner_codex_cli_plan_v02.md` (approved). Read that plan before starting — it holds the rationale, the backend-selection rules, and the cancellation design (§3a) that these tasks reference.

All work is in `worker-node/` unless a path says otherwise. At the end of each phase:

1. Run `cd worker-node && npx tsc -p tsconfig.json --noEmit`
2. Run `cd worker-node && npm test`
3. Run `cd worker-node && npm run build`

If anything fails, fix the code so the functionality remains and the checks pass. Then check off the phase's completed tasks and commit the changes for that phase (commit message conventions are in the root `AGENTS.md`).

## Phase 1 — AI backend config module

- [ ] Create `src/modules/state-assigner/config.ts` exporting:
  - [ ] A discriminated union type `StateAssignerAiConfig`:
    - `{ backend: 'openai'; modelName: string; keyOpenAi: string }`
    - `{ backend: 'codex-cli'; modelName: string; codexTimeoutMs: number }`
  - [ ] `resolveStateAssignerAiConfig(env: NodeJS.ProcessEnv, deps?)` implementing the selection rules from the plan:
    - `USE_OPEN_AI_API` true-like (`1`, `true`, `yes`, `on`, case-insensitive; `0`, `false`, `no`, `off` are false-like; empty/unset = false; anything else → validation error) **and** `KEY_OPEN_AI` non-empty → `openai` backend.
    - `USE_OPEN_AI_API` true-like but `KEY_OPEN_AI` empty/missing → `codex-cli` backend, and log a warning through `src/modules/logger.ts` (mirror worker-python's "openai key missing, falling back to codex" message).
    - `USE_OPEN_AI_API` false-like or unset → `codex-cli` backend, even if `KEY_OPEN_AI` is set.
  - [ ] Model name from `STATE_ASSIGNER_MODEL_NAME` (trimmed); when empty/unset default per backend: `gpt-4o-mini` for `openai`, `gpt-5.4-mini` for `codex-cli`.
  - [ ] `codexTimeoutMs` from `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` (positive integer, default `180`, stored in ms). Non-integer or `<= 0` → validation error.
  - [ ] All validation failures throw `AppError.validation([...])` (from `src/modules/errors/appError`) with the offending env var as `field`, matching the existing route error shape.
- [ ] Add a `codex` binary check used only when the resolved backend is `codex-cli`: scan `env.PATH` entries for an executable file named `codex` (Node equivalent of Python's `shutil.which`). Missing → `AppError.validation` naming field `codex` (or similar) with a message telling the operator to install the Codex CLI (`docs/CODEX_CLI_SERVER_SETUP.md`) or set `USE_OPEN_AI_API=true` with `KEY_OPEN_AI`. Make the check injectable via the optional `deps` parameter so tests never depend on a real binary.
- [ ] Create `tests/modules/stateAssignerAiConfig.test.ts` covering the selection matrix:
  - [ ] Unset/false `USE_OPEN_AI_API` → codex backend (even with `KEY_OPEN_AI` set).
  - [ ] `USE_OPEN_AI_API=true` + key → openai backend.
  - [ ] `USE_OPEN_AI_API=true` without key → codex backend and warning logged.
  - [ ] Invalid `USE_OPEN_AI_API` value → validation error.
  - [ ] Invalid `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` (zero, negative, non-integer) → validation error.
  - [ ] Per-backend model defaults, and `STATE_ASSIGNER_MODEL_NAME` override for both backends.
  - [ ] Codex backend with binary check failing → validation error; openai backend never invokes the binary check.

## Phase 2 — Shared response parsing and OpenAI client extraction

- [ ] Create `src/modules/state-assigner/responseParsing.ts` exporting `parseChatGptResponse(raw: string): ChatGptResponse`:
  - [ ] Try `JSON.parse(raw)`; on failure, extract the substring from the first `{` to the last `}` and parse that; if still unparseable or not an object → throw descriptive error.
  - [ ] Validate the parsed object exactly as `analyzeArticleWithOpenAi` does today: `occuredInTheUS` must be boolean; `reasoning` must be a non-empty string. Move the `ChatGptResponse` interface (or re-export it) so both clients and the job share one definition.
- [ ] Create `src/modules/state-assigner/openAiClient.ts` with `analyzeArticleWithOpenAi(...)` moved from `src/modules/jobs/stateAssignerJob.ts`:
  - [ ] Behavior unchanged except: model comes from the config (`aiConfig.modelName`) instead of the hardcoded `'gpt-4o-mini'`, and JSON parsing/validation goes through `parseChatGptResponse`.
  - [ ] Keep the existing commented-out note about no longer persisting raw responses (or drop it — do not resurrect the file writes).
- [ ] Create a test file for response parsing (e.g. `tests/modules/stateAssignerResponseParsing.test.ts`):
  - [ ] Strict JSON parses.
  - [ ] JSON wrapped in preamble/suffix text parses via brace extraction.
  - [ ] Garbage / no braces / non-object JSON → error.
  - [ ] Missing `occuredInTheUS`, wrong-type `occuredInTheUS`, missing/empty `reasoning` → errors matching current messages.

## Phase 3 — Codex CLI client

- [ ] Create `src/modules/state-assigner/codexCliClient.ts` exporting `analyzeArticleWithCodexCli(...)`. Follow plan §Design 2 and §3a precisely:
  - [ ] Create the `--output-last-message` temp file under `os.tmpdir()` (e.g. via `fs.mkdtemp`); delete it (and any temp dir) in a `finally` block on every path.
  - [ ] Spawn via `child_process.spawn` (injectable for tests): command `codex`, args `['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--output-last-message', <tempfile>, '-m', <modelName>, '-']`, `cwd: os.tmpdir()`.
  - [ ] Write the built prompt to `child.stdin`, then end the stream. Do NOT pass the prompt as an argv element, and do NOT pass the abort signal as the spawn `signal` option (kill handling is explicit, next tasks).
  - [ ] Register the child with the provided `registerCancelableProcess` hook immediately after spawn (the child's `kill` method satisfies `CancelableProcessHandle` from `src/modules/queue/queueEngine.ts`).
  - [ ] On the iteration `AbortSignal` firing: send `SIGTERM` to the child; start a 5 s grace timer (module constant, not an env var); if the child's `close` event has not fired when it elapses, send `SIGKILL`. Clear the timer on `close`.
  - [ ] The returned promise settles only on the child's `close` event (or spawn `error` event). On abort, reject with an `AbortError`-style error so the existing `runWithIterationTimeout` / `isAbortError` handling in the job treats it as timeout/cancel, not as an article failure.
  - [ ] Capture bounded stdout/stderr (keep only a ~400-char tail). Non-zero exit, empty output file, or unreadable output file → throw descriptive errors that include the tail.
  - [ ] Read the output file, parse with `parseChatGptResponse`, return the `ChatGptResponse`.
- [ ] Create `tests/modules/stateAssignerCodexClient.test.ts` using an injected fake spawn (no real codex binary; a controllable fake child with stdin/stdout/stderr streams, `kill`, and emitted `close`):
  - [ ] Spawn invocation shape: exact args listed above, `cwd` under tmpdir.
  - [ ] Prompt is written to stdin and stdin is ended; include one large prompt (several hundred KiB) to pin the stdin delivery path.
  - [ ] Success path: fake writes JSON to the output file path it was given, exits 0 → parsed `ChatGptResponse` returned.
  - [ ] Non-zero exit → error including stderr tail; empty output file → error; non-JSON output → error.
  - [ ] Child registered via `registerCancelableProcess` after spawn.
  - [ ] Abort: `SIGTERM` sent; fake child ignores it → after the grace period `SIGKILL` sent; promise settles once the fake emits `close`; rejection is recognized by the job's `isAbortError`.
  - [ ] Temp file cleanup happens on success and on each failure path.

## Phase 4 — Job wiring (`src/modules/jobs/stateAssignerJob.ts`)

- [ ] Replace `keyOpenAi: string` in `StateAssignerJobInput` (and `StateAssignerJobContext`) with `aiConfig: StateAssignerAiConfig`.
- [ ] Add `registerCancelableProcess: (handle: CancelableProcessHandle) => void` to `StateAssignerJobContext`; forward it from `QueueExecutionContext` in `createStateAssignerJobHandler` (today only `jobId` and `signal` are forwarded).
- [ ] Change the injected `analyzeArticle` signature to `(aiConfig, stateAssignerDirectories, promptTemplate, article, signal, registerCancelableProcess)`; update `ProcessStateAssignmentsOptions` accordingly (replace `keyOpenAi` with `aiConfig`, add `registerCancelableProcess`). The OpenAI client ignores the hook; the codex client uses it.
- [ ] In `runLegacyWorkflow`: select the analyzer by `aiConfig.backend` (`analyzeArticleWithOpenAi` vs `analyzeArticleWithCodexCli`) and select `iterationTimeoutMs` by backend: `DEFAULT_ITERATION_TIMEOUT_MS` (10 s) for `openai`, `aiConfig.codexTimeoutMs` for `codex-cli`.
- [ ] Remove the now-relocated OpenAI fetch logic and inline response validation from this file (they live in the Phase 2/3 modules). Persistence, prompt sync, targeting, enrichment, and `NewsNexusLlmStateAssigner01` attribution stay untouched.
- [ ] Update `tests/modules/stateAssignerJob.test.ts`:
  - [ ] Fix the existing two tests for the new input/context/analyzer shapes.
  - [ ] Add: analyzer chosen by backend (openai config → openai analyzer, codex config → codex analyzer — assert via injected fakes).
  - [ ] Add: iteration timeout is 10 s for openai and `codexTimeoutMs` for codex (assert the value passed into processing, e.g. via an injected `runLegacyWorkflow`-level fake or by exercising `processStateAssignmentsWithTimeout` wiring).
  - [ ] Add: `registerCancelableProcess` from the queue context reaches the analyzer arguments.

## Phase 5 — Route and startup config

- [ ] `src/routes/stateAssigner.ts`:
  - [ ] Delete `resolveOpenAiKey`; call `resolveStateAssignerAiConfig(env)` instead (route boundary — validation errors flow to `errorHandler` as today).
  - [ ] Pass the resolved `aiConfig` into `buildJobHandler` (replacing `keyOpenAi`); keep `pathToStateAssignerFiles` resolution unchanged.
  - [ ] Add resolved `backend` and `modelName` to the "Received state assigner start request" log line. Never log the API key.
  - [ ] Endpoint name and `202 { jobId, status, endpointName }` response unchanged.
- [ ] `src/modules/startup/config.ts`:
  - [ ] Remove `KEY_OPEN_AI` from `REQUIRED_ENV_VARS`; change `AppConfig.keyOpenAi` to `keyOpenAi?: string`, read leniently (undefined when unset). No startup codex-binary check.
- [ ] Update `tests/routes/stateAssigner.test.ts`:
  - [ ] Existing tests updated for the new `buildJobHandler` input shape (`aiConfig` instead of `keyOpenAi`); inject the binary check so the codex path resolves in CI.
  - [ ] Missing `KEY_OPEN_AI` with codex resolvable → 202 (no longer a 400).
  - [ ] `USE_OPEN_AI_API=true` without key → 202 via codex fallback.
  - [ ] Codex backend with binary missing → 400 `VALIDATION_ERROR`.
  - [ ] `USE_OPEN_AI_API=true` + key → job handler receives an `openai` config.
- [ ] Update `tests/modules/startupConfig.test.ts`: startup succeeds without `KEY_OPEN_AI`; `KEY_OPEN_AI` no longer appears in missing-vars errors.

## Phase 6 — Documentation

Follow the root `AGENTS.md` markdown frontmatter rules for any new file; these are all edits to existing files (frontmatter only updated where the file has it).

- [ ] `worker-node/AGENTS.md`: update the state-assigner section (backend selection rules, codex invocation, backend-aware iteration timeout, cancellation behavior) and the environment-variables section (`KEY_OPEN_AI` → optional; add `USE_OPEN_AI_API`, `STATE_ASSIGNER_MODEL_NAME`, `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS`). Include the migration note from plan §Migration note and the queue-occupancy caveat (codex articles can take up to the codex timeout each).
- [ ] `worker-node/README.md`: it currently lists `KEY_OPEN_AI` as required and describes only the OpenAI path — update both, and include the migration note ("to stay on the OpenAI API set `USE_OPEN_AI_API=true`").
- [ ] Root `AGENTS.md`: update the env-var summary line that lists `KEY_OPEN_AI` as an important worker-node setting.
- [ ] `docs/CTO_ONBOARDING.md`: update the state-assigner description from "OpenAI API-key based" to backend selection with codex default.
- [ ] `worker-node/docs/worker-node-api-documentation/API_REFERENCE.md`: update state-assigner start-job env prerequisites if that file documents them (check first; skip with a note if it does not).
- [ ] Update any `.env.example`-style file in `worker-node/` if present (check first; skip if none).
- [ ] Final full check: `cd worker-node && npx tsc -p tsconfig.json --noEmit && npm test && npm run build`.
