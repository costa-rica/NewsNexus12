---
created_at: 2026-07-09
updated_at: 2026-07-09
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# worker-python ai approver: codex cli default backend (plan v02)

## Requirement

The AI approver in `worker-python` currently scores articles through a single OpenAI API call site. Change it to support two interchangeable backends, with the **Codex CLI as the default**:

- **Codex CLI backend (default)**: shell out to `codex exec` per article, authenticated by the operator's existing Codex CLI login. No API key needed.
- **OpenAI API backend (opt-in)**: the current behavior, selected by a new optional boolean `.env` var `USE_OPEN_AI_API`.

Selection semantics (flag-first, soft fallback):

1. `USE_OPEN_AI_API=true` **and** `OPENAI_API_KEY` set -> OpenAI API.
2. `USE_OPEN_AI_API=true` but `OPENAI_API_KEY` missing -> Codex CLI, with a logged warning (no hard failure).
3. `USE_OPEN_AI_API` unset or `false` -> Codex CLI, regardless of whether a key is present.

Both `USE_OPEN_AI_API` and `OPENAI_API_KEY` become optional. The existing `AI_APPROVER_MODEL_NAME` (default `gpt-4o-mini`) applies to **both** backends: it stays the `model` param on the API path and is passed as `-m <model>` to `codex exec` on the CLI path.

The Codex CLI invocation pattern is proven by the reference script `NewsNexus12-PromptRefining05/prompt_testing_02/run_test.py`.

## Technology overview

- **Existing OpenAI path**: `AiApproverOpenAIClient.score_article(prompt)` in `worker-python/src/modules/ai_approver/client.py`, using `openai.OpenAI().chat.completions.create(...)` with `response_format={"type": "json_object"}`. This class is not modified.
- **New Codex path**: a sibling class `AiApproverCodexCliClient` in the same file, implementing the identical contract `score_article(prompt) -> {"payload": dict, "usage": dict}`, backed by `subprocess.run` of the `codex` CLI.
- **Selection**: a module-level factory `create_ai_approver_client(config)` returns one client or the other. The orchestrator (`AiApproverOrchestrator`) already receives the client by constructor injection and is unchanged.
- **Test bootstrap**: worker-python tests import `src.main` during collection through `tests/conftest.py`, and `src.main` runs startup validation at import time. The test bootstrap must set `USE_OPEN_AI_API=true` before importing `src.main` so normal CI/test collection stays on the existing API backend and does not require a Codex CLI binary on `PATH`.

## Environment variables

| Variable | Status | Default | Meaning |
| --- | --- | --- | --- |
| `USE_OPEN_AI_API` | new, optional | `false` | When true (and a key is present), use the OpenAI API backend; otherwise the Codex CLI. |
| `OPENAI_API_KEY` | now optional | empty | Only consumed by the OpenAI API backend. No longer required at startup. |
| `AI_APPROVER_MODEL_NAME` | existing | `gpt-4o-mini` | Model for both backends: API `model` param and codex `-m` flag. |
| `AI_APPROVER_CODEX_TIMEOUT_SECONDS` | new, optional | `180` | Per-article subprocess timeout for the CLI backend, matching the reference script. |

Boolean parsing replicates the established deduper pattern (`TRUE_VALUES` / `FALSE_VALUES` / `_parse_bool` from `src/modules/deduper/config.py`, lines 11-27) inside the ai_approver config, raising `AiApproverConfigError` on unrecognized values. The deduper module stays untouched; modules in this repo are deliberately self-contained.

## General flow

1. **Startup** (`src/main.py` -> `validate_ai_approver_startup_env()` in `src/modules/ai_approver/config.py`): `OPENAI_API_KEY` is removed from `REQUIRED_STARTUP_ENV_KEYS` (the `PG_*` keys remain; the ai_approver module is the key's only consumer in worker-python). The validator computes the effective backend from `USE_OPEN_AI_API` + key presence. When the effective backend is the Codex CLI, it requires `shutil.which("codex")` to resolve, failing fast at boot with an `AiApproverConfigError` if the binary is missing. When `USE_OPEN_AI_API=true` with no key, it logs the soft-fallback warning.
2. **Config**: `AiApproverConfig.from_env()` no longer raises on a missing `OPENAI_API_KEY`. New dataclass fields: `use_open_ai_api: bool`, `codex_timeout_seconds: int`. A computed property `use_codex_cli` encodes the selection rule: `not (use_open_ai_api and openai_api_key)`. The soft-fallback warning is logged (loguru, already imported there) when `use_open_ai_api` is true but the key is empty.
3. **Job start**: routes (`POST /ai-approver/start-job`, `POST /ai-approver/review-page/start-job` in `src/routes/ai_approver.py`) replace the two direct `AiApproverOpenAIClient(config)` constructions with `create_ai_approver_client(config)`. That import swap plus two call-site changes is the entire route change.
4. **Scoring loop**: unchanged. The orchestrator builds each prompt from `AiApproverPromptVersions.promptInMarkdown` and calls `client.score_article(prompt)`.
5. **Codex invocation** (per article):

   ```bash
   codex exec --ephemeral --skip-git-repo-check -s read-only \
     --output-last-message <tempfile> -m <AI_APPROVER_MODEL_NAME> <prompt as positional arg>
   ```

   via `subprocess.run(cmd, capture_output=True, text=True, timeout=<configured>, cwd=<neutral dir such as tempfile.gettempdir()>)`. The neutral working directory keeps Codex from ingesting repository context (`AGENTS.md`, source files) into the session; `-s read-only` and `--ephemeral` keep each call inert and prevent session-file accumulation.
6. **Output parsing**: the final agent message is read from the `--output-last-message` temp file and parsed with `json.loads`. This is deliberately more robust than the reference script's `stdout.rfind("{")` heuristic, since `codex exec` interleaves banners and progress on stdout. Fallback parse: the slice from the first `{` to the last `}` of the file content (handles fenced or prefixed output). `--output-schema` is intentionally not used: the expected payload shape differs per prompt role (category: `score`/`reason`; gatekeeper: `decision`/`confidence`/`reason`), the prompts already instruct JSON-only output, and the orchestrator already classifies bad shapes as `invalid_response`.
7. **Error mapping** (no orchestrator changes): non-zero exit code, `subprocess.TimeoutExpired`, an empty output file, or an unparseable payload raise `AiApproverProcessorError` (exists in `src/modules/ai_approver/errors.py`) with a truncated stderr/stdout tail in the message. Both orchestrator call sites already catch `Exception` and persist a `failed` row with `error_code="execution_failed"`, so the detail lands in `AiApproverArticleScores.errorMessage`.
8. **Usage tokens**: the Codex client returns `"usage": {}`. The orchestrator's `_add_usage` tolerates missing keys, so job results report zero token usage under this backend.

## Test and CI bootstrap

`worker-python/tests/conftest.py` currently seeds `OPENAI_API_KEY` and then imports `src.main`, which performs startup validation immediately. Because the new default backend is Codex CLI, leaving `USE_OPEN_AI_API` unset in the bootstrap would make test collection fail on CI hosts that do not have the Codex CLI installed.

The implementation must therefore update `tests/conftest.py` before or alongside startup validation changes:

- Set `USE_OPEN_AI_API=true` in the test bootstrap before importing `src.main`.
- Keep the existing fake `OPENAI_API_KEY` in the bootstrap so the effective backend is the OpenAI API path and `validate_ai_approver_startup_env()` never calls `shutil.which("codex")` during ordinary test collection.
- Add a small config/bootstrap test, or extend existing config tests, to pin this contract: with `USE_OPEN_AI_API=true` and `OPENAI_API_KEY` set, startup validation should not require `codex` on `PATH` even if `shutil.which("codex")` returns `None`.
- Keep Codex-default tests isolated inside specific config/client test cases by using per-test `monkeypatch.delenv("USE_OPEN_AI_API", raising=False)` and monkeypatching `shutil.which`. Do not let those tests change the process-wide bootstrap assumptions for unrelated route or Flask app tests.

This preserves production semantics while keeping CI startup validation deterministic without installing the Codex CLI.

## Key functions and files

- `src/modules/ai_approver/config.py` - `_parse_bool` (new), fields `use_open_ai_api` / `codex_timeout_seconds` (new), `use_codex_cli` computed property (new), `from_env()` without the key requirement, reworked `validate_ai_approver_startup_env()`.
- `src/modules/ai_approver/client.py` - `AiApproverCodexCliClient.score_article` (new), `create_ai_approver_client(config)` (new factory), `AiApproverOpenAIClient` unchanged.
- `src/routes/ai_approver.py` - switch the two `AiApproverOpenAIClient(config)` route call sites to the factory; import updated.
- `src/modules/ai_approver/orchestrator.py`, `repository.py` - no changes.
- `tests/conftest.py` - set `USE_OPEN_AI_API=true` before importing `src.main`, while retaining the fake `OPENAI_API_KEY`, so test collection and CI app bootstrap do not depend on Codex CLI being installed.
- `tests/unit/ai_approver/test_client.py` (new or updated) - mocks `subprocess.run`: success payload, non-zero exit, timeout, junk output, `-m` flag content, factory selection across the three env combinations.
- `tests/unit/ai_approver/test_config.py` (updated) - bool parsing (true/false/junk/default), the three selection combinations, soft-fallback warning path; the existing `test_validate_startup_env_requires_openai_key` is replaced by codex-binary validation tests (`shutil.which` monkeypatched), plus a startup validation test proving `USE_OPEN_AI_API=true` with a key bypasses Codex binary validation.
- `worker-python/.env.example` and `worker-python/AGENTS.md` - document the new variables and semantics table, zero usage totals under Codex, and the startup fail-fast when `codex` is not on `PATH`.

## Verification plan

- Run the worker-python test suite after implementation. Test collection must succeed on a machine with no Codex CLI on `PATH` because the test bootstrap selects the OpenAI API path.
- Run focused ai_approver config and client tests to validate selection behavior, Codex command construction, subprocess error mapping, JSON parsing, timeout handling, and the soft-fallback warning.
- Run one manual end-to-end Codex CLI scoring call in an operator environment that has `codex` installed and authenticated, using the default `AI_APPROVER_MODEL_NAME`, to confirm the shared default model is accepted by the CLI. If the CLI rejects the default model, document that the operator must set `AI_APPROVER_MODEL_NAME` to a Codex-supported model.

## Risks and operational notes

- **Default flips for existing deployments**: any current `.env` (which has `OPENAI_API_KEY` but no `USE_OPEN_AI_API`) will silently switch to the Codex CLI after this change. This is the requested behavior, but deployments that must stay on the API need `USE_OPEN_AI_API=true` added before upgrading; call this out in `AGENTS.md` and the commit message.
- **Model availability under Codex**: the shared default `gpt-4o-mini` is an API-era model name; the Codex CLI is typically used with gpt-5-family models and may reject `-m gpt-4o-mini` depending on CLI version and login type. If so, every attempt fails visibly as `failed` rows and the fix is setting `AI_APPROVER_MODEL_NAME` to a Codex-supported model. Verification must include one real end-to-end Codex call with the default model to confirm.
- **Latency**: each `codex exec` spawns a full agent session (typically 10-60 seconds) versus 2-5 seconds per API call. Batch jobs become substantially slower: bounded per article by the timeout and safe under the one-job-at-a-time queue, but operators should not mistake a long-running Codex job for a hang. Since the CLI is now the default, this is the new normal batch speed.
- **PATH under service managers**: `codex` resolves via nvm on the current host. If worker-python runs under launchd/pm2/systemd with a minimal `PATH`, startup validation fails. This is the desired fail-fast behavior, but worth documenting. An `AI_APPROVER_CODEX_PATH` override is the escape hatch if ever needed; it is intentionally excluded from this change.
- **Backend provenance**: `AiApproverArticleScores` rows do not record which backend produced them. Out of scope here; the cheap future fix is an entry in the existing `metadata` Jsonb column (`insert_score_row` already accepts `metadata`).
- **Prompt via argv**: prompts embed full article content; macOS/Linux argv limits (about 256 KB-2 MB) comfortably exceed realistic prompt sizes, matching the proven reference script. Stdin piping is the fallback if this ever becomes a constraint.
