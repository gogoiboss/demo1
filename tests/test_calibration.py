"""Tests for conformal calibration and anomaly suspension."""

import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from src.calibration.anomaly_gate import AnomalyGate, SUSPENSION_MESSAGE
from src.calibration.conformal import (
    CalibratedETAEngine,
    DEFAULT_FEATURES,
    per_bucket_coverage,
)
from src.calibration.pipeline import CalibratedPredictionPipeline
from src.graph.timed_event_graph import build_timed_event_graph


def _fitted_engine() -> tuple[CalibratedETAEngine, pd.DataFrame]:
    rng = np.random.default_rng(42)
    X = pd.DataFrame(
        rng.normal(size=(120, len(DEFAULT_FEATURES))), columns=DEFAULT_FEATURES
    )
    y = pd.Series(30 + 5 * X[DEFAULT_FEATURES[0]] + rng.normal(0, 2, len(X)))
    model = xgb.XGBRegressor(
        n_estimators=15, max_depth=2, learning_rate=0.1, n_jobs=1, random_state=42
    )
    model.fit(X.iloc[:70], y.iloc[:70])
    engine = CalibratedETAEngine(base_model=model)
    engine.fit(X.iloc[:70], y.iloc[:70], X.iloc[70:105], y.iloc[70:105])
    return engine, X.iloc[105:]


def test_normal_prediction_returns_ordered_p10_p50_p90_window():
    engine, X_test = _fitted_engine()

    result = engine.predict(X_test.iloc[:1])[0]

    assert result["status"] == "PREDICTION ACTIVE"
    assert result["anomaly_flag"] is False
    assert result["p10_delay_min"] <= result["p50_delay_min"] <= result["p90_delay_min"]


def test_anomalous_uncertainty_suspends_prediction():
    engine, X_test = _fitted_engine()

    result = engine.predict(X_test.iloc[:1], current_prediction_variance=1e9)[0]

    assert result["anomaly_flag"] is True
    assert result["uncertainty_mode"] is True
    assert result["p50_delay_min"] is None
    assert result["status"] == SUSPENSION_MESSAGE


def test_anomaly_gate_uses_three_times_historical_variance():
    gate = AnomalyGate(multiplier=3.0).fit([1.0, 1.1, 0.9, 1.0])

    normal = gate.evaluate_variance(gate.baseline_variance_ * 2.0)
    anomalous = gate.evaluate_variance(gate.baseline_variance_ * 4.0)

    assert normal["suspended"] is False
    assert anomalous["suspended"] is True


def test_pipeline_adds_active_conflict_to_affected_train():
    engine, X_test = _fitted_engine()
    schedules = [
        {
            "train_id": "A",
            "category": "rajdhani",
            "stops": [
                {"station": "A", "arr_min": None, "dep_min": 0},
                {"station": "B", "arr_min": 60, "dep_min": None},
            ],
        },
        {
            "train_id": "B",
            "category": "express",
            "stops": [
                {"station": "A", "arr_min": None, "dep_min": 10},
                {"station": "B", "arr_min": 70, "dep_min": None},
            ],
        },
    ]
    graph = build_timed_event_graph(schedules, min_headway=10.0)
    state = X_test.iloc[:2].copy()
    state["train_id"] = ["A", "B"]
    state["station"] = ["A", "A"]
    state["event_type"] = ["dep", "dep"]
    state["delay_min"] = [60.0, 5.0]

    results = CalibratedPredictionPipeline(engine, graph).predict(state)

    # The affected train already has +5 min of own delay; the conflict adds +55.
    assert results[1]["conflict_adjustment_min"] == pytest.approx(55.0)


def test_mondrian_calibration_holds_per_bucket_coverage_floor():
    """Per-bucket coverage should not collapse for any delay-magnitude bucket.

    Marginal (pooled) coverage can average out a badly under-covered bucket —
    exactly the failure mode Mondrian calibration exists to catch. This test
    builds a heteroscedastic synthetic dataset (residual noise grows with
    prior_leg_delay) and checks every populated bucket individually.
    """
    rng = np.random.default_rng(7)
    n = 900
    prior_leg_delay = rng.uniform(0, 100, size=n)
    other_features = {
        f: rng.normal(size=n) for f in DEFAULT_FEATURES if f != "prior_leg_delay"
    }
    X = pd.DataFrame({**other_features, "prior_leg_delay": prior_leg_delay})[
        DEFAULT_FEATURES
    ]

    noise_scale = np.select(
        [prior_leg_delay < 15, prior_leg_delay < 60],
        [1.0, 4.0],
        default=12.0,
    )
    y = pd.Series(20 + 0.5 * prior_leg_delay + rng.normal(0, 1, n) * noise_scale)

    X_train, y_train = X.iloc[:400], y.iloc[:400]
    X_cal, y_cal = X.iloc[400:700], y.iloc[400:700]
    X_test, y_test = X.iloc[700:], y.iloc[700:]

    model = xgb.XGBRegressor(
        n_estimators=30, max_depth=3, learning_rate=0.1, n_jobs=1, random_state=7
    )
    model.fit(X_train, y_train)

    engine = CalibratedETAEngine(base_model=model, use_mondrian=True)
    engine.fit(X_train, y_train, X_cal, y_cal)
    assert engine.mapie_buckets_, "expected at least one Mondrian bucket to be fitted"

    preds = engine.predict(X_test)
    report = per_bucket_coverage(
        X_test,
        y_test.values,
        preds,
        engine.mondrian_feature,
        engine.mondrian_bucket_edges,
    )

    assert report
    for bucket, stats in report.items():
        if stats["n"] == 0:
            continue
        assert (
            stats["coverage_pct"] >= 75.0
        ), f"bucket {bucket} coverage {stats['coverage_pct']}% (n={stats['n']}) below floor"
