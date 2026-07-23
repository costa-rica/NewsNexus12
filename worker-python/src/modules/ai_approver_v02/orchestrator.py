"""Frozen-selection execution for AI Approver V02."""

from __future__ import annotations

from collections.abc import Callable

from src.modules.ai_approver_v02.client import AiApproverV02CodexClient
from src.modules.ai_approver_v02.prompts import render_prompt
from src.modules.ai_approver_v02.repository import AiApproverV02Repository
from src.modules.queue.engine import QueueJobCanceledError


class AiApproverV02Orchestrator:
    def __init__(
        self,
        repository: AiApproverV02Repository,
        client: AiApproverV02CodexClient,
    ) -> None:
        self.repository = repository
        self.client = client

    def run(
        self,
        run_id: int,
        should_cancel: Callable[[], bool],
    ) -> dict[str, int | str]:
        run = self.repository.mark_running(run_id)
        cli_failures = 0
        invalid_responses = 0

        try:
            selection = sorted(
                run["selectionSnapshot"],
                key=lambda item: int(item["articleId"]),
                reverse=True,
            )
            for item in selection:
                if should_cancel():
                    self.repository.finish_run(
                        run_id,
                        "canceled",
                        "cancel_requested",
                    )
                    raise QueueJobCanceledError()

                article = self.repository.load_frozen_article(item)
                if article is None:
                    self.repository.increment_count(run_id, "skippedCount")
                    continue

                prompt = self.repository.get_prompt_for_article(
                    article.article_id,
                    run["activePromptVersionId"],
                )
                outcome = self.client.evaluate(
                    render_prompt(prompt["promptInMarkdown"], article)
                )
                self.repository.persist_outcome(
                    run_id=run_id,
                    prompt_version_id=prompt["id"],
                    article=article,
                    model_name=run["modelName"],
                    outcome=outcome,
                )
                self.repository.increment_count(run_id, "attemptedCount")

                if outcome.status == "completed":
                    self.repository.increment_count(run_id, "completedCount")
                    cli_failures = 0
                    invalid_responses = 0
                elif outcome.status == "failed":
                    self.repository.increment_count(run_id, "failedCount")
                    cli_failures += 1
                else:
                    self.repository.increment_count(
                        run_id,
                        "invalidResponseCount",
                    )
                    invalid_responses += 1

                if cli_failures >= 3:
                    self.repository.finish_run(
                        run_id,
                        "circuit_breaker",
                        "codex_cli_failures",
                    )
                    return {"runId": run_id, "status": "circuit_breaker"}
                if invalid_responses >= 5:
                    self.repository.finish_run(
                        run_id,
                        "circuit_breaker",
                        "invalid_responses",
                    )
                    return {"runId": run_id, "status": "circuit_breaker"}

            self.repository.finish_run(run_id, "completed", None)
            return {"runId": run_id, "status": "completed"}
        except QueueJobCanceledError:
            raise
        except Exception:
            self.repository.finish_run(run_id, "failed", "execution_failed")
            raise
