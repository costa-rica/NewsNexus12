"""Lazy sentence-transformer encoder shared across embedding callers."""

from __future__ import annotations

import threading
from typing import Any

from src.modules.article_embeddings.errors import ArticleEmbeddingsError

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover
    SentenceTransformer = None  # type: ignore

MAX_SEQ_LENGTH = 256

# Process-wide model cache: loading the model is slow, so every encoder for the
# same model name shares one instance.
_MODEL_CACHE: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()


def reset_model_cache() -> None:
    """Drop cached models. Intended for tests."""
    with _MODEL_LOCK:
        _MODEL_CACHE.clear()


def require_numpy() -> Any:
    if np is None:
        raise ArticleEmbeddingsError("Article embeddings require numpy, but it is not installed.")
    return np


def _load_model(model_name: str) -> Any:
    with _MODEL_LOCK:
        model = _MODEL_CACHE.get(model_name)
        if model is not None:
            return model
        if SentenceTransformer is None:
            raise ArticleEmbeddingsError(
                "Article embeddings require sentence-transformers, but it is not installed."
            )
        try:
            model = SentenceTransformer(model_name)
            model.max_seq_length = MAX_SEQ_LENGTH
        except Exception as exc:  # pragma: no cover
            raise ArticleEmbeddingsError(f"Failed to load embedding model: {exc}") from exc
        _MODEL_CACHE[model_name] = model
        return model


class EmbeddingEncoder:
    """Encodes preprocessed text into normalized float32 vectors.

    The model loads on first use, so callers that have nothing to encode never
    pay the load cost.
    """

    def __init__(self, model_name: str, batch_size: int) -> None:
        self.model_name = model_name
        self.batch_size = batch_size

    def dimension(self) -> int:
        return int(_load_model(self.model_name).get_sentence_embedding_dimension())

    def encode(self, texts: list[str]) -> list[Any]:
        """Encode preprocessed texts. Empty text yields a zero vector."""
        numpy = require_numpy()
        if not texts:
            return []

        model = _load_model(self.model_name)
        dimension = int(model.get_sentence_embedding_dimension())
        results: list[Any] = [None] * len(texts)

        non_empty_positions = [index for index, text in enumerate(texts) if text]
        if non_empty_positions:
            encoded = model.encode(
                [texts[index] for index in non_empty_positions],
                batch_size=self.batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
            )
            for position, vector in zip(non_empty_positions, encoded):
                results[position] = numpy.asarray(vector, dtype=numpy.float32)

        for index, value in enumerate(results):
            if value is None:
                results[index] = numpy.zeros(dimension, dtype=numpy.float32)

        return results
