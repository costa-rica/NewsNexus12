import os

from fastapi.testclient import TestClient

# Required startup env vars for src.main import.
os.environ.setdefault("PG_HOST", "localhost")
os.environ.setdefault("PG_PORT", "5432")
os.environ.setdefault("PG_DATABASE", "newsnexus_test_worker_python")
os.environ.setdefault("PG_USER", "nick")
os.environ.setdefault("PG_PASSWORD", "")
os.environ.setdefault("NAME_APP", "worker-python-tests")
os.environ.setdefault("RUN_ENVIRONMENT", "testing")
os.environ.setdefault("PATH_TO_LOGS", "/tmp")
os.environ.setdefault("PATH_UTILTIES", "/tmp")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault(
    "NAME_AI_ENTITY_LOCATION_SCORER",
    "NewsNexusClassifierLocationScorer01",
)

from src.main import app
from src.services.job_manager import job_manager


def _reset_jobs() -> None:
    job_manager.reset_for_tests()


import pytest


@pytest.fixture
def client() -> TestClient:
    _reset_jobs()
    with TestClient(app) as test_client:
        yield test_client
    _reset_jobs()
