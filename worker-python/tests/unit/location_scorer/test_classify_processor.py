from __future__ import annotations

from typing import Any

import pytest

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import LocationScorerProcessorError
from src.modules.location_scorer.processors import classify as classify_module
from src.modules.location_scorer.processors.classify import (
    CLASSIFICATION_LABELS,
    ClassifyProcessor,
    US_LABEL,
)


class _Repo:
    pass


class _FakeClassifier:
    def __call__(self, text: str, labels: list[str]) -> dict[str, Any]:
        assert labels == CLASSIFICATION_LABELS
        if "texas" in text.lower():
            return {"labels": [US_LABEL, "Occurred outside the United States"], "scores": [0.91, 0.09]}
        return {"labels": [US_LABEL, "Occurred outside the United States"], "scores": [0.22, 0.78]}


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
def test_classify_processor_scores_articles_and_skips_empty(
    monkeypatch: pytest.MonkeyPatch,
    config: LocationScorerConfig,
) -> None:
    monkeypatch.setattr(classify_module, "_CLASSIFIER", None)
    monkeypatch.setattr(classify_module, "_get_classifier", lambda: _FakeClassifier())

    result = ClassifyProcessor(_Repo(), config).execute(
        [
            {"id": 1, "title": "Texas drought", "description": "Dry weather continues"},
            {"id": 2, "title": "", "description": ""},
            {"id": 3, "title": "Berlin summit", "description": "Leaders met"},
        ]
    )

    assert result["processed"] == 2
    assert result["skipped"] == 1
    assert result["scores"] == [
        {
            "article_id": 1,
            "score": 0.91,
            "rating_for": US_LABEL,
        },
        {
            "article_id": 3,
            "score": 0.22,
            "rating_for": US_LABEL,
        },
    ]


@pytest.mark.unit
def test_classify_processor_cancellation(
    monkeypatch: pytest.MonkeyPatch,
    config: LocationScorerConfig,
) -> None:
    monkeypatch.setattr(classify_module, "_CLASSIFIER", None)
    monkeypatch.setattr(classify_module, "_get_classifier", lambda: _FakeClassifier())

    with pytest.raises(LocationScorerProcessorError, match="Classify processor cancelled"):
        ClassifyProcessor(_Repo(), config).execute(
            [
                {"id": 1, "title": "Texas drought", "description": "Dry weather continues"},
                {"id": 2, "title": "California storm", "description": "Heavy rains"},
            ],
            should_cancel=lambda: True,
        )
