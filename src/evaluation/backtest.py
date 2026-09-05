"""Chronological backtest for the RippleETA Stage 3-5 pipeline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error

from src.calibration.conformal import CalibratedETAEngine, DEFAULT_FEATURES
from src.features.engineering import engineer_all_features

SELECTED_ROUTES = [12301, 12302, 12951, 12952, 12625, 12626]


def _fit_route_model(train: pd.DataFrame, features: list[str]) -> xgb.XGBRegressor:
    model = xgb.XGBRegressor(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        random_state=42,
        n_jobs=1,
        objective="reg:squarederror",
    )
    model.fit(train[features], train["actual_delay_minutes"])
    return model


def _evaluate_slice(route_df: pd.DataFrame, features: list[str]) -> tuple[dict, pd.DataFrame]:
    route_df = route_df.sort_values("journey_date").reset_index(drop=True)
    n = len(route_df)
    train_end = int(n * 0.70)
    cal_end = int(n * 0.85)
    train = route_df.iloc[:train_end]
    calibration = route_df.iloc[train_end:cal_end]
    test = route_df.iloc[cal_end:]

    model = _fit_route_model(train, features)
    engine = CalibratedETAEngine(base_model=model, features=features)
    engine.fit(
        train[features], train["actual_delay_minutes"],
        calibration[features], calibration["actual_delay_minutes"],
    )
    predictions = engine.predict(test[features])
    y_true = test["actual_delay_minutes"].to_numpy()
    full_p50 = np.array([row["p50_delay_min"] for row in predictions], dtype=float)
    p10 = np.array([row["p10_delay_min"] for row in predictions], dtype=float)
    p90 = np.array([row["p90_delay_min"] for row in predictions], dtype=float)
    naive = test["prior_leg_delay"].to_numpy(dtype=float)

    prediction_rows = test[["train_number", "journey_date", "actual_delay_minutes", "prior_leg_delay"]].copy()
    prediction_rows["xgboost_p50_delay_min"] = full_p50
    prediction_rows["p10_delay_min"] = p10
    prediction_rows["p90_delay_min"] = p90
    prediction_rows["covered_90_interval"] = (y_true >= p10) & (y_true <= p90)
    prediction_rows["conflict_adjustment_min"] = 0.0

    metrics = {
        "route": str(int(route_df["train_number"].iloc[0])),
        "n_total": int(n),
        "n_train": int(len(train)),
        "n_calibration": int(len(calibration)),
        "n_test": int(len(test)),
        "baseline_mae_min": round(float(mean_absolute_error(y_true, naive)), 3),
        "full_pipeline_mae_min": round(float(mean_absolute_error(y_true, full_p50)), 3),
        "mae_improvement_min": round(float(mean_absolute_error(y_true, naive) - mean_absolute_error(y_true, full_p50)), 3),
        "mae_improvement_pct": round(float((mean_absolute_error(y_true, naive) - mean_absolute_error(y_true, full_p50)) / mean_absolute_error(y_true, naive) * 100), 2),
        "coverage_90_pct": round(float(prediction_rows["covered_90_interval"].mean() * 100), 2),
        "avg_interval_width_min": round(float((p90 - p10).mean()), 3),
        "conflict_adjustment_rows": 0,
        "conflict_adjustment_note": "No station-pair live-state fields exist in this journey-level dataset; graph adjustment is not activated.",
    }
    return metrics, prediction_rows


def run_backtest(
    data_path: str | Path = "data/processed/kaggle_competition_cleaned.parquet",
    routes: Iterable[int] = SELECTED_ROUTES,
) -> dict:
    routes = list(routes)
    raw = pd.read_parquet(data_path)
    data = engineer_all_features(raw).dropna(subset=DEFAULT_FEATURES + ["actual_delay_minutes"])
    route_metrics = []
    predictions = []
    availability = []
    for route in routes:
        route_df = data[data["train_number"].astype(int) == int(route)]
        if route_df.empty:
            availability.append({"route": str(route), "available": False, "n_rows": 0})
            continue
        availability.append({"route": str(route), "available": True, "n_rows": int(len(route_df))})
        metrics, route_predictions = _evaluate_slice(route_df, DEFAULT_FEATURES)
        route_metrics.append(metrics)
        predictions.append(route_predictions)

    all_test = pd.concat(predictions, ignore_index=True) if predictions else pd.DataFrame()
    if all_test.empty:
        raise ValueError("No selected routes were available for backtesting.")
    baseline_mae = mean_absolute_error(all_test["actual_delay_minutes"], all_test["prior_leg_delay"])
    full_mae = mean_absolute_error(all_test["actual_delay_minutes"], all_test["xgboost_p50_delay_min"])
    overall = {
        "n_selected_routes": len(list(routes)),
        "n_available_routes": len(route_metrics),
        "n_test": int(len(all_test)),
        "baseline_mae_min": round(float(baseline_mae), 3),
        "full_pipeline_mae_min": round(float(full_mae), 3),
        "mae_improvement_min": round(float(baseline_mae - full_mae), 3),
        "mae_improvement_pct": round(float((baseline_mae - full_mae) / baseline_mae * 100), 2),
        "coverage_90_pct": round(float(all_test["covered_90_interval"].mean() * 100), 2),
        "avg_interval_width_min": round(float((all_test["p90_delay_min"] - all_test["p10_delay_min"]).mean()), 3),
        "conflict_adjustment_rows": int(all_test["conflict_adjustment_min"].ne(0).sum()),
    }
    representative = all_test.loc[(all_test["actual_delay_minutes"] - all_test["xgboost_p50_delay_min"]).abs().idxmax()]
    route_12301 = all_test[all_test["train_number"].astype(int) == 12301]
    real_12301 = route_12301.loc[route_12301["actual_delay_minutes"].idxmax()] if not route_12301.empty else representative
    example = {
        "train_number": str(int(representative["train_number"])),
        "journey_date": representative["journey_date"].isoformat(),
        "actual_delay_min": round(float(representative["actual_delay_minutes"]), 3),
        "prior_leg_delay_min": round(float(representative["prior_leg_delay"]), 3),
        "full_pipeline_p50_delay_min": round(float(representative["xgboost_p50_delay_min"]), 3),
        "p10_delay_min": round(float(representative["p10_delay_min"]), 3),
        "p90_delay_min": round(float(representative["p90_delay_min"]), 3),
        "interval_contains_actual": bool(representative["covered_90_interval"]),
        "conflict_adjustment_min": 0.0,
        "note": "Real held-out journey example; not the illustrative 12301/56789 station-pair scenario.",
    }
    real_12301_example = {
        "train_number": "12301",
        "journey_date": real_12301["journey_date"].isoformat(),
        "actual_delay_min": round(float(real_12301["actual_delay_minutes"]), 3),
        "prior_leg_delay_min": round(float(real_12301["prior_leg_delay"]), 3),
        "full_pipeline_p50_delay_min": round(float(real_12301["xgboost_p50_delay_min"]), 3),
        "p10_delay_min": round(float(real_12301["p10_delay_min"]), 3),
        "p90_delay_min": round(float(real_12301["p90_delay_min"]), 3),
        "interval_contains_actual": bool(real_12301["covered_90_interval"]),
        "conflict_adjustment_min": 0.0,
        "note": "Real held-out 12301 row. Train 56789 and station-pair occupancy are absent, so no conflict propagation can be measured.",
    }
    return {
        "method": {
            "split": "chronological 70% train / 15% calibration / 15% held-out test per route",
            "baseline": "prior_leg_delay carried forward",
            "full_pipeline": "engineered features + XGBoost + MAPIE P10/P50/P90; graph adjustment measured as inactive because the dataset has no station-pair live state",
            "data_path": str(data_path),
        },
        "availability": availability,
        "route_metrics": route_metrics,
        "overall": overall,
        "worked_example": example,
        "real_12301_example": real_12301_example,
        "predictions": all_test,
    }


def save_backtest_json(result: dict, path: str | Path) -> None:
    serializable = {key: value for key, value in result.items() if key != "predictions"}
    Path(path).write_text(json.dumps(serializable, indent=2, default=str), encoding="utf-8")


if __name__ == "__main__":
    result = run_backtest()
    print(json.dumps({
        "availability": result["availability"],
        "route_metrics": result["route_metrics"],
        "overall": result["overall"],
        "worked_example": result["worked_example"],
    }, indent=2))
