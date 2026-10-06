"""Builds the article embeddings service a deduper run shares across steps."""

from __future__ import annotations

from src.modules.article_embeddings import (
    ArticleEmbeddingRepository,
    ArticleEmbeddingService,
    ArticleEmbeddingsConfig,
)
from src.modules.deduper.repository import DeduperRepository


def build_embedding_service(repository: DeduperRepository) -> ArticleEmbeddingService:
    """Return a service that borrows the deduper job's connection.

    The embeddings repository never closes that connection; the job's
    DeduperRepository.close() remains the only close.
    """
    config = ArticleEmbeddingsConfig.from_env()
    embedding_repository = ArticleEmbeddingRepository(
        connection_provider=lambda: repository.get_connection(),
        owns_connection=False,
    )
    return ArticleEmbeddingService.from_config(embedding_repository, config)
