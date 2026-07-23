"""Isolated Codex CLI client for AI Approver V02."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile

from src.modules.ai_approver_v02.config import AiApproverV02Config
from src.modules.ai_approver_v02.types import ModelOutcome


def _parse_payload(raw: str) -> ModelOutcome:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return ModelOutcome(
            status="invalid_response",
            error_code="invalid_json",
            error_message="Codex returned an invalid JSON response",
        )

    if not isinstance(payload, dict) or set(payload) != {"decision", "reason"}:
        return ModelOutcome(
            status="invalid_response",
            error_code="invalid_response_shape",
            error_message="Codex response did not match the required schema",
        )

    decision = payload.get("decision")
    reason = payload.get("reason")
    if decision not in {"approved", "irrelevant"}:
        return ModelOutcome(
            status="invalid_response",
            error_code="invalid_decision",
            error_message="Codex returned an unsupported decision",
        )
    if not isinstance(reason, str) or not reason.strip():
        return ModelOutcome(
            status="invalid_response",
            error_code="blank_reason",
            error_message="Codex returned a blank reason",
        )

    return ModelOutcome(
        status="completed",
        prediction=decision,
        reasoning=reason.strip(),
    )


class AiApproverV02CodexClient:
    def __init__(self, config: AiApproverV02Config) -> None:
        self.config = config

    def evaluate(self, rendered_prompt: str) -> ModelOutcome:
        output_fd, output_path = tempfile.mkstemp(
            prefix="ai-approver-v02-",
            suffix=".json",
        )
        os.close(output_fd)

        try:
            command = [
                "codex",
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "-s",
                "read-only",
                "--output-last-message",
                output_path,
                "-m",
                self.config.model_name,
                rendered_prompt,
            ]
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=self.config.codex_timeout_seconds,
                    cwd=tempfile.gettempdir(),
                    check=False,
                )
            except subprocess.TimeoutExpired:
                return ModelOutcome(
                    status="failed",
                    error_code="codex_timeout",
                    error_message="Codex execution timed out",
                )
            except OSError:
                return ModelOutcome(
                    status="failed",
                    error_code="codex_process_error",
                    error_message="Codex execution could not start",
                )

            if result.returncode != 0:
                return ModelOutcome(
                    status="failed",
                    error_code="codex_exit_error",
                    error_message=f"Codex execution failed with exit code {result.returncode}",
                )

            try:
                with open(output_path, encoding="utf-8") as output_file:
                    raw = output_file.read().strip()
            except OSError:
                return ModelOutcome(
                    status="failed",
                    error_code="codex_output_error",
                    error_message="Codex output could not be read",
                )

            return _parse_payload(raw)
        finally:
            try:
                os.remove(output_path)
            except OSError:
                pass
