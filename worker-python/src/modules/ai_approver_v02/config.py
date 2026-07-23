"""V02-only configuration for the AI Approver worker."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

from src.modules.ai_approver_v02.errors import AiApproverV02ConfigError


def _required(key: str) -> str:
    value = os.getenv(key, "").strip()
    if not value:
        raise AiApproverV02ConfigError(f"{key} is required")
    return value


def _positive_int(value: str, key: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise AiApproverV02ConfigError(f"{key} must be an integer") from exc
    if parsed <= 0:
        raise AiApproverV02ConfigError(f"{key} must be greater than zero")
    return parsed


@dataclass(frozen=True, slots=True)
class AiApproverV02Config:
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    model_name: str = "gpt-5.4-mini"
    codex_timeout_seconds: int = 180
    expired_preview_retention_days: int = 7
    preview_ttl_minutes: int = 15

    @property
    def dsn(self) -> str:
        return (
            f"host={self.pg_host} port={self.pg_port} "
            f"dbname={self.pg_database} user={self.pg_user} "
            f"password={self.pg_password}"
        )

    @classmethod
    def from_env(
        cls,
        *,
        validate_codex: bool = True,
    ) -> "AiApproverV02Config":
        if validate_codex and shutil.which("codex") is None:
            raise AiApproverV02ConfigError(
                "codex CLI not found on PATH; V02 requires an authenticated Codex CLI"
            )

        return cls(
            pg_host=_required("PG_HOST"),
            pg_port=_positive_int(_required("PG_PORT"), "PG_PORT"),
            pg_database=_required("PG_DATABASE"),
            pg_user=_required("PG_USER"),
            pg_password=os.getenv("PG_PASSWORD", "").strip(),
            model_name=(
                os.getenv("AI_APPROVER_V02_MODEL_NAME", "gpt-5.4-mini").strip()
                or "gpt-5.4-mini"
            ),
            codex_timeout_seconds=_positive_int(
                os.getenv("AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS", "180"),
                "AI_APPROVER_V02_CODEX_TIMEOUT_SECONDS",
            ),
            expired_preview_retention_days=_positive_int(
                os.getenv("AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS", "7"),
                "AI_APPROVER_V02_EXPIRED_PREVIEW_RETENTION_DAYS",
            ),
            preview_ttl_minutes=_positive_int(
                os.getenv("AI_APPROVER_V02_PREVIEW_TTL_MINUTES", "15"),
                "AI_APPROVER_V02_PREVIEW_TTL_MINUTES",
            ),
        )


def validate_ai_approver_v02_startup_env() -> None:
    AiApproverV02Config.from_env()
