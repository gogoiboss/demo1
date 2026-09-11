"""XGBoost model definition and standalone training utility."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default hyperparameters — these are overridden by config.yaml in production
# ---------------------------------------------------------------------------
_DEFAULT_PARAMS: dict[str, Any] = {
    "n_estimators": 100,
    "max_depth": 6,
    "learning_rate": 0.1,
    "random_state": 42,
    "n_jobs": 1,
    "objective": "reg:squarederror",
}


def build_model(params: dict[str, Any] | None = None) -> xgb.XGBRegressor:
    """Return an unfitted XGBoost regressor.

    Parameters
    ----------
    params:
        Optional override dict read from ``config.yaml``.  Keys not recognised
        by XGBRegressor are silently dropped.  Defaults to ``_DEFAULT_PARAMS``.
    """
    xgb_keys = {
        "n_estimators", "max_depth", "learning_rate", "random_state",
        "n_jobs", "objective", "subsample", "colsample_bytree", "gamma",
        "min_child_weight", "reg_alpha", "reg_lambda",
    }
    merged = {**_DEFAULT_PARAMS, **(params or {})}
    filtered = {k: v for k, v in merged.items() if k in xgb_keys}
    logger.info("Building XGBoost model with params: %s", filtered)
    return xgb.XGBRegressor(**filtered)


def train_and_evaluate(
    df: pd.DataFrame,
    target_col: str = "actual_delay_minutes",
    date_col: str = "journey_date",
    model_params: dict[str, Any] | None = None,
) -> tuple[float, Path]:
    """Train XGBoost using TimeSeriesSplit cross-validation.

    Why TimeSeriesSplit and NOT random shuffle?
    Random shuffle causes data leakage: a model cannot train on a Tuesday
    congestion event and then be evaluated on the Monday before it.
    TimeSeriesSplit ensures we always train on past data to predict future
    data, mirroring real deployment conditions.

    Returns
    -------
    avg_mae : float
        Mean absolute error averaged across CV folds.
    model_path : Path
        Path to the saved model artifact.
    """
    df = df.sort_values(by=date_col).reset_index(drop=True)

    features = [
        "scheduled_travel_hours", "distance_km", "zone_congestion_index",
        "monsoon_flag", "fog_risk", "coach_count", "loco_age_years",
        "prior_leg_delay", "schedule_buffer_hours", "day_of_week", "month", "is_weekend",
    ]

    X = df[features]
    y = df[target_col]

    tscv = TimeSeriesSplit(n_splits=5)
    maes: list[float] = []
    model = build_model(model_params)

    logger.info("Starting 5-fold TimeSeriesSplit CV on %d rows", len(df))
    for fold, (train_idx, test_idx) in enumerate(tscv.split(X), start=1):
        model.fit(X.iloc[train_idx], y.iloc[train_idx])
        preds = model.predict(X.iloc[test_idx])
        fold_mae = mean_absolute_error(y.iloc[test_idx], preds)
        maes.append(fold_mae)
        logger.debug("Fold %d MAE: %.2f min", fold, fold_mae)

    avg_mae = float(np.mean(maes))
    logger.info("CV complete — avg MAE: %.2f min", avg_mae)

    # Final fit on all data
    model.fit(X, y)

    models_dir = Path("models")
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "xgboost_delay_model.joblib"
    joblib.dump(model, model_path)
    logger.info("Model artifact saved: %s", model_path)

    # Keep .gitignore so large binaries are never committed
    gitignore = models_dir / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text("*.joblib\n*.pkl\n")

    return avg_mae, model_path


# ---------------------------------------------------------------------------
# MLflow Tracking (Tier 3)
# ---------------------------------------------------------------------------
import mlflow
import os

def setup_mlflow_run(experiment_name: str = "RippleETA") -> None:
    """Set up the MLflow experiment."""
    if "MLFLOW_TRACKING_URI" not in os.environ:
        logger.info("MLFLOW_TRACKING_URI not set; MLflow will log to local ./mlruns directory.")
    mlflow.set_experiment(experiment_name)


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    from src.features.engineering import engineer_all_features

    df = pd.read_parquet("data/processed/kaggle_competition_cleaned.parquet")
    df = engineer_all_features(df)

    avg_mae, path = train_and_evaluate(df)
    logger.info("XGBoost CV MAE: %.2f minutes", avg_mae)
    logger.info("Model saved to %s (ignored in git; regenerate by running this script)", path)
