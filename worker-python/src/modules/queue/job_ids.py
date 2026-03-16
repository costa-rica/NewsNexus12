from __future__ import annotations

from collections.abc import Iterable


JOB_ID_MIN_WIDTH = 4


def format_job_id(sequence_number: int) -> str:
    if sequence_number <= 0:
        raise ValueError("sequence_number must be greater than 0")

    return str(sequence_number).zfill(JOB_ID_MIN_WIDTH)


def parse_job_id(job_id: str) -> int:
    normalized_job_id = job_id.strip()
    if normalized_job_id == "":
        raise ValueError("job_id is required")
    if not normalized_job_id.isdigit():
        raise ValueError("job_id must contain only digits")

    parsed = int(normalized_job_id)
    if parsed <= 0:
        raise ValueError("job_id must be greater than 0")

    return parsed


def get_next_job_id(existing_job_ids: Iterable[str]) -> str:
    highest_sequence = 0
    for existing_job_id in existing_job_ids:
        highest_sequence = max(highest_sequence, parse_job_id(existing_job_id))

    return format_job_id(highest_sequence + 1)
