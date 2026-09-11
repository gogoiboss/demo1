import pandas as pd
import numpy as np
from sklearn.metrics import mean_absolute_error


class NaiveBaselineModel:
    """
    Naive baseline ETA model: predicted_ETA = scheduled_time + current_delay.
    Since our dataset predicts final delay, the naive prediction is simply that
    the train will maintain its current delay (or 0 if starting on time).
    """

    def __init__(self):
        pass

    def fit(self, X, y=None):
        return self

    def predict(self, X):
        """
        In a journey-level dataset, a naive baseline might predict the historical
        median delay, or simply assume 0 delay (perfect schedule adherence).
        We'll use a naive assumption of 15 minutes average delay or the prior leg delay.
        """
        if "prior_leg_delay" in X.columns:
            return X["prior_leg_delay"]
        return np.full(len(X), 15.0)


def evaluate_baseline(df, target_col="actual_delay_minutes"):
    model = NaiveBaselineModel()
    predictions = model.predict(df)
    actuals = df[target_col]
    mae = mean_absolute_error(actuals, predictions)
    return mae


if __name__ == "__main__":
    df = pd.read_parquet("data/processed/kaggle_competition_cleaned.parquet")
    from src.features.engineering import engineer_all_features

    df = engineer_all_features(df)

    mae = evaluate_baseline(df)
    print(f"Naive Baseline MAE: {mae:.2f} minutes")
