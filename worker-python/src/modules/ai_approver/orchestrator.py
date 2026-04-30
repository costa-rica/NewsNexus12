"""Generic AI approver orchestration."""

from __future__ import annotations

import json
from typing import Any

from src.modules.ai_approver.client import AiApproverOpenAIClient
from src.modules.ai_approver.errors import AiApproverProcessorError
from src.modules.ai_approver.repository import AiApproverRepository


def build_prompt(template: str, article_title: str, article_content: str) -> str:
    return (
        template.replace("{articleTitle}", article_title or "")
        .replace("{articleContent}", article_content or "")
    )


class AiApproverOrchestrator:
    def __init__(
        self,
        repository: AiApproverRepository,
        client: AiApproverOpenAIClient,
    ) -> None:
        self.repository = repository
        self.client = client

    def run_score(
        self,
        *,
        limit: int,
        require_state_assignment: bool,
        state_ids: list[int] | None,
        article_id_min_exclusive: int | None = None,
        article_id_max_inclusive: int | None = None,
        job_id: str | None,
        should_cancel,
    ) -> dict[str, Any]:
        prompt_versions = self.repository.get_active_prompt_versions()
        articles = self.repository.get_eligible_articles(
            limit=limit,
            require_state_assignment=require_state_assignment,
            state_ids=state_ids,
            article_id_min_exclusive=article_id_min_exclusive,
            article_id_max_inclusive=article_id_max_inclusive,
        )

        usage_totals = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }
        attempts = 0

        for article in articles:
            for prompt_version in prompt_versions:
                if should_cancel():
                    raise RuntimeError("AI approver pipeline cancelled")

                prompt = build_prompt(
                    prompt_version["promptInMarkdown"],
                    article.get("title", ""),
                    article.get("content", ""),
                )

                try:
                    response = self.client.score_article(prompt)
                    payload = response.get("payload", {})
                    usage = response.get("usage", {})
                    for key in usage_totals:
                        value = usage.get(key)
                        if isinstance(value, int):
                            usage_totals[key] += value

                    score = payload.get("score")
                    reason = payload.get("reason")
                    if isinstance(score, (int, float)) and isinstance(reason, str) and reason.strip():
                        self.repository.insert_score_row(
                            article_id=int(article["id"]),
                            prompt_version_id=int(prompt_version["id"]),
                            result_status="completed",
                            score=float(score),
                            reason=reason.strip(),
                            error_code=None,
                            error_message=None,
                            job_id=job_id,
                        )
                    else:
                        self.repository.insert_score_row(
                            article_id=int(article["id"]),
                            prompt_version_id=int(prompt_version["id"]),
                            result_status="invalid_response",
                            score=None,
                            reason=None,
                            error_code=str(payload.get("errorCode") or "invalid_response"),
                            error_message=str(
                                payload.get("errorMessage")
                                or f"Unsupported payload: {json.dumps(payload)}"
                            ),
                            job_id=job_id,
                        )
                except Exception as exc:
                    self.repository.insert_score_row(
                        article_id=int(article["id"]),
                        prompt_version_id=int(prompt_version["id"]),
                        result_status="failed",
                        score=None,
                        reason=None,
                        error_code="execution_failed",
                        error_message=str(exc),
                        job_id=job_id,
                    )

                attempts += 1

        return {
            "promptCount": len(prompt_versions),
            "articleCount": len(articles),
            "attemptCount": attempts,
            "usage": usage_totals,
        }

    def run_single_score(
        self,
        *,
        article_id: int,
        prompt_version_id: int,
        job_id: str | None,
        should_cancel,
    ) -> dict[str, Any]:
        if should_cancel():
            raise RuntimeError("AI approver pipeline cancelled")

        prompt_version = self.repository.get_prompt_version_by_id(prompt_version_id)
        if prompt_version is None:
            raise AiApproverProcessorError(
                f"Prompt version {prompt_version_id} was not found"
            )

        article = self.repository.get_article_for_prompt_run(article_id)
        if article is None:
            raise AiApproverProcessorError(f"Article {article_id} was not found")

        usage_totals = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }

        prompt = build_prompt(
            prompt_version["promptInMarkdown"],
            article.get("title", ""),
            article.get("content", ""),
        )

        try:
            response = self.client.score_article(prompt)
            payload = response.get("payload", {})
            usage = response.get("usage", {})
            for key in usage_totals:
                value = usage.get(key)
                if isinstance(value, int):
                    usage_totals[key] += value

            score = payload.get("score")
            reason = payload.get("reason")
            if isinstance(score, (int, float)) and isinstance(reason, str) and reason.strip():
                self.repository.insert_score_row(
                    article_id=article_id,
                    prompt_version_id=prompt_version_id,
                    result_status="completed",
                    score=float(score),
                    reason=reason.strip(),
                    error_code=None,
                    error_message=None,
                    job_id=job_id,
                )
            else:
                self.repository.insert_score_row(
                    article_id=article_id,
                    prompt_version_id=prompt_version_id,
                    result_status="invalid_response",
                    score=None,
                    reason=None,
                    error_code=str(payload.get("errorCode") or "invalid_response"),
                    error_message=str(
                        payload.get("errorMessage")
                        or f"Unsupported payload: {json.dumps(payload)}"
                    ),
                    job_id=job_id,
                )
        except Exception as exc:
            self.repository.insert_score_row(
                article_id=article_id,
                prompt_version_id=prompt_version_id,
                result_status="failed",
                score=None,
                reason=None,
                error_code="execution_failed",
                error_message=str(exc),
                job_id=job_id,
            )

        return {
            "promptCount": 1,
            "articleCount": 1,
            "attemptCount": 1,
            "usage": usage_totals,
            "contentSource": article.get("contentSource", "none"),
        }
