from __future__ import annotations

import numpy as np
import psycopg
import pytest
from psycopg.rows import dict_row

from src.modules.article_embeddings.errors import (
    ArticleEmbeddingsCancelledError,
    ArticleEmbeddingsDatabaseError,
)
from src.modules.article_embeddings.repository import ArticleEmbeddingRepository
from src.modules.article_embeddings.service import ArticleEmbeddingService
from src.modules.article_embeddings.text import preprocess_text, text_hash
from src.modules.article_embeddings.types import EmbeddingSyncMode
from tests.postgres_test_utils import (
    ARTICLE_EMBEDDINGS_DDL,
    ARTICLE_EMBEDDINGS_INDEX_DDL,
    execute_many,
    execute_statements,
    get_test_dsn,
    reset_public_schema,
)

MODEL_NAME = "fake-model"


class FakeEncoder:
    """Deterministic 3-dim encoder that records every call."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def encode(self, texts: list[str]) -> list[np.ndarray]:
        self.calls.append(list(texts))
        vectors = []
        for text in texts:
            if not text:
                vectors.append(np.zeros(3, dtype=np.float32))
                continue
            raw = np.array([len(text), text.count("a") + 1, 1.0], dtype=np.float32)
            vectors.append(raw / np.linalg.norm(raw))
        return vectors

    @property
    def encoded_texts(self) -> list[str]:
        return [text for call in self.calls for text in call]


def _init_schema(include_embeddings_table: bool = True) -> None:
    reset_public_schema()
    statements = [
        """
        CREATE TABLE "ArticleApproveds" (
            id SERIAL PRIMARY KEY,
            "articleId" INTEGER,
            "isApproved" BOOLEAN,
            "textForPdfReport" TEXT
        )
        """,
    ]
    if include_embeddings_table:
        statements += [ARTICLE_EMBEDDINGS_DDL, ARTICLE_EMBEDDINGS_INDEX_DDL]
    execute_statements(statements)


def _insert_approved(rows: list[tuple[int, bool, str | None]]) -> None:
    execute_many(
        'INSERT INTO "ArticleApproveds"("articleId", "isApproved", "textForPdfReport") VALUES(%s, %s, %s)',
        rows,
    )


def _sql(statement: str, params: tuple = ()) -> list[dict]:
    with psycopg.connect(get_test_dsn(), row_factory=dict_row, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute(statement, params)
            return cursor.fetchall() if cursor.description else []


def _stored_ids() -> list[int]:
    return [
        row["articleId"]
        for row in _sql('SELECT "articleId" FROM "ArticleEmbeddings" ORDER BY "articleId"')
    ]


@pytest.fixture
def connection():
    conn = psycopg.connect(get_test_dsn(), row_factory=dict_row)
    yield conn
    conn.close()


@pytest.fixture
def service_factory(connection):
    def _factory(batch_size: int = 2) -> tuple[ArticleEmbeddingService, FakeEncoder]:
        encoder = FakeEncoder()
        repository = ArticleEmbeddingRepository(connection_provider=lambda: connection)
        service = ArticleEmbeddingService(
            repository=repository,
            encoder=encoder,
            model_name=MODEL_NAME,
            batch_size=batch_size,
        )
        return service, encoder

    return _factory


@pytest.fixture
def seeded():
    _init_schema()
    _insert_approved(
        [
            (1, True, "<p>alpha article</p>"),
            (2, True, "banana bread"),
            (3, True, "cat"),
            (4, False, "not approved"),
        ]
    )


@pytest.mark.unit
def test_incremental_sync_encodes_missing_then_nothing(seeded, service_factory) -> None:
    service, encoder = service_factory()

    first = service.sync()
    assert first.missing == 3
    assert first.encoded == 3
    assert _stored_ids() == [1, 2, 3]
    assert preprocess_text("<p>alpha article</p>") in encoder.encoded_texts

    service2, encoder2 = service_factory()
    second = service2.sync()
    assert second.encoded == 0
    assert second.missing == 0
    assert second.stale == 0
    assert encoder2.calls == []


@pytest.mark.unit
def test_incremental_sync_encodes_only_changed_text(seeded, service_factory) -> None:
    service, _ = service_factory()
    service.sync()
    _sql('UPDATE "ArticleApproveds" SET "textForPdfReport" = %s WHERE "articleId" = 2', ("changed",))

    service2, encoder2 = service_factory()
    summary = service2.sync(EmbeddingSyncMode.INCREMENTAL)

    assert summary.stale == 1
    assert summary.encoded == 1
    assert encoder2.encoded_texts == ["changed"]
    stored = _sql('SELECT "textHash" FROM "ArticleEmbeddings" WHERE "articleId" = 2')
    assert stored[0]["textHash"] == text_hash("changed")


@pytest.mark.unit
def test_rebuild_overwrites_rows_and_removes_unapproved(seeded, service_factory) -> None:
    service, _ = service_factory()
    service.sync()
    _sql('UPDATE "ArticleApproveds" SET "isApproved" = FALSE WHERE "articleId" = 3')
    before = _sql('SELECT id FROM "ArticleEmbeddings" WHERE "articleId" = 1')[0]["id"]

    service2, encoder2 = service_factory()
    summary = service2.sync(EmbeddingSyncMode.REBUILD)

    assert summary.encoded == 2
    assert sorted(encoder2.encoded_texts) == sorted(
        [preprocess_text("<p>alpha article</p>"), "banana bread"]
    )
    assert summary.deleted == 1
    assert _stored_ids() == [1, 2]
    # Upsert keeps the row (no truncate), so the id is unchanged.
    assert _sql('SELECT id FROM "ArticleEmbeddings" WHERE "articleId" = 1')[0]["id"] == before


@pytest.mark.unit
def test_sync_deletes_row_when_text_becomes_null(seeded, service_factory) -> None:
    service, _ = service_factory()
    service.sync()
    _sql('UPDATE "ArticleApproveds" SET "textForPdfReport" = NULL WHERE "articleId" = 2')

    service2, _ = service_factory()
    summary = service2.sync()

    assert summary.deleted == 1
    assert _stored_ids() == [1, 3]


@pytest.mark.unit
def test_newest_approved_row_is_used(service_factory) -> None:
    _init_schema()
    _insert_approved([(7, True, "old text"), (7, True, "new text")])
    service, encoder = service_factory()

    service.sync()

    assert encoder.encoded_texts == ["new text"]
    stored = _sql('SELECT "textHash" FROM "ArticleEmbeddings" WHERE "articleId" = 7')
    assert stored[0]["textHash"] == text_hash("new text")


@pytest.mark.unit
def test_empty_text_stores_zero_vector_and_null_text_gets_no_row(service_factory) -> None:
    _init_schema()
    _insert_approved([(1, True, "<br/>   "), (2, True, None)])
    service, _ = service_factory()

    service.sync()

    assert _stored_ids() == [1]
    loaded = service.load_embeddings([1, 2])
    assert set(loaded) == {1}
    assert np.array_equal(loaded[1], np.zeros(3, dtype=np.float32))


@pytest.mark.unit
def test_sync_cancels_between_batches(seeded, service_factory) -> None:
    service, encoder = service_factory(batch_size=1)
    checks = {"count": 0}

    def cancel_after_first_batch() -> bool:
        checks["count"] += 1
        return checks["count"] > 1

    with pytest.raises(ArticleEmbeddingsCancelledError):
        service.sync(should_cancel=cancel_after_first_batch)

    assert len(encoder.calls) == 1
    assert len(_stored_ids()) == 1


@pytest.mark.unit
def test_summary_to_dict_includes_processed(seeded, service_factory) -> None:
    service, _ = service_factory()

    result = service.sync().to_dict()

    assert result["processed"] == 3
    assert result["mode"] == "incremental"
    assert result["status"] == "ok"


@pytest.mark.unit
def test_ensure_embeddings_reuses_matching_rows(seeded, service_factory) -> None:
    service, _ = service_factory()
    service.sync()
    _sql('UPDATE "ArticleApproveds" SET "textForPdfReport" = %s WHERE "articleId" = 3', ("cats",))
    _insert_approved([(5, True, "fresh")])

    service2, encoder2 = service_factory()
    result = service2.ensure_embeddings([1, 2, 3, 5])

    assert set(result) == {1, 2, 3, 5}
    assert sorted(encoder2.encoded_texts) == ["cats", "fresh"]
    assert _stored_ids() == [1, 2, 3, 5]


@pytest.mark.unit
def test_ensure_embeddings_deletes_row_when_text_becomes_null(seeded, service_factory) -> None:
    service, _ = service_factory()
    service.sync()
    _sql('UPDATE "ArticleApproveds" SET "textForPdfReport" = NULL WHERE "articleId" = 1')

    service2, encoder2 = service_factory()
    result = service2.ensure_embeddings([1, 2, 99])

    assert set(result) == {2}
    assert encoder2.calls == []
    assert _stored_ids() == [2, 3]


@pytest.mark.unit
def test_ensure_embeddings_matches_stored_values(seeded, service_factory) -> None:
    service, _ = service_factory()
    service.sync()

    loaded = service.load_embeddings([1, 2, 3])
    ensured = service.ensure_embeddings([1, 2, 3])

    for article_id in (1, 2, 3):
        assert loaded[article_id].dtype == np.float32
        assert np.array_equal(loaded[article_id], ensured[article_id])


@pytest.mark.unit
def test_embedding_bytes_round_trip(seeded, service_factory) -> None:
    service, encoder = service_factory()
    service.sync()

    expected = encoder.encode(["banana bread"])[0]
    loaded = service.load_embeddings([2])[2]

    assert np.array_equal(loaded, expected)


@pytest.mark.unit
def test_ensure_embeddings_cancel_raises_module_error(seeded, service_factory) -> None:
    service, _ = service_factory()

    with pytest.raises(ArticleEmbeddingsCancelledError):
        service.ensure_embeddings([1, 2, 3], should_cancel=lambda: True)


class _RecordingConnection:
    """Fake connection that fails the test if any query is sent."""

    def cursor(self, *args, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("no query expected")

    def commit(self):  # pragma: no cover - must not be called
        raise AssertionError("no commit expected")


@pytest.mark.unit
def test_empty_inputs_send_no_query_and_load_no_model() -> None:
    fake_conn = _RecordingConnection()
    repository = ArticleEmbeddingRepository(connection_provider=lambda: fake_conn)
    encoder = FakeEncoder()
    service = ArticleEmbeddingService(repository, encoder, MODEL_NAME, batch_size=2)

    assert repository.get_selected_texts([]) == {}
    assert repository.get_embeddings([], MODEL_NAME) == {}
    assert repository.upsert_embeddings([]) == 0
    assert repository.delete_embeddings([], MODEL_NAME) == 0
    assert service.ensure_embeddings([]) == {}
    assert encoder.calls == []


@pytest.mark.unit
def test_sync_with_nothing_to_encode_does_not_load_model(service_factory, monkeypatch) -> None:
    from src.modules.article_embeddings import encoder as encoder_mod
    from src.modules.article_embeddings.encoder import EmbeddingEncoder

    _init_schema()

    def _fail_load(model_name: str):
        raise AssertionError("model must not load")

    monkeypatch.setattr(encoder_mod, "_load_model", _fail_load)
    service, _ = service_factory()
    service.encoder = EmbeddingEncoder("unused", 2)

    summary = service.sync()

    assert summary.encoded == 0


@pytest.mark.unit
def test_missing_table_raises_clear_error(service_factory) -> None:
    _init_schema(include_embeddings_table=False)
    _insert_approved([(1, True, "text")])
    service, _ = service_factory()

    with pytest.raises(ArticleEmbeddingsDatabaseError, match="ArticleEmbeddings table does not exist"):
        service.sync()


@pytest.mark.unit
def test_borrowed_close_leaves_connection_open(connection) -> None:
    repository = ArticleEmbeddingRepository(connection_provider=lambda: connection)

    repository.close()

    assert not connection.closed
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 AS one")
        assert cursor.fetchone()["one"] == 1


@pytest.mark.unit
def test_owned_close_closes_pool() -> None:
    from src.modules.article_embeddings.config import ArticleEmbeddingsConfig

    _init_schema()
    config = ArticleEmbeddingsConfig.from_env()
    repository = ArticleEmbeddingRepository.from_config(config)
    assert repository.owns_connection

    assert repository.get_approved_article_texts() == {}
    repository.close()

    assert repository._pool is not None and repository._pool.closed
