from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from src.modules.deduper.config import DeduperConfig
from src.modules.deduper.processors.content_hash import ContentHashProcessor
from src.modules.deduper.processors.embedding import EmbeddingProcessor
from src.modules.deduper.processors.load import LoadProcessor
from src.modules.deduper.processors.states import StatesProcessor
from src.modules.deduper.processors.url_check import UrlCheckProcessor
from src.modules.deduper.repository import DeduperRepository
from tests.postgres_test_utils import (
    ARTICLE_EMBEDDINGS_DDL,
    ARTICLE_EMBEDDINGS_INDEX_DDL,
    execute_many,
    execute_statements,
    reset_public_schema,
)


class _FakeSentenceTransformer:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        self.max_seq_length = 256

    def get_sentence_embedding_dimension(self) -> int:
        return 3

    def encode(self, texts, normalize_embeddings=True, convert_to_numpy=True, **kwargs):
        vecs = []
        for text in texts:
            if "match" in text.lower():
                vecs.append([1.0, 0.0, 0.0])
            else:
                vecs.append([0.0, 1.0, 0.0])
        return vecs


def _use_fake_model(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.modules.article_embeddings import encoder as encoder_mod

    encoder_mod.reset_model_cache()
    monkeypatch.setattr(encoder_mod, "SentenceTransformer", _FakeSentenceTransformer)


def _build_config(path_to_csv: str) -> DeduperConfig:
    return DeduperConfig(
        pg_host=os.getenv("PG_HOST", "localhost"),
        pg_port=int(os.getenv("PG_PORT", "5432")),
        pg_database=os.getenv("PG_DATABASE", "newsnexus_test_worker_python"),
        pg_user=os.getenv("PG_USER", "nick"),
        pg_password=os.getenv("PG_PASSWORD", ""),
        path_to_csv=path_to_csv,
        enable_embedding=True,
        batch_size_load=2,
        batch_size_states=2,
        batch_size_url=2,
        batch_size_content_hash=2,
        batch_size_embedding=2,
        cache_max_entries=10,
        checkpoint_interval=1,
    )


def _init_schema() -> None:
    reset_public_schema()
    execute_statements(
        [
            """
            CREATE TABLE "Articles" (
                id INTEGER PRIMARY KEY,
                url TEXT,
                title TEXT,
                description TEXT,
                "publishedDate" TEXT
            )
            """,
            """
            CREATE TABLE "ArticleApproveds" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER,
                "isApproved" BOOLEAN,
                "headlineForPdfReport" TEXT,
                "textForPdfReport" TEXT
            )
            """,
            """
            CREATE TABLE "ArticleReportContracts" (
                "articleId" INTEGER,
                "reportId" INTEGER
            )
            """,
            """
            CREATE TABLE "States" (
                id INTEGER PRIMARY KEY,
                abbreviation TEXT
            )
            """,
            """
            CREATE TABLE "ArticleStateContracts" (
                "articleId" INTEGER,
                "stateId" INTEGER
            )
            """,
            """
            CREATE TABLE "ArticleDuplicateAnalyses" (
                id SERIAL PRIMARY KEY,
                "articleIdNew" INTEGER,
                "articleIdApproved" INTEGER,
                "reportId" INTEGER,
                "sameArticleIdFlag" INTEGER,
                "articleNewState" TEXT DEFAULT '',
                "articleApprovedState" TEXT DEFAULT '',
                "sameStateFlag" INTEGER DEFAULT 0,
                "urlCheck" INTEGER DEFAULT 0,
                "contentHash" DOUBLE PRECISION DEFAULT 0,
                "embeddingSearch" DOUBLE PRECISION DEFAULT 0,
                "createdAt" TIMESTAMPTZ,
                "updatedAt" TIMESTAMPTZ
            )
            """,
            ARTICLE_EMBEDDINGS_DDL,
            ARTICLE_EMBEDDINGS_INDEX_DDL,
        ]
    )
    execute_many(
        'INSERT INTO "Articles"(id, url, title, description, "publishedDate") VALUES(%s, %s, %s, %s, %s)',
        [
            (1, "https://www.example.com/story?utm_source=x&id=1", "T1", "D1", "2026-01-01"),
            (2, "http://example.com/story?id=1", "T2", "D2", "2026-01-02"),
            (3, "https://example.com/story-b", "T3", "D3", "2026-01-03"),
        ],
    )
    execute_many(
        'INSERT INTO "ArticleApproveds"("articleId", "isApproved", "headlineForPdfReport", "textForPdfReport") VALUES(%s, %s, %s, %s)',
        [
            (1, True, "Major update announced", "The city council approved the same budget today."),
            (2, True, "Major update announced", "The city council approved the same budget today."),
            (3, True, "Weather report", "Heavy rain expected this weekend."),
        ],
    )
    execute_many(
        'INSERT INTO "ArticleReportContracts"("articleId", "reportId") VALUES(%s, %s)',
        [(1, 10), (2, 10)],
    )
    execute_many(
        'INSERT INTO "States"(id, abbreviation) VALUES(%s, %s)',
        [(1, "CA"), (2, "CA"), (3, "NY")],
    )
    execute_many(
        'INSERT INTO "ArticleStateContracts"("articleId", "stateId") VALUES(%s, %s)',
        [(1, 1), (2, 2), (3, 3)],
    )


@pytest.fixture
def repo_and_config(tmp_path: Path):
    _init_schema()

    csv_file = tmp_path / "article_ids.csv"
    csv_file.write_text("articleId\n1\n2\n", encoding="utf-8")

    config = _build_config(str(csv_file))
    repository = DeduperRepository(config)
    yield repository, config
    repository.close()


@pytest.mark.unit
def test_load_processor_report_mode(repo_and_config) -> None:
    repository, config = repo_and_config
    processor = LoadProcessor(repository, config)

    summary = processor.execute(report_id=10)

    assert summary["new_articles"] == 2
    assert summary["approved_articles"] == 3
    assert summary["processed"] == 6


@pytest.mark.unit
def test_load_processor_csv_mode(repo_and_config) -> None:
    repository, config = repo_and_config
    processor = LoadProcessor(repository, config)

    summary = processor.execute()

    assert summary["empty"] is False
    rows = repository.execute_query('SELECT COUNT(*) AS c FROM "ArticleDuplicateAnalyses"')
    assert rows[0]["c"] == 6


@pytest.mark.unit
def test_states_processor_updates_flags(repo_and_config) -> None:
    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)

    summary = StatesProcessor(repository, config).execute()

    assert summary["processed"] == 6
    assert summary["same_state_count"] >= 2


@pytest.mark.unit
def test_url_processor_and_golden_cases(repo_and_config) -> None:
    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)

    processor = UrlCheckProcessor(repository, config)
    summary = processor.execute()
    assert summary["processed"] == 6

    cases = json.loads(
        Path("tests/fixtures/deduper/golden_cases.json").read_text(encoding="utf-8")
    )["url_cases"]
    for case in cases:
        assert processor._compare_urls(case["new_url"], case["approved_url"]) is case["expected_match"]


@pytest.mark.unit
def test_content_hash_processor_and_golden_cases(repo_and_config) -> None:
    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)

    processor = ContentHashProcessor(repository, config)
    summary = processor.execute()

    assert summary["processed"] == 6

    cases = json.loads(
        Path("tests/fixtures/deduper/golden_cases.json").read_text(encoding="utf-8")
    )["content_cases"]

    exact = processor._compare_content_with_details(
        cases[0]["headline_new"],
        cases[0]["text_new"],
        cases[0]["headline_approved"],
        cases[0]["text_approved"],
        1,
        2,
    )
    assert exact == cases[0]["expected"]

    loose = processor._compare_content_with_details(
        cases[1]["headline_new"],
        cases[1]["text_new"],
        cases[1]["headline_approved"],
        cases[1]["text_approved"],
        11,
        22,
    )
    assert loose <= cases[1]["expected_max"]


@pytest.mark.unit
def test_embedding_processor_safeguard_skip_when_disabled(repo_and_config) -> None:
    repository, config = repo_and_config
    config.enable_embedding = False

    summary = EmbeddingProcessor(repository, config).execute()

    assert summary["status"] == "skipped"


@pytest.mark.unit
def test_embedding_processor_with_fake_model(repo_and_config, monkeypatch: pytest.MonkeyPatch) -> None:
    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)

    _use_fake_model(monkeypatch)

    summary = EmbeddingProcessor(repository, config).execute()

    assert summary["status"] == "ok"
    assert summary["processed"] == 6


@pytest.mark.unit
def test_load_processor_cancellation_checkpoint(repo_and_config) -> None:
    repository, config = repo_and_config
    processor = LoadProcessor(repository, config)

    with pytest.raises(Exception, match="cancelled"):
        processor.execute(report_id=10, should_cancel=lambda: True)


@pytest.mark.unit
def test_content_hash_cache_bounded(repo_and_config) -> None:
    repository, config = repo_and_config
    config.cache_max_entries = 1
    LoadProcessor(repository, config).execute(report_id=10)

    processor = ContentHashProcessor(repository, config)
    processor.execute()

    assert len(processor.norm_cache) <= config.cache_max_entries


def _analysis_scores(repository: DeduperRepository) -> dict[int, tuple[int, int, float]]:
    rows = repository.execute_query(
        'SELECT id, "articleIdNew", "articleIdApproved", "embeddingSearch" FROM "ArticleDuplicateAnalyses"'
    )
    return {
        row["id"]: (row["articleIdNew"], row["articleIdApproved"], row["embeddingSearch"])
        for row in rows
    }


def _legacy_score(text_new, text_approved) -> float:
    # The former per-pair EmbeddingProcessor logic, encoding one text at a time.
    from src.modules.article_embeddings.text import preprocess_text

    if text_new is None and text_approved is None:
        return 1.0
    if text_new is None or text_approved is None:
        return 0.0
    model = _FakeSentenceTransformer("legacy")
    vectors = []
    for text in (text_new, text_approved):
        cleaned = preprocess_text(text)
        vectors.append([0.0, 0.0, 0.0] if not cleaned else model.encode([cleaned])[0])
    similarity = sum(a * b for a, b in zip(*vectors))
    return max(0.0, min(1.0, similarity))


@pytest.fixture(autouse=True)
def _reset_model_cache():
    from src.modules.article_embeddings import encoder as encoder_mod

    encoder_mod.reset_model_cache()
    yield
    encoder_mod.reset_model_cache()


@pytest.mark.unit
def test_embedding_processor_scores_match_legacy_per_pair_scores(
    repo_and_config, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository, config = repo_and_config
    execute_statements(
        ['UPDATE "ArticleApproveds" SET "textForPdfReport" = \'A match about weather\' WHERE "articleId" = 3']
    )
    LoadProcessor(repository, config).execute(report_id=10)
    _use_fake_model(monkeypatch)

    EmbeddingProcessor(repository, config).execute()

    texts = {
        row["articleId"]: row["textForPdfReport"]
        for row in repository.execute_query('SELECT "articleId", "textForPdfReport" FROM "ArticleApproveds"')
    }
    scores = _analysis_scores(repository)
    assert scores
    for article_new, article_approved, score in scores.values():
        assert score == pytest.approx(_legacy_score(texts[article_new], texts[article_approved]))
    assert any(score == 0.0 for _, _, score in scores.values())


@pytest.mark.unit
def test_embedding_processor_fallback_encodes_missing_embeddings(
    repo_and_config, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)
    _use_fake_model(monkeypatch)
    assert repository.execute_query('SELECT COUNT(*) AS c FROM "ArticleEmbeddings"')[0]["c"] == 0

    summary = EmbeddingProcessor(repository, config).execute()

    stored = repository.execute_query('SELECT "articleId" FROM "ArticleEmbeddings" ORDER BY "articleId"')
    assert [row["articleId"] for row in stored] == [1, 2, 3]
    assert summary["processed"] == 6


@pytest.mark.unit
def test_embedding_processor_cancel_during_ensure_raises_deduper_error(
    repo_and_config, monkeypatch: pytest.MonkeyPatch
) -> None:
    from src.modules.article_embeddings import ArticleEmbeddingsCancelledError
    from src.modules.deduper.errors import DeduperProcessorError

    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)
    _use_fake_model(monkeypatch)

    with pytest.raises(DeduperProcessorError, match="Embedding processor cancelled") as exc_info:
        EmbeddingProcessor(repository, config).execute(should_cancel=lambda: True)

    assert isinstance(exc_info.value.__cause__, ArticleEmbeddingsCancelledError)


@pytest.mark.unit
def test_embedding_processor_pages_score_each_record_once_with_bounded_writes(
    repo_and_config, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository, config = repo_and_config
    config.batch_size_embedding = 2
    execute_statements(
        ['UPDATE "ArticleApproveds" SET "textForPdfReport" = \'A match about weather\' WHERE "articleId" = 3']
    )
    LoadProcessor(repository, config).execute(report_id=10)
    _use_fake_model(monkeypatch)
    all_ids = sorted(_analysis_scores(repository))

    write_batches: list[list[int]] = []
    page_ids: list[int] = []
    original_write = repository.update_analysis_embedding_batch
    original_page = repository.get_analysis_records_for_embedding_update_page

    def spy_write(updates):
        write_batches.append([update["id"] for update in updates])
        return original_write(updates)

    def spy_page(after_id, limit):
        page = original_page(after_id=after_id, limit=limit)
        page_ids.extend(record["id"] for record in page)
        return page

    monkeypatch.setattr(repository, "update_analysis_embedding_batch", spy_write)
    monkeypatch.setattr(repository, "get_analysis_records_for_embedding_update_page", spy_page)

    summary = EmbeddingProcessor(repository, config).execute()

    written = [row_id for batch in write_batches for row_id in batch]
    assert summary["processed"] == len(all_ids)
    assert sorted(written) == all_ids
    assert len(written) == len(set(written))
    # Rows that scored 0 stay at 0 but are never read a second time.
    assert sorted(page_ids) == all_ids
    assert len(write_batches) >= 3
    assert all(len(batch) <= config.batch_size_embedding for batch in write_batches)


class _NoCallService:
    def ensure_embeddings(self, *args, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("ensure_embeddings must not be called")

    def sync(self, *args, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("sync must not be called")


@pytest.mark.unit
def test_embedding_processor_empty_analysis_table(repo_and_config, monkeypatch: pytest.MonkeyPatch) -> None:
    from src.modules.article_embeddings import encoder as encoder_mod

    repository, config = repo_and_config

    def _fail_load(model_name):
        raise AssertionError("model must not load")

    monkeypatch.setattr(encoder_mod, "_load_model", _fail_load)

    summary = EmbeddingProcessor(repository, config, embedding_service=_NoCallService()).execute()

    assert summary == {
        "processed": 0,
        "status": "ok",
        "high_similarity_count": 0,
        "medium_similarity_count": 0,
        "low_similarity_count": 0,
    }


class _FakeSyncService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[str] = []

    def sync(self, mode, should_cancel=None):
        from src.modules.article_embeddings import EmbeddingSyncSummary

        self.calls.append(str(mode))
        if self.error is not None:
            raise self.error
        return EmbeddingSyncSummary(mode=mode, encoded=4, upserted=4)


@pytest.mark.unit
def test_embedding_sync_processor_returns_dict_with_processed(repo_and_config) -> None:
    from src.modules.article_embeddings import EmbeddingSyncMode
    from src.modules.deduper.processors.embedding_sync import EmbeddingSyncProcessor

    repository, config = repo_and_config
    service = _FakeSyncService()

    result = EmbeddingSyncProcessor(
        repository, config, embedding_service=service, mode=EmbeddingSyncMode.REBUILD
    ).execute()

    assert isinstance(result, dict)
    assert result["processed"] == 4
    assert service.calls == ["rebuild"]


@pytest.mark.unit
def test_embedding_sync_processor_converts_cancel(repo_and_config) -> None:
    from src.modules.article_embeddings import ArticleEmbeddingsCancelledError
    from src.modules.deduper.errors import DeduperProcessorError
    from src.modules.deduper.processors.embedding_sync import EmbeddingSyncProcessor

    repository, config = repo_and_config
    service = _FakeSyncService(error=ArticleEmbeddingsCancelledError("stop"))

    with pytest.raises(DeduperProcessorError, match="Embedding sync cancelled"):
        EmbeddingSyncProcessor(repository, config, embedding_service=service).execute()


@pytest.mark.unit
def test_embedding_sync_processor_skips_when_disabled(repo_and_config) -> None:
    from src.modules.deduper.processors.embedding_sync import EmbeddingSyncProcessor

    repository, config = repo_and_config
    config.enable_embedding = False

    result = EmbeddingSyncProcessor(repository, config, embedding_service=_NoCallService()).execute()

    assert result["status"] == "skipped"
