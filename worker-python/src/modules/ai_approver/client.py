"""Scoring client wrappers for the AI approver workflow."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from typing import Any

from loguru import logger

from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.errors import AiApproverProcessorError


_ERROR_OUTPUT_TAIL_CHARS = 400


class AiApproverOpenAIClient:
    def __init__(self, config: AiApproverConfig) -> None:
        self.config = config

    def score_article(self, prompt: str) -> dict[str, Any]:
        from openai import OpenAI  # Imported lazily so tests/builds don't require runtime import until used.

        client = OpenAI(api_key=self.config.openai_api_key)
        response = client.chat.completions.create(
            model=self.config.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )

        raw_content = response.choices[0].message.content if response.choices else None
        if not raw_content:
            raise RuntimeError("No response content from OpenAI")

        payload = json.loads(raw_content)
        usage = getattr(response, "usage", None)

        return {
            "payload": payload,
            "usage": {
                "prompt_tokens": getattr(usage, "prompt_tokens", None),
                "completion_tokens": getattr(usage, "completion_tokens", None),
                "total_tokens": getattr(usage, "total_tokens", None),
            }
            if usage is not None
            else {},
        }


def _output_tail(stdout: str | None, stderr: str | None) -> str:
    combined = " ".join(part.strip() for part in (stdout, stderr) if part and part.strip())
    return combined[-_ERROR_OUTPUT_TAIL_CHARS:]


def _parse_json_object(raw_content: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError:
        parsed = None

    if parsed is None:
        start = raw_content.find("{")
        end = raw_content.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            parsed = json.loads(raw_content[start : end + 1])
        except json.JSONDecodeError:
            return None

    return parsed if isinstance(parsed, dict) else None


class AiApproverCodexCliClient:
    def __init__(self, config: AiApproverConfig) -> None:
        self.config = config

    def score_article(self, prompt: str) -> dict[str, Any]:
        output_fd, output_path = tempfile.mkstemp(prefix="ai-approver-codex-", suffix=".txt")
        os.close(output_fd)
        try:
            cmd = [
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
                prompt,
            ]

            try:
                # Neutral cwd keeps codex from ingesting repository context into the session.
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.config.codex_timeout_seconds,
                    cwd=tempfile.gettempdir(),
                )
            except subprocess.TimeoutExpired as exc:
                raise AiApproverProcessorError(
                    f"codex exec timed out after {self.config.codex_timeout_seconds}s"
                ) from exc

            if proc.returncode != 0:
                raise AiApproverProcessorError(
                    f"codex exec failed with exit code {proc.returncode}: "
                    + _output_tail(proc.stdout, proc.stderr)
                )

            try:
                with open(output_path, encoding="utf-8") as output_file:
                    raw_content = output_file.read().strip()
            except OSError as exc:
                raise AiApproverProcessorError(
                    "codex exec output file could not be read: "
                    + _output_tail(proc.stdout, proc.stderr)
                ) from exc

            if not raw_content:
                raise AiApproverProcessorError(
                    "codex exec produced empty output: "
                    + _output_tail(proc.stdout, proc.stderr)
                )

            payload = _parse_json_object(raw_content)
            if payload is None:
                raise AiApproverProcessorError(
                    "codex exec output is not a JSON object: "
                    + raw_content[-_ERROR_OUTPUT_TAIL_CHARS:]
                )

            return {"payload": payload, "usage": {}}
        finally:
            try:
                os.remove(output_path)
            except OSError:
                pass


def create_ai_approver_client(
    config: AiApproverConfig,
) -> AiApproverOpenAIClient | AiApproverCodexCliClient:
    backend = "codex_cli" if config.use_codex_cli else "openai_api"
    logger.info(
        "event=ai_approver_backend_selected backend={} model={}",
        backend,
        config.model_name,
    )
    if config.use_codex_cli:
        return AiApproverCodexCliClient(config)
    return AiApproverOpenAIClient(config)
