"""Thin OpenAI client wrapper for the AI approver workflow."""

from __future__ import annotations

import json
from typing import Any

from src.modules.ai_approver.config import AiApproverConfig


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
