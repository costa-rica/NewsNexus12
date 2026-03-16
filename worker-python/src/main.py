from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from loguru import logger

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

from src.logger import setup_logger
from src.modules.deduper.config import validate_startup_env
from src.modules.queue.config import validate_queue_startup_env
from src.routes.deduper import router as deduper_router
from src.routes.index import router as index_router
from src.routes.queue_info import router as queue_info_router

setup_logger()

try:
    validate_startup_env()
    validate_queue_startup_env()
except Exception as exc:
    logger.critical("event=startup_fatal error={}", exc)
    raise SystemExit(1) from exc

logger.info("event=startup_complete")

app = FastAPI(title="NewsNexus Python Queuer", version="0.2.0")
app.include_router(index_router)
app.include_router(deduper_router)
app.include_router(queue_info_router)
