from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.modules.ai_approver.client import (
    AiApproverCodexCliClient,
    AiApproverOpenAIClient,
    create_ai_approver_client,
)
from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.errors import AiApproverProcessorError


def _make_config(**overrides: object) -> AiApproverConfig:
    values: dict[str, object] = {
        "pg_host": "localhost",
        "pg_port": 5432,
        "pg_database": "test_db",
        "pg_user": "nick",
        "pg_password": "",
        "openai_api_key": "secret",
        "model_name": "gpt-4o-mini",
        "batch_size": 10,
        "default_mode": "legacy",
        "gatekeeper_reject_confidence_threshold": 0.85,
        "use_open_ai_api": False,
        "codex_timeout_seconds": 180,
    }
    values.update(overrides)
    return AiApproverConfig(**values)  # type: ignore[arg-type]


def _output_path_from_cmd(cmd: list[str]) -> str:
    return cmd[cmd.index("--output-last-message") + 1]


def _fake_run_writing(output_content: str, returncode: int = 0, stdout: str = "", stderr: str = ""):
    calls: list[dict[str, object]] = []

    def fake_run(cmd, **kwargs):
        calls.append({"cmd": cmd, **kwargs})
        Path(_output_path_from_cmd(cmd)).write_text(output_content, encoding="utf-8")
        return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=stderr)

    return fake_run, calls


def test_codex_client_success_builds_expected_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _make_config(codex_timeout_seconds=45)
    fake_run, calls = _fake_run_writing('{"score": 3, "reason": "on topic"}')
    monkeypatch.setattr("src.modules.ai_approver.client.subprocess.run", fake_run)

    result = AiApproverCodexCliClient(config).score_article("prompt text")

    assert result == {"payload": {"score": 3, "reason": "on topic"}, "usage": {}}
    assert len(calls) == 1
    cmd = calls[0]["cmd"]
    assert cmd[:2] == ["codex", "exec"]
    assert "--ephemeral" in cmd
    assert "--skip-git-repo-check" in cmd
    assert cmd[cmd.index("-s") + 1] == "read-only"
    assert "--output-last-message" in cmd
    assert cmd[cmd.index("-m") + 1] == "gpt-4o-mini"
    assert cmd[-1] == "prompt text"
    assert calls[0]["cwd"] == tempfile.gettempdir()
    assert calls[0]["timeout"] == 45


def test_codex_client_parses_fenced_output(monkeypatch: pytest.MonkeyPatch) -> None:
    fenced = 'Here is the result:\n```json\n{"decision": "pass", "confidence": 0.9, "reason": "ok"}\n```\n'
    fake_run, _calls = _fake_run_writing(fenced)
    monkeypatch.setattr("src.modules.ai_approver.client.subprocess.run", fake_run)

    result = AiApproverCodexCliClient(_make_config()).score_article("prompt")

    assert result["payload"] == {"decision": "pass", "confidence": 0.9, "reason": "ok"}


def test_codex_client_raises_on_nonzero_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_run, _calls = _fake_run_writing("", returncode=2, stdout="boom-out", stderr="boom-err")
    monkeypatch.setattr("src.modules.ai_approver.client.subprocess.run", fake_run)

    with pytest.raises(AiApproverProcessorError) as exc_info:
        AiApproverCodexCliClient(_make_config()).score_article("prompt")

    message = str(exc_info.value)
    assert "exit code 2" in message
    assert "boom-err" in message


def test_codex_client_raises_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    monkeypatch.setattr("src.modules.ai_approver.client.subprocess.run", fake_run)

    with pytest.raises(AiApproverProcessorError) as exc_info:
        AiApproverCodexCliClient(_make_config(codex_timeout_seconds=7)).score_article("prompt")

    assert "timed out after 7s" in str(exc_info.value)


def test_codex_client_raises_on_empty_output(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_run, _calls = _fake_run_writing("   \n")
    monkeypatch.setattr("src.modules.ai_approver.client.subprocess.run", fake_run)

    with pytest.raises(AiApproverProcessorError) as exc_info:
        AiApproverCodexCliClient(_make_config()).score_article("prompt")

    assert "empty output" in str(exc_info.value)


def test_codex_client_raises_on_unparseable_output(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_run, _calls = _fake_run_writing("sorry, no json here")
    monkeypatch.setattr("src.modules.ai_approver.client.subprocess.run", fake_run)

    with pytest.raises(AiApproverProcessorError) as exc_info:
        AiApproverCodexCliClient(_make_config()).score_article("prompt")

    assert "not a JSON object" in str(exc_info.value)


def test_factory_selects_openai_client_when_flag_true_with_key() -> None:
    config = _make_config(use_open_ai_api=True, openai_api_key="secret")

    assert isinstance(create_ai_approver_client(config), AiApproverOpenAIClient)


def test_factory_selects_codex_client_when_flag_true_without_key() -> None:
    config = _make_config(use_open_ai_api=True, openai_api_key="")

    assert isinstance(create_ai_approver_client(config), AiApproverCodexCliClient)


def test_factory_selects_codex_client_by_default_even_with_key() -> None:
    config = _make_config(use_open_ai_api=False, openai_api_key="secret")

    assert isinstance(create_ai_approver_client(config), AiApproverCodexCliClient)
