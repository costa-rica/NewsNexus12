"""Article embeddings: stored sentence embeddings for approved articles.

Shared by the deduper pipeline and the standalone /article-embeddings route.
"""

from src.modules.article_embeddings.config import ArticleEmbeddingsConfig
from src.modules.article_embeddings.encoder import EmbeddingEncoder
from src.modules.article_embeddings.errors import (
    ArticleEmbeddingsCancelledError,
    ArticleEmbeddingsConfigError,
    ArticleEmbeddingsDatabaseError,
    ArticleEmbeddingsError,
)
from src.modules.article_embeddings.repository import ArticleEmbeddingRepository
from src.modules.article_embeddings.service import ArticleEmbeddingService
from src.modules.article_embeddings.text import preprocess_text, text_hash
from src.modules.article_embeddings.types import EmbeddingSyncMode, EmbeddingSyncSummary

__all__ = [
    "ArticleEmbeddingRepository",
    "ArticleEmbeddingService",
    "ArticleEmbeddingsCancelledError",
    "ArticleEmbeddingsConfig",
    "ArticleEmbeddingsConfigError",
    "ArticleEmbeddingsDatabaseError",
    "ArticleEmbeddingsError",
    "EmbeddingEncoder",
    "EmbeddingSyncMode",
    "EmbeddingSyncSummary",
    "preprocess_text",
    "text_hash",
]
