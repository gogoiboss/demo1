# Dashboard Setup

The dashboard is a lightweight static frontend with three views:

- **Passenger**: large calibrated delay window, trend, and next update time.
- **Station Controller**: platform commit/defer decision, interval width, and conflict signal.
- **Control Room**: corridor network view with an amber conflict trace and before/after P50 comparison.

## Run locally

Terminal 1, from `rippleeta/`:

```bash
uvicorn src.api.app:app --reload
```

Terminal 2, from `rippleeta/`:

```bash
python -m http.server 5500 --directory dashboard
```

Open `http://127.0.0.1:5500`. The dashboard calls the FastAPI service at `http://127.0.0.1:8000` and uses a realistic demo snapshot when the API is unavailable, clearly marked in the header.

## Live demo path

1. Enter a train number present in `data/processed/kaggle_competition_cleaned.parquet`, such as `20507`, and refresh.
2. Passenger shows the calibrated P10/P50/P90 delay window.
3. Open **Station Controller** to see the denser platform decision framing.
4. Open **Control Room** and select **Trace conflict**. The amber edge appears between Train 56789 and the selected train, and the before/after P50 comparison shows the +9-minute propagation used in the worked example.

The network visualization is explicitly labeled as a station-pair approximation because public data does not expose block-level occupancy.
