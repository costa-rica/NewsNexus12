from __future__ import annotations

import pytest

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import (
    LocationScorerConfigError,
    LocationScorerProcessorError,
)
from src.modules.location_scorer.processors.load import LoadProcessor


class _Repo:
    def __init__(self, entity_id: int | None = 100) -> None:
        self.entity_id = entity_id

    def get_entity_who_categorized_article_id(self, ai_entity_name: str) -> int | None:
        assert ai_entity_name == "NewsNexusClassifierLocationScorer01"
        return self.entity_id

    def get_unscored_articles(self, entity_id: int, limit: int | None = None):
        assert entity_id == 100
        articles = [
            {"id": 1, "title": "One", "description": "Desc one"},
            {"id": 2, "title": "Two", "description": "Desc two"},
        ]
        return articles[:limit] if limit is not None else articles


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
def test_load_processor_returns_articles_and_entity_id(config: LocationScorerConfig) -> None:
    result = LoadProcessor(_Repo(), config).execute(limit=1)

    assert result["processed"] == 1
    assert result["entity_id"] == 100
    assert result["articles"] == [{"id": 1, "title": "One", "description": "Desc one"}]


@pytest.mark.unit
def test_load_processor_raises_for_missing_ai_entity(config: LocationScorerConfig) -> None:
    with pytest.raises(
        LocationScorerConfigError,
        match="AI entity not found: NewsNexusClassifierLocationScorer01",
    ):
        LoadProcessor(_Repo(entity_id=None), config).execute()


@pytest.mark.unit
def test_load_processor_cancellation(config: LocationScorerConfig) -> None:
    with pytest.raises(LocationScorerProcessorError, match="Load processor cancelled"):
        LoadProcessor(_Repo(), config).execute(should_cancel=lambda: True)
