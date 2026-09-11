"""Feature engineering for the RippleETA prediction pipeline."""

import logging

import pandas as pd

logger = logging.getLogger(__name__)


def rake_delay_inheritance(
    df,
    train_number_col: str = "train_number",
    date_col: str = "journey_date",
    delay_col: str = "actual_delay_minutes",
):
    """Compute the delay of the prior leg for the same rake.

    Given the absence of explicit rake IDs in the Kaggle dataset, rake linkage
    is approximated by assuming the same train_number on consecutive days uses
    the same (or a highly correlated) physical rake pool.

    In a real production system this would map
    (incoming_train_num → turnaround_time → outgoing_train_num) using the
    Working Time Table (WTT).
    """
    df = df.copy()
    df = df.sort_values(by=[train_number_col, date_col])
    df["prior_leg_delay"] = df.groupby(train_number_col)[delay_col].shift(1)
    df["prior_leg_delay"] = df["prior_leg_delay"].fillna(0)
    logger.debug("rake_delay_inheritance: computed prior_leg_delay for %d rows", len(df))
    return df


def remaining_schedule_buffer(df, timetable=None):
    """Compute the remaining schedule buffer.

    Formula: scheduled_time_remaining − minimum_technically_possible_running_time.
    Uses an average Maximum Permissible Speed of 110 km/h as a proxy since the
    Kaggle dataset operates at journey level, not station-to-station.
    """
    df = df.copy()
    MPS_KMH = 110.0
    min_possible_hours = df["distance_km"] / MPS_KMH
    df["schedule_buffer_hours"] = (df["scheduled_travel_hours"] - min_possible_hours).clip(
        lower=0
    )
    logger.debug("remaining_schedule_buffer: computed schedule_buffer_hours for %d rows", len(df))
    return df


def generate_standard_features(df, date_col: str = "journey_date"):
    """Generate standard time and calendar features."""
    df = df.copy()
    if date_col in df.columns:
        df["day_of_week"] = df[date_col].dt.dayofweek
        df["month"] = df[date_col].dt.month
        df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
    logger.debug(
        "generate_standard_features: added day_of_week/month/is_weekend for %d rows", len(df)
    )
    return df


def engineer_all_features(df: pd.DataFrame) -> pd.DataFrame:
    """Run the full feature engineering sequence and return an enriched DataFrame."""
    logger.info("Engineering features for %d rows", len(df))
    df = rake_delay_inheritance(df)
    df = remaining_schedule_buffer(df)
    df = generate_standard_features(df)
    logger.info("Feature engineering complete; %d columns available", len(df.columns))
    return df
