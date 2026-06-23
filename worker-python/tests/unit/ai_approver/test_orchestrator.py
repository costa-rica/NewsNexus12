from __future__ import annotations

from src.modules.ai_approver.orchestrator import AiApproverOrchestrator


class FakeRepository:
    def __init__(
        self,
        article=None,
        prompt_version=None,
        *,
        category_prompt_versions=None,
        gatekeeper_prompt_version=None,
        eligible_articles=None,
        retry_rows=None,
        existing_results=None,
    ) -> None:
        self.article = article
        self.prompt_version = prompt_version
        self.insert_calls: list[dict[str, object | None]] = []
        self.update_calls: list[dict[str, object | None]] = []
        self.category_prompt_versions = category_prompt_versions or []
        self.gatekeeper_prompt_version = gatekeeper_prompt_version
        self.eligible_articles = eligible_articles or []
        self.retry_rows = retry_rows or []
        self.existing_results = existing_results or {}

    def get_prompt_version_by_id(self, prompt_version_id: int):
        if self.prompt_version is None:
            return None
        return {**self.prompt_version, "id": prompt_version_id}

    def get_article_for_prompt_run(self, article_id: int):
        if self.article is None:
            return None
        return {**self.article, "id": article_id}

    def insert_score_row(self, **kwargs) -> None:
        self.insert_calls.append(kwargs)

    def update_score_row(self, **kwargs) -> None:
        self.update_calls.append(kwargs)

    def get_active_category_prompt_versions(self):
        return self.category_prompt_versions

    def get_active_gatekeeper_prompt_version(self):
        return self.gatekeeper_prompt_version

    def get_eligible_articles(self, **kwargs):
        return list(self.eligible_articles)

    def get_retryable_score_rows(self, **kwargs):
        return list(self.retry_rows)

    def get_score_result(self, *, article_id: int, prompt_version_id: int):
        return self.existing_results.get((article_id, prompt_version_id))


class FakeClient:
    def __init__(self, response=None, error: Exception | None = None) -> None:
        self.response = response or {}
        self.error = error
        self.prompts: list[str] = []

    def score_article(self, prompt: str):
        self.prompts.append(prompt)
        if self.error is not None:
            raise self.error
        return self.response


def test_run_single_score_inserts_completed_row() -> None:
    repository = FakeRepository(
        article={"title": "Article title", "content": "Article content", "contentSource": "article-contents-02"},
        prompt_version={"promptInMarkdown": "Title: {articleTitle}\nContent: {articleContent}"},
    )
    client = FakeClient(
        response={
            "payload": {
                "score": 0.87,
                "reason": "Looks relevant",
            },
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 5,
                "total_tokens": 16,
            },
        }
    )

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_single_score(
        article_id=77,
        prompt_version_id=9,
        job_id="job-1",
        should_cancel=lambda: False,
    )

    assert summary == {
        "promptCount": 1,
        "articleCount": 1,
        "attemptCount": 1,
        "usage": {
            "prompt_tokens": 11,
            "completion_tokens": 5,
            "total_tokens": 16,
        },
        "contentSource": "article-contents-02",
    }
    assert repository.insert_calls == [
        {
            "article_id": 77,
            "prompt_version_id": 9,
            "result_status": "completed",
            "score": 0.87,
            "reason": "Looks relevant",
            "error_code": None,
            "error_message": None,
            "job_id": "job-1",
            "prompt_role": "category_score",
            "pipeline_version": None,
            "decision": None,
            "confidence": None,
            "reason_code": None,
            "metadata": None,
        }
    ]


def test_run_single_score_inserts_invalid_response_row() -> None:
    repository = FakeRepository(
        article={"title": "Article title", "content": "Article content", "contentSource": "article-description"},
        prompt_version={"promptInMarkdown": "Content: {articleContent}"},
    )
    client = FakeClient(
        response={
            "payload": {
                "reason": "",
                "errorCode": "bad_payload",
                "errorMessage": "Missing score",
            },
            "usage": {
                "prompt_tokens": 3,
                "completion_tokens": 2,
                "total_tokens": 5,
            },
        }
    )

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_single_score(
        article_id=88,
        prompt_version_id=10,
        job_id="job-2",
        should_cancel=lambda: False,
    )

    assert summary["contentSource"] == "article-description"
    assert repository.insert_calls == [
        {
            "article_id": 88,
            "prompt_version_id": 10,
            "result_status": "invalid_response",
            "score": None,
            "reason": None,
            "error_code": "bad_payload",
            "error_message": "Missing score",
            "job_id": "job-2",
            "prompt_role": "category_score",
            "pipeline_version": None,
            "decision": None,
            "confidence": None,
            "reason_code": None,
            "metadata": None,
        }
    ]


def test_run_single_score_inserts_failed_row_on_client_error() -> None:
    repository = FakeRepository(
        article={"title": "Article title", "content": "Article content", "contentSource": "article-contents-02"},
        prompt_version={"promptInMarkdown": "Content: {articleContent}"},
    )
    client = FakeClient(error=RuntimeError("OpenAI failure"))

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_single_score(
        article_id=99,
        prompt_version_id=12,
        job_id="job-3",
        should_cancel=lambda: False,
    )

    assert summary["usage"] == {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }
    assert repository.insert_calls == [
        {
            "article_id": 99,
            "prompt_version_id": 12,
            "result_status": "failed",
            "score": None,
            "reason": None,
            "error_code": "execution_failed",
            "error_message": "OpenAI failure",
            "job_id": "job-3",
            "prompt_role": "category_score",
            "pipeline_version": None,
            "decision": None,
            "confidence": None,
            "reason_code": None,
            "metadata": None,
        }
    ]


def test_run_single_score_inserts_gatekeeper_result() -> None:
    repository = FakeRepository(
        article={
            "title": "Article title",
            "content": "Article content",
            "contentSource": "article-contents-02",
        },
        prompt_version={
            "promptInMarkdown": "Content: {articleContent}",
            "promptRole": "gatekeeper",
            "pipelineVersion": "ai_approver_gatekeeper_v1",
        },
    )
    client = FakeClient(
        response={
            "payload": {
                "decision": "reject",
                "confidence": 0.95,
                "reasonCode": "advertisement",
                "reason": "Article is a shopping guide with no safety incident.",
                "signals": {"likelyAdvertisement": True},
            },
            "usage": {
                "prompt_tokens": 8,
                "completion_tokens": 6,
                "total_tokens": 14,
            },
        }
    )

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_single_score(
        article_id=100,
        prompt_version_id=13,
        job_id="job-4",
        should_cancel=lambda: False,
    )

    assert summary["usage"]["total_tokens"] == 14
    assert repository.insert_calls == [
        {
            "article_id": 100,
            "prompt_version_id": 13,
            "result_status": "completed",
            "score": None,
            "reason": "Article is a shopping guide with no safety incident.",
            "error_code": None,
            "error_message": None,
            "job_id": "job-4",
            "prompt_role": "gatekeeper",
            "pipeline_version": "ai_approver_gatekeeper_v1",
            "decision": "reject",
            "confidence": 0.95,
            "reason_code": "advertisement",
            "metadata": {
                "rawDecision": "reject",
                "rejectConfidenceThreshold": 0.85,
                "signals": {"likelyAdvertisement": True},
            },
        }
    ]


def test_run_score_updates_selected_retryable_gatekeeper_row_with_audit_metadata() -> None:
    retry_row = {
        "scoreRowId": 501,
        "articleId": 77,
        "promptVersionId": 13,
        "previousResultStatus": "failed",
        "previousErrorCode": "timeout",
        "previousErrorMessage": "request timed out",
        "previousJobId": "source-job",
        "previousMetadata": {"source": True},
        "title": "Retry title",
        "content": "Retry content",
    }
    repository = FakeRepository(
        category_prompt_versions=[],
        gatekeeper_prompt_version={
            "id": 13,
            "promptInMarkdown": "Content: {articleContent}",
            "promptRole": "gatekeeper",
            "pipelineVersion": "ai_approver_gatekeeper_v1",
        },
        retry_rows=[retry_row],
        existing_results={
            (77, 13): {
                "resultStatus": "failed",
                "decision": "error",
            }
        },
    )
    client = FakeClient(
        response={
            "payload": {
                "decision": "pass",
                "confidence": 0.94,
                "reasonCode": "safety_incident",
                "reason": "Article reports a safety incident.",
            }
        }
    )

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_score(
        limit=10,
        require_state_assignment=True,
        state_ids=None,
        job_id="continuation-job",
        should_cancel=lambda: False,
        mode="gatekeeper",
        continuation_retry_policy={
            "mode": "gatekeeper",
            "retryTransientFailures": True,
            "retryInvalidResponses": False,
        },
    )

    assert summary["gatekeeperAttemptCount"] == 1
    assert repository.insert_calls == []
    assert len(repository.update_calls) == 1
    update = repository.update_calls[0]
    assert update["score_row_id"] == 501
    assert update["result_status"] == "completed"
    assert update["job_id"] == "continuation-job"
    assert update["decision"] == "pass"
    audit = update["metadata"]["continuationRetryAudit"]
    assert audit["previousStatus"] == "failed"
    assert audit["previousErrorCode"] == "timeout"
    assert audit["previousErrorMessage"] == "request timed out"
    assert audit["sourceJobId"] == "source-job"
    assert audit["continuationJobId"] == "continuation-job"
    assert audit["previousMetadata"] == {"source": True}
    assert "retriedAt" in audit


def test_run_score_skips_completed_existing_category_rows_without_retry_selection() -> None:
    repository = FakeRepository(
        category_prompt_versions=[
            {
                "id": 9,
                "promptInMarkdown": "Content: {articleContent}",
                "promptRole": "category_score",
            }
        ],
        eligible_articles=[{"id": 77, "title": "Title", "content": "Content"}],
        existing_results={(77, 9): {"resultStatus": "completed", "score": 0.8}},
    )
    client = FakeClient(response={"payload": {"score": 0.9, "reason": "Relevant"}})

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_score(
        limit=10,
        require_state_assignment=True,
        state_ids=None,
        job_id="job-1",
        should_cancel=lambda: False,
        mode="legacy",
    )

    assert summary["categoryAttemptCount"] == 0
    assert client.prompts == []
    assert repository.insert_calls == []
    assert repository.update_calls == []


def test_run_score_processes_missing_category_after_completed_gatekeeper_pass() -> None:
    repository = FakeRepository(
        category_prompt_versions=[
            {
                "id": 9,
                "promptInMarkdown": "Content: {articleContent}",
                "promptRole": "category_score",
            }
        ],
        gatekeeper_prompt_version={
            "id": 13,
            "promptInMarkdown": "Gatekeeper: {articleContent}",
            "promptRole": "gatekeeper",
        },
        eligible_articles=[{"id": 77, "title": "Title", "content": "Content"}],
        existing_results={
            (77, 13): {
                "resultStatus": "completed",
                "decision": "pass",
            }
        },
    )
    client = FakeClient(response={"payload": {"score": 0.9, "reason": "Relevant"}})

    orchestrator = AiApproverOrchestrator(repository, client)
    summary = orchestrator.run_score(
        limit=10,
        require_state_assignment=True,
        state_ids=None,
        job_id="job-1",
        should_cancel=lambda: False,
        mode="gatekeeper",
    )

    assert summary["categoryAttemptCount"] == 1
    assert repository.insert_calls == [
        {
            "article_id": 77,
            "prompt_version_id": 9,
            "result_status": "completed",
            "score": 0.9,
            "reason": "Relevant",
            "error_code": None,
            "error_message": None,
            "job_id": "job-1",
            "prompt_role": "category_score",
            "pipeline_version": None,
            "decision": None,
            "confidence": None,
            "reason_code": None,
            "metadata": None,
        }
    ]
