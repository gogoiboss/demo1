"""Single orchestration path for the RippleETA prediction service."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import logging

import pandas as pd
import yaml

from src.calibration.conformal import DEFAULT_FEATURES, train_and_calibrate
from src.calibration.pipeline import CalibratedPredictionPipeline
from src.features.engineering import engineer_all_features
from src.reproducibility import git_commit, sha256_file
from src.validation import validate_input_frame
from src.graph.timed_event_graph import detect_conflicts

logger = logging.getLogger(__name__)


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
        raw_data_path: str | Path | None = None,
        processed_data_path: str | Path | None = None,
        graph=None,
        config_path: str | Path = "config.yaml",
    ):
        self.graph = graph
        self.config_path = Path(config_path)
        self.config = self._load_config()
        data_config = self.config.get("data", {})
        self.raw_data_path = Path(raw_data_path or data_config.get("raw_path", "data/raw/train_delay.csv"))
        self.processed_data_path = Path(
            processed_data_path
            or data_config.get(
                "processed_path", "data/processed/kaggle_competition_cleaned.parquet"
            )
        )
        self._data: pd.DataFrame | None = None
        self._prediction_pipeline: CalibratedPredictionPipeline | None = None
        self._stages: dict[str, str] = {}
        self._versioned_artifact: str = "not_saved"

    def _load_config(self) -> dict[str, Any]:
        logging_config = {}
        if not self.config_path.exists():
            logger.warning("Config file %s not found; using code defaults.", self.config_path)
            return {}
        with self.config_path.open(encoding="utf-8") as stream:
            config = yaml.safe_load(stream) or {}
        logging_config = config.get("logging", {})
        logging.basicConfig(
            level=getattr(logging, str(logging_config.get("level", "INFO")).upper(), logging.INFO),
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
        return config

    @property
    def model_loaded(self) -> bool:
        return self._prediction_pipeline is not None

    def predict_features(self, X: pd.DataFrame) -> list[dict[str, Any]]:
        """Run the calibrated engine directly on feature-complete rows.

        Bypasses the per-train-ID lookup and the graph stage. Intended for
        callers that already hold engineered rows (e.g. a slice of
        ``self._data`` after ``_load()``), such as latency benchmarking in
        ``jobs/scalability_benchmark.py``. Prefer ``run()`` for a normal
        single-train prediction with graph and provenance handling.
        """
        self._load()
        assert self._prediction_pipeline is not None
        return self._prediction_pipeline.predict(X)

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

        validation = self.config.get("validation", {})
        summary = validate_input_frame(
            raw,
            min_rows=int(validation.get("min_rows", 100)),
            max_missing_fraction=float(validation.get("max_missing_fraction", 0.05)),
            ranges=validation.get("ranges", {}),
        )
        self._stages["validation"] = f"passed:{summary.rows} rows"
        logger.info("Input validation passed: %s rows, ranges=%s", summary.rows, summary.checked_ranges)

        if "journey_date" in raw.columns:
            raw["journey_date"] = pd.to_datetime(raw["journey_date"], errors="coerce")
            raw = raw.dropna(subset=["journey_date"])
        data = engineer_all_features(raw).dropna(
            subset=DEFAULT_FEATURES + ["actual_delay_minutes"]
        )
        if data.empty:
            raise RuntimeError("Input data contains no usable feature rows.")
        self._stages["features"] = f"engineered:{len(data)} rows"
        logger.info("Features engineered: %s usable rows", len(data))

        model_config = {**self.config.get("model", {}), **self.config.get("calibration", {})}
        engine, metrics = train_and_calibrate(data, model_config=model_config or None)
        self._stages["model"] = "xgboost:fitted"
        self._stages["calibration"] = (
            f"mapie:coverage={metrics['coverage_90_pct']}%"
        )
        self._versioned_artifact = metrics.get("artifact_path", "not_saved")
        self._data = data
        self._prediction_pipeline = CalibratedPredictionPipeline(engine)
        logger.info("Model and calibration ready: %s", self._stages["calibration"])
        logger.info("Versioned artifact: %s", self._versioned_artifact)

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

        if hasattr(self.graph, "detect_conflicts"):
            conflicts = self.graph.detect_conflicts(current_state)
        else:
            conflicts = detect_conflicts(self.graph, current_state)
            
        adjustments: dict[str, float] = {}
        for conflict in conflicts:
            affected = str(conflict["affected_train"])
            adjustments[affected] = adjustments.get(affected, 0.0) + float(
                conflict["propagated_delay_min"]
            )
        status = "activated_conflict" if adjustments else "activated_no_conflict"
        self._stages["conflict_graph"] = status
        return {"status": status, "adjustments": adjustments, "conflicts": conflicts}

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
        # Recoverable audit trail (see src/api/app.py's prediction_audit_log
        # table): the exact feature values used for this prediction, not
        # just the output.
        result["input_features"] = {
            f: float(row[f].iloc[0]) for f in DEFAULT_FEATURES if f in row.columns
        }
        adjustment = float(graph_result.get("adjustments", {}).get(str(train_id), 0.0))
        result["conflict_adjustment_min"] = adjustment
        if adjustment and result["p50_delay_min"] is not None:
            result["p10_delay_min"] = round(result["p10_delay_min"] + adjustment, 1)
            result["p50_delay_min"] = round(result["p50_delay_min"] + adjustment, 1)
            result["p90_delay_min"] = round(result["p90_delay_min"] + adjustment, 1)
        result["graph_status"] = graph_result["status"]
        result["pipeline_stages"] = dict(self._stages)
        source_path = self.raw_data_path if self.raw_data_path.exists() else self.processed_data_path
        model_path = Path("models/calibrated_eta_engine.joblib")
        result["provenance"] = {
            "git_commit": git_commit(),
            "dataset_sha256": sha256_file(source_path),
            "saved_model_artifact_sha256": sha256_file(model_path) if model_path.exists() else "absent",
            "versioned_artifact": self._versioned_artifact,
            "fit_policy": "calibration_model_fit_on_chronological_training_split",
            "config_path": str(self.config_path),
        }
        logger.info("Prediction complete for train %s; graph=%s", train_id, graph_result["status"])
        return result