import pandas as pd
import numpy as np
from datetime import datetime
from pathlib import Path
import sys
import logging
from src.model_promotion import evaluate_promotion

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.pipeline import RippleETAPipeline
from src.features.engineering import engineer_all_features
from src.calibration.conformal import train_and_calibrate, DEFAULT_FEATURES

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def run_nightly_job():
    print(f"[{datetime.now().isoformat()}] Starting Nightly MAPIE Recalibration Job...")

    # ---------------------------------------------------------------------
    # STEP 1 & 2: GROUND TRUTH & DRIFT CALCULATION (BACKTEST MODE)
    # ---------------------------------------------------------------------
    print(
        "MODE: BACKTEST - Computing drift against historical slice as proxy for live actuals."
    )

    p = RippleETAPipeline()
    try:
        p._load()
    except Exception as e:
        print(f"Could not load existing pipeline: {e}")
        return

    processed_path = Path(
        p.config.get("data", {}).get(
            "processed_path", "data/processed/kaggle_competition_cleaned.parquet"
        )
    )
    if not processed_path.exists():
        print(f"ERROR: Dataset not found at {processed_path}. Skipping recalibration.")
        return

    # Load real data
    df = pd.read_parquet(processed_path)
    df = engineer_all_features(df)
    features = DEFAULT_FEATURES
    target = "actual_delay_minutes"

    df = df.dropna(subset=features + [target])

    if len(df) < 50:
        print("Insufficient data for calibration, skipping.")
        return

    # Freeze the newest chronological slice for an apples-to-apples comparison.
    holdout_size = max(1, min(2000, len(df) // 5))
    df_recent_actuals = df.sort_values("journey_date").tail(holdout_size)

    # Predict with CURRENT model
    print(f"Evaluating {len(df_recent_actuals)} recent journeys...")
    X_recent = df_recent_actuals[features]
    y_actual = df_recent_actuals[target].values

    # Extract current P50 predictions
    current_preds = p._prediction_pipeline.predict(X_recent)
    p50s = np.array([r["p50_delay_min"] for r in current_preds])

    # Compute REAL MAE
    mae = np.mean(np.abs(p50s - y_actual))
    print(f"Current rolling MAE on new actuals: {mae:.2f} minutes.")

    # Compute current coverage for before/after comparison
    p10s = np.array([r["p10_delay_min"] for r in current_preds])
    p90s = np.array([r["p90_delay_min"] for r in current_preds])
    current_coverage = np.mean((y_actual >= p10s) & (y_actual <= p90s))
    print(f"Current MAPIE coverage: {current_coverage*100:.1f}%")

    # ---------------------------------------------------------------------
    # STEP 3: REAL TRIGGER
    # ---------------------------------------------------------------------
    # Keep the trigger deliberately simple for the hackathon job.
    DRIFT_THRESHOLD = 15.0
    if mae > DRIFT_THRESHOLD:
        print(
            f"Drift threshold exceeded (> {DRIFT_THRESHOLD} min). Triggering XGBoost/MAPIE retrain..."
        )
        try:
            candidate_engine, metrics = train_and_calibrate(
                df=df,
                features=features,
                target=target,
                save_path=None,
                model_config={
                    **p.config.get("model", {}),
                    **p.config.get("calibration", {}),
                },
            )
            print(
                f"BEFORE -> MAE: {mae:.2f} min | Coverage: {current_coverage*100:.1f}%"
            )
            print(f"CANDIDATE -> internal holdout metrics: {metrics}")
            candidate_preds = candidate_engine.predict(X_recent)
            decision = evaluate_promotion(
                y_actual,
                current_preds,
                candidate_preds,
                current_model="deployed",
                candidate_model="candidate",
            )
            logging.warning(
                "Candidate evaluated but never auto-deployed: %s; pinball %.4f -> %.4f; coverage %.1f%% -> %.1f%%",
                decision.reason,
                decision.current_pinball,
                decision.candidate_pinball,
                decision.current_coverage * 100,
                decision.candidate_coverage * 100,
            )
        except Exception as e:
            print(f"CRITICAL: Recalibration failed. Model was not updated. Error: {e}")
    else:
        print("Error within acceptable limits. No recalibration necessary.")

    print("Nightly job complete. Feedback loop closed.")


if __name__ == "__main__":
    run_nightly_job()
