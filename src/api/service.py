"""Prediction service adapter used by the FastAPI layer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from src.calibration.conformal import DEFAULT_FEATURES, train_and_calibrate
from src.calibration.pipeline import CalibratedPredictionPipeline
from src.features.engineering import engineer_all_features


class TrainNotFoundError(LookupError):
    """Raised when a train is not present in the current data snapshot."""


class PredictionService:
    """Lazy, reusable adapter around the Stage 3-5 prediction pipeline."""

    def __init__(self, data_path: str | Path = "data/processed/kaggle_competition_cleaned.parquet"):
        self.data_path = Path(data_path)
        self._data: pd.DataFrame | None = None
        self._pipeline: CalibratedPredictionPipeline | None = None

    @property
    def model_loaded(self) -> bool:
        return self._pipeline is not None

    def _load(self) -> None:
        if self._pipeline is not None:
            return
        if not self.data_path.exists():
            raise RuntimeError(f"Prediction data is unavailable at {self.data_path}.")
        raw = pd.read_parquet(self.data_path)
        data = engineer_all_features(raw).dropna(
            subset=DEFAULT_FEATURES + ["actual_delay_minutes"]
        )
        if data.empty:
            raise RuntimeError("Prediction data contains no usable feature rows.")
        engine, _ = train_and_calibrate(data)
        self._data = data
        self._pipeline = CalibratedPredictionPipeline(engine)

    def predict(
        self,
        train_id: str,
        prediction_variance: float | None = None,
    ) -> dict[str, Any]:
        self._load()
        assert self._data is not None and self._pipeline is not None
        matches = self._data[self._data["train_number"].astype(str) == str(train_id)]
        if matches.empty:
            raise TrainNotFoundError(f"Train '{train_id}' was not found in the current data snapshot.")
        row = matches.tail(1).copy()
        row["train_id"] = str(train_id)
        row["delay_min"] = row["actual_delay_minutes"]
        result = self._pipeline.predict(
            row,
            prediction_variance=prediction_variance,
        )[0]
        result["train_id"] = str(train_id)
        return result
