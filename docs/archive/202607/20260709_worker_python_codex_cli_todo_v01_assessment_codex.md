---
created_at: 2026-07-09
updated_at: 2026-07-09
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# TODO v01 assessment

## Qualifying concerns

1. Phase 1 does not explicitly update an existing integration test that still encodes the old mandatory `OPENAI_API_KEY` startup contract.

   Evidence: `worker-python/tests/integration/test_ai_approver_routes.py` has `test_main_import_fails_when_ai_approver_env_missing`, which deletes only `OPENAI_API_KEY` and expects `importlib.reload(src.main)` to raise `SystemExit`. The approved plan changes `OPENAI_API_KEY` to optional and says startup should fall back to Codex CLI when `USE_OPEN_AI_API=true` but the key is missing. After implementation, this test becomes host-dependent: it may still fail startup when `codex` is absent, but it may pass startup when `codex` is installed. The TODO should instruct the implementer to replace or rewrite this integration test with deterministic assertions for the new startup selection behavior, including monkeypatching `shutil.which`.

2. The test bootstrap instruction uses `os.environ.setdefault("USE_OPEN_AI_API", "true")`, which does not guarantee the deterministic CI behavior required by the plan.

   Evidence: the plan's Test and CI bootstrap section says tests must set `USE_OPEN_AI_API=true` before importing `src.main` so ordinary test collection does not require a Codex CLI binary. The TODO's Phase 1 says to add `os.environ.setdefault("USE_OPEN_AI_API", "true")` in `worker-python/tests/conftest.py`. If a developer or CI host already has `USE_OPEN_AI_API=false` in the environment, `setdefault` preserves that value, `src.main` startup validation follows the Codex path, and route/app test collection can fail when `codex` is not on `PATH`. The TODO should require forcing `USE_OPEN_AI_API` to `"true"` for the test bootstrap, or explicitly clearing/overriding host values before importing `src.main`.
