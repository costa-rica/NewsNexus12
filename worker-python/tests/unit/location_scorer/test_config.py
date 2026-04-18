import pytest

from src.modules.location_scorer.config import (
    LocationScorerConfig,
    validate_location_scorer_startup_env,
)
from src.modules.location_scorer.errors import LocationScorerConfigError


@pytest.mark.unit
def test_config_from_env_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv(
        "NAME_AI_ENTITY_LOCATION_SCORER",
        "NewsNexusClassifierLocationScorer01",
    )
    monkeypatch.setenv("LOCATION_SCORER_BATCH_SIZE", "25")
    monkeypatch.setenv("LOCATION_SCORER_CHECKPOINT_INTERVAL", "50")

    config = LocationScorerConfig.from_env()

    assert config.pg_host == "localhost"
    assert config.pg_database == "news.db"
    assert config.ai_entity_name == "NewsNexusClassifierLocationScorer01"
    assert config.batch_size == 25
    assert config.checkpoint_interval == 50
    assert "dbname=news.db" in config.dsn


@pytest.mark.unit
def test_config_missing_required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.delenv("NAME_AI_ENTITY_LOCATION_SCORER", raising=False)

    with pytest.raises(
        LocationScorerConfigError,
        match="NAME_AI_ENTITY_LOCATION_SCORER is required",
    ):
        LocationScorerConfig.from_env()


@pytest.mark.unit
def test_config_invalid_batch_size(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv(
        "NAME_AI_ENTITY_LOCATION_SCORER",
        "NewsNexusClassifierLocationScorer01",
    )
    monkeypatch.setenv("LOCATION_SCORER_BATCH_SIZE", "0")

    with pytest.raises(
        LocationScorerConfigError,
        match="LOCATION_SCORER_BATCH_SIZE must be > 0",
    ):
        LocationScorerConfig.from_env()


@pytest.mark.unit
def test_validate_location_scorer_startup_env_logs_missing_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.modules.location_scorer import config as location_scorer_config

    monkeypatch.delenv("PG_HOST", raising=False)
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.delenv("NAME_AI_ENTITY_LOCATION_SCORER", raising=False)

    error_messages: list[str] = []

    def fake_error(message: str, *args: object) -> None:
        error_messages.append(message.format(*args))

    monkeypatch.setattr(location_scorer_config.logger, "error", fake_error)

    with pytest.raises(LocationScorerConfigError, match="Missing required startup env vars"):
        validate_location_scorer_startup_env()

    assert error_messages == [
        "event=location_scorer_startup_env_missing env_var=PG_HOST",
        "event=location_scorer_startup_env_missing env_var=NAME_AI_ENTITY_LOCATION_SCORER",
    ]
