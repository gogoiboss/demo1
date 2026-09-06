"""End-to-end test for the real raw-data prediction chain."""

from pathlib import Path

from src.pipeline import RippleETAPipeline


def test_real_pipeline_runs_from_raw_data_to_calibrated_output():
    root = Path(__file__).parents[1]
    pipeline = RippleETAPipeline(
        raw_data_path=root / "data" / "raw" / "train_delay.csv",
        processed_data_path=root / "data" / "processed" / "kaggle_competition_cleaned.parquet",
    )

    result = pipeline.run("20507")

    assert result["train_id"] == "20507"
    assert result["status"] in {"PREDICTION ACTIVE", "PREDICTION SUSPENDED — anomalous conditions"}
    assert result["p10_delay_min"] is not None
    assert result["p90_delay_min"] >= result["p10_delay_min"] >= 0
    if result["p50_delay_min"] is not None:
        assert result["p10_delay_min"] <= result["p50_delay_min"] <= result["p90_delay_min"]
    assert result["graph_status"] == "not_activated_no_station_event_state"
    assert result["pipeline_stages"]["raw_data"].endswith("data\\raw\\train_delay.csv") or result["pipeline_stages"]["raw_data"].endswith("data/raw/train_delay.csv")
    assert result["pipeline_stages"]["features"].startswith("engineered:")
    assert result["pipeline_stages"]["model"] == "xgboost:fitted"
    assert result["pipeline_stages"]["calibration"].startswith("mapie:coverage=")