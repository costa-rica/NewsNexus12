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
        default_mode="gatekeeper",
        gatekeeper_reject_confidence_threshold=0.85,
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
                "endedAt" TIMESTAMPTZ,
                "promptRole" TEXT DEFAULT 'category_score',
                "promptKey" TEXT,
                "pipelineVersion" TEXT,
                "responseSchemaVersion" TEXT,
                "modelName" TEXT
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
                "promptRole" TEXT DEFAULT 'category_score',
                "pipelineVersion" TEXT,
                decision TEXT,
                confidence DOUBLE PRECISION,
                "reasonCode" TEXT,
                metadata JSONB,
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
        'INSERT INTO "AiApproverPromptVersions"(id, name, description, "promptInMarkdown", "isActive", "endedAt", "promptRole") VALUES (%s, %s, %s, %s, %s, %s, %s)',
        [
            (1, "P1", None, "# T1", True, None, "category_score"),
            (2, "P2", None, "# T2", False, None, "category_score"),
            (3, "Gatekeeper", None, "# G1", True, None, "gatekeeper"),
        ],
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


def test_get_retryable_score_rows_selects_transient_failures_inside_bounds() -> None:
    repo = _create_repo()
    try:
        repo.get_connection().execute(
            """
            INSERT INTO "AiApproverArticleScores"(
                id, "articleId", "promptVersionId", "resultStatus", "errorCode",
                "errorMessage", "jobId", metadata, "promptRole", "createdAt", "updatedAt"
            )
            VALUES
                (101, 1, 3, 'failed', 'timeout', 'request timed out', 'source-1', '{"phase":"source"}', 'gatekeeper', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (102, 2, 3, 'completed', NULL, NULL, 'source-2', NULL, 'gatekeeper', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (103, 5, 3, 'failed', 'timeout', 'outside bounds', 'source-3', NULL, 'gatekeeper', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        repo.get_connection().commit()

        rows = repo.get_retryable_score_rows(
            limit=10,
            require_state_assignment=True,
            state_ids=None,
            mode="gatekeeper",
            gatekeeper_prompt_version_id=3,
            category_prompt_version_ids=[1],
            article_id_min_exclusive=0,
            article_id_max_inclusive=2,
            retry_transient_failures=True,
            retry_invalid_responses=False,
        )
    finally:
        repo.close()

    assert [row["scoreRowId"] for row in rows] == [101]
    assert rows[0]["previousResultStatus"] == "failed"
    assert rows[0]["previousErrorCode"] == "timeout"
    assert rows[0]["previousJobId"] == "source-1"
    assert rows[0]["previousMetadata"] == {"phase": "source"}


def test_get_retryable_score_rows_only_selects_category_rows_after_gatekeeper_pass() -> None:
    repo = _create_repo()
    try:
        repo.get_connection().execute(
            """
            INSERT INTO "AiApproverArticleScores"(
                id, "articleId", "promptVersionId", "resultStatus", "errorCode",
                "jobId", "promptRole", decision, "createdAt", "updatedAt"
            )
            VALUES
                (101, 1, 3, 'completed', NULL, 'gatekeeper-job', 'gatekeeper', 'pass', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (102, 1, 1, 'failed', 'rate_limited', 'category-job', 'category_score', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (103, 2, 3, 'completed', NULL, 'gatekeeper-job', 'gatekeeper', 'reject', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (104, 2, 1, 'failed', 'rate_limited', 'category-job', 'category_score', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        repo.get_connection().commit()

        rows = repo.get_retryable_score_rows(
            limit=10,
            require_state_assignment=True,
            state_ids=None,
            mode="gatekeeper",
            gatekeeper_prompt_version_id=3,
            category_prompt_version_ids=[1],
            article_id_min_exclusive=0,
            article_id_max_inclusive=2,
            retry_transient_failures=True,
            retry_invalid_responses=False,
        )
    finally:
        repo.close()

    assert [row["scoreRowId"] for row in rows] == [102]


def test_get_retryable_score_rows_excludes_invalid_response_by_default() -> None:
    repo = _create_repo()
    try:
        repo.get_connection().execute(
            """
            INSERT INTO "AiApproverArticleScores"(
                id, "articleId", "promptVersionId", "resultStatus", "errorCode",
                "jobId", "promptRole", "createdAt", "updatedAt"
            )
            VALUES
                (101, 1, 3, 'invalid_response', 'invalid_response', 'source-1', 'gatekeeper', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (102, 2, 3, 'failed', 'timeout', 'source-2', 'gatekeeper', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        repo.get_connection().commit()

        rows = repo.get_retryable_score_rows(
            limit=10,
            require_state_assignment=True,
            state_ids=None,
            mode="gatekeeper",
            gatekeeper_prompt_version_id=3,
            category_prompt_version_ids=[1],
            article_id_min_exclusive=0,
            article_id_max_inclusive=2,
            retry_transient_failures=True,
            retry_invalid_responses=False,
        )
    finally:
        repo.close()

    assert [row["scoreRowId"] for row in rows] == [102]


def test_update_score_row_overwrites_retryable_row_in_place() -> None:
    repo = _create_repo()
    try:
        repo.get_connection().execute(
            """
            INSERT INTO "AiApproverArticleScores"(
                id, "articleId", "promptVersionId", "resultStatus", "errorCode",
                "errorMessage", "jobId", "promptRole", metadata, "createdAt", "updatedAt"
            )
            VALUES
                (101, 1, 3, 'failed', 'timeout', 'timed out', 'source-job', 'gatekeeper', '{"before":true}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        repo.get_connection().commit()

        repo.update_score_row(
            score_row_id=101,
            result_status="completed",
            score=None,
            reason="passes gatekeeper",
            error_code=None,
            error_message=None,
            job_id="continuation-job",
            prompt_role="gatekeeper",
            pipeline_version="ai_approver_gatekeeper_v1",
            decision="pass",
            confidence=0.91,
            reason_code="safety_incident",
            metadata={
                "continuationRetryAudit": {
                    "previousStatus": "failed",
                    "previousErrorMessage": "timed out",
                }
            },
        )
        rows = repo.get_connection().execute(
            """
            SELECT id, "resultStatus", reason, "errorCode", "errorMessage", "jobId",
                   "promptRole", "pipelineVersion", decision, confidence, "reasonCode", metadata
            FROM "AiApproverArticleScores"
            WHERE id = 101
            """
        ).fetchall()
    finally:
        repo.close()

    assert len(rows) == 1
    row = dict(rows[0])
    assert row["resultStatus"] == "completed"
    assert row["errorCode"] is None
    assert row["errorMessage"] is None
    assert row["jobId"] == "continuation-job"
    assert row["decision"] == "pass"
    assert row["metadata"]["continuationRetryAudit"]["previousStatus"] == "failed"
