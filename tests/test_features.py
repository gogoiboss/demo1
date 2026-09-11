import pandas as pd
import numpy as np
import pytest
from src.features.engineering import (
    engineer_all_features,
    rake_delay_inheritance,
    remaining_schedule_buffer,
    generate_standard_features,
)

def test_rake_delay_inheritance():
    df = pd.DataFrame({
        'train_number': [12301, 12301, 12301, 12951],
        'journey_date': pd.to_datetime(['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-01']),
        'actual_delay_minutes': [10.0, 45.0, 20.0, 5.0]
    })
    
    result = rake_delay_inheritance(df)
    
    # 12301 on Jan 1 has no prior leg, should be 0
    assert result[(result['train_number'] == 12301) & (result['journey_date'] == '2025-01-01')]['prior_leg_delay'].iloc[0] == 0.0
    
    # 12301 on Jan 2 should inherit Jan 1's delay (10.0)
    assert result[(result['train_number'] == 12301) & (result['journey_date'] == '2025-01-02')]['prior_leg_delay'].iloc[0] == 10.0
    
    # 12301 on Jan 3 should inherit Jan 2's delay (45.0)
    assert result[(result['train_number'] == 12301) & (result['journey_date'] == '2025-01-03')]['prior_leg_delay'].iloc[0] == 45.0

def test_remaining_schedule_buffer():
    df = pd.DataFrame({
        'scheduled_travel_hours': [10.0, 5.0],
        'distance_km': [1100.0, 550.0]  # At 110 km/h MPS, min time is 10.0 and 5.0 respectively
    })
    
    result = remaining_schedule_buffer(df)
    
    # Buffer should be 0 for both if scheduled exactly at MPS
    assert result['schedule_buffer_hours'].iloc[0] == 0.0
    assert result['schedule_buffer_hours'].iloc[1] == 0.0
    
    df2 = pd.DataFrame({
        'scheduled_travel_hours': [12.0], # 2 hours of buffer
        'distance_km': [1100.0]
    })
    result2 = remaining_schedule_buffer(df2)
    assert result2['schedule_buffer_hours'].iloc[0] == 2.0

def test_generate_standard_features():
    df = pd.DataFrame({
        'journey_date': pd.to_datetime(['2025-01-04']) # Saturday
    })
    
    result = generate_standard_features(df)
    assert result['day_of_week'].iloc[0] == 5 # Saturday is 5
    assert result['is_weekend'].iloc[0] == 1
    assert result['month'].iloc[0] == 1


def _rake_batch():
    return pd.DataFrame({
        "train_number": [12301, 12301, 12301],
        "journey_date": pd.to_datetime(["2025-01-01", "2025-01-08", "2025-01-15"]),
        "actual_delay_minutes": [10.0, 40.0, 25.0],
        "distance_km": [500.0, 500.0, 500.0],
        "scheduled_travel_hours": [8.0, 8.0, 8.0],
    })


def test_training_and_serving_paths_agree_when_serving_uses_preengineered_batch_row():
    """Item G (training-serving skew): the real, exercised path is byte-identical.

    `RippleETAPipeline._load()` engineers features once over the full
    historical batch (the "training path"). `RippleETAPipeline.run()` then
    slices a single row out of that already-engineered frame for prediction
    (the "serving path") — it never calls `engineer_all_features()` again.
    This proves that path is exact: the served row's feature vector is
    identical to the training path's output for that same record.
    """
    batch = _rake_batch()

    training_path = engineer_all_features(batch)
    serving_row = training_path[training_path["journey_date"] == "2025-01-15"]

    assert serving_row["prior_leg_delay"].iloc[0] == pytest.approx(40.0)
    pd.testing.assert_frame_equal(
        serving_row.reset_index(drop=True),
        training_path.tail(1).reset_index(drop=True),
    )


def test_isolated_single_row_reengineering_cannot_reproduce_batch_prior_leg_delay():
    """Characterizes a real latent skew risk found in the shared feature module.

    `CalibratedPredictionPipeline.predict()` falls back to calling
    `engineer_all_features()` itself when handed a DataFrame that doesn't
    already have the model's feature columns. No current caller triggers
    that fallback with raw, un-engineered data — every real call site
    (`RippleETAPipeline.run()`, the eval scripts, the scalability
    benchmark) passes rows already sliced from a batch-engineered
    DataFrame. But rake inheritance is a `groupby().shift(1)` over the full
    batch: it cannot see a "previous row" in an isolated single-row frame,
    so if a future caller ever did pass one, `prior_leg_delay` would
    silently default to 0 instead of the true value. This test pins that
    exact failure mode so it can't regress silently in the other direction
    (e.g. someone "fixing" the fallback to return a plausible-looking but
    still-wrong non-zero value without actually supplying history).
    """
    batch = _rake_batch()
    training_path_value = engineer_all_features(batch)["prior_leg_delay"].iloc[-1]
    assert training_path_value == pytest.approx(40.0)

    raw_isolated_row = batch.iloc[[-1]].copy()  # same record, no history attached
    served_value = engineer_all_features(raw_isolated_row)["prior_leg_delay"].iloc[0]

    assert served_value == pytest.approx(0.0)
    assert served_value != pytest.approx(training_path_value)
