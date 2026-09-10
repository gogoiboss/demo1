"""Lightweight schema and range validation for prediction inputs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd


class DataValidationError(ValueError):
    """Raised when an input dataset is unsafe to send to feature engineering."""


REQUIRED_COLUMNS = {
    "train_number",
    "journey_date",
    "scheduled_travel_hours",
    "distance_km",
    "actual_delay_minutes",
}


@dataclass(frozen=True)
class ValidationSummary:
    rows: int
    columns: int
    checked_ranges: tuple[str, ...]


def validate_input_frame(
    frame: pd.DataFrame,
    *,
    min_rows: int = 100,
    max_missing_fraction: float = 0.05,
    ranges: dict[str, list[float]] | None = None,
) -> ValidationSummary:
    """Validate the minimum contract required by the real pipeline."""
    missing = sorted(REQUIRED_COLUMNS.difference(frame.columns))
    if missing:
        raise DataValidationError(f"Missing required columns: {', '.join(missing)}")
    if len(frame) < min_rows:
        raise DataValidationError(f"Expected at least {min_rows} rows; found {len(frame)}.")

    missing_fraction = frame[list(REQUIRED_COLUMNS)].isna().mean()
    bad_missing = missing_fraction[missing_fraction > max_missing_fraction]
    if not bad_missing.empty:
        details = ", ".join(f"{name}={value:.1%}" for name, value in bad_missing.items())
        raise DataValidationError(f"Missing-value fraction exceeds limit: {details}")

    checked_ranges: list[str] = []
    for column, bounds in (ranges or {}).items():
        if column not in frame.columns:
            continue
        lower, upper = bounds
        values = pd.to_numeric(frame[column], errors="coerce")
        if values.isna().any():
            raise DataValidationError(f"Column {column!r} contains non-numeric values.")
        if ((values < lower) | (values > upper)).any():
            raise DataValidationError(
                f"Column {column!r} must stay within [{lower}, {upper}]."
            )
        checked_ranges.append(column)

    return ValidationSummary(len(frame), len(frame.columns), tuple(checked_ranges))