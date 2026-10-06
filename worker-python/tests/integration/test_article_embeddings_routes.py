from __future__ import annotations

import pytest

from src.modules.article_embeddings import (
    ArticleEmbeddingsCancelledError,
    EmbeddingSyncMode,
    EmbeddingSyncSummary,
)
from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.orchestrator import DeduperOrchestrator
from src.modules.queue.engine import GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.services.job_manager import JobManager, JobStatus


def _create_job_manager(tmp_path) -> JobManager:
    store = QueueJobStore(tmp_path / "worker-python" / "queue-jobs.json")
    engine = GlobalQueueEngine(store)
    return JobManager(queue_engine=engine, queue_store=store)


@pytest.fixture
def test_job_manager(client, monkeypatch: pytest.MonkeyPatch, tmp_path) -> JobManager:
    from src.routes import article_embeddings as article_embeddings_routes
    from src.routes import deduper as deduper_routes

    manager = _create_job_manager(tmp_path)
    monkeypatch.setattr(deduper_routes, "job_manager", manager)
    monkeypatch.setattr(article_embeddings_routes, "job_manager", manager)
    return manager


class _FakeSummary:
    status = "completed"


class _FakeRepo:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _RecordingOrchestrator:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def run_analyze_fast(self, report_id=None, should_cancel=None, rebuild_embeddings=False):
        self.calls.append({"report_id": report_id, "rebuild_embeddings": rebuild_embeddings})
        return _FakeSummary()


def _queue_parameters(manager: JobManager, job_id: str) -> dict | None:
    job = next(job for job in manager.queue_store.get_jobs() if job.jobId == job_id)
    return job.parameters


# --- deduper routes ---


@pytest.mark.integration
def test_get_deduper_routes_are_unchanged(client, test_job_manager, monkeypatch) -> None:
    orchestrator = _RecordingOrchestrator()
    monkeypatch.setattr(test_job_manager, "_create_orchestrator", lambda: (orchestrator, _FakeRepo()))

    all_response = client.get("/deduper/jobs")
    report_response = client.get("/deduper/jobs/reportId/42")
    assert test_job_manager.wait_for_idle(timeout=2) is True

    assert all_response.status_code == 201
    assert report_response.status_code == 201
    assert report_response.json()["reportId"] == 42
    assert orchestrator.calls == [
        {"report_id": None, "rebuild_embeddings": False},
        {"report_id": 42, "rebuild_embeddings": False},
    ]
    assert _queue_parameters(test_job_manager, all_response.json()["jobId"]) is None


@pytest.mark.integration
def test_post_deduper_routes_accept_empty_and_rebuild_bodies(
    client, test_job_manager, monkeypatch
) -> None:
    orchestrator = _RecordingOrchestrator()
    monkeypatch.setattr(test_job_manager, "_create_orchestrator", lambda: (orchestrator, _FakeRepo()))

    empty = client.post("/deduper/jobs")
    rebuild = client.post("/deduper/jobs", json={"rebuildEmbeddings": True})
    report_rebuild = client.post("/deduper/jobs/reportId/7", json={"rebuildEmbeddings": True})
    assert test_job_manager.wait_for_idle(timeout=2) is True

    assert [response.status_code for response in (empty, rebuild, report_rebuild)] == [201, 201, 201]
    assert report_rebuild.json()["reportId"] == 7
    assert orchestrator.calls == [
        {"report_id": None, "rebuild_embeddings": False},
        {"report_id": None, "rebuild_embeddings": True},
        {"report_id": 7, "rebuild_embeddings": True},
    ]
    assert _queue_parameters(test_job_manager, rebuild.json()["jobId"]) == {"rebuildEmbeddings": True}
    assert _queue_parameters(test_job_manager, report_rebuild.json()["jobId"]) == {
        "reportId": 7,
        "rebuildEmbeddings": True,
    }


@pytest.mark.integration
def test_post_deduper_routes_reject_invalid_body(client, test_job_manager) -> None:
    assert client.post("/deduper/jobs", json={"rebuildEmbeddings": "maybe"}).status_code == 422
    assert client.post("/deduper/jobs", json={"unknown": True}).status_code == 422
    assert (
        client.post("/deduper/jobs/reportId/7", json={"rebuildEmbeddings": [1]}).status_code
        == 422
    )


@pytest.mark.integration
def test_post_deduper_cancel_route_still_resolves(client, test_job_manager) -> None:
    response = client.post("/deduper/jobs/does-not-exist/cancel")

    assert response.status_code == 404


# --- standalone article embeddings route ---


class _FakeSyncService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.modes: list[str] = []

    def sync(self, mode, should_cancel=None):
        self.modes.append(str(mode))
        if self.error is not None:
            raise self.error
        return EmbeddingSyncSummary(mode=EmbeddingSyncMode(mode), encoded=3, upserted=3)


def _patch_embeddings_service(manager: JobManager, monkeypatch, service) -> _FakeRepo:
    repo = _FakeRepo()
    monkeypatch.setattr(manager, "_create_article_embeddings_service", lambda: (service, repo))
    return repo


@pytest.mark.integration
def test_article_embeddings_job_defaults_to_incremental(client, test_job_manager, monkeypatch) -> None:
    service = _FakeSyncService()
    repo = _patch_embeddings_service(test_job_manager, monkeypatch, service)

    response = client.post("/article-embeddings/jobs")
    assert test_job_manager.wait_for_idle(timeout=2) is True

    assert response.status_code == 201
    assert response.json()["mode"] == "incremental"
    assert service.modes == ["incremental"]
    job = next(job for job in test_job_manager.queue_store.get_jobs() if job.jobId == response.json()["jobId"])
    assert job.status.value == JobStatus.COMPLETED
    assert job.endpointName == test_job_manager.ARTICLE_EMBEDDINGS_ENDPOINT_NAME
    assert job.result is not None and job.result["processed"] == 3
    assert repo.closed is True


@pytest.mark.integration
def test_article_embeddings_job_accepts_rebuild_and_rejects_unknown_mode(
    client, test_job_manager, monkeypatch
) -> None:
    service = _FakeSyncService()
    _patch_embeddings_service(test_job_manager, monkeypatch, service)

    rebuild = client.post("/article-embeddings/jobs", json={"mode": "rebuild"})
    unknown = client.post("/article-embeddings/jobs", json={"mode": "everything"})
    assert test_job_manager.wait_for_idle(timeout=2) is True

    assert rebuild.status_code == 201
    assert rebuild.json()["mode"] == "rebuild"
    assert service.modes == ["rebuild"]
    assert unknown.status_code == 422


@pytest.mark.integration
def test_article_embeddings_job_cancelled_during_sync_ends_canceled(
    client, test_job_manager, monkeypatch
) -> None:
    repo = _patch_embeddings_service(
        test_job_manager, monkeypatch, _FakeSyncService(error=ArticleEmbeddingsCancelledError("stop"))
    )

    response = client.post("/article-embeddings/jobs")
    assert test_job_manager.wait_for_idle(timeout=2) is True

    job = test_job_manager.get_job(response.json()["jobId"])
    assert job is not None and job.status == JobStatus.CANCELLED
    assert repo.closed is True


@pytest.mark.integration
def test_article_embeddings_job_unrelated_error_ends_failed(
    client, test_job_manager, monkeypatch
) -> None:
    repo = _patch_embeddings_service(
        test_job_manager, monkeypatch, _FakeSyncService(error=RuntimeError("database down"))
    )

    response = client.post("/article-embeddings/jobs")
    assert test_job_manager.wait_for_idle(timeout=2) is True

    job = test_job_manager.get_job(response.json()["jobId"])
    assert job is not None and job.status == JobStatus.FAILED
    assert repo.closed is True


# --- deduper job cancellation through the embedding steps ---


class _PassProc:
    def __init__(self, repository, config, **kwargs) -> None:
        pass

    def execute(self, **kwargs):
        return {"processed": 1}


class _DeduperRepoStub:
    def __init__(self) -> None:
        self.closed = False

    def clear_all_analysis_data(self) -> int:
        return 0

    def get_analysis_article_ids(self) -> list[int]:
        return [1, 2]

    def close(self) -> None:
        self.closed = True


class _EmbeddingServiceStub:
    def __init__(self, cancel_in: str) -> None:
        self.cancel_in = cancel_in

    def sync(self, mode, should_cancel=None):
        if self.cancel_in == "sync":
            raise ArticleEmbeddingsCancelledError("stop")
        return EmbeddingSyncSummary(mode=EmbeddingSyncMode(mode))

    def ensure_embeddings(self, article_ids, should_cancel=None):
        if self.cancel_in == "ensure":
            raise ArticleEmbeddingsCancelledError("stop")
        return {}


def _deduper_config() -> DeduperConfig:
    return DeduperConfig(
        pg_host="localhost",
        pg_port=5432,
        pg_database="newsnexus_test_worker_python",
        pg_user="nick",
        pg_password="",
        path_to_csv=None,
        enable_embedding=True,
        batch_size_load=100,
        batch_size_states=100,
        batch_size_url=100,
        batch_size_content_hash=100,
        batch_size_embedding=100,
        cache_max_entries=100,
        checkpoint_interval=1,
    )


@pytest.mark.integration
@pytest.mark.parametrize("cancel_in", ["sync", "ensure"])
def test_deduper_job_cancelled_in_embedding_steps_ends_canceled(
    client, test_job_manager, monkeypatch, cancel_in
) -> None:
    from src.modules.deduper import orchestrator as orch_mod

    for name in ("LoadProcessor", "StatesProcessor", "UrlCheckProcessor"):
        monkeypatch.setattr(orch_mod, name, _PassProc)
    repo = _DeduperRepoStub()
    orchestrator = DeduperOrchestrator(repo, _deduper_config())
    monkeypatch.setattr(orchestrator, "_build_embedding_service", lambda: _EmbeddingServiceStub(cancel_in))
    monkeypatch.setattr(test_job_manager, "_create_orchestrator", lambda: (orchestrator, repo))

    response = client.post("/deduper/jobs/reportId/5")
    assert test_job_manager.wait_for_idle(timeout=2) is True

    job = test_job_manager.get_job(response.json()["jobId"])
    assert job is not None
    assert job.status == JobStatus.CANCELLED
    assert repo.closed is True
