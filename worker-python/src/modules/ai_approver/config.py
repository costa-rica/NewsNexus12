"""Configuration for the AI approver workflow."""

from __future__ import annotations

import os
from dataclasses import dataclass

from loguru import logger

from src.modules.ai_approver.errors import AiApproverConfigError


REQUIRED_STARTUP_ENV_KEYS = (
    "PG_HOST",
    "PG_PORT",
    "PG_DATABASE",
    "PG_USER",
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
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    openai_api_key: str
    model_name: str
    batch_size: int

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
    def from_env(cls) -> "AiApproverConfig":
        pg_host = os.getenv("PG_HOST", "").strip()
        pg_port = os.getenv("PG_PORT", "").strip()
        pg_database = os.getenv("PG_DATABASE", "").strip()
        pg_user = os.getenv("PG_USER", "").strip()
        openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()

        if not pg_host:
            raise AiApproverConfigError("PG_HOST is required")
        if not pg_port:
            raise AiApproverConfigError("PG_PORT is required")
        if not pg_database:
            raise AiApproverConfigError("PG_DATABASE is required")
        if not pg_user:
            raise AiApproverConfigError("PG_USER is required")
        if not openai_api_key:
            raise AiApproverConfigError("OPENAI_API_KEY is required")

        return cls(
            pg_host=pg_host,
            pg_port=_parse_positive_int(pg_port, "PG_PORT"),
            pg_database=pg_database,
            pg_user=pg_user,
            pg_password=os.getenv("PG_PASSWORD", "").strip(),
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
