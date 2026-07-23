"""Worker routes for AI Approver V02."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from src.modules.ai_approver_v02.client import AiApproverV02CodexClient
from src.modules.ai_approver_v02.config import AiApproverV02Config
from src.modules.ai_approver_v02.errors import (
    AiApproverV02ConflictError,
    AiApproverV02Error,
)
from src.modules.ai_approver_v02.orchestrator import AiApproverV02Orchestrator
from src.modules.ai_approver_v02.repository import AiApproverV02Repository
from src.modules.queue.engine import EnqueueJobInput, QueueExecutionContext
from src.modules.queue.global_queue import global_queue_engine


router = APIRouter(prefix="/ai-approver-v02", tags=["ai-approver-v02"])
queue_engine = global_queue_engine
AI_APPROVER_V02_ENDPOINT_NAME = "/ai-approver-v02/start"


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selectionMode: str = "article_position_count"
    requestedArticleCount: int | None = Field(default=25, gt=0)
    allowPastApprovedBoundary: bool = False
    allowDescriptionFallback: bool = False


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: int = Field(gt=0)
    previewToken: str = Field(min_length=1)


def _error_response(error: AiApproverV02Error) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": error.code, "message": str(error)},
    )


def _repository() -> AiApproverV02Repository:
    return AiApproverV02Repository(AiApproverV02Config.from_env())


def create_ai_approver_v02_runner(run_id: int):
    def _run(context: QueueExecutionContext) -> None:
        repository = _repository()
        try:
            client = AiApproverV02CodexClient(repository.config)
            orchestrator = AiApproverV02Orchestrator(repository, client)
            orchestrator.run(run_id, context.is_cancel_requested)
        finally:
            repository.close()

    return _run


@router.post("/preview")
def preview_run(request: PreviewRequest):
    repository: AiApproverV02Repository | None = None
    try:
        repository = _repository()
        return repository.create_preview(
            selection_mode=request.selectionMode,
            requested_article_count=request.requestedArticleCount,
            allow_past_approved_boundary=request.allowPastApprovedBoundary,
            allow_description_fallback=request.allowDescriptionFallback,
        )
    except AiApproverV02Error as error:
        return _error_response(error)
    finally:
        if repository is not None:
            repository.close()


@router.post("/start", status_code=202)
def start_run(request: StartRequest):
    repository: AiApproverV02Repository | None = None
    try:
        repository = _repository()
        run = repository.accept_preview(request.runId, request.previewToken)
        try:
            queued = queue_engine.enqueue_job(
                EnqueueJobInput(
                    endpointName=AI_APPROVER_V02_ENDPOINT_NAME,
                    run=create_ai_approver_v02_runner(request.runId),
                    parameters={"runId": request.runId},
                )
            )
            repository.attach_job_id(request.runId, queued.jobId)
        except Exception:
            repository.mark_enqueue_failed(request.runId)
            raise
        return {
            "runId": run["id"],
            "jobId": queued.jobId,
            "status": queued.status,
        }
    except AiApproverV02Error as error:
        return _error_response(error)
    finally:
        if repository is not None:
            repository.close()


@router.get("/runs/latest")
def latest_run():
    repository: AiApproverV02Repository | None = None
    try:
        repository = _repository()
        return repository.get_latest_execution_run()
    except AiApproverV02Error as error:
        return _error_response(error)
    finally:
        if repository is not None:
            repository.close()


@router.get("/runs/{run_id}")
def get_run(run_id: int):
    repository: AiApproverV02Repository | None = None
    try:
        repository = _repository()
        run = repository.get_run(run_id, include_preview=False)
        queue_status = (
            queue_engine.get_check_status(run["jobId"])
            if run.get("jobId")
            else None
        )
        return {"run": run, "queueStatus": queue_status}
    except AiApproverV02Error as error:
        return _error_response(error)
    finally:
        if repository is not None:
            repository.close()


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: int):
    repository: AiApproverV02Repository | None = None
    try:
        repository = _repository()
        run = repository.get_run(run_id, include_preview=False)
        if run["status"] not in ("queued", "running") or not run.get("jobId"):
            raise AiApproverV02ConflictError(
                "Only a queued or running V02 run can be canceled"
            )
        result = queue_engine.cancel_job(run["jobId"])
        if result.outcome == "canceled":
            repository.finish_run(run_id, "canceled", "canceled_before_start")
        return {
            "runId": run_id,
            "jobId": run["jobId"],
            "outcome": result.outcome,
        }
    except AiApproverV02Error as error:
        return _error_response(error)
    finally:
        if repository is not None:
            repository.close()
