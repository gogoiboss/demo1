import pandas as pd
import numpy as np

with open("src/ingestion/load_timetable.py", "r", encoding="utf-8") as f:
    original_code = f.read()

new_logic = """
def time_str_to_mins(t_str: str) -> float:
    if pd.isna(t_str) or t_str.strip().upper() in ["NONE", "NAN", ""]:
        return np.nan
    t_str = str(t_str).strip().replace(".", ":")
    try:
        parts = t_str.split(":")
        h = int(parts[0])
        m = int(parts[1])
        return h * 60 + m
    except:
        return np.nan

def parse_times(df: pd.DataFrame) -> pd.DataFrame:
    '''Convert HH:MM strings to absolute journey minutes handling midnight crossovers.'''
    df = df.copy()
    
    if "arrival_time" not in df.columns or "departure_time" not in df.columns:
        return df
        
    df["arr_min_of_day"] = df["arrival_time"].apply(time_str_to_mins)
    df["dep_min_of_day"] = df["departure_time"].apply(time_str_to_mins)
    
    # We must sort strictly to process sequential events per train
    df = df.sort_values(["train_no", "seq"]).reset_index(drop=True)
    
    arr_days = []
    dep_days = []
    arr_abs = []
    dep_abs = []
    
    # State tracking per train
    current_train = None
    current_day = 1
    last_min = 0.0
    
    for row in df.itertuples():
        if row.train_no != current_train:
            current_train = row.train_no
            current_day = 1
            last_min = 0.0
            
        # Handle Arrival
        a_min = row.arr_min_of_day
        a_day = current_day
        a_abs = np.nan
        if pd.notna(a_min):
            # Midnight crossing detection (allowing 4 hrs tolerance for backwards jumps to avoid catching bad data noise)
            if a_min < last_min and (last_min - a_min) > 240:
                current_day += 1
                a_day = current_day
            a_abs = (a_day - 1) * 1440 + a_min
            last_min = a_min
            
        arr_days.append(a_day)
        arr_abs.append(a_abs)
        
        # Handle Departure
        d_min = row.dep_min_of_day
        d_day = current_day
        d_abs = np.nan
        if pd.notna(d_min):
            if d_min < last_min and (last_min - d_min) > 240:
                current_day += 1
                d_day = current_day
            d_abs = (d_day - 1) * 1440 + d_min
            last_min = d_min
            
        dep_days.append(d_day)
        dep_abs.append(d_abs)
        
    df["arr_day_of_journey"] = arr_days
    df["dep_day_of_journey"] = dep_days
    df["arrival_abs_min"] = arr_abs
    df["departure_abs_min"] = dep_abs
    
    return df

def derive_section_times(df: pd.DataFrame) -> pd.DataFrame:
    '''Compute scheduled section running time between consecutive stations.'''
    if "arrival_abs_min" in df.columns and "departure_abs_min" in df.columns:
        # Dwell time at each station
        df["dwell_time"] = df["departure_abs_min"] - df["arrival_abs_min"]

        # Section run time = arrival(n) - departure(n-1)
        df["prev_departure_abs"] = df.groupby("train_no")["departure_abs_min"].shift(1)
        df["section_run_time"] = df["arrival_abs_min"] - df["prev_departure_abs"]
        df.drop(columns=["prev_departure_abs"], inplace=True)
        
        # Convert the absolute minutes into standard timedeltas so it remains compatible with old outputs
        df["arrival_time"] = pd.to_timedelta(df["arrival_abs_min"], unit="m")
        df["departure_time"] = pd.to_timedelta(df["departure_abs_min"], unit="m")
        df["section_run_time"] = pd.to_timedelta(df["section_run_time"], unit="m")
        df["dwell_time"] = pd.to_timedelta(df["dwell_time"], unit="m")
        
        # Drop temporary tracking columns to keep schema clean
        df = df.drop(columns=["arr_min_of_day", "dep_min_of_day", "arrival_abs_min", "departure_abs_min"])

    if "distance_km" in df.columns:
        df["section_distance_km"] = df.groupby("train_no")["distance_km"].diff()

    return df
"""

# Extract the old functions and replace them
import re
pattern_parse = re.compile(r"def parse_times\(df: pd\.DataFrame\) -> pd\.DataFrame:.*?return df", re.DOTALL)
pattern_derive = re.compile(r"def derive_section_times\(df: pd\.DataFrame\) -> pd\.DataFrame:.*?return df", re.DOTALL)

# We will just split and replace them sequentially or using string find
start_idx = original_code.find("def parse_times")
end_idx = original_code.find("def print_summary")

if start_idx != -1 and end_idx != -1:
    new_code = original_code[:start_idx] + new_logic + "\n\n" + original_code[end_idx:]
    with open("src/ingestion/load_timetable.py", "w", encoding="utf-8") as f:
        f.write(new_code)
    print("Patched load_timetable.py successfully.")
else:
    print("Could not find the function blocks to replace.")
