"""Pydantic schemas for the stakeholder prediction API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PredictionResponse(BaseModel):
    train_id: str
    status: Literal["PREDICTION ACTIVE", "PREDICTION SUSPENDED — anomalous conditions"]
    p10_delay_min: float | None = None
    p50_delay_min: float | None = None
    p90_delay_min: float | None = None
    anomaly_flag: bool
    uncertainty_mode: bool
    conflict_adjustment_min: float = 0.0
    generated_at: datetime
    message: str


class PassengerResponse(BaseModel):
    train_id: str
    status: str
    delay_min: float | None
    trend: Literal["stable", "worsening", "improving", "unknown"]
    next_update_at: datetime
    message: str


class StationMasterResponse(BaseModel):
    train_id: str
    status: str
    platform_commit: Literal["COMMIT", "DEFER", "SUSPENDED"]
    time_until_decision_needed_min: float | None
    p10_delay_min: float | None
    p90_delay_min: float | None
    message: str


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


class ErrorResponse(BaseModel):
    detail: str
