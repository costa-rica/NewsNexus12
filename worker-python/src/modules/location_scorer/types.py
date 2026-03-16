"""Typed models for location scorer orchestration state and results."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


class LocationScorerStep(StrEnum):
    LOAD = "load"
    CLASSIFY = "classify"
    WRITE = "write"


class LocationScorerRunMode(StrEnum):
    SCORE = "score"


@dataclass(slots=True)
class StepProgress:
    step: LocationScorerStep
    status: str = "pending"
    processed: int = 0
    total: int = 0
    message: str = ""
    started_at: str | None = None
    completed_at: str | None = None


@dataclass(slots=True)
class PipelineSummary:
    mode: LocationScorerRunMode
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: str | None = None
    steps: list[StepProgress] = field(default_factory=list)
    status: str = "pending"
    limit: int | None = None
