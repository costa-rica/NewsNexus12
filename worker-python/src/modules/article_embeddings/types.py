"""Typed models for article embeddings sync results."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any


class EmbeddingSyncMode(StrEnum):
    INCREMENTAL = "incremental"
    REBUILD = "rebuild"


@dataclass(slots=True)
class EmbeddingSyncSummary:
    mode: EmbeddingSyncMode
    approved_articles: int = 0
    missing: int = 0
    stale: int = 0
    encoded: int = 0
    upserted: int = 0
    deleted: int = 0
    elapsed_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["mode"] = str(self.mode)
        result["processed"] = self.encoded
        result["status"] = "ok"
        return result
