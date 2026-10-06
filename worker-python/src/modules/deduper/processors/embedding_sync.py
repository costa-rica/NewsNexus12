"""Embedding sync step: brings ArticleEmbeddings up to date before scoring."""

from __future__ import annotations

from typing import Any

from loguru import logger

from src.modules.article_embeddings import (
    ArticleEmbeddingService,
    ArticleEmbeddingsCancelledError,
    EmbeddingSyncMode,
)
from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.embedding_service import build_embedding_service
from src.modules.deduper.errors import DeduperProcessorError
from src.modules.deduper.repository import DeduperRepository


class EmbeddingSyncProcessor:
    def __init__(
        self,
        repository: DeduperRepository,
        config: DeduperConfig,
        embedding_service: ArticleEmbeddingService | None = None,
        mode: EmbeddingSyncMode = EmbeddingSyncMode.INCREMENTAL,
    ) -> None:
        self.repository = repository
        self.config = config
        self.embedding_service = embedding_service
        self.mode = mode
        self.logger = logger

    def execute(self, should_cancel=None) -> dict[str, Any]:
        if not self.config.enable_embedding:
            return {"processed": 0, "status": "skipped", "reason": "embedding disabled"}

        service = self.embedding_service or build_embedding_service(self.repository)
        try:
            summary = service.sync(self.mode, should_cancel=should_cancel)
        except ArticleEmbeddingsCancelledError as exc:
            # The orchestrator treats DeduperProcessorError as a cancel.
            raise DeduperProcessorError("Embedding sync cancelled") from exc

        # The orchestrator reads every step result with result.get("processed", 0).
        return summary.to_dict()
