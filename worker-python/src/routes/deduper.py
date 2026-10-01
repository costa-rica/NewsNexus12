from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.modules.deduper.clear_control import (
    DeduperClearBusyError,
    DeduperClearFailedError,
    DeduperClearTimeoutError,
)
from src.services.job_manager import JobStatus, job_manager, utc_now_iso

router = APIRouter(prefix="/deduper", tags=["deduper"])


@router.get("/jobs", status_code=201)
def create_deduper_job():
    try:
        return job_manager.enqueue_deduper_job()
    except DeduperClearBusyError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@router.get("/jobs/reportId/{report_id}", status_code=201)
def create_deduper_job_by_report_id(report_id: int):
    try:
        return job_manager.enqueue_deduper_job(report_id=report_id)
    except DeduperClearBusyError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@router.get("/jobs/list")
def get_jobs() -> dict:
    return {"jobs": job_manager.list_jobs()}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> JSONResponse:
    job = job_manager.get_job(job_id)
    if job is None:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    response: dict = {
        "jobId": job.id,
        "status": job.status,
        "createdAt": job.created_at,
    }

    if job.report_id is not None:
        response["reportId"] = job.report_id
    if job.started_at is not None:
        response["startedAt"] = job.started_at
    if job.completed_at is not None:
        response["completedAt"] = job.completed_at
    if job.exit_code is not None:
        response["exitCode"] = job.exit_code
    if job.stdout is not None:
        response["stdout"] = job.stdout
    if job.stderr is not None:
        response["stderr"] = job.stderr
    if job.error is not None:
        response["error"] = job.error
    if job.logs:
        response["logs"] = job.logs

    return JSONResponse(response)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> JSONResponse:
    success, message = job_manager.cancel_job(job_id)
    if not success and message == "Job not found":
        return JSONResponse({"error": message}, status_code=404)
    if not success and message.startswith("Cannot cancel"):
        return JSONResponse({"error": message}, status_code=400)
    if not success:
        return JSONResponse({"error": message}, status_code=500)

    return JSONResponse(
        {"jobId": job_id, "status": JobStatus.CANCELLED, "message": message}
    )


@router.get("/health")
def health_check() -> JSONResponse:
    try:
        checks = job_manager.health_summary()
        return JSONResponse(checks)
    except Exception as exc:
        return JSONResponse(
            {"status": "unhealthy", "error": str(exc), "timestamp": utc_now_iso()},
            status_code=500,
        )


@router.delete("/clear-db-table")
def clear_db_table() -> JSONResponse:
    try:
        response = job_manager.run_clear_table()
        if response["cleared"]:
            return JSONResponse(response, status_code=200)
        return JSONResponse(response, status_code=500)
    except DeduperClearFailedError as exc:
        status_code = 500
        if isinstance(exc.cause, DeduperClearBusyError):
            status_code = 409
        elif isinstance(exc.cause, DeduperClearTimeoutError):
            status_code = 504
        return JSONResponse(
            {
                "cleared": False,
                "error": str(exc),
                "cancelledJobs": exc.progress.cancelled_jobs,
                "cancellationRequestedJobs": exc.progress.cancellation_requested_jobs,
                "timestamp": utc_now_iso(),
            },
            status_code=status_code,
        )
    except Exception as exc:
        return JSONResponse(
            {
                "cleared": False,
                "error": str(exc),
                "cancelledJobs": [],
                "cancellationRequestedJobs": [],
                "timestamp": utc_now_iso(),
            },
            status_code=500,
        )
