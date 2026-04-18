"""Postgres repository for location scorer SQL operations."""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import LocationScorerDatabaseError


class LocationScorerRepository:
    def __init__(self, config: LocationScorerConfig) -> None:
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

    @staticmethod
    def _scalar(row: Any) -> Any:
        if isinstance(row, dict):
            return next(iter(row.values()))
        return row[0]

    def healthcheck(self) -> bool:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            return self._scalar(cursor.fetchone()) == 1
        except psycopg.Error as exc:
            raise LocationScorerDatabaseError(
                f"Repository healthcheck failed: {exc}"
            ) from exc

    def execute_query(
        self,
        query: str,
        params: tuple[Any, ...] = (),
    ) -> list[dict[str, Any]]:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        except psycopg.Error as exc:
            raise LocationScorerDatabaseError(f"Query failed: {exc}") from exc

    def get_entity_who_categorized_article_id(self, ai_entity_name: str) -> int | None:
        rows = self.execute_query(
            """
            SELECT ewca.id
            FROM "ArtificialIntelligences" ai
            JOIN "EntityWhoCategorizedArticles" ewca
                ON ewca."artificialIntelligenceId" = ai.id
            WHERE ai.name = %s
            LIMIT 1
            """,
            (ai_entity_name,),
        )
        return int(rows[0]["id"]) if rows else None

    def get_unscored_articles(
        self,
        entity_id: int,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        query = """
        SELECT a.id, a.title, a.description
        FROM "Articles" a
        WHERE NOT EXISTS (
            SELECT 1
            FROM "ArticleEntityWhoCategorizedArticleContracts" contract
            WHERE contract."articleId" = a.id
              AND contract."entityWhoCategorizesId" = %s
        )
        ORDER BY a.id
        """

        params: tuple[Any, ...]
        if limit is not None:
            query += "\nLIMIT %s"
            params = (entity_id, limit)
        else:
            params = (entity_id,)

        return self.execute_query(query, params)

    def write_scores_batch(
        self,
        entity_id: int,
        scores: list[dict[str, Any]],
    ) -> dict[str, int]:
        if not scores:
            return {"inserted": 0, "duplicates": 0}

        conn = self.get_connection()
        cursor = conn.cursor()
        inserted = 0
        duplicates = 0

        try:
            for score in scores:
                cursor.execute(
                    """
                    INSERT INTO "ArticleEntityWhoCategorizedArticleContracts" (
                        "articleId",
                        "entityWhoCategorizesId",
                        keyword,
                        "keywordRating",
                        "createdAt",
                        "updatedAt"
                    ) VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT DO NOTHING
                    RETURNING "articleId"
                    """,
                    (
                        score["article_id"],
                        entity_id,
                        score["rating_for"],
                        score["score"],
                    ),
                )
                if cursor.fetchone() is None:
                    duplicates += 1
                else:
                    inserted += 1

            conn.commit()
            return {"inserted": inserted, "duplicates": duplicates}
        except psycopg.Error as exc:
            conn.rollback()
            raise LocationScorerDatabaseError(f"Batch insert failed: {exc}") from exc
