from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.modules.ai_approver_v02.errors import (
    AiApproverV02BoundaryUnavailableError,
    AiApproverV02NoEligibleArticlesError,
)


class FakeRepository:
    def __init__(self) -> None:
        self.config = object()
        self.accepted: tuple[int, str] | None = None
        self.attached: tuple[int, str] | None = None
        self.finished: tuple[int, str, str | None] | None = None
        self.preview_args = None

    def close(self) -> None:
        pass

    def create_preview(self, **kwargs):
        self.preview_args = kwargs
        assert kwargs["selection_mode"] == "article_position_count"
        return {
            "id": 41,
            "status": "draft",
            "jobId": None,
            "selectionMode": kwargs["selection_mode"],
            "requestedArticleCount": kwargs["requested_article_count"],
            "allowPastApprovedBoundary": kwargs["allow_past_approved_boundary"],
            "allowDescriptionFallback": kwargs["allow_description_fallback"],
            "plannedEligibleCount": 2,
            "selectionSnapshot": [
                {"articleId": 101, "contentSource": "article_contents_02"},
                {"articleId": 100, "contentSource": "description"},
            ],
            "previewToken": "preview-secret",
            "createdAt": "2026-10-06T18:00:00Z",
            "previewExpiresAt": "2026-10-06T18:15:00Z",
        }

    def accept_preview(self, run_id: int, token: str):
        self.accepted = (run_id, token)
        return {"id": run_id, "status": "queued"}

    def attach_job_id(self, run_id: int, job_id: str):
        self.attached = (run_id, job_id)

    def mark_enqueue_failed(self, run_id: int):
        self.finished = (run_id, "failed", "queue_submission_failed")

    def get_latest_execution_run(self):
        return {"id": 41, "status": "completed"}

    def get_run(self, run_id: int, *, include_preview: bool):
        assert include_preview is False
        return {
            "id": run_id,
            "status": "running",
            "jobId": "0007",
            "selectionMode": "article_position_count",
            "requestedArticleCount": 25,
            "allowPastApprovedBoundary": True,
            "allowDescriptionFallback": True,
            "plannedEligibleCount": 2,
            "attemptedCount": 1,
            "completedCount": 1,
            "failedCount": 0,
            "invalidResponseCount": 0,
            "skippedCount": 0,
            "endingReason": None,
            "previewToken": None,
            "createdAt": "2026-10-06T18:00:00Z",
            "startedAt": "2026-10-06T18:01:00Z",
            "endedAt": None,
        }

    def finish_run(self, run_id: int, status: str, reason: str | None):
        self.finished = (run_id, status, reason)


class FakeQueue:
    def __init__(self) -> None:
        self.enqueued = None

    def enqueue_job(self, input_data):
        self.enqueued = input_data
        return SimpleNamespace(jobId="0007", status="queued")

    def get_check_status(self, job_id: str):
        return {
            "jobId": job_id,
            "endpointName": "/ai-approver-v02/start",
            "status": "running",
            "createdAt": "2026-10-06T18:00:30Z",
            "startedAt": "2026-10-06T18:01:00Z",
            "endedAt": None,
            "parameters": {"runId": 41},
        }

    def cancel_job(self, job_id: str):
        return SimpleNamespace(jobId=job_id, outcome="cancel_requested")


@pytest.fixture
def v02_route_fakes(monkeypatch: pytest.MonkeyPatch):
    from src.routes import ai_approver_v02 as routes

    repository = FakeRepository()
    queue = FakeQueue()
    monkeypatch.setattr(routes, "_repository", lambda: repository)
    monkeypatch.setattr(routes, "queue_engine", queue)
    return repository, queue


@pytest.mark.integration
def test_v02_preview_route_returns_draft(client, v02_route_fakes) -> None:
    repository, _ = v02_route_fakes
    response = client.post(
        "/ai-approver-v02/preview",
        json={
            "selectionMode": "article_position_count",
            "requestedArticleCount": 25,
            "allowPastApprovedBoundary": True,
            "allowDescriptionFallback": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["previewToken"] == "preview-secret"
    assert response.json()["plannedEligibleCount"] == 2
    assert repository.preview_args == {
        "selection_mode": "article_position_count",
        "requested_article_count": 25,
        "allow_past_approved_boundary": True,
        "allow_description_fallback": True,
    }


@pytest.mark.integration
def test_v02_start_queues_database_run_id(client, v02_route_fakes) -> None:
    repository, queue = v02_route_fakes
    response = client.post(
        "/ai-approver-v02/start",
        json={"runId": 41, "previewToken": "preview-secret"},
    )

    assert response.status_code == 202
    assert response.json() == {"runId": 41, "jobId": "0007", "status": "queued"}
    assert repository.accepted == (41, "preview-secret")
    assert repository.attached == (41, "0007")
    assert queue.enqueued.parameters == {"runId": 41}


@pytest.mark.integration
def test_v02_status_and_cancel_routes(client, v02_route_fakes) -> None:
    latest = client.get("/ai-approver-v02/runs/latest")
    detail = client.get("/ai-approver-v02/runs/41")
    cancel = client.post("/ai-approver-v02/runs/41/cancel")

    assert latest.status_code == 200
    assert latest.json()["status"] == "completed"
    body = detail.json()
    assert body["run"]["id"] == 41
    assert body["run"]["plannedEligibleCount"] == 2
    assert body["run"]["attemptedCount"] == 1
    assert body["run"]["completedCount"] == 1
    assert body["run"]["previewToken"] is None
    assert body["queueStatus"]["jobId"] == "0007"
    assert body["queueStatus"]["endpointName"] == "/ai-approver-v02/start"
    assert body["queueStatus"]["parameters"] == {"runId": 41}
    assert cancel.json()["outcome"] == "cancel_requested"


@pytest.mark.integration
def test_v02_preview_route_returns_typed_zero_work(
    client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.routes import ai_approver_v02 as routes

    class NoEligibleRepository(FakeRepository):
        def create_preview(self, **kwargs):
            raise AiApproverV02NoEligibleArticlesError("No eligible Articles were found")

    monkeypatch.setattr(routes, "_repository", lambda: NoEligibleRepository())
    response = client.post(
        "/ai-approver-v02/preview",
        json={
            "selectionMode": "article_position_count",
            "requestedArticleCount": 25,
            "allowPastApprovedBoundary": True,
            "allowDescriptionFallback": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["error"] == "no_eligible_articles"


@pytest.mark.integration
def test_v02_route_returns_typed_errors(
    client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.routes import ai_approver_v02 as routes

    class BoundaryRepository(FakeRepository):
        def create_preview(self, **kwargs):
            raise AiApproverV02BoundaryUnavailableError(
                "Mode B requires an approved article boundary"
            )

    repository = BoundaryRepository()
    monkeypatch.setattr(routes, "_repository", lambda: repository)
    response = client.post(
        "/ai-approver-v02/preview",
        json={"selectionMode": "until_last_approved"},
    )

    assert response.status_code == 400
    assert response.json()["error"] == "approved_boundary_unavailable"
