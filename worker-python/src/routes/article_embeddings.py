from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from src.modules.article_embeddings import EmbeddingSyncMode
from src.services.job_manager import job_manager

router = APIRouter(prefix="/article-embeddings", tags=["article-embeddings"])


class ArticleEmbeddingsJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: EmbeddingSyncMode = EmbeddingSyncMode.INCREMENTAL


@router.post("/jobs", status_code=201)
def create_article_embeddings_job(body: ArticleEmbeddingsJobRequest | None = None):
    request = body or ArticleEmbeddingsJobRequest()
    return job_manager.enqueue_article_embeddings_job(mode=request.mode)
