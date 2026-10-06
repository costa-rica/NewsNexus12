"""Typed models for deduper orchestration state and results."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


class PipelineStep(StrEnum):
    LOAD = "load"
    STATES = "states"
    URL_CHECK = "url_check"
    CONTENT_HASH = "content_hash"
    EMBEDDING_SYNC = "embedding_sync"
    EMBEDDING = "embedding"


class PipelineRunMode(StrEnum):
    ANALYZE = "analyze"
    ANALYZE_FAST = "analyze_fast"


@dataclass(slots=True)
class DeduperRunRequest:
    mode: PipelineRunMode
    report_id: int | None = None


@dataclass(slots=True)
class StepProgress:
    step: PipelineStep
    status: str = "pending"
    processed: int = 0
    total: int = 0
    message: str = ""
    started_at: str | None = None
    completed_at: str | None = None


@dataclass(slots=True)
class PipelineSummary:
    mode: PipelineRunMode
    report_id: int | None = None
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: str | None = None
    steps: list[StepProgress] = field(default_factory=list)
    status: str = "pending"
