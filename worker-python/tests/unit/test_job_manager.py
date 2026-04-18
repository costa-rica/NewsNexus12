import pytest

from src.modules.queue.engine import GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.services.job_manager import JobManager, JobStatus
from tests.postgres_test_utils import execute_statements, reset_public_schema


def _create_job_manager(tmp_path) -> JobManager:
    store = QueueJobStore(tmp_path / "worker-python" / "queue-jobs.json")
    engine = GlobalQueueEngine(store)
    return JobManager(queue_engine=engine, queue_store=store)


@pytest.mark.unit
def test_enqueue_deduper_job_defaults(tmp_path) -> None:
    job_manager = _create_job_manager(tmp_path)

    response = job_manager.enqueue_deduper_job()

    assert response["jobId"] == "0001"
    assert response["status"] == "queued"
    assert "reportId" not in response


@pytest.mark.unit
def test_cancel_missing_job(tmp_path) -> None:
    job_manager = _create_job_manager(tmp_path)

    ok, message = job_manager.cancel_job(999)

    assert ok is False
    assert message == "Job not found"


@pytest.mark.unit
def test_clear_table_missing_env_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.services.job_manager import job_manager

    monkeypatch.delenv("PG_HOST", raising=False)

    with pytest.raises(Exception, match="PG_HOST is required"):
        job_manager.run_clear_table()


@pytest.mark.unit
def test_health_unhealthy_when_database_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.services.job_manager import job_manager

    monkeypatch.delenv("PG_HOST", raising=False)
    monkeypatch.delenv("PG_DATABASE", raising=False)

    summary = job_manager.health_summary()

    assert summary["status"] == "unhealthy"
    assert summary["environment"]["pg_host_configured"] is False
    assert summary["environment"]["pg_database_configured"] is False


@pytest.mark.unit
def test_run_deduper_job_uses_in_process_orchestrator(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    class _FakeSummary:
        status = "completed"

    class _FakeRepo:
        def close(self) -> None:
            return None

    class _FakeOrchestrator:
        def run_analyze_fast(self, report_id=None, should_cancel=None):
            assert report_id == 42
            assert should_cancel is not None
            return _FakeSummary()

    job_manager = _create_job_manager(tmp_path)

    monkeypatch.setattr(
        job_manager,
        "_create_orchestrator",
        lambda: (_FakeOrchestrator(), _FakeRepo()),
    )

    response = job_manager.enqueue_deduper_job(report_id=42)
    assert job_manager.wait_for_idle(timeout=1) is True
    updated = job_manager.get_job(str(response["jobId"]))

    assert updated is not None
    assert updated.status == JobStatus.COMPLETED
    assert updated.exit_code == 0
    assert any("event=job_completed" in line for line in updated.logs)


@pytest.mark.unit
def test_run_clear_table_in_process_success() -> None:
    from src.services.job_manager import job_manager

    reset_public_schema()
    execute_statements(
        [
            """
            CREATE TABLE "ArticleDuplicateAnalyses" (
                id SERIAL PRIMARY KEY
            )
            """
        ]
    )
    execute_statements(
        [
            "INSERT INTO \"ArticleDuplicateAnalyses\" DEFAULT VALUES",
        ]
    )
    response = job_manager.run_clear_table()
    assert response["cleared"] is True
    assert response["exitCode"] == 0
