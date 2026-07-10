---
created_at: 2026-07-09
updated_at: 2026-07-09
created_by: codex (gpt-5)
modified_by: codex (gpt-5)
---

# assessment: worker-python codex cli plan v01

## qualifying concerns

1. The plan will likely break worker-python test collection/CI unless it updates the test bootstrap environment.

   Evidence: `worker-python/tests/conftest.py` imports `src.main` at module import time after setting `OPENAI_API_KEY`, but it does not set `USE_OPEN_AI_API`. `worker-python/src/main.py` calls `validate_ai_approver_startup_env()` during import. Under the plan's default selection rule, `USE_OPEN_AI_API` unset means Codex CLI, so startup validation will call `shutil.which("codex")` and fail anywhere the Codex CLI is not installed on `PATH`. The plan mentions monkeypatching `shutil.which` in config tests, but that cannot protect the initial `src.main` import performed by `tests/conftest.py`.

   Action: include an explicit test-bootstrap change, such as setting `USE_OPEN_AI_API=true` in `worker-python/tests/conftest.py` before importing `src.main`, or otherwise bypassing Codex binary validation for the test environment. Keep route/config tests that exercise the Codex default isolated with per-test monkeypatching.
