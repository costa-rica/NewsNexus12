"""Configuration for the AI approver workflow."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

from loguru import logger

from src.modules.ai_approver.errors import AiApproverConfigError


TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off"}

REQUIRED_STARTUP_ENV_KEYS = (
    "PG_HOST",
    "PG_PORT",
    "PG_DATABASE",
    "PG_USER",
)

AI_APPROVER_ALLOWED_MODES = (
    "legacy",
    "shadow",
    "gatekeeper",
    "gatekeeper_with_manual_review",
)


def _parse_bool(value: str, key: str) -> bool:
    normalized = value.strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    raise AiApproverConfigError(f"{key} must be a boolean-like value")


def _parse_positive_int(value: str, key: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise AiApproverConfigError(f"{key} must be an integer") from exc

    if parsed <= 0:
        raise AiApproverConfigError(f"{key} must be > 0")

    return parsed


def parse_ai_approver_mode(value: str | None, *, key: str = "AI_APPROVER_MODE") -> str:
    mode = (value or "legacy").strip() or "legacy"
    if mode not in AI_APPROVER_ALLOWED_MODES:
        allowed = ", ".join(AI_APPROVER_ALLOWED_MODES)
        raise AiApproverConfigError(f"{key} must be one of: {allowed}")
    return mode


def _parse_confidence_threshold(value: str, key: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise AiApproverConfigError(f"{key} must be a number") from exc

    if parsed < 0 or parsed > 1:
        raise AiApproverConfigError(f"{key} must be between 0 and 1")

    return parsed


def _parse_use_open_ai_api() -> bool:
    value = os.getenv("USE_OPEN_AI_API", "").strip() or "false"
    return _parse_bool(value, "USE_OPEN_AI_API")


def _warn_openai_key_missing_soft_fallback() -> None:
    logger.warning(
        "event=ai_approver_openai_key_missing "
        "USE_OPEN_AI_API is true but OPENAI_API_KEY is empty; "
        "falling back to the Codex CLI backend"
    )


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
    default_mode: str
    gatekeeper_reject_confidence_threshold: float
    use_open_ai_api: bool = False
    codex_timeout_seconds: int = 180

    @property
    def dsn(self) -> str:
        return (
            f"host={self.pg_host} "
            f"port={self.pg_port} "
            f"dbname={self.pg_database} "
            f"user={self.pg_user} "
            f"password={self.pg_password}"
        )

    @property
    def use_codex_cli(self) -> bool:
        return not (self.use_open_ai_api and self.openai_api_key)

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

        use_open_ai_api = _parse_use_open_ai_api()
        if use_open_ai_api and not openai_api_key:
            _warn_openai_key_missing_soft_fallback()

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
            default_mode=parse_ai_approver_mode(os.getenv("AI_APPROVER_MODE")),
            gatekeeper_reject_confidence_threshold=_parse_confidence_threshold(
                os.getenv("AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD", "0.85"),
                "AI_APPROVER_GATEKEEPER_REJECT_CONFIDENCE_THRESHOLD",
            ),
            use_open_ai_api=use_open_ai_api,
            codex_timeout_seconds=_parse_positive_int(
                os.getenv("AI_APPROVER_CODEX_TIMEOUT_SECONDS", "180"),
                "AI_APPROVER_CODEX_TIMEOUT_SECONDS",
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

    use_open_ai_api = _parse_use_open_ai_api()
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()

    if use_open_ai_api and openai_api_key:
        return

    if use_open_ai_api and not openai_api_key:
        _warn_openai_key_missing_soft_fallback()

    if shutil.which("codex") is None:
        logger.error("event=ai_approver_startup_env_missing env_var=codex_binary")
        raise AiApproverConfigError(
            "codex CLI not found on PATH; install and authenticate the Codex CLI, "
            "or set USE_OPEN_AI_API=true with OPENAI_API_KEY to use the OpenAI API backend"
        )
