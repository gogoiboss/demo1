"""Prediction service adapter used by the FastAPI layer."""

from __future__ import annotations

from typing import Any

from src.pipeline import PipelineTrainNotFoundError, RippleETAPipeline


class TrainNotFoundError(LookupError):
    """Raised when a train is not present in the current data snapshot."""


class PredictionService:
    """Lazy, reusable adapter around the Stage 3-5 prediction pipeline."""

    def __init__(self):
        from src.graph.timed_event_graph import CachedPropagationEngine
        from src.graph.worked_example import SCHEDULES_DEMO
        graph = CachedPropagationEngine(SCHEDULES_DEMO)
        self._pipeline = RippleETAPipeline(graph=graph)

    @property
    def model_loaded(self) -> bool:
        return self._pipeline.model_loaded

    def predict(
        self,
        train_id: str,
        current_state=None,
        prediction_variance: float | None = None,
    ) -> dict[str, Any]:
        try:
            return self._pipeline.run(
                train_id,
                current_state=current_state,
                prediction_variance=prediction_variance,
            )
        except PipelineTrainNotFoundError as exc:
            raise TrainNotFoundError(str(exc)) from exc

    def supported_train_ids(self) -> list[str]:
        """Return IDs from the loaded snapshot, in stable display order."""
        self._pipeline._load()
        if self._pipeline._data is None:
            return []
        column = "train_number" if "train_number" in self._pipeline._data.columns else "train_id"
        return sorted(self._pipeline._data[column].astype(str).unique().tolist())
