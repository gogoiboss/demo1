import sys
from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.features.engineering import engineer_all_features
from src.calibration.conformal import (
    DEFAULT_FEATURES,
    MONDRIAN_BUCKET_EDGES,
    per_bucket_coverage,
    train_and_calibrate,
)
from src.pipeline import RippleETAPipeline


def pinball_loss(y_true, y_pred, alpha):
    """Computes the quantile (pinball) loss."""
    diff = y_true - y_pred
    return np.where(diff >= 0, alpha * diff, (alpha - 1) * diff).mean()


def run_comprehensive_eval():
    print("Loading RippleETA Pipeline and Data...")

    processed_path = Path("data/processed/kaggle_competition_cleaned.parquet")
    df = pd.read_parquet(processed_path)
    df = engineer_all_features(df)
    target = "actual_delay_minutes"

    df = df.dropna(subset=DEFAULT_FEATURES + [target])
    df_sorted = df.sort_values("journey_date").reset_index(drop=True)

    # 15% chronological holdout
    n = len(df_sorted)
    cal_end = int(n * 0.85)
    df_test = df_sorted.iloc[cal_end:].copy()

    y_actual = df_test[target].values

    p = RippleETAPipeline()
    p._load()
    X_test = df_test[DEFAULT_FEATURES]

    print(f"Running inference on {len(X_test)} held-out rows...")
    ripple_results = p._prediction_pipeline.predict(X_test)

    df_test["p10"] = [r["p10_delay_min"] for r in ripple_results]
    df_test["p50"] = [r["p50_delay_min"] for r in ripple_results]
    df_test["p90"] = [r["p90_delay_min"] for r in ripple_results]

    # --- STEP 1: Global Quantile Loss ---
    l10 = pinball_loss(df_test[target], df_test["p10"], 0.1)
    l50 = pinball_loss(df_test[target], df_test["p50"], 0.5)
    l90 = pinball_loss(df_test[target], df_test["p90"], 0.9)
    combined_pinball = (l10 + l50 + l90) / 3.0

    print("\n### STEP 1: Global Quantile Loss")
    print("| Metric | Value |")
    print("| :--- | :--- |")
    print(f"| P10 Pinball | {l10:.2f} |")
    print(f"| P50 Pinball (~ MAE/2) | {l50:.2f} |")
    print(f"| P90 Pinball | {l90:.2f} |")
    print(f"| **Combined Pinball** | **{combined_pinball:.2f}** |")

    # --- STEP 2: Coverage ---
    covered = (df_test[target] >= df_test["p10"]) & (df_test[target] <= df_test["p90"])
    global_coverage = covered.mean() * 100
    df_test["is_covered"] = covered

    print("\n### STEP 2: Empirical Coverage")
    print("Target Coverage (P10 to P90): 90.0%")
    print(f"Actual Empirical Coverage: **{global_coverage:.1f}%**")

    # --- STEP 3: Segmentation ---

    def eval_segment(df_seg, name_col):
        results = []
        for name, group in df_seg.groupby(name_col):
            if len(group) < 5:
                continue
            mae = np.mean(np.abs(group[target] - group["p50"]))
            cov = group["is_covered"].mean() * 100

            pl10 = pinball_loss(group[target], group["p10"], 0.1)
            pl50 = pinball_loss(group[target], group["p50"], 0.5)
            pl90 = pinball_loss(group[target], group["p90"], 0.9)

            results.append(
                {
                    "Segment": name,
                    "Count": len(group),
                    "MAE": mae,
                    "Coverage (%)": cov,
                    "Pinball": (pl10 + pl50 + pl90) / 3.0,
                }
            )
        return pd.DataFrame(results)

    # 3A: By Delay Magnitude
    bins = [-np.inf, 15, 60, np.inf]
    labels = ["0-15 min (On-Time/Minor)", "15-60 min (Moderate)", "60+ min (Severe)"]
    df_test["delay_segment"] = pd.cut(df_test[target], bins=bins, labels=labels)
    seg_delay = eval_segment(df_test, "delay_segment")

    print("\n### STEP 3A: Performance by Actual Delay Magnitude")
    print(seg_delay.to_markdown(index=False, floatfmt=".1f"))

    # 3B: By Forecast Horizon
    bins_horiz = [-np.inf, 4, 12, np.inf]
    labels_horiz = ["Near-term (<4 hrs)", "Medium (4-12 hrs)", "Long-range (>12 hrs)"]
    df_test["horizon_segment"] = pd.cut(
        df_test["scheduled_travel_hours"], bins=bins_horiz, labels=labels_horiz
    )
    seg_horizon = eval_segment(df_test, "horizon_segment")

    print("\n### STEP 3B: Performance by Forecast Horizon")
    print(seg_horizon.to_markdown(index=False, floatfmt=".1f"))

    # 3C: By Route (Top 5)
    top_routes = df_test["train_number"].value_counts().nlargest(5).index
    df_top_routes = df_test[df_test["train_number"].isin(top_routes)].copy()
    seg_route = eval_segment(df_top_routes, "train_number")

    print("\n### STEP 3C: Performance by Route (Top 5 Vol)")
    print(seg_route.to_markdown(index=False, floatfmt=".1f"))

    # --- STEP 3D: Mondrian (conditional) vs pooled coverage, by prior_leg_delay bucket ---
    print(
        "\n### STEP 3D: Conditional (Mondrian) vs Pooled Coverage — by prior_leg_delay bucket"
    )
    print(
        "Marginal/pooled coverage (STEP 2) can average out a badly under-covered bucket;"
    )
    print(
        "this checks each prior_leg_delay bucket individually against the same held-out rows."
    )

    pooled_report = per_bucket_coverage(
        X_test, y_actual, ripple_results, "prior_leg_delay", MONDRIAN_BUCKET_EDGES
    )

    print(
        "Fitting a Mondrian (stratified-by-prior_leg_delay) calibrator on the same data for comparison..."
    )
    mondrian_engine, _ = train_and_calibrate(
        p._data, model_config={"use_mondrian": True}
    )
    mondrian_preds = mondrian_engine.predict(X_test)
    mondrian_report = per_bucket_coverage(
        X_test,
        y_actual,
        mondrian_preds,
        mondrian_engine.mondrian_feature,
        mondrian_engine.mondrian_bucket_edges,
    )

    empty_stat = {"n": 0, "coverage_pct": 0.0, "avg_interval_width_min": 0.0}
    print(
        "| Bucket (prior_leg_delay, min) | N | Pooled coverage | Mondrian coverage | Pooled width | Mondrian width |"
    )
    print("| :--- | ---: | ---: | ---: | ---: | ---: |")
    for bucket in sorted(set(pooled_report) | set(mondrian_report)):
        p_stat = pooled_report.get(bucket, empty_stat)
        m_stat = mondrian_report.get(bucket, empty_stat)
        print(
            f"| {bucket} | {p_stat['n']} | {p_stat['coverage_pct']:.1f}% | "
            f"{m_stat['coverage_pct']:.1f}% | {p_stat['avg_interval_width_min']:.1f} | "
            f"{m_stat['avg_interval_width_min']:.1f} |"
        )

    # --- PLOT: Coverage vs Target ---
    plt.figure(figsize=(9, 5))

    # Bar positions
    x = np.arange(len(seg_delay))
    width = 0.5

    plt.bar(
        x, seg_delay["Coverage (%)"], width, color="#3b82f6", label="Empirical Coverage"
    )
    plt.axhline(
        y=90, color="#ef4444", linestyle="--", linewidth=2, label="Nominal Target (90%)"
    )

    plt.ylabel("Coverage (%)", fontweight="bold")
    plt.title(
        "RippleETA Conformal Coverage by Delay Severity", fontweight="bold", pad=15
    )
    plt.xticks(x, seg_delay["Segment"], rotation=0)
    plt.ylim(0, 105)

    # Add percentage text on bars
    for i, cov in enumerate(seg_delay["Coverage (%)"]):
        plt.text(
            i, cov + 2, f"{cov:.1f}%", ha="center", fontweight="bold", color="#1e40af"
        )

    plt.legend()
    plt.tight_layout()
    plot_path = Path(__file__).parent / "coverage_plot.png"
    plt.savefig(plot_path, dpi=300)
    print(f"\nCoverage plot saved successfully to {plot_path}")


if __name__ == "__main__":
    run_comprehensive_eval()
