"""Configuration handling for the in-process location scorer runtime."""

from __future__ import annotations

import os
from dataclasses import dataclass

from loguru import logger

from src.modules.location_scorer.errors import LocationScorerConfigError


REQUIRED_STARTUP_ENV_KEYS = (
    "PG_HOST",
    "PG_PORT",
    "PG_DATABASE",
    "PG_USER",
    "NAME_AI_ENTITY_LOCATION_SCORER",
)


def _parse_positive_int(value: str, key: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise LocationScorerConfigError(f"{key} must be an integer") from exc

    if parsed <= 0:
        raise LocationScorerConfigError(f"{key} must be > 0")

    return parsed


@dataclass(slots=True)
class LocationScorerConfig:
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    ai_entity_name: str
    batch_size: int
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
    def from_env(cls) -> "LocationScorerConfig":
        pg_host = os.getenv("PG_HOST", "").strip()
        pg_port = os.getenv("PG_PORT", "").strip()
        pg_database = os.getenv("PG_DATABASE", "").strip()
        pg_user = os.getenv("PG_USER", "").strip()
        ai_entity_name = os.getenv("NAME_AI_ENTITY_LOCATION_SCORER", "").strip()

        if not pg_host:
            raise LocationScorerConfigError("PG_HOST is required")
        if not pg_port:
            raise LocationScorerConfigError("PG_PORT is required")
        if not pg_database:
            raise LocationScorerConfigError("PG_DATABASE is required")
        if not pg_user:
            raise LocationScorerConfigError("PG_USER is required")
        if not ai_entity_name:
            raise LocationScorerConfigError("NAME_AI_ENTITY_LOCATION_SCORER is required")

        return cls(
            pg_host=pg_host,
            pg_port=_parse_positive_int(pg_port, "PG_PORT"),
            pg_database=pg_database,
            pg_user=pg_user,
            pg_password=os.getenv("PG_PASSWORD", "").strip(),
            ai_entity_name=ai_entity_name,
            batch_size=_parse_positive_int(
                os.getenv("LOCATION_SCORER_BATCH_SIZE", "10"),
                "LOCATION_SCORER_BATCH_SIZE",
            ),
            checkpoint_interval=_parse_positive_int(
                os.getenv("LOCATION_SCORER_CHECKPOINT_INTERVAL", "10"),
                "LOCATION_SCORER_CHECKPOINT_INTERVAL",
            ),
        )


def validate_location_scorer_startup_env() -> None:
    missing_keys = [key for key in REQUIRED_STARTUP_ENV_KEYS if not os.getenv(key, "").strip()]
    if missing_keys:
        for key in missing_keys:
            logger.error("event=location_scorer_startup_env_missing env_var={}", key)
        raise LocationScorerConfigError(
            "Missing required startup env vars: " + ", ".join(missing_keys)
        )
