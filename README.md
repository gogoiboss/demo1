# RippleETA

**Network-aware train ETAs that replace false precision with an honest, narrowing delay window.**

RippleETA combines the delay a train inherits from its previous run with the delay it may face from other trains ahead. It exposes calibrated P10/P50/P90 outputs, suspends predictions during anomalous uncertainty, and translates one forecast into decisions for passengers, station controllers, crew controllers, feeder transport, and maintenance teams.

## Architecture

```text
Historical CSV / timetable / live-position inputs
                    |
                    v
             Feature engineering
       rake delay + schedule buffer + context
                    |
                    v
              XGBoost predictor
                    |
          +---------+----------+
          |                    |
          v                    v
   Timed event graph      MAPIE calibration
   running/conflict       P10 / P50 / P90
   edges, one pass              |
          +---------+----------+
                    v
             Anomaly variance gate
                    |
                    v
              FastAPI / REST
                    |
     +--------------+----------------+
     |              |                |
 Passenger   Station controller   Control room
```

The public dataset supports journey-level prediction and calibration. The graph is implemented and demoed at station-pair resolution, but the backtest cannot activate it because the available artifact has no paired station-state or block-occupancy data.

## Setup

Python 3.9+ is required. From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

On macOS/Linux, activate with `source .venv/bin/activate`.

The repository expects the processed dataset at `data/processed/kaggle_competition_cleaned.parquet`. Data and model artifacts are intentionally ignored by Git; provide them locally before running the full pipeline.

## Run The Pipeline

1. **Prepare data**

   ```powershell
   python -m src.ingestion.load_kaggle --csv data/raw/train_delay.csv
   ```

2. **Train the baseline/XGBoost artifact**

   ```powershell
   python -m src.models.xgboost_model
   ```

3. **Run the final chronological backtest**

   ```powershell
   python -m src.evaluation.backtest
   ```

4. **Start the API** in one terminal:

   ```powershell
   uvicorn src.api.app:app --reload --port 8000
   ```

   Open the interactive API at `http://127.0.0.1:8000/docs`.

5. **Start the dashboard** in a second terminal:

   ```powershell
   python -m http.server 5500 --directory dashboard
   ```

   Open `http://127.0.0.1:5500`. Enter a train ID such as `20507`, then move through Passenger, Station Controller, and Control Room views. Full demo instructions are in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

Run all tests with:

```powershell
python -m pytest -q
```

## Measured Results

The complete evaluation and claim audit are in [docs/RESULTS.md](docs/RESULTS.md).

| Metric | Measured value |
|---|---:|
| Selected routes | 6 |
| Held-out journeys | 174 |
| Prior-leg baseline MAE | 34.746 min |
| Full evaluated P50 MAE | 28.386 min |
| Improvement | 6.360 min / 18.30% |
| P10-P90 empirical coverage | 97.70% |
| Average interval width | 106.589 min |
| Measured graph-adjusted rows | 0 |

The 97.70% coverage result is measured on 174 selected-route held-out rows, not a universal guarantee. The intervals are wide, so coverage must be reported with the 106.589-minute average width.

## Known Limitations / Future Work

- The checked-in journey artifact does not contain signal-aspect, block occupancy, station-event sequences, or paired live positions. Conflict propagation is therefore not measured in the final backtest.
- Weather fields are coarse binary indicators; live weather and continuous signal/aspect feeds are not connected.
- The six selected train IDs are a narrow validation scope, not a network-wide Indian Railways benchmark.
- The real held-out 12301 example missed its upper interval by 1.099 minutes; the illustrative 12301/56789 `+9` minute conflict is not validated on real paired data.
- The measured 28.386-minute MAE does not reach the 5-9-minute literature range. It should not be presented as reproducing that range.
- Live RailRadar/NTES ingestion, route-specific station graph construction, drift monitoring, authentication, persistence, and production deployment remain future work.

## License

MIT. See [LICENSE](LICENSE).
