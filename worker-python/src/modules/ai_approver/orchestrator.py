"""Generic AI approver orchestration."""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
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

    def _empty_usage_totals(self) -> dict[str, int]:
        return {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }

    def _add_usage(self, usage_totals: dict[str, int], usage: dict[str, Any]) -> None:
        for key in usage_totals:
            value = usage.get(key)
            if isinstance(value, int):
                usage_totals[key] += value

    def _parse_category_payload(
        self,
        payload: dict[str, Any],
    ) -> tuple[str, float | None, str | None, str | None, str | None]:
        score = payload.get("score")
        reason = payload.get("reason")
        if isinstance(score, (int, float)) and isinstance(reason, str) and reason.strip():
            return "completed", float(score), reason.strip(), None, None

        return (
            "invalid_response",
            None,
            None,
            str(payload.get("errorCode") or "invalid_response"),
            str(payload.get("errorMessage") or f"Unsupported payload: {json.dumps(payload)}"),
        )

    def _parse_gatekeeper_payload(
        self,
        payload: dict[str, Any],
        *,
        reject_confidence_threshold: float,
    ) -> dict[str, Any]:
        decision = payload.get("decision")
        confidence = payload.get("confidence")
        reason = payload.get("reason")
        reason_code = payload.get("reasonCode")
        signals = payload.get("signals")

        if (
            decision not in ("pass", "reject", "manual_review")
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or float(confidence) < 0
            or float(confidence) > 1
            or not isinstance(reason, str)
            or not reason.strip()
        ):
            return {
                "result_status": "invalid_response",
                "decision": "error",
                "confidence": None,
                "reason": None,
                "reason_code": None,
                "error_code": str(payload.get("errorCode") or "invalid_response"),
                "error_message": str(
                    payload.get("errorMessage")
                    or f"Unsupported gatekeeper payload: {json.dumps(payload)}"
                ),
                "metadata": {"rawPayload": payload},
            }

        normalized_decision = str(decision)
        normalized_confidence = float(confidence)
        if normalized_decision == "reject" and normalized_confidence < reject_confidence_threshold:
            normalized_decision = "manual_review"

        metadata: dict[str, Any] = {
            "rawDecision": decision,
            "rejectConfidenceThreshold": reject_confidence_threshold,
        }
        if isinstance(signals, dict):
            metadata["signals"] = signals

        return {
            "result_status": "completed",
            "decision": normalized_decision,
            "confidence": normalized_confidence,
            "reason": reason.strip(),
            "reason_code": reason_code.strip()
            if isinstance(reason_code, str) and reason_code.strip()
            else None,
            "error_code": None,
            "error_message": None,
            "metadata": metadata,
        }

    def _should_run_categories(
        self,
        *,
        mode: str,
        gatekeeper_result: dict[str, Any] | None,
    ) -> bool:
        if mode in ("legacy", "shadow"):
            return True
        if gatekeeper_result is None:
            return False
        return (
            gatekeeper_result.get("resultStatus") == "completed"
            and gatekeeper_result.get("decision") == "pass"
        )

    def _build_retry_metadata(
        self,
        *,
        retry_score_row: dict[str, Any] | None,
        job_id: str | None,
        metadata: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if retry_score_row is None:
            return metadata

        return {
            **(metadata or {}),
            "continuationRetryAudit": {
                "previousStatus": retry_score_row.get("previousResultStatus"),
                "previousErrorCode": retry_score_row.get("previousErrorCode"),
                "previousErrorMessage": retry_score_row.get("previousErrorMessage"),
                "sourceJobId": retry_score_row.get("previousJobId"),
                "continuationJobId": job_id,
                "retriedAt": datetime.now(UTC).isoformat(),
                "previousMetadata": retry_score_row.get("previousMetadata"),
            },
        }

    def _write_score_row(
        self,
        *,
        retry_score_row: dict[str, Any] | None,
        article_id: int,
        prompt_version_id: int,
        result_status: str,
        score: float | None,
        reason: str | None,
        error_code: str | None,
        error_message: str | None,
        job_id: str | None,
        prompt_role: str,
        pipeline_version: str | None,
        decision: str | None = None,
        confidence: float | None = None,
        reason_code: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        write_metadata = self._build_retry_metadata(
            retry_score_row=retry_score_row,
            job_id=job_id,
            metadata=metadata,
        )
        if retry_score_row is None:
            self.repository.insert_score_row(
                article_id=article_id,
                prompt_version_id=prompt_version_id,
                result_status=result_status,
                score=score,
                reason=reason,
                error_code=error_code,
                error_message=error_message,
                job_id=job_id,
                prompt_role=prompt_role,
                pipeline_version=pipeline_version,
                decision=decision,
                confidence=confidence,
                reason_code=reason_code,
                metadata=write_metadata,
            )
            return

        self.repository.update_score_row(
            score_row_id=int(retry_score_row["scoreRowId"]),
            result_status=result_status,
            score=score,
            reason=reason,
            error_code=error_code,
            error_message=error_message,
            job_id=job_id,
            prompt_role=prompt_role,
            pipeline_version=pipeline_version,
            decision=decision,
            confidence=confidence,
            reason_code=reason_code,
            metadata=write_metadata,
        )

    def _run_category_prompt_for_article(
        self,
        *,
        article: dict[str, Any],
        prompt_version: dict[str, Any],
        usage_totals: dict[str, int],
        job_id: str | None,
        retry_score_row: dict[str, Any] | None = None,
    ) -> None:
        prompt_role = prompt_version.get("promptRole") or "category_score"
        prompt = build_prompt(
            prompt_version["promptInMarkdown"],
            article.get("title", ""),
            article.get("content", ""),
        )

        try:
            response = self.client.score_article(prompt)
            payload = response.get("payload", {})
            self._add_usage(usage_totals, response.get("usage", {}))
            result_status, score, reason, error_code, error_message = (
                self._parse_category_payload(payload)
            )
            self._write_score_row(
                retry_score_row=retry_score_row,
                article_id=int(article["id"]),
                prompt_version_id=int(prompt_version["id"]),
                result_status=result_status,
                score=score,
                reason=reason,
                error_code=error_code,
                error_message=error_message,
                job_id=job_id,
                prompt_role=prompt_role,
                pipeline_version=prompt_version.get("pipelineVersion"),
            )
        except Exception as exc:
            self._write_score_row(
                retry_score_row=retry_score_row,
                article_id=int(article["id"]),
                prompt_version_id=int(prompt_version["id"]),
                result_status="failed",
                score=None,
                reason=None,
                error_code="execution_failed",
                error_message=str(exc),
                job_id=job_id,
                prompt_role=prompt_role,
                pipeline_version=prompt_version.get("pipelineVersion"),
            )

    def _run_gatekeeper_for_article(
        self,
        *,
        article: dict[str, Any],
        prompt_version: dict[str, Any],
        usage_totals: dict[str, int],
        job_id: str | None,
        reject_confidence_threshold: float,
        retry_score_row: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        prompt = build_prompt(
            prompt_version["promptInMarkdown"],
            article.get("title", ""),
            article.get("content", ""),
        )

        try:
            response = self.client.score_article(prompt)
            payload = response.get("payload", {})
            self._add_usage(usage_totals, response.get("usage", {}))
            parsed = self._parse_gatekeeper_payload(
                payload,
                reject_confidence_threshold=reject_confidence_threshold,
            )
            self._write_score_row(
                retry_score_row=retry_score_row,
                article_id=int(article["id"]),
                prompt_version_id=int(prompt_version["id"]),
                result_status=parsed["result_status"],
                score=None,
                reason=parsed["reason"],
                error_code=parsed["error_code"],
                error_message=parsed["error_message"],
                job_id=job_id,
                prompt_role="gatekeeper",
                pipeline_version=prompt_version.get("pipelineVersion"),
                decision=parsed["decision"],
                confidence=parsed["confidence"],
                reason_code=parsed["reason_code"],
                metadata=parsed["metadata"],
            )
            return {
                "resultStatus": parsed["result_status"],
                "decision": parsed["decision"],
                "confidence": parsed["confidence"],
            }
        except Exception as exc:
            self._write_score_row(
                retry_score_row=retry_score_row,
                article_id=int(article["id"]),
                prompt_version_id=int(prompt_version["id"]),
                result_status="failed",
                score=None,
                reason=None,
                error_code="execution_failed",
                error_message=str(exc),
                job_id=job_id,
                prompt_role="gatekeeper",
                pipeline_version=prompt_version.get("pipelineVersion"),
                decision="error",
                metadata={"errorType": exc.__class__.__name__},
            )
            return {
                "resultStatus": "failed",
                "decision": "error",
                "confidence": None,
            }

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
        mode: str = "legacy",
        gatekeeper_reject_confidence_threshold: float = 0.85,
        continuation_retry_policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        category_prompt_versions = self.repository.get_active_category_prompt_versions()
        gatekeeper_prompt_version = None
        if mode != "legacy":
            gatekeeper_prompt_version = self.repository.get_active_gatekeeper_prompt_version()
            if gatekeeper_prompt_version is None:
                raise AiApproverProcessorError(
                    f"AI approver mode {mode} requires one active gatekeeper prompt"
                )

        articles = self.repository.get_eligible_articles(
            limit=limit,
            require_state_assignment=require_state_assignment,
            state_ids=state_ids,
            mode=mode,
            gatekeeper_prompt_version_id=(
                int(gatekeeper_prompt_version["id"]) if gatekeeper_prompt_version else None
            ),
            category_prompt_version_ids=[
                int(prompt_version["id"]) for prompt_version in category_prompt_versions
            ],
            article_id_min_exclusive=article_id_min_exclusive,
            article_id_max_inclusive=article_id_max_inclusive,
        )
        retry_rows: list[dict[str, Any]] = []
        if continuation_retry_policy is not None:
            retry_rows = self.repository.get_retryable_score_rows(
                limit=limit,
                require_state_assignment=require_state_assignment,
                state_ids=state_ids,
                mode=mode,
                gatekeeper_prompt_version_id=(
                    int(gatekeeper_prompt_version["id"]) if gatekeeper_prompt_version else None
                ),
                category_prompt_version_ids=[
                    int(prompt_version["id"]) for prompt_version in category_prompt_versions
                ],
                article_id_min_exclusive=article_id_min_exclusive,
                article_id_max_inclusive=article_id_max_inclusive,
                retry_transient_failures=bool(
                    continuation_retry_policy.get("retryTransientFailures")
                ),
                retry_invalid_responses=bool(
                    continuation_retry_policy.get("retryInvalidResponses")
                ),
            )

        retry_by_article_prompt = {
            (int(row["articleId"]), int(row["promptVersionId"])): row for row in retry_rows
        }
        articles_by_id = {int(article["id"]): article for article in articles}
        for row in retry_rows:
            article_id = int(row["articleId"])
            if article_id not in articles_by_id:
                article = {
                    "id": article_id,
                    "title": row.get("title", ""),
                    "content": row.get("content", ""),
                }
                articles.append(article)
                articles_by_id[article_id] = article

        usage_totals = self._empty_usage_totals()
        gatekeeper_attempts = 0
        category_attempts = 0
        gatekeeper_pass_count = 0
        gatekeeper_reject_count = 0
        gatekeeper_manual_review_count = 0
        gatekeeper_invalid_response_count = 0
        gatekeeper_failed_count = 0
        category_skipped_count = 0
        estimated_category_calls_avoided = 0

        for article in articles:
            gatekeeper_result = None
            if gatekeeper_prompt_version is not None:
                if should_cancel():
                    raise RuntimeError("AI approver pipeline cancelled")
                gatekeeper_result = self.repository.get_score_result(
                    article_id=int(article["id"]),
                    prompt_version_id=int(gatekeeper_prompt_version["id"]),
                )
                gatekeeper_retry_row = retry_by_article_prompt.get(
                    (int(article["id"]), int(gatekeeper_prompt_version["id"]))
                )
                if gatekeeper_result is None or gatekeeper_retry_row is not None:
                    gatekeeper_result = self._run_gatekeeper_for_article(
                        article=article,
                        prompt_version=gatekeeper_prompt_version,
                        usage_totals=usage_totals,
                        job_id=job_id,
                        reject_confidence_threshold=gatekeeper_reject_confidence_threshold,
                        retry_score_row=gatekeeper_retry_row,
                    )
                    gatekeeper_attempts += 1

                if gatekeeper_result.get("resultStatus") == "completed":
                    if gatekeeper_result.get("decision") == "pass":
                        gatekeeper_pass_count += 1
                    elif gatekeeper_result.get("decision") == "reject":
                        gatekeeper_reject_count += 1
                        estimated_category_calls_avoided += len(category_prompt_versions)
                    elif gatekeeper_result.get("decision") == "manual_review":
                        gatekeeper_manual_review_count += 1
                elif gatekeeper_result.get("resultStatus") == "invalid_response":
                    gatekeeper_invalid_response_count += 1
                elif gatekeeper_result.get("resultStatus") == "failed":
                    gatekeeper_failed_count += 1

            should_run_categories = self._should_run_categories(
                mode=mode,
                gatekeeper_result=gatekeeper_result,
            )
            if not should_run_categories:
                category_skipped_count += len(category_prompt_versions)
                continue

            for prompt_version in category_prompt_versions:
                if should_cancel():
                    raise RuntimeError("AI approver pipeline cancelled")
                existing_category_result = self.repository.get_score_result(
                    article_id=int(article["id"]),
                    prompt_version_id=int(prompt_version["id"]),
                )
                category_retry_row = retry_by_article_prompt.get(
                    (int(article["id"]), int(prompt_version["id"]))
                )
                if existing_category_result is not None and category_retry_row is None:
                    continue

                self._run_category_prompt_for_article(
                    article=article,
                    prompt_version=prompt_version,
                    usage_totals=usage_totals,
                    job_id=job_id,
                    retry_score_row=category_retry_row,
                )
                category_attempts += 1

        return {
            "mode": mode,
            "promptCount": len(category_prompt_versions)
            + (1 if gatekeeper_prompt_version is not None else 0),
            "articleCount": len(articles),
            "attemptCount": gatekeeper_attempts + category_attempts,
            "usage": usage_totals,
            "gatekeeperPromptVersionId": (
                int(gatekeeper_prompt_version["id"]) if gatekeeper_prompt_version else None
            ),
            "gatekeeperAttemptCount": gatekeeper_attempts,
            "gatekeeperPassCount": gatekeeper_pass_count,
            "gatekeeperRejectCount": gatekeeper_reject_count,
            "gatekeeperManualReviewCount": gatekeeper_manual_review_count,
            "gatekeeperInvalidResponseCount": gatekeeper_invalid_response_count,
            "gatekeeperFailedCount": gatekeeper_failed_count,
            "categoryPromptCount": len(category_prompt_versions),
            "categoryAttemptCount": category_attempts,
            "categorySkippedCount": category_skipped_count,
            "estimatedCategoryCallsAvoided": (
                estimated_category_calls_avoided if mode == "shadow" else category_skipped_count
            ),
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

        usage_totals = self._empty_usage_totals()
        prompt_role = prompt_version.get("promptRole") or "category_score"
        if prompt_role == "gatekeeper":
            self._run_gatekeeper_for_article(
                article=article,
                prompt_version=prompt_version,
                usage_totals=usage_totals,
                job_id=job_id,
                reject_confidence_threshold=0.85,
            )
        else:
            self._run_category_prompt_for_article(
                article=article,
                prompt_version=prompt_version,
                usage_totals=usage_totals,
                job_id=job_id,
            )

        return {
            "promptCount": 1,
            "articleCount": 1,
            "attemptCount": 1,
            "usage": usage_totals,
            "contentSource": article.get("contentSource", "none"),
        }
