from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from loguru import logger

from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.errors import DeduperProcessorError
from src.modules.deduper.orchestrator import DeduperOrchestrator
from src.modules.deduper.repository import DeduperRepository
from src.modules.queue.engine import EnqueueJobInput, GlobalQueueEngine, QueueExecutionContext, QueueJobCanceledError
from src.modules.queue.global_queue import global_queue_engine, global_queue_store
from src.modules.queue.status import summarize_queue_jobs
from src.modules.queue.store import QueueJobStore
from src.modules.queue.types import QueueJobRecord, QueueJobStatus


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "canceled"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobRecord:
    id: str
    status: JobStatus
    created_at: str
    logs: list[str] = field(default_factory=list)
    report_id: int | None = None
    started_at: str | None = None
    completed_at: str | None = None
    exit_code: int | None = None
    stdout: str | None = None
    stderr: str | None = None
    error: str | None = None
    cancel_requested: bool = False


class JobManager:
    DEDUPER_ENDPOINT_NAME = "/deduper/start-job"

    def __init__(
        self,
        queue_engine: GlobalQueueEngine = global_queue_engine,
        queue_store: QueueJobStore = global_queue_store,
    ) -> None:
        self.queue_engine = queue_engine
        self.queue_store = queue_store
        self.logger = logger

    def enqueue_deduper_job(self, report_id: int | None = None) -> dict[str, str | int]:
        parameters: dict[str, str | int | float | bool | None] | None = None
        if report_id is not None:
            parameters = {"reportId": report_id}

        result = self.queue_engine.enqueue_job(
            EnqueueJobInput(
                endpointName=self.DEDUPER_ENDPOINT_NAME,
                run=self._build_deduper_runner(report_id),
                parameters=parameters,
            )
        )

        return {
            "jobId": result.jobId,
            "status": result.status,
            **({"reportId": report_id} if report_id is not None else {}),
        }

    def get_job(self, job_id: str) -> JobRecord | None:
        queue_job = self.queue_engine.get_check_status(job_id)
        if queue_job is None:
            return None

        return self._map_queue_job_to_job_record(queue_job)

    def list_jobs(self) -> list[dict[str, Any]]:
        return [
            {
                "jobId": job.jobId,
                "status": job.status.value,
                "createdAt": job.createdAt,
                **({"reportId": job.parameters["reportId"]} if job.parameters and "reportId" in job.parameters else {}),
            }
            for job in self.queue_store.get_jobs()
        ]

    def cancel_job(self, job_id: str) -> tuple[bool, str]:
        result = self.queue_engine.cancel_job(job_id)
        if result.outcome == "not_found":
            job = self.get_job(job_id)
            if job is None:
                return False, "Job not found"
            return False, f"Cannot cancel job with status: {job.status.value}"

        return True, "Job cancelled successfully"

    def health_summary(self) -> dict[str, Any]:
        pg_host = os.getenv("PG_HOST")
        pg_database = os.getenv("PG_DATABASE")
        jobs = self.queue_store.get_jobs()
        queue_summary = summarize_queue_jobs(jobs)

        checks: dict[str, Any] = {
            "status": "healthy",
            "timestamp": utc_now_iso(),
            "environment": {
                "pg_host_configured": bool(pg_host),
                "pg_database_configured": bool(pg_database),
            },
            "jobs": {
                "total": queue_summary.totalJobs,
                "pending": queue_summary.queued,
                "queued": queue_summary.queued,
                "running": queue_summary.running,
                "completed": queue_summary.completed,
                "failed": queue_summary.failed,
                "cancelled": queue_summary.canceled,
            },
        }

        if not pg_host or not pg_database:
            checks["status"] = "unhealthy"

        return checks

    def cancel_all_active_jobs(self) -> list[str]:
        cancelled_jobs: list[str] = []

        for job in self.queue_store.get_jobs():
            if job.status not in {QueueJobStatus.QUEUED, QueueJobStatus.RUNNING}:
                continue

            success, _message = self.cancel_job(job.jobId)
            if success:
                cancelled_jobs.append(job.jobId)

        return cancelled_jobs

    def run_clear_table(self) -> dict[str, Any]:
        cancelled_jobs = self.cancel_all_active_jobs()
        orchestrator, repository = self._create_orchestrator()
        try:
            response = orchestrator.run_clear_table(skip_confirmation=True)
        finally:
            repository.close()

        response["cancelledJobs"] = cancelled_jobs
        return response

    def wait_for_idle(self, timeout: float | None = None) -> bool:
        return self.queue_engine.on_idle(timeout=timeout)

    def reset_for_tests(self) -> None:
        self.wait_for_idle(timeout=1)
        self.queue_store.replace_jobs([])

    def _create_orchestrator(self) -> tuple[DeduperOrchestrator, DeduperRepository]:
        config = DeduperConfig.from_env()
        repository = DeduperRepository(config)
        orchestrator = DeduperOrchestrator(repository, config)
        return orchestrator, repository

    def _build_deduper_runner(self, report_id: int | None):
        def _run(context: QueueExecutionContext) -> None:
            self._append_job_log(context.jobId, "job_started", report_id)
            orchestrator, repository = self._create_orchestrator()

            try:
                summary = orchestrator.run_analyze_fast(
                    report_id=report_id,
                    should_cancel=context.is_cancel_requested,
                )
            except DeduperProcessorError as exc:
                self._update_job_result(
                    context.jobId,
                    exit_code=1,
                    stdout="",
                    stderr=str(exc),
                    error=str(exc),
                )
                self._append_job_log(context.jobId, "job_cancelled", report_id)
                raise QueueJobCanceledError() from exc
            except Exception as exc:
                self._update_job_result(
                    context.jobId,
                    exit_code=1,
                    stdout="",
                    stderr=str(exc),
                    error=str(exc),
                )
                self._append_job_log(context.jobId, f"job_failed error={exc}", report_id)
                raise
            finally:
                repository.close()

            if summary.status == "cancelled" or context.is_cancel_requested():
                self._update_job_result(
                    context.jobId,
                    exit_code=1,
                    stdout="",
                    stderr="Pipeline cancelled",
                    error="Pipeline cancelled",
                )
                self._append_job_log(context.jobId, "job_cancelled", report_id)
                raise QueueJobCanceledError()

            if summary.status != "completed":
                self._update_job_result(
                    context.jobId,
                    exit_code=1,
                    stdout="",
                    stderr="deduper_failed",
                    error="deduper_failed",
                )
                self._append_job_log(context.jobId, "job_failed", report_id)
                raise RuntimeError("deduper_failed")

            self._update_job_result(
                context.jobId,
                exit_code=0,
                stdout="Deduper processed in-process inside worker-python",
                stderr="",
                error=None,
            )
            self._append_job_log(context.jobId, "job_completed", report_id)

        return _run

    def _append_job_log(self, job_id: str, event: str, report_id: int | None = None) -> None:
        message = f"{utc_now_iso()} event={event} job_id={job_id} report_id={report_id}"

        self.queue_store.update_job(
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
        self.logger.info(message)

    def _update_job_result(
        self,
        job_id: str,
        *,
        exit_code: int,
        stdout: str,
        stderr: str,
        error: str | None,
    ) -> None:
        self.queue_store.update_job(
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
                    "exitCode": exit_code,
                    "stdout": stdout,
                    "stderr": stderr,
                    "error": error,
                },
            ),
        )

    def _map_queue_job_to_job_record(self, queue_job: QueueJobRecord) -> JobRecord:
        result = queue_job.result or {}
        report_id_value = None
        if queue_job.parameters is not None:
            raw_report_id = queue_job.parameters.get("reportId")
            if isinstance(raw_report_id, int):
                report_id_value = raw_report_id

        return JobRecord(
            id=queue_job.jobId,
            status=JobStatus(queue_job.status.value),
            created_at=queue_job.createdAt,
            logs=list(queue_job.logs),
            report_id=report_id_value,
            started_at=queue_job.startedAt,
            completed_at=queue_job.endedAt,
            exit_code=result.get("exitCode") if isinstance(result.get("exitCode"), int) else None,
            stdout=result.get("stdout") if isinstance(result.get("stdout"), str) else None,
            stderr=result.get("stderr") if isinstance(result.get("stderr"), str) else None,
            error=result.get("error") if isinstance(result.get("error"), str) else None,
            cancel_requested=queue_job.status == QueueJobStatus.CANCELED,
        )


job_manager = JobManager()
