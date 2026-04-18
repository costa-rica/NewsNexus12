from __future__ import annotations

import os

import pytest

from src.modules.location_scorer.config import LocationScorerConfig
from src.modules.location_scorer.errors import LocationScorerDatabaseError
from src.modules.location_scorer.repository import LocationScorerRepository
from tests.postgres_test_utils import execute_many, execute_statements, reset_public_schema


def _build_config(pg_database: str | None = None) -> LocationScorerConfig:
    return LocationScorerConfig(
        pg_host=os.getenv("PG_HOST", "localhost"),
        pg_port=int(os.getenv("PG_PORT", "5432")),
        pg_database=pg_database or os.getenv("PG_DATABASE", "newsnexus_test_worker_python"),
        pg_user=os.getenv("PG_USER", "nick"),
        pg_password=os.getenv("PG_PASSWORD", ""),
        ai_entity_name="NewsNexusClassifierLocationScorer01",
        batch_size=10,
        checkpoint_interval=10,
    )


def _init_schema() -> None:
    reset_public_schema()
    execute_statements(
        [
            """
            CREATE TABLE "Articles" (
                id INTEGER PRIMARY KEY,
                title TEXT,
                description TEXT
            )
            """,
            """
            CREATE TABLE "ArtificialIntelligences" (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE "EntityWhoCategorizedArticles" (
                id INTEGER PRIMARY KEY,
                "artificialIntelligenceId" INTEGER
            )
            """,
            """
            CREATE TABLE "ArticleEntityWhoCategorizedArticleContracts" (
                id SERIAL PRIMARY KEY,
                "articleId" INTEGER NOT NULL,
                "entityWhoCategorizesId" INTEGER NOT NULL,
                keyword TEXT,
                "keywordRating" DOUBLE PRECISION,
                "createdAt" TIMESTAMPTZ,
                "updatedAt" TIMESTAMPTZ
            )
            """,
            """
            CREATE UNIQUE INDEX "idx_location_scores_unique"
            ON "ArticleEntityWhoCategorizedArticleContracts"("articleId", "entityWhoCategorizesId", keyword)
            """,
        ]
    )
    execute_many(
        'INSERT INTO "Articles"(id, title, description) VALUES(%s, %s, %s)',
        [
            (1, "California storm", "Heavy rains hit the coast."),
            (2, "Berlin summit", "Leaders met in Germany."),
            (3, "Texas drought", "Dry weather continues."),
        ],
    )
    execute_many(
        'INSERT INTO "ArtificialIntelligences"(id, name) VALUES(%s, %s)',
        [
            (10, "NewsNexusClassifierLocationScorer01"),
            (11, "OtherScorer"),
        ],
    )
    execute_many(
        'INSERT INTO "EntityWhoCategorizedArticles"(id, "artificialIntelligenceId") VALUES(%s, %s)',
        [
            (100, 10),
            (101, 11),
        ],
    )
    execute_many(
        'INSERT INTO "ArticleEntityWhoCategorizedArticleContracts"("articleId", "entityWhoCategorizesId", keyword, "keywordRating", "createdAt", "updatedAt") VALUES(%s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [(1, 100, "Occurred in the United States", 0.95)],
    )


@pytest.fixture
def repo() -> LocationScorerRepository:
    _init_schema()
    repository = LocationScorerRepository(_build_config())
    yield repository
    repository.close()


@pytest.mark.unit
def test_repository_healthcheck_success(repo: LocationScorerRepository) -> None:
    assert repo.healthcheck() is True


@pytest.mark.unit
def test_repository_healthcheck_failure_for_missing_db() -> None:
    repository = LocationScorerRepository(_build_config(pg_database="missing_worker_python_test_db"))

    with pytest.raises(LocationScorerDatabaseError, match="Repository healthcheck failed"):
        repository.healthcheck()

    repository.close()


@pytest.mark.unit
def test_get_entity_who_categorized_article_id_existing_and_missing(
    repo: LocationScorerRepository,
) -> None:
    assert (
        repo.get_entity_who_categorized_article_id("NewsNexusClassifierLocationScorer01")
        == 100
    )
    assert repo.get_entity_who_categorized_article_id("MissingScorer") is None


@pytest.mark.unit
def test_get_unscored_articles_and_limit(repo: LocationScorerRepository) -> None:
    articles = repo.get_unscored_articles(entity_id=100)

    assert [article["id"] for article in articles] == [2, 3]

    limited_articles = repo.get_unscored_articles(entity_id=100, limit=1)

    assert [article["id"] for article in limited_articles] == [2]


@pytest.mark.unit
def test_write_scores_batch_counts_inserted_and_duplicates(
    repo: LocationScorerRepository,
) -> None:
    result = repo.write_scores_batch(
        entity_id=100,
        scores=[
            {
                "article_id": 1,
                "score": 0.95,
                "rating_for": "Occurred in the United States",
            },
            {
                "article_id": 2,
                "score": 0.12,
                "rating_for": "Occurred in the United States",
            },
            {
                "article_id": 3,
                "score": 0.87,
                "rating_for": "Occurred in the United States",
            },
        ],
    )

    assert result == {"inserted": 2, "duplicates": 1}

    persisted = repo.execute_query(
        """
        SELECT "articleId", "entityWhoCategorizesId", keyword
        FROM "ArticleEntityWhoCategorizedArticleContracts"
        WHERE "entityWhoCategorizesId" = %s
        ORDER BY "articleId"
        """,
        (100,),
    )

    assert persisted == [
        {
            "articleId": 1,
            "entityWhoCategorizesId": 100,
            "keyword": "Occurred in the United States",
        },
        {
            "articleId": 2,
            "entityWhoCategorizesId": 100,
            "keyword": "Occurred in the United States",
        },
        {
            "articleId": 3,
            "entityWhoCategorizesId": 100,
            "keyword": "Occurred in the United States",
        },
    ]
