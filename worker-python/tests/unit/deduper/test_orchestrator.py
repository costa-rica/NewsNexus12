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
    def __init__(self, repository, config, **kwargs) -> None:
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
@pytest.mark.parametrize("method", ["run_analyze", "run_analyze_fast"])
def test_analysis_keeps_internal_clear_without_endpoint_cancellation(monkeypatch, config, method):
    from src.modules.deduper import orchestrator as orch_mod

    repo = _Repo()
    orch = DeduperOrchestrator(repo, config)
    for name in (
        "LoadProcessor",
        "StatesProcessor",
        "UrlCheckProcessor",
        "ContentHashProcessor",
        "EmbeddingSyncProcessor",
        "EmbeddingProcessor",
    ):
        monkeypatch.setattr(orch_mod, name, _Proc)
    assert getattr(orch, method)(report_id=5).status == "completed"
    assert repo.cleared == 1


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


def _recording_proc(calls: list[str], name: str):
    class _Recorder:
        def __init__(self, repository, config, **kwargs) -> None:
            self.kwargs = kwargs

        def execute(self, **kwargs):
            calls.append(name)
            return {"processed": 1}

    return _Recorder


@pytest.mark.unit
@pytest.mark.parametrize("method", ["run_analyze", "run_analyze_fast"])
def test_embedding_sync_runs_before_embedding(monkeypatch, config, method):
    from src.modules.deduper import orchestrator as orch_mod

    calls: list[str] = []
    for name in (
        "LoadProcessor",
        "StatesProcessor",
        "UrlCheckProcessor",
        "ContentHashProcessor",
        "EmbeddingSyncProcessor",
        "EmbeddingProcessor",
    ):
        monkeypatch.setattr(orch_mod, name, _recording_proc(calls, name))

    summary = getattr(DeduperOrchestrator(_Repo(), config), method)(report_id=5)

    assert calls.index("EmbeddingSyncProcessor") == calls.index("EmbeddingProcessor") - 1
    steps = [str(progress.step) for progress in summary.steps]
    assert steps.index("embedding_sync") == steps.index("embedding") - 1


@pytest.mark.unit
def test_rebuild_flag_maps_to_sync_mode(monkeypatch, config):
    from src.modules.deduper import orchestrator as orch_mod

    seen_modes: list[str] = []

    class _SyncRecorder(_Proc):
        def __init__(self, repository, config, **kwargs) -> None:
            super().__init__(repository, config)
            seen_modes.append(str(kwargs["mode"]))

    for name in ("LoadProcessor", "StatesProcessor", "UrlCheckProcessor", "EmbeddingProcessor"):
        monkeypatch.setattr(orch_mod, name, _Proc)
    monkeypatch.setattr(orch_mod, "EmbeddingSyncProcessor", _SyncRecorder)
    orch = DeduperOrchestrator(_Repo(), config)

    orch.run_analyze_fast(report_id=5)
    orch.run_analyze_fast(report_id=5, rebuild_embeddings=True)

    assert seen_modes == ["incremental", "rebuild"]


@pytest.mark.unit
def test_embedding_steps_skip_when_embedding_disabled(monkeypatch, config):
    from src.modules.deduper import orchestrator as orch_mod

    for name in ("LoadProcessor", "StatesProcessor", "UrlCheckProcessor"):
        monkeypatch.setattr(orch_mod, name, _Proc)
    config.enable_embedding = False

    summary = DeduperOrchestrator(_Repo(), config).run_analyze_fast(report_id=5)

    messages = {str(progress.step): progress.message for progress in summary.steps}
    assert summary.status == "completed"
    assert "skipped" in messages["embedding_sync"]
    assert "skipped" in messages["embedding"]


@pytest.mark.unit
def test_cancel_during_embedding_sync_marks_run_cancelled(monkeypatch, config):
    from src.modules.article_embeddings import ArticleEmbeddingsCancelledError
    from src.modules.deduper import orchestrator as orch_mod

    class _CancellingService:
        def sync(self, mode, should_cancel=None):
            raise ArticleEmbeddingsCancelledError("stop")

    for name in ("LoadProcessor", "StatesProcessor", "UrlCheckProcessor", "EmbeddingProcessor"):
        monkeypatch.setattr(orch_mod, name, _Proc)
    config.enable_embedding = True
    orch = DeduperOrchestrator(_Repo(), config)
    monkeypatch.setattr(orch, "_build_embedding_service", lambda: _CancellingService())

    summary_holder = {}
    original_new_summary = orch.new_summary

    def capture_summary(mode):
        summary_holder["summary"] = original_new_summary(mode)
        return summary_holder["summary"]

    monkeypatch.setattr(orch, "new_summary", capture_summary)

    with pytest.raises(DeduperProcessorError, match="Embedding sync cancelled"):
        orch.run_analyze_fast(report_id=5)

    assert summary_holder["summary"].status == "cancelled"
