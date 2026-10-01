"""Deduper-only coordination primitives for the clear-table endpoint."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Lock
from time import monotonic, sleep

from src.modules.deduper.config import resolve_clear_cancel_timeout_seconds
from src.modules.deduper.errors import DeduperError
from src.modules.queue.engine import GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.modules.queue.types import QueueJobStatus


class DeduperClearBusyError(DeduperError):
    """A deduper submission or clear operation already holds the guard."""


class DeduperClearTimeoutError(DeduperError):
    """Deduper execution did not stop before the cancellation deadline."""


@dataclass
class DeduperCancellationProgress:
    # The caller retains this object even when cancellation or waiting fails.
    target_job_ids: list[str] = field(default_factory=list)
    cancellation_requested_jobs: list[str] = field(default_factory=list)
    cancelled_jobs: list[str] = field(default_factory=list)


class DeduperClearControl:
    def __init__(
        self,
        engine: GlobalQueueEngine,
        store: QueueJobStore,
        endpoint_name: str,
        *,
        clock: Callable[[], float] = monotonic,
        wait: Callable[[float], None] = sleep,
    ) -> None:
        self._engine = engine
        self._store = store
        self._endpoint_name = endpoint_name
        self._clock = clock
        self._wait = wait
        self._operation_lock = Lock()

    @contextmanager
    def exclusive_operation(self) -> Iterator[None]:
        """Share between enqueue and clear, never the running job handler."""
        if not self._operation_lock.acquire(blocking=False):
            raise DeduperClearBusyError("A deduper operation is already in progress")
        try:
            yield
        finally:
            self._operation_lock.release()

    def cancel_and_wait(self, progress: DeduperCancellationProgress) -> None:
        """Caller holds exclusive_operation through this call and deletion."""
        timeout = resolve_clear_cancel_timeout_seconds()
        deadline = self._clock() + timeout
        progress.target_job_ids = [
            job.jobId
            for job in self._store.get_jobs()
            if job.endpointName == self._endpoint_name
            and job.status in {QueueJobStatus.QUEUED, QueueJobStatus.RUNNING}
        ]
        accepted_cancellations: set[str] = set()
        for job_id in progress.target_job_ids:
            result = self._engine.cancel_job(job_id)
            if result.outcome == "canceled":
                accepted_cancellations.add(job_id)
                progress.cancelled_jobs.append(job_id)
            elif result.outcome == "cancel_requested":
                accepted_cancellations.add(job_id)
                progress.cancellation_requested_jobs.append(job_id)

        while True:
            # The engine marks a record terminal before releasing its active slot.
            # Check both: a cancellation request alone is not proof of exit.
            active_job_id = self._engine.get_running_job_id()
            pending = False
            for job_id in progress.target_job_ids:
                job = self._store.get_job_by_id(job_id)
                if job is None:
                    raise DeduperError(f"Cannot verify deduper job {job_id}: record missing")
                if active_job_id == job_id or job.status in {
                    QueueJobStatus.QUEUED, QueueJobStatus.RUNNING
                }:
                    pending = True
                elif (
                    job.status == QueueJobStatus.CANCELED
                    and job_id in accepted_cancellations
                    and job_id not in progress.cancelled_jobs
                ):
                    progress.cancelled_jobs.append(job_id)

            if not pending:
                return
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise DeduperClearTimeoutError(
                    f"Deduper did not stop within {timeout} seconds; table was not cleared"
                )
            self._wait(min(0.05, remaining))
