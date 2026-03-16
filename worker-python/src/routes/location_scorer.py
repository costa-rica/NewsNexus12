from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, ConfigDict

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import (
    LocationScorerConfigError,
    LocationScorerProcessorError,
)
from src.modules.location_scorer.orchestrator import LocationScorerOrchestrator
from src.modules.location_scorer.repository import LocationScorerRepository
from src.modules.location_scorer.types import PipelineSummary
from src.modules.queue.engine import (
    EnqueueJobInput,
    QueueExecutionContext,
    QueueJobCanceledError,
)
from src.modules.queue.global_queue import global_queue_engine, global_queue_store
from src.modules.queue.types import QueueJobRecord


router = APIRouter(prefix="/location-scorer", tags=["location-scorer"])

LOCATION_SCORER_ENDPOINT_NAME = "/location-scorer/start-job"
queue_engine = global_queue_engine
queue_store = global_queue_store


class LocationScorerStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int | None = None


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


def _persist_progress(job_id: str, summary: PipelineSummary) -> None:
    current_step = summary.steps[-1] if summary.steps else None
    _update_job_result_fields(
        job_id,
        {
            "workflow": "location_scorer",
            "summaryStatus": summary.status,
            "limit": summary.limit,
            "completedStepCount": len(
                [step for step in summary.steps if step.status == "completed"]
            ),
            "currentStep": current_step.step.value if current_step is not None else None,
            "currentStepStatus": current_step.status if current_step is not None else None,
            "currentStepProcessed": current_step.processed if current_step is not None else 0,
        },
    )


def create_location_scorer_runner(limit: int | None):
    def _run(context: QueueExecutionContext) -> None:
        _append_job_log(context.jobId, "job_started", limit)
        repository: LocationScorerRepository | None = None

        try:
            config = LocationScorerConfig.from_env()
            repository = LocationScorerRepository(config)
            orchestrator = LocationScorerOrchestrator(repository, config)
            summary = orchestrator.run_score(
                limit=limit,
                should_cancel=context.is_cancel_requested,
                on_progress=lambda current_summary: _persist_progress(
                    context.jobId,
                    current_summary,
                ),
            )
        except LocationScorerProcessorError as exc:
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": str(exc),
                    "stderr": str(exc),
                    "stdout": "",
                    "statusText": "cancelled" if context.is_cancel_requested() else "failed",
                },
            )
            if context.is_cancel_requested() or "cancelled" in str(exc).lower():
                _append_job_log(context.jobId, "job_cancelled", limit)
                raise QueueJobCanceledError() from exc
            _append_job_log(context.jobId, "job_failed", limit)
            raise
        except LocationScorerConfigError as exc:
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
        finally:
            if repository is not None:
                repository.close()

        if summary.status == "cancelled" or context.is_cancel_requested():
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": "Pipeline cancelled",
                    "stderr": "Pipeline cancelled",
                    "stdout": "",
                    "statusText": "cancelled",
                },
            )
            _append_job_log(context.jobId, "job_cancelled", limit)
            raise QueueJobCanceledError()

        if summary.status != "completed":
            _update_job_result_fields(
                context.jobId,
                {
                    "exitCode": 1,
                    "error": "location_scorer_failed",
                    "stderr": "location_scorer_failed",
                    "stdout": "",
                    "statusText": "failed",
                },
            )
            _append_job_log(context.jobId, "job_failed", limit)
            raise RuntimeError("location_scorer_failed")

        _update_job_result_fields(
            context.jobId,
            {
                "exitCode": 0,
                "error": None,
                "stderr": "",
                "stdout": "Location scorer processed in worker-python",
                "statusText": "completed",
            },
        )
        _append_job_log(context.jobId, "job_completed", limit)

    return _run


@router.post("/start-job", status_code=202)
def start_location_scorer_job(body: LocationScorerStartRequest) -> JSONResponse:
    parameters: dict[str, int | None] | None = None
    if body.limit is not None:
        parameters = {"limit": body.limit}

    result = queue_engine.enqueue_job(
        EnqueueJobInput(
            endpointName=LOCATION_SCORER_ENDPOINT_NAME,
            run=create_location_scorer_runner(body.limit),
            parameters=parameters,
        )
    )

    return JSONResponse(
        {
            "jobId": result.jobId,
            "status": result.status,
            "endpointName": LOCATION_SCORER_ENDPOINT_NAME,
        },
        status_code=202,
    )
