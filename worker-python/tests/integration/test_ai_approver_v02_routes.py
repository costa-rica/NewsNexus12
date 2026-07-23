from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.modules.ai_approver_v02.errors import (
    AiApproverV02BoundaryUnavailableError,
)


class FakeRepository:
    def __init__(self) -> None:
        self.config = object()
        self.accepted: tuple[int, str] | None = None
        self.attached: tuple[int, str] | None = None
        self.finished: tuple[int, str, str | None] | None = None

    def close(self) -> None:
        pass

    def create_preview(self, **kwargs):
        assert kwargs["selection_mode"] == "article_position_count"
        return {
            "id": 41,
            "status": "draft",
            "plannedEligibleCount": 2,
            "previewToken": "preview-secret",
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
        return {"id": run_id, "status": "running", "jobId": "0007"}

    def finish_run(self, run_id: int, status: str, reason: str | None):
        self.finished = (run_id, status, reason)


class FakeQueue:
    def __init__(self) -> None:
        self.enqueued = None

    def enqueue_job(self, input_data):
        self.enqueued = input_data
        return SimpleNamespace(jobId="0007", status="queued")

    def get_check_status(self, job_id: str):
        return {"jobId": job_id, "status": "running"}

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
    response = client.post(
        "/ai-approver-v02/preview",
        json={
            "selectionMode": "article_position_count",
            "requestedArticleCount": 25,
        },
    )

    assert response.status_code == 200
    assert response.json()["previewToken"] == "preview-secret"
    assert response.json()["plannedEligibleCount"] == 2


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
    assert detail.json()["queueStatus"]["jobId"] == "0007"
    assert cancel.json()["outcome"] == "cancel_requested"


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
