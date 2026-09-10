with open("src/api/app.py", "r", encoding="utf-8") as f:
    text = f.read()

import re

# We will completely replace the `get_prediction` function in `src/api/app.py`.
new_get_prediction = """    def get_prediction(train_id: str, prediction_variance: float | None = None) -> dict:
        from src.ingestion.railradar_client import get_live_status
        import pandas as pd
        
        # 1. Fetch live status (Persistence, Staleness, and Degraded Fallback)
        live_status = get_live_status(train_id)
        is_stale = False
        last_updated = None
        current_delay = 0.0

        if live_status:
            current_delay = live_status.get("delay_min", 0.0)
            if live_status.get("last_updated"):
                try:
                    last_updated_dt = datetime.fromisoformat(live_status["last_updated"].replace("Z", "+00:00"))
                    last_updated = last_updated_dt.isoformat()
                    staleness_min = (now_utc() - last_updated_dt).total_seconds() / 60.0
                    STALE_THRESHOLD_MIN = 15.0  # Configurable threshold
                    if staleness_min > STALE_THRESHOLD_MIN:
                        is_stale = True
                except ValueError:
                    pass

        mock_state = pd.DataFrame([
            {"train_id": "12301", "station": "KANPUR", "event_type": "dep", "delay_min": 55.0},
            {"train_id": "56789", "station": "KANPUR", "event_type": "dep", "delay_min": 15.0},
            {"train_id": train_id, "station": "KANPUR", "event_type": "dep", "delay_min": current_delay}
        ])

        is_degraded = False
        try:
            # Core prediction call
            prediction = prediction_service.predict(train_id, current_state=mock_state, prediction_variance=prediction_variance)
        except Exception as exc:
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
                "message": f"ML unavailable. Using persistence baseline."
            }

        # FALLBACK 2: Anomaly Gate
        if prediction.get("anomaly_flag"):
            prediction["status"] = "suspended"
            prediction["message"] = "Prediction suspended: anomaly gate triggered (confidence too low to serve)."
            
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
        
        # LOGGING (Step 4)
        conn = sqlite3.connect('predictions_history.db')
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS prediction_logs 
                     (train_id TEXT, p50 REAL, p10 REAL, p90 REAL, status TEXT, degraded BOOLEAN, model_version TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
        model_version = "rippleeta-v1.0.0"
        c.execute('''INSERT INTO prediction_logs 
                     (train_id, p50, p10, p90, status, degraded, model_version) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)''', 
                  (train_id, prediction.get("p50_delay_min"), 
                   prediction.get("p10_delay_min"), 
                   prediction.get("p90_delay_min"), 
                   prediction.get("status", ""), 
                   is_degraded, 
                   model_version))
        conn.commit()
        conn.close()

        return prediction"""

pattern = re.compile(r'    def get_prediction\(train_id: str, prediction_variance: float \| None = None\) -> dict:.*?        return datetime\.now\(timezone\.utc\)', re.DOTALL)

text = pattern.sub(new_get_prediction + '\n\n    def now_utc() -> datetime:\n        return datetime.now(timezone.utc)', text)

with open("src/api/app.py", "w", encoding="utf-8") as f:
    f.write(text)
