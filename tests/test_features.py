import pandas as pd
import numpy as np
import pytest
from src.features.engineering import rake_delay_inheritance, remaining_schedule_buffer, generate_standard_features

def test_rake_delay_inheritance():
    df = pd.DataFrame({
        'train_number': [12301, 12301, 12301, 12951],
        'journey_date': pd.to_datetime(['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-01']),
        'actual_delay_minutes': [10.0, 45.0, 20.0, 5.0]
    })
    
    result = rake_delay_inheritance(df)
    
    # 12301 on Jan 1 has no prior leg, should be 0
    assert result[(result['train_number'] == 12301) & (result['journey_date'] == '2025-01-01')]['prior_leg_delay'].iloc[0] == 0.0
    
    # 12301 on Jan 2 should inherit Jan 1's delay (10.0)
    assert result[(result['train_number'] == 12301) & (result['journey_date'] == '2025-01-02')]['prior_leg_delay'].iloc[0] == 10.0
    
    # 12301 on Jan 3 should inherit Jan 2's delay (45.0)
    assert result[(result['train_number'] == 12301) & (result['journey_date'] == '2025-01-03')]['prior_leg_delay'].iloc[0] == 45.0

def test_remaining_schedule_buffer():
    df = pd.DataFrame({
        'scheduled_travel_hours': [10.0, 5.0],
        'distance_km': [1100.0, 550.0]  # At 110 km/h MPS, min time is 10.0 and 5.0 respectively
    })
    
    result = remaining_schedule_buffer(df)
    
    # Buffer should be 0 for both if scheduled exactly at MPS
    assert result['schedule_buffer_hours'].iloc[0] == 0.0
    assert result['schedule_buffer_hours'].iloc[1] == 0.0
    
    df2 = pd.DataFrame({
        'scheduled_travel_hours': [12.0], # 2 hours of buffer
        'distance_km': [1100.0]
    })
    result2 = remaining_schedule_buffer(df2)
    assert result2['schedule_buffer_hours'].iloc[0] == 2.0

def test_generate_standard_features():
    df = pd.DataFrame({
        'journey_date': pd.to_datetime(['2025-01-04']) # Saturday
    })
    
    result = generate_standard_features(df)
    assert result['day_of_week'].iloc[0] == 5 # Saturday is 5
    assert result['is_weekend'].iloc[0] == 1
    assert result['month'].iloc[0] == 1
