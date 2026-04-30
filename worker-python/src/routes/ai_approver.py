from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field

from src.modules.ai_approver.client import AiApproverOpenAIClient
from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.errors import AiApproverConfigError
from src.modules.ai_approver.orchestrator import AiApproverOrchestrator
from src.modules.ai_approver.repository import AiApproverRepository
from src.modules.queue.engine import (
    EnqueueJobInput,
    QueueExecutionContext,
    QueueJobCanceledError,
)
from src.modules.queue.global_queue import global_queue_engine, global_queue_store
from src.modules.queue.types import QueueJobRecord


router = APIRouter(prefix="/ai-approver", tags=["ai-approver"])

AI_APPROVER_ENDPOINT_NAME = "/ai-approver/start-job"
AI_APPROVER_REVIEW_PAGE_ENDPOINT_NAME = "/ai-approver/review-page/start-job"
queue_engine = global_queue_engine
queue_store = global_queue_store


class AiApproverStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=10, gt=0)
    requireStateAssignment: bool = True
    stateIds: list[int] | None = None
    articleIdMinExclusive: int | None = Field(default=None, gt=0)
    articleIdMaxInclusive: int | None = Field(default=None, gt=0)


class AiApproverReviewPageStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    articleId: int = Field(gt=0)
    promptVersionId: int = Field(gt=0)


def _append_job_log(job_id: str, event: str, **fields: object) -> None:
    field_suffix = " ".join(f"{key}={value}" for key, value in fields.items())
    message = f"event={event} job_id={job_id}"
    if field_suffix:
        message = f"{message} {field_suffix}"
    queue_store.update_job(
        job_id,
        lambda job: QueueJobRecord(
            jobId=job.jobId,
            endpointName=job.endpointName,
            status=job.status,
            createdAt=job.createdAt,
            startedAt=job.startedAt,
            endedAt=job.endedAt,
            failureReason=job.failureReason,
            logs=[*job.logs, message],
            parameters=job.parameters,
            result=job.result,
        ),
    )
    logger.info(message)


def _update_job_result_fields(job_id: str, fields: dict[str, str | int | float | bool | None]) -> None:
    queue_store.update_job(
        job_id,
        lambda job: QueueJobRecord(
            jobId=job.jobId,
            endpointName=job.endpointName,
            status=job.status,
            createdAt=job.createdAt,
            startedAt=job.startedAt,
            endedAt=job.endedAt,
            failureReason=job.failureReason,
            logs=job.logs,
            parameters=job.parameters,
            result={
                **(job.result or {}),
                **fields,
            },
        ),
    )


def create_ai_approver_runner(
    limit: int,
    require_state_assignment: bool,
    state_ids: list[int] | None,
    article_id_min_exclusive: int | None = None,
    article_id_max_inclusive: int | None = None,
):
    def _run(context: QueueExecutionContext) -> None:
        _append_job_log(context.jobId, "job_started", limit=limit)
        repository: AiApproverRepository | None = None

        try:
            config = AiApproverConfig.from_env()
            repository = AiApproverRepository(config)
            client = AiApproverOpenAIClient(config)
            orchestrator = AiApproverOrchestrator(repository, client)
            summary = orchestrator.run_score(
                limit=limit,
                require_state_assignment=require_state_assignment,
                state_ids=state_ids,
                article_id_min_exclusive=article_id_min_exclusive,
                article_id_max_inclusive=article_id_max_inclusive,
                job_id=context.jobId,
                should_cancel=context.is_cancel_requested,
            )
        except AiApproverConfigError as exc:
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": str(exc),
                    "stderr": str(exc),
                    "stdout": "",
                    "statusText": "failed",
                },
            )
            _append_job_log(context.jobId, "job_failed", limit=limit)
            raise
        except Exception as exc:
            message = str(exc)
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": message,
                    "stderr": message,
                    "stdout": "",
                    "statusText": "cancelled" if context.is_cancel_requested() else "failed",
                },
            )
            if context.is_cancel_requested() or "cancelled" in message.lower():
                _append_job_log(context.jobId, "job_cancelled", limit=limit)
                raise QueueJobCanceledError() from exc
            _append_job_log(context.jobId, "job_failed", limit=limit)
            raise
        finally:
            if repository is not None:
                repository.close()

        _update_job_result_fields(
            context.jobId,
            {
                "exitCode": 0,
                "error": None,
                "stderr": "",
                "stdout": "AI approver processed in worker-python",
                "statusText": "completed",
                "promptCount": int(summary["promptCount"]),
                "articleCount": int(summary["articleCount"]),
                "attemptCount": int(summary["attemptCount"]),
                "usagePromptTokens": int(summary["usage"]["prompt_tokens"]),
                "usageCompletionTokens": int(summary["usage"]["completion_tokens"]),
                "usageTotalTokens": int(summary["usage"]["total_tokens"]),
            },
        )
        _append_job_log(context.jobId, "job_completed", limit=limit)

    return _run


def create_review_page_ai_approver_runner(
    article_id: int,
    prompt_version_id: int,
):
    def _run(context: QueueExecutionContext) -> None:
        _append_job_log(
            context.jobId,
            "job_started",
            article_id=article_id,
            prompt_version_id=prompt_version_id,
        )
        repository: AiApproverRepository | None = None

        try:
            config = AiApproverConfig.from_env()
            repository = AiApproverRepository(config)
            client = AiApproverOpenAIClient(config)
            orchestrator = AiApproverOrchestrator(repository, client)
            summary = orchestrator.run_single_score(
                article_id=article_id,
                prompt_version_id=prompt_version_id,
                job_id=context.jobId,
                should_cancel=context.is_cancel_requested,
            )
        except AiApproverConfigError as exc:
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": str(exc),
                    "stderr": str(exc),
                    "stdout": "",
                    "statusText": "failed",
                },
            )
            _append_job_log(
                context.jobId,
                "job_failed",
                article_id=article_id,
                prompt_version_id=prompt_version_id,
            )
            raise
        except Exception as exc:
            message = str(exc)
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": message,
                    "stderr": message,
                    "stdout": "",
                    "statusText": "cancelled" if context.is_cancel_requested() else "failed",
                },
            )
            if context.is_cancel_requested() or "cancelled" in message.lower():
                _append_job_log(
                    context.jobId,
                    "job_cancelled",
                    article_id=article_id,
                    prompt_version_id=prompt_version_id,
                )
                raise QueueJobCanceledError() from exc
            _append_job_log(
                context.jobId,
                "job_failed",
                article_id=article_id,
                prompt_version_id=prompt_version_id,
            )
            raise
        finally:
            if repository is not None:
                repository.close()

        _update_job_result_fields(
            context.jobId,
            {
                "exitCode": 0,
                "error": None,
                "stderr": "",
                "stdout": "Review-page AI approver processed in worker-python",
                "statusText": "completed",
                "promptCount": int(summary["promptCount"]),
                "articleCount": int(summary["articleCount"]),
                "attemptCount": int(summary["attemptCount"]),
                "usagePromptTokens": int(summary["usage"]["prompt_tokens"]),
                "usageCompletionTokens": int(summary["usage"]["completion_tokens"]),
                "usageTotalTokens": int(summary["usage"]["total_tokens"]),
                "contentSource": summary["contentSource"],
            },
        )
        _append_job_log(
            context.jobId,
            "job_completed",
            article_id=article_id,
            prompt_version_id=prompt_version_id,
        )

    return _run


@router.post("/start-job", status_code=202)
def start_ai_approver_job(body: AiApproverStartRequest) -> JSONResponse:
    parameters: dict[str, object] = {
        "limit": body.limit,
        "requireStateAssignment": body.requireStateAssignment,
    }
    if body.stateIds is not None:
        parameters["stateIds"] = body.stateIds

    if body.articleIdMinExclusive is not None:
        parameters["articleIdMinExclusive"] = body.articleIdMinExclusive
    if body.articleIdMaxInclusive is not None:
        parameters["articleIdMaxInclusive"] = body.articleIdMaxInclusive

    result = queue_engine.enqueue_job(
        EnqueueJobInput(
            endpointName=AI_APPROVER_ENDPOINT_NAME,
            run=create_ai_approver_runner(
                body.limit,
                body.requireStateAssignment,
                body.stateIds,
                body.articleIdMinExclusive,
                body.articleIdMaxInclusive,
            ),
            parameters=parameters,
        )
    )

    return JSONResponse(
        {
            "jobId": result.jobId,
            "status": result.status,
            "endpointName": AI_APPROVER_ENDPOINT_NAME,
        },
        status_code=202,
    )


@router.post("/review-page/start-job", status_code=202)
def start_review_page_ai_approver_job(
    body: AiApproverReviewPageStartRequest,
) -> JSONResponse:
    result = queue_engine.enqueue_job(
        EnqueueJobInput(
            endpointName=AI_APPROVER_REVIEW_PAGE_ENDPOINT_NAME,
            run=create_review_page_ai_approver_runner(
                body.articleId,
                body.promptVersionId,
            ),
            parameters={
                "articleId": body.articleId,
                "promptVersionId": body.promptVersionId,
            },
        )
    )

    return JSONResponse(
        {
            "jobId": result.jobId,
            "status": result.status,
            "endpointName": AI_APPROVER_REVIEW_PAGE_ENDPOINT_NAME,
        },
        status_code=202,
    )
