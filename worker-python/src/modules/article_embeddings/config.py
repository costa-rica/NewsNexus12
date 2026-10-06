"""Configuration for the article embeddings module."""

from __future__ import annotations

import os
from dataclasses import dataclass

from src.modules.article_embeddings.errors import ArticleEmbeddingsConfigError

DEFAULT_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_BATCH_SIZE = 64


def _parse_positive_int(value: str, key: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ArticleEmbeddingsConfigError(f"{key} must be an integer") from exc

    if parsed <= 0:
        raise ArticleEmbeddingsConfigError(f"{key} must be > 0")

    return parsed


@dataclass(slots=True)
class ArticleEmbeddingsConfig:
    model_name: str = DEFAULT_MODEL_NAME
    batch_size: int = DEFAULT_BATCH_SIZE
    pg_host: str = ""
    pg_port: int = 5432
    pg_database: str = ""
    pg_user: str = ""
    pg_password: str = ""

    @property
    def dsn(self) -> str:
        missing = [
            key
            for key, value in (
                ("PG_HOST", self.pg_host),
                ("PG_DATABASE", self.pg_database),
                ("PG_USER", self.pg_user),
            )
            if not value
        ]
        if missing:
            raise ArticleEmbeddingsConfigError(
                "Missing required env vars for article embeddings: " + ", ".join(missing)
            )
        return (
            f"host={self.pg_host} "
            f"port={self.pg_port} "
            f"dbname={self.pg_database} "
            f"user={self.pg_user} "
            f"password={self.pg_password}"
        )

    @classmethod
    def from_env(cls) -> "ArticleEmbeddingsConfig":
        model_name = os.getenv("ARTICLE_EMBEDDINGS_MODEL_NAME", DEFAULT_MODEL_NAME).strip()
        if not model_name:
            raise ArticleEmbeddingsConfigError("ARTICLE_EMBEDDINGS_MODEL_NAME must not be empty")

        return cls(
            model_name=model_name,
            batch_size=_parse_positive_int(
                os.getenv("ARTICLE_EMBEDDINGS_BATCH_SIZE", str(DEFAULT_BATCH_SIZE)),
                "ARTICLE_EMBEDDINGS_BATCH_SIZE",
            ),
            pg_host=os.getenv("PG_HOST", "").strip(),
            pg_port=_parse_positive_int(os.getenv("PG_PORT", "5432").strip() or "5432", "PG_PORT"),
            pg_database=os.getenv("PG_DATABASE", "").strip(),
            pg_user=os.getenv("PG_USER", "").strip(),
            pg_password=os.getenv("PG_PASSWORD", "").strip(),
        )
