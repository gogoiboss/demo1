"""
Kaggle Indian Railways Delay Dataset — Loader & Cleaner
=========================================================
Expected source: "Indian Railways: Predict Train Delay" competition dataset
(~1.5 M journey records) or the 2025 delays dataset.

Usage:
    python -m src.ingestion.load_kaggle --csv data/raw/train_delay.csv
"""

import argparse
import sys
from pathlib import Path

import pandas as pd

# Windows consoles default stdout to a legacy code page (cp1252) that can't
# encode the arrows/symbols this script prints (found the hard way: it
# crashed with UnicodeEncodeError partway through printing the dataset
# summary, before ever reaching the save step). reconfigure() is a no-op on
# platforms where stdout is already UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PROCESSED_DIR = Path("data/processed")

# Columns we expect (superset across Kaggle variants — loader adapts)
EXPECTED_COLS_COMPETITION = [
    "train_number",
    "scheduled_travel_hours",
    "distance_km",
    "zone_congestion_index",
    "monsoon_flag",
    "fog_risk",
    "coach_count",
    "loco_age_years",
    "delayed_gt_15min",
]
EXPECTED_COLS_2025 = [
    "train_no",
    "train_name",
    "station_code",
    "station_name",
    "avg_delay_min",
    "pct_right_time",
]


def detect_variant(df: pd.DataFrame) -> str:
    """Detect which Kaggle dataset variant we loaded."""
    cols_lower = {c.lower().strip() for c in df.columns}
    if "delayed_gt_15min" in cols_lower or "zone_congestion_index" in cols_lower:
        return "competition"
    if "avg_delay_min" in cols_lower or "pct_right_time" in cols_lower:
        return "2025_delays"
    return "unknown"


def print_summary(df: pd.DataFrame, variant: str) -> None:
    """Print shape, schema, date range, and basic stats."""
    print(f"\n{'='*60}")
    print(f"  Kaggle IR Dataset — variant: {variant}")
    print(f"{'='*60}")
    print(f"  Shape        : {df.shape[0]:,} rows × {df.shape[1]} columns")
    print(f"  Columns      : {list(df.columns)}")
    print(f"  Dtypes       :\n{df.dtypes.to_string()}")
    print(f"  Missing vals :\n{df.isnull().sum().to_string()}")
    print(f"  Memory usage : {df.memory_usage(deep=True).sum() / 1e6:.1f} MB")

    # Try to detect date range
    date_cols = [c for c in df.columns if "date" in c.lower()]
    for dc in date_cols:
        try:
            parsed = pd.to_datetime(df[dc], errors="coerce")
            print(f"  Date range ({dc}): {parsed.min()} → {parsed.max()}")
        except Exception:
            pass

    # Look for rake / rolling-stock linkage fields
    rake_cols = [
        c
        for c in df.columns
        if any(
            kw in c.lower()
            for kw in ["rake", "coach", "loco", "rolling", "stock", "consist"]
        )
    ]
    if rake_cols:
        print(f"  ⚙ Rake/rolling-stock columns found: {rake_cols}")
    else:
        print("  ⚠ No rake/rolling-stock linkage columns detected.")

    print()


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Apply basic cleaning steps."""
    # Normalise column names
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    # Drop fully-empty rows / columns
    df = df.dropna(how="all").dropna(axis=1, how="all")

    # Deduplicate
    n_before = len(df)
    df = df.drop_duplicates()
    n_dupes = n_before - len(df)
    if n_dupes:
        print(f"  Dropped {n_dupes:,} duplicate rows.")

    # Parse any date columns
    for c in df.columns:
        if "date" in c:
            df[c] = pd.to_datetime(df[c], errors="coerce")

    return df


def main(csv_path: str) -> None:
    path = Path(csv_path)
    if not path.exists():
        print(f"ERROR: File not found: {path.resolve()}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {path} ...")
    df = pd.read_csv(path, low_memory=False)

    variant = detect_variant(df)
    print_summary(df, variant)

    df = clean(df)
    print_summary(df, f"{variant} (cleaned)")

    # Save cleaned output
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / f"kaggle_{variant}_cleaned.parquet"
    df.to_parquet(out_path, index=False)
    print(
        f"✓ Saved cleaned data → {out_path}  ({out_path.stat().st_size / 1e6:.1f} MB)"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load & clean Kaggle IR dataset")
    parser.add_argument("--csv", required=True, help="Path to the raw CSV file")
    args = parser.parse_args()
    main(args.csv)
