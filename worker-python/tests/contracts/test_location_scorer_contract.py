from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.modules.queue.engine import GlobalQueueEngine
from src.modules.queue.store import QueueJobStore
from src.routes import location_scorer as location_scorer_routes


def _create_engine(tmp_path) -> GlobalQueueEngine:
    return GlobalQueueEngine(QueueJobStore(tmp_path / "worker-python" / "queue-jobs.json"))


@pytest.mark.contract
def test_location_scorer_contract_spec_file_exists() -> None:
    spec_path = Path("tests/contracts/location_scorer_contract_spec.json")
    assert spec_path.exists()


@pytest.mark.contract
def test_location_scorer_contract_runtime_matches_spec(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from src.main import app

    engine = _create_engine(tmp_path)
    monkeypatch.setattr(location_scorer_routes, "queue_engine", engine)

    def fake_runner(limit: int | None):
        def _run(context) -> None:
            return None

        return _run

    monkeypatch.setattr(location_scorer_routes, "create_location_scorer_runner", fake_runner)

    spec = json.loads(
        Path("tests/contracts/location_scorer_contract_spec.json").read_text()
    )

    with TestClient(app) as client:
        for endpoint in spec["endpoints"]:
            if endpoint["method"] != "POST":
                pytest.fail(f"Unsupported method in contract: {endpoint['method']}")

            response = client.post(endpoint["path"], json={"limit": 3})
            assert response.status_code == endpoint["expected_status"]
            body = response.json()
            for required_key in endpoint["required_json_keys"]:
                assert required_key in body
