"""Tests for prediction audit persistence (Round 2 Item T).

src/pipeline.py already computed real provenance (git commit, dataset
SHA-256, model artifact SHA-256) per prediction, but it was only ever
returned in the API response and discarded once the caller moved on — the
SQLite log only recorded a hardcoded "model_version" placeholder string.
These tests prove a real, queryable audit record is now written for every
prediction, containing genuine provenance and the exact input features used
— not just visible in the response, recoverable after the fact.
"""

import json
import sqlite3

from fastapi.testclient import TestClient

from src.api.app import create_app


class FakePredictionServiceWithProvenance:
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
            "provenance": {
                "git_commit": "abc1234",
                "dataset_sha256": "deadbeef" * 8,
                "saved_model_artifact_sha256": "cafef00d" * 8,
            },
            "input_features": {"prior_leg_delay": 12.5, "distance_km": 500.0},
            "shap_text": "60% rake delay; 25% schedule buffer",
        }


def test_prediction_audit_log_persists_real_provenance_and_input_features(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("RIPPLEETA_CI", "1")  # avoid live-feed calls

    client = TestClient(create_app(FakePredictionServiceWithProvenance()))
    response = client.get("/predict/12301")
    assert response.status_code == 200

    db_path = tmp_path / "predictions_history.db"
    assert db_path.exists(), "prediction_audit_log write should create the db file"

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute(
            "SELECT train_id, status, degraded, anomaly_flag, p10, p50, p90, "
            "git_commit, dataset_sha256, model_artifact_sha256, "
            "input_features_json, shap_text FROM prediction_audit_log "
            "WHERE train_id = '12301'"
        )
        row = cursor.fetchone()
    finally:
        conn.close()

    assert row is not None, "a real, queryable audit record must exist after the request"
    (
        train_id, status, degraded, anomaly_flag, p10, p50, p90,
        git_commit, dataset_sha256, model_artifact_sha256,
        input_features_json, shap_text,
    ) = row

    assert train_id == "12301"
    assert bool(degraded) is False
    assert p10 == 20.0 and p50 == 35.0 and p90 == 55.0
    # This is the actual fix: real provenance recovered from storage, not a
    # hardcoded placeholder string.
    assert git_commit == "abc1234"
    assert dataset_sha256 == "deadbeef" * 8
    assert model_artifact_sha256 == "cafef00d" * 8
    assert json.loads(input_features_json) == {"prior_leg_delay": 12.5, "distance_km": 500.0}
    assert shap_text == "60% rake delay; 25% schedule buffer"


class BrokenPredictionServiceForAudit:
    model_loaded = False

    def predict(self, train_id, current_state=None, prediction_variance=None):
        raise RuntimeError("simulated ML pipeline failure")


def test_prediction_audit_log_records_degraded_fallback_too(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("RIPPLEETA_CI", "1")

    client = TestClient(create_app(BrokenPredictionServiceForAudit()))
    response = client.get("/predict/12301")
    assert response.status_code == 200

    db_path = tmp_path / "predictions_history.db"
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT degraded, git_commit FROM prediction_audit_log WHERE train_id = '12301'"
        ).fetchone()
    finally:
        conn.close()

    assert row is not None
    degraded, git_commit = row
    assert bool(degraded) is True
    # The degraded fallback path has no pipeline provenance to report — the
    # audit record must still exist, just without those fields, rather than
    # silently skipping the write.
    assert git_commit is None
