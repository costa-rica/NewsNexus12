"""Location scorer orchestration for in-process scoring pipelines."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from datetime import datetime, timezone
import time
from typing import Any

from loguru import logger

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import LocationScorerProcessorError
from src.modules.location_scorer.processors.classify import ClassifyProcessor
from src.modules.location_scorer.processors.load import LoadProcessor
from src.modules.location_scorer.processors.write import WriteProcessor
from src.modules.location_scorer.repository import LocationScorerRepository
from src.modules.location_scorer.types import (
    LocationScorerRunMode,
    LocationScorerStep,
    PipelineSummary,
    StepProgress,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocationScorerOrchestrator:
    def __init__(
        self,
        repository: LocationScorerRepository,
        config: LocationScorerConfig,
    ) -> None:
        self.repository = repository
        self.config = config
        self.logger = logger

    def check_ready(self) -> bool:
        return self.repository.healthcheck()

    def new_summary(self, mode: LocationScorerRunMode) -> PipelineSummary:
        return PipelineSummary(mode=mode)

    def run_score(
        self,
        limit: int | None = None,
        should_cancel: Callable[[], bool] | None = None,
        on_progress: Callable[[PipelineSummary], None] | None = None,
    ) -> PipelineSummary:
        summary = self.new_summary(LocationScorerRunMode.SCORE)
        summary.limit = limit
        summary.status = "running"

        load_result: dict[str, Any] = {}

        def run_load() -> dict[str, Any]:
            nonlocal load_result
            load_result = LoadProcessor(self.repository, self.config).execute(
                limit=limit,
                should_cancel=should_cancel,
            )
            return load_result

        def run_classify() -> dict[str, Any]:
            return ClassifyProcessor(self.repository, self.config).execute(
                load_result.get("articles", []),
                should_cancel=should_cancel,
            )

        classify_result: dict[str, Any] = {}

        def run_classify_capture() -> dict[str, Any]:
            nonlocal classify_result
            classify_result = run_classify()
            return classify_result

        def run_write() -> dict[str, Any]:
            return WriteProcessor(self.repository, self.config).execute(
                int(load_result["entity_id"]),
                list(classify_result.get("scores", [])),
                should_cancel=should_cancel,
            )

        steps = [
            (LocationScorerStep.LOAD, run_load),
            (LocationScorerStep.CLASSIFY, run_classify_capture),
            (LocationScorerStep.WRITE, run_write),
        ]

        self._execute_pipeline_steps(summary, steps, should_cancel, on_progress)
        return summary

    def _execute_pipeline_steps(
        self,
        summary: PipelineSummary,
        steps: list[tuple[LocationScorerStep, Callable[[], dict[str, Any]]]],
        should_cancel: Callable[[], bool] | None,
        on_progress: Callable[[PipelineSummary], None] | None,
    ) -> None:
        cancel_check = should_cancel or (lambda: False)
        emit_progress = on_progress or (lambda current_summary: None)

        try:
            emit_progress(deepcopy(summary))
            for step, fn in steps:
                if cancel_check():
                    raise LocationScorerProcessorError("Pipeline cancelled")

                progress = StepProgress(
                    step=step,
                    status="running",
                    started_at=_utc_now_iso(),
                )
                summary.steps.append(progress)
                emit_progress(deepcopy(summary))
                self.logger.info(
                    "event=location_scorer_step_start step={} limit={}",
                    step,
                    summary.limit,
                )
                step_started = time.perf_counter()

                result = fn()

                progress.status = "completed"
                progress.completed_at = _utc_now_iso()
                progress.processed = int(result.get("processed", 0))
                progress.total = int(result.get("total", progress.processed))
                progress.message = str(result)
                emit_progress(deepcopy(summary))
                duration_ms = int((time.perf_counter() - step_started) * 1000)
                self.logger.info(
                    "event=location_scorer_step_complete step={} processed={} duration_ms={}",
                    step,
                    progress.processed,
                    duration_ms,
                )

            summary.status = "completed"
            emit_progress(deepcopy(summary))
            self.logger.info(
                "event=location_scorer_pipeline_complete limit={}",
                summary.limit,
            )
        except LocationScorerProcessorError:
            summary.status = "cancelled"
            emit_progress(deepcopy(summary))
            self.logger.warning(
                "event=location_scorer_pipeline_cancelled limit={}",
                summary.limit,
            )
            raise
        except Exception as exc:
            summary.status = "failed"
            emit_progress(deepcopy(summary))
            self.logger.error(
                "event=location_scorer_pipeline_failed limit={} error={}",
                summary.limit,
                exc,
            )
            raise
        finally:
            summary.completed_at = _utc_now_iso()
            emit_progress(deepcopy(summary))
