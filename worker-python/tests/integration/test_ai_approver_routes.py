from __future__ import annotations

import importlib
from threading import Event
from time import sleep

import pytest

from src.modules.queue.engine import GlobalQueueEngine, QueueJobCanceledError
from src.modules.queue.store import QueueJobStore


def _create_engine(tmp_path) -> GlobalQueueEngine:
    return GlobalQueueEngine(QueueJobStore(tmp_path / "worker-python" / "queue-jobs.json"))


@pytest.fixture
def ai_approver_queue_override(monkeypatch: pytest.MonkeyPatch, tmp_path):
    from src.routes import ai_approver as ai_approver_routes
    from src.routes import queue_info as queue_info_routes

    engine = _create_engine(tmp_path)
    store = engine._store
    monkeypatch.setattr(ai_approver_routes, "queue_engine", engine)
    monkeypatch.setattr(ai_approver_routes, "queue_store", store)
    monkeypatch.setattr(queue_info_routes, "queue_engine", engine)
    return engine, store


@pytest.mark.integration
def test_start_job_returns_expected_shape(client, monkeypatch: pytest.MonkeyPatch, ai_approver_queue_override) -> None:
    from src.routes import ai_approver as ai_approver_routes

    engine, _store = ai_approver_queue_override

    def fake_runner(
        limit: int,
        require_state_assignment: bool,
        state_ids: list[int] | None,
        mode: str | None = None,
        gatekeeper_reject_confidence_threshold: float | None = None,
        article_id_min_exclusive: int | None = None,
        article_id_max_inclusive: int | None = None,
        continuation_retry_policy: dict[str, object] | None = None,
    ):
        assert limit == 5
        assert require_state_assignment is True
        assert state_ids == [1, 2]
        assert mode is None
        assert gatekeeper_reject_confidence_threshold is None
        assert article_id_min_exclusive is None
        assert article_id_max_inclusive is None
        assert continuation_retry_policy is None

        def _run(context) -> None:
            return None

        return _run

    monkeypatch.setattr(ai_approver_routes, "create_ai_approver_runner", fake_runner)

    response = client.post(
        "/ai-approver/start-job",
        json={"limit": 5, "requireStateAssignment": True, "stateIds": [1, 2]},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert response.json()["endpointName"] == ai_approver_routes.AI_APPROVER_ENDPOINT_NAME
    assert isinstance(response.json()["jobId"], str)
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_review_page_start_job_returns_expected_shape(
    client,
    monkeypatch: pytest.MonkeyPatch,
    ai_approver_queue_override,
) -> None:
    from src.routes import ai_approver as ai_approver_routes

    engine, _store = ai_approver_queue_override

    def fake_runner(article_id: int, prompt_version_id: int):
        assert article_id == 77
        assert prompt_version_id == 456

        def _run(context) -> None:
            return None

        return _run

    monkeypatch.setattr(
        ai_approver_routes,
        "create_review_page_ai_approver_runner",
        fake_runner,
    )

    response = client.post(
        "/ai-approver/review-page/start-job",
        json={"articleId": 77, "promptVersionId": 456},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert (
        response.json()["endpointName"]
        == ai_approver_routes.AI_APPROVER_REVIEW_PAGE_ENDPOINT_NAME
    )
    assert isinstance(response.json()["jobId"], str)
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_start_job_rejects_unknown_fields(client) -> None:
    response = client.post("/ai-approver/start-job", json={"unexpected": True})

    assert response.status_code == 422


@pytest.mark.integration
def test_start_job_accepts_continuation_retry_policy(
    client,
    monkeypatch: pytest.MonkeyPatch,
    ai_approver_queue_override,
) -> None:
    from src.routes import ai_approver as ai_approver_routes

    engine, _store = ai_approver_queue_override

    def fake_runner(
        limit: int,
        require_state_assignment: bool,
        state_ids: list[int] | None,
        mode: str | None = None,
        gatekeeper_reject_confidence_threshold: float | None = None,
        article_id_min_exclusive: int | None = None,
        article_id_max_inclusive: int | None = None,
        continuation_retry_policy: dict[str, object] | None = None,
    ):
        assert limit == 150
        assert require_state_assignment is True
        assert state_ids is None
        assert mode == "gatekeeper"
        assert article_id_min_exclusive == 1000
        assert article_id_max_inclusive == 1150
        assert continuation_retry_policy == {
            "mode": "gatekeeper",
            "retryTransientFailures": True,
            "retryInvalidResponses": False,
        }

        def _run(context) -> None:
            return None

        return _run

    monkeypatch.setattr(ai_approver_routes, "create_ai_approver_runner", fake_runner)

    response = client.post(
        "/ai-approver/start-job",
        json={
            "limit": 150,
            "requireStateAssignment": True,
            "mode": "gatekeeper",
            "articleIdMinExclusive": 1000,
            "articleIdMaxInclusive": 1150,
            "continuationRetryPolicy": {
                "mode": "gatekeeper",
                "retryTransientFailures": True,
                "retryInvalidResponses": False,
            },
        },
    )

    assert response.status_code == 202
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_review_page_start_job_rejects_unknown_fields(client) -> None:
    response = client.post(
        "/ai-approver/review-page/start-job",
        json={"articleId": 77, "promptVersionId": 456, "unexpected": True},
    )

    assert response.status_code == 422


@pytest.mark.integration
def test_ai_approver_job_supports_queue_cancel(
    client,
    monkeypatch: pytest.MonkeyPatch,
    ai_approver_queue_override,
) -> None:
    from src.routes import ai_approver as ai_approver_routes

    engine, _store = ai_approver_queue_override
    started_event = Event()

    def fake_runner(
        limit: int,
        require_state_assignment: bool,
        state_ids: list[int] | None,
        mode: str | None = None,
        gatekeeper_reject_confidence_threshold: float | None = None,
        article_id_min_exclusive: int | None = None,
        article_id_max_inclusive: int | None = None,
        continuation_retry_policy: dict[str, object] | None = None,
    ):
        def _run(context) -> None:
            started_event.set()
            while not context.is_cancel_requested():
                sleep(0.01)
            raise QueueJobCanceledError()

        return _run

    monkeypatch.setattr(ai_approver_routes, "create_ai_approver_runner", fake_runner)

    response = client.post("/ai-approver/start-job", json={"limit": 2})
    assert response.status_code == 202
    job_id = response.json()["jobId"]
    assert started_event.wait(timeout=1) is True

    cancel_response = client.post(f"/queue-info/cancel-job/{job_id}")

    assert cancel_response.status_code == 200
    assert cancel_response.json() == {"jobId": job_id, "outcome": "cancel_requested"}
    assert engine.on_idle(timeout=1) is True


@pytest.mark.integration
def test_main_import_fails_when_ai_approver_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import dotenv
    import src.main as main_module

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(SystemExit):
        importlib.reload(main_module)

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    importlib.reload(main_module)
