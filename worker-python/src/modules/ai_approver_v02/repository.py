"""PostgreSQL repository for AI Approver V02."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from src.modules.ai_approver_v02.config import AiApproverV02Config
from src.modules.ai_approver_v02.errors import (
    AiApproverV02BoundaryUnavailableError,
    AiApproverV02ConflictError,
    AiApproverV02ExpiredPreviewError,
    AiApproverV02NoEligibleArticlesError,
    AiApproverV02NotFoundError,
    AiApproverV02ValidationError,
)
from src.modules.ai_approver_v02.prompts import PIPELINE_VERSION
from src.modules.ai_approver_v02.types import ArticleInput, ModelOutcome, SelectionItem


_ACCEPTANCE_ADVISORY_LOCK_KEY = 2_026_072_302
_TERMINAL_RUN_STATUSES = (
    "completed",
    "canceled",
    "failed",
    "circuit_breaker",
)


class AiApproverV02Repository:
    def __init__(self, config: AiApproverV02Config) -> None:
        self.config = config
        self._pool = ConnectionPool(
            conninfo=config.dsn,
            min_size=1,
            max_size=5,
            kwargs={"row_factory": dict_row},
            open=False,
        )

    def _open(self) -> ConnectionPool:
        if self._pool.closed:
            self._pool.open()
        return self._pool

    def close(self) -> None:
        if not self._pool.closed:
            self._pool.close()

    def healthcheck(self) -> None:
        with self._open().connection() as conn:
            conn.execute('SELECT 1 FROM "AiApproverRunsV02" LIMIT 1')

    def maintain_stale_previews(self) -> None:
        with self._open().connection() as conn:
            with conn.transaction():
                self._maintain_stale_previews(conn)

    def _maintain_stale_previews(self, conn: psycopg.Connection[Any]) -> None:
        conn.execute(
            """
            UPDATE "AiApproverRunsV02"
            SET status = 'expired',
                "endingReason" = 'preview_expired',
                "endedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE status = 'draft'
              AND "previewExpiresAt" <= CURRENT_TIMESTAMP
            """
        )
        conn.execute(
            """
            DELETE FROM "AiApproverRunsV02"
            WHERE status = 'expired'
              AND "endingReason" = 'preview_expired'
              AND "endedAt" < CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
            """,
            (self.config.expired_preview_retention_days,),
        )

    @staticmethod
    def _active_prompt(
        conn: psycopg.Connection[Any],
        *,
        for_update: bool = False,
    ) -> dict[str, Any]:
        suffix = " FOR UPDATE" if for_update else ""
        rows = conn.execute(
            """
            SELECT id, title, "promptInMarkdown", "firstUsedAt"
            FROM "AiApproverPromptVersionsV02"
            WHERE "isActive" = TRUE
            ORDER BY id
            """
            + suffix
        ).fetchall()
        if len(rows) != 1:
            raise AiApproverV02ConflictError(
                "Exactly one active V02 prompt is required"
            )
        return dict(rows[0])

    @staticmethod
    def _preview_query(mode: str, allow_past_boundary: bool) -> str:
        if mode == "article_position_count":
            positional_filter = (
                """
                SELECT a.id
                FROM "Articles" a
                WHERE a.id <= %(highest_id)s
                ORDER BY a.id DESC
                LIMIT %(requested_count)s
                """
            )
            boundary_filter = (
                ""
                if allow_past_boundary
                else """
                  AND (
                    %(boundary_id)s::integer IS NULL
                    OR positions.id > %(boundary_id)s::integer
                  )
                """
            )
        else:
            positional_filter = """
                SELECT a.id
                FROM "Articles" a
                WHERE a.id <= %(highest_id)s
                  AND a.id > %(boundary_id)s
                ORDER BY a.id DESC
            """
            boundary_filter = ""

        return f"""
            WITH positions AS (
                {positional_filter}
            )
            SELECT
                positions.id AS "articleId",
                CASE
                    WHEN content_row.id IS NOT NULL THEN 'article_contents_02'
                    ELSE 'description'
                END AS "contentSource",
                content_row.id AS "articleContents02Id"
            FROM positions
            JOIN "Articles" article ON article.id = positions.id
            JOIN LATERAL (
                SELECT state_row."stateId", state_row."isDeterminedToBeError"
                FROM "ArticleStateContracts02" state_row
                WHERE state_row."articleId" = positions.id
                ORDER BY state_row.id DESC
                LIMIT 1
            ) latest_state ON TRUE
            LEFT JOIN LATERAL (
                SELECT content_row.id
                FROM "ArticleContents02" content_row
                WHERE content_row."articleId" = positions.id
                  AND content_row.status = 'success'
                  AND BTRIM(COALESCE(content_row.content, '')) <> ''
                ORDER BY content_row.id DESC
                LIMIT 1
            ) content_row ON TRUE
            LEFT JOIN LATERAL (
                SELECT prediction."resultStatus", prediction."attemptCount"
                FROM "AiApproverArticlePredictionsV02" prediction
                WHERE prediction."articleId" = positions.id
                ORDER BY prediction.id DESC
                LIMIT 1
            ) prior_prediction ON TRUE
            WHERE latest_state."stateId" IS NOT NULL
              AND latest_state."isDeterminedToBeError" = FALSE
              {boundary_filter}
              AND NOT EXISTS (
                SELECT 1
                FROM "ArticleApproveds" approval
                WHERE approval."articleId" = positions.id
                  AND approval."isApproved" = TRUE
              )
              AND (
                content_row.id IS NOT NULL
                OR (
                  %(allow_description)s = TRUE
                  AND BTRIM(COALESCE(article.description, '')) <> ''
                )
              )
              AND (
                prior_prediction."resultStatus" IS NULL
                OR (
                  prior_prediction."resultStatus" IN ('failed', 'invalid_response')
                  AND prior_prediction."attemptCount" = 1
                )
              )
            ORDER BY positions.id DESC
        """

    def create_preview(
        self,
        *,
        selection_mode: str,
        requested_article_count: int | None,
        allow_past_approved_boundary: bool,
        allow_description_fallback: bool,
    ) -> dict[str, Any]:
        if selection_mode not in {
            "article_position_count",
            "until_last_approved",
        }:
            raise AiApproverV02ValidationError("Unsupported selection mode")
        if selection_mode == "article_position_count":
            requested_article_count = (
                25 if requested_article_count is None else requested_article_count
            )
            if (
                isinstance(requested_article_count, bool)
                or not isinstance(requested_article_count, int)
                or requested_article_count <= 0
            ):
                raise AiApproverV02ValidationError(
                    "requestedArticleCount must be a positive integer"
                )
        else:
            requested_article_count = None
            allow_past_approved_boundary = False

        with self._open().connection() as conn:
            with conn.transaction():
                self._maintain_stale_previews(conn)
                prompt = self._active_prompt(conn)
                highest_row = conn.execute(
                    'SELECT MAX(id) AS "highestId" FROM "Articles"'
                ).fetchone()
                highest_id = highest_row["highestId"] if highest_row else None
                if highest_id is None:
                    raise AiApproverV02NoEligibleArticlesError(
                        "No eligible articles were found"
                    )

                boundary_row = conn.execute(
                    """
                    SELECT MAX("articleId") AS "boundaryId"
                    FROM "ArticleApproveds"
                    WHERE "isApproved" = TRUE
                    """
                ).fetchone()
                boundary_id = boundary_row["boundaryId"] if boundary_row else None
                if selection_mode == "until_last_approved" and boundary_id is None:
                    raise AiApproverV02BoundaryUnavailableError(
                        "Mode B requires an approved article boundary"
                    )
                if (
                    selection_mode == "until_last_approved"
                    and highest_id == boundary_id
                ):
                    raise AiApproverV02NoEligibleArticlesError(
                        "No eligible articles were found: "
                        f"the latest article ID ({highest_id}) is also the latest "
                        "approved article ID. Add newer articles before using Mode B."
                    )

                rows = conn.execute(
                    self._preview_query(
                        selection_mode,
                        allow_past_approved_boundary,
                    ),
                    {
                        "highest_id": highest_id,
                        "requested_count": requested_article_count,
                        "boundary_id": boundary_id,
                        "allow_description": allow_description_fallback,
                    },
                ).fetchall()
                selection = [
                    SelectionItem(
                        article_id=int(row["articleId"]),
                        content_source=row["contentSource"],
                        article_contents_02_id=row["articleContents02Id"],
                    )
                    for row in rows
                ]
                if not selection:
                    raise AiApproverV02NoEligibleArticlesError(
                        "No eligible articles were found"
                    )

                token = secrets.token_urlsafe(32)
                expires_at = datetime.now(timezone.utc) + timedelta(
                    minutes=self.config.preview_ttl_minutes
                )
                run = conn.execute(
                    """
                    INSERT INTO "AiApproverRunsV02" (
                        "activePromptVersionId",
                        "selectionMode",
                        "requestedArticleCount",
                        "allowPastApprovedBoundary",
                        "allowDescriptionFallback",
                        "highestArticleIdAtStart",
                        "approvedBoundaryArticleId",
                        "plannedEligibleCount",
                        "attemptedCount",
                        "completedCount",
                        "failedCount",
                        "invalidResponseCount",
                        "skippedCount",
                        status,
                        "modelName",
                        "selectionSnapshot",
                        "previewToken",
                        "previewExpiresAt",
                        "createdAt",
                        "updatedAt"
                    )
                    VALUES (
                        %(prompt_id)s, %(selection_mode)s, %(requested_count)s,
                        %(allow_past)s, %(allow_description)s, %(highest_id)s,
                        %(boundary_id)s, %(planned_count)s, 0, 0, 0, 0, 0,
                        'draft', %(model_name)s, %(selection)s,
                        %(token)s, %(expires_at)s, CURRENT_TIMESTAMP,
                        CURRENT_TIMESTAMP
                    )
                    RETURNING *
                    """,
                    {
                        "prompt_id": prompt["id"],
                        "selection_mode": selection_mode,
                        "requested_count": requested_article_count,
                        "allow_past": allow_past_approved_boundary,
                        "allow_description": allow_description_fallback,
                        "highest_id": highest_id,
                        "boundary_id": boundary_id,
                        "planned_count": len(selection),
                        "model_name": self.config.model_name,
                        "selection": Jsonb([item.to_json() for item in selection]),
                        "token": token,
                        "expires_at": expires_at,
                    },
                ).fetchone()
                return dict(run)

    def accept_preview(self, run_id: int, preview_token: str) -> dict[str, Any]:
        with self._open().connection() as conn:
            with conn.transaction():
                conn.execute(
                    "SELECT pg_advisory_xact_lock(%s)",
                    (_ACCEPTANCE_ADVISORY_LOCK_KEY,),
                )
                self._maintain_stale_previews(conn)
                run = conn.execute(
                    """
                    SELECT *
                    FROM "AiApproverRunsV02"
                    WHERE id = %s
                    FOR UPDATE
                    """,
                    (run_id,),
                ).fetchone()
                if run is None:
                    raise AiApproverV02NotFoundError("V02 run was not found")
                if run["status"] == "expired":
                    raise AiApproverV02ExpiredPreviewError(
                        "The preview expired; create a new preview"
                    )
                if run["status"] != "draft":
                    raise AiApproverV02ConflictError(
                        "The preview has already been accepted"
                    )
                stored_token = run["previewToken"] or ""
                if not preview_token or not secrets.compare_digest(
                    stored_token,
                    preview_token,
                ):
                    raise AiApproverV02ConflictError("The preview token is invalid")
                if run["previewExpiresAt"] <= datetime.now(timezone.utc):
                    raise AiApproverV02ExpiredPreviewError(
                        "The preview expired; create a new preview"
                    )

                active = conn.execute(
                    """
                    SELECT id
                    FROM "AiApproverRunsV02"
                    WHERE status IN ('queued', 'running')
                    LIMIT 1
                    """
                ).fetchone()
                if active is not None:
                    raise AiApproverV02ConflictError(
                        "Another V02 run is queued or running"
                    )

                prompt = self._active_prompt(conn, for_update=True)
                if prompt["id"] != run["activePromptVersionId"]:
                    raise AiApproverV02ConflictError(
                        "The active prompt changed; create a new preview"
                    )
                conn.execute(
                    """
                    UPDATE "AiApproverPromptVersionsV02"
                    SET "firstUsedAt" = COALESCE("firstUsedAt", CURRENT_TIMESTAMP),
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE id = %s
                    """,
                    (prompt["id"],),
                )
                accepted = conn.execute(
                    """
                    UPDATE "AiApproverRunsV02"
                    SET status = 'queued',
                        "previewToken" = NULL,
                        "previewExpiresAt" = NULL,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE id = %s
                    RETURNING *
                    """,
                    (run_id,),
                ).fetchone()
                return dict(accepted)

    def attach_job_id(self, run_id: int, job_id: str) -> None:
        with self._open().connection() as conn:
            updated = conn.execute(
                """
                UPDATE "AiApproverRunsV02"
                SET "jobId" = %s, "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = %s
                  AND "jobId" IS NULL
                  AND status NOT IN ('draft', 'expired')
                RETURNING id
                """,
                (job_id, run_id),
            ).fetchone()
            if updated is None:
                raise AiApproverV02ConflictError(
                    "The accepted V02 run is no longer queued"
                )

    def mark_enqueue_failed(self, run_id: int) -> None:
        self.finish_run(run_id, "failed", "queue_submission_failed")

    def reconcile_incomplete_runs(self) -> int:
        with self._open().connection() as conn:
            result = conn.execute(
                """
                UPDATE "AiApproverRunsV02"
                SET status = 'failed',
                    "endingReason" = 'worker_restarted_before_completion',
                    "endedAt" = CURRENT_TIMESTAMP,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE status IN ('queued', 'running')
                """
            )
            return result.rowcount

    def mark_running(self, run_id: int) -> dict[str, Any]:
        with self._open().connection() as conn:
            run = conn.execute(
                """
                UPDATE "AiApproverRunsV02"
                SET status = 'running',
                    "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = %s AND status = 'queued'
                RETURNING *
                """,
                (run_id,),
            ).fetchone()
            if run is None:
                raise AiApproverV02ConflictError(
                    "V02 run cannot transition to running"
                )
            return dict(run)

    def get_run(self, run_id: int, *, include_preview: bool = True) -> dict[str, Any]:
        self.maintain_stale_previews()
        with self._open().connection() as conn:
            status_clause = "" if include_preview else "AND status NOT IN ('draft', 'expired')"
            run = conn.execute(
                f"""
                SELECT *
                FROM "AiApproverRunsV02"
                WHERE id = %s {status_clause}
                """,
                (run_id,),
            ).fetchone()
            if run is None:
                raise AiApproverV02NotFoundError("V02 run was not found")
            return dict(run)

    def get_latest_execution_run(self) -> dict[str, Any] | None:
        self.maintain_stale_previews()
        with self._open().connection() as conn:
            run = conn.execute(
                """
                SELECT *
                FROM "AiApproverRunsV02"
                WHERE status NOT IN ('draft', 'expired')
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()
            return dict(run) if run is not None else None

    def load_frozen_article(self, item: dict[str, Any]) -> ArticleInput | None:
        with self._open().connection() as conn:
            if item["contentSource"] == "article_contents_02":
                row = conn.execute(
                    """
                    SELECT article.id AS "articleId", article.title,
                           content.id AS "contentId", content.content
                    FROM "Articles" article
                    JOIN "ArticleContents02" content
                      ON content."articleId" = article.id
                    WHERE article.id = %s
                      AND content.id = %s
                      AND content.status = 'success'
                      AND BTRIM(COALESCE(content.content, '')) <> ''
                    """,
                    (item["articleId"], item["articleContents02Id"]),
                ).fetchone()
                if row is None:
                    return None
                return ArticleInput(
                    article_id=row["articleId"],
                    title=row["title"] or "",
                    content=row["content"],
                    content_source="article_contents_02",
                    article_contents_02_id=row["contentId"],
                )

            row = conn.execute(
                """
                SELECT id AS "articleId", title, description
                FROM "Articles"
                WHERE id = %s
                  AND BTRIM(COALESCE(description, '')) <> ''
                """,
                (item["articleId"],),
            ).fetchone()
            if row is None:
                return None
            return ArticleInput(
                article_id=row["articleId"],
                title=row["title"] or "",
                content=row["description"],
                content_source="description",
                article_contents_02_id=None,
            )

    def get_prompt_for_article(
        self,
        article_id: int,
        run_prompt_id: int,
    ) -> dict[str, Any]:
        with self._open().connection() as conn:
            prior = conn.execute(
                """
                SELECT "promptVersionId"
                FROM "AiApproverArticlePredictionsV02"
                WHERE "articleId" = %s
                ORDER BY id DESC
                LIMIT 1
                """,
                (article_id,),
            ).fetchone()
            prompt_id = prior["promptVersionId"] if prior else run_prompt_id
            prompt = conn.execute(
                """
                SELECT id, "promptInMarkdown"
                FROM "AiApproverPromptVersionsV02"
                WHERE id = %s
                """,
                (prompt_id,),
            ).fetchone()
            if prompt is None:
                raise AiApproverV02ValidationError(
                    "The prediction prompt no longer exists"
                )
            return dict(prompt)

    def persist_outcome(
        self,
        *,
        run_id: int,
        prompt_version_id: int,
        article: ArticleInput,
        model_name: str,
        outcome: ModelOutcome,
    ) -> None:
        metadata = {
            "articleContents02Id": article.article_contents_02_id,
            "contentSource": article.content_source,
        }
        with self._open().connection() as conn:
            with conn.transaction():
                existing = conn.execute(
                    """
                    SELECT *
                    FROM "AiApproverArticlePredictionsV02"
                    WHERE "articleId" = %s
                    ORDER BY id DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (article.article_id,),
                ).fetchone()
                values = {
                    "run_id": run_id,
                    "prompt_id": prompt_version_id,
                    "article_id": article.article_id,
                    "status": outcome.status,
                    "prediction": outcome.prediction,
                    "reasoning": outcome.reasoning,
                    "error_code": outcome.error_code,
                    "error_message": outcome.error_message,
                    "model_name": model_name,
                    "pipeline_version": PIPELINE_VERSION,
                    "content_source": article.content_source,
                    "metadata": Jsonb(metadata),
                }
                if existing is None:
                    conn.execute(
                        """
                        INSERT INTO "AiApproverArticlePredictionsV02" (
                            "articleId", "promptVersionId", "runId",
                            "resultStatus", prediction, reasoning, "errorCode",
                            "errorMessage", "attemptCount", "modelName",
                            "pipelineVersion", "contentSource", metadata,
                            "createdAt", "updatedAt"
                        )
                        VALUES (
                            %(article_id)s, %(prompt_id)s, %(run_id)s,
                            %(status)s, %(prediction)s, %(reasoning)s,
                            %(error_code)s, %(error_message)s, 1,
                            %(model_name)s, %(pipeline_version)s,
                            %(content_source)s, %(metadata)s,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        """,
                        values,
                    )
                    return

                if (
                    existing["resultStatus"] not in ("failed", "invalid_response")
                    or existing["attemptCount"] != 1
                ):
                    raise AiApproverV02ConflictError(
                        "The article is not eligible for another V02 attempt"
                    )
                if existing["promptVersionId"] != prompt_version_id:
                    raise AiApproverV02ConflictError(
                        "A retry must retain its original prompt"
                    )
                conn.execute(
                    """
                    UPDATE "AiApproverArticlePredictionsV02"
                    SET "runId" = %(run_id)s,
                        "resultStatus" = %(status)s,
                        prediction = %(prediction)s,
                        reasoning = %(reasoning)s,
                        "errorCode" = %(error_code)s,
                        "errorMessage" = %(error_message)s,
                        "attemptCount" = 2,
                        "modelName" = %(model_name)s,
                        "pipelineVersion" = %(pipeline_version)s,
                        "contentSource" = %(content_source)s,
                        metadata = %(metadata)s,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE id = %(prediction_id)s
                    """,
                    {**values, "prediction_id": existing["id"]},
                )

    def increment_count(self, run_id: int, count_name: str) -> None:
        allowed = {
            "attemptedCount",
            "completedCount",
            "failedCount",
            "invalidResponseCount",
            "skippedCount",
        }
        if count_name not in allowed:
            raise ValueError("Unsupported run count")
        with self._open().connection() as conn:
            conn.execute(
                f"""
                UPDATE "AiApproverRunsV02"
                SET "{count_name}" = "{count_name}" + 1,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = %s AND status = 'running'
                """,
                (run_id,),
            )

    def finish_run(self, run_id: int, status: str, ending_reason: str | None) -> None:
        if status not in _TERMINAL_RUN_STATUSES:
            raise ValueError("Unsupported terminal run status")
        with self._open().connection() as conn:
            conn.execute(
                """
                UPDATE "AiApproverRunsV02"
                SET status = %s,
                    "endingReason" = %s,
                    "endedAt" = CURRENT_TIMESTAMP,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = %s
                  AND status IN ('queued', 'running')
                """,
                (status, ending_reason, run_id),
            )
