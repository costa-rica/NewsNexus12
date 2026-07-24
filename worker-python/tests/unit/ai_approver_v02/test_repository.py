from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from psycopg.rows import dict_row

from src.modules.ai_approver_v02.config import AiApproverV02Config
from src.modules.ai_approver_v02.errors import (
    AiApproverV02BoundaryUnavailableError,
    AiApproverV02ConflictError,
    AiApproverV02NoEligibleArticlesError,
)
from src.modules.ai_approver_v02.orchestrator import AiApproverV02Orchestrator
from src.modules.ai_approver_v02.prompts import PIPELINE_VERSION
from src.modules.ai_approver_v02.repository import AiApproverV02Repository
from src.modules.ai_approver_v02.types import ArticleInput, ModelOutcome
from tests.postgres_test_utils import (
    execute_many,
    execute_statements,
    get_test_dsn,
    reset_public_schema,
)


def _config() -> AiApproverV02Config:
    return AiApproverV02Config(
        pg_host=os.getenv("PG_HOST", "localhost"),
        pg_port=int(os.getenv("PG_PORT", "5432")),
        pg_database=os.getenv("PG_DATABASE", "newsnexus_test_worker_python"),
        pg_user=os.getenv("PG_USER", "nick"),
        pg_password=os.getenv("PG_PASSWORD", ""),
        model_name="test-model",
    )


def _create_repository() -> AiApproverV02Repository:
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
            CREATE TABLE "ArticleApproveds" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER NOT NULL,
                "isApproved" BOOLEAN NOT NULL
            )
            """,
            """
            CREATE TABLE "ArticleStateContracts02" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER NOT NULL,
                "stateId" INTEGER,
                "isDeterminedToBeError" BOOLEAN NOT NULL
            )
            """,
            """
            CREATE TABLE "ArticleContents02" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER NOT NULL,
                content TEXT,
                status TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE "AiApproverPromptVersionsV02" (
                id SERIAL PRIMARY KEY,
                title TEXT,
                "promptInMarkdown" TEXT NOT NULL,
                "isActive" BOOLEAN NOT NULL DEFAULT FALSE,
                "firstUsedAt" TIMESTAMPTZ,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE TABLE "AiApproverRunsV02" (
                id SERIAL PRIMARY KEY,
                "jobId" TEXT,
                "activePromptVersionId" INTEGER NOT NULL,
                "selectionMode" TEXT NOT NULL,
                "requestedArticleCount" INTEGER,
                "allowPastApprovedBoundary" BOOLEAN NOT NULL DEFAULT FALSE,
                "allowDescriptionFallback" BOOLEAN NOT NULL DEFAULT FALSE,
                "highestArticleIdAtStart" INTEGER NOT NULL,
                "approvedBoundaryArticleId" INTEGER,
                "plannedEligibleCount" INTEGER NOT NULL DEFAULT 0,
                "attemptedCount" INTEGER NOT NULL DEFAULT 0,
                "completedCount" INTEGER NOT NULL DEFAULT 0,
                "failedCount" INTEGER NOT NULL DEFAULT 0,
                "invalidResponseCount" INTEGER NOT NULL DEFAULT 0,
                "skippedCount" INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'draft',
                "endingReason" TEXT,
                "modelName" TEXT NOT NULL,
                "selectionSnapshot" JSONB NOT NULL DEFAULT '[]',
                "previewToken" TEXT UNIQUE,
                "previewExpiresAt" TIMESTAMPTZ,
                "startedAt" TIMESTAMPTZ,
                "endedAt" TIMESTAMPTZ,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE TABLE "AiApproverArticlePredictionsV02" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER NOT NULL,
                "promptVersionId" INTEGER NOT NULL,
                "runId" INTEGER NOT NULL,
                "resultStatus" TEXT NOT NULL,
                prediction TEXT,
                reasoning TEXT,
                "errorCode" TEXT,
                "errorMessage" TEXT,
                "attemptCount" INTEGER NOT NULL DEFAULT 1,
                "modelName" TEXT NOT NULL,
                "pipelineVersion" TEXT NOT NULL,
                "contentSource" TEXT NOT NULL,
                metadata JSONB,
                "humanValidation" BOOLEAN,
                "humanComment" TEXT,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """,
        ]
    )
    execute_many(
        'INSERT INTO "Articles"(id, title, description) VALUES (%s, %s, %s)',
        [(index, f"T{index}", f"D{index}") for index in range(1, 7)],
    )
    execute_many(
        """
        INSERT INTO "ArticleStateContracts02"(
            "articleId", "stateId", "isDeterminedToBeError"
        ) VALUES (%s, %s, %s)
        """,
        [(index, 5, False) for index in range(1, 7)],
    )
    execute_many(
        """
        INSERT INTO "ArticleContents02"("articleId", content, status)
        VALUES (%s, %s, %s)
        """,
        [
            (1, "C1", "success"),
            (2, "C2", "success"),
            (3, "C3", "success"),
            (4, "C4", "success"),
            (5, " ", "success"),
            (6, "C6", "success"),
        ],
    )
    execute_many(
        """
        INSERT INTO "ArticleApproveds"("articleId", "isApproved")
        VALUES (%s, %s)
        """,
        [(2, True), (6, False)],
    )
    execute_many(
        """
        INSERT INTO "AiApproverPromptVersionsV02"(
            id, title, "promptInMarkdown", "isActive"
        ) VALUES (%s, %s, %s, %s)
        """,
        [(1, "Active", "operator prompt", True), (2, "Old", "old prompt", False)],
    )
    execute_many(
        """
        INSERT INTO "AiApproverArticlePredictionsV02"(
            "articleId", "promptVersionId", "runId", "resultStatus",
            prediction, reasoning, "attemptCount", "modelName",
            "pipelineVersion", "contentSource"
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                4,
                1,
                99,
                "completed",
                "approved",
                "done",
                1,
                "old-model",
                "old-pipeline",
                "article_contents_02",
            ),
            (
                3,
                2,
                99,
                "failed",
                None,
                None,
                1,
                "old-model",
                "old-pipeline",
                "article_contents_02",
            ),
        ],
    )
    return AiApproverV02Repository(_config())


class _CompletedClient:
    def evaluate(self, _prompt: str) -> ModelOutcome:
        return ModelOutcome(
            status="completed",
            prediction="approved",
            reasoning="meets the operator criteria",
        )


@pytest.mark.integration
def test_preview_to_execution_persists_advisory_prediction() -> None:
    repository = _create_repository()
    try:
        preview = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=1,
            allow_past_approved_boundary=False,
            allow_description_fallback=False,
        )
        accepted = repository.accept_preview(
            preview["id"],
            preview["previewToken"],
        )
        result = AiApproverV02Orchestrator(
            repository,
            _CompletedClient(),
        ).run(accepted["id"], lambda: False)
    finally:
        repository.close()

    with psycopg.connect(get_test_dsn(), row_factory=dict_row) as conn:
        run = conn.execute(
            'SELECT * FROM "AiApproverRunsV02" WHERE id = %s',
            (accepted["id"],),
        ).fetchone()
        prediction = conn.execute(
            """
            SELECT *
            FROM "AiApproverArticlePredictionsV02"
            WHERE "articleId" = 6
            """
        ).fetchone()
        approval_count = conn.execute(
            'SELECT COUNT(*) AS count FROM "ArticleApproveds"'
        ).fetchone()["count"]

    assert result["status"] == "completed"
    assert run["status"] == "completed"
    assert run["attemptedCount"] == 1
    assert run["completedCount"] == 1
    assert prediction["prediction"] == "approved"
    assert prediction["attemptCount"] == 1
    assert approval_count == 2


@pytest.mark.integration
def test_preview_filters_without_expanding_mode_a() -> None:
    repository = _create_repository()
    try:
        preview = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=4,
            allow_past_approved_boundary=False,
            allow_description_fallback=False,
        )
    finally:
        repository.close()

    assert preview["highestArticleIdAtStart"] == 6
    assert preview["approvedBoundaryArticleId"] == 2
    assert [item["articleId"] for item in preview["selectionSnapshot"]] == [6, 3]
    assert preview["plannedEligibleCount"] == 2


@pytest.mark.integration
def test_preview_description_fallback_and_mode_b() -> None:
    repository = _create_repository()
    try:
        preview = repository.create_preview(
            selection_mode="until_last_approved",
            requested_article_count=None,
            allow_past_approved_boundary=False,
            allow_description_fallback=True,
        )
    finally:
        repository.close()

    assert [item["articleId"] for item in preview["selectionSnapshot"]] == [6, 5, 3]
    assert preview["selectionSnapshot"][1]["contentSource"] == "description"
    assert preview["selectionSnapshot"][1]["articleContents02Id"] is None


@pytest.mark.integration
def test_mode_b_requires_boundary() -> None:
    repository = _create_repository()
    try:
        with psycopg.connect(get_test_dsn()) as conn:
            conn.execute('DELETE FROM "ArticleApproveds"')
        with pytest.raises(AiApproverV02BoundaryUnavailableError):
            repository.create_preview(
                selection_mode="until_last_approved",
                requested_article_count=None,
                allow_past_approved_boundary=False,
                allow_description_fallback=False,
            )
    finally:
        repository.close()


@pytest.mark.integration
def test_mode_b_explains_when_latest_article_is_approved() -> None:
    repository = _create_repository()
    try:
        with psycopg.connect(get_test_dsn()) as conn:
            conn.execute(
                """
                INSERT INTO "ArticleApproveds"("articleId", "isApproved")
                VALUES (6, TRUE)
                """
            )
        with pytest.raises(AiApproverV02NoEligibleArticlesError) as error:
            repository.create_preview(
                selection_mode="until_last_approved",
                requested_article_count=None,
                allow_past_approved_boundary=False,
                allow_description_fallback=False,
            )
    finally:
        repository.close()

    assert str(error.value) == (
        "No eligible articles were found: the latest article ID (6) is also "
        "the latest approved article ID. Add newer articles before using Mode B."
    )


@pytest.mark.integration
def test_acceptance_is_single_use_and_freezes_prompt() -> None:
    repository = _create_repository()
    try:
        preview = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=2,
            allow_past_approved_boundary=False,
            allow_description_fallback=True,
        )
        accepted = repository.accept_preview(
            preview["id"],
            preview["previewToken"],
        )
        with pytest.raises(AiApproverV02ConflictError):
            repository.accept_preview(
                preview["id"],
                preview["previewToken"],
            )
    finally:
        repository.close()

    assert accepted["status"] == "queued"
    assert accepted["previewToken"] is None
    with psycopg.connect(get_test_dsn(), row_factory=dict_row) as conn:
        prompt = conn.execute(
            'SELECT "firstUsedAt" FROM "AiApproverPromptVersionsV02" WHERE id = 1'
        ).fetchone()
    assert prompt["firstUsedAt"] is not None


@pytest.mark.integration
def test_retry_updates_same_row_and_preserves_human_fields() -> None:
    repository = _create_repository()
    article = ArticleInput(
        article_id=3,
        title="T3",
        content="C3",
        content_source="article_contents_02",
        article_contents_02_id=3,
    )
    completed_outcome = ModelOutcome(
        status="completed",
        prediction="irrelevant",
        reasoning="new reason",
    )
    with psycopg.connect(get_test_dsn()) as conn:
        conn.execute(
            """
            UPDATE "AiApproverArticlePredictionsV02"
            SET "humanValidation" = TRUE, "humanComment" = 'keep'
            WHERE "articleId" = 3
            """
        )
    try:
        repository.persist_outcome(
            run_id=101,
            prompt_version_id=2,
            article=article,
            model_name="new-model",
            outcome=completed_outcome,
        )
        with pytest.raises(AiApproverV02ConflictError):
            repository.persist_outcome(
                run_id=102,
                prompt_version_id=2,
                article=article,
                model_name="new-model",
                outcome=completed_outcome,
            )
    finally:
        repository.close()

    with psycopg.connect(get_test_dsn(), row_factory=dict_row) as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM "AiApproverArticlePredictionsV02"
            WHERE "articleId" = 3
            """
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["attemptCount"] == 2
    assert rows[0]["promptVersionId"] == 2
    assert rows[0]["runId"] == 101
    assert rows[0]["humanValidation"] is True
    assert rows[0]["humanComment"] == "keep"
    assert rows[0]["pipelineVersion"] == PIPELINE_VERSION
    with psycopg.connect(get_test_dsn()) as conn:
        approval_count = conn.execute(
            'SELECT COUNT(*) FROM "ArticleApproveds"'
        ).fetchone()[0]
    assert approval_count == 2


@pytest.mark.integration
def test_retry_keeps_original_prompt_and_new_articles_use_run_prompt() -> None:
    repository = _create_repository()
    try:
        retry_prompt = repository.get_prompt_for_article(3, 1)
        new_article_prompt = repository.get_prompt_for_article(1, 1)
    finally:
        repository.close()

    assert retry_prompt["id"] == 2
    assert retry_prompt["promptInMarkdown"] == "old prompt"
    assert new_article_prompt["id"] == 1
    assert new_article_prompt["promptInMarkdown"] == "operator prompt"


@pytest.mark.integration
def test_second_failed_attempt_is_not_selected_again() -> None:
    repository = _create_repository()
    with psycopg.connect(get_test_dsn()) as conn:
        conn.execute(
            """
            UPDATE "AiApproverArticlePredictionsV02"
            SET "attemptCount" = 2
            WHERE "articleId" = 3
            """
        )
    try:
        preview = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=4,
            allow_past_approved_boundary=False,
            allow_description_fallback=False,
        )
    finally:
        repository.close()

    selected_ids = [
        item["articleId"] for item in preview["selectionSnapshot"]
    ]
    assert selected_ids == [6]


@pytest.mark.integration
def test_latest_state_row_controls_eligibility() -> None:
    repository = _create_repository()
    with psycopg.connect(get_test_dsn()) as conn:
        conn.execute(
            """
            INSERT INTO "ArticleStateContracts02"(
                "articleId", "stateId", "isDeterminedToBeError"
            ) VALUES (6, NULL, FALSE), (3, 5, TRUE)
            """
        )
    try:
        preview = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=4,
            allow_past_approved_boundary=False,
            allow_description_fallback=True,
        )
    finally:
        repository.close()

    assert [item["articleId"] for item in preview["selectionSnapshot"]] == [5]


@pytest.mark.integration
def test_frozen_content_never_switches_to_newer_row() -> None:
    repository = _create_repository()
    try:
        frozen = {
            "articleId": 6,
            "contentSource": "article_contents_02",
            "articleContents02Id": 6,
        }
        with psycopg.connect(get_test_dsn()) as conn:
            conn.execute(
                """
                INSERT INTO "ArticleContents02"(
                    id, "articleId", content, status
                ) VALUES (100, 6, 'newer content', 'success')
                """
            )
        loaded = repository.load_frozen_article(frozen)
        with psycopg.connect(get_test_dsn()) as conn:
            conn.execute(
                'UPDATE "ArticleContents02" SET status = \'failed\' WHERE id = 6'
            )
        missing = repository.load_frozen_article(frozen)
    finally:
        repository.close()

    assert loaded is not None
    assert loaded.content == "C6"
    assert missing is None


@pytest.mark.integration
def test_stale_preview_maintenance_expires_and_prunes() -> None:
    repository = _create_repository()
    with psycopg.connect(get_test_dsn()) as conn:
        conn.execute(
            """
            INSERT INTO "AiApproverRunsV02"(
                "activePromptVersionId", "selectionMode",
                "requestedArticleCount", "highestArticleIdAtStart",
                "plannedEligibleCount", status, "modelName",
                "selectionSnapshot", "previewToken", "previewExpiresAt",
                "createdAt", "updatedAt"
            ) VALUES
            (
                1, 'article_position_count', 1, 6, 1, 'draft',
                'test-model', '[]', 'expired-draft',
                CURRENT_TIMESTAMP - INTERVAL '1 minute',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            ),
            (
                1, 'article_position_count', 1, 6, 1, 'expired',
                'test-model', '[]', NULL, NULL,
                CURRENT_TIMESTAMP - INTERVAL '10 days',
                CURRENT_TIMESTAMP - INTERVAL '10 days'
            )
            """
        )
        conn.execute(
            """
            UPDATE "AiApproverRunsV02"
            SET "endingReason" = 'preview_expired',
                "endedAt" = CURRENT_TIMESTAMP - INTERVAL '10 days'
            WHERE status = 'expired'
            """
        )
    try:
        repository.maintain_stale_previews()
        latest = repository.get_latest_execution_run()
    finally:
        repository.close()

    with psycopg.connect(get_test_dsn(), row_factory=dict_row) as conn:
        rows = conn.execute(
            'SELECT status, "endingReason" FROM "AiApproverRunsV02" ORDER BY id'
        ).fetchall()
    assert rows == [{"status": "expired", "endingReason": "preview_expired"}]
    assert latest is None


@pytest.mark.integration
def test_completed_first_attempt_cannot_create_duplicate_row() -> None:
    repository = _create_repository()
    article = ArticleInput(
        article_id=1,
        title="T1",
        content="C1",
        content_source="article_contents_02",
        article_contents_02_id=1,
    )
    outcome = ModelOutcome(
        status="completed",
        prediction="approved",
        reasoning="yes",
    )
    try:
        repository.persist_outcome(
            run_id=101,
            prompt_version_id=1,
            article=article,
            model_name="model",
            outcome=outcome,
        )
        with pytest.raises(AiApproverV02ConflictError):
            repository.persist_outcome(
                run_id=102,
                prompt_version_id=1,
                article=article,
                model_name="model",
                outcome=outcome,
            )
    finally:
        repository.close()

    with psycopg.connect(get_test_dsn()) as conn:
        count = conn.execute(
            """
            SELECT COUNT(*)
            FROM "AiApproverArticlePredictionsV02"
            WHERE "articleId" = 1
            """
        ).fetchone()[0]
    assert count == 1


@pytest.mark.integration
def test_concurrent_acceptance_allows_only_one_winner() -> None:
    repository = _create_repository()
    preview = repository.create_preview(
        selection_mode="article_position_count",
        requested_article_count=2,
        allow_past_approved_boundary=False,
        allow_description_fallback=True,
    )
    repository.close()

    def accept() -> str:
        contender = AiApproverV02Repository(_config())
        try:
            contender.accept_preview(preview["id"], preview["previewToken"])
            return "accepted"
        except AiApproverV02ConflictError:
            return "conflict"
        finally:
            contender.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(lambda _: accept(), range(2)))

    assert sorted(outcomes) == ["accepted", "conflict"]


@pytest.mark.integration
def test_restart_reconciliation_fails_incomplete_runs() -> None:
    repository = _create_repository()
    with psycopg.connect(get_test_dsn()) as conn:
        conn.execute(
            """
            INSERT INTO "AiApproverRunsV02"(
                "activePromptVersionId", "selectionMode",
                "requestedArticleCount", "highestArticleIdAtStart",
                "plannedEligibleCount", status, "modelName",
                "selectionSnapshot", "createdAt", "updatedAt"
            ) VALUES
                (1, 'article_position_count', 1, 6, 1, 'queued',
                 'model', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                (1, 'article_position_count', 1, 6, 1, 'running',
                 'model', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
    try:
        count = repository.reconcile_incomplete_runs()
    finally:
        repository.close()

    with psycopg.connect(get_test_dsn(), row_factory=dict_row) as conn:
        rows = conn.execute(
            """
            SELECT status, "endingReason"
            FROM "AiApproverRunsV02"
            ORDER BY id
            """
        ).fetchall()
    assert count == 2
    assert rows == [
        {
            "status": "failed",
            "endingReason": "worker_restarted_before_completion",
        },
        {
            "status": "failed",
            "endingReason": "worker_restarted_before_completion",
        },
    ]


@pytest.mark.integration
def test_zero_eligible_preview_creates_no_draft() -> None:
    repository = _create_repository()
    with psycopg.connect(get_test_dsn()) as conn:
        conn.execute(
            'UPDATE "ArticleStateContracts02" SET "stateId" = NULL'
        )
    try:
        with pytest.raises(AiApproverV02NoEligibleArticlesError):
            repository.create_preview(
                selection_mode="article_position_count",
                requested_article_count=25,
                allow_past_approved_boundary=True,
                allow_description_fallback=True,
            )
    finally:
        repository.close()

    with psycopg.connect(get_test_dsn()) as conn:
        count = conn.execute(
            'SELECT COUNT(*) FROM "AiApproverRunsV02"'
        ).fetchone()[0]
    assert count == 0


@pytest.mark.integration
def test_mode_a_can_cross_boundary_and_runs_without_one() -> None:
    repository = _create_repository()
    try:
        crossing = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=6,
            allow_past_approved_boundary=True,
            allow_description_fallback=False,
        )
        with psycopg.connect(get_test_dsn()) as conn:
            conn.execute('DELETE FROM "ArticleApproveds"')
        without_boundary = repository.create_preview(
            selection_mode="article_position_count",
            requested_article_count=6,
            allow_past_approved_boundary=False,
            allow_description_fallback=False,
        )
    finally:
        repository.close()

    crossing_ids = [
        item["articleId"] for item in crossing["selectionSnapshot"]
    ]
    no_boundary_ids = [
        item["articleId"] for item in without_boundary["selectionSnapshot"]
    ]
    assert crossing_ids == [6, 3, 1]
    assert no_boundary_ids == [6, 3, 2, 1]
    assert without_boundary["approvedBoundaryArticleId"] is None
