"""Prediction service adapter used by the FastAPI layer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.pipeline import PipelineTrainNotFoundError, RippleETAPipeline


class TrainNotFoundError(LookupError):
    """Raised when a train is not present in the current data snapshot."""


class PredictionService:
    """Lazy, reusable adapter around the Stage 3-5 prediction pipeline."""

    def __init__(self, data_path: str | Path = "data/processed/kaggle_competition_cleaned.parquet"):
        self.data_path = Path(data_path)
        raw_path = self.data_path.parent.parent / "raw" / "train_delay.csv"
        self._pipeline = RippleETAPipeline(
            raw_data_path=raw_path,
            processed_data_path=self.data_path,
        )

    @property
    def model_loaded(self) -> bool:
        return self._pipeline.model_loaded

    def predict(
        self,
        train_id: str,
        prediction_variance: float | None = None,
    ) -> dict[str, Any]:
        try:
            return self._pipeline.run(
                train_id,
            prediction_variance=prediction_variance,
            )
        except PipelineTrainNotFoundError as exc:
            raise TrainNotFoundError(str(exc)) from exc
