---
created_at: 2026-07-09
updated_at: 2026-07-09
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# worker-python codex cli ai approver todo v03

## Scope

Implement the approved plan in `docs/20260709_worker_python_codex_cli_plan_v02.md`.

This v03 replaces `docs/20260709_worker_python_codex_cli_todo_v02.md` by addressing the qualifying concern in `docs/20260709_worker_python_codex_cli_todo_v02_assessment_claude.md`.

Claude's assessment found that v02 correctly preserves the forced test bootstrap onto the OpenAI API backend, but does not explicitly tell implementation tests how to isolate Codex-default selection cases from that forced process-wide env value. A v03 is needed so an implementer does not "fix" failing unset/false backend tests by weakening `worker-python/tests/conftest.py`.

The AI approver must support two interchangeable scoring backends:

- Codex CLI backend by default, using `codex exec` per article and the operator's existing CLI login.
- OpenAI API backend only when `USE_OPEN_AI_API=true` and `OPENAI_API_KEY` is set.

Do not change `AiApproverOrchestrator` or repository behavior unless a test proves it is necessary. The orchestrator already accepts any client with `score_article(prompt)`.

## Phase 1 - Configuration selection and deterministic test bootstrap

- [x] Update `worker-python/tests/conftest.py` before changing startup validation so ordinary test collection stays deterministic:
  - [x] Force the test process onto the OpenAI API backend before `from src.main import app` by assigning `os.environ["USE_OPEN_AI_API"] = "true"`.
  - [x] Do not use `os.environ.setdefault("USE_OPEN_AI_API", "true")`; a host or CI value of `USE_OPEN_AI_API=false` must not be allowed to defeat the test bootstrap.
  - [x] Keep the existing fake `OPENAI_API_KEY`.
  - [x] Do not require the Codex CLI binary during ordinary route/app tests.
  - [x] Do not later weaken or remove this forced bootstrap to make Codex-default unit tests pass; isolate those tests instead.
- [x] Update `worker-python/src/modules/ai_approver/config.py`:
  - [x] Remove `OPENAI_API_KEY` from `REQUIRED_STARTUP_ENV_KEYS`; keep the Postgres startup keys.
  - [x] Add `TRUE_VALUES`, `FALSE_VALUES`, and `_parse_bool(value, key)` matching the deduper boolean semantics.
  - [x] Add `use_open_ai_api: bool` and `codex_timeout_seconds: int` to `AiApproverConfig`.
  - [x] Parse `USE_OPEN_AI_API` as optional with default `false`.
  - [x] Parse `AI_APPROVER_CODEX_TIMEOUT_SECONDS` as optional positive integer with default `180`.
  - [x] Keep `OPENAI_API_KEY` optional in `from_env()`; store the stripped value, possibly empty.
  - [x] Keep `AI_APPROVER_MODEL_NAME` defaulting to `gpt-4o-mini`.
  - [x] Add a `use_codex_cli` computed property implementing `not (use_open_ai_api and openai_api_key)`.
  - [x] Log a warning when `USE_OPEN_AI_API=true` but `OPENAI_API_KEY` is empty, because this soft-falls back to Codex CLI.
  - [x] Raise `AiApproverConfigError` for unrecognized boolean values and non-positive timeout values.
- [x] Rework `validate_ai_approver_startup_env()`:
  - [x] Continue to raise for missing Postgres startup keys.
  - [x] Compute the effective backend from `USE_OPEN_AI_API` plus `OPENAI_API_KEY`.
  - [x] If the effective backend is OpenAI API, do not check for `codex` on `PATH`.
  - [x] If the effective backend is Codex CLI, require `shutil.which("codex")` to resolve.
  - [x] If `USE_OPEN_AI_API=true` and the key is missing, log the soft-fallback warning and then enforce Codex CLI binary availability.
- [x] Update `worker-python/tests/unit/ai_approver/test_config.py`:
  - [x] Replace the existing `test_validate_startup_env_requires_openai_key`.
  - [x] Cover default selection: `USE_OPEN_AI_API` unset or false means Codex CLI, even if `OPENAI_API_KEY` is set.
  - [x] Cover API selection: `USE_OPEN_AI_API=true` plus key means OpenAI API.
  - [x] Cover soft fallback: `USE_OPEN_AI_API=true` without key means Codex CLI and logs a warning.
  - [x] Cover invalid boolean values.
  - [x] Cover `AI_APPROVER_CODEX_TIMEOUT_SECONDS` default, valid override, invalid integer, and non-positive value.
  - [x] Cover startup validation requiring `codex` only on the effective Codex CLI path by monkeypatching `shutil.which`.
  - [x] Add an explicit startup validation test proving `USE_OPEN_AI_API=true` plus a key bypasses Codex binary validation even when `shutil.which("codex")` returns `None`.
  - [x] For tests that exercise `USE_OPEN_AI_API` unset through `AiApproverConfig.from_env()` or `validate_ai_approver_startup_env()`, explicitly call `monkeypatch.delenv("USE_OPEN_AI_API", raising=False)` so the forced `tests/conftest.py` value is not read.
  - [x] For tests that exercise `USE_OPEN_AI_API=false`, explicitly call `monkeypatch.setenv("USE_OPEN_AI_API", "false")`.
  - [x] When a config/startup test calls `from_env()` or `validate_ai_approver_startup_env()`, set the required `PG_*` env values in that test or fixture so failures are about backend selection, not missing database env.
  - [x] Do not change `tests/conftest.py` away from the forced `USE_OPEN_AI_API=true` bootstrap to satisfy these unit tests.
- [x] Rewrite `worker-python/tests/integration/test_ai_approver_routes.py::test_main_import_fails_when_ai_approver_env_missing` for the new optional-key/backend-selection behavior:
  - [x] Do not keep an assertion that deleting only `OPENAI_API_KEY` must make `importlib.reload(src.main)` raise `SystemExit`.
  - [x] Make the test deterministic by monkeypatching `shutil.which` inside the ai_approver config module or at the exact lookup point used by startup validation.
  - [x] Cover the new missing-key fallback explicitly: with required Postgres env present, `USE_OPEN_AI_API=true`, `OPENAI_API_KEY` deleted, and `shutil.which("codex")` returning a fake path, reloading `src.main` should not fail solely because the API key is missing.
  - [x] Cover the Codex CLI startup failure explicitly: with required Postgres env present, the effective backend set to Codex CLI, and `shutil.which("codex")` returning `None`, reloading `src.main` should fail deterministically.
  - [x] Restore any process environment or module state needed so the test does not leak backend selection into other route/app tests.
  - [x] If this integration test uses the "unset" default selection path, explicitly remove the forced bootstrap value with `monkeypatch.delenv("USE_OPEN_AI_API", raising=False)` inside the test.

### Phase 1 verification

Run from `worker-python/`:

```bash
pytest tests/unit/ai_approver/test_config.py
pytest tests/unit/ai_approver/test_config.py tests/integration/test_ai_approver_routes.py
```

If any test fails, fix the implementation and rerun the same commands. After the phase passes, check off completed Phase 1 tasks and commit only the related changes.

Suggested commit title:

```text
feat: add ai approver backend config
```

Include a body noting the test bootstrap contract, the rewritten startup integration test, and the Codex-default selection semantics.

## Phase 2 - Codex CLI client and factory

- [x] Update `worker-python/src/modules/ai_approver/client.py`:
  - [x] Leave `AiApproverOpenAIClient` behavior unchanged except for imports needed by the new code.
  - [x] Add `AiApproverCodexCliClient` with the same public contract: `score_article(prompt: str) -> dict[str, Any]`.
  - [x] Execute Codex with:

    ```bash
    codex exec --ephemeral --skip-git-repo-check -s read-only \
      --output-last-message <tempfile> -m <AI_APPROVER_MODEL_NAME> <prompt>
    ```

  - [x] Use `subprocess.run(..., capture_output=True, text=True, timeout=config.codex_timeout_seconds, cwd=tempfile.gettempdir())`.
  - [x] Create and clean up a temporary output file for `--output-last-message`.
  - [x] Read the final message from the output file, not from stdout.
  - [x] Parse the output with `json.loads` first.
  - [x] Add a fallback parser that extracts from the first `{` through the last `}` in the output file content, then parses that substring.
  - [x] Return `{"payload": parsed_payload, "usage": {}}` on success.
  - [x] Raise `AiApproverProcessorError` for non-zero exit code, timeout, empty output, and unparseable output.
  - [x] Include a truncated stdout/stderr tail in subprocess error messages, without logging prompt text or secrets.
  - [x] Do not use `--output-schema`.
- [x] Add `create_ai_approver_client(config)` in `client.py`:
  - [x] Return `AiApproverCodexCliClient(config)` when `config.use_codex_cli` is true.
  - [x] Return `AiApproverOpenAIClient(config)` otherwise.
- [x] Add `worker-python/tests/unit/ai_approver/test_client.py` if it does not exist:
  - [x] Mock `subprocess.run` and temporary output behavior for successful JSON output.
  - [x] Assert the command contains `codex`, `exec`, `--ephemeral`, `--skip-git-repo-check`, `-s read-only`, `--output-last-message`, `-m`, the configured model, and the prompt as a positional argument.
  - [x] Assert `cwd` is a neutral temp directory and timeout comes from config.
  - [x] Cover fallback JSON parsing for prefixed/fenced output.
  - [x] Cover non-zero exit code with stderr/stdout included in truncated form.
  - [x] Cover `subprocess.TimeoutExpired`.
  - [x] Cover empty output file.
  - [x] Cover junk output that cannot parse.
  - [x] Cover factory selection for the three required combinations:
    - `USE_OPEN_AI_API=true` plus key -> OpenAI client.
    - `USE_OPEN_AI_API=true` without key -> Codex client.
    - `USE_OPEN_AI_API` unset or false -> Codex client, regardless of key.
  - [x] Factory-selection tests may construct `AiApproverConfig` directly to avoid process-env coupling.
  - [x] If factory-selection tests instead build configs through `AiApproverConfig.from_env()`, they must explicitly isolate each backend case:
    - [x] Use `monkeypatch.delenv("USE_OPEN_AI_API", raising=False)` for the unset case.
    - [x] Use `monkeypatch.setenv("USE_OPEN_AI_API", "false")` for the false case.
    - [x] Use `monkeypatch.setenv("USE_OPEN_AI_API", "true")` for true cases.
    - [x] Set or delete `OPENAI_API_KEY` per case instead of relying on the bootstrap value from `tests/conftest.py`.
    - [x] Set required `PG_*` env values when calling `from_env()`.
  - [x] Do not alter the forced `USE_OPEN_AI_API=true` test bootstrap to make factory tests pass.

### Phase 2 verification

Run from `worker-python/`:

```bash
pytest tests/unit/ai_approver/test_client.py tests/unit/ai_approver/test_config.py
pytest tests/unit/ai_approver
```

If any test fails, fix the implementation and rerun the same commands. After the phase passes, check off completed Phase 2 tasks and commit only the related changes.

Suggested commit title:

```text
feat: add codex cli ai approver client
```

Include a body noting the subprocess invocation, output parsing behavior, and error mapping.

## Phase 3 - Route integration and workflow regression coverage

- [x] Update `worker-python/src/routes/ai_approver.py`:
  - [x] Replace the `AiApproverOpenAIClient` import with `create_ai_approver_client`.
  - [x] In `create_ai_approver_runner`, replace `AiApproverOpenAIClient(config)` with `create_ai_approver_client(config)`.
  - [x] In `create_review_page_ai_approver_runner`, replace `AiApproverOpenAIClient(config)` with `create_ai_approver_client(config)`.
  - [x] Keep endpoint names, request shapes, queue result fields, cancellation handling, and repository lifecycle unchanged.
- [x] Add or update route tests if needed:
  - [x] Prove the queued batch runner uses the client factory.
  - [x] Prove the review-page runner uses the client factory.
  - [x] Keep route tests on the OpenAI API backend through the forced `tests/conftest.py` bootstrap unless a test explicitly isolates and monkeypatches the Codex path.
- [x] Confirm existing orchestrator tests still pass with client fakes returning empty usage dictionaries, since Codex returns zero token usage.

### Phase 3 verification

Run from `worker-python/`:

```bash
pytest tests/unit/ai_approver tests/integration/test_ai_approver_routes.py
pytest tests/integration/test_routes.py tests/integration/test_queue_info_routes.py
```

Then run the worker-python suite:

```bash
make test
```

If any test fails, fix the implementation and rerun the relevant focused command, then rerun `make test`. After the phase passes, check off completed Phase 3 tasks and commit only the related changes.

Suggested commit title:

```text
feat: wire ai approver backend factory
```

Include a body noting the batch and review-page route wiring.

## Phase 4 - Documentation and env examples

- [ ] Update `worker-python/.env.example`:
  - [ ] Add `USE_OPEN_AI_API=false` or a commented equivalent showing the new default.
  - [ ] Keep `OPENAI_API_KEY` present as optional and label it for OpenAI API mode.
  - [ ] Add `AI_APPROVER_MODEL_NAME=gpt-4o-mini`.
  - [ ] Add `AI_APPROVER_CODEX_TIMEOUT_SECONDS=180`.
- [ ] Update `worker-python/AGENTS.md`:
  - [ ] Replace statements that `OPENAI_API_KEY` is required.
  - [ ] Document the selection table:
    - `USE_OPEN_AI_API=true` plus key -> OpenAI API.
    - `USE_OPEN_AI_API=true` without key -> Codex CLI with warning.
    - `USE_OPEN_AI_API` unset or false -> Codex CLI.
  - [ ] Document that Codex CLI is the default backend and requires `codex` on `PATH` at startup.
  - [ ] Document that `AI_APPROVER_MODEL_NAME` applies to both API and CLI and is passed as `-m` to `codex exec`.
  - [ ] Document that Codex backend usage totals are zero because the client returns empty usage.
  - [ ] Document that existing deployments with `OPENAI_API_KEY` but no `USE_OPEN_AI_API=true` will switch to Codex CLI after the change.
  - [ ] Add troubleshooting guidance for missing `codex` on `PATH` under service managers and for Codex model rejection.
- [ ] Update `worker-python/README.md` if its AI approver execution section still says it always creates `AiApproverOpenAIClient` or always calls OpenAI.
- [ ] Update `worker-python/docs/20260502_HOW_TO_USE_AI_APPROVER.md` if it contains setup guidance that makes `OPENAI_API_KEY` mandatory or omits the new backend selection.
- [ ] Do not edit real `.env` files or commit secrets.

### Phase 4 verification

Run from the repository root:

```bash
rg "OPENAI_API_KEY|AiApproverOpenAIClient|OpenAI|USE_OPEN_AI_API|AI_APPROVER_CODEX_TIMEOUT_SECONDS|codex" worker-python/AGENTS.md worker-python/README.md worker-python/docs/20260502_HOW_TO_USE_AI_APPROVER.md worker-python/.env.example
```

Confirm the docs no longer contradict the new default backend. Then run from `worker-python/`:

```bash
pytest tests/unit/ai_approver tests/integration/test_ai_approver_routes.py
```

If any test fails, fix the implementation and rerun the command. After the phase passes, check off completed Phase 4 tasks and commit only the related changes.

Suggested commit title:

```text
docs: document ai approver codex backend
```

Include a body noting env selection, startup behavior, and migration impact.

## Phase 5 - Manual Codex CLI validation

- [ ] In an operator environment with the Codex CLI installed and authenticated, verify the default CLI path manually.
- [ ] Confirm `codex` resolves from the same environment used to run worker-python:

```bash
which codex
codex --version
```

- [ ] Run one minimal `codex exec` call using the default model name from the plan:

```bash
tmpfile="$(mktemp)"
codex exec --ephemeral --skip-git-repo-check -s read-only \
  --output-last-message "$tmpfile" -m gpt-4o-mini \
  'Return only JSON: {"score": 1, "reason": "manual validation"}'
cat "$tmpfile"
rm -f "$tmpfile"
```

- [ ] If the Codex CLI rejects `gpt-4o-mini`, document in `worker-python/AGENTS.md` and `worker-python/README.md` that operators must set `AI_APPROVER_MODEL_NAME` to a Codex-supported model for CLI mode.
- [ ] If the manual command works, document that the default model was manually validated with the current CLI/login environment.
- [ ] Do not run a real AI approver database job unless the operator explicitly requests it.

### Phase 5 verification

Run from `worker-python/` after any manual-validation doc update:

```bash
pytest tests/unit/ai_approver tests/integration/test_ai_approver_routes.py
make test
```

If any test fails, fix the implementation and rerun `make test`. After the phase passes, check off completed Phase 5 tasks and commit only the related changes.

Suggested commit title:

```text
docs: record codex cli validation
```

If no files changed during manual validation, no commit is required. Instead, report the exact Codex CLI version, model tested, and validation result to the operator.

## Final implementation verification

- [ ] From `worker-python/`, run:

```bash
make test
```

- [ ] If available in the environment, run any existing formatting or lint command documented by the package. Do not invent new tooling.
- [ ] Confirm `git status --short` contains only intentional implementation, test, and documentation changes.
- [ ] Confirm no `.env` files, secrets, lockfiles, package files, unrelated docs, or unrelated source files changed.
- [ ] Confirm all completed TODO checkboxes are checked before the final implementation handoff.
- [ ] Provide the operator with:
  - [ ] Test commands run and results.
  - [ ] Commit hashes or note if commits were not requested/performed.
  - [ ] Manual Codex CLI validation result, including whether the default `gpt-4o-mini` model was accepted.
  - [ ] Any deployment note needed for environments that should remain on OpenAI API mode.
