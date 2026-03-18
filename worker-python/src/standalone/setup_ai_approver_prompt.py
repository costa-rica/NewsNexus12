from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path
import sys

from dotenv import load_dotenv
import os


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
    return parser.parse_args()


def _resolve_database_path() -> Path:
    path_database = os.getenv("PATH_DATABASE", "").strip()
    name_db = os.getenv("NAME_DB", "").strip()

    if not path_database:
        raise RuntimeError("PATH_DATABASE is required")
    if not name_db:
        raise RuntimeError("NAME_DB is required")

    return Path(path_database).expanduser() / name_db


def _read_prompt_file(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")

    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise ValueError(f"Prompt file is empty: {path}")
    return content


def _ensure_table_exists(conn: sqlite3.Connection) -> None:
    exists = conn.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'AiApproverPromptVersions'
        """
    ).fetchone()
    if not exists:
        raise RuntimeError(
            "AiApproverPromptVersions table does not exist. Initialize the latest db-models schema first."
        )


def _insert_prompt(
    conn: sqlite3.Connection,
    *,
    name: str,
    description: str,
    prompt_in_markdown: str,
    is_active: bool,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO AiApproverPromptVersions (
            name,
            description,
            promptInMarkdown,
            isActive,
            endedAt,
            createdAt,
            updatedAt
        )
        VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
        """,
        (name, description or None, prompt_in_markdown, 1 if is_active else 0),
    )
    conn.commit()
    return int(cursor.lastrowid)


def main() -> int:
    args = _parse_args()
    db_path = _resolve_database_path()
    prompt_path = Path(args.prompt_file).expanduser()
    prompt = _read_prompt_file(prompt_path)

    conn = sqlite3.connect(str(db_path))
    try:
        _ensure_table_exists(conn)
        row_id = _insert_prompt(
            conn,
            name=args.name.strip(),
            description=args.description.strip(),
            prompt_in_markdown=prompt,
            is_active=bool(args.active),
        )
    finally:
        conn.close()

    print(
        f"Inserted AiApproverPromptVersions row id={row_id} name={args.name!r} active={bool(args.active)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
