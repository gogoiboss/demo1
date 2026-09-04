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


def parse_times(df: pd.DataFrame) -> pd.DataFrame:
    """Convert HH:MM strings to timedelta for arithmetic."""
    for col in ["arrival_time", "departure_time"]:
        if col in df.columns:
            df[col] = pd.to_timedelta(
                df[col].astype(str).str.strip().str.replace(".", ":", regex=False),
                errors="coerce",
            )
    return df


def derive_section_times(df: pd.DataFrame) -> pd.DataFrame:
    """Compute scheduled section running time between consecutive stations."""
    df = df.sort_values(["train_no", "seq"]).reset_index(drop=True)

    if "arrival_time" in df.columns and "departure_time" in df.columns:
        # Dwell time at each station
        df["dwell_time"] = df["departure_time"] - df["arrival_time"]

        # Section run time = arrival(n) - departure(n-1)
        df["prev_departure"] = df.groupby("train_no")["departure_time"].shift(1)
        df["section_run_time"] = df["arrival_time"] - df["prev_departure"]
        df.drop(columns=["prev_departure"], inplace=True)

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
