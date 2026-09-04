import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error
import joblib
from pathlib import Path

def train_and_evaluate(df, target_col='actual_delay_minutes', date_col='journey_date'):
    """
    Train XGBoost model using TimeSeriesSplit.
    
    Why TimeSeriesSplit and NOT random shuffle?
    Random shuffle causes data leakage. In reality, we cannot train on future data 
    (e.g., a congestion event on Tuesday) to predict past data (e.g., delays on Monday).
    TimeSeriesSplit ensures we always train on past data to predict future data, 
    mimicking the real-world deployment scenario.
    """
    df = df.sort_values(by=date_col).reset_index(drop=True)
    
    features = [
        'scheduled_travel_hours', 'distance_km', 'zone_congestion_index',
        'monsoon_flag', 'fog_risk', 'coach_count', 'loco_age_years',
        'prior_leg_delay', 'schedule_buffer_hours', 'day_of_week', 'month', 'is_weekend'
    ]
    
    X = df[features]
    y = df[target_col]
    
    # 5-fold TimeSeriesSplit
    tscv = TimeSeriesSplit(n_splits=5)
    
    maes = []
    model = xgb.XGBRegressor(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        random_state=42
    )
    
    for train_index, test_index in tscv.split(X):
        X_train, X_test = X.iloc[train_index], X.iloc[test_index]
        y_train, y_test = y.iloc[train_index], y.iloc[test_index]
        
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        
        fold_mae = mean_absolute_error(y_test, preds)
        maes.append(fold_mae)
        
    avg_mae = np.mean(maes)
    
    # Train final model on all data
    model.fit(X, y)
    
    # Save model artifact
    models_dir = Path("models")
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "xgboost_delay_model.joblib"
    joblib.dump(model, model_path)
    
    # Add .gitignore in models dir to ignore artifacts
    with open(models_dir / ".gitignore", "w") as f:
        f.write("*.joblib\n")
        f.write("*.pkl\n")
        
    return avg_mae, model_path

if __name__ == "__main__":
    df = pd.read_parquet("data/processed/kaggle_competition_cleaned.parquet")
    from src.features.engineering import engineer_all_features
    df = engineer_all_features(df)
    
    avg_mae, path = train_and_evaluate(df)
    print(f"XGBoost CV MAE: {avg_mae:.2f} minutes")
    print(f"Model saved to {path} (Ignored in git. Regenerate by running this script).")
