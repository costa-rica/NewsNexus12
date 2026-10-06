"""Embedding processor for deduper in-process pipeline."""

from __future__ import annotations

from typing import Any

from loguru import logger

from src.modules.article_embeddings import (
    ArticleEmbeddingService,
    ArticleEmbeddingsCancelledError,
)
from src.modules.article_embeddings import encoder as encoder_mod
from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.embedding_service import build_embedding_service
from src.modules.deduper.errors import DeduperProcessorError
from src.modules.deduper.repository import DeduperRepository


class EmbeddingProcessor:
    def __init__(
        self,
        repository: DeduperRepository,
        config: DeduperConfig,
        embedding_service: ArticleEmbeddingService | None = None,
    ) -> None:
        self.repository = repository
        self.config = config
        self.embedding_service = embedding_service
        self.logger = logger

    def execute(self, should_cancel=None) -> dict[str, Any]:
        cancel_check = should_cancel or (lambda: False)
        if not self.config.enable_embedding:
            return {"processed": 0, "status": "skipped", "reason": "embedding disabled"}

        if encoder_mod.SentenceTransformer is None or encoder_mod.np is None:
            raise DeduperProcessorError(
                "Embedding stage requires sentence-transformers and numpy, "
                "but one or both are not installed."
            )
        numpy = encoder_mod.np

        article_ids = self.repository.get_analysis_article_ids()
        if not article_ids:
            return {
                "processed": 0,
                "status": "ok",
                "high_similarity_count": 0,
                "medium_similarity_count": 0,
                "low_similarity_count": 0,
            }

        service = self.embedding_service or build_embedding_service(self.repository)
        try:
            # One call for the whole run; also the fallback for articles approved
            # or edited after the sync step. Only articles with text are returned.
            embeddings = service.ensure_embeddings(article_ids, should_cancel=should_cancel)
        except ArticleEmbeddingsCancelledError as exc:
            raise DeduperProcessorError("Embedding processor cancelled") from exc

        page_size = self.config.batch_size_embedding
        processed = 0
        after_id = 0
        self.logger.info(
            "event=embedding_start articles={} with_text={} page_size={}",
            len(article_ids),
            len(embeddings),
            page_size,
        )

        # Page through records so at most one page of records and scores is held.
        while True:
            if cancel_check():
                raise DeduperProcessorError("Embedding processor cancelled")

            page = self.repository.get_analysis_records_for_embedding_update_page(
                after_id=after_id, limit=page_size
            )
            if not page:
                break

            updates = [
                {
                    "id": record["id"],
                    "embeddingSearch": self._score(
                        embeddings.get(record["articleIdNew"]),
                        embeddings.get(record["articleIdApproved"]),
                        numpy,
                    ),
                }
                for record in page
            ]
            self.repository.update_analysis_embedding_batch(updates)
            processed += len(page)
            after_id = page[-1]["id"]

        stats = self.repository.get_embedding_processing_stats()
        stats["processed"] = processed
        stats["status"] = "ok"
        self.logger.info("event=embedding_complete processed={}", processed)
        return stats

    @staticmethod
    def _score(embedding_new: Any, embedding_approved: Any, numpy: Any) -> float:
        # An article is missing from the dictionary exactly when it has no text.
        if embedding_new is None and embedding_approved is None:
            return 1.0
        if embedding_new is None or embedding_approved is None:
            return 0.0
        similarity = float(numpy.dot(embedding_new, embedding_approved))
        return max(0.0, min(1.0, similarity))
