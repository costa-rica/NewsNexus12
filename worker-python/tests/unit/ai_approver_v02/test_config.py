from __future__ import annotations

import pytest

from src.modules.ai_approver_v02.config import AiApproverV02Config
from src.modules.ai_approver_v02.errors import AiApproverV02ConfigError


def _set_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "newsnexus_test")
    monkeypatch.setenv("PG_USER", "tester")


def test_v02_config_uses_v02_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_postgres(monkeypatch)
    config = AiApproverV02Config.from_env(validate_codex=False)

    assert config.model_name == "gpt-5.4-mini"
    assert config.codex_timeout_seconds == 180
    assert config.expired_preview_retention_days == 7


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS", "0"),
        ("AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS", "-1"),
    ],
)
def test_v02_config_rejects_nonpositive_values(
    monkeypatch: pytest.MonkeyPatch,
    key: str,
    value: str,
) -> None:
    _set_postgres(monkeypatch)
    monkeypatch.setenv(key, value)

    with pytest.raises(AiApproverV02ConfigError):
        AiApproverV02Config.from_env(validate_codex=False)


def test_v02_config_requires_codex(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_postgres(monkeypatch)
    monkeypatch.setattr(
        "src.modules.ai_approver_v02.config.shutil.which",
        lambda _: None,
    )

    with pytest.raises(AiApproverV02ConfigError, match="codex CLI"):
        AiApproverV02Config.from_env()
