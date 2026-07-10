---
created_at: 2026-07-09
updated_at: 2026-07-09
created_by: claude
modified_by: claude
---

# assessment: worker-python codex cli todo v02

## qualifying concerns

1. The todo drops the plan's per-test `USE_OPEN_AI_API` isolation requirement, and the conftest bootstrap it adds makes that omission actively confusing for several tasks it mandates.

   Evidence: plan v02 ("Test and CI bootstrap", fourth bullet) explicitly requires keeping Codex-default tests isolated "by using per-test `monkeypatch.delenv("USE_OPEN_AI_API", raising=False)`". Todo v02 never mentions `delenv` or any equivalent isolation step. Meanwhile Phase 1 correctly forces `os.environ["USE_OPEN_AI_API"] = "true"` process-wide in `worker-python/tests/conftest.py`, which means the "unset" scenarios the todo requires cannot be exercised without explicitly removing that value per test:

   - Phase 1: "Cover default selection: `USE_OPEN_AI_API` unset or false means Codex CLI, even if `OPENAI_API_KEY` is set" — with the forced bootstrap, `from_env()` will read `"true"` unless the test deletes the variable, so a test written literally against "unset" will assert the wrong backend and fail.
   - Phase 2: "Cover factory selection for the three required combinations", including "`USE_OPEN_AI_API` unset or false -> Codex client" — same problem if the test builds config via `AiApproverConfig.from_env()`; the todo also does not say whether these combinations should be produced via monkeypatched env + `from_env()` or by constructing `AiApproverConfig` directly, leaving the isolation requirement implicit.

   The failure mode is loud (the tests fail), but the plausible wrong fix is the dangerous part: an implementing agent that does not know the plan's isolation rule may "repair" the conflict by weakening or removing the forced conftest assignment — precisely the regression the plan v01 assessment and todo v01 assessment loops existed to prevent (test collection breaking on hosts without the Codex CLI on `PATH`).

   Action: add explicit sub-tasks to Phase 1 (test_config) and Phase 2 (test_client): any test exercising the "unset" or "false" selection state must use `monkeypatch.delenv("USE_OPEN_AI_API", raising=False)` or `monkeypatch.setenv("USE_OPEN_AI_API", "false")` (plus required `PG_*` env when calling `from_env()`), and must not modify `tests/conftest.py`'s forced `USE_OPEN_AI_API=true` bootstrap. State that constructing `AiApproverConfig` directly is an acceptable alternative for factory-selection tests.

## verified without concern (for the record)

- Route integration tests stub `create_ai_approver_runner` / `create_review_page_ai_approver_runner` on the routes module, not `AiApproverOpenAIClient`, so the Phase 3 factory swap does not break them.
- `AiApproverProcessorError` exists in `src/modules/ai_approver/errors.py` as the todo assumes.
- The Phase 1 rewrite of `test_main_import_fails_when_ai_approver_env_missing` matches the actual current test (deletes only `OPENAI_API_KEY`, expects `SystemExit` on `importlib.reload`) and both prior assessment concerns (deterministic `shutil.which` monkeypatching, forced rather than `setdefault` bootstrap) are addressed.
- `make test`, the Phase 3/5 verification commands, and all referenced test files exist as named. The `use_codex_cli` computed property is compatible with the `slots=True` dataclass. `dotenv.load_dotenv` does not override already-set env vars, so the forced conftest value survives a developer `.env` containing `USE_OPEN_AI_API=false`.
