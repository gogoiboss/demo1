"""Tests for eval/baseline_comparison.py's segmentation logic (Round 2 Item E).

These are synthetic-data tests: they prove the segmentation function itself
is correct (per-segment breakdowns, row counts, metric values), independent
of whether the real dataset is available in this environment to run
eval/baseline_comparison.py end-to-end.
"""

import numpy as np
import pytest

from eval.baseline_comparison import pinball_loss, segment_metrics


def test_segment_metrics_splits_rows_into_correct_segments_with_right_counts():
    # 6 rows: first 3 are "low" delay, last 3 are "high" delay.
    y_actual = np.array([5.0, 6.0, 7.0, 80.0, 90.0, 100.0])
    perfect_preds = y_actual.copy()
    models = {
        "Perfect Model": {
            "p10": perfect_preds,
            "p50": perfect_preds,
            "p90": perfect_preds,
        },
    }
    segment_labels = np.array(["low", "low", "low", "high", "high", "high"])

    report = segment_metrics(y_actual, models, segment_labels)

    assert set(report.keys()) == {"low", "high"}
    assert report["low"]["Perfect Model"]["n"] == 3
    assert report["high"]["Perfect Model"]["n"] == 3
    # A perfect model has zero MAE and zero pinball loss in every segment.
    assert report["low"]["Perfect Model"]["mae"] == pytest.approx(0.0)
    assert report["high"]["Perfect Model"]["mae"] == pytest.approx(0.0)
    assert report["low"]["Perfect Model"]["pinball"] == pytest.approx(0.0)
    assert report["high"]["Perfect Model"]["pinball"] == pytest.approx(0.0)


def test_segment_metrics_computes_real_per_segment_mae_and_pinball():
    # "low" segment: actual=10, prediction always 12 -> |error|=2 for every row.
    # "high" segment: actual=100, prediction always 70 -> |error|=30 for every row.
    y_actual = np.array([10.0, 10.0, 100.0, 100.0])
    p50 = np.array([12.0, 12.0, 70.0, 70.0])
    p10 = p50 - 5.0
    p90 = p50 + 5.0
    models = {"Model A": {"p10": p10, "p50": p50, "p90": p90}}
    segment_labels = np.array(["low", "low", "high", "high"])

    report = segment_metrics(y_actual, models, segment_labels)

    assert report["low"]["Model A"]["n"] == 2
    assert report["low"]["Model A"]["mae"] == pytest.approx(2.0)
    assert report["high"]["Model A"]["n"] == 2
    assert report["high"]["Model A"]["mae"] == pytest.approx(30.0)
    # High-delay segment MAE should be much worse than low-delay segment —
    # exactly the kind of gap pooled/global MAE would hide.
    assert report["high"]["Model A"]["mae"] > report["low"]["Model A"]["mae"]

    # Cross-check pinball loss against the standalone pinball_loss() function
    # directly on the "low" segment slice.
    low_mask = segment_labels == "low"
    expected_pinball_low = float(
        np.mean(
            [
                pinball_loss(y_actual[low_mask], p10[low_mask], 0.1),
                pinball_loss(y_actual[low_mask], p50[low_mask], 0.5),
                pinball_loss(y_actual[low_mask], p90[low_mask], 0.9),
            ]
        )
    )
    assert report["low"]["Model A"]["pinball"] == pytest.approx(
        expected_pinball_low, abs=0.01
    )


def test_segment_metrics_compares_multiple_models_within_the_same_segment():
    y_actual = np.array([50.0, 50.0, 50.0])
    good_preds = np.array([50.0, 50.0, 50.0])
    bad_preds = np.array([10.0, 10.0, 10.0])
    models = {
        "Good Model": {"p10": good_preds, "p50": good_preds, "p90": good_preds},
        "Bad Model": {"p10": bad_preds, "p50": bad_preds, "p90": bad_preds},
    }
    segment_labels = np.array(["only_segment"] * 3)

    report = segment_metrics(y_actual, models, segment_labels)

    assert set(report["only_segment"].keys()) == {"Good Model", "Bad Model"}
    assert (
        report["only_segment"]["Good Model"]["mae"]
        < report["only_segment"]["Bad Model"]["mae"]
    )


def test_segment_metrics_omits_empty_segments():
    y_actual = np.array([1.0, 2.0])
    preds = np.array([1.0, 2.0])
    models = {"M": {"p10": preds, "p50": preds, "p90": preds}}
    # Every row is labeled "only" — no row is ever labeled "never_present".
    segment_labels = np.array(["only", "only"])

    report = segment_metrics(y_actual, models, segment_labels)

    assert "never_present" not in report
    assert report["only"]["M"]["n"] == 2
