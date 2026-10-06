"""Text preprocessing and hashing shared by embedding sync and the deduper."""

from __future__ import annotations

import hashlib
import re

MAX_TEXT_CHARS = 1000


def preprocess_text(text: str | None) -> str:
    """Strip HTML tags, collapse whitespace and cap length.

    Behavior matches the former EmbeddingProcessor._preprocess_text exactly, so
    stored embeddings score the same as on-the-fly encodings.
    """
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_TEXT_CHARS] if len(cleaned) > MAX_TEXT_CHARS else cleaned


def text_hash(preprocessed_text: str) -> str:
    """Return the sha256 hex digest of already-preprocessed text."""
    return hashlib.sha256(preprocessed_text.encode("utf-8")).hexdigest()
