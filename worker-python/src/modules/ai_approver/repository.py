"""Postgres repository for AI approver workflow data access."""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.errors import AiApproverProcessorError


class AiApproverRepository:
    def __init__(self, config: AiApproverConfig) -> None:
        self.config = config
        self._pool: ConnectionPool | None = None
        self._connection: psycopg.Connection | None = None

    def get_connection(self) -> psycopg.Connection:
        if self._connection is None:
            if self._pool is None:
                self._pool = ConnectionPool(
                    conninfo=self.config.dsn,
                    min_size=1,
                    max_size=5,
                    kwargs={"row_factory": dict_row},
                )
            self._connection = self._pool.getconn()
        return self._connection

    def close(self) -> None:
        if self._connection is not None:
            if self._pool is not None:
                self._pool.putconn(self._connection)
            self._connection = None
        if self._pool is not None:
            self._pool.close()
            self._pool = None

    def healthcheck(self) -> bool:
        try:
            conn = self.get_connection()
            conn.execute("SELECT 1")
            return True
        except psycopg.Error:
            return False

    def get_active_prompt_versions(self) -> list[dict[str, Any]]:
        conn = self.get_connection()
        rows = conn.execute(
            """
            SELECT id, name, description, "promptInMarkdown"
            FROM "AiApproverPromptVersions"
            WHERE "isActive" = TRUE
            ORDER BY id ASC
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_prompt_version_by_id(self, prompt_version_id: int) -> dict[str, Any] | None:
        conn = self.get_connection()
        row = conn.execute(
            """
            SELECT id, name, description, "promptInMarkdown", "isActive"
            FROM "AiApproverPromptVersions"
            WHERE id = %s
            LIMIT 1
            """,
            (prompt_version_id,),
        ).fetchone()

        return dict(row) if row is not None else None

    def get_eligible_articles(
        self,
        *,
        limit: int,
        require_state_assignment: bool,
        state_ids: list[int] | None,
    ) -> list[dict[str, Any]]:
        conn = self.get_connection()

        filters = [
            'NOT EXISTS (SELECT 1 FROM "AiApproverArticleScores" aas WHERE aas."articleId" = a.id)',
            """
            NOT EXISTS (
                SELECT 1
                FROM "ArticleIsRelevants" air
                WHERE air."articleId" = a.id
                  AND air."isRelevant" = FALSE
            )
            """,
            """
            NOT EXISTS (
                SELECT 1
                FROM "ArticleApproveds" aa
                WHERE aa."articleId" = a.id
            )
            """,
        ]
        params: list[Any] = []

        if require_state_assignment:
            filters.append(
                """
                EXISTS (
                    SELECT 1
                    FROM "ArticleStateContracts02" asc2
                    WHERE asc2."articleId" = a.id
                      AND asc2."stateId" IS NOT NULL
                      AND asc2."isDeterminedToBeError" = FALSE
                )
                """
            )

        if state_ids:
            placeholders = ",".join("%s" for _ in state_ids)
            filters.append(
                f"""
                EXISTS (
                    SELECT 1
                    FROM "ArticleStateContracts02" asc2
                    WHERE asc2."articleId" = a.id
                      AND asc2."stateId" IN ({placeholders})
                      AND asc2."stateId" IS NOT NULL
                      AND asc2."isDeterminedToBeError" = FALSE
                )
                """
            )
            params.extend(state_ids)

        where_clause = " AND ".join(filters) if filters else "1=1"
        params.append(limit)

        rows = conn.execute(
            f"""
            SELECT
                a.id,
                a.title,
                COALESCE(
                    (
                        SELECT ac2.content
                        FROM "ArticleContents02" ac2
                        WHERE ac2."articleId" = a.id
                        ORDER BY
                            CASE WHEN ac2.status = 'success' THEN 2 ELSE 0 END DESC,
                            LENGTH(TRIM(COALESCE(ac2.content, ''))) DESC,
                            ac2.id DESC
                        LIMIT 1
                    ),
                    a.description,
                    ''
                ) AS content
            FROM "Articles" a
            WHERE {where_clause}
            ORDER BY a.id DESC
            LIMIT %s
            """,
            params,
        ).fetchall()

        return [dict(row) for row in rows]

    def get_article_for_prompt_run(self, article_id: int) -> dict[str, Any] | None:
        conn = self.get_connection()
        row = conn.execute(
            """
            SELECT
                a.id,
                a.title,
                COALESCE(
                    (
                        SELECT ac2.content
                        FROM "ArticleContents02" ac2
                        WHERE ac2."articleId" = a.id
                        ORDER BY
                            CASE WHEN ac2.status = 'success' THEN 2 ELSE 0 END DESC,
                            LENGTH(TRIM(COALESCE(ac2.content, ''))) DESC,
                            ac2.id DESC
                        LIMIT 1
                    ),
                    a.description,
                    ''
                ) AS content,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM "ArticleContents02" ac2
                        WHERE ac2."articleId" = a.id
                    ) THEN 'article-contents-02'
                    WHEN LENGTH(TRIM(COALESCE(a.description, ''))) > 0 THEN 'article-description'
                    ELSE 'none'
                END AS "contentSource"
            FROM "Articles" a
            WHERE a.id = %s
            LIMIT 1
            """,
            (article_id,),
        ).fetchone()

        return dict(row) if row is not None else None

    def insert_score_row(
        self,
        *,
        article_id: int,
        prompt_version_id: int,
        result_status: str,
        score: float | None,
        reason: str | None,
        error_code: str | None,
        error_message: str | None,
        job_id: str | None,
    ) -> None:
        conn = self.get_connection()
        try:
            conn.execute(
                """
                INSERT INTO "AiApproverArticleScores" (
                    "articleId",
                    "promptVersionId",
                    "resultStatus",
                    score,
                    reason,
                    "errorCode",
                    "errorMessage",
                    "isHumanApproved",
                    "reasonHumanRejected",
                    "jobId",
                    "createdAt",
                    "updatedAt"
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, NULL, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (
                    article_id,
                    prompt_version_id,
                    result_status,
                    score,
                    reason,
                    error_code,
                    error_message,
                    job_id,
                ),
            )
            conn.commit()
        except psycopg.Error as exc:
            raise AiApproverProcessorError(
                f"Failed to insert AI approver score row for article {article_id}"
            ) from exc
