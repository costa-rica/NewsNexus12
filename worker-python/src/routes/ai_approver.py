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
queue_engine = global_queue_engine
queue_store = global_queue_store


class AiApproverStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=10, gt=0)
    requireStateAssignment: bool = True
    stateIds: list[int] | None = None


def _append_job_log(job_id: str, event: str, limit: int | None = None) -> None:
    message = f"event={event} job_id={job_id} limit={limit}"
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
):
    def _run(context: QueueExecutionContext) -> None:
        _append_job_log(context.jobId, "job_started", limit)
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
            _append_job_log(context.jobId, "job_failed", limit)
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
                _append_job_log(context.jobId, "job_cancelled", limit)
                raise QueueJobCanceledError() from exc
            _append_job_log(context.jobId, "job_failed", limit)
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
        _append_job_log(context.jobId, "job_completed", limit)

    return _run


@router.post("/start-job", status_code=202)
def start_ai_approver_job(body: AiApproverStartRequest) -> JSONResponse:
    parameters: dict[str, object] = {
        "limit": body.limit,
        "requireStateAssignment": body.requireStateAssignment,
    }
    if body.stateIds is not None:
        parameters["stateIds"] = body.stateIds

    result = queue_engine.enqueue_job(
        EnqueueJobInput(
            endpointName=AI_APPROVER_ENDPOINT_NAME,
            run=create_ai_approver_runner(
                body.limit,
                body.requireStateAssignment,
                body.stateIds,
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
