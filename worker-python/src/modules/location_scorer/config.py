"""Configuration handling for the in-process location scorer runtime."""

from __future__ import annotations

import os
from dataclasses import dataclass

from loguru import logger

from src.modules.location_scorer.errors import LocationScorerConfigError


REQUIRED_STARTUP_ENV_KEYS = (
    "PATH_DATABASE",
    "NAME_DB",
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
    path_database: str
    name_db: str
    ai_entity_name: str
    batch_size: int
    checkpoint_interval: int

    @property
    def sqlite_path(self) -> str:
        return os.path.join(self.path_database, self.name_db)

    @classmethod
    def from_env(cls) -> "LocationScorerConfig":
        path_database = os.getenv("PATH_DATABASE", "").strip()
        name_db = os.getenv("NAME_DB", "").strip()
        ai_entity_name = os.getenv("NAME_AI_ENTITY_LOCATION_SCORER", "").strip()

        if not path_database:
            raise LocationScorerConfigError("PATH_DATABASE is required")
        if not name_db:
            raise LocationScorerConfigError("NAME_DB is required")
        if not ai_entity_name:
            raise LocationScorerConfigError("NAME_AI_ENTITY_LOCATION_SCORER is required")

        return cls(
            path_database=path_database,
            name_db=name_db,
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
