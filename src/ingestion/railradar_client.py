import os
import json
import logging
import time
from typing import Optional
from pathlib import Path
import pandas as pd
import requests
from pydantic import BaseModel, Field, ValidationError, model_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration & Mode
# ---------------------------------------------------------------------------
BASE_URL = "https://api.railradar.in/v1"
API_KEY = os.environ.get("RIPPLEETA_API_KEY", "")
MIN_REQUEST_INTERVAL_SEC = 12
MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 30

RIPPLEETA_MODE = os.environ.get("RIPPLEETA_MODE", "live").lower()
if RIPPLEETA_MODE == "replay":
    logger.info("Starting in REPLAY MODE. External API calls are disabled.")

# ---------------------------------------------------------------------------
# Validation Schemas & State
# ---------------------------------------------------------------------------
_KNOWN_STATIONS = set()
try:
    _timetable_path = Path("data/processed/timetable_processed.parquet")
    if _timetable_path.exists():
        _df = pd.read_parquet(_timetable_path, columns=["station_code"])
        _KNOWN_STATIONS = set(_df["station_code"].dropna().unique())
        # For replay mock stations:
        _KNOWN_STATIONS.update(["NDLS", "KANPUR", "ALLAHABAD", "MUGHAL", "HWH", "MMCT", "SURAT", "BRC"])
except Exception:
    pass

_VALIDATION_METRICS = {
    "live_status_processed": 0, "live_status_rejected": 0,
    "route_processed": 0, "route_rejected": 0,
    "dedup_rejected": 0, "stale_rejected": 0
}

_WATERMARKS = {}
_PROCESSED_PINGS = set()

def get_validation_metrics():
    return _VALIDATION_METRICS.copy()


class LiveStatusSchema(BaseModel):
    train_number: str
    current_station: str
    delay_min: float = Field(..., ge=-500, le=5000)
    lat: Optional[float] = None
    lng: Optional[float] = None
    last_updated: Optional[str] = None
    journey_date: Optional[str] = None
    event_type: Optional[str] = None
    
    @model_validator(mode='after')
    def validate_geo_and_station(self):
        if self.lat is not None and self.lng is not None:
            if not (6.0 <= self.lat <= 36.0 and 68.0 <= self.lng <= 98.0):
                raise ValueError("GPS outside India bounding box")
        if _KNOWN_STATIONS and self.current_station not in _KNOWN_STATIONS:
            raise ValueError(f"Station {self.current_station} not known.")
        return self

class RouteStationSchema(BaseModel):
    station_code: str
    seq: int
    arrival_min: Optional[float] = None
    departure_min: Optional[float] = None
    
    @model_validator(mode='after')
    def validate_known_station(self):
        if _KNOWN_STATIONS and self.station_code not in _KNOWN_STATIONS:
            raise ValueError(f"Station {self.station_code} not known.")
        return self

class RouteSchema(BaseModel):
    train_number: Optional[str] = None
    stations: list[RouteStationSchema]
    
    @model_validator(mode='after')
    def validate_monotonic_seq(self):
        if self.stations:
            seqs = [st.seq for st in self.stations]
            if not all(seqs[i] < seqs[i+1] for i in range(len(seqs)-1)):
                raise ValueError("Sequence numbers not strictly monotonic.")
        return self

class _RateLimiter:
    def __init__(self, min_interval: float = MIN_REQUEST_INTERVAL_SEC):
        self.min_interval = min_interval
        self._last_call: float = 0.0

    def wait(self) -> None:
        elapsed = time.time() - self._last_call
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last_call = time.time()

_limiter = _RateLimiter()

def _get(endpoint: str, params: Optional[dict] = None) -> dict:
    url = f"{BASE_URL}{endpoint}"
    for attempt in range(1, MAX_RETRIES + 1):
        _limiter.wait()
        try:
            resp = requests.get(url, headers={"Authorization": f"Bearer {API_KEY}"}, params=params, timeout=15)
        except requests.ConnectionError:
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SEC)
                continue
            raise
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 429:
            time.sleep(RETRY_BACKOFF_SEC * (2 ** (attempt - 1)))
            continue
        resp.raise_for_status()
    raise RuntimeError(f"Exhausted {MAX_RETRIES} retries for {url}")

import sqlite3

def _load_replay_fixture(filename: str) -> dict:
    # Example filename: "12301_live.json"
    parts = filename.replace(".json", "").split("_")
    if len(parts) < 2:
        raise FileNotFoundError(f"Invalid replay filename: {filename}")
        
    train_number = parts[0]
    table = "live_status" if parts[1] == "live" else "route"
    
    db_path = Path("data/replay/ntes_capture.db")
    if not db_path.exists():
        raise FileNotFoundError(f"Seeded database {db_path} not found. Run 'make seed' first.")
        
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute(f"SELECT data FROM {table} WHERE train_number=?", (train_number,))
    row = c.fetchone()
    conn.close()
    
    if row is None:
        raise FileNotFoundError(f"Replay data for {train_number} not found in DB.")
        
    return json.loads(row[0])

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def get_live_status(train_number: str) -> Optional[dict]:
    if RIPPLEETA_MODE == "replay":
        try:
            raw_data = _load_replay_fixture(f"{train_number}_live.json")
        except FileNotFoundError:
            return None
    else:
        raw_data = _get(f"/trains/{train_number}/live")
        
    _VALIDATION_METRICS["live_status_processed"] += 1
    try:
        valid_ping = LiveStatusSchema(**raw_data).model_dump()
    except ValidationError as e:
        _VALIDATION_METRICS["live_status_rejected"] += 1
        logger.error(f"[SCHEMA VALIDATION FAILED] {e.errors()}")
        return None

    # --- DEDUPLICATION & WATERMARKING ---
    station = valid_ping.get("current_station")
    journey_date = valid_ping.get("journey_date")
    event_type = valid_ping.get("event_type")
    last_updated_str = valid_ping.get("last_updated")
    
    # Step 1: Deduplication
    if journey_date and event_type and station:
        ping_key = (train_number, journey_date, station, event_type)
        if ping_key in _PROCESSED_PINGS:
            logger.warning(f"[DEDUPLICATION] Rejecting duplicate ping for {ping_key}")
            _VALIDATION_METRICS["dedup_rejected"] += 1
            return None
        _PROCESSED_PINGS.add(ping_key)

    # Step 2: Watermarking
    if last_updated_str:
        try:
            from datetime import datetime
            ping_time = datetime.fromisoformat(last_updated_str.replace("Z", "+00:00"))
            watermark = _WATERMARKS.get(train_number)
            
            if watermark and ping_time < watermark:
                logger.warning(f"[WATERMARK REJECT] Stale ping for {train_number}. Ping time: {ping_time}, Watermark: {watermark}")
                _VALIDATION_METRICS["stale_rejected"] += 1
                return None
                
            _WATERMARKS[train_number] = ping_time
        except ValueError:
            pass

    return valid_ping

def get_route(train_number: str) -> Optional[dict]:
    if RIPPLEETA_MODE == "replay":
        try:
            raw_data = _load_replay_fixture(f"{train_number}_route.json")
        except FileNotFoundError:
            return None
    else:
        raw_data = _get(f"/trains/{train_number}/route")
        
    _VALIDATION_METRICS["route_processed"] += 1
    try:
        return RouteSchema(**raw_data).model_dump()
    except ValidationError as e:
        _VALIDATION_METRICS["route_rejected"] += 1
        logger.error(f"[SCHEMA VALIDATION FAILED] {e.errors()}")
        return None
