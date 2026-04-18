from __future__ import annotations

import os
from typing import Iterable

import psycopg


def get_test_dsn() -> str:
    return (
        f"host={os.getenv('PG_HOST', 'localhost')} "
        f"port={os.getenv('PG_PORT', '5432')} "
        f"dbname={os.getenv('PG_DATABASE', 'newsnexus_test_worker_python')} "
        f"user={os.getenv('PG_USER', 'nick')} "
        f"password={os.getenv('PG_PASSWORD', '')}"
    )


def reset_public_schema() -> None:
    with psycopg.connect(get_test_dsn(), autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("DROP SCHEMA IF EXISTS public CASCADE")
            cursor.execute("CREATE SCHEMA IF NOT EXISTS public")
            cursor.execute("SET search_path TO public")


def execute_statements(statements: Iterable[str]) -> None:
    with psycopg.connect(get_test_dsn(), autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET search_path TO public")
            for statement in statements:
                normalized = statement.replace('CREATE TABLE "', 'CREATE TABLE public."')
                normalized = normalized.replace(
                    'CREATE UNIQUE INDEX "',
                    'CREATE UNIQUE INDEX "',
                ).replace(' ON "', ' ON public."')
                normalized = normalized.replace(
                    'CREATE INDEX "',
                    'CREATE INDEX "',
                ).replace(' ON "', ' ON public."')
                cursor.execute(normalized)


def execute_many(statement: str, rows: list[tuple]) -> None:
    with psycopg.connect(get_test_dsn()) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET search_path TO public")
            cursor.executemany(statement, rows)
        conn.commit()
