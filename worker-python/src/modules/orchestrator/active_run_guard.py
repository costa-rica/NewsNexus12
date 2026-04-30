"""Active orchestrator run guard for worker-python.

Queries Postgres for a running OrchestratorRun and caches the result for 2s
to avoid hammering the DB on bursty automation traffic.
"""
from __future__ import annotations

import os
import time
from typing import Optional

import psycopg
from loguru import logger

_CACHE_TTL_S = 2.0


class _Cache:
    run_id: Optional[int]
    fetched_at: float

    def __init__(self, run_id: Optional[int]) -> None:
        self.run_id = run_id
        self.fetched_at = time.monotonic()


_cache: Optional[_Cache] = None


def _get_dsn() -> str:
    pg_host = os.getenv("PG_HOST", "localhost")
    pg_port = os.getenv("PG_PORT", "5432")
    pg_database = os.getenv("PG_DATABASE", "")
    pg_user = os.getenv("PG_USER", "")
    pg_password = os.getenv("PG_PASSWORD", "")
    return (
        f"host={pg_host} port={pg_port} dbname={pg_database} "
        f"user={pg_user} password={pg_password}"
    )


def get_active_orchestrator_run_id() -> Optional[int]:
    global _cache

    now = time.monotonic()
    if _cache is not None and (now - _cache.fetched_at) < _CACHE_TTL_S:
        return _cache.run_id

    try:
        with psycopg.connect(_get_dsn()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT id FROM "OrchestratorRuns" WHERE status = %s LIMIT 1',
                    ('running',),
                )
                row = cur.fetchone()
                run_id: Optional[int] = row[0] if row else None

        _cache = _Cache(run_id)
        return run_id
    except Exception as exc:
        logger.warning(
            "event=active_run_guard_query_failed error={}", exc
        )
        return None


def invalidate_cache() -> None:
    global _cache
    _cache = None
