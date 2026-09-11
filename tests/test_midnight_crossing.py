import sys
from pathlib import Path
import pandas as pd

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.ingestion.load_timetable import parse_times, derive_section_times


def test_midnight_crossing():
    print("Testing Train 12301 Midnight Crossing...")

    # Create mock schedule where Train departs 23:50 on Day 1, arrives 00:15 on Day 2
    mock_data = {
        "train_no": ["123", "123", "123"],
        "seq": [1, 2, 3],
        "arrival_time": ["None", "00:15", "04:10"],
        "departure_time": ["23:50", "00:20", "04:15"],
        "distance_km": [0, 25, 200],
    }
    df = pd.DataFrame(mock_data)

    df_parsed = parse_times(df)
    df_derived = derive_section_times(df_parsed)

    print("\n--- RESULTS ---")
    for row in df_derived.itertuples():
        print(
            f"Seq {row.seq}: Arr Day {row.arr_day_of_journey}, Dep Day {row.dep_day_of_journey} | "
            f"Section Run Time: {row.section_run_time} | Dwell: {row.dwell_time}"
        )

    # Assertions
    # Seq 2 arrival should be Day 2, run time should be 25 minutes (00:15 - 23:50)
    seq2 = df_derived[df_derived["seq"] == 2].iloc[0]
    assert (
        seq2.arr_day_of_journey == 2
    ), f"Expected arr_day_of_journey=2, got {seq2.arr_day_of_journey}"
    assert (
        seq2.section_run_time.total_seconds() == 25 * 60
    ), f"Expected run time 25 mins, got {seq2.section_run_time}"

    print("\nSUCCESS: All midnight crossing assertions passed. No negative times.")


if __name__ == "__main__":
    test_midnight_crossing()
