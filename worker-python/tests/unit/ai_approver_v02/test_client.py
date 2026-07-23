from __future__ import annotations

import os
import subprocess

from src.modules.ai_approver_v02.client import (
    AiApproverV02CodexClient,
    _parse_payload,
)
from src.modules.ai_approver_v02.config import AiApproverV02Config


def _config() -> AiApproverV02Config:
    return AiApproverV02Config(
        pg_host="localhost",
        pg_port=5432,
        pg_database="test",
        pg_user="test",
        pg_password="",
        codex_timeout_seconds=3,
    )


def test_parser_requires_exact_schema() -> None:
    completed = _parse_payload('{"decision":"approved","reason":"Relevant."}')
    extra = _parse_payload(
        '{"decision":"approved","reason":"Relevant.","extra":true}'
    )
    malformed = _parse_payload("not json")

    assert completed.status == "completed"
    assert completed.prediction == "approved"
    assert extra.status == "invalid_response"
    assert malformed.status == "invalid_response"


def test_client_uses_isolated_cli_and_removes_output(
    monkeypatch,
) -> None:
    observed: dict[str, object] = {}

    def fake_run(command, **kwargs):
        output_path = command[command.index("--output-last-message") + 1]
        observed["output_path"] = output_path
        observed["command"] = command
        observed["kwargs"] = kwargs
        with open(output_path, "w", encoding="utf-8") as output:
            output.write('{"decision":"irrelevant","reason":"Not relevant."}')
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(
        "src.modules.ai_approver_v02.client.subprocess.run",
        fake_run,
    )
    outcome = AiApproverV02CodexClient(_config()).evaluate("sensitive article")

    assert outcome.status == "completed"
    assert outcome.prediction == "irrelevant"
    assert "-s" in observed["command"]
    assert "read-only" in observed["command"]
    assert not os.path.exists(str(observed["output_path"]))


def test_client_redacts_prompt_from_process_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.modules.ai_approver_v02.client.subprocess.run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0],
            1,
            "sensitive title",
            "sensitive content",
        ),
    )

    outcome = AiApproverV02CodexClient(_config()).evaluate("sensitive prompt")

    assert outcome.status == "failed"
    assert "sensitive" not in (outcome.error_message or "")


def test_client_cleans_output_after_timeout(monkeypatch) -> None:
    observed: dict[str, str] = {}

    def timeout(command, **kwargs):
        observed["output_path"] = command[
            command.index("--output-last-message") + 1
        ]
        raise subprocess.TimeoutExpired(command, 3)

    monkeypatch.setattr(
        "src.modules.ai_approver_v02.client.subprocess.run",
        timeout,
    )
    outcome = AiApproverV02CodexClient(_config()).evaluate("article")

    assert outcome.status == "failed"
    assert outcome.error_code == "codex_timeout"
    assert not os.path.exists(observed["output_path"])
