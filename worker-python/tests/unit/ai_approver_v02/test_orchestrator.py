from __future__ import annotations

from dataclasses import dataclass

import pytest
from loguru import logger

from src.modules.ai_approver_v02.orchestrator import AiApproverV02Orchestrator
from src.modules.ai_approver_v02.types import ArticleInput, ModelOutcome
from src.modules.queue.engine import QueueJobCanceledError


@dataclass
class FakeClient:
    outcomes: list[ModelOutcome]

    def evaluate(self, _prompt: str) -> ModelOutcome:
        return self.outcomes.pop(0)


class FakeRepository:
    def __init__(self, item_count: int) -> None:
        self.run = {
            "activePromptVersionId": 7,
            "modelName": "test-model",
            "selectionSnapshot": [
                {
                    "articleId": article_id,
                    "contentSource": "article_contents_02",
                    "articleContents02Id": article_id,
                }
                for article_id in range(1, item_count + 1)
            ],
        }
        self.counts: list[str] = []
        self.finished: tuple[str, str | None] | None = None
        self.persisted: list[int] = []

    def mark_running(self, _run_id: int):
        return self.run

    def load_frozen_article(self, item):
        article_id = item["articleId"]
        return ArticleInput(
            article_id=article_id,
            title=f"T{article_id}",
            content=f"C{article_id}",
            content_source="article_contents_02",
            article_contents_02_id=article_id,
        )

    def get_prompt_for_article(self, _article_id: int, _run_prompt_id: int):
        return {"id": 7, "promptInMarkdown": "operator"}

    def persist_outcome(self, **kwargs):
        self.persisted.append(kwargs["article"].article_id)

    def increment_count(self, _run_id: int, count_name: str):
        self.counts.append(count_name)

    def finish_run(self, _run_id: int, status: str, reason: str | None):
        self.finished = (status, reason)


def test_orchestrator_orders_descending_and_resets_breakers() -> None:
    repository = FakeRepository(4)
    client = FakeClient(
        [
            ModelOutcome(status="failed"),
            ModelOutcome(status="invalid_response"),
            ModelOutcome(
                status="completed",
                prediction="approved",
                reasoning="yes",
            ),
            ModelOutcome(status="failed"),
        ]
    )

    result = AiApproverV02Orchestrator(repository, client).run(1, lambda: False)

    assert repository.persisted == [4, 3, 2, 1]
    assert repository.finished == ("completed", None)
    assert result["status"] == "completed"


def test_orchestrator_stops_at_independent_cli_breaker() -> None:
    repository = FakeRepository(6)
    client = FakeClient(
        [
            ModelOutcome(status="failed"),
            ModelOutcome(status="invalid_response"),
            ModelOutcome(status="failed"),
            ModelOutcome(status="invalid_response"),
            ModelOutcome(status="failed"),
            ModelOutcome(status="invalid_response"),
        ]
    )

    result = AiApproverV02Orchestrator(repository, client).run(1, lambda: False)

    assert len(repository.persisted) == 5
    assert repository.finished == ("circuit_breaker", "codex_cli_failures")
    assert result["status"] == "circuit_breaker"


def test_orchestrator_stops_at_invalid_response_breaker() -> None:
    repository = FakeRepository(6)
    client = FakeClient(
        [
            ModelOutcome(status="invalid_response"),
            ModelOutcome(status="failed"),
            ModelOutcome(status="invalid_response"),
            ModelOutcome(status="invalid_response"),
            ModelOutcome(status="invalid_response"),
            ModelOutcome(status="invalid_response"),
        ]
    )

    result = AiApproverV02Orchestrator(repository, client).run(1, lambda: False)

    assert len(repository.persisted) == 4
    assert repository.finished == ("circuit_breaker", "invalid_responses")
    assert result["status"] == "circuit_breaker"


def test_orchestrator_stops_at_three_cli_failures() -> None:
    repository = FakeRepository(5)
    client = FakeClient([ModelOutcome(status="failed") for _ in range(5)])

    result = AiApproverV02Orchestrator(repository, client).run(1, lambda: False)

    assert len(repository.persisted) == 3
    assert repository.finished == ("circuit_breaker", "codex_cli_failures")
    assert result["status"] == "circuit_breaker"


def test_orchestrator_success_resets_failure_counts() -> None:
    repository = FakeRepository(5)
    client = FakeClient(
        [
            ModelOutcome(status="failed"),
            ModelOutcome(status="failed"),
            ModelOutcome(
                status="completed",
                prediction="approved",
                reasoning="yes",
            ),
            ModelOutcome(status="failed"),
            ModelOutcome(status="failed"),
        ]
    )

    result = AiApproverV02Orchestrator(repository, client).run(1, lambda: False)

    assert len(repository.persisted) == 5
    assert repository.finished == ("completed", None)
    assert result["status"] == "completed"


def test_orchestrator_logs_failures_and_breaker_reason() -> None:
    messages: list[str] = []
    sink_id = logger.add(messages.append, format="{level} {message}")
    try:
        repository = FakeRepository(3)
        client = FakeClient(
            [
                ModelOutcome(
                    status="failed",
                    error_code="codex_exit_error",
                    error_message=f"exit 1; stderr tail: ERROR: model_not_found {index}",
                )
                for index in range(3)
            ]
        )

        AiApproverV02Orchestrator(repository, client).run(1, lambda: False)
    finally:
        logger.remove(sink_id)

    warnings = [message for message in messages if message.startswith("WARNING")]
    errors = [message for message in messages if message.startswith("ERROR")]
    assert len(warnings) == 3
    assert "run=1 article=3 prompt=7 error_code=codex_exit_error" in warnings[0]
    assert "ERROR: model_not_found 0" in warnings[0]
    assert len(errors) == 1
    assert "reason=codex_cli_failures article=1 prompt=7" in errors[0]
    assert "ERROR: model_not_found 2" in errors[0]


def test_orchestrator_cancels_before_next_article() -> None:
    repository = FakeRepository(2)
    client = FakeClient([])

    with pytest.raises(QueueJobCanceledError):
        AiApproverV02Orchestrator(repository, client).run(1, lambda: True)

    assert repository.persisted == []
    assert repository.finished == ("canceled", "cancel_requested")


def test_orchestrator_skips_unusable_frozen_source() -> None:
    repository = FakeRepository(1)
    repository.load_frozen_article = lambda _item: None

    result = AiApproverV02Orchestrator(repository, FakeClient([])).run(
        1,
        lambda: False,
    )

    assert repository.persisted == []
    assert repository.counts == ["skippedCount"]
    assert repository.finished == ("completed", None)
    assert result["status"] == "completed"
