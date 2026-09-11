"""Tests for the graceful-degradation fallback paths (Round 2 Item S).

The previous version of this file was a manual script (prints, zero asserts)
that trivially "passed" under pytest regardless of behavior. These tests
prove both documented fallback paths actually engage under the right
conditions, and that the response is never empty/null in either failure
mode — this is what "graceful degradation" actually means, not just that
the code exists.
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from src.api.app import create_app


class BrokenPredictionService:
    """Simulates the ML prediction pipeline being completely unavailable."""

    model_loaded = False

    def predict(self, train_id, current_state=None, prediction_variance=None):
        raise RuntimeError("simulated ML pipeline failure")


def test_ml_failure_falls_back_to_degraded_persistence_response(monkeypatch):
    monkeypatch.setenv("RIPPLEETA_CI", "1")  # avoid any live-feed call entirely
    client = TestClient(create_app(BrokenPredictionService()))

    response = client.get("/predict/12301")

    assert response.status_code == 200
    body = response.json()
    assert body["degraded"] is True
    assert "ML unavailable" in body["message"]  # a reason string, not just a flag
    # The response must never come back empty/null in this failure mode.
    assert body["p10_delay_min"] is not None
    assert body["p50_delay_min"] is not None
    assert body["p90_delay_min"] is not None
    assert body["p10_delay_min"] <= body["p50_delay_min"] <= body["p90_delay_min"]


class WorkingPredictionService:
    """A healthy ML pipeline — isolates the staleness-widening path."""

    model_loaded = True

    def predict(self, train_id, current_state=None, prediction_variance=None):
        return {
            "train_id": train_id,
            "status": "PREDICTION ACTIVE",
            "p10_delay_min": 20.0,
            "p50_delay_min": 35.0,
            "p90_delay_min": 55.0,
            "anomaly_flag": False,
            "uncertainty_mode": False,
            "message": "Calibrated network-aware prediction.",
        }


def test_stale_live_feed_widens_interval_and_reports_stale_since(monkeypatch):
    monkeypatch.setenv("RIPPLEETA_API_KEY", "dummy-key-for-test")
    monkeypatch.setenv("RIPPLEETA_CI", "0")

    stale_last_updated = datetime.now(timezone.utc) - timedelta(minutes=45)

    def fake_get_live_status(train_id):
        return {"delay_min": 12.0, "last_updated": stale_last_updated.isoformat()}

    monkeypatch.setattr(
        "src.ingestion.railradar_client.get_live_status", fake_get_live_status
    )

    client = TestClient(create_app(WorkingPredictionService()))
    response = client.get("/predict/12301")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "stale_data_widened"
    assert "Interval widened" in body["message"]
    assert body["last_updated"] is not None
    assert body["stale_since"] is not None
    # stale_since is when the feed crossed the 15-minute threshold, i.e.
    # last_updated + 15 minutes — not merely the last update time itself.
    expected_stale_since = stale_last_updated + timedelta(minutes=15)
    actual_stale_since = datetime.fromisoformat(body["stale_since"])
    assert abs((actual_stale_since - expected_stale_since).total_seconds()) < 1.0

    # The response must never come back empty/null in this failure mode.
    assert body["p10_delay_min"] is not None
    assert body["p90_delay_min"] is not None

    base_width = 55.0 - 20.0
    served_width = body["p90_delay_min"] - body["p10_delay_min"]
    assert served_width > base_width  # actually widened, not just relabeled


def test_fresh_live_feed_does_not_trigger_staleness_widening(monkeypatch):
    monkeypatch.setenv("RIPPLEETA_API_KEY", "dummy-key-for-test")
    monkeypatch.setenv("RIPPLEETA_CI", "0")

    fresh_last_updated = datetime.now(timezone.utc) - timedelta(minutes=1)

    def fake_get_live_status(train_id):
        return {"delay_min": 12.0, "last_updated": fresh_last_updated.isoformat()}

    monkeypatch.setattr(
        "src.ingestion.railradar_client.get_live_status", fake_get_live_status
    )

    client = TestClient(create_app(WorkingPredictionService()))
    response = client.get("/predict/12301")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] != "stale_data_widened"
    assert body["stale_since"] is None
    assert body["p10_delay_min"] == 20.0
    assert body["p90_delay_min"] == 55.0
