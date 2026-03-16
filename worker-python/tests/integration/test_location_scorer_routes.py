from __future__ import annotations

import importlib
from threading import Event
from time import sleep

import pytest

from src.modules.queue.engine import (
    EnqueueJobInput,
    GlobalQueueEngine,
    QueueJobCanceledError,
)
from src.modules.queue.store import QueueJobStore


def _create_engine(tmp_path) -> GlobalQueueEngine:
    return GlobalQueueEngine(QueueJobStore(tmp_path / "worker-python" / "queue-jobs.json"))


@pytest.fixture
def location_queue_override(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from src.routes import location_scorer as location_scorer_routes
    from src.routes import queue_info as queue_info_routes

    engine = _create_engine(tmp_path)
    store = engine._store
    monkeypatch.setattr(location_scorer_routes, "queue_engine", engine)
    monkeypatch.setattr(location_scorer_routes, "queue_store", store)
    monkeypatch.setattr(queue_info_routes, "queue_engine", engine)
    return engine, store


@pytest.mark.integration
def test_start_job_returns_expected_shape(client, monkeypatch: pytest.MonkeyPatch, location_queue_override) -> None:
    from src.routes import location_scorer as location_scorer_routes

    engine, _store = location_queue_override

    def fake_runner(limit: int | None):
        def _run(context) -> None:
            return None

        return _run

    monkeypatch.setattr(location_scorer_routes, "create_location_scorer_runner", fake_runner)

    response = client.post("/location-scorer/start-job", json={"limit": 5})

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert response.json()["endpointName"] == location_scorer_routes.LOCATION_SCORER_ENDPOINT_NAME
    assert isinstance(response.json()["jobId"], str)
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_start_job_without_limit_enqueues_location_scorer(
    client,
    monkeypatch: pytest.MonkeyPatch,
    location_queue_override,
) -> None:
    from src.routes import location_scorer as location_scorer_routes

    engine, _store = location_queue_override

    def fake_runner(limit: int | None):
        assert limit is None

        def _run(context) -> None:
            return None

        return _run

    monkeypatch.setattr(location_scorer_routes, "create_location_scorer_runner", fake_runner)

    response = client.post("/location-scorer/start-job", json={})

    assert response.status_code == 202
    latest = client.get(
        "/queue-info/latest-job",
        params={"endpointName": location_scorer_routes.LOCATION_SCORER_ENDPOINT_NAME},
    )
    assert latest.status_code == 200
    assert latest.json()["job"]["jobId"] == response.json()["jobId"]
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_location_scorer_job_supports_queue_cancel(
    client,
    monkeypatch: pytest.MonkeyPatch,
    location_queue_override,
) -> None:
    from src.routes import location_scorer as location_scorer_routes

    engine, _store = location_queue_override
    started_event = Event()

    def fake_runner(limit: int | None):
        def _run(context) -> None:
            started_event.set()
            while not context.is_cancel_requested():
                sleep(0.01)
            raise QueueJobCanceledError()

        return _run

    monkeypatch.setattr(location_scorer_routes, "create_location_scorer_runner", fake_runner)

    response = client.post("/location-scorer/start-job", json={"limit": 20})
    assert response.status_code == 202
    job_id = response.json()["jobId"]
    assert started_event.wait(timeout=1) is True

    cancel_response = client.post(f"/queue-info/cancel-job/{job_id}")

    assert cancel_response.status_code == 200
    assert cancel_response.json() == {"jobId": job_id, "outcome": "cancel_requested"}
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_start_job_rejects_unknown_fields(client) -> None:
    response = client.post("/location-scorer/start-job", json={"unexpected": True})

    assert response.status_code == 422


@pytest.mark.integration
def test_main_import_fails_when_location_scorer_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import src.main as main_module

    monkeypatch.delenv("NAME_AI_ENTITY_LOCATION_SCORER", raising=False)

    with pytest.raises(SystemExit):
        importlib.reload(main_module)

    monkeypatch.setenv(
        "NAME_AI_ENTITY_LOCATION_SCORER",
        "NewsNexusClassifierLocationScorer01",
    )
    importlib.reload(main_module)
