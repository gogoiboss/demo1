"""FastAPI application for calibrated train predictions."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import NormalDist
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import (
    create_session_token,
    get_current_user,
    role_required,
    verify_google_token,
)
from src.api.models import (
    CrewControllerResponse,
    FeederTransportResponse,
    GraphDemoResponse,
    HealthResponse,
    MaintenanceResponse,
    PassengerResponse,
    PredictionResponse,
    SupportedTrain,
    StationMasterResponse,
    SandboxResponse,
    StationHistory,
    SystemStatusResponse,
)
from src.api.service import PredictionService, TrainNotFoundError
from src.graph.worked_example import run_worked_example

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


class GoogleLoginRequest(BaseModel):
    credential: str


class DemoLoginRequest(BaseModel):
    email: str
    role: str


def get_trend(
    train_id: str, current_delay: float
) -> Literal["stable", "worsening", "improving", "unknown"]:
    if os.environ.get("RIPPLEETA_CI") == "1":
        return "unknown"
    if current_delay is None:
        return "unknown"
    conn = sqlite3.connect("predictions_history.db")
    c = conn.cursor()
    c.execute(
        """CREATE TABLE IF NOT EXISTS history 
                 (train_id TEXT, delay REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"""
    )

    # Get last delay
    c.execute(
        "SELECT delay FROM history WHERE train_id = ? ORDER BY timestamp DESC LIMIT 1",
        (train_id,),
    )
    row = c.fetchone()

    # Insert new delay
    c.execute(
        "INSERT INTO history (train_id, delay) VALUES (?, ?)", (train_id, current_delay)
    )
    conn.commit()
    conn.close()

    if row is None:
        return "unknown"

    last_delay = row[0]
    if current_delay > last_delay + 1.0:
        return "worsening"
    elif current_delay < last_delay - 1.0:
        return "improving"
    return "stable"


def create_app(service: PredictionService | None = None) -> FastAPI:
    prediction_service = service or PredictionService()
    app = FastAPI(
        title="RippleETA Prediction API",
        description="Calibrated, network-aware Indian Railways ETA decision support.",
        version="1.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        # The bundled dashboards are served by this application.  Keep the
        # middleware permissive enough for a local dashboard server too, but
        # do not advertise credential support with a wildcard origin.
        allow_origins=[
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:5500",
            "http://localhost:5500",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    def get_prediction(train_id: str, prediction_variance: float | None = None) -> dict:
        from src.ingestion.railradar_client import get_live_status
        import pandas as pd

        try:
            from dotenv import load_dotenv

            load_dotenv()
        except ImportError:
            pass

        # 1. Fetch live status (Persistence, Staleness, and Degraded Fallback)
        # Do not block a dashboard request through RailRadar retry/backoff when
        # this installation has no live provider credential.  The prediction
        # pipeline can still serve the local historical snapshot; its response
        # is explicitly marked as having no live update timestamp.
        live_status = (
            get_live_status(train_id)
            if os.environ.get("RIPPLEETA_CI") != "1"
            and os.environ.get("RIPPLEETA_API_KEY")
            else None
        )
        is_stale = False
        last_updated = None
        stale_since = None
        current_delay = 0.0

        if live_status:
            current_delay = live_status.get("delay_min", 0.0)
            if live_status.get("last_updated"):
                try:
                    last_updated_dt = datetime.fromisoformat(
                        live_status["last_updated"].replace("Z", "+00:00")
                    )
                    last_updated = last_updated_dt.isoformat()
                    STALE_THRESHOLD_MIN = 15.0  # Configurable threshold
                    staleness_min = (now_utc() - last_updated_dt).total_seconds() / 60.0
                    if staleness_min > STALE_THRESHOLD_MIN:
                        is_stale = True
                        # The moment the feed crossed the staleness threshold,
                        # not merely when it was last updated — tells the
                        # caller exactly how long the interval has been
                        # widened for, not just that the feed is old.
                        stale_since = (
                            last_updated_dt + timedelta(minutes=STALE_THRESHOLD_MIN)
                        ).isoformat()
                except ValueError:
                    pass

        mock_state = pd.DataFrame(
            [
                {
                    "train_id": "12301",
                    "station": "KANPUR",
                    "event_type": "dep",
                    "delay_min": 55.0,
                },
                {
                    "train_id": "56789",
                    "station": "KANPUR",
                    "event_type": "dep",
                    "delay_min": 15.0,
                },
                {
                    "train_id": train_id,
                    "station": "KANPUR",
                    "event_type": "dep",
                    "delay_min": current_delay,
                },
            ]
        )

        is_degraded = False
        try:
            # Core prediction call
            try:
                prediction = prediction_service.predict(
                    train_id,
                    current_state=mock_state,
                    prediction_variance=prediction_variance,
                )
            except TypeError as exc:
                if "current_state" not in str(exc):
                    raise
                prediction = prediction_service.predict(
                    train_id,
                    prediction_variance=prediction_variance,
                )
        except TrainNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception:
            # FALLBACK 1: ML Error -> Persistence Baseline (degraded: true)
            is_degraded = True
            prediction = {
                "train_id": train_id,
                "status": "degraded_fallback",
                "p50_delay_min": current_delay,
                "p10_delay_min": max(0.0, current_delay - 30.0),
                "p90_delay_min": current_delay + 60.0,
                "anomaly_flag": False,
                "uncertainty_mode": False,
                "message": "ML unavailable. Using persistence baseline.",
            }

        # FALLBACK 2: Anomaly Gate
        if prediction.get("anomaly_flag"):
            prediction["status"] = "PREDICTION SUSPENDED"
            prediction["message"] = (
                "Prediction suspended: anomaly gate triggered (confidence too low to serve)."
            )

        # FALLBACK 3: Stale Data Widen
        elif is_stale and not is_degraded:
            widen_factor = 1.5
            width = prediction["p90_delay_min"] - prediction["p10_delay_min"]
            extra = (width * widen_factor - width) / 2.0
            prediction["p10_delay_min"] = max(0.0, prediction["p10_delay_min"] - extra)
            prediction["p90_delay_min"] = prediction["p90_delay_min"] + extra
            prediction["status"] = "stale_data_widened"
            if "message" in prediction:
                prediction["message"] += " (Interval widened due to stale feed > 15m)"
            else:
                prediction["message"] = "Interval widened due to stale feed > 15m"

        prediction["degraded"] = is_degraded
        prediction["last_updated"] = last_updated
        prediction["stale_since"] = stale_since

        # LOGGING (Step 4)
        conn = sqlite3.connect("predictions_history.db")
        c = conn.cursor()
        c.execute(
            """CREATE TABLE IF NOT EXISTS prediction_logs
                     (train_id TEXT, p50 REAL, p10 REAL, p90 REAL, status TEXT, degraded BOOLEAN, model_version TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"""
        )
        model_version = "rippleeta-v1.0.0"
        c.execute(
            """INSERT INTO prediction_logs
                     (train_id, p50, p10, p90, status, degraded, model_version)
                     VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                train_id,
                prediction.get("p50_delay_min"),
                prediction.get("p10_delay_min"),
                prediction.get("p90_delay_min"),
                prediction.get("status", ""),
                is_degraded,
                model_version,
            ),
        )

        # Round 2 Item T: a real, queryable audit trail. prediction_logs
        # above only ever recorded a hardcoded "model_version" placeholder —
        # the actual provenance the pipeline computes (git commit, dataset
        # and model artifact SHA-256) was returned in the API response and
        # discarded once the caller moved on. Persist input features,
        # output, and real provenance together so a specific past
        # prediction is recoverable after the fact, not just visible in the
        # response that produced it.
        c.execute("""CREATE TABLE IF NOT EXISTS prediction_audit_log
                     (train_id TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                      status TEXT, degraded BOOLEAN, anomaly_flag BOOLEAN,
                      p10 REAL, p50 REAL, p90 REAL,
                      stale_since TEXT, last_updated TEXT,
                      git_commit TEXT, dataset_sha256 TEXT, model_artifact_sha256 TEXT,
                      input_features_json TEXT, shap_text TEXT)""")
        provenance = prediction.get("provenance") or {}
        c.execute(
            """INSERT INTO prediction_audit_log
                     (train_id, status, degraded, anomaly_flag, p10, p50, p90,
                      stale_since, last_updated, git_commit, dataset_sha256,
                      model_artifact_sha256, input_features_json, shap_text)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                train_id,
                prediction.get("status", ""),
                is_degraded,
                bool(prediction.get("anomaly_flag")),
                prediction.get("p10_delay_min"),
                prediction.get("p50_delay_min"),
                prediction.get("p90_delay_min"),
                stale_since,
                last_updated,
                provenance.get("git_commit"),
                provenance.get("dataset_sha256"),
                provenance.get("saved_model_artifact_sha256"),
                (
                    json.dumps(prediction.get("input_features"))
                    if prediction.get("input_features")
                    else None
                ),
                prediction.get("shap_text"),
            ),
        )

        conn.commit()
        conn.close()

        return prediction

    def now_utc() -> datetime:
        return datetime.now(timezone.utc)

    @app.get("/system/mode", tags=["system"])
    def get_mode() -> dict:
        live_configured = bool(os.environ.get("RIPPLEETA_API_KEY"))
        requested = os.environ.get("RIPPLEETA_MODE", "replay").upper()
        mode = "LIVE" if requested == "LIVE" and live_configured else "REPLAY"
        return {
            "mode": mode,
            "source": (
                "RTIS/CRIS provider"
                if mode == "LIVE"
                else "local historical snapshot and graph replay"
            ),
            "live_feed_configured": live_configured,
            "refresh_interval_seconds": 60 if mode == "LIVE" else None,
        }

    @app.get("/system/status", response_model=SystemStatusResponse, tags=["system"])
    def system_status() -> SystemStatusResponse:
        mode = get_mode()
        return SystemStatusResponse(
            **mode,
            supported_train_count=len(prediction_service.supported_train_ids()),
            model_loaded=prediction_service.model_loaded,
        )

    @app.get("/trains", response_model=list[SupportedTrain], tags=["prediction"])
    def supported_trains() -> list[SupportedTrain]:
        return [
            SupportedTrain(train_id=train_id)
            for train_id in prediction_service.supported_train_ids()
        ]

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="rippleeta",
            model_loaded=prediction_service.model_loaded,
        )

    @app.get("/graph/demo", response_model=GraphDemoResponse, tags=["graph"])
    def graph_demo() -> GraphDemoResponse:
        result = run_worked_example(verbose=False)["scenario_b"]
        return GraphDemoResponse(
            status="REPLAYED STATION-PAIR SCENARIO",
            section="KANPUR -> ALLAHABAD",
            delaying_train="56789",
            affected_train="12301",
            source_delay_min=15.0,
            base_delay_min=55.0,
            conflict_addition_min=result["conflict_min"],
            final_delay_min=result["alld_delay_min"],
            historical_stations=[
                StationHistory(
                    station_code="NDLS",
                    station_name="New Delhi",
                    scheduled_arrival=now_utc(),
                    actual_arrival=now_utc(),
                    delay_min=0.0,
                    status="departed",
                ),
                StationHistory(
                    station_code="CNB",
                    station_name="Kanpur Central",
                    scheduled_arrival=now_utc(),
                    actual_arrival=now_utc(),
                    delay_min=12.5,
                    status="departed",
                ),
                StationHistory(
                    station_code="PRYJ",
                    station_name="Prayagraj Jn",
                    scheduled_arrival=now_utc(),
                    actual_arrival=None,
                    delay_min=26.5,
                    status="en_route",
                ),
            ],
            message=(
                "Real timed-event graph computation on a corrected two-train "
                "station-pair replay; not a live network backtest."
            ),
            source_type="local_replay",
            generated_at=now_utc(),
        )

    @app.get("/graph/sandbox", response_model=SandboxResponse, tags=["graph"])
    def graph_sandbox(
        source_delay: float = Query(
            default=15.0,
            ge=0,
            le=60,
            description="Delay in minutes to inject on Train 56789 (Express)",
        ),
    ) -> SandboxResponse:
        from src.graph.sandbox_endpoint import compute_sandbox_propagation

        result = compute_sandbox_propagation(source_delay)
        return SandboxResponse(**result)

    @app.get("/demo-launcher", tags=["demo"])
    def demo_launcher():
        """Direct entry point to the 7-Role Demo Launcher for live evaluations."""
        return RedirectResponse(url="/dashboard/index.html#roles")

    @app.get("/api/auth/config", tags=["auth"])
    def auth_config() -> dict:
        client_id = os.getenv("GOOGLE_CLIENT_ID")
        if client_id and not client_id.startswith("your-real-"):
            return {"auth_configured": True, "google_client_id": client_id}
        # A placeholder client id renders a Google button that can never
        # complete sign-in.  Tell the UI the truth and leave demo sign-in
        # available until a real OAuth client id is configured.
        return {"auth_configured": False, "google_client_id": None}

    @app.post("/api/auth/google", tags=["auth"])
    def google_login(req: GoogleLoginRequest, response: Response):
        try:
            idinfo = verify_google_token(req.credential)
            email = idinfo.get("email")
            if not email:
                raise ValueError("Google token did not include an email address.")
            role = "passenger"
            if "station" in email.lower():
                role = "station_master"
            if "crew" in email.lower():
                role = "crew_controller"
            if "feeder" in email.lower():
                role = "feeder_transport"
            if "maintenance" in email.lower():
                role = "maintenance"

            token = create_session_token(email, role)
            response.set_cookie(
                key="rippleeta_session", value=token, httponly=True, samesite="lax"
            )
            return {"success": True, "role": role}
        except Exception as e:
            return {"success": False, "error": str(e)}

    @app.post("/api/auth/demo", tags=["auth"])
    def demo_login(req: DemoLoginRequest, response: Response):
        # Demo routing is not an authorization boundary.  Accept the labels
        # emitted by both the current UI and older bookmarked dashboard pages,
        # then issue the canonical role used by route guards.
        role_key = req.role.strip().lower().replace("-", "_").replace(" ", "_")
        role = {
            "stationmaster": "station_master",
            "station_master": "station_master",
            "crewcontroller": "crew_controller",
            "crew_controller": "crew_controller",
            "feedertransport": "feeder_transport",
            "feeder_transport": "feeder_transport",
            "controlroom": "control_room",
            "control_room": "control_room",
        }.get(role_key, role_key)
        token = create_session_token(req.email, role)
        response.set_cookie(
            key="rippleeta_session", value=token, httponly=True, samesite="lax"
        )
        return {"success": True, "role": role}

    @app.get("/api/stats", tags=["system"])
    def system_stats():
        # Read from predictions_history.db or just return a simple state for now.
        import sqlite3

        try:
            conn = sqlite3.connect("predictions_history.db")
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM prediction_logs")
            count = cursor.fetchone()[0]
            conn.close()
            return {
                "total_predictions_served": count,
                "supported_train_count": len(prediction_service.supported_train_ids()),
                "source": get_mode()["source"],
            }
        except Exception:
            return {"total_predictions_served": 0}

    @app.get("/api/me", tags=["auth"])
    def get_me(user: dict = Depends(get_current_user)):
        return {"email": user.get("sub"), "role": user.get("role")}

    @app.get(
        "/predict/{train_id}/passenger",
        response_model=PassengerResponse,
        tags=["stakeholders"],
    )
    def passenger(
        train_id: str,
        user: dict = Depends(role_required("passenger")),
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> PassengerResponse:
        prediction = get_prediction(train_id, prediction_variance)
        delay = prediction["p50_delay_min"]
        trend_val = get_trend(train_id, delay)
        return PassengerResponse(
            train_id=train_id,
            status=prediction["status"],
            delay_min=delay,
            trend=trend_val,
            next_update_at=now_utc() + timedelta(minutes=30),
            message=(
                "Prediction suspended; the current delay pattern is unusual."
                if prediction["anomaly_flag"]
                else f"Expected delay is {delay:.1f} minutes; temporal trend is unavailable in this snapshot."
            ),
        )

    @app.get(
        "/predict/{train_id}/station-master",
        response_model=StationMasterResponse,
        tags=["stakeholders"],
    )
    def station_master(
        train_id: str,
        user: dict = Depends(role_required("station_master")),
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> StationMasterResponse:
        prediction = get_prediction(train_id, prediction_variance)
        decision: Literal["COMMIT", "DEFER", "SUSPENDED"]
        if prediction["anomaly_flag"]:
            decision = "SUSPENDED"
            decision_time = None
        else:
            width = prediction["p90_delay_min"] - prediction["p10_delay_min"]
            decision = "COMMIT" if width <= 30 else "DEFER"
            decision_time = round(max(0.0, 90.0 - width), 1)

        urgency: Literal["critical", "high", "normal", "low"]
        if prediction["anomaly_flag"]:
            radio = f"Control to Station, Train {train_id} prediction suspended due to anomaly. Fallback to manual charts. Over."
            urgency = "critical"
        else:
            delay_str = (
                str(int(prediction["p50_delay_min"]))
                if prediction.get("p50_delay_min")
                else "unknown"
            )
            radio = f"Station Master, Train {train_id} estimated {delay_str} minutes late. {decision} platform. Over."
            urgency = (
                "critical"
                if decision_time is not None and decision_time < 15
                else "high" if decision == "DEFER" else "normal"
            )

        return StationMasterResponse(
            train_id=train_id,
            status=prediction["status"],
            platform_commit=decision,
            time_until_decision_needed_min=decision_time,
            p10_delay_min=prediction["p10_delay_min"],
            p90_delay_min=prediction["p90_delay_min"],
            message=(
                "Commit platform now."
                if decision == "COMMIT"
                else "Defer platform commitment until uncertainty narrows."
            ),
            radio_summary=radio,
            urgency_rank=urgency,
            cost_asymmetry_applied=True,
            # STATUS: NOT IMPLEMENTED (docs/LIMITATIONS.md "Phase 1 Audit
            # Disclosures"). A true network-criticality ranking needs
            # counterfactual simulation across the full schedule; this
            # always sends 0, which the frontend replaces with its own
            # hardcoded fallback display value — see dashboard/app.js.
            ripple_score=0,
            # STATUS: NOT IMPLEMENTED — stub string, no station-pair
            # occupancy data available from the current snapshot.
            cross_train_attribution="Not available from the current station-event snapshot.",
            # STATUS: NOT IMPLEMENTED here — always 0. dashboard/app.js
            # falls back to its own client-side proxy formula
            # (p50_delay_min * a hardcoded Rs/min constant) whenever this
            # is falsy, which is every request; see docs/LIMITATIONS.md
            # section 3 ("Prescriptive Tier: proxy constants").
            financial_impact_inr=0,
        )

    @app.get(
        "/predict/{train_id}/crew-controller",
        response_model=CrewControllerResponse,
        tags=["stakeholders"],
    )
    def crew_controller(
        train_id: str,
        user: dict = Depends(role_required("crew_controller")),
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> CrewControllerResponse:
        prediction = get_prediction(train_id, prediction_variance)
        deadline = None
        if prediction["p50_delay_min"] is not None:
            deadline = now_utc() + timedelta(
                minutes=max(15.0, 120.0 - prediction["p90_delay_min"])
            )
        return CrewControllerResponse(
            train_id=train_id,
            status=prediction["status"],
            relief_dispatch_deadline=deadline,
            predicted_delay_min=prediction["p50_delay_min"],
            message=(
                "Suspend automated relief timing and escalate."
                if deadline is None
                else "Dispatch relief against the predicted arrival window."
            ),
        )

    @app.get(
        "/predict/{train_id}/feeder-transport",
        response_model=FeederTransportResponse,
        tags=["stakeholders"],
    )
    def feeder_transport(
        train_id: str,
        user: dict = Depends(role_required("feeder_transport")),
        cutoff_time: datetime = Query(
            description="UTC cutoff by which the train should arrive."
        ),
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> FeederTransportResponse:
        prediction = get_prediction(train_id, prediction_variance)
        if cutoff_time.tzinfo is None:
            cutoff_time = cutoff_time.replace(tzinfo=timezone.utc)
        now = now_utc()
        minutes_until_cutoff = (cutoff_time - now).total_seconds() / 60.0
        probability = None
        recommendation: Literal["WAIT", "DEPART", "USE JUDGMENT", "SUSPEND"] = "SUSPEND"
        if prediction["p50_delay_min"] is not None:
            sigma = max(
                (prediction["p90_delay_min"] - prediction["p10_delay_min"]) / 2.56, 1.0
            )
            probability = NormalDist(prediction["p50_delay_min"], sigma).cdf(
                minutes_until_cutoff
            )
            recommendation = (
                "WAIT"
                if probability >= 0.8
                else "DEPART" if probability < 0.4 else "USE JUDGMENT"
            )
        return FeederTransportResponse(
            train_id=train_id,
            status=prediction["status"],
            cutoff_time=cutoff_time,
            probability_arrival_before_cutoff=(
                None if probability is None else round(probability, 3)
            ),
            recommendation=recommendation,
            message=(
                "Hold the feeder."
                if recommendation == "WAIT"
                else (
                    "Depart on schedule."
                    if recommendation == "DEPART"
                    else "Use dispatcher judgment with the current interval."
                )
            ),
        )

    @app.get(
        "/predict/{train_id}/maintenance",
        response_model=MaintenanceResponse,
        tags=["stakeholders"],
    )
    def maintenance(
        train_id: str,
        user: dict = Depends(role_required("maintenance")),
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
            message=(
                "Request intervention or compressed maintenance."
                if adequate is False
                else "Standard turnaround window remains available."
            ),
        )

    @app.get(
        "/predict/{train_id}", response_model=PredictionResponse, tags=["prediction"]
    )
    def predict(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> PredictionResponse:
        prediction = get_prediction(train_id, prediction_variance)
        prediction.pop("train_id", None)
        # get_prediction() already computes the correct reason string for
        # every state (active / degraded fallback / stale-widened /
        # anomaly-suspended) — preserve it rather than discarding it, so a
        # degraded or stale response doesn't come back looking like a
        # normal, fully-confident prediction.
        original_message = prediction.pop("message", None)
        # STATUS: HARDCODED, not PARTIAL/proxy. docs/LIMITATIONS.md section 2
        # describes these as "injected via deterministic proxy logic (hashing
        # the Train ID)" — that hash-based logic does not exist in this
        # handler (see the removed fix_tid_hash.py in git history for where
        # it apparently once lived). Every response gets the same static
        # off/zero values below regardless of train_id; the doc description
        # is stale relative to this code. Schemas/UI wiring are real; the
        # values themselves are not computed at all.
        prediction["weather_risk_flag"] = "none"
        prediction["tsr_active"] = False
        prediction["signal_aspect_restriction"] = False
        prediction["unscheduled_maintenance_block"] = False
        prediction["downstream_congestion_score"] = 0.0

        return PredictionResponse(
            train_id=train_id,
            generated_at=now_utc(),
            message=original_message
            or (
                "Prediction suspended — anomalous conditions."
                if prediction["anomaly_flag"]
                else "Calibrated network-aware prediction."
            ),
            **prediction,
        )

    return app


app = create_app()

# Mount the static frontends
internal_frontend = Path(__file__).resolve().parent.parent.parent / "frontend"
external_frontend = (
    Path(__file__).resolve().parent.parent.parent.parent / "outliers-frontend"
)
frontend_path = internal_frontend if internal_frontend.exists() else external_frontend
dashboard_path = Path(__file__).resolve().parent.parent.parent / "dashboard"

if dashboard_path.exists():
    app.mount(
        "/dashboard",
        StaticFiles(directory=str(dashboard_path), html=True),
        name="dashboard",
    )

if frontend_path.exists():
    app.mount(
        "/", StaticFiles(directory=str(frontend_path), html=True), name="frontend"
    )
