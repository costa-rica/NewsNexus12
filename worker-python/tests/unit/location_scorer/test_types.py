import pytest

from src.modules.location_scorer.types import (
    LocationScorerRunMode,
    LocationScorerStep,
    PipelineSummary,
    StepProgress,
)


@pytest.mark.unit
def test_location_scorer_step_values() -> None:
    assert [step.value for step in LocationScorerStep] == ["load", "classify", "write"]


@pytest.mark.unit
def test_location_scorer_run_mode_values() -> None:
    assert [mode.value for mode in LocationScorerRunMode] == ["score"]


@pytest.mark.unit
def test_step_progress_defaults() -> None:
    step = StepProgress(step=LocationScorerStep.LOAD)

    assert step.status == "pending"
    assert step.processed == 0
    assert step.total == 0
    assert step.message == ""


@pytest.mark.unit
def test_pipeline_summary_defaults() -> None:
    summary = PipelineSummary(mode=LocationScorerRunMode.SCORE)

    assert summary.mode == LocationScorerRunMode.SCORE
    assert summary.status == "pending"
    assert summary.started_at
    assert summary.steps == []
    assert summary.limit is None
