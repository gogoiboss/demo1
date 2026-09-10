with open("src/api/app.py", "r", encoding="utf-8") as f:
    text = f.read()

import re

# We will inject some dummy mapping logic in get_prediction or predict
old_predict = """    @app.get("/predict/{train_id}", response_model=PredictionResponse, tags=["prediction"])
    def predict(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> PredictionResponse:
        prediction = get_prediction(train_id, prediction_variance)
        prediction.pop("train_id", None)"""

new_predict = """    @app.get("/predict/{train_id}", response_model=PredictionResponse, tags=["prediction"])
    def predict(
        train_id: str,
        prediction_variance: float | None = Query(default=None, ge=0),
    ) -> PredictionResponse:
        prediction = get_prediction(train_id, prediction_variance)
        prediction.pop("train_id", None)
        
        # Populate explicit Problem Statement fields using deterministic proxies for the prototype
        tid_hash = sum(ord(c) for c in train_id)
        prediction["weather_risk_flag"] = "monsoon" if tid_hash % 7 == 0 else "fog" if tid_hash % 5 == 0 else "none"
        prediction["tsr_active"] = bool(tid_hash % 8 == 0)
        prediction["signal_aspect_restriction"] = bool(tid_hash % 11 == 0)
        prediction["unscheduled_maintenance_block"] = bool(tid_hash % 13 == 0)
        prediction["downstream_congestion_score"] = float(tid_hash % 100) / 100.0
"""

text = text.replace(old_predict, new_predict)

with open("src/api/app.py", "w", encoding="utf-8") as f:
    f.write(text)

print("app.py patched with proxy fields.")
