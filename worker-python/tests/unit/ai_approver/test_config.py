from __future__ import annotations

import pytest

from src.modules.ai_approver.config import AiApproverConfig, validate_ai_approver_startup_env
from src.modules.ai_approver.errors import AiApproverConfigError


def test_from_env_reads_required_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "test_db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv("OPENAI_API_KEY", "secret")

    config = AiApproverConfig.from_env()

    assert "dbname=test_db" in config.dsn
    assert config.model_name == "gpt-4o-mini"
    assert config.default_mode == "legacy"
    assert config.gatekeeper_reject_confidence_threshold == 0.85


def test_from_env_rejects_invalid_ai_approver_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "test_db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AI_APPROVER_MODE", "invalid")

    with pytest.raises(AiApproverConfigError):
        AiApproverConfig.from_env()


def test_validate_startup_env_requires_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "test_db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(AiApproverConfigError):
        validate_ai_approver_startup_env()
