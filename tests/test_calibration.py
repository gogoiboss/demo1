"""Tests for conformal calibration and anomaly suspension."""

import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from src.calibration.anomaly_gate import AnomalyGate, SUSPENSION_MESSAGE
from src.calibration.conformal import CalibratedETAEngine, DEFAULT_FEATURES
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
        {"train_id": "A", "category": "rajdhani", "stops": [
            {"station": "A", "arr_min": None, "dep_min": 0},
            {"station": "B", "arr_min": 60, "dep_min": None},
        ]},
        {"train_id": "B", "category": "express", "stops": [
            {"station": "A", "arr_min": None, "dep_min": 10},
            {"station": "B", "arr_min": 70, "dep_min": None},
        ]},
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
