"""Replay one chronological historical day through the calibrated pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.calibration.conformal import DEFAULT_FEATURES, train_and_calibrate
from src.features.engineering import engineer_all_features


def pinball_loss(y_true, y_pred, alpha: float) -> float:
    diff = y_true - y_pred
    return float(np.where(diff >= 0, alpha * diff, (alpha - 1) * diff).mean())


def run_backtest(
    data_path: str | Path = "data/processed/kaggle_competition_cleaned.parquet",
) -> dict[str, float | int | str]:
    path = Path(data_path)
    if not path.exists():
        raise FileNotFoundError(f"Historical artifact not found: {path}")

    frame = engineer_all_features(pd.read_parquet(path)).dropna(
        subset=DEFAULT_FEATURES + ["actual_delay_minutes"]
    )
    frame = frame.sort_values("journey_date").reset_index(drop=True)
    test_start = int(len(frame) * 0.85)
    test_frame = frame.iloc[test_start:]
    replay_date = test_frame["journey_date"].dt.date.max()
    day = test_frame[test_frame["journey_date"].dt.date == replay_date]
    train_frame = frame.iloc[:test_start]

    engine, _ = train_and_calibrate(
        train_frame, features=DEFAULT_FEATURES, save_path=None
    )
    predictions = engine.predict(day[DEFAULT_FEATURES])
    actual = day["actual_delay_minutes"].to_numpy(dtype=float)
    p10 = np.array([row["p10_delay_min"] for row in predictions], dtype=float)
    p50 = np.array([row["p50_delay_min"] for row in predictions], dtype=float)
    p90 = np.array([row["p90_delay_min"] for row in predictions], dtype=float)

    return {
        "replay_date": str(replay_date),
        "rows": int(len(day)),
        "mae_p50_min": float(np.mean(np.abs(actual - p50))),
        "pinball_loss": float(
            np.mean(
                [
                    pinball_loss(actual, p10, 0.1),
                    pinball_loss(actual, p50, 0.5),
                    pinball_loss(actual, p90, 0.9),
                ]
            )
        ),
        "coverage_90_pct": float(np.mean((actual >= p10) & (actual <= p90)) * 100),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data", default="data/processed/kaggle_competition_cleaned.parquet"
    )
    args = parser.parse_args()
    print(json.dumps(run_backtest(args.data), indent=2))


if __name__ == "__main__":
    main()
