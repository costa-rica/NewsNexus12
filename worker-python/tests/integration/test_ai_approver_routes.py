from __future__ import annotations

import importlib
from threading import Event
from time import sleep

import pytest

from src.modules.ai_approver.errors import AiApproverConfigError
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


def _install_runner_fakes(monkeypatch: pytest.MonkeyPatch, summary: dict):
    from types import SimpleNamespace

    from src.routes import ai_approver as ai_approver_routes

    sentinel_config = object()
    sentinel_client = object()
    factory_calls: list[object] = []
    orchestrator_clients: list[object] = []

    class FakeConfig:
        default_mode = "legacy"
        gatekeeper_reject_confidence_threshold = 0.85

        @staticmethod
        def from_env():
            fake = SimpleNamespace(
                default_mode="legacy",
                gatekeeper_reject_confidence_threshold=0.85,
                sentinel=sentinel_config,
            )
            return fake

    class FakeRepository:
        def __init__(self, config) -> None:
            self.config = config

        def close(self) -> None:
            pass

    def fake_factory(config):
        factory_calls.append(config)
        return sentinel_client

    class FakeOrchestrator:
        def __init__(self, repository, client) -> None:
            orchestrator_clients.append(client)

        def run_score(self, **kwargs):
            return summary

        def run_single_score(self, **kwargs):
            return summary

    monkeypatch.setattr(ai_approver_routes, "AiApproverConfig", FakeConfig)
    monkeypatch.setattr(ai_approver_routes, "AiApproverRepository", FakeRepository)
    monkeypatch.setattr(ai_approver_routes, "create_ai_approver_client", fake_factory)
    monkeypatch.setattr(ai_approver_routes, "AiApproverOrchestrator", FakeOrchestrator)
    monkeypatch.setattr(ai_approver_routes, "_append_job_log", lambda *a, **k: None)
    monkeypatch.setattr(ai_approver_routes, "_update_job_result_fields", lambda *a, **k: None)

    context = SimpleNamespace(jobId="0001", is_cancel_requested=lambda: False)
    return context, factory_calls, orchestrator_clients, sentinel_client


@pytest.mark.integration
def test_batch_runner_uses_client_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.routes import ai_approver as ai_approver_routes

    summary = {
        "promptCount": 1,
        "articleCount": 1,
        "attemptCount": 1,
        "mode": "legacy",
        "gatekeeperPromptVersionId": None,
        "gatekeeperAttemptCount": 0,
        "gatekeeperPassCount": 0,
        "gatekeeperRejectCount": 0,
        "gatekeeperManualReviewCount": 0,
        "gatekeeperInvalidResponseCount": 0,
        "gatekeeperFailedCount": 0,
        "categoryPromptCount": 1,
        "categoryAttemptCount": 1,
        "categorySkippedCount": 0,
        "estimatedCategoryCallsAvoided": 0,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
    context, factory_calls, orchestrator_clients, sentinel_client = _install_runner_fakes(
        monkeypatch, summary
    )

    runner = ai_approver_routes.create_ai_approver_runner(
        limit=1,
        require_state_assignment=True,
        state_ids=None,
    )
    runner(context)

    assert len(factory_calls) == 1
    assert orchestrator_clients == [sentinel_client]


@pytest.mark.integration
def test_review_page_runner_uses_client_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.routes import ai_approver as ai_approver_routes

    summary = {
        "promptCount": 1,
        "articleCount": 1,
        "attemptCount": 1,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "contentSource": "articleContents02",
    }
    context, factory_calls, orchestrator_clients, sentinel_client = _install_runner_fakes(
        monkeypatch, summary
    )

    runner = ai_approver_routes.create_review_page_ai_approver_runner(
        article_id=1,
        prompt_version_id=1,
    )
    runner(context)

    assert len(factory_calls) == 1
    assert orchestrator_clients == [sentinel_client]


@pytest.mark.integration
def test_direct_v01_job_fails_clearly_when_config_is_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from src.routes import ai_approver as ai_approver_routes

    observed: dict[str, object] = {}
    monkeypatch.setattr(
        ai_approver_routes.AiApproverConfig,
        "from_env",
        lambda: (_ for _ in ()).throw(
            AiApproverConfigError("V01 configuration is invalid")
        ),
    )
    monkeypatch.setattr(
        ai_approver_routes,
        "_update_job_result_fields",
        lambda _job_id, fields: observed.update(fields),
    )
    monkeypatch.setattr(
        ai_approver_routes,
        "_append_job_log",
        lambda *args, **kwargs: None,
    )
    runner = ai_approver_routes.create_ai_approver_runner(
        limit=1,
        require_state_assignment=True,
        state_ids=None,
    )

    with pytest.raises(AiApproverConfigError, match="V01 configuration is invalid"):
        runner(
            SimpleNamespace(
                jobId="0001",
                is_cancel_requested=lambda: False,
            )
        )

    assert observed["statusText"] == "failed"
    assert observed["error"] == "V01 configuration is invalid"


@pytest.mark.integration
def test_main_import_startup_backend_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import dotenv
    import src.main as main_module
    import src.modules.ai_approver.config as ai_approver_config
    import src.modules.ai_approver_v02.config as ai_approver_v02_config

    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)
    monkeypatch.setattr(
        ai_approver_v02_config,
        "validate_ai_approver_v02_startup_env",
        lambda: None,
    )

    # Invalid V01-only configuration is now a nonfatal startup warning.
    monkeypatch.setattr(
        ai_approver_config,
        "validate_ai_approver_startup_env",
        lambda: (_ for _ in ()).throw(RuntimeError("invalid V01 config")),
    )
    importlib.reload(main_module)

    # Invalid V02 configuration remains fatal.
    monkeypatch.setattr(
        ai_approver_v02_config,
        "validate_ai_approver_v02_startup_env",
        lambda: (_ for _ in ()).throw(RuntimeError("invalid V02 config")),
    )
    with pytest.raises(SystemExit):
        importlib.reload(main_module)

    # Restore the forced test bootstrap state.
    monkeypatch.setattr(
        ai_approver_v02_config,
        "validate_ai_approver_v02_startup_env",
        lambda: None,
    )
    monkeypatch.setattr(
        ai_approver_config,
        "validate_ai_approver_startup_env",
        lambda: None,
    )
    importlib.reload(main_module)
