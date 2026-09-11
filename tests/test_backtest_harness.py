from pathlib import Path

import pytest

from eval.backtest_harness import run_backtest


DATA_PATH = Path("data/processed/kaggle_competition_cleaned.parquet")


@pytest.mark.skipif(not DATA_PATH.exists(), reason="checked-in historical artifact is optional locally")
def test_one_day_backtest_reports_pipeline_metrics():
    metrics = run_backtest(DATA_PATH)

    assert metrics["rows"] > 0
    assert metrics["mae_p50_min"] >= 0
    assert metrics["pinball_loss"] >= 0
    assert 0 <= metrics["coverage_90_pct"] <= 100