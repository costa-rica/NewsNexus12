from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class QueueJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


@dataclass(slots=True)
class QueueJobRecord:
    """
    Queue job contract for worker-python automation workflows.

    Required fields:
    - jobId
    - endpointName
    - status
    - createdAt

    Optional fields:
    - startedAt
    - endedAt
    - failureReason
    - logs
    - parameters
    """

    jobId: str
    endpointName: str
    status: QueueJobStatus
    createdAt: str
    startedAt: str | None = None
    endedAt: str | None = None
    failureReason: str | None = None
    logs: list[str] = field(default_factory=list)
    parameters: dict[str, str | int | float | bool | None] | None = None
