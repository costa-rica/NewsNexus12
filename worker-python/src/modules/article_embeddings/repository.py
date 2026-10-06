"""Postgres repository for ArticleEmbeddings and approved article text."""

from __future__ import annotations

from typing import Any, Callable, Iterable

import psycopg
from psycopg import errors as pg_errors
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from src.modules.article_embeddings.config import ArticleEmbeddingsConfig
from src.modules.article_embeddings.errors import ArticleEmbeddingsDatabaseError

# Newest approved row per article. Every text read in this module uses this rule.
_SELECTED_TEXT_SQL = """
    SELECT DISTINCT ON ("articleId") "articleId", "textForPdfReport"
    FROM "ArticleApproveds"
    WHERE "isApproved" = TRUE{extra_filter}
    ORDER BY "articleId", id DESC
"""


class ArticleEmbeddingRepository:
    """SQL access for article embeddings.

    Borrowed mode (owns_connection=False): uses a connection owned by someone
    else, such as the deduper job's DeduperRepository, and close() does nothing.
    Owned mode (from_config): creates its own pool and close() releases it.
    """

    def __init__(
        self,
        connection_provider: Callable[[], psycopg.Connection] | None = None,
        owns_connection: bool = False,
        pool: ConnectionPool | None = None,
    ) -> None:
        if owns_connection and pool is None:
            raise ValueError("An owning repository needs a pool; use from_config().")
        if not owns_connection and connection_provider is None:
            raise ValueError("A borrowing repository needs a connection_provider.")
        self.owns_connection = owns_connection
        self._pool = pool
        self._owned_connection: psycopg.Connection | None = None
        self._connection_provider = connection_provider or self._get_owned_connection

    @classmethod
    def from_config(cls, config: ArticleEmbeddingsConfig) -> "ArticleEmbeddingRepository":
        pool = ConnectionPool(
            conninfo=config.dsn,
            min_size=1,
            max_size=2,
            kwargs={"row_factory": dict_row},
            open=False,
        )
        return cls(owns_connection=True, pool=pool)

    def _get_owned_connection(self) -> psycopg.Connection:
        if self._owned_connection is None:
            assert self._pool is not None
            if self._pool.closed:
                self._pool.open()
            self._owned_connection = self._pool.getconn()
        return self._owned_connection

    def close(self) -> None:
        if not self.owns_connection:
            return
        if self._owned_connection is not None and self._pool is not None:
            self._pool.putconn(self._owned_connection)
            self._owned_connection = None
        if self._pool is not None and not self._pool.closed:
            self._pool.close()

    def __enter__(self) -> "ArticleEmbeddingRepository":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    # --- low-level helpers ---

    def _fetch_all(self, query: str, params: tuple = ()) -> list[dict[str, Any]]:
        conn = self._connection_provider()
        try:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(query, params)
                return [dict(row) for row in cursor.fetchall()]
        except psycopg.Error as exc:
            self._rollback(conn)
            raise self._wrap_error(exc) from exc

    def _execute_write(self, query: str, params: tuple = ()) -> int:
        conn = self._connection_provider()
        try:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                rowcount = cursor.rowcount
            conn.commit()
            return rowcount
        except psycopg.Error as exc:
            self._rollback(conn)
            raise self._wrap_error(exc) from exc

    def _execute_many_write(self, query: str, params_list: list[tuple]) -> int:
        conn = self._connection_provider()
        try:
            with conn.cursor() as cursor:
                cursor.executemany(query, params_list)
            conn.commit()
            return len(params_list)
        except psycopg.Error as exc:
            self._rollback(conn)
            raise self._wrap_error(exc) from exc

    @staticmethod
    def _rollback(conn: psycopg.Connection) -> None:
        # Leave a borrowed connection usable for its owner after a failed statement.
        try:
            conn.rollback()
        except psycopg.Error:  # pragma: no cover
            pass

    @staticmethod
    def _wrap_error(exc: psycopg.Error) -> ArticleEmbeddingsDatabaseError:
        if isinstance(exc, pg_errors.UndefinedTable):
            return ArticleEmbeddingsDatabaseError(
                "ArticleEmbeddings table does not exist. Start the api (sequelize.sync) "
                f"to create it. Detail: {exc}"
            )
        return ArticleEmbeddingsDatabaseError(f"Article embeddings query failed: {exc}")

    @staticmethod
    def _id_list(article_ids: Iterable[int]) -> list[int]:
        return sorted({int(article_id) for article_id in article_ids})

    # --- article text ---

    def get_approved_article_texts(self) -> dict[int, str | None]:
        rows = self._fetch_all(_SELECTED_TEXT_SQL.format(extra_filter=""))
        return {int(row["articleId"]): row["textForPdfReport"] for row in rows}

    def get_selected_texts(self, article_ids: Iterable[int]) -> dict[int, str | None]:
        ids = self._id_list(article_ids)
        if not ids:
            return {}
        rows = self._fetch_all(
            _SELECTED_TEXT_SQL.format(extra_filter=' AND "articleId" = ANY(%s)'),
            (ids,),
        )
        return {int(row["articleId"]): row["textForPdfReport"] for row in rows}

    # --- embeddings ---

    def get_embedding_hashes(self, model_name: str) -> dict[int, str]:
        rows = self._fetch_all(
            'SELECT "articleId", "textHash" FROM "ArticleEmbeddings" WHERE "modelName" = %s',
            (model_name,),
        )
        return {int(row["articleId"]): row["textHash"] for row in rows}

    def get_embeddings(
        self, article_ids: Iterable[int], model_name: str
    ) -> dict[int, dict[str, Any]]:
        """Return {articleId: {"textHash", "embedding" (bytes), "embeddingDimension"}}."""
        ids = self._id_list(article_ids)
        if not ids:
            return {}
        rows = self._fetch_all(
            """
            SELECT "articleId", "textHash", "embedding", "embeddingDimension"
            FROM "ArticleEmbeddings"
            WHERE "modelName" = %s AND "articleId" = ANY(%s)
            """,
            (model_name, ids),
        )
        return {
            int(row["articleId"]): {
                "textHash": row["textHash"],
                "embedding": bytes(row["embedding"]),
                "embeddingDimension": int(row["embeddingDimension"]),
            }
            for row in rows
        }

    def upsert_embeddings(self, rows: list[dict[str, Any]]) -> int:
        """Insert or update rows keyed by ("articleId", "modelName")."""
        if not rows:
            return 0
        query = """
        INSERT INTO "ArticleEmbeddings"
            ("articleId", "modelName", "embeddingDimension", "textHash", "embedding", "createdAt", "updatedAt")
        VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("articleId", "modelName") DO UPDATE SET
            "embeddingDimension" = EXCLUDED."embeddingDimension",
            "textHash" = EXCLUDED."textHash",
            "embedding" = EXCLUDED."embedding",
            "updatedAt" = CURRENT_TIMESTAMP
        """
        params_list = [
            (
                int(row["articleId"]),
                row["modelName"],
                int(row["embeddingDimension"]),
                row["textHash"],
                row["embedding"],
            )
            for row in rows
        ]
        return self._execute_many_write(query, params_list)

    def delete_embeddings_without_current_text(self, model_name: str) -> int:
        """Delete rows whose article has no selected non-null approved text.

        Covers articles that are no longer approved and articles whose newest
        approved row now has null textForPdfReport.
        """
        query = f"""
        DELETE FROM "ArticleEmbeddings" AS e
        WHERE e."modelName" = %s
          AND NOT EXISTS (
            SELECT 1
            FROM ({_SELECTED_TEXT_SQL.format(extra_filter="")}) AS selected
            WHERE selected."articleId" = e."articleId"
              AND selected."textForPdfReport" IS NOT NULL
          )
        """
        return self._execute_write(query, (model_name,))

    def delete_embeddings(self, article_ids: Iterable[int], model_name: str) -> int:
        ids = self._id_list(article_ids)
        if not ids:
            return 0
        return self._execute_write(
            'DELETE FROM "ArticleEmbeddings" WHERE "modelName" = %s AND "articleId" = ANY(%s)',
            (model_name, ids),
        )
