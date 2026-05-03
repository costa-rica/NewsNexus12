from __future__ import annotations

import argparse
from pathlib import Path
import sys

from dotenv import load_dotenv
import os
import psycopg


BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Insert a one-time AI approver prompt row into AiApproverPromptVersions."
    )
    parser.add_argument(
        "--prompt-file",
        default=str(BASE_DIR / "docs" / "PROMPT_RESIDENTIAL_FIRE.md"),
        help="Path to the markdown prompt file.",
    )
    parser.add_argument(
        "--name",
        default="Residential Fire",
        help="Display name for the prompt version row.",
    )
    parser.add_argument(
        "--description",
        default="Initial AI approver prompt for residential fire article scoring.",
        help="Optional description for the prompt version row.",
    )
    parser.add_argument(
        "--active",
        action="store_true",
        help="Mark the inserted prompt row as active.",
    )
    parser.add_argument("--prompt-role", default="category_score")
    parser.add_argument("--prompt-key", default=None)
    parser.add_argument("--pipeline-version", default=None)
    parser.add_argument("--response-schema-version", default=None)
    parser.add_argument("--model-name", default=None)
    parser.add_argument(
        "--confirm-activate-gatekeeper",
        action="store_true",
        help="Required with --active when --prompt-role=gatekeeper.",
    )
    return parser.parse_args()


def _resolve_dsn() -> str:
    pg_host = os.getenv("PG_HOST", "").strip()
    pg_port = os.getenv("PG_PORT", "").strip()
    pg_database = os.getenv("PG_DATABASE", "").strip()
    pg_user = os.getenv("PG_USER", "").strip()

    if not pg_host:
        raise RuntimeError("PG_HOST is required")
    if not pg_port:
        raise RuntimeError("PG_PORT is required")
    if not pg_database:
        raise RuntimeError("PG_DATABASE is required")
    if not pg_user:
        raise RuntimeError("PG_USER is required")
    return (
        f"host={pg_host} "
        f"port={pg_port} "
        f"dbname={pg_database} "
        f"user={pg_user} "
        f"password={os.getenv('PG_PASSWORD', '').strip()}"
    )


def _read_prompt_file(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")

    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise ValueError(f"Prompt file is empty: {path}")
    return content


def _ensure_table_exists(conn: psycopg.Connection) -> None:
    exists = conn.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'AiApproverPromptVersions'
        """
    ).fetchone()
    if not exists:
        raise RuntimeError(
            "AiApproverPromptVersions table does not exist. Initialize the latest db-models schema first."
        )


def _insert_prompt(
    conn: psycopg.Connection,
    *,
    name: str,
    description: str,
    prompt_in_markdown: str,
    is_active: bool,
    prompt_role: str,
    prompt_key: str | None,
    pipeline_version: str | None,
    response_schema_version: str | None,
    model_name: str | None,
) -> int:
    existing = None
    if prompt_key and pipeline_version:
        existing = conn.execute(
            """
            SELECT id
            FROM "AiApproverPromptVersions"
            WHERE "promptKey" = %s
              AND "pipelineVersion" = %s
            ORDER BY id ASC
            LIMIT 1
            """,
            (prompt_key, pipeline_version),
        ).fetchone()
    if existing is not None:
        return int(existing[0])

    cursor = conn.execute(
        """
        INSERT INTO "AiApproverPromptVersions" (
            "name",
            "description",
            "promptInMarkdown",
            "isActive",
            "endedAt",
            "promptRole",
            "promptKey",
            "pipelineVersion",
            "responseSchemaVersion",
            "modelName",
            "createdAt",
            "updatedAt"
        )
        VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
        """,
        (
            name,
            description or None,
            prompt_in_markdown,
            is_active,
            prompt_role,
            prompt_key,
            pipeline_version,
            response_schema_version,
            model_name,
        ),
    )
    conn.commit()
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Prompt insert did not return an id")
    return int(row[0])


def main() -> int:
    args = _parse_args()
    prompt_role = args.prompt_role.strip() or "category_score"
    if prompt_role not in {"category_score", "legacy_category_score", "gatekeeper"}:
        raise ValueError("prompt-role must be category_score, legacy_category_score, or gatekeeper")
    if prompt_role == "gatekeeper" and args.active and not args.confirm_activate_gatekeeper:
        raise ValueError(
            "Gatekeeper prompt seeding is inactive by default. Use --active with --confirm-activate-gatekeeper only after approval."
        )

    dsn = _resolve_dsn()
    prompt_path = Path(args.prompt_file).expanduser()
    prompt = _read_prompt_file(prompt_path)

    conn = psycopg.connect(dsn)
    try:
        _ensure_table_exists(conn)
        row_id = _insert_prompt(
            conn,
            name=args.name.strip(),
            description=args.description.strip(),
            prompt_in_markdown=prompt,
            is_active=bool(args.active),
            prompt_role=prompt_role,
            prompt_key=args.prompt_key.strip() if args.prompt_key else None,
            pipeline_version=args.pipeline_version.strip() if args.pipeline_version else None,
            response_schema_version=args.response_schema_version.strip()
            if args.response_schema_version
            else None,
            model_name=args.model_name.strip() if args.model_name else None,
        )
    finally:
        conn.close()

    print(
        f"Ensured AiApproverPromptVersions row id={row_id} name={args.name!r} role={prompt_role!r} active={bool(args.active)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
