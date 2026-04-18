import pytest

from src.modules.queue.engine import GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.services.job_manager import JobManager
from tests.postgres_test_utils import execute_many, execute_statements, reset_public_schema


def _create_job_manager(tmp_path) -> JobManager:
    store = QueueJobStore(tmp_path / "worker-python" / "queue-jobs.json")
    engine = GlobalQueueEngine(store)
    return JobManager(queue_engine=engine, queue_store=store)


@pytest.mark.integration
def test_home_route(client) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "News Nexus Python Queuer 01" in response.text


@pytest.mark.integration
def test_test_route_echoes_json(client) -> None:
    payload = {"ok": True, "reportId": 42}

    response = client.post("/test", json=payload)

    assert response.status_code == 200
    assert response.json() == payload


@pytest.mark.integration
def test_create_job_and_fetch_status(client, monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from src.routes import deduper as deduper_routes

    test_job_manager = _create_job_manager(tmp_path)
    monkeypatch.setattr(
        deduper_routes.job_manager,
        "enqueue_deduper_job",
        test_job_manager.enqueue_deduper_job,
    )
    monkeypatch.setattr(deduper_routes, "job_manager", test_job_manager)

    create_response = client.get("/deduper/jobs")

    assert create_response.status_code == 201
    job_id = create_response.json()["jobId"]
    assert isinstance(job_id, str)
    assert create_response.json()["status"] == "queued"

    status_response = client.get(f"/deduper/jobs/{job_id}")

    assert status_response.status_code == 200
    body = status_response.json()
    assert body["jobId"] == job_id
    assert body["status"] in {"queued", "running"}


@pytest.mark.integration
def test_cancel_unknown_job(client) -> None:
    response = client.post("/deduper/jobs/999/cancel")

    assert response.status_code == 404
    assert response.json()["error"] == "Job not found"


@pytest.mark.integration
def test_clear_db_table_missing_env_returns_500(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PG_HOST", raising=False)

    response = client.delete("/deduper/clear-db-table")

    assert response.status_code == 500
    assert "PG_HOST is required" in response.json()["error"]


@pytest.mark.integration
def test_clear_db_table_in_process_success(client, monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    reset_public_schema()
    execute_statements(
        [
            """
            CREATE TABLE "ArticleDuplicateAnalyses" (
                id SERIAL PRIMARY KEY
            )
            """,
            "INSERT INTO \"ArticleDuplicateAnalyses\" DEFAULT VALUES",
        ]
    )

    response = client.delete("/deduper/clear-db-table")

    assert response.status_code == 200
    body = response.json()
    assert body["cleared"] is True
    assert body["exitCode"] == 0


@pytest.mark.integration
def test_report_job_runs_deduper_in_process_e2e(
    client, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    from src.routes import deduper as deduper_routes
    from src.routes import queue_info as queue_info_routes

    reset_public_schema()
    execute_statements(
        [
            """
            CREATE TABLE "Articles" (
                id INTEGER PRIMARY KEY,
                url TEXT,
                title TEXT,
                description TEXT,
                "publishedDate" TEXT
            )
            """,
            """
            CREATE TABLE "ArticleApproveds" (
                "articleId" INTEGER,
                "isApproved" BOOLEAN,
                "headlineForPdfReport" TEXT,
                "textForPdfReport" TEXT
            )
            """,
            """
            CREATE TABLE "ArticleReportContracts" (
                "articleId" INTEGER,
                "reportId" INTEGER
            )
            """,
            """
            CREATE TABLE "States" (
                id INTEGER PRIMARY KEY,
                abbreviation TEXT
            )
            """,
            """
            CREATE TABLE "ArticleStateContracts" (
                "articleId" INTEGER,
                "stateId" INTEGER
            )
            """,
            """
            CREATE TABLE "ArticleDuplicateAnalyses" (
                id SERIAL PRIMARY KEY,
                "articleIdNew" INTEGER,
                "articleIdApproved" INTEGER,
                "reportId" INTEGER,
                "sameArticleIdFlag" INTEGER,
                "articleNewState" TEXT DEFAULT '',
                "articleApprovedState" TEXT DEFAULT '',
                "sameStateFlag" INTEGER DEFAULT 0,
                "urlCheck" INTEGER DEFAULT 0,
                "contentHash" DOUBLE PRECISION DEFAULT 0,
                "embeddingSearch" DOUBLE PRECISION DEFAULT 0,
                "createdAt" TIMESTAMPTZ,
                "updatedAt" TIMESTAMPTZ
            )
            """,
        ]
    )

    execute_many(
        'INSERT INTO "Articles"(id, url, title, description, "publishedDate") VALUES(%s, %s, %s, %s, %s)',
        [
            (1, "https://example.com/news?id=1", "T1", "D1", "2026-01-01"),
            (2, "https://example.com/news?id=2", "T2", "D2", "2026-01-02"),
        ],
    )
    execute_many(
        'INSERT INTO "ArticleApproveds"("articleId", "isApproved", "headlineForPdfReport", "textForPdfReport") VALUES(%s, %s, %s, %s)',
        [
            (1, True, "H1", "match content"),
            (2, True, "H2", "match content"),
        ],
    )
    execute_many(
        'INSERT INTO "ArticleReportContracts"("articleId", "reportId") VALUES(%s, %s)',
        [(1, 10)],
    )
    execute_many(
        'INSERT INTO "States"(id, abbreviation) VALUES(%s, %s)',
        [(1, "CA"), (2, "CA")],
    )
    execute_many(
        'INSERT INTO "ArticleStateContracts"("articleId", "stateId") VALUES(%s, %s)',
        [(1, 1), (2, 2)],
    )
    monkeypatch.setenv("DEDUPER_ENABLE_EMBEDDING", "false")
    test_job_manager = _create_job_manager(tmp_path)
    monkeypatch.setattr(deduper_routes, "job_manager", test_job_manager)
    monkeypatch.setattr(queue_info_routes, "queue_engine", test_job_manager.queue_engine)

    create_response = client.get("/deduper/jobs/reportId/10")
    assert create_response.status_code == 201
    job_id = create_response.json()["jobId"]
    assert isinstance(job_id, str)

    assert test_job_manager.wait_for_idle(timeout=2) is True

    status_response = client.get(f"/deduper/jobs/{job_id}")
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["status"] == "completed"
    assert body["exitCode"] == 0


@pytest.mark.integration
def test_deduper_job_is_visible_through_queue_info_latest_job(
    client, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    from src.routes import deduper as deduper_routes
    from src.routes import queue_info as queue_info_routes

    test_job_manager = _create_job_manager(tmp_path)
    monkeypatch.setattr(deduper_routes, "job_manager", test_job_manager)
    monkeypatch.setattr(queue_info_routes, "queue_engine", test_job_manager.queue_engine)

    create_response = client.get("/deduper/jobs")
    assert create_response.status_code == 201

    response = client.get(
        "/queue-info/latest-job",
        params={"endpointName": test_job_manager.DEDUPER_ENDPOINT_NAME},
    )

    assert response.status_code == 200
    assert response.json()["job"]["jobId"] == create_response.json()["jobId"]
