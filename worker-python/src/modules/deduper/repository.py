"""Postgres repository for deduper SQL operations."""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.errors import DeduperDatabaseError


class DeduperRepository:
    def __init__(self, config: DeduperConfig) -> None:
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
            raise DeduperDatabaseError(f"Repository healthcheck failed: {exc}") from exc

    def execute_query(self, query: str, params: tuple = ()) -> list[dict[str, Any]]:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        except psycopg.Error as exc:
            raise DeduperDatabaseError(f"Query failed: {exc}") from exc

    def execute_insert(self, query: str, params: tuple = ()) -> int:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute(query, params)
            conn.commit()
            row = cursor.fetchone()
            if row is None:
                return 0
            return int(row["id"] if isinstance(row, dict) else row[0])
        except psycopg.Error as exc:
            raise DeduperDatabaseError(f"Insert failed: {exc}") from exc

    def execute_many(self, query: str, params_list: list[tuple]) -> int:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.executemany(query, params_list)
            conn.commit()
            return cursor.rowcount
        except psycopg.Error as exc:
            raise DeduperDatabaseError(f"Batch execution failed: {exc}") from exc

    def get_article_ids_from_csv_list(self, article_ids: list[int]) -> list[dict[str, Any]]:
        if not article_ids:
            return []

        placeholders = ",".join(["%s"] * len(article_ids))
        query = f"""
        SELECT id, url, title, description, "publishedDate"
        FROM "Articles"
        WHERE id IN ({placeholders})
        """
        return self.execute_query(query, tuple(article_ids))

    def get_all_approved_article_ids(self) -> list[int]:
        rows = self.execute_query(
            """
            SELECT DISTINCT "articleId"
            FROM "ArticleApproveds"
            WHERE "isApproved" = TRUE
            ORDER BY "articleId"
            """
        )
        return [row["articleId"] for row in rows]

    def get_article_ids_by_report_id(self, report_id: int) -> list[int]:
        rows = self.execute_query(
            """
            SELECT DISTINCT "articleId"
            FROM "ArticleReportContracts"
            WHERE "reportId" = %s
            ORDER BY "articleId"
            """,
            (report_id,),
        )
        return [row["articleId"] for row in rows]

    def insert_article_duplicate_analysis_batch(self, analysis_data: list[dict[str, Any]]) -> int:
        if not analysis_data:
            return 0

        query = """
        INSERT INTO "ArticleDuplicateAnalyses" (
            "articleIdNew", "articleIdApproved", "reportId", "sameArticleIdFlag",
            "articleNewState", "articleApprovedState", "sameStateFlag",
            "urlCheck", "contentHash", "embeddingSearch",
            "createdAt", "updatedAt"
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """

        params_list = [
            (
                row["articleIdNew"],
                row["articleIdApproved"],
                row.get("reportId"),
                row["sameArticleIdFlag"],
                row.get("articleNewState", ""),
                row.get("articleApprovedState", ""),
                row.get("sameStateFlag", 0),
                row.get("urlCheck", 0),
                row.get("contentHash", 0),
                row.get("embeddingSearch", 0),
            )
            for row in analysis_data
        ]

        return self.execute_many(query, params_list)

    def clear_existing_analysis_for_articles(self, article_ids: list[int]) -> None:
        if not article_ids:
            return

        placeholders = ",".join(["%s"] * len(article_ids))
        query = f"""
        DELETE FROM "ArticleDuplicateAnalyses"
        WHERE "articleIdNew" IN ({placeholders})
        """
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute(query, tuple(article_ids))
            conn.commit()
        except psycopg.Error as exc:
            raise DeduperDatabaseError(f"Failed to clear existing analysis: {exc}") from exc

    def clear_all_analysis_data(self) -> int:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) FROM "ArticleDuplicateAnalyses"')
            row_count = int(self._scalar(cursor.fetchone()))

            cursor.execute('DELETE FROM "ArticleDuplicateAnalyses"')
            conn.commit()
            return row_count
        except psycopg.Error as exc:
            raise DeduperDatabaseError(f"Failed to clear analysis table: {exc}") from exc

    def get_analysis_records_for_state_update(self) -> list[dict[str, Any]]:
        return self.execute_query(
            """
            SELECT id, "articleIdNew", "articleIdApproved"
            FROM "ArticleDuplicateAnalyses"
            WHERE "articleNewState" = '' OR "articleApprovedState" = '' OR "sameStateFlag" = 0
            """
        )

    def get_article_state(self, article_id: int) -> str | None:
        rows = self.execute_query(
            """
            SELECT s.abbreviation
            FROM "Articles" a
            JOIN "ArticleStateContracts" asct ON a.id = asct."articleId"
            JOIN "States" s ON asct."stateId" = s.id
            WHERE a.id = %s
            LIMIT 1
            """,
            (article_id,),
        )
        return rows[0]["abbreviation"] if rows else None

    def update_analysis_states_batch(self, updates: list[dict[str, Any]]) -> int:
        if not updates:
            return 0

        query = """
        UPDATE "ArticleDuplicateAnalyses"
        SET "articleNewState" = %s, "articleApprovedState" = %s, "sameStateFlag" = %s, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = %s
        """
        params_list = [
            (
                update["articleNewState"],
                update["articleApprovedState"],
                update["sameStateFlag"],
                update["id"],
            )
            for update in updates
        ]
        return self.execute_many(query, params_list)

    def get_state_processing_stats(self) -> dict[str, int]:
        queries = {
            "same_state_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "sameStateFlag" = 1 AND "articleNewState" != \'\'',
            "different_state_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "sameStateFlag" = 0 AND "articleNewState" != \'\' AND "articleApprovedState" != \'\'',
            "missing_state_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "articleNewState" = \'\' OR "articleApprovedState" = \'\'',
        }

        return self._count_queries(queries)

    def get_analysis_records_for_url_update(self) -> list[dict[str, Any]]:
        return self.execute_query(
            """
            SELECT id, "articleIdNew", "articleIdApproved"
            FROM "ArticleDuplicateAnalyses"
            WHERE "urlCheck" = 0
            """
        )

    def get_article_url(self, article_id: int) -> str | None:
        rows = self.execute_query(
            """
            SELECT url
            FROM "Articles"
            WHERE id = %s
            """,
            (article_id,),
        )
        return rows[0]["url"] if rows else None

    def update_analysis_url_check_batch(self, updates: list[dict[str, Any]]) -> int:
        if not updates:
            return 0

        query = """
        UPDATE "ArticleDuplicateAnalyses"
        SET "urlCheck" = %s, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = %s
        """
        params_list = [(update["urlCheck"], update["id"]) for update in updates]
        return self.execute_many(query, params_list)

    def get_url_check_processing_stats(self) -> dict[str, int]:
        queries = {
            "url_match_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "urlCheck" = 1',
            "url_no_match_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "urlCheck" = 0',
        }

        return self._count_queries(queries)

    def get_analysis_records_for_content_hash_update(self) -> list[dict[str, Any]]:
        return self.execute_query(
            """
            SELECT id, "articleIdNew", "articleIdApproved"
            FROM "ArticleDuplicateAnalyses"
            WHERE "contentHash" = 0
            """
        )

    def get_analysis_records_for_content_hash_update_with_contents(self, limit: int) -> list[dict[str, Any]]:
        return self.execute_query(
            """
            SELECT
                adr.id,
                adr."articleIdNew",
                adr."articleIdApproved",
                aa1."headlineForPdfReport" AS "headlineNew",
                aa1."textForPdfReport" AS "textNew",
                aa2."headlineForPdfReport" AS "headlineApproved",
                aa2."textForPdfReport" AS "textApproved"
            FROM "ArticleDuplicateAnalyses" adr
            JOIN "ArticleApproveds" aa1 ON aa1."articleId" = adr."articleIdNew"
            JOIN "ArticleApproveds" aa2 ON aa2."articleId" = adr."articleIdApproved"
            WHERE adr."contentHash" = 0
            LIMIT %s
            """,
            (limit,),
        )

    def get_article_content(self, article_id: int) -> str | None:
        rows = self.execute_query(
            """
            SELECT "textForPdfReport"
            FROM "ArticleApproveds"
            WHERE "articleId" = %s AND "isApproved" = TRUE
            LIMIT 1
            """,
            (article_id,),
        )
        return rows[0]["textForPdfReport"] if rows else None

    def update_analysis_content_hash_batch(self, updates: list[dict[str, Any]]) -> int:
        if not updates:
            return 0

        query = """
        UPDATE "ArticleDuplicateAnalyses"
        SET "contentHash" = %s, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = %s
        """
        params_list = [(float(update["contentHash"]), update["id"]) for update in updates]
        return self.execute_many(query, params_list)

    def get_content_hash_processing_stats(self) -> dict[str, int]:
        queries = {
            "exact_match_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "contentHash" = 1.0',
            "high_similarity_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "contentHash" >= 0.85 AND "contentHash" < 1.0',
            "medium_similarity_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "contentHash" >= 0.5 AND "contentHash" < 0.85',
            "low_similarity_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "contentHash" > 0.0 AND "contentHash" < 0.5',
            "no_match_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "contentHash" = 0.0',
            "processed_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "contentHash" > 0',
        }

        return self._count_queries(queries)

    def get_analysis_records_for_embedding_update(self) -> list[dict[str, Any]]:
        return self.execute_query(
            """
            SELECT id, "articleIdNew", "articleIdApproved"
            FROM "ArticleDuplicateAnalyses"
            WHERE "embeddingSearch" = 0
            """
        )

    def update_analysis_embedding_batch(self, updates: list[dict[str, Any]]) -> int:
        if not updates:
            return 0

        query = """
        UPDATE "ArticleDuplicateAnalyses"
        SET "embeddingSearch" = %s, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = %s
        """
        params_list = [(float(update["embeddingSearch"]), update["id"]) for update in updates]
        return self.execute_many(query, params_list)

    def get_embedding_processing_stats(self) -> dict[str, int]:
        queries = {
            "high_similarity_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "embeddingSearch" > 0.8',
            "medium_similarity_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "embeddingSearch" BETWEEN 0.5 AND 0.8',
            "low_similarity_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "embeddingSearch" < 0.5 AND "embeddingSearch" > 0',
            "processed_count": 'SELECT COUNT(*) FROM "ArticleDuplicateAnalyses" WHERE "embeddingSearch" > 0',
        }

        return self._count_queries(queries)

    def _count_queries(self, queries: dict[str, str]) -> dict[str, int]:
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            stats: dict[str, int] = {}
            for key, query in queries.items():
                cursor.execute(query)
                stats[key] = int(self._scalar(cursor.fetchone()))
            return stats
        except psycopg.Error as exc:
            raise DeduperDatabaseError(f"Failed to collect stats: {exc}") from exc

    def __enter__(self) -> "DeduperRepository":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()
