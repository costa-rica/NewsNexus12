from __future__ import annotations

import pytest

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import LocationScorerProcessorError
from src.modules.location_scorer.processors.write import WriteProcessor


class _Repo:
    def __init__(self) -> None:
        self.calls: list[list[dict[str, object]]] = []

    def write_scores_batch(self, entity_id: int, scores):
        assert entity_id == 100
        self.calls.append(list(scores))
        return {"inserted": len(scores) - 1 if len(scores) > 1 else len(scores), "duplicates": 1 if len(scores) > 1 else 0}


@pytest.fixture
def config() -> LocationScorerConfig:
    return LocationScorerConfig(
        pg_host="localhost",
        pg_port=5432,
        pg_database="newsnexus_test_worker_python",
        pg_user="nick",
        pg_password="",
        ai_entity_name="NewsNexusClassifierLocationScorer01",
        batch_size=2,
        checkpoint_interval=2,
    )


@pytest.mark.unit
def test_write_processor_batches_and_aggregates(config: LocationScorerConfig) -> None:
    repo = _Repo()
    result = WriteProcessor(repo, config).execute(
        100,
        [
            {"article_id": 1, "score": 0.9, "rating_for": "Occurred in the United States"},
            {"article_id": 2, "score": 0.8, "rating_for": "Occurred in the United States"},
            {"article_id": 3, "score": 0.7, "rating_for": "Occurred in the United States"},
        ],
    )

    assert len(repo.calls) == 2
    assert result == {"processed": 2, "duplicates": 1}


@pytest.mark.unit
def test_write_processor_cancellation(config: LocationScorerConfig) -> None:
    with pytest.raises(LocationScorerProcessorError, match="Write processor cancelled"):
        WriteProcessor(_Repo(), config).execute(
            100,
            [
                {"article_id": 1, "score": 0.9, "rating_for": "Occurred in the United States"},
            ],
            should_cancel=lambda: True,
        )
