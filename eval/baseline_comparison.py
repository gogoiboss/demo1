import sys
from pathlib import Path
import pandas as pd
import numpy as np
import yaml

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.features.engineering import engineer_all_features
from src.calibration.conformal import DEFAULT_FEATURES
from src.models.xgboost_model import build_model
from src.pipeline import RippleETAPipeline

# Features with every cross-journey / network-adjacent signal removed, so this
# model isolates whether the network-aware feature engineering (rake
# inheritance via prior_leg_delay) earns its complexity versus a plain
# per-journey regression that only sees static facts about this one journey.
SINGLE_TRAIN_FEATURES = [f for f in DEFAULT_FEATURES if f != "prior_leg_delay"]

def pinball_loss(y_true, y_pred, alpha):
    """Computes the quantile (pinball) loss."""
    diff = y_true - y_pred
    return np.where(diff >= 0, alpha * diff, (alpha - 1) * diff).mean()


def segment_metrics(
    y_actual: np.ndarray,
    models: dict[str, dict[str, np.ndarray]],
    segment_labels: np.ndarray,
) -> dict[str, dict[str, dict[str, float]]]:
    """Break MAE and pinball loss out per segment, per model.

    Parameters
    ----------
    y_actual : actual delay values (1-D array)
    models : {model_name: {"p10": arr, "p50": arr, "p90": arr}}, every array
        positionally aligned with `y_actual` (same row order, not pandas
        index labels)
    segment_labels : 1-D array of segment label strings/values, one per row,
        positionally aligned with `y_actual`

    Returns
    -------
    {segment_label: {model_name: {"n": int, "mae": float, "pinball": float}}}
    An empty segment (n=0, e.g. a `pd.cut` bucket with no rows) is omitted.
    """
    y_actual = np.asarray(y_actual)
    segment_labels = np.asarray(segment_labels, dtype=object)

    report: dict[str, dict[str, dict[str, float]]] = {}
    for segment in sorted({str(s) for s in segment_labels}):
        mask = np.array([str(s) == segment for s in segment_labels])
        n = int(mask.sum())
        if n == 0:
            continue
        report[segment] = {}
        y_seg = y_actual[mask]
        for model_name, preds in models.items():
            p10 = np.asarray(preds["p10"])[mask]
            p50 = np.asarray(preds["p50"])[mask]
            p90 = np.asarray(preds["p90"])[mask]
            mae = float(np.mean(np.abs(y_seg - p50)))
            avg_pinball = float(
                (pinball_loss(y_seg, p10, 0.1)
                 + pinball_loss(y_seg, p50, 0.5)
                 + pinball_loss(y_seg, p90, 0.9)) / 3.0
            )
            report[segment][model_name] = {
                "n": n,
                "mae": round(mae, 2),
                "pinball": round(avg_pinball, 2),
            }
    return report


def print_segment_table(title: str, report: dict[str, dict[str, dict[str, float]]]) -> None:
    print(f"\n### {title}\n")
    print("| Segment | Model | N | MAE (mins) | Pinball Loss |")
    print("| :--- | :--- | ---: | ---: | ---: |")
    for segment, model_stats in report.items():
        for model_name, stats in model_stats.items():
            print(f"| {segment} | {model_name} | {stats['n']} | {stats['mae']:.2f} | {stats['pinball']:.2f} |")

def run_comparison():
    print("Loading data and recreating chronological test split...")
    
    # 1. Load Data & Engineer Features
    processed_path = Path("data/processed/kaggle_competition_cleaned.parquet")
    df = pd.read_parquet(processed_path)
    df = engineer_all_features(df)
    target = "actual_delay_minutes"
    
    df = df.dropna(subset=DEFAULT_FEATURES + [target])
    df_sorted = df.sort_values("journey_date").reset_index(drop=True)
    
    # 2. Slice the exact chronological train / holdout split (matches
    #    config.yaml: train_fraction=0.70, cal_fraction=0.85)
    with open("config.yaml") as f:
        cfg = yaml.safe_load(f) or {}
    model_cfg = cfg.get("model", {})
    train_frac = float(model_cfg.get("train_fraction", 0.70))
    cal_frac = float(model_cfg.get("cal_fraction", 0.85))

    n = len(df_sorted)
    train_end = int(n * train_frac)
    cal_end = int(n * cal_frac)
    df_train = df_sorted.iloc[:train_end].copy()
    df_test = df_sorted.iloc[cal_end:].copy()

    print(f"Test set size: {len(df_test)} rows (Chronologically strictly future data).")

    y_actual = df_test[target].values

    # 3. Model 1: Scheduled ETA (Always 0 delay)
    scheduled_preds = np.zeros_like(y_actual)

    # 4. Model 2: Prior-Leg Baseline
    prior_leg_preds = df_test["prior_leg_delay"].values

    # 5. Model 3: Per-Train Regression (no network / cross-journey features)
    # Same chronological training slice, same XGBoost hyperparameters, but
    # trained without prior_leg_delay — isolates whether the rake-inheritance
    # feature (the network-aware signal) is earning its complexity.
    print("Training per-train-only XGBoost regressor (no rake-inheritance feature)...")
    single_train_model = build_model(model_cfg)
    single_train_model.fit(df_train[SINGLE_TRAIN_FEATURES], df_train[target])
    single_train_preds = single_train_model.predict(df_test[SINGLE_TRAIN_FEATURES])

    # 6. Model 4: RippleETA (Full XGBoost + MAPIE)
    print("Loading RippleETA Pipeline...")
    p = RippleETAPipeline()
    p._load()
    X_test = df_test[DEFAULT_FEATURES]
    ripple_results = p._prediction_pipeline.predict(X_test)

    ripple_p50 = np.array([r["p50_delay_min"] for r in ripple_results])
    ripple_p10 = np.array([r["p10_delay_min"] for r in ripple_results])
    ripple_p90 = np.array([r["p90_delay_min"] for r in ripple_results])

    # 7. Calculate Metrics
    results = []

    models = {
        "Scheduled ETA (Zero Delay)": {
            "p10": scheduled_preds, "p50": scheduled_preds, "p90": scheduled_preds
        },
        "Prior-Leg Baseline (Naive)": {
            "p10": prior_leg_preds, "p50": prior_leg_preds, "p90": prior_leg_preds
        },
        "Per-Train Regression (No Network Features)": {
            "p10": single_train_preds, "p50": single_train_preds, "p90": single_train_preds
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
        
    # 8. Print Markdown Table
    print(f"\n### Baseline Comparison Results ({len(df_test)}-row chronological held-out set)\n")
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

    # 9. Segmented evaluation — by delay magnitude, forecast horizon, and zone
    delay_segments = pd.cut(
        pd.Series(y_actual), bins=[-np.inf, 15, 60, np.inf],
        labels=["0-15 min", "15-60 min", "60+ min"],
    ).astype(str).values
    print_segment_table(
        "Segmented Evaluation — by Delay Magnitude",
        segment_metrics(y_actual, models, delay_segments),
    )

    horizon_segments = pd.cut(
        df_test["scheduled_travel_hours"], bins=[-np.inf, 4, 12, np.inf],
        labels=["Near-term (<4 hrs)", "Medium (4-12 hrs)", "Long-range (>12 hrs)"],
    ).astype(str).values
    print_segment_table(
        "Segmented Evaluation — by Forecast Horizon",
        segment_metrics(y_actual, models, horizon_segments),
    )

    # The public dataset has no true IR-zone identifier (only
    # zone_congestion_index, a numeric feature, not a zone label). Train
    # number / route is used as a documented proxy, matching
    # eval/comprehensive_evaluation.py's approach — this is explicitly a
    # proxy, not a real zone segmentation.
    train_numbers = df_test["train_number"].astype(str).values
    top_routes = pd.Series(train_numbers).value_counts().nlargest(5).index.tolist()
    zone_segments = np.where(np.isin(train_numbers, top_routes), train_numbers, "other")
    print_segment_table(
        "Segmented Evaluation — by Route (Zone Proxy — no true zone identifier in this dataset)",
        segment_metrics(y_actual, models, zone_segments),
    )

if __name__ == "__main__":
    run_comparison()
