"""FastAPI middleware that blocks start-job requests while an orchestrator run is active."""
from __future__ import annotations

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware

from src.modules.orchestrator.active_run_guard import get_active_orchestrator_run_id


class OrchestratorLockMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: object) -> Response:
        if not request.url.path.endswith("/start-job"):
            return await call_next(request)  # type: ignore[arg-type]

        active_run_id = get_active_orchestrator_run_id()

        if active_run_id is None:
            return await call_next(request)  # type: ignore[arg-type]

        header_run_id = request.headers.get("x-orchestrator-run-id")
        if header_run_id is not None and header_run_id == str(active_run_id):
            return await call_next(request)  # type: ignore[arg-type]

        logger.info(
            "event=orchestrator_lock_blocked path={} orchestrator_run_id={}",
            request.url.path,
            active_run_id,
        )

        return JSONResponse(
            status_code=423,
            content={
                "orchestratorRunId": active_run_id,
                "message": (
                    f"An orchestrator run (id: {active_run_id}) is currently in progress. "
                    "External start-job requests are blocked until the run completes."
                ),
            },
        )
