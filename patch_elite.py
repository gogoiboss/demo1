with open("src/api/models.py", "r", encoding="utf-8") as f:
    text = f.read()

# Add Radio Summary and Urgency Rank to StationMasterResponse
old_sm = """class StationMasterResponse(BaseModel):
    train_id: str
    status: str
    platform_commit: Literal["COMMIT", "DEFER", "SUSPENDED"]
    time_until_decision_needed_min: float | None
    p10_delay_min: float | None
    p90_delay_min: float | None
    message: str"""

new_sm = """class StationMasterResponse(BaseModel):
    train_id: str
    status: str
    platform_commit: Literal["COMMIT", "DEFER", "SUSPENDED"]
    time_until_decision_needed_min: float | None
    p10_delay_min: float | None
    p90_delay_min: float | None
    message: str
    radio_summary: str = ""
    urgency_rank: Literal["critical", "high", "normal", "low"] = "normal"
    cost_asymmetry_applied: bool = True"""

text = text.replace(old_sm, new_sm)

# Add Cost Asymmetry to Passenger
old_pass = """class PassengerResponse(BaseModel):
    train_id: str
    status: str
    delay_min: float | None
    trend: Literal["stable", "worsening", "improving", "unknown"]
    next_update_at: datetime
    message: str"""

new_pass = """class PassengerResponse(BaseModel):
    train_id: str
    status: str
    delay_min: float | None
    trend: Literal["stable", "worsening", "improving", "unknown"]
    next_update_at: datetime
    message: str
    cost_asymmetry_applied: bool = True"""

text = text.replace(old_pass, new_pass)

with open("src/api/models.py", "w", encoding="utf-8") as f:
    f.write(text)

with open("src/api/app.py", "r", encoding="utf-8") as f:
    text = f.read()

old_sm_endpoint = """        return StationMasterResponse(
            train_id=train_id,
            status=prediction["status"],
            platform_commit=decision,
            time_until_decision_needed_min=decision_time,
            p10_delay_min=prediction["p10_delay_min"],
            p90_delay_min=prediction["p90_delay_min"],
            message="Commit platform now." if decision == "COMMIT" else "Defer platform commitment until uncertainty narrows.",
        )"""

new_sm_endpoint = """        
        if prediction["anomaly_flag"]:
            radio = f"Control to Station, Train {train_id} prediction suspended due to anomaly. Fallback to manual charts. Over."
            urgency = "critical"
        else:
            delay_str = str(int(prediction["p50_delay_min"])) if prediction.get("p50_delay_min") else "unknown"
            radio = f"Station Master, Train {train_id} estimated {delay_str} minutes late. {decision} platform. Over."
            urgency = "critical" if decision_time is not None and decision_time < 15 else "high" if decision == "DEFER" else "normal"

        return StationMasterResponse(
            train_id=train_id,
            status=prediction["status"],
            platform_commit=decision,
            time_until_decision_needed_min=decision_time,
            p10_delay_min=prediction["p10_delay_min"],
            p90_delay_min=prediction["p90_delay_min"],
            message="Commit platform now." if decision == "COMMIT" else "Defer platform commitment until uncertainty narrows.",
            radio_summary=radio,
            urgency_rank=urgency,
            cost_asymmetry_applied=True
        )"""

text = text.replace(old_sm_endpoint, new_sm_endpoint)

# Add cost asymmetry message to passenger
old_pass_endpoint = """        return PassengerResponse(
            train_id=train_id,
            status=prediction["status"],
            delay_min=delay,
            trend=trend_val,
            next_update_at=now_utc() + timedelta(minutes=30),
            message=(
                "Prediction suspended ?" anomalous conditions."
                if prediction["anomaly_flag"]
                else f"Expected delay is {delay:.1f} minutes; temporal trend is unavailable in this snapshot."
            ),
        )"""

new_pass_endpoint = """        return PassengerResponse(
            train_id=train_id,
            status=prediction["status"],
            delay_min=delay,
            trend=trend_val,
            next_update_at=now_utc() + timedelta(minutes=30),
            message=(
                "Prediction suspended ?" anomalous conditions."
                if prediction["anomaly_flag"]
                else f"Expected delay is {delay:.1f} minutes; temporal trend is unavailable in this snapshot."
            ),
            cost_asymmetry_applied=True
        )"""

text = text.replace(old_pass_endpoint, new_pass_endpoint)

with open("src/api/app.py", "w", encoding="utf-8") as f:
    f.write(text)

print("Models and App patched for Elite Features.")
