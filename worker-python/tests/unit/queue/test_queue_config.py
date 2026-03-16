from __future__ import annotations

from pathlib import Path

import pytest

from src.modules.queue.config import resolve_queue_jobs_path, validate_queue_startup_env
from src.modules.queue.errors import QueueConfigError


@pytest.mark.unit
def test_resolve_queue_jobs_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH_UTILTIES", "/tmp/newsnexus-utilities")

    queue_jobs_path = resolve_queue_jobs_path()

    assert queue_jobs_path == Path("/tmp/newsnexus-utilities/worker-python/queue-jobs.json")


@pytest.mark.unit
def test_validate_queue_startup_env_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH_UTILTIES", "/tmp/newsnexus-utilities")

    validate_queue_startup_env()


@pytest.mark.unit
def test_validate_queue_startup_env_missing_path_utiltities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("PATH_UTILTIES", raising=False)

    with pytest.raises(QueueConfigError, match="PATH_UTILTIES is required"):
        validate_queue_startup_env()
