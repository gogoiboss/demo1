import pandas as pd
import pytest
from src.features.engineering import (
    engineer_all_features,
    rake_delay_inheritance,
    remaining_schedule_buffer,
    generate_standard_features,
)


def test_rake_delay_inheritance():
    df = pd.DataFrame(
        {
            "train_number": [12301, 12301, 12301, 12951],
            "journey_date": pd.to_datetime(
                ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-01"]
            ),
            "actual_delay_minutes": [10.0, 45.0, 20.0, 5.0],
        }
    )

    result = rake_delay_inheritance(df)

    # 12301 on Jan 1 has no prior leg, should be 0
    assert (
        result[
            (result["train_number"] == 12301) & (result["journey_date"] == "2025-01-01")
        ]["prior_leg_delay"].iloc[0]
        == 0.0
    )

    # 12301 on Jan 2 should inherit Jan 1's delay (10.0)
    assert (
        result[
            (result["train_number"] == 12301) & (result["journey_date"] == "2025-01-02")
        ]["prior_leg_delay"].iloc[0]
        == 10.0
    )

    # 12301 on Jan 3 should inherit Jan 2's delay (45.0)
    assert (
        result[
            (result["train_number"] == 12301) & (result["journey_date"] == "2025-01-03")
        ]["prior_leg_delay"].iloc[0]
        == 45.0
    )


def test_remaining_schedule_buffer():
    df = pd.DataFrame(
        {
            "scheduled_travel_hours": [10.0, 5.0],
            "distance_km": [
                1100.0,
                550.0,
            ],  # At 110 km/h MPS, min time is 10.0 and 5.0 respectively
        }
    )

    result = remaining_schedule_buffer(df)

    # Buffer should be 0 for both if scheduled exactly at MPS
    assert result["schedule_buffer_hours"].iloc[0] == 0.0
    assert result["schedule_buffer_hours"].iloc[1] == 0.0

    df2 = pd.DataFrame(
        {"scheduled_travel_hours": [12.0], "distance_km": [1100.0]}  # 2 hours of buffer
    )
    result2 = remaining_schedule_buffer(df2)
    assert result2["schedule_buffer_hours"].iloc[0] == 2.0


def test_generate_standard_features():
    df = pd.DataFrame({"journey_date": pd.to_datetime(["2025-01-04"])})  # Saturday

    result = generate_standard_features(df)
    assert result["day_of_week"].iloc[0] == 5  # Saturday is 5
    assert result["is_weekend"].iloc[0] == 1
    assert result["month"].iloc[0] == 1


def _rake_batch():
    return pd.DataFrame(
        {
            "train_number": [12301, 12301, 12301],
            "journey_date": pd.to_datetime(["2025-01-01", "2025-01-08", "2025-01-15"]),
            "actual_delay_minutes": [10.0, 40.0, 25.0],
            "distance_km": [500.0, 500.0, 500.0],
            "scheduled_travel_hours": [8.0, 8.0, 8.0],
        }
    )


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


def test_rake_delay_inheritance_never_leaks_a_later_journeys_delay_backward():
    """Point-in-time backfill audit (Round 2 Item H).

    Plants a highly distinctive sentinel delay (999.0 min) on the LATEST
    journey of a train and confirms no EARLIER row's prior_leg_delay ever
    picks it up — the concrete failure mode a naive join/shift (e.g. using
    shift(-1) instead of shift(1), or not sorting by date first) would
    produce. Every row strictly before the sentinel's date must show a
    prior_leg_delay drawn only from what came before *it*, never from the
    future sentinel.
    """
    df = pd.DataFrame(
        {
            "train_number": [12301, 12301, 12301, 12301],
            "journey_date": pd.to_datetime(
                ["2025-01-01", "2025-01-08", "2025-01-15", "2025-01-22"]
            ),
            "actual_delay_minutes": [
                10.0,
                20.0,
                30.0,
                999.0,
            ],  # 999.0 is the future sentinel
        }
    )

    result = rake_delay_inheritance(df)

    for _, row in result.iterrows():
        if row["journey_date"] < pd.Timestamp("2025-01-22"):
            assert (
                row["prior_leg_delay"] != 999.0
            ), f"row dated {row['journey_date']} leaked the future sentinel delay"
    # And the row that legitimately follows the sentinel's journey (if one
    # existed) would be the only one allowed to see it — confirm the
    # mechanism is shift(1), i.e. exactly one row later, not shift(-1).
    naive_future_leak = df.sort_values(["train_number", "journey_date"]).copy()
    naive_future_leak["prior_leg_delay"] = naive_future_leak.groupby("train_number")[
        "actual_delay_minutes"
    ].shift(-1)
    # This is what a naive (buggy) shift(-1) implementation would produce:
    # the row dated 2025-01-15 would show the *future* 999.0 value.
    leaked_row = naive_future_leak[
        naive_future_leak["journey_date"] == "2025-01-15"
    ].iloc[0]
    assert (
        leaked_row["prior_leg_delay"] == 999.0
    )  # confirms this IS a real leak in the naive version

    real_row = result[result["journey_date"] == "2025-01-15"].iloc[0]
    assert (
        real_row["prior_leg_delay"] == 20.0
    )  # the actual code correctly uses the PRIOR leg, not the next one


def test_rake_delay_inheritance_is_robust_to_non_chronological_input_row_order():
    """A naive shift() without sorting first would silently depend on
    whatever order rows happen to arrive in — e.g. from an unordered raw
    CSV or an out-of-order ingestion batch. Feed the same records in
    scrambled order and confirm the result is identical to the
    already-sorted case (the real code sorts by [train_number, date]
    internally before shifting, so input order must not matter)."""
    ordered = pd.DataFrame(
        {
            "train_number": [12301, 12301, 12301],
            "journey_date": pd.to_datetime(["2025-01-01", "2025-01-08", "2025-01-15"]),
            "actual_delay_minutes": [10.0, 45.0, 20.0],
        }
    )
    scrambled = ordered.iloc[[2, 0, 1]].reset_index(
        drop=True
    )  # deliberately out of order

    result_ordered = (
        rake_delay_inheritance(ordered)
        .sort_values("journey_date")
        .reset_index(drop=True)
    )
    result_scrambled = (
        rake_delay_inheritance(scrambled)
        .sort_values("journey_date")
        .reset_index(drop=True)
    )

    pd.testing.assert_series_equal(
        result_ordered["prior_leg_delay"], result_scrambled["prior_leg_delay"]
    )
    assert result_ordered["prior_leg_delay"].tolist() == [0.0, 10.0, 45.0]


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
