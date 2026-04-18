from __future__ import annotations

import os

from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.repository import AiApproverRepository
from tests.postgres_test_utils import execute_many, execute_statements, reset_public_schema


def _build_config() -> AiApproverConfig:
    return AiApproverConfig(
        pg_host=os.getenv("PG_HOST", "localhost"),
        pg_port=int(os.getenv("PG_PORT", "5432")),
        pg_database=os.getenv("PG_DATABASE", "newsnexus_test_worker_python"),
        pg_user=os.getenv("PG_USER", "nick"),
        pg_password=os.getenv("PG_PASSWORD", ""),
        openai_api_key="secret",
        model_name="gpt-4o-mini",
        batch_size=10,
    )


def _create_repo() -> AiApproverRepository:
    reset_public_schema()
    execute_statements(
        [
            """
            CREATE TABLE "Articles" (
                id INTEGER PRIMARY KEY,
                title TEXT,
                description TEXT
            )
            """,
            """
            CREATE TABLE "ArticleContents02" (
                id INTEGER PRIMARY KEY,
                "articleId" INTEGER,
                content TEXT,
                status TEXT
            )
            """,
            """
            CREATE TABLE "ArticleIsRelevants" (
                id INTEGER PRIMARY KEY,
                "articleId" INTEGER,
                "isRelevant" BOOLEAN
            )
            """,
            """
            CREATE TABLE "ArticleApproveds" (
                id INTEGER PRIMARY KEY,
                "articleId" INTEGER,
                "isApproved" BOOLEAN
            )
            """,
            """
            CREATE TABLE "ArticleStateContracts02" (
                id INTEGER PRIMARY KEY,
                "articleId" INTEGER,
                "stateId" INTEGER,
                "isDeterminedToBeError" BOOLEAN
            )
            """,
            """
            CREATE TABLE "AiApproverPromptVersions" (
                id INTEGER PRIMARY KEY,
                name TEXT,
                description TEXT,
                "promptInMarkdown" TEXT,
                "isActive" BOOLEAN,
                "endedAt" TIMESTAMPTZ
            )
            """,
            """
            CREATE TABLE "AiApproverArticleScores" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER,
                "promptVersionId" INTEGER,
                "resultStatus" TEXT,
                score DOUBLE PRECISION,
                reason TEXT,
                "errorCode" TEXT,
                "errorMessage" TEXT,
                "isHumanApproved" BOOLEAN,
                "reasonHumanRejected" TEXT,
                "jobId" TEXT,
                "createdAt" TIMESTAMPTZ,
                "updatedAt" TIMESTAMPTZ
            )
            """,
        ]
    )
    execute_many(
        'INSERT INTO "Articles"(id, title, description) VALUES (%s, %s, %s)',
        [
            (1, "A1", "D1"),
            (2, "A2", "D2"),
            (3, "A3", "D3"),
            (4, "A4", "D4"),
            (5, "A5", "D5"),
        ],
    )
    execute_many(
        'INSERT INTO "ArticleContents02"(id, "articleId", content, status) VALUES (%s, %s, %s, %s)',
        [(1, 1, "C1", "success"), (2, 2, "C2", "success")],
    )
    execute_many(
        'INSERT INTO "ArticleIsRelevants"(id, "articleId", "isRelevant") VALUES (%s, %s, %s)',
        [(1, 3, False)],
    )
    execute_many(
        'INSERT INTO "ArticleApproveds"(id, "articleId", "isApproved") VALUES (%s, %s, %s)',
        [(1, 4, True), (2, 5, False)],
    )
    execute_many(
        'INSERT INTO "ArticleStateContracts02"(id, "articleId", "stateId", "isDeterminedToBeError") VALUES (%s, %s, %s, %s)',
        [(1, 1, 5, False), (2, 2, 7, False), (3, 3, None, False), (4, 4, 5, False)],
    )
    execute_many(
        'INSERT INTO "AiApproverPromptVersions"(id, name, description, "promptInMarkdown", "isActive", "endedAt") VALUES (%s, %s, %s, %s, %s, %s)',
        [(1, "P1", None, "# T1", True, None), (2, "P2", None, "# T2", False, None)],
    )
    execute_many(
        """
        INSERT INTO "AiApproverArticleScores"(
            id, "articleId", "promptVersionId", "resultStatus", score, reason,
            "errorCode", "errorMessage", "isHumanApproved", "reasonHumanRejected", "jobId", "createdAt", "updatedAt"
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        [(100, 2, 1, "completed", 0.7, "done", None, None, None, None, "1")],
    )
    return AiApproverRepository(_build_config())


def test_get_active_prompt_versions() -> None:
    repo = _create_repo()
    try:
        prompts = repo.get_active_prompt_versions()
    finally:
        repo.close()

    assert len(prompts) == 1
    assert prompts[0]["id"] == 1


def test_get_prompt_version_by_id_returns_prompt_row() -> None:
    repo = _create_repo()
    try:
        prompt = repo.get_prompt_version_by_id(1)
    finally:
        repo.close()

    assert prompt is not None
    assert prompt["id"] == 1
    assert prompt["promptInMarkdown"] == "# T1"


def test_get_eligible_articles_filters_by_existing_scores_and_state() -> None:
    repo = _create_repo()
    try:
        rows = repo.get_eligible_articles(
            limit=10,
            require_state_assignment=True,
            state_ids=[5],
        )
    finally:
        repo.close()

    assert [row["id"] for row in rows] == [1]
    assert rows[0]["content"] == "C1"


def test_get_eligible_articles_excludes_not_relevant_and_any_human_decision() -> None:
    repo = _create_repo()
    try:
        rows = repo.get_eligible_articles(
            limit=10,
            require_state_assignment=False,
            state_ids=None,
        )
    finally:
        repo.close()

    assert [row["id"] for row in rows] == [1]


def test_get_article_for_prompt_run_prefers_article_contents_02() -> None:
    repo = _create_repo()
    try:
        article = repo.get_article_for_prompt_run(1)
    finally:
        repo.close()

    assert article is not None
    assert article["id"] == 1
    assert article["content"] == "C1"
    assert article["contentSource"] == "article-contents-02"


def test_get_article_for_prompt_run_falls_back_to_article_description() -> None:
    repo = _create_repo()
    try:
        article = repo.get_article_for_prompt_run(5)
    finally:
        repo.close()

    assert article is not None
    assert article["id"] == 5
    assert article["content"] == "D5"
    assert article["contentSource"] == "article-description"


def test_insert_score_row_persists_result() -> None:
    repo = _create_repo()
    try:
        repo.insert_score_row(
            article_id=1,
            prompt_version_id=1,
            result_status="completed",
            score=0.91,
            reason="clear match",
            error_code=None,
            error_message=None,
            job_id="job-1",
        )
        rows = repo.get_connection().execute(
            'SELECT "articleId", "promptVersionId", "resultStatus", score, reason, "jobId" FROM "AiApproverArticleScores" WHERE "jobId" = %s',
            ("job-1",),
        ).fetchall()
    finally:
        repo.close()

    assert len(rows) == 1
    assert dict(rows[0])["articleId"] == 1
