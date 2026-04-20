from __future__ import annotations

import pytest

from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.errors import DeduperProcessorError
from src.modules.deduper.orchestrator import DeduperOrchestrator


class _Repo:
    def __init__(self) -> None:
        self.cleared = 0

    def healthcheck(self) -> bool:
        return True

    def clear_all_analysis_data(self) -> int:
        self.cleared += 1
        return 0


class _Proc:
    def __init__(self, repository, config) -> None:
        self.repository = repository
        self.config = config

    def execute(self, **kwargs):
        return {"processed": 1}


@pytest.fixture
def config() -> DeduperConfig:
    return DeduperConfig(
        pg_host="localhost",
        pg_port=5432,
        pg_database="newsnexus_test_worker_python",
        pg_user="nick",
        pg_password="",
        path_to_csv=None,
        enable_embedding=False,
        batch_size_load=100,
        batch_size_states=100,
        batch_size_url=100,
        batch_size_content_hash=100,
        batch_size_embedding=100,
        cache_max_entries=100,
        checkpoint_interval=1,
    )


@pytest.mark.unit
def test_run_analyze_fast_resume_without_clear(monkeypatch: pytest.MonkeyPatch, config) -> None:
    from src.modules.deduper import orchestrator as orch_mod

    repo = _Repo()
    orch = DeduperOrchestrator(repo, config)

    monkeypatch.setattr(orch_mod, "LoadProcessor", _Proc)
    monkeypatch.setattr(orch_mod, "StatesProcessor", _Proc)
    monkeypatch.setattr(orch_mod, "UrlCheckProcessor", _Proc)
    monkeypatch.setattr(orch_mod, "EmbeddingProcessor", _Proc)

    summary = orch.run_analyze_fast(report_id=5, clear_first=False)

    assert repo.cleared == 0
    assert summary.status == "completed"


@pytest.mark.unit
def test_run_analyze_fast_cancelled(monkeypatch: pytest.MonkeyPatch, config) -> None:
    from src.modules.deduper import orchestrator as orch_mod

    repo = _Repo()
    orch = DeduperOrchestrator(repo, config)

    monkeypatch.setattr(orch_mod, "LoadProcessor", _Proc)
    monkeypatch.setattr(orch_mod, "StatesProcessor", _Proc)
    monkeypatch.setattr(orch_mod, "UrlCheckProcessor", _Proc)
    monkeypatch.setattr(orch_mod, "EmbeddingProcessor", _Proc)

    with pytest.raises(DeduperProcessorError, match="Pipeline cancelled"):
        orch.run_analyze_fast(report_id=5, should_cancel=lambda: True)
