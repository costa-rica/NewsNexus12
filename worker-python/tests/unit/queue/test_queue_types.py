from __future__ import annotations

import pytest

from src.modules.queue.types import QueueJobRecord, QueueJobStatus


@pytest.mark.unit
def test_queue_job_status_values_match_portal_contract() -> None:
    assert [status.value for status in QueueJobStatus] == [
        "queued",
        "running",
        "completed",
        "failed",
        "canceled",
    ]


@pytest.mark.unit
def test_queue_job_record_uses_string_job_id() -> None:
    job_record = QueueJobRecord(
        jobId="0001",
        endpointName="/deduper/start-job",
        status=QueueJobStatus.QUEUED,
        createdAt="2026-03-15T00:00:00Z",
    )

    assert isinstance(job_record.jobId, str)
    assert job_record.jobId == "0001"
    assert job_record.startedAt is None
    assert job_record.failureReason is None
