import os
from pathlib import Path
import signal
import subprocess

from dotenv import load_dotenv
from fastapi import FastAPI
from loguru import logger

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

from src.logger import setup_logger
from src.modules.deduper.config import validate_startup_env
from src.modules.ai_approver.config import validate_ai_approver_startup_env
from src.modules.location_scorer.config import validate_location_scorer_startup_env
from src.modules.queue.config import validate_queue_startup_env
from src.routes.ai_approver import router as ai_approver_router
from src.routes.deduper import router as deduper_router
from src.routes.index import router as index_router
from src.routes.location_scorer import router as location_scorer_router
from src.routes.queue_info import router as queue_info_router


def _is_testing_environment() -> bool:
    return os.getenv("RUN_ENVIRONMENT", "").strip().lower() == "testing"


def _terminate_uvicorn_reloader_parent() -> None:
    if _is_testing_environment():
        return

    parent_pid = os.getppid()
    if parent_pid <= 1:
        return

    try:
        result = subprocess.run(
            ["ps", "-o", "command=", "-p", str(parent_pid)],
            capture_output=True,
            check=False,
            text=True,
        )
    except Exception as exc:
        logger.warning("event=startup_parent_probe_failed error={}", exc)
        return

    parent_command = result.stdout.strip()
    if "uvicorn" not in parent_command or "--reload" not in parent_command:
        return

    try:
        os.kill(parent_pid, signal.SIGTERM)
        logger.critical(
            "event=startup_reloader_parent_terminated parent_pid={}",
            parent_pid,
        )
    except Exception as exc:
        logger.warning(
            "event=startup_reloader_parent_terminate_failed parent_pid={} error={}",
            parent_pid,
            exc,
        )


setup_logger()

try:
    validate_startup_env()
    validate_ai_approver_startup_env()
    validate_location_scorer_startup_env()
    validate_queue_startup_env()
except Exception as exc:
    logger.critical("event=startup_fatal error={}", exc)
    _terminate_uvicorn_reloader_parent()
    raise SystemExit(1) from exc

logger.info("event=startup_complete")

app = FastAPI(title="NewsNexus Python Queuer", version="0.2.0")
app.include_router(index_router)
app.include_router(ai_approver_router)
app.include_router(deduper_router)
app.include_router(location_scorer_router)
app.include_router(queue_info_router)
