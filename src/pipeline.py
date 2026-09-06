"""Single orchestration path for the RippleETA prediction service."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from src.calibration.conformal import DEFAULT_FEATURES, train_and_calibrate
from src.calibration.pipeline import CalibratedPredictionPipeline
from src.features.engineering import engineer_all_features


class PipelineTrainNotFoundError(LookupError):
    """Raised when a requested train is absent from the loaded journey data."""


class RippleETAPipeline:
    """Run ingestion, features, model, graph boundary, and calibration in order.

    The public journey artifact has no station-event state. The graph stage is
    therefore explicit and reports ``not_activated`` until a caller supplies a
    real graph plus station-event DataFrame; it never fabricates a conflict.
    """

    def __init__(
        self,
        raw_data_path: str | Path = "data/raw/train_delay.csv",
        processed_data_path: str | Path = "data/processed/kaggle_competition_cleaned.parquet",
        graph=None,
    ):
        self.raw_data_path = Path(raw_data_path)
        self.processed_data_path = Path(processed_data_path)
        self.graph = graph
        self._data: pd.DataFrame | None = None
        self._prediction_pipeline: CalibratedPredictionPipeline | None = None
        self._stages: dict[str, str] = {}

    @property
    def model_loaded(self) -> bool:
        return self._prediction_pipeline is not None

    def _load(self) -> None:
        if self._prediction_pipeline is not None:
            return

        if self.raw_data_path.exists():
            raw = pd.read_csv(self.raw_data_path, low_memory=False)
            self._stages["raw_data"] = f"loaded:{self.raw_data_path}"
        elif self.processed_data_path.exists():
            raw = pd.read_parquet(self.processed_data_path)
            self._stages["raw_data"] = f"loaded:{self.processed_data_path}"
        else:
            raise RuntimeError(
                f"No input data found at {self.raw_data_path} or {self.processed_data_path}."
            )

        if "journey_date" in raw.columns:
            raw["journey_date"] = pd.to_datetime(raw["journey_date"], errors="coerce")
            raw = raw.dropna(subset=["journey_date"])
        data = engineer_all_features(raw).dropna(
            subset=DEFAULT_FEATURES + ["actual_delay_minutes"]
        )
        if data.empty:
            raise RuntimeError("Input data contains no usable feature rows.")
        self._stages["features"] = f"engineered:{len(data)} rows"

        engine, metrics = train_and_calibrate(data)
        self._stages["model"] = "xgboost:fitted"
        self._stages["calibration"] = (
            f"mapie:coverage={metrics['coverage_90_pct']}%"
        )
        self._data = data
        self._prediction_pipeline = CalibratedPredictionPipeline(engine)

    def _graph_stage(self, current_state: pd.DataFrame | None) -> dict[str, Any]:
        if self.graph is None or current_state is None:
            status = "not_activated_no_station_event_state"
            self._stages["conflict_graph"] = status
            return {"status": status, "adjustment_min": 0.0}

        required = {"train_id", "station", "event_type", "delay_min"}
        missing = required.difference(current_state.columns)
        if missing:
            status = f"not_activated_missing:{','.join(sorted(missing))}"
            self._stages["conflict_graph"] = status
            return {"status": status, "adjustment_min": 0.0}

        self._stages["conflict_graph"] = "activated"
        return {"status": "activated", "adjustment_min": 0.0}

    def run(
        self,
        train_id: str,
        current_state: pd.DataFrame | None = None,
        prediction_variance: float | None = None,
    ) -> dict[str, Any]:
        """Return one calibrated prediction with stage provenance."""
        self._load()
        assert self._data is not None and self._prediction_pipeline is not None
        matches = self._data[self._data["train_number"].astype(str) == str(train_id)]
        if matches.empty:
            raise PipelineTrainNotFoundError(
                f"Train '{train_id}' was not found in the current data snapshot."
            )

        graph_result = self._graph_stage(current_state)
        row = matches.tail(1).copy()
        row["train_id"] = str(train_id)
        row["delay_min"] = row["actual_delay_minutes"]
        result = self._prediction_pipeline.predict(
            row,
            prediction_variance=prediction_variance,
        )[0]
        result["train_id"] = str(train_id)
        result["conflict_adjustment_min"] = graph_result["adjustment_min"]
        result["graph_status"] = graph_result["status"]
        result["pipeline_stages"] = dict(self._stages)
        return result