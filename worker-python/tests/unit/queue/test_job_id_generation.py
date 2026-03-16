from __future__ import annotations

import pytest

from src.modules.queue.job_ids import format_job_id, get_next_job_id, parse_job_id


@pytest.mark.unit
def test_format_job_id_zero_pads_to_four_digits() -> None:
    assert format_job_id(1) == "0001"
    assert format_job_id(17) == "0017"
    assert format_job_id(9999) == "9999"


@pytest.mark.unit
def test_format_job_id_expands_beyond_four_digits_without_rollover() -> None:
    assert format_job_id(10000) == "10000"


@pytest.mark.unit
def test_get_next_job_id_uses_highest_existing_value() -> None:
    next_job_id = get_next_job_id(["0001", "0002", "0147"])

    assert next_job_id == "0148"


@pytest.mark.unit
def test_get_next_job_id_expands_beyond_four_digits() -> None:
    next_job_id = get_next_job_id(["9998", "9999"])

    assert next_job_id == "10000"


@pytest.mark.unit
def test_get_next_job_id_starts_at_one_when_store_is_empty() -> None:
    assert get_next_job_id([]) == "0001"


@pytest.mark.unit
def test_parse_job_id_rejects_blank_or_non_numeric_values() -> None:
    with pytest.raises(ValueError, match="job_id is required"):
        parse_job_id("   ")

    with pytest.raises(ValueError, match="job_id must contain only digits"):
        parse_job_id("abc1")


@pytest.mark.unit
def test_format_job_id_rejects_non_positive_values() -> None:
    with pytest.raises(ValueError, match="sequence_number must be greater than 0"):
        format_job_id(0)
