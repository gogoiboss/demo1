import sys
from pathlib import Path
import pandas as pd
import numpy as np

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.features.engineering import engineer_all_features
from src.calibration.conformal import CalibratedETAEngine, DEFAULT_FEATURES
from src.pipeline import RippleETAPipeline

def pinball_loss(y_true, y_pred, alpha):
    """Computes the quantile (pinball) loss."""
    diff = y_true - y_pred
    return np.where(diff >= 0, alpha * diff, (alpha - 1) * diff).mean()

def run_comparison():
    print("Loading data and recreating chronological test split...")
    
    # 1. Load Data & Engineer Features
    processed_path = Path("data/processed/kaggle_competition_cleaned.parquet")
    df = pd.read_parquet(processed_path)
    df = engineer_all_features(df)
    target = "actual_delay_minutes"
    
    df = df.dropna(subset=DEFAULT_FEATURES + [target])
    df_sorted = df.sort_values("journey_date").reset_index(drop=True)
    
    # 2. Slice the exact 15% chronological holdout
    n = len(df_sorted)
    cal_end = int(n * 0.85)
    df_test = df_sorted.iloc[cal_end:].copy()
    
    print(f"Test set size: {len(df_test)} rows (Chronologically strictly future data).")
    
    y_actual = df_test[target].values
    
    # 3. Model 1: Scheduled ETA (Always 0 delay)
    scheduled_preds = np.zeros_like(y_actual)
    
    # 4. Model 2: Prior-Leg Baseline
    prior_leg_preds = df_test["prior_leg_delay"].values
    
    # 5. Model 3: RippleETA (Full XGBoost + MAPIE)
    print("Loading RippleETA Pipeline...")
    p = RippleETAPipeline()
    p._load()
    X_test = df_test[DEFAULT_FEATURES]
    ripple_results = p._prediction_pipeline.predict(X_test)
    
    ripple_p50 = np.array([r["p50_delay_min"] for r in ripple_results])
    ripple_p10 = np.array([r["p10_delay_min"] for r in ripple_results])
    ripple_p90 = np.array([r["p90_delay_min"] for r in ripple_results])
    
    # 6. Calculate Metrics
    results = []
    
    models = {
        "Scheduled ETA (Zero Delay)": {
            "p10": scheduled_preds, "p50": scheduled_preds, "p90": scheduled_preds
        },
        "Prior-Leg Baseline (Naive)": {
            "p10": prior_leg_preds, "p50": prior_leg_preds, "p90": prior_leg_preds
        },
        "RippleETA (XGBoost + MAPIE)": {
            "p10": ripple_p10, "p50": ripple_p50, "p90": ripple_p90
        }
    }
    
    baseline_mae = None
    
    for name, preds in models.items():
        # MAE is calculated on P50 / Point Estimate
        mae = np.mean(np.abs(y_actual - preds["p50"]))
        
        if name == "Prior-Leg Baseline (Naive)":
            baseline_mae = mae
            
        # Pinball loss averaged across P10, P50, P90 bounds
        loss_p10 = pinball_loss(y_actual, preds["p10"], 0.1)
        loss_p50 = pinball_loss(y_actual, preds["p50"], 0.5)
        loss_p90 = pinball_loss(y_actual, preds["p90"], 0.9)
        avg_pinball = (loss_p10 + loss_p50 + loss_p90) / 3.0
        
        results.append({
            "Model": name,
            "MAE (mins)": mae,
            "Pinball Loss": avg_pinball
        })
        
    # 7. Print Markdown Table
    print("\n### Baseline Comparison Results (Global 1,500-row held-out set)\n")
    print("| Model | MAE (mins) | Pinball Loss | vs Prior-Leg (%) |")
    print("| :--- | :--- | :--- | :--- |")
    
    for r in results:
        mae = r["MAE (mins)"]
        pb = r["Pinball Loss"]
        
        if baseline_mae is not None and baseline_mae > 0:
            diff_pct = ((mae - baseline_mae) / baseline_mae) * 100
            if diff_pct > 0:
                vs_base = f"+{diff_pct:.1f}% (worse)"
            elif diff_pct < 0:
                vs_base = f"{diff_pct:.1f}% (better)"
            else:
                vs_base = "Baseline"
        else:
            vs_base = "N/A"
            
        print(f"| {r['Model']} | {mae:.2f} | {pb:.2f} | {vs_base} |")

if __name__ == "__main__":
    run_comparison()
