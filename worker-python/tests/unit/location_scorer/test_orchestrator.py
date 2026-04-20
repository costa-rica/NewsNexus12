from __future__ import annotations

import pytest

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import LocationScorerProcessorError
from src.modules.location_scorer.orchestrator import LocationScorerOrchestrator
from src.modules.location_scorer.types import LocationScorerRunMode


class _Repo:
    def healthcheck(self) -> bool:
        return True


class _LoadProc:
    def __init__(self, repository, config) -> None:
        self.repository = repository
        self.config = config

    def execute(self, **kwargs):
        return {
            "processed": 2,
            "entity_id": 100,
            "articles": [
                {"id": 1, "title": "One", "description": "Desc one"},
                {"id": 2, "title": "Two", "description": "Desc two"},
            ],
        }


class _ClassifyProc:
    def __init__(self, repository, config) -> None:
        self.repository = repository
        self.config = config

    def execute(self, articles, **kwargs):
        assert len(articles) == 2
        return {
            "processed": 2,
            "scores": [
                {"article_id": 1, "score": 0.9, "rating_for": "Occurred in the United States"},
                {"article_id": 2, "score": 0.2, "rating_for": "Occurred in the United States"},
            ],
        }


class _WriteProc:
    def __init__(self, repository, config) -> None:
        self.repository = repository
        self.config = config

    def execute(self, entity_id, scores, **kwargs):
        assert entity_id == 100
        assert len(scores) == 2
        return {"processed": 2, "duplicates": 0}


@pytest.fixture
def config() -> LocationScorerConfig:
    return LocationScorerConfig(
        pg_host="localhost",
        pg_port=5432,
        pg_database="newsnexus_test_worker_python",
        pg_user="nick",
        pg_password="",
        ai_entity_name="NewsNexusClassifierLocationScorer01",
        batch_size=10,
        checkpoint_interval=2,
    )


@pytest.mark.unit
def test_run_score_success(monkeypatch: pytest.MonkeyPatch, config: LocationScorerConfig) -> None:
    from src.modules.location_scorer import orchestrator as orch_mod

    repo = _Repo()
    orchestrator = LocationScorerOrchestrator(repo, config)

    monkeypatch.setattr(orch_mod, "LoadProcessor", _LoadProc)
    monkeypatch.setattr(orch_mod, "ClassifyProcessor", _ClassifyProc)
    monkeypatch.setattr(orch_mod, "WriteProcessor", _WriteProc)

    summary = orchestrator.run_score(limit=25)

    assert summary.mode == LocationScorerRunMode.SCORE
    assert summary.limit == 25
    assert summary.status == "completed"
    assert [step.step.value for step in summary.steps] == ["load", "classify", "write"]


@pytest.mark.unit
def test_run_score_cancelled(monkeypatch: pytest.MonkeyPatch, config: LocationScorerConfig) -> None:
    from src.modules.location_scorer import orchestrator as orch_mod

    repo = _Repo()
    orchestrator = LocationScorerOrchestrator(repo, config)

    monkeypatch.setattr(orch_mod, "LoadProcessor", _LoadProc)
    monkeypatch.setattr(orch_mod, "ClassifyProcessor", _ClassifyProc)
    monkeypatch.setattr(orch_mod, "WriteProcessor", _WriteProc)

    with pytest.raises(LocationScorerProcessorError, match="Pipeline cancelled"):
        orchestrator.run_score(should_cancel=lambda: True)


@pytest.mark.unit
def test_check_ready(config: LocationScorerConfig) -> None:
    orchestrator = LocationScorerOrchestrator(_Repo(), config)
    assert orchestrator.check_ready() is True
