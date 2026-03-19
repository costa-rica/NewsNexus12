from __future__ import annotations

import sqlite3

from src.modules.ai_approver.config import AiApproverConfig
from src.modules.ai_approver.repository import AiApproverRepository


def _create_repo(tmp_path) -> AiApproverRepository:
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE Articles (
            id INTEGER PRIMARY KEY,
            title TEXT,
            description TEXT
        );
        CREATE TABLE ArticleContents (
            id INTEGER PRIMARY KEY,
            articleId INTEGER,
            content TEXT
        );
        CREATE TABLE ArticleIsRelevants (
            id INTEGER PRIMARY KEY,
            articleId INTEGER,
            isRelevant INTEGER
        );
        CREATE TABLE ArticleApproveds (
            id INTEGER PRIMARY KEY,
            articleId INTEGER,
            isApproved INTEGER
        );
        CREATE TABLE ArticleStateContracts02 (
            id INTEGER PRIMARY KEY,
            articleId INTEGER,
            stateId INTEGER,
            isDeterminedToBeError INTEGER
        );
        CREATE TABLE AiApproverPromptVersions (
            id INTEGER PRIMARY KEY,
            name TEXT,
            description TEXT,
            promptInMarkdown TEXT,
            isActive INTEGER,
            endedAt TEXT
        );
        CREATE TABLE AiApproverArticleScores (
            id INTEGER PRIMARY KEY,
            articleId INTEGER,
            promptVersionId INTEGER,
            resultStatus TEXT,
            score REAL,
            reason TEXT,
            errorCode TEXT,
            errorMessage TEXT,
            isHumanApproved INTEGER,
            reasonHumanRejected TEXT,
            jobId TEXT,
            createdAt TEXT,
            updatedAt TEXT
        );
        """
    )
    conn.executemany(
        "INSERT INTO Articles(id, title, description) VALUES (?, ?, ?)",
        [
            (1, "A1", "D1"),
            (2, "A2", "D2"),
            (3, "A3", "D3"),
            (4, "A4", "D4"),
            (5, "A5", "D5"),
        ],
    )
    conn.executemany(
        "INSERT INTO ArticleContents(id, articleId, content) VALUES (?, ?, ?)",
        [(1, 1, "C1"), (2, 2, "C2")],
    )
    conn.executemany(
        "INSERT INTO ArticleIsRelevants(id, articleId, isRelevant) VALUES (?, ?, ?)",
        [(1, 3, 0)],
    )
    conn.executemany(
        "INSERT INTO ArticleApproveds(id, articleId, isApproved) VALUES (?, ?, ?)",
        [(1, 4, 1), (2, 5, 0)],
    )
    conn.executemany(
        """
        INSERT INTO ArticleStateContracts02(id, articleId, stateId, isDeterminedToBeError)
        VALUES (?, ?, ?, ?)
        """,
        [(1, 1, 5, 0), (2, 2, 7, 0), (3, 3, None, 0), (4, 4, 5, 0)],
    )
    conn.executemany(
        """
        INSERT INTO AiApproverPromptVersions(id, name, description, promptInMarkdown, isActive, endedAt)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [(1, "P1", None, "# T1", 1, None), (2, "P2", None, "# T2", 0, None)],
    )
    conn.executemany(
        """
        INSERT INTO AiApproverArticleScores(
            id, articleId, promptVersionId, resultStatus, score, reason,
            errorCode, errorMessage, isHumanApproved, reasonHumanRejected, jobId, createdAt, updatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        """,
        [(1, 2, 1, "completed", 0.7, "done", None, None, None, None, "1")],
    )
    conn.commit()
    conn.close()

    config = AiApproverConfig(
        path_database=str(tmp_path),
        name_db="test.db",
        openai_api_key="secret",
        model_name="gpt-4o-mini",
        batch_size=10,
    )
    return AiApproverRepository(config)


def test_get_active_prompt_versions(tmp_path) -> None:
    repo = _create_repo(tmp_path)
    try:
        prompts = repo.get_active_prompt_versions()
    finally:
        repo.close()

    assert len(prompts) == 1
    assert prompts[0]["id"] == 1


def test_get_eligible_articles_filters_by_existing_scores_and_state(tmp_path) -> None:
    repo = _create_repo(tmp_path)
    try:
        rows = repo.get_eligible_articles(
            limit=10,
            require_state_assignment=True,
            state_ids=[5],
        )
    finally:
        repo.close()

    assert [row["id"] for row in rows] == [1]
    assert rows[0]["content"] == "C1"


def test_get_eligible_articles_excludes_not_relevant_and_any_human_decision(tmp_path) -> None:
    repo = _create_repo(tmp_path)
    try:
        rows = repo.get_eligible_articles(
            limit=10,
            require_state_assignment=False,
            state_ids=None,
        )
    finally:
        repo.close()

    assert [row["id"] for row in rows] == [1]
