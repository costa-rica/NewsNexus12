"""Configuration for the AI approver workflow."""

from __future__ import annotations

import os
from dataclasses import dataclass

from loguru import logger

from src.modules.ai_approver.errors import AiApproverConfigError


REQUIRED_STARTUP_ENV_KEYS = (
    "PATH_DATABASE",
    "NAME_DB",
    "OPENAI_API_KEY",
)


def _parse_positive_int(value: str, key: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise AiApproverConfigError(f"{key} must be an integer") from exc

    if parsed <= 0:
        raise AiApproverConfigError(f"{key} must be > 0")

    return parsed


@dataclass(slots=True)
class AiApproverConfig:
    path_database: str
    name_db: str
    openai_api_key: str
    model_name: str
    batch_size: int

    @property
    def sqlite_path(self) -> str:
        return os.path.join(self.path_database, self.name_db)

    @classmethod
    def from_env(cls) -> "AiApproverConfig":
        path_database = os.getenv("PATH_DATABASE", "").strip()
        name_db = os.getenv("NAME_DB", "").strip()
        openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()

        if not path_database:
            raise AiApproverConfigError("PATH_DATABASE is required")
        if not name_db:
            raise AiApproverConfigError("NAME_DB is required")
        if not openai_api_key:
            raise AiApproverConfigError("OPENAI_API_KEY is required")

        return cls(
            path_database=path_database,
            name_db=name_db,
            openai_api_key=openai_api_key,
            model_name=os.getenv("AI_APPROVER_MODEL_NAME", "gpt-4o-mini").strip()
            or "gpt-4o-mini",
            batch_size=_parse_positive_int(
                os.getenv("AI_APPROVER_BATCH_SIZE", "10"),
                "AI_APPROVER_BATCH_SIZE",
            ),
        )


def validate_ai_approver_startup_env() -> None:
    missing_keys = [key for key in REQUIRED_STARTUP_ENV_KEYS if not os.getenv(key, "").strip()]
    if missing_keys:
        for key in missing_keys:
            logger.error("event=ai_approver_startup_env_missing env_var={}", key)
        raise AiApproverConfigError(
            "Missing required startup env vars: " + ", ".join(missing_keys)
        )
