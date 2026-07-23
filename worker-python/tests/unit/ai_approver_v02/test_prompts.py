from src.modules.ai_approver_v02.prompts import PIPELINE_VERSION, render_prompt
from src.modules.ai_approver_v02.types import ArticleInput


def test_renderer_keeps_operator_prompt_and_hardcoded_contract() -> None:
    rendered = render_prompt(
        "Apply the operator policy.",
        ArticleInput(
            article_id=1,
            title="A title",
            content="Article text",
            content_source="article_contents_02",
            article_contents_02_id=2,
        ),
    )

    assert rendered.startswith("Apply the operator policy.")
    assert "A title" in rendered
    assert "Article text" in rendered
    assert '"decision":"approved|irrelevant"' in rendered
    assert PIPELINE_VERSION == "ai-approver-v02-pipeline-1"
