import os

import pytest

from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.errors import DeduperConfigError


@pytest.mark.unit
def test_config_from_env_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv("PG_PASSWORD", "")
    monkeypatch.setenv("DEDUPER_ENABLE_EMBEDDING", "true")
    monkeypatch.setenv("DEDUPER_BATCH_SIZE_LOAD", "1000")
    monkeypatch.setenv("DEDUPER_BATCH_SIZE_STATES", "1000")
    monkeypatch.setenv("DEDUPER_BATCH_SIZE_URL", "1000")
    monkeypatch.setenv("DEDUPER_BATCH_SIZE_CONTENT_HASH", "1000")
    monkeypatch.setenv("DEDUPER_BATCH_SIZE_EMBEDDING", "100")

    config = DeduperConfig.from_env()

    assert config.pg_host == "localhost"
    assert config.pg_database == "news.db"
    assert config.enable_embedding is True
    assert "dbname=news.db" in config.dsn
    assert config.cache_max_entries > 0
    assert config.checkpoint_interval > 0


@pytest.mark.unit
def test_config_missing_required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PG_HOST", raising=False)
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")

    with pytest.raises(DeduperConfigError, match="PG_HOST is required"):
        DeduperConfig.from_env()


@pytest.mark.unit
def test_config_invalid_batch_size(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv("DEDUPER_BATCH_SIZE_LOAD", "0")

    with pytest.raises(DeduperConfigError, match="DEDUPER_BATCH_SIZE_LOAD must be > 0"):
        DeduperConfig.from_env()


@pytest.mark.unit
def test_config_invalid_bool(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PG_HOST", "localhost")
    monkeypatch.setenv("PG_PORT", "5432")
    monkeypatch.setenv("PG_DATABASE", "news.db")
    monkeypatch.setenv("PG_USER", "nick")
    monkeypatch.setenv("DEDUPER_ENABLE_EMBEDDING", "sometimes")

    with pytest.raises(DeduperConfigError, match="DEDUPER_ENABLE_EMBEDDING must be a boolean-like value"):
        DeduperConfig.from_env()


@pytest.mark.unit
def test_startup_env_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.modules.deduper.config import validate_startup_env

    for key in ("PG_HOST", "PG_PORT", "PG_DATABASE", "PG_USER"):
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(DeduperConfigError, match="Missing required startup env vars"):
        validate_startup_env()
