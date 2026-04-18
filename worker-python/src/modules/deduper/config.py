"""Configuration handling for in-process deduper runtime."""

from __future__ import annotations

import os
from dataclasses import dataclass

from src.modules.deduper.errors import DeduperConfigError


TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off"}
REQUIRED_STARTUP_ENV_KEYS = (
    "PG_HOST",
    "PG_PORT",
    "PG_DATABASE",
    "PG_USER",
)


def _parse_bool(value: str, key: str) -> bool:
    normalized = value.strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    raise DeduperConfigError(f"{key} must be a boolean-like value")


def _parse_positive_int(value: str, key: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise DeduperConfigError(f"{key} must be an integer") from exc

    if parsed <= 0:
        raise DeduperConfigError(f"{key} must be > 0")

    return parsed


@dataclass(slots=True)
class DeduperConfig:
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    path_to_csv: str | None
    enable_embedding: bool
    batch_size_load: int
    batch_size_states: int
    batch_size_url: int
    batch_size_content_hash: int
    batch_size_embedding: int
    cache_max_entries: int
    checkpoint_interval: int

    @property
    def dsn(self) -> str:
        return (
            f"host={self.pg_host} "
            f"port={self.pg_port} "
            f"dbname={self.pg_database} "
            f"user={self.pg_user} "
            f"password={self.pg_password}"
        )

    @classmethod
    def from_env(cls) -> "DeduperConfig":
        pg_host = os.getenv("PG_HOST", "").strip()
        pg_port = os.getenv("PG_PORT", "").strip()
        pg_database = os.getenv("PG_DATABASE", "").strip()
        pg_user = os.getenv("PG_USER", "").strip()

        if not pg_host:
            raise DeduperConfigError("PG_HOST is required")
        if not pg_port:
            raise DeduperConfigError("PG_PORT is required")
        if not pg_database:
            raise DeduperConfigError("PG_DATABASE is required")
        if not pg_user:
            raise DeduperConfigError("PG_USER is required")

        path_to_csv_raw = os.getenv("PATH_TO_CSV", "").strip()
        enable_embedding_raw = os.getenv("DEDUPER_ENABLE_EMBEDDING", "true")

        return cls(
            pg_host=pg_host,
            pg_port=_parse_positive_int(pg_port, "PG_PORT"),
            pg_database=pg_database,
            pg_user=pg_user,
            pg_password=os.getenv("PG_PASSWORD", "").strip(),
            path_to_csv=path_to_csv_raw or None,
            enable_embedding=_parse_bool(enable_embedding_raw, "DEDUPER_ENABLE_EMBEDDING"),
            batch_size_load=_parse_positive_int(os.getenv("DEDUPER_BATCH_SIZE_LOAD", "1000"), "DEDUPER_BATCH_SIZE_LOAD"),
            batch_size_states=_parse_positive_int(os.getenv("DEDUPER_BATCH_SIZE_STATES", "1000"), "DEDUPER_BATCH_SIZE_STATES"),
            batch_size_url=_parse_positive_int(os.getenv("DEDUPER_BATCH_SIZE_URL", "1000"), "DEDUPER_BATCH_SIZE_URL"),
            batch_size_content_hash=_parse_positive_int(
                os.getenv("DEDUPER_BATCH_SIZE_CONTENT_HASH", "1000"),
                "DEDUPER_BATCH_SIZE_CONTENT_HASH",
            ),
            batch_size_embedding=_parse_positive_int(
                os.getenv("DEDUPER_BATCH_SIZE_EMBEDDING", "100"),
                "DEDUPER_BATCH_SIZE_EMBEDDING",
            ),
            cache_max_entries=_parse_positive_int(
                os.getenv("DEDUPER_CACHE_MAX_ENTRIES", "10000"),
                "DEDUPER_CACHE_MAX_ENTRIES",
            ),
            checkpoint_interval=_parse_positive_int(
                os.getenv("DEDUPER_CHECKPOINT_INTERVAL", "250"),
                "DEDUPER_CHECKPOINT_INTERVAL",
            ),
        )


def validate_startup_env() -> None:
    missing_keys = [key for key in REQUIRED_STARTUP_ENV_KEYS if not os.getenv(key, "").strip()]
    if missing_keys:
        raise DeduperConfigError(
            "Missing required startup env vars: " + ", ".join(missing_keys)
        )
