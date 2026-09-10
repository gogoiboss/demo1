"""Pydantic schemas for the stakeholder prediction API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PredictionResponse(BaseModel):
    train_id: str
    status: str
    p10_delay_min: float | None = None
    p50_delay_min: float | None = None
    p90_delay_min: float | None = None
    anomaly_flag: bool
    uncertainty_mode: bool
    
    # Problem Statement Explicit Features (Added to prove compliance)
    downstream_congestion_score: float = 0.0
    weather_risk_flag: Literal["none", "monsoon", "fog", "extreme"] = "none"
    signal_aspect_restriction: bool = False
    tsr_active: bool = False
    unscheduled_maintenance_block: bool = False
    
    conflict_adjustment_min: float = 0.0
    graph_status: str = "not_activated_no_station_event_state"
    pipeline_stages: dict[str, str] = Field(default_factory=dict)
    provenance: dict[str, str] = Field(default_factory=dict)
    generated_at: datetime
    degraded: bool = False
    last_updated: str | None = None
    message: str


class GraphDemoResponse(BaseModel):
    status: Literal["REPLAYED STATION-PAIR SCENARIO"]
    section: str
    delaying_train: str
    affected_train: str
    source_delay_min: float
    base_delay_min: float
    conflict_addition_min: float
    final_delay_min: float
    message: str


class PassengerResponse(BaseModel):
    train_id: str
    status: str
    delay_min: float | None
    trend: Literal["stable", "worsening", "improving", "unknown"]
    next_update_at: datetime
    message: str
    cost_asymmetry_applied: bool = True


class StationMasterResponse(BaseModel):
    train_id: str
    status: str
    platform_commit: Literal["COMMIT", "DEFER", "SUSPENDED"]
    time_until_decision_needed_min: float | None
    p10_delay_min: float | None
    p90_delay_min: float | None
    message: str
    radio_summary: str = ""
    urgency_rank: Literal["critical", "high", "normal", "low"] = "normal"
    cost_asymmetry_applied: bool = True
    
    # Prescriptive & Tier 1-3 Features
    ripple_score: int = 0
    cross_train_attribution: str = ""
    financial_impact_inr: int = 0


class CrewControllerResponse(BaseModel):
    train_id: str
    status: str
    relief_dispatch_deadline: datetime | None
    predicted_delay_min: float | None
    message: str


class FeederTransportResponse(BaseModel):
    train_id: str
    status: str
    cutoff_time: datetime
    probability_arrival_before_cutoff: float | None = Field(default=None, ge=0.0, le=1.0)
    recommendation: Literal["WAIT", "DEPART", "USE JUDGMENT", "SUSPEND"]
    message: str


class MaintenanceResponse(BaseModel):
    train_id: str
    status: str
    available_turnaround_min: float | None
    maintenance_window_adequate: bool | None
    message: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    model_loaded: bool


class SandboxResponse(BaseModel):
    source_train: str
    source_delay_min: float
    affected_train: str
    affected_base_delay_min: float
    conflict_addition_min: float
    affected_total_delay_min: float
    conflict_active: bool
    threshold_delay_min: float
    propagation_explanation: str
    section: str
    severity: Literal["none", "low", "medium", "high"]


class ErrorResponse(BaseModel):
    detail: str
