from __future__ import annotations

import os
from pathlib import Path

from src.modules.queue.errors import QueueConfigError


QUEUE_UTILITIES_ENV_KEY = "PATH_UTILTIES"
QUEUE_JOBS_FILENAME = "queue-jobs.json"
QUEUE_WORKER_SUBDIR = "worker-python"


def get_path_utilities() -> Path:
    path_utilities = os.getenv(QUEUE_UTILITIES_ENV_KEY, "").strip()
    if path_utilities == "":
        raise QueueConfigError(f"{QUEUE_UTILITIES_ENV_KEY} is required")

    return Path(path_utilities)


def resolve_queue_jobs_path() -> Path:
    return get_path_utilities() / QUEUE_WORKER_SUBDIR / QUEUE_JOBS_FILENAME


def validate_queue_startup_env() -> None:
    get_path_utilities()
