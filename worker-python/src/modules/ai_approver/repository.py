"""SQLite repository for AI approver workflow data access."""

from __future__ import annotations

import sqlite3
from typing import Any

from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.errors import AiApproverProcessorError


class AiApproverRepository:
    def __init__(self, config: AiApproverConfig) -> None:
        self.config = config
        self._connection: sqlite3.Connection | None = None

    def get_connection(self) -> sqlite3.Connection:
        if self._connection is None:
            self._connection = sqlite3.connect(self.config.sqlite_path)
            self._connection.row_factory = sqlite3.Row
        return self._connection

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def healthcheck(self) -> bool:
        try:
            conn = self.get_connection()
            conn.execute("SELECT 1")
            return True
        except sqlite3.Error:
            return False

    def get_active_prompt_versions(self) -> list[dict[str, Any]]:
        conn = self.get_connection()
        rows = conn.execute(
            """
            SELECT id, name, description, promptInMarkdown
            FROM AiApproverPromptVersions
            WHERE isActive = 1
            ORDER BY id ASC
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_eligible_articles(
        self,
        *,
        limit: int,
        require_state_assignment: bool,
        state_ids: list[int] | None,
    ) -> list[dict[str, Any]]:
        conn = self.get_connection()

        filters = [
            "NOT EXISTS (SELECT 1 FROM AiApproverArticleScores aas WHERE aas.articleId = a.id)",
            """
            NOT EXISTS (
                SELECT 1
                FROM ArticleIsRelevants air
                WHERE air.articleId = a.id
                  AND air.isRelevant = 0
            )
            """,
            """
            NOT EXISTS (
                SELECT 1
                FROM ArticleApproveds aa
                WHERE aa.articleId = a.id
            )
            """,
        ]
        params: list[Any] = []

        if require_state_assignment:
            filters.append(
                """
                EXISTS (
                    SELECT 1
                    FROM ArticleStateContracts02 asc2
                    WHERE asc2.articleId = a.id
                      AND asc2.stateId IS NOT NULL
                      AND asc2.isDeterminedToBeError = 0
                )
                """
            )

        if state_ids:
            placeholders = ",".join("?" for _ in state_ids)
            filters.append(
                f"""
                EXISTS (
                    SELECT 1
                    FROM ArticleStateContracts02 asc2
                    WHERE asc2.articleId = a.id
                      AND asc2.stateId IN ({placeholders})
                      AND asc2.stateId IS NOT NULL
                      AND asc2.isDeterminedToBeError = 0
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
                COALESCE(ac.content, a.description, '') AS content
            FROM Articles a
            LEFT JOIN ArticleContents ac ON ac.articleId = a.id
            WHERE {where_clause}
            ORDER BY a.id DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

        return [dict(row) for row in rows]

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
                INSERT INTO AiApproverArticleScores (
                    articleId,
                    promptVersionId,
                    resultStatus,
                    score,
                    reason,
                    errorCode,
                    errorMessage,
                    isHumanApproved,
                    reasonHumanRejected,
                    jobId,
                    createdAt,
                    updatedAt
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, datetime('now'), datetime('now'))
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
        except sqlite3.Error as exc:
            raise AiApproverProcessorError(
                f"Failed to insert AI approver score row for article {article_id}"
            ) from exc
