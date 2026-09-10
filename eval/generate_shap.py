import os
import sys
import pandas as pd
import numpy as np
import shap
import matplotlib.pyplot as plt
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
from src.features.engineering import engineer_all_features

def main():
    print("Loading raw data and engineering features...")
    df = pd.read_csv("data/raw/train_delay.csv")
    
    if "journey_date" not in df.columns and "date" in df.columns:
        df["journey_date"] = pd.to_datetime(df["date"])
    elif "journey_date" not in df.columns:
        df["journey_date"] = pd.Timestamp("2023-01-01")
    else:
        df["journey_date"] = pd.to_datetime(df["journey_date"])
        
    df = engineer_all_features(df)
        
    sort_cols = ["journey_date"]
    if "train_no" in df.columns:
        sort_cols.append("train_no")
    elif "train_id" in df.columns:
        sort_cols.append("train_id")
    df = df.sort_values(by=sort_cols).reset_index(drop=True)
    
    features = [
        "distance_km",
        "scheduled_travel_hours",
        "prior_leg_delay",
        "avg_station_delay",
        "train_type_encoded",
        "is_weekend",
        "is_monsoon",
        "is_fog_season",
        "hour_of_day"
    ]
    target = "actual_delay_minutes"
    
    valid_features = [f for f in features if f in df.columns]
    X = df[valid_features]
    y = df[target]

    print("Re-fitting standalone XGBoost model on Chronological Split (70%)...")
    split_idx = int(len(X) * 0.70)
    X_train, y_train = X.iloc[:split_idx], y.iloc[:split_idx]
    
    from xgboost import XGBRegressor
    model = XGBRegressor(
        n_estimators=100, max_depth=6, learning_rate=0.1, 
        random_state=42, n_jobs=-1, objective="reg:squarederror"
    )
    model.fit(X_train, y_train)
    
    print("Computing SHAP values...")
    os.makedirs("docs/assets", exist_ok=True)
    
    # Use exact explainer to avoid XGBoost json format breaking TreeExplainer
    # Use a background dataset for PermutationExplainer
    background = shap.maskers.Independent(X_train, max_samples=100)
    explainer = shap.Explainer(model.predict, background)
    shap_values = explainer(X_train.iloc[:200]) # Run on a subset to avoid extreme slowness
    
    plt.figure(figsize=(10, 6))
    shap.summary_plot(shap_values, X_train.iloc[:200], show=False)
    plt.tight_layout()
    plt.savefig("docs/assets/shap_summary.png", dpi=300, bbox_inches='tight')
    plt.close()
        
    print("\n=============================================")
    print("CORRELATION ANALYSIS & CONFOUND CHECK")
    print("=============================================")
    
    sample_size = len(df)
    min_date = df['journey_date'].min().date()
    max_date = df['journey_date'].max().date()
    
    if "prior_leg_delay" in df.columns and "actual_delay_minutes" in df.columns:
        corr_global = df["prior_leg_delay"].corr(df["actual_delay_minutes"])
        
        daily_corrs = []
        for date, group in df.groupby(df['journey_date'].dt.date):
            if len(group) > 50:
                daily_corrs.append(group["prior_leg_delay"].corr(group["actual_delay_minutes"]))
        
        avg_daily_corr = np.nanmean(daily_corrs) if daily_corrs else np.nan
            
        print(f"Sample Size: {sample_size} records")
        print(f"Date Range: {min_date} to {max_date}")
        print(f"Global Pearson Correlation (Rake Lateness -> Next Leg): {corr_global:.3f}")
        print(f"Intra-Day Avg Correlation (Weather/Storm confound check): {avg_daily_corr:.3f}")
        print(f"Train/Test Split Methodology: Chronological TimeSeriesSplit (No Shuffling)")
        print("=============================================\n")
        
        with open("docs/assets/correlation_results.txt", "w") as f:
            f.write(f"Sample Size: {sample_size} records\n")
            f.write(f"Date Range: {min_date} to {max_date}\n")
            f.write(f"Global Pearson Correlation (Rake Lateness -> Next Leg): {corr_global:.3f}\n")
            f.write(f"Intra-Day Avg Correlation (Weather/Storm confound check): {avg_daily_corr:.3f}\n")
            f.write("Train/Test Split Methodology: Chronological TimeSeriesSplit (No Shuffling)\n")

if __name__ == "__main__":
    main()
