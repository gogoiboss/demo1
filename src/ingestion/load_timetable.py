import numpy as np
"""
data.gov.in — Indian Railways Static Timetable Loader
=====================================================
Source: "Indian Railways Train Time Table" from data.gov.in
Gives us: scheduled arrival/departure for every station on every train.
Used for: deriving "remaining schedule buffer" feature, baseline ETA.

Usage:
    python -m src.ingestion.load_timetable --file data/raw/timetable.csv

If you don't have the file yet:
    1. Go to https://data.gov.in
    2. Search: "Indian Railways Train Time Table"
    3. Download the CSV/JSON and place in data/raw/
"""

import argparse
import sys
from pathlib import Path

import pandas as pd


PROCESSED_DIR = Path("data/processed")

# Columns typically present in the data.gov.in timetable export
EXPECTED_COLS = [
    "train_no", "train_name", "seq",  # or "stn_serial_number"
    "station_code", "station_name",
    "arrival_time", "departure_time",
    "distance",  # cumulative km from origin
    "source_station", "destination_station",
]


def normalise_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Harmonise column names across different download formats."""
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    rename_map = {
        "islno": "seq",
        "stn_serial_number": "seq",
        "serial_no": "seq",
        "trainno": "train_no",
        "train_number": "train_no",
        "stncode": "station_code",
        "stn_code": "station_code",
        "stnname": "station_name",
        "stn_name": "station_name",
        "arrivaltime": "arrival_time",
        "arr_time": "arrival_time",
        "departuretime": "departure_time",
        "dep_time": "departure_time",
        "distance_(in_km)": "distance_km",
        "distance_km": "distance_km",
        "distance": "distance_km",
        "source_station_name": "source_station",
        "destination_station_name": "destination_station",
    }
    df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})
    return df



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


def print_summary(df: pd.DataFrame) -> None:
    """Print schema and stats."""
    print(f"\n{'='*60}")
    print(f"  Indian Railways Static Timetable")
    print(f"{'='*60}")
    print(f"  Shape        : {df.shape[0]:,} rows × {df.shape[1]} columns")
    print(f"  Columns      : {list(df.columns)}")
    print(f"  Unique trains: {df['train_no'].nunique() if 'train_no' in df.columns else 'N/A'}")
    print(f"  Unique stations: {df['station_code'].nunique() if 'station_code' in df.columns else 'N/A'}")
    print(f"  Missing vals :\n{df.isnull().sum().to_string()}")
    print()


def main(file_path: str) -> None:
    path = Path(file_path)
    if not path.exists():
        print(f"ERROR: File not found: {path.resolve()}", file=sys.stderr)
        print("Download from data.gov.in — search 'Indian Railways Train Time Table'")
        sys.exit(1)

    print(f"Loading timetable from {path} ...")
    if path.suffix.lower() == ".json":
        df = pd.read_json(path)
    else:
        df = pd.read_csv(path, low_memory=False)

    df = normalise_columns(df)
    print_summary(df)

    df = parse_times(df)
    df = derive_section_times(df)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "timetable_processed.parquet"
    df.to_parquet(out_path, index=False)
    print(f"✓ Saved processed timetable → {out_path}")

    # Show sample for the 3 recommended backtesting routes
    demo_trains = ["12301", "12302", "12951", "12952", "12625", "12626"]
    if "train_no" in df.columns:
        df["train_no_str"] = df["train_no"].astype(str)
        matched = df[df["train_no_str"].isin(demo_trains)]
        if not matched.empty:
            print(f"\n  Found {len(matched)} rows for demo trains: {demo_trains}")
            print(matched.head(20).to_string())
        else:
            print(f"  Demo trains {demo_trains} not found in timetable.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load data.gov.in timetable")
    parser.add_argument("--file", required=True, help="Path to timetable CSV/JSON")
    args = parser.parse_args()
    main(args.file)
