import os

from fastapi.testclient import TestClient

# Required startup env vars for src.main import.
os.environ.setdefault("PATH_DATABASE", "/tmp")
os.environ.setdefault("NAME_DB", "test.db")
os.environ.setdefault("NAME_APP", "worker-python-tests")
os.environ.setdefault("RUN_ENVIRONMENT", "testing")
os.environ.setdefault("PATH_TO_LOGS", "/tmp")
os.environ.setdefault("PATH_UTILTIES", "/tmp")

from src.main import app
from src.services.job_manager import job_manager


def _reset_jobs() -> None:
    job_manager.jobs.clear()
    job_manager.job_counter = 1


import pytest


@pytest.fixture
def client() -> TestClient:
    _reset_jobs()
    with TestClient(app) as test_client:
        yield test_client
    _reset_jobs()
