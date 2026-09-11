"""End-to-end test for the real raw-data prediction chain."""

from pathlib import Path

import pandas as pd

from src.pipeline import RippleETAPipeline
from src.graph.timed_event_graph import build_timed_event_graph
from src.graph.worked_example import DELAYS_DEMO, SCHEDULES_DEMO


def test_real_pipeline_runs_from_raw_data_to_calibrated_output():
    root = Path(__file__).parents[1]
    pipeline = RippleETAPipeline(
        raw_data_path=root / "data" / "raw" / "train_delay.csv",
        processed_data_path=root
        / "data"
        / "processed"
        / "kaggle_competition_cleaned.parquet",
    )

    result = pipeline.run("20507")

    assert result["train_id"] == "20507"
    assert result["status"] in {
        "PREDICTION ACTIVE",
        "PREDICTION SUSPENDED — anomalous conditions",
    }
    assert result["p10_delay_min"] is not None
    assert result["p90_delay_min"] >= result["p10_delay_min"] >= 0
    if result["p50_delay_min"] is not None:
        assert (
            result["p10_delay_min"]
            <= result["p50_delay_min"]
            <= result["p90_delay_min"]
        )
    assert result["graph_status"] == "not_activated_no_station_event_state"
    assert result["pipeline_stages"]["raw_data"].endswith(
        "data\\raw\\train_delay.csv"
    ) or result["pipeline_stages"]["raw_data"].endswith("data/raw/train_delay.csv")
    assert result["pipeline_stages"]["features"].startswith("engineered:")
    assert result["pipeline_stages"]["model"] == "xgboost:fitted"
    assert result["pipeline_stages"]["calibration"].startswith("mapie:coverage=")
    assert result["pipeline_stages"]["validation"] == "passed:10000 rows"
    assert len(result["provenance"]["dataset_sha256"]) == 64
    assert result["provenance"]["saved_model_artifact_sha256"]
    assert (
        result["provenance"]["fit_policy"]
        == "calibration_model_fit_on_chronological_training_split"
    )
    assert result["provenance"]["git_commit"] != ""


def test_pipeline_graph_stage_calls_real_conflict_detector():
    pipeline = RippleETAPipeline(
        graph=build_timed_event_graph(SCHEDULES_DEMO, min_headway=10.0)
    )
    state = pd.DataFrame(
        [
            {
                "train_id": "12301",
                "station": "KANPUR",
                "event_type": "dep",
                "delay_min": DELAYS_DEMO["12301__KANPUR__dep"],
            },
            {
                "train_id": "56789",
                "station": "KANPUR",
                "event_type": "dep",
                "delay_min": DELAYS_DEMO["56789__KANPUR__dep"],
            },
        ]
    )

    result = pipeline._graph_stage(state)

    assert result["status"] == "activated_conflict"
    assert result["adjustments"]["12301"] == 9.0
