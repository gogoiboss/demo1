import pandas as pd
import numpy as np

def rake_delay_inheritance(df, train_number_col='train_number', date_col='journey_date', delay_col='actual_delay_minutes'):
    """
    Computes the delay of the prior leg for the same rake.
    
    Given the absence of explicit rake IDs in the Kaggle dataset, we approximate rake
    linkage by assuming the same train_number on consecutive days (or the previous available day) 
    uses the same or a highly correlated physical rake pool.
    
    In a real production system, we would map (incoming_train_num -> turnaround_time -> outgoing_train_num)
    using the Working Time Table (WTT).
    """
    df = df.copy()
    # Sort by train and date to find the previous run
    df = df.sort_values(by=[train_number_col, date_col])
    
    # Shift to get previous journey's delay for the same train number
    df['prior_leg_delay'] = df.groupby(train_number_col)[delay_col].shift(1)
    
    # Fill NaNs (first run of a train) with the median prior leg delay or 0
    df['prior_leg_delay'] = df['prior_leg_delay'].fillna(0)
    return df

def remaining_schedule_buffer(df, timetable=None):
    """
    Computes the remaining schedule buffer.
    
    Formula: scheduled_time_remaining - minimum_technically_possible_running_time_remaining.
    Since the Kaggle dataset is at the journey level, we compute a rough proxy:
    Buffer = Scheduled Travel Hours - (Distance / Max Permissible Speed).
    We assume an average MPS of 110 km/h for this proxy.
    """
    df = df.copy()
    MPS_KMH = 110.0
    
    # Time it would take if running at MPS without any stops or constraints
    min_possible_hours = df['distance_km'] / MPS_KMH
    
    # The buffer built into the schedule
    df['schedule_buffer_hours'] = df['scheduled_travel_hours'] - min_possible_hours
    
    # Buffer cannot be negative in a valid schedule
    df['schedule_buffer_hours'] = df['schedule_buffer_hours'].clip(lower=0)
    return df

def generate_standard_features(df, date_col='journey_date'):
    """
    Generates standard time and historical features.
    """
    df = df.copy()
    
    if date_col in df.columns:
        df['day_of_week'] = df[date_col].dt.dayofweek
        df['month'] = df[date_col].dt.month
        df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    
    return df

def engineer_all_features(df):
    df = rake_delay_inheritance(df)
    df = remaining_schedule_buffer(df)
    df = generate_standard_features(df)
    return df
