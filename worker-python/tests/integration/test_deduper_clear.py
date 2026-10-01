"""Exercise the real route/manager/queue with a controlled deletion boundary."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.modules.deduper.clear_control import DeduperClearControl
from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.orchestrator import DeduperOrchestrator
from src.modules.queue.engine import EnqueueJobInput, GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.modules.queue.types import QueueJobStatus
from src.routes import deduper
from src.services.job_manager import JobManager


pytestmark = pytest.mark.integration
CLEAR = "/deduper/clear-db-table"


class ControlledRepository:
    def __init__(self):
        self.rows = 3
        self.closed = 0
        self.before_delete = lambda: None
        self.delete_calls = 0

    def clear_all_analysis_data(self):
        self.before_delete()
        self.delete_calls += 1
        deleted, self.rows = self.rows, 0
        return deleted

    def close(self):
        self.closed += 1


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = QueueJobStore(tmp_path / "queue.json")
    engine = GlobalQueueEngine(store)
    manager = JobManager(engine, store)
    repository = ControlledRepository()
    orchestrator = DeduperOrchestrator(repository, DeduperConfig.from_env())
    monkeypatch.setattr(manager, "_create_orchestrator", lambda: (orchestrator, repository))
    monkeypatch.setattr(deduper, "job_manager", manager)
    app = FastAPI()
    app.include_router(deduper.router)
    with TestClient(app) as client:
        yield client, manager, repository
    assert engine.on_idle(timeout=2)


def test_clear_success_then_empty_preserves_response_contract(setup):
    client, manager, repo = setup
    first = client.delete(CLEAR)
    assert first.status_code == 200
    assert first.json()["rowsDeleted"] == 3
    assert first.json()["cleared"] is True
    assert first.json()["cancelledJobs"] == []
    assert first.json()["cancellationRequestedJobs"] == []
    assert {"exitCode", "stdout", "stderr", "timestamp"} <= first.json().keys()
    assert client.delete(CLEAR).json()["rowsDeleted"] == 0
    assert repo.closed == 2


@pytest.mark.parametrize("path", ["/deduper/jobs", "/deduper/jobs/reportId/42", CLEAR])
def test_competing_operations_are_rejected_without_orphan_jobs(setup, path):
    client, manager, repo = setup
    entered, release = Event(), Event()

    def hold_deletion():
        entered.set()
        assert release.wait(timeout=5)

    repo.before_delete = hold_deletion
    with ThreadPoolExecutor(max_workers=1) as pool:
        clearing = pool.submit(client.delete, CLEAR)
        try:
            assert entered.wait(timeout=2)
            response = client.delete(path) if path == CLEAR else client.get(path)
            assert response.status_code == 409
            assert manager.queue_store.get_jobs() == []
            assert repo.delete_calls == 0
            unrelated = [
                manager.queue_engine.enqueue_job(EnqueueJobInput(endpoint, lambda _: None))
                for endpoint in ("/location-scorer/start-job", "/ai-approver-v02/start")
            ]
            assert manager.queue_engine.on_idle(timeout=2)
            assert all(
                manager.queue_engine.get_check_status(job.jobId).status == QueueJobStatus.COMPLETED
                for job in unrelated
            )
        finally:
            release.set()
        assert clearing.result(timeout=2).status_code == 200
    assert repo.delete_calls == 1


@pytest.mark.parametrize("path", ["/deduper/jobs", "/deduper/jobs/reportId/42"])
def test_start_response_is_unchanged_when_guard_is_free(setup, monkeypatch, path):
    client, manager, repo = setup
    monkeypatch.setattr(manager, "_build_deduper_runner", lambda report_id: lambda _: None)
    response = client.get(path)
    assert response.status_code == 201
    assert response.json()["status"] == "queued"
    assert isinstance(response.json()["jobId"], str)
    if path.endswith("42"):
        assert response.json()["reportId"] == 42
    assert manager.queue_engine.on_idle(timeout=2)
    assert repo.delete_calls == 0


def test_running_deduper_exits_before_deletion_while_unrelated_work_continues(setup):
    client, manager, repo = setup
    started, cancellation, release, exited = Event(), Event(), Event(), Event()
    other_started, other_release = Event(), Event()
    queued_ran = Event()

    def running(context):
        started.set()
        assert context.cancelEvent.wait(timeout=5)
        cancellation.set()
        assert release.wait(timeout=5)
        repo.rows += 1  # A final write before the handler exits must precede clearing.
        exited.set()

    def unrelated(context):
        other_started.set()
        assert other_release.wait(timeout=5)

    engine = manager.queue_engine
    active = engine.enqueue_job(EnqueueJobInput(manager.DEDUPER_ENDPOINT_NAME, running))
    assert started.wait(timeout=2)
    queued = engine.enqueue_job(EnqueueJobInput(manager.DEDUPER_ENDPOINT_NAME, lambda _: queued_ran.set()))
    other = engine.enqueue_job(EnqueueJobInput("/ai-approver-v02/start", unrelated))

    def check_before_delete():
        assert exited.is_set()
        assert other_started.wait(timeout=2)

    repo.before_delete = check_before_delete
    with ThreadPoolExecutor(max_workers=1) as pool:
        clearing = pool.submit(client.delete, CLEAR)
        try:
            assert cancellation.wait(timeout=2)
            assert not clearing.done()
            assert repo.delete_calls == 0
            release.set()
            response = clearing.result(timeout=2)
            assert response.status_code == 200
            assert response.json()["rowsDeleted"] == 4
            assert set(response.json()["cancelledJobs"]) == {active.jobId, queued.jobId}
            assert response.json()["cancellationRequestedJobs"] == [active.jobId]
            assert engine.get_check_status(other.jobId).status == QueueJobStatus.RUNNING
            assert not queued_ran.is_set()
            assert repo.rows == 0
        finally:
            release.set()
            other_release.set()
    assert engine.on_idle(timeout=2)
    assert engine.get_check_status(other.jobId).status == QueueJobStatus.COMPLETED


def test_timeout_returns_partial_results_without_deleting(setup, monkeypatch):
    client, manager, repo = setup
    monkeypatch.setenv("DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS", "1")
    now = [0.0]
    started, release = Event(), Event()

    def advance(seconds):
        now[0] += seconds

    manager.deduper_clear_control = DeduperClearControl(
        manager.queue_engine, manager.queue_store, manager.DEDUPER_ENDPOINT_NAME,
        clock=lambda: now[0], wait=advance,
    )

    def job(context):
        started.set()
        assert release.wait(timeout=5)

    active = manager.queue_engine.enqueue_job(EnqueueJobInput(manager.DEDUPER_ENDPOINT_NAME, job))
    assert started.wait(timeout=2)
    queued = manager.queue_engine.enqueue_job(EnqueueJobInput(manager.DEDUPER_ENDPOINT_NAME, lambda _: None))
    try:
        response = client.delete(CLEAR)
        assert response.status_code == 504
        assert response.json()["cleared"] is False
        assert response.json()["cancelledJobs"] == [queued.jobId]
        assert response.json()["cancellationRequestedJobs"] == [active.jobId]
        assert repo.delete_calls == 0
        assert repo.rows == 3
        with manager.deduper_clear_control.exclusive_operation():
            pass
    finally:
        release.set()


def test_database_failure_preserves_cancellations_and_releases_guard(setup, monkeypatch):
    client, manager, repo = setup
    started, release = Event(), Event()

    def unrelated(context):
        started.set()
        assert release.wait(timeout=5)

    engine = manager.queue_engine
    engine.enqueue_job(EnqueueJobInput("/location-scorer/start-job", unrelated))
    assert started.wait(timeout=2)
    target = engine.enqueue_job(EnqueueJobInput(manager.DEDUPER_ENDPOINT_NAME, lambda _: None))

    def fail():
        raise RuntimeError("database unavailable")

    repo.before_delete = fail
    try:
        response = client.delete(CLEAR)
        assert response.status_code == 500
        assert response.json()["cleared"] is False
        assert response.json()["cancelledJobs"] == [target.jobId]
        assert "database unavailable" in response.json()["error"]
        assert repo.closed == 1
        assert repo.rows == 3
        repo.before_delete = lambda: None
        assert client.delete(CLEAR).status_code == 200
        monkeypatch.setattr(manager, "_build_deduper_runner", lambda report_id: lambda _: None)
        assert client.get("/deduper/jobs/reportId/42").status_code == 201
    finally:
        release.set()


def test_invalid_timeout_fails_before_canceling_jobs(setup, monkeypatch):
    client, manager, repo = setup
    monkeypatch.setenv("DEDUPER_CLEAR_CANCEL_TIMEOUT_SECONDS", "invalid")
    monkeypatch.setattr(manager.queue_engine, "cancel_job", lambda _: pytest.fail("Unexpected cancellation"))
    response = client.delete(CLEAR)
    assert response.status_code == 500
    assert response.json()["cleared"] is False
    assert repo.delete_calls == 0
