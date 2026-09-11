"""Tests for the fail-closed input validation gate."""

import pandas as pd
import pytest

from src.validation import DataValidationError, validate_input_frame


def test_validation_rejects_missing_required_columns():
    frame = pd.DataFrame({"train_number": [20507]})

    with pytest.raises(DataValidationError, match="Missing required columns"):
        validate_input_frame(frame, min_rows=1)


def test_validation_rejects_implausible_delay():
    frame = pd.DataFrame(
        {
            "train_number": [20507],
            "journey_date": ["2025-01-01"],
            "scheduled_travel_hours": [10.0],
            "distance_km": [500.0],
            "actual_delay_minutes": [2000.0],
        }
    )

    with pytest.raises(DataValidationError, match="actual_delay_minutes"):
        validate_input_frame(
            frame,
            min_rows=1,
            ranges={"actual_delay_minutes": [0, 1440]},
        )
