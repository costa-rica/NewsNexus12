"""Article embeddings error types.

This module never imports deduper or queue errors. Callers translate
ArticleEmbeddingsCancelledError into the cancel error their own runner expects.
"""


class ArticleEmbeddingsError(Exception):
    """Base exception for all article embeddings errors."""


class ArticleEmbeddingsConfigError(ArticleEmbeddingsError):
    """Raised when article embeddings configuration is invalid or incomplete."""


class ArticleEmbeddingsDatabaseError(ArticleEmbeddingsError):
    """Raised for repository or Postgres related failures."""


class ArticleEmbeddingsCancelledError(ArticleEmbeddingsError):
    """Raised when a sync or ensure operation is cancelled between batches."""
