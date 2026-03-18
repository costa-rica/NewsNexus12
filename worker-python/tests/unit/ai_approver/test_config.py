from __future__ import annotations

import pytest

from src.modules.ai_approver.config import AiApproverConfig, validate_ai_approver_startup_env
from src.modules.ai_approver.errors import AiApproverConfigError


def test_from_env_reads_required_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH_DATABASE", "/tmp")
    monkeypatch.setenv("NAME_DB", "test.db")
    monkeypatch.setenv("OPENAI_API_KEY", "secret")

    config = AiApproverConfig.from_env()

    assert config.sqlite_path == "/tmp/test.db"
    assert config.model_name == "gpt-4o-mini"


def test_validate_startup_env_requires_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH_DATABASE", "/tmp")
    monkeypatch.setenv("NAME_DB", "test.db")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(AiApproverConfigError):
        validate_ai_approver_startup_env()
