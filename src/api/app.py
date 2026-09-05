"""FastAPI application for calibrated train predictions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import NormalDist

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from src.api.models import (
    CrewControllerResponse,
    FeederTransportResponse,
    HealthResponse,
    MaintenanceResponse,
    PassengerResponse,
    PredictionResponse,
    StationMasterResponse,
)
from src.api.service import PredictionService, TrainNotFoundError


def create_app(service: PredictionService | None = None) -> FastAPI:
    prediction_service = service or PredictionService()
    app = FastAPI(
        title="RippleETA Prediction API",
        description="Calibrated, network-aware Indian Railways ETA decision support.",
        version="1.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5500",
            "http://localhost:5500",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ],
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    def get_prediction(train_id: str, prediction_variance: float | None = None) -> dict:
        try:
            return prediction_service.predict(train_id, prediction_variance)
        except TrainNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=f"Prediction unavailable: {exc}") from exc
        except Exception as exc:  # pragma: no cover - defensive API boundary
            raise HTTPException(status_code=503, detail="Prediction service failed to produce a result.") from exc

    def now_utc() -> datetime:
        return datetime.now(timezone.utc)

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="rippleeta",
            model_loaded=prediction_service.model_loaded,
        )

    @app.get("/predict/{train_id}/passenger", response_model=PassengerResponse, tags=["stakeholders"])
    def passenger(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> PassengerResponse:
        prediction = get_prediction(train_id, prediction_variance)
        adjustment = prediction.get("conflict_adjustment_min", 0.0)
        trend = "worsening" if adjustment > 0 else "stable"
        delay = prediction["p50_delay_min"]
        return PassengerResponse(
            train_id=train_id,
            status=prediction["status"],
            delay_min=delay,
            trend="unknown" if delay is None else trend,
            next_update_at=now_utc() + timedelta(minutes=30),
            message=(
                "Prediction suspended; the current delay pattern is unusual."
                if prediction["anomaly_flag"]
                else f"Expected delay is {delay:.1f} minutes; next update in 30 minutes."
            ),
        )

    @app.get("/predict/{train_id}/station-master", response_model=StationMasterResponse, tags=["stakeholders"])
    def station_master(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> StationMasterResponse:
        prediction = get_prediction(train_id, prediction_variance)
        if prediction["anomaly_flag"]:
            decision = "SUSPENDED"
            decision_time = None
        else:
            width = prediction["p90_delay_min"] - prediction["p10_delay_min"]
            decision = "COMMIT" if width <= 30 else "DEFER"
            decision_time = round(max(0.0, 90.0 - width), 1)
        return StationMasterResponse(
            train_id=train_id,
            status=prediction["status"],
            platform_commit=decision,
            time_until_decision_needed_min=decision_time,
            p10_delay_min=prediction["p10_delay_min"],
            p90_delay_min=prediction["p90_delay_min"],
            message="Commit platform now." if decision == "COMMIT" else "Defer platform commitment until uncertainty narrows.",
        )

    @app.get("/predict/{train_id}/crew-controller", response_model=CrewControllerResponse, tags=["stakeholders"])
    def crew_controller(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> CrewControllerResponse:
        prediction = get_prediction(train_id, prediction_variance)
        deadline = None
        if prediction["p50_delay_min"] is not None:
            deadline = now_utc() + timedelta(minutes=max(15.0, 120.0 - prediction["p90_delay_min"]))
        return CrewControllerResponse(
            train_id=train_id,
            status=prediction["status"],
            relief_dispatch_deadline=deadline,
            predicted_delay_min=prediction["p50_delay_min"],
            message="Suspend automated relief timing and escalate." if deadline is None else "Dispatch relief against the predicted arrival window.",
        )

    @app.get("/predict/{train_id}/feeder-transport", response_model=FeederTransportResponse, tags=["stakeholders"])
    def feeder_transport(
        train_id: str,
        cutoff_time: datetime = Query(description="UTC cutoff by which the train should arrive."),
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> FeederTransportResponse:
        prediction = get_prediction(train_id, prediction_variance)
        if cutoff_time.tzinfo is None:
            cutoff_time = cutoff_time.replace(tzinfo=timezone.utc)
        now = now_utc()
        minutes_until_cutoff = (cutoff_time - now).total_seconds() / 60.0
        probability = None
        recommendation = "SUSPEND"
        if prediction["p50_delay_min"] is not None:
            sigma = max((prediction["p90_delay_min"] - prediction["p10_delay_min"]) / 2.56, 1.0)
            probability = NormalDist(prediction["p50_delay_min"], sigma).cdf(minutes_until_cutoff)
            recommendation = "WAIT" if probability >= 0.8 else "DEPART" if probability < 0.4 else "USE JUDGMENT"
        return FeederTransportResponse(
            train_id=train_id,
            status=prediction["status"],
            cutoff_time=cutoff_time,
            probability_arrival_before_cutoff=None if probability is None else round(probability, 3),
            recommendation=recommendation,
            message="Hold the feeder." if recommendation == "WAIT" else "Depart on schedule." if recommendation == "DEPART" else "Use dispatcher judgment with the current interval.",
        )

    @app.get("/predict/{train_id}/maintenance", response_model=MaintenanceResponse, tags=["stakeholders"])
    def maintenance(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> MaintenanceResponse:
        prediction = get_prediction(train_id, prediction_variance)
        available = None
        adequate = None
        if prediction["p90_delay_min"] is not None:
            available = round(max(0.0, 360.0 - prediction["p90_delay_min"]), 1)
            adequate = available >= 180.0
        return MaintenanceResponse(
            train_id=train_id,
            status=prediction["status"],
            available_turnaround_min=available,
            maintenance_window_adequate=adequate,
            message="Request intervention or compressed maintenance." if adequate is False else "Standard turnaround window remains available.",
        )

    @app.get("/predict/{train_id}", response_model=PredictionResponse, tags=["prediction"])
    def predict(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> PredictionResponse:
        prediction = get_prediction(train_id, prediction_variance)
        prediction.pop("train_id", None)
        return PredictionResponse(
            train_id=train_id,
            generated_at=now_utc(),
            message=(
                "Prediction suspended — anomalous conditions."
                if prediction["anomaly_flag"]
                else "Calibrated network-aware prediction."
            ),
            **prediction,
        )

    return app


app = create_app()
