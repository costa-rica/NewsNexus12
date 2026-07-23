"""Shared AI Approver V02 value types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


SelectionMode = Literal["article_position_count", "until_last_approved"]
ContentSource = Literal["article_contents_02", "description"]
OutcomeStatus = Literal["completed", "failed", "invalid_response"]


@dataclass(frozen=True, slots=True)
class SelectionItem:
    article_id: int
    content_source: ContentSource
    article_contents_02_id: int | None

    def to_json(self) -> dict[str, int | str | None]:
        return {
            "articleId": self.article_id,
            "contentSource": self.content_source,
            "articleContents02Id": self.article_contents_02_id,
        }


@dataclass(frozen=True, slots=True)
class ArticleInput:
    article_id: int
    title: str
    content: str
    content_source: ContentSource
    article_contents_02_id: int | None


@dataclass(frozen=True, slots=True)
class ModelOutcome:
    status: OutcomeStatus
    prediction: str | None = None
    reasoning: str | None = None
    error_code: str | None = None
    error_message: str | None = None
