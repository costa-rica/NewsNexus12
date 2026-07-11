---
created_at: 2026-07-10
updated_at: 2026-07-10
created_by: claude (fable-5)
modified_by: claude (fable-5)
---

# State Assigner Codex CLI Backend Todo (v04)

Implements `docs/20260710_state_assigner_codex_cli_plan_v02.md` (approved). Read that plan before starting — it holds the rationale, the backend-selection rules, and the cancellation design (§3a) that these tasks reference.

## Changes from v03

Addresses the single concern in `20260710_state_assigner_codex_cli_todo_v03_assessment_codex.md`:

- **Phase 4 test strategy is now fully specified.** The `processAssignments` seam is mandatory to implement (it stays optional in the TypeScript interface with the real function as the production default, but adding the seam is a required task, since the timeout- and analyzer-selection tests assert through it). The setup strategy for testing the real `runLegacyWorkflow` is explicitly the **narrow-dependency-seam** approach (assessment option 2): `ensureDb`, `ensureDirectories`, `syncPrompts`, `resolveEntityWhoCategorizes`, and `loadPrompt` become injectable alongside the existing `selectArticles` / `enrichContent02` / `getCanonicalContent02Row`, so the Phase 4 tests are pure — no test database seeding, no real prompt directories, no module mocking. Both new tests assert via the options object captured by the fake `processAssignments`.

Carried forward from earlier versions: Phase 2 is additive-only with the job rewired in Phase 4; shared `prompt.ts` helper; explicit `child.stdin` error handling and early-close test; route `resolveAiConfig` injection seam; endpoint doc task targets `endpoints/state-assigner.md`.

All work is in `worker-node/` unless a path says otherwise. At the end of each phase:

1. Run `cd worker-node && npx tsc -p tsconfig.json --noEmit`
2. Run `cd worker-node && npm test`
3. Run `cd worker-node && npm run build`

If anything fails, fix the code so the functionality remains and the checks pass. Then check off the phase's completed tasks and commit the changes for that phase (commit message conventions are in the root `AGENTS.md`).

## Phase 1 — AI backend config module

- [x] Create `src/modules/state-assigner/config.ts` exporting:
  - [x] A discriminated union type `StateAssignerAiConfig`:
    - `{ backend: 'openai'; modelName: string; keyOpenAi: string }`
    - `{ backend: 'codex-cli'; modelName: string; codexTimeoutMs: number }`
  - [x] A `StateAssignerAiConfigDependencies` type for the injectable pieces (at minimum the codex binary check).
  - [x] `resolveStateAssignerAiConfig(env: NodeJS.ProcessEnv, deps?: StateAssignerAiConfigDependencies)` implementing the selection rules from the plan:
    - `USE_OPEN_AI_API` true-like (`1`, `true`, `yes`, `on`, case-insensitive; `0`, `false`, `no`, `off` are false-like; empty/unset = false; anything else → validation error) **and** `KEY_OPEN_AI` non-empty → `openai` backend.
    - `USE_OPEN_AI_API` true-like but `KEY_OPEN_AI` empty/missing → `codex-cli` backend, and log a warning through `src/modules/logger.ts` (mirror worker-python's "openai key missing, falling back to codex" message).
    - `USE_OPEN_AI_API` false-like or unset → `codex-cli` backend, even if `KEY_OPEN_AI` is set.
  - [x] Model name from `STATE_ASSIGNER_MODEL_NAME` (trimmed); when empty/unset default per backend: `gpt-4o-mini` for `openai`, `gpt-5.4-mini` for `codex-cli`.
  - [x] `codexTimeoutMs` from `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` (positive integer, default `180`, stored in ms). Non-integer or `<= 0` → validation error.
  - [x] All validation failures throw `AppError.validation([...])` (from `src/modules/errors/appError`) with the offending env var as `field`, matching the existing route error shape.
- [x] Add a `codex` binary check used only when the resolved backend is `codex-cli`: scan `env.PATH` entries for an executable file named `codex` (Node equivalent of Python's `shutil.which`). Missing → `AppError.validation` naming field `codex` (or similar) with a message telling the operator to install the Codex CLI (`docs/CODEX_CLI_SERVER_SETUP.md`) or set `USE_OPEN_AI_API=true` with `KEY_OPEN_AI`. The check is the injectable member of `StateAssignerAiConfigDependencies` so tests never depend on a real binary.
- [x] Create `tests/modules/stateAssignerAiConfig.test.ts` covering the selection matrix:
  - [x] Unset/false `USE_OPEN_AI_API` → codex backend (even with `KEY_OPEN_AI` set).
  - [x] `USE_OPEN_AI_API=true` + key → openai backend.
  - [x] `USE_OPEN_AI_API=true` without key → codex backend and warning logged.
  - [x] Invalid `USE_OPEN_AI_API` value → validation error.
  - [x] Invalid `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS` (zero, negative, non-integer) → validation error.
  - [x] Per-backend model defaults, and `STATE_ASSIGNER_MODEL_NAME` override for both backends.
  - [x] Codex backend with binary check failing → validation error; openai backend never invokes the binary check.

## Phase 2 — Shared helpers and OpenAI client (additive only)

**Phase boundary rule: this phase only creates new files in `src/modules/state-assigner/` and their tests. `src/modules/jobs/stateAssignerJob.ts` is NOT modified in this phase** — its local `analyzeArticleWithOpenAi`, `buildPrompt`, and validation stay in place and in use until Phase 4. The temporary duplication between the job file and the new modules is intentional and lasts exactly one phase; Phase 4 deletes the job-local copies.

- [x] Create `src/modules/state-assigner/prompt.ts` exporting `buildStateAssignerPrompt(template: string, article: { title: string; content: string }): string` with the same substitution as the job's current `buildPrompt` (`{articleTitle}`, `{articleContent}`). Both clients (Phases 2 and 3) must use this helper — do not duplicate the replacement logic in either client.
- [x] Create `src/modules/state-assigner/responseParsing.ts` exporting `parseChatGptResponse(raw: string): ChatGptResponse`:
  - [x] Try `JSON.parse(raw)`; on failure, extract the substring from the first `{` to the last `}` and parse that; if still unparseable or not an object → throw descriptive error.
  - [x] Validate the parsed object exactly as the job's `analyzeArticleWithOpenAi` does today: `occuredInTheUS` must be boolean; `reasoning` must be a non-empty string.
  - [x] Define (or move here) the shared `ChatGptResponse` interface; in Phase 4 the job will import it from here (until then the job keeps its own local definition — do not touch the job file yet).
- [x] Create `src/modules/state-assigner/openAiClient.ts` with `analyzeArticleWithOpenAi(...)` as an *extracted copy* of the job's current function, adapted to the new shapes:
  - [x] Takes the `openai` variant of `StateAssignerAiConfig`; model comes from `aiConfig.modelName` instead of the hardcoded `'gpt-4o-mini'`.
  - [x] Uses `buildStateAssignerPrompt` and `parseChatGptResponse`.
  - [x] Same fetch call, headers, temperature, error messages, and abort-signal behavior as the job-local original. Do not resurrect the commented-out raw-response file writes.
- [x] Create `tests/modules/stateAssignerResponseParsing.test.ts`:
  - [x] Strict JSON parses.
  - [x] JSON wrapped in preamble/suffix text parses via brace extraction.
  - [x] Garbage / no braces / non-object JSON → error.
  - [x] Missing `occuredInTheUS`, wrong-type `occuredInTheUS`, missing/empty `reasoning` → errors matching current messages.
- [x] (Optional but recommended) A small test for `buildStateAssignerPrompt` covering both placeholders.

## Phase 3 — Codex CLI client

- [ ] Create `src/modules/state-assigner/codexCliClient.ts` exporting `analyzeArticleWithCodexCli(...)`. Follow plan §Design 2 and §3a precisely:
  - [ ] Build the prompt with `buildStateAssignerPrompt`.
  - [ ] Create the `--output-last-message` temp file under `os.tmpdir()` (e.g. via `fs.mkdtemp`); delete it (and any temp dir) in a `finally` block on every path.
  - [ ] Spawn via `child_process.spawn` (injectable for tests): command `codex`, args `['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--output-last-message', <tempfile>, '-m', <modelName>, '-']`, `cwd: os.tmpdir()`.
  - [ ] **stdin delivery with explicit error handling**: attach an `error` listener to `child.stdin` *before* writing; write the full prompt and end the stream, handling write/end callback errors. If the child closes stdin early (e.g. `EPIPE` because codex exited or rejected its flags), do not let the stream error become an unhandled `error`/rejection that could crash the worker — record it and let the child's `close` outcome drive the settled result: the client rejects with a descriptive bounded error (per-article failure), never an unhandled exception.
  - [ ] Do NOT pass the prompt as an argv element, and do NOT pass the abort signal as the spawn `signal` option (kill handling is explicit, next tasks).
  - [ ] Register the child with the provided `registerCancelableProcess` hook immediately after spawn (the child's `kill` method satisfies `CancelableProcessHandle` from `src/modules/queue/queueEngine.ts`).
  - [ ] On the iteration `AbortSignal` firing: send `SIGTERM` to the child; start a 5 s grace timer (module constant, not an env var); if the child's `close` event has not fired when it elapses, send `SIGKILL`. Clear the timer on `close`.
  - [ ] The returned promise settles only on the child's `close` event (or spawn `error` event) — exactly once, deterministically, on every path (success, non-zero exit, stdin stream error, abort). On abort, reject with an `AbortError`-style error so the existing `runWithIterationTimeout` / `isAbortError` handling in the job treats it as timeout/cancel, not as an article failure.
  - [ ] Capture bounded stdout/stderr (keep only a ~400-char tail). Non-zero exit, empty output file, or unreadable output file → throw descriptive errors that include the tail.
  - [ ] Read the output file, parse with `parseChatGptResponse`, return the `ChatGptResponse`.
- [ ] Create `tests/modules/stateAssignerCodexClient.test.ts` using an injected fake spawn (no real codex binary; a controllable fake child with stdin/stdout/stderr streams, `kill`, and emitted `close`):
  - [ ] Spawn invocation shape: exact args listed above, `cwd` under tmpdir.
  - [ ] Prompt is written to stdin and stdin is ended; include one large prompt (several hundred KiB) to pin the stdin delivery path.
  - [ ] Success path: fake writes JSON to the output file path it was given, exits 0 → parsed `ChatGptResponse` returned.
  - [ ] **stdin early-close/error path**: fake child emits an `error` on its stdin stream (or destroys stdin) mid-write, then emits `close` with a non-zero code → client rejects with a descriptive bounded error, no unhandled error/rejection escapes, temp file cleaned up.
  - [ ] Non-zero exit → error including stderr tail; empty output file → error; non-JSON output → error.
  - [ ] Child registered via `registerCancelableProcess` after spawn.
  - [ ] Abort: `SIGTERM` sent; fake child ignores it → after the grace period `SIGKILL` sent; promise settles once the fake emits `close`; rejection is recognized by the job's `isAbortError`.
  - [ ] Temp file cleanup happens on success and on each failure path.

## Phase 4 — Job wiring (`src/modules/jobs/stateAssignerJob.ts`)

This phase removes the Phase 2 duplication: the job file switches to the `src/modules/state-assigner/` modules and its local copies are deleted.

**Test strategy for this phase (decided, do not improvise):** the Phase 4 tests exercise the **real** `runLegacyWorkflow` with **every** external effect injected as a narrow dependency — no test database, no seeded rows, no real prompt directories, no `jest.mock` module mocking, and no injected replacement `runLegacyWorkflow`. Backend selection and timeout selection are asserted by inspecting the options object the real `runLegacyWorkflow` passes to an injected fake `processAssignments`.

- [ ] Replace `keyOpenAi: string` in `StateAssignerJobInput` (and `StateAssignerJobContext`) with `aiConfig: StateAssignerAiConfig`.
- [ ] Add `registerCancelableProcess: (handle: CancelableProcessHandle) => void` to `StateAssignerJobContext`; forward it from `QueueExecutionContext` in `createStateAssignerJobHandler` (today only `jobId` and `signal` are forwarded).
- [ ] Change the injected `analyzeArticle` signature to `(aiConfig, stateAssignerDirectories, promptTemplate, article, signal, registerCancelableProcess)`; update `ProcessStateAssignmentsOptions` accordingly (replace `keyOpenAi` with `aiConfig`, add `registerCancelableProcess`). The OpenAI client ignores the hook; the codex client uses it.
- [ ] Extend `StateAssignerJobDependencies` with the following seams. All are optional in the TypeScript interface with the real implementation as the production default (same pattern as the existing `selectArticles`), but **implementing every seam below is required** — the Phase 4 tests depend on them:
  - [ ] `analyzeWithOpenAi?: typeof analyzeArticleWithOpenAi` (default: real client from `openAiClient.ts`)
  - [ ] `analyzeWithCodexCli?: typeof analyzeArticleWithCodexCli` (default: real client from `codexCliClient.ts`)
  - [ ] `processAssignments?: typeof processStateAssignmentsWithTimeout` (default: the real function) — required seam: the timeout- and analyzer-selection tests assert on its captured options.
  - [ ] Workflow-setup seams so tests never touch DB or filesystem:
    - [ ] `ensureDb?: typeof ensureDbReady` (default: real)
    - [ ] `ensureDirectories?: typeof ensureStateAssignerDirectories` (default: real)
    - [ ] `syncPrompts?: (promptsDir: string) => Promise<void>` (default: the module's `syncPromptFilesToDatabase`)
    - [ ] `resolveEntityWhoCategorizes?: () => Promise<number>` (default: the module's `resolveEntityWhoCategorizesId`)
    - [ ] `loadPrompt?: () => Promise<PromptData>` (default: the module's `getPrompt`)
  - [ ] `createStateAssignerJobHandler` threads all of these into `runLegacyWorkflow` the same way `selectArticles` / `enrichContent02` / `getCanonicalContent02Row` already flow.
- [ ] In `runLegacyWorkflow`: use the injected setup seams in place of the direct calls; select the analyzer by `aiConfig.backend` (`analyzeWithOpenAi` vs `analyzeWithCodexCli`); call `processAssignments` with `iterationTimeoutMs` selected by backend: `DEFAULT_ITERATION_TIMEOUT_MS` (10 s) for `openai`, `aiConfig.codexTimeoutMs` for `codex-cli`.
- [ ] Delete the job-local `analyzeArticleWithOpenAi`, `buildPrompt`, inline response validation, and local `ChatGptResponse` definition; import `ChatGptResponse` from `responseParsing.ts` (re-export from the job file if existing importers reference it there — check `grep -rn "ChatGptResponse" worker-node/src worker-node/tests` and keep those imports compiling). Persistence, prompt sync, targeting, enrichment, and `NewsNexusLlmStateAssigner01` attribution stay untouched.
- [ ] Update `tests/modules/stateAssignerJob.test.ts`:
  - [ ] Fix the existing two tests for the new input/context/analyzer shapes.
  - [ ] Add a shared helper that runs the real `runLegacyWorkflow` (via `createStateAssignerJobHandler` with no `runLegacyWorkflow` override) with all seams injected as fakes: `ensureDb`/`ensureDirectories`/`syncPrompts` resolve trivially (`ensureDirectories` returns a fake `StateAssignerDirectories` object), `resolveEntityWhoCategorizes` returns a fixed id, `loadPrompt` returns a fixed `PromptData`, `selectArticles` returns one fake article, `enrichContent02` returns an empty summary, `getCanonicalContent02Row` returns null (falls back to description), and `processAssignments` is a jest fn capturing its options.
  - [ ] Add: analyzer chosen by backend — with an `openai` config, the captured `processAssignments` options' `analyzeArticle` is the injected `analyzeWithOpenAi` fake; with a `codex-cli` config, it is the injected `analyzeWithCodexCli` fake.
  - [ ] Add: iteration timeout selection — captured `iterationTimeoutMs` is `10_000` for the `openai` config and equals `codexTimeoutMs` for the `codex-cli` config.
  - [ ] Add: `registerCancelableProcess` forwarding — the hook passed to the queue-context handler appears in the captured `processAssignments` options (and is the same function the analyzer will receive).

## Phase 5 — Route and startup config

- [ ] `src/routes/stateAssigner.ts`:
  - [ ] Delete `resolveOpenAiKey`.
  - [ ] Extend `StateAssignerRouteDependencies` with `resolveAiConfig?: typeof resolveStateAssignerAiConfig`, defaulting to the real `resolveStateAssignerAiConfig` (which uses the real binary check) in the production default dependency object. Route tests inject a `resolveAiConfig` that returns a deterministic config (or throws `AppError.validation`) so CI never needs `codex` on `PATH`.
  - [ ] Call the resolver at the route boundary; validation errors flow to `errorHandler` as today.
  - [ ] Pass the resolved `aiConfig` into `buildJobHandler` (replacing `keyOpenAi`); keep `pathToStateAssignerFiles` resolution unchanged.
  - [ ] Add resolved `backend` and `modelName` to the "Received state assigner start request" log line. Never log the API key.
  - [ ] Endpoint name and `202 { jobId, status, endpointName }` response unchanged.
- [ ] `src/modules/startup/config.ts`:
  - [ ] Remove `KEY_OPEN_AI` from `REQUIRED_ENV_VARS`; change `AppConfig.keyOpenAi` to `keyOpenAi?: string`, read leniently (undefined when unset). No startup codex-binary check.
- [ ] Update `tests/routes/stateAssigner.test.ts`:
  - [ ] Existing tests updated for the new `buildJobHandler` input shape (`aiConfig` instead of `keyOpenAi`), injecting `resolveAiConfig` through the route dependencies.
  - [ ] Missing `KEY_OPEN_AI` with codex resolvable (injected) → 202 (no longer a 400).
  - [ ] `USE_OPEN_AI_API=true` without key → 202 via codex fallback.
  - [ ] Injected resolver throwing the binary-missing `AppError.validation` → 400 `VALIDATION_ERROR`.
  - [ ] `USE_OPEN_AI_API=true` + key → job handler receives an `openai` config.
- [ ] Update `tests/modules/startupConfig.test.ts`: startup succeeds without `KEY_OPEN_AI`; `KEY_OPEN_AI` no longer appears in missing-vars errors.

## Phase 6 — Documentation

Follow the root `AGENTS.md` markdown frontmatter rules for any new file; these are all edits to existing files (frontmatter only updated where the file has it).

- [ ] `worker-node/AGENTS.md`: update the state-assigner section (backend selection rules, codex invocation, backend-aware iteration timeout, cancellation behavior) and the environment-variables section (`KEY_OPEN_AI` → optional; add `USE_OPEN_AI_API`, `STATE_ASSIGNER_MODEL_NAME`, `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS`). Include the migration note from plan §Migration note and the queue-occupancy caveat (codex articles can take up to the codex timeout each).
- [ ] `worker-node/README.md`: it currently lists `KEY_OPEN_AI` as required and describes only the OpenAI path — update both, and include the migration note ("to stay on the OpenAI API set `USE_OPEN_AI_API=true`").
- [ ] Root `AGENTS.md`: update the env-var summary line that lists `KEY_OPEN_AI` as an important worker-node setting.
- [ ] `docs/CTO_ONBOARDING.md`: update the state-assigner description from "OpenAI API-key based" to backend selection with codex default.
- [ ] `worker-node/docs/worker-node-api-documentation/endpoints/state-assigner.md`: this file currently documents the old behavior and must be updated in full:
  - [ ] Runtime dependencies / env prerequisites: `KEY_OPEN_AI` becomes optional (required only with `USE_OPEN_AI_API=true`); add `USE_OPEN_AI_API`, `STATE_ASSIGNER_MODEL_NAME`, `STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS`.
  - [ ] Validation bullets: replace "Validates `KEY_OPEN_AI` is configured" with backend resolution (codex binary check when the codex backend is selected).
  - [ ] Error examples: replace the missing-`KEY_OPEN_AI` 400 example with the codex-binary-missing 400 validation error; note that a missing key alone is no longer an error.
  - [ ] Add a short backend-selection / migration note (codex default; `USE_OPEN_AI_API=true` to stay on the OpenAI API).
  - [ ] Fix the stale claim that raw JSON responses are written to `chatgpt_responses/` — responses are parsed in memory and not persisted (this is already true in the current code).
- [ ] `worker-node/docs/worker-node-api-documentation/API_REFERENCE.md`: no content change expected — just confirm the `state-assigner` endpoint link remains valid.
- [ ] Update any `.env.example`-style file in `worker-node/` if present (check first; skip if none).
- [ ] Final full check: `cd worker-node && npx tsc -p tsconfig.json --noEmit && npm test && npm run build`.
