"""Hardcoded V02 prompt wrapper and response contract."""

from __future__ import annotations

from src.modules.ai_approver_v02.types import ArticleInput


# Increment whenever ARTICLE_WRAPPER or RESPONSE_INSTRUCTION changes.
PIPELINE_VERSION = "ai-approver-v02-pipeline-1"

ARTICLE_WRAPPER = """
Evaluate the following news article using the operator instructions above.

Article title:
<article-title>
{title}
</article-title>

Article content:
<article-content>
{content}
</article-content>
""".strip()

RESPONSE_INSTRUCTION = """
Return only one JSON object with exactly these keys:
{"decision":"approved|irrelevant","reason":"one nonblank explanation"}
Do not add markdown, commentary, or any other keys.
""".strip()


def render_prompt(operator_prompt: str, article: ArticleInput) -> str:
    return "\n\n".join(
        [
            operator_prompt.strip(),
            ARTICLE_WRAPPER.format(title=article.title, content=article.content),
            RESPONSE_INSTRUCTION,
        ]
    )
