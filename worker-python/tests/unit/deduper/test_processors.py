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
from tests.postgres_test_utils import execute_many, execute_statements, reset_public_schema


class _FakeSentenceTransformer:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        self.max_seq_length = 256

    def get_sentence_embedding_dimension(self) -> int:
        return 3

    def encode(self, texts, normalize_embeddings=True, convert_to_numpy=True):
        vecs = []
        for text in texts:
            if "match" in text.lower():
                vecs.append([1.0, 0.0, 0.0])
            else:
                vecs.append([0.0, 1.0, 0.0])
        return vecs


class _FakeNumpy:
    float32 = float

    @staticmethod
    def dot(a, b):
        return sum(x * y for x, y in zip(a, b))

    @staticmethod
    def zeros(dim, dtype=None):
        return [0.0] * dim


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
    from src.modules.deduper.processors import embedding as embedding_mod

    repository, config = repo_and_config
    LoadProcessor(repository, config).execute(report_id=10)

    monkeypatch.setattr(embedding_mod, "SentenceTransformer", _FakeSentenceTransformer)
    monkeypatch.setattr(embedding_mod, "np", _FakeNumpy)

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
