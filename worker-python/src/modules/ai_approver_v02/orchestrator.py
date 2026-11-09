"""Frozen-selection execution for AI Approver V02."""

from __future__ import annotations

from collections.abc import Callable

from loguru import logger

from src.modules.ai_approver_v02.client import AiApproverV02CodexClient
from src.modules.ai_approver_v02.prompts import render_prompt
from src.modules.ai_approver_v02.repository import AiApproverV02Repository
from src.modules.queue.engine import QueueJobCanceledError

# Each count resets only after a completed evaluation. A failure of one type does
# not reset the other type's count.
MAX_CLI_FAILURES_SINCE_SUCCESS = 3
MAX_INVALID_RESPONSES_SINCE_SUCCESS = 3


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

                if outcome.status != "completed":
                    logger.warning(
                        "AI Approver V02 article evaluation {}: run={} article={} "
                        "prompt={} error_code={} error_message={}",
                        outcome.status,
                        run_id,
                        article.article_id,
                        prompt["id"],
                        outcome.error_code,
                        outcome.error_message,
                    )

                ending_reason = None
                if cli_failures >= MAX_CLI_FAILURES_SINCE_SUCCESS:
                    ending_reason = "codex_cli_failures"
                elif invalid_responses >= MAX_INVALID_RESPONSES_SINCE_SUCCESS:
                    ending_reason = "invalid_responses"
                if ending_reason is not None:
                    logger.error(
                        "AI Approver V02 circuit breaker tripped: run={} reason={} "
                        "article={} prompt={} error_message={}",
                        run_id,
                        ending_reason,
                        article.article_id,
                        prompt["id"],
                        outcome.error_message,
                    )
                    self.repository.finish_run(
                        run_id,
                        "circuit_breaker",
                        ending_reason,
                    )
                    return {"runId": run_id, "status": "circuit_breaker"}

            self.repository.finish_run(run_id, "completed", None)
            return {"runId": run_id, "status": "completed"}
        except QueueJobCanceledError:
            raise
        except Exception:
            self.repository.finish_run(run_id, "failed", "execution_failed")
            raise
