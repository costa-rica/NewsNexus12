from __future__ import annotations

import re

import pytest

from src.modules.article_embeddings.text import preprocess_text, text_hash


def _legacy_preprocess_text(text: str | None) -> str:
    # Copy of the former EmbeddingProcessor._preprocess_text, kept to prove parity.
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:1000] if len(cleaned) > 1000 else cleaned


@pytest.mark.unit
@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "   ",
        "<p>Hello <b>world</b></p>",
        "line one\n\n\tline   two",
        "x" * 1500,
        "<div>" + ("word " * 400) + "</div>",
    ],
)
def test_preprocess_text_matches_legacy(text: str | None) -> None:
    assert preprocess_text(text) == _legacy_preprocess_text(text)


@pytest.mark.unit
def test_text_hash_is_stable_sha256() -> None:
    first = text_hash("same text")
    assert first == text_hash("same text")
    assert first != text_hash("other text")
    assert len(first) == 64
