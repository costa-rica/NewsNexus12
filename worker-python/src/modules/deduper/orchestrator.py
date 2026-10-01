"""Deduper orchestration for in-process duplicate analysis pipelines."""

from __future__ import annotations

from datetime import datetime, timezone
import time
from typing import Any, Callable

from loguru import logger

from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.errors import DeduperProcessorError
from src.modules.deduper.processors.content_hash import ContentHashProcessor
from src.modules.deduper.processors.embedding import EmbeddingProcessor
from src.modules.deduper.processors.load import LoadProcessor
from src.modules.deduper.processors.states import StatesProcessor
from src.modules.deduper.processors.url_check import UrlCheckProcessor
from src.modules.deduper.repository import DeduperRepository
from src.modules.deduper.types import PipelineRunMode, PipelineStep, PipelineSummary, StepProgress


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DeduperOrchestrator:
    def __init__(self, repository: DeduperRepository, config: DeduperConfig) -> None:
        self.repository = repository
        self.config = config
        self.logger = logger

    def check_ready(self) -> bool:
        return self.repository.healthcheck()

    def new_summary(self, mode: PipelineRunMode) -> PipelineSummary:
        return PipelineSummary(mode=mode)

    def run_load(self, report_id: int | None = None) -> dict[str, Any]:
        return LoadProcessor(self.repository, self.config).execute(report_id=report_id)

    def run_states(self) -> dict[str, Any]:
        return StatesProcessor(self.repository, self.config).execute()

    def run_url_check(self) -> dict[str, Any]:
        return UrlCheckProcessor(self.repository, self.config).execute()

    def run_content_hash(self) -> dict[str, Any]:
        return ContentHashProcessor(self.repository, self.config).execute()

    def run_embedding(self) -> dict[str, Any]:
        return EmbeddingProcessor(self.repository, self.config).execute()

    def run_analyze(
        self,
        report_id: int | None = None,
        should_cancel: Callable[[], bool] | None = None,
        clear_first: bool = True,
    ) -> PipelineSummary:
        summary = self.new_summary(PipelineRunMode.ANALYZE)
        summary.report_id = report_id
        summary.status = "running"

        if clear_first:
            self.run_clear_table(skip_confirmation=True)
        steps = [
            (
                PipelineStep.LOAD,
                lambda: LoadProcessor(self.repository, self.config).execute(
                    report_id=report_id,
                    should_cancel=should_cancel,
                ),
            ),
            (
                PipelineStep.STATES,
                lambda: StatesProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
            (
                PipelineStep.URL_CHECK,
                lambda: UrlCheckProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
            (
                PipelineStep.CONTENT_HASH,
                lambda: ContentHashProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
            (
                PipelineStep.EMBEDDING,
                lambda: EmbeddingProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
        ]

        self._execute_pipeline_steps(summary, steps, should_cancel)
        return summary

    def run_analyze_fast(
        self,
        report_id: int | None = None,
        should_cancel: Callable[[], bool] | None = None,
        clear_first: bool = True,
    ) -> PipelineSummary:
        summary = self.new_summary(PipelineRunMode.ANALYZE_FAST)
        summary.report_id = report_id
        summary.status = "running"

        if clear_first:
            self.run_clear_table(skip_confirmation=True)
        steps = [
            (
                PipelineStep.LOAD,
                lambda: LoadProcessor(self.repository, self.config).execute(
                    report_id=report_id,
                    should_cancel=should_cancel,
                ),
            ),
            (
                PipelineStep.STATES,
                lambda: StatesProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
            (
                PipelineStep.URL_CHECK,
                lambda: UrlCheckProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
            (
                PipelineStep.EMBEDDING,
                lambda: EmbeddingProcessor(self.repository, self.config).execute(
                    should_cancel=should_cancel
                ),
            ),
        ]

        self._execute_pipeline_steps(summary, steps, should_cancel)
        return summary

    def run_clear_table(self, skip_confirmation: bool = True) -> dict[str, Any]:
        _ = skip_confirmation
        rows_deleted = self.repository.clear_all_analysis_data()
        return {
            "cleared": True,
            "rowsDeleted": rows_deleted,
            "cancelledJobs": [],
            "exitCode": 0,
            "stdout": (
                f"Successfully deleted {rows_deleted} rows from "
                "ArticleDuplicateAnalyses table."
            ),
            "stderr": "",
            "timestamp": _utc_now_iso(),
        }

    def _execute_pipeline_steps(
        self,
        summary: PipelineSummary,
        steps: list[tuple[PipelineStep, Callable[[], dict[str, Any]]]],
        should_cancel: Callable[[], bool] | None,
    ) -> None:
        cancel_check = should_cancel or (lambda: False)

        try:
            for step, fn in steps:
                if cancel_check():
                    raise DeduperProcessorError("Pipeline cancelled")

                progress = StepProgress(
                    step=step,
                    status="running",
                    started_at=_utc_now_iso(),
                )
                summary.steps.append(progress)
                self.logger.info(
                    "event=step_start step={} report_id={}",
                    step,
                    summary.report_id,
                )
                step_started = time.perf_counter()

                result = fn()

                progress.status = "completed"
                progress.completed_at = _utc_now_iso()
                progress.processed = int(result.get("processed", 0))
                progress.total = progress.processed
                progress.message = str(result)
                duration_ms = int((time.perf_counter() - step_started) * 1000)
                self.logger.info(
                    "event=step_complete step={} processed={} duration_ms={}",
                    step,
                    progress.processed,
                    duration_ms,
                )

            summary.status = "completed"
            self.logger.info(
                "event=pipeline_complete mode={} report_id={}",
                summary.mode,
                summary.report_id,
            )
        except DeduperProcessorError:
            summary.status = "cancelled"
            self.logger.warning(
                "event=pipeline_cancelled mode={} report_id={}",
                summary.mode,
                summary.report_id,
            )
            raise
        except Exception as exc:
            summary.status = "failed"
            self.logger.error(
                "event=pipeline_failed mode={} report_id={} error={}",
                summary.mode,
                summary.report_id,
                exc,
            )
            raise
        finally:
            summary.completed_at = _utc_now_iso()
