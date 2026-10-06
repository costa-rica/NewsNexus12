"""Article embedding sync and lookup service."""

from __future__ import annotations

import time
from typing import Any, Callable, Iterable

from loguru import logger

from src.modules.article_embeddings.config import ArticleEmbeddingsConfig
from src.modules.article_embeddings.encoder import EmbeddingEncoder, require_numpy
from src.modules.article_embeddings.errors import ArticleEmbeddingsCancelledError
from src.modules.article_embeddings.repository import ArticleEmbeddingRepository
from src.modules.article_embeddings.text import preprocess_text, text_hash
from src.modules.article_embeddings.types import EmbeddingSyncMode, EmbeddingSyncSummary


def serialize_embedding(vector: Any) -> bytes:
    numpy = require_numpy()
    return numpy.asarray(vector, dtype="<f4").tobytes()


def deserialize_embedding(data: bytes, dimension: int) -> Any:
    numpy = require_numpy()
    vector = numpy.frombuffer(data, dtype="<f4")
    if vector.shape[0] != dimension:
        raise ValueError(
            f"Stored embedding has {vector.shape[0]} values but dimension is {dimension}"
        )
    return vector


class ArticleEmbeddingService:
    """Keeps ArticleEmbeddings in line with current approved article text.

    Row lifecycle rule: a row for the current model exists only while the
    article's newest approved row has non-null text, and its textHash matches
    that text after preprocessing. sync() enforces this for the whole table;
    ensure_embeddings() enforces it for the IDs it is given.

    The service never creates or closes connections; its repository's owner does.
    """

    def __init__(
        self,
        repository: ArticleEmbeddingRepository,
        encoder: Any,
        model_name: str,
        batch_size: int,
    ) -> None:
        self.repository = repository
        self.encoder = encoder
        self.model_name = model_name
        self.batch_size = batch_size
        self.logger = logger

    @classmethod
    def from_config(
        cls, repository: ArticleEmbeddingRepository, config: ArticleEmbeddingsConfig
    ) -> "ArticleEmbeddingService":
        return cls(
            repository=repository,
            encoder=EmbeddingEncoder(config.model_name, config.batch_size),
            model_name=config.model_name,
            batch_size=config.batch_size,
        )

    # --- public API ---

    def sync(
        self,
        mode: EmbeddingSyncMode = EmbeddingSyncMode.INCREMENTAL,
        should_cancel: Callable[[], bool] | None = None,
    ) -> EmbeddingSyncSummary:
        started = time.perf_counter()
        mode = EmbeddingSyncMode(mode)
        summary = EmbeddingSyncSummary(mode=mode)

        texts = self.repository.get_approved_article_texts()
        summary.approved_articles = len(texts)

        current: dict[int, tuple[str, str]] = {}
        for article_id, raw_text in texts.items():
            if raw_text is None:
                continue
            preprocessed = preprocess_text(raw_text)
            current[article_id] = (preprocessed, text_hash(preprocessed))

        stored_hashes = self.repository.get_embedding_hashes(self.model_name)
        missing_ids = [article_id for article_id in current if article_id not in stored_hashes]
        stale_ids = [
            article_id
            for article_id, (_, hash_value) in current.items()
            if article_id in stored_hashes and stored_hashes[article_id] != hash_value
        ]
        summary.missing = len(missing_ids)
        summary.stale = len(stale_ids)

        if mode == EmbeddingSyncMode.REBUILD:
            to_encode = sorted(current)
        else:
            to_encode = sorted(missing_ids + stale_ids)

        self.logger.info(
            "event=article_embeddings_sync_start mode={} approved={} missing={} stale={} to_encode={}",
            mode,
            summary.approved_articles,
            summary.missing,
            summary.stale,
            len(to_encode),
        )

        encoded, upserted = self._encode_and_upsert(
            [(article_id, *current[article_id]) for article_id in to_encode],
            should_cancel,
        )
        summary.encoded = encoded
        summary.upserted = upserted
        summary.deleted = self.repository.delete_embeddings_without_current_text(self.model_name)
        summary.elapsed_seconds = round(time.perf_counter() - started, 3)

        self.logger.info(
            "event=article_embeddings_sync_complete mode={} encoded={} upserted={} deleted={} elapsed_seconds={}",
            mode,
            summary.encoded,
            summary.upserted,
            summary.deleted,
            summary.elapsed_seconds,
        )
        return summary

    def load_embeddings(self, article_ids: Iterable[int]) -> dict[int, Any]:
        """Read stored embeddings only. Never encodes or checks current text."""
        rows = self.repository.get_embeddings(article_ids, self.model_name)
        return {
            article_id: deserialize_embedding(row["embedding"], row["embeddingDimension"])
            for article_id, row in rows.items()
        }

    def ensure_embeddings(
        self,
        article_ids: Iterable[int],
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict[int, Any]:
        """Return current embeddings for every given ID that has non-null text.

        Stored rows are used only when their hash matches the current text.
        Missing or changed rows are encoded and stored. IDs whose text is null
        or missing have any stored row deleted and are left out of the result.
        """
        ids = sorted({int(article_id) for article_id in article_ids})
        if not ids:
            return {}

        texts = self.repository.get_selected_texts(ids)
        stored = self.repository.get_embeddings(ids, self.model_name)

        without_text = [article_id for article_id in ids if texts.get(article_id) is None]
        stale_rows_without_text = [article_id for article_id in without_text if article_id in stored]
        if stale_rows_without_text:
            self.repository.delete_embeddings(stale_rows_without_text, self.model_name)

        result: dict[int, Any] = {}
        to_encode: list[tuple[int, str, str]] = []
        for article_id in ids:
            raw_text = texts.get(article_id)
            if raw_text is None:
                continue
            preprocessed = preprocess_text(raw_text)
            hash_value = text_hash(preprocessed)
            row = stored.get(article_id)
            if row is not None and row["textHash"] == hash_value:
                result[article_id] = deserialize_embedding(
                    row["embedding"], row["embeddingDimension"]
                )
            else:
                to_encode.append((article_id, preprocessed, hash_value))

        if to_encode:
            self.logger.info(
                "event=article_embeddings_ensure_encode count={}", len(to_encode)
            )
            result.update(self._encode_items(to_encode, should_cancel))

        return result

    # --- internals ---

    def _encode_and_upsert(
        self,
        items: list[tuple[int, str, str]],
        should_cancel: Callable[[], bool] | None,
    ) -> tuple[int, int]:
        vectors = self._encode_items(items, should_cancel)
        return len(vectors), len(vectors)

    def _encode_items(
        self,
        items: list[tuple[int, str, str]],
        should_cancel: Callable[[], bool] | None,
    ) -> dict[int, Any]:
        """Encode (articleId, preprocessedText, textHash) items in batches and upsert each batch."""
        cancel_check = should_cancel or (lambda: False)
        vectors: dict[int, Any] = {}

        for start in range(0, len(items), self.batch_size):
            if cancel_check():
                raise ArticleEmbeddingsCancelledError("Article embeddings operation cancelled")

            batch = items[start : start + self.batch_size]
            encoded = self.encoder.encode([preprocessed for _, preprocessed, _ in batch])
            rows = []
            for (article_id, _, hash_value), vector in zip(batch, encoded):
                rows.append(
                    {
                        "articleId": article_id,
                        "modelName": self.model_name,
                        "embeddingDimension": int(len(vector)),
                        "textHash": hash_value,
                        "embedding": serialize_embedding(vector),
                    }
                )
                vectors[article_id] = deserialize_embedding(
                    rows[-1]["embedding"], rows[-1]["embeddingDimension"]
                )
            self.repository.upsert_embeddings(rows)

        return vectors
