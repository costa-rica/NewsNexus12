from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import pytest
from loguru import logger

from src.modules.ai_approver.config import AiApproverConfig, validate_ai_approver_startup_env
from src.modules.ai_approver.errors import AiApproverConfigError


def _set_pg_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "test_db")
    monkeypatch.setenv("PG_USER", "nick")


@contextmanager
def _capture_warnings() -> Iterator[list[str]]:
    messages: list[str] = []
    handler_id = logger.add(lambda message: messages.append(str(message)), level="WARNING")
    try:
        yield messages
    finally:
        logger.remove(handler_id)


def test_from_env_reads_required_values(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    # Assertions below cover defaults; the developer .env (loaded by the test
    # bootstrap) may override these optional vars, so clear them here.
    monkeypatch.delenv("AI_APPROVER_MODEL_NAME", raising=False)
    monkeypatch.delenv("AI_APPROVER_MODE", raising=False)
    monkeypatch.delenv("AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD", raising=False)
    monkeypatch.delenv("AI_APPROVER_CODEX_TIMEOUT_SECONDS", raising=False)

    config = AiApproverConfig.from_env()

    assert "dbname=test_db" in config.dsn
    assert config.model_name == "gpt-4o-mini"
    assert config.default_mode == "legacy"
    assert config.gatekeeper_reject_confidence_threshold == 0.85
    assert config.codex_timeout_seconds == 180


def test_from_env_rejects_invalid_ai_approver_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AI_APPROVER_MODE", "invalid")

    with pytest.raises(AiApproverConfigError):
        AiApproverConfig.from_env()


def test_from_env_defaults_to_codex_cli_when_flag_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.delenv("USE_OPEN_AI_API", raising=False)

    config = AiApproverConfig.from_env()

    assert config.use_open_ai_api is False
    assert config.use_codex_cli is True


def test_from_env_uses_codex_cli_when_flag_false(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("USE_OPEN_AI_API", "false")

    config = AiApproverConfig.from_env()

    assert config.use_open_ai_api is False
    assert config.use_codex_cli is True


def test_from_env_selects_openai_api_when_flag_true_with_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("USE_OPEN_AI_API", "true")

    config = AiApproverConfig.from_env()

    assert config.use_open_ai_api is True
    assert config.use_codex_cli is False


def test_from_env_soft_falls_back_to_codex_without_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("USE_OPEN_AI_API", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with _capture_warnings() as warnings:
        config = AiApproverConfig.from_env()

    assert config.use_open_ai_api is True
    assert config.use_codex_cli is True
    assert any("ai_approver_openai_key_missing" in message for message in warnings)


def test_from_env_rejects_invalid_use_open_ai_api(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("USE_OPEN_AI_API", "maybe")

    with pytest.raises(AiApproverConfigError):
        AiApproverConfig.from_env()


def test_from_env_codex_timeout_override(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AI_APPROVER_CODEX_TIMEOUT_SECONDS", "45")

    config = AiApproverConfig.from_env()

    assert config.codex_timeout_seconds == 45


@pytest.mark.parametrize("value", ["not-a-number", "0", "-5"])
def test_from_env_rejects_invalid_codex_timeout(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("AI_APPROVER_CODEX_TIMEOUT_SECONDS", value)

    with pytest.raises(AiApproverConfigError):
        AiApproverConfig.from_env()


def test_validate_startup_env_requires_postgres_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.delenv("PG_HOST", raising=False)

    with pytest.raises(AiApproverConfigError):
        validate_ai_approver_startup_env()


def test_validate_startup_env_api_backend_skips_codex_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("USE_OPEN_AI_API", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setattr("src.modules.ai_approver.config.shutil.which", lambda name: None)

    validate_ai_approver_startup_env()


def test_validate_startup_env_default_backend_requires_codex(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.delenv("USE_OPEN_AI_API", raising=False)
    monkeypatch.setattr("src.modules.ai_approver.config.shutil.which", lambda name: None)

    with pytest.raises(AiApproverConfigError):
        validate_ai_approver_startup_env()


def test_validate_startup_env_default_backend_passes_with_codex(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.delenv("USE_OPEN_AI_API", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        "src.modules.ai_approver.config.shutil.which",
        lambda name: "/usr/local/bin/codex",
    )

    validate_ai_approver_startup_env()


def test_validate_startup_env_soft_fallback_requires_codex(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("USE_OPEN_AI_API", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("src.modules.ai_approver.config.shutil.which", lambda name: None)

    with _capture_warnings() as warnings:
        with pytest.raises(AiApproverConfigError):
            validate_ai_approver_startup_env()

    assert any("ai_approver_openai_key_missing" in message for message in warnings)


def test_validate_startup_env_soft_fallback_passes_with_codex(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_pg_env(monkeypatch)
    monkeypatch.setenv("USE_OPEN_AI_API", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        "src.modules.ai_approver.config.shutil.which",
        lambda name: "/usr/local/bin/codex",
    )

    with _capture_warnings() as warnings:
        validate_ai_approver_startup_env()

    assert any("ai_approver_openai_key_missing" in message for message in warnings)
