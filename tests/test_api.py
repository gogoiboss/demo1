"""FastAPI endpoint tests with a deterministic injected prediction service."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.api.service import TrainNotFoundError


class FakePredictionService:
    model_loaded = True

    def predict(self, train_id: str, prediction_variance: float | None = None) -> dict:
        if train_id == "missing":
            raise TrainNotFoundError("Train 'missing' was not found in the current data snapshot.")
        anomaly = prediction_variance is not None and prediction_variance > 100.0
        return {
            "train_id": train_id,
            "status": "PREDICTION SUSPENDED — anomalous conditions" if anomaly else "PREDICTION ACTIVE",
            "p10_delay_min": None if anomaly else 20.0,
            "p50_delay_min": None if anomaly else 35.0,
            "p90_delay_min": 55.0,
            "anomaly_flag": anomaly,
            "uncertainty_mode": anomaly,
            "conflict_adjustment_min": 5.0,
        }


client = TestClient(create_app(FakePredictionService()))


def test_core_prediction_is_successful():
    response = client.get("/predict/12301")

    assert response.status_code == 200
    body = response.json()
    assert body["p10_delay_min"] == 20.0
    assert body["p50_delay_min"] == 35.0
    assert body["p90_delay_min"] == 55.0


def test_invalid_train_id_returns_clear_404():
    response = client.get("/predict/missing")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_anomaly_returns_suspension_flag():
    response = client.get("/predict/12301?prediction_variance=101")

    assert response.status_code == 200
    body = response.json()
    assert body["anomaly_flag"] is True
    assert body["p50_delay_min"] is None
    assert "SUSPENDED" in body["status"]


def test_stakeholder_endpoints_are_distinct():
    cutoff = datetime.now(timezone.utc).isoformat()
    endpoints = [
        ("passenger", "/predict/12301/passenger"),
        ("station_master", "/predict/12301/station-master"),
        ("crew_controller", "/predict/12301/crew-controller"),
        ("maintenance", "/predict/12301/maintenance"),
        ("feeder_transport", "/predict/12301/feeder-transport"),
    ]
    responses = []
    for role, path in endpoints:
        login = client.post(
            "/api/auth/demo",
            json={"email": "test@rippleeta.in", "role": role},
        )
        assert login.status_code == 200
        responses.append(
            client.get(path, params={"cutoff_time": cutoff} if role == "feeder_transport" else {})
        )

    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json()["trend"] in {"unknown", "stable", "worsening", "improving"}
    assert "platform_commit" in responses[1].json()
    assert "relief_dispatch_deadline" in responses[2].json()
    assert "maintenance_window_adequate" in responses[3].json()
    assert "probability_arrival_before_cutoff" in responses[4].json()


def test_health_endpoint():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "rippleeta",
        "model_loaded": True,
    }


def test_graph_demo_returns_computed_station_pair_propagation():
    response = client.get("/graph/demo")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "REPLAYED STATION-PAIR SCENARIO"
    assert body["conflict_addition_min"] == 9.0
    assert body["final_delay_min"] == 64.0
    assert "not a live network backtest" in body["message"]
