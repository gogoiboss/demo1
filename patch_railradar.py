with open("src/ingestion/railradar_client.py", "r", encoding="utf-8") as f:
    text = f.read()

import re

# 1. Add journey_date and event_type to LiveStatusSchema
schema_old = """    lat: Optional[float] = None
    lng: Optional[float] = None
    last_updated: Optional[str] = None"""
schema_new = """    lat: Optional[float] = None
    lng: Optional[float] = None
    last_updated: Optional[str] = None
    journey_date: Optional[str] = None
    event_type: Optional[str] = None"""
text = text.replace(schema_old, schema_new)

# 2. Add state objects and get_validation_metrics
state_old = """_VALIDATION_METRICS = {
    "live_status_processed": 0, "live_status_rejected": 0,
    "route_processed": 0, "route_rejected": 0
}"""
state_new = """_VALIDATION_METRICS = {
    "live_status_processed": 0, "live_status_rejected": 0,
    "route_processed": 0, "route_rejected": 0,
    "dedup_rejected": 0, "stale_rejected": 0
}

_WATERMARKS = {}
_PROCESSED_PINGS = set()

def get_validation_metrics():
    return _VALIDATION_METRICS.copy()
"""
text = text.replace(state_old, state_new)

# 3. Patch get_live_status
get_live_old = """    try:
        return LiveStatusSchema(**raw_data).model_dump()
    except ValidationError as e:
        _VALIDATION_METRICS["live_status_rejected"] += 1
        logger.error(f"[SCHEMA VALIDATION FAILED] {e.errors()}")
        return None"""

get_live_new = """    try:
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

    return valid_ping"""

text = text.replace(get_live_old, get_live_new)

with open("src/ingestion/railradar_client.py", "w", encoding="utf-8") as f:
    f.write(text)
print("railradar_client.py patched successfully.")
