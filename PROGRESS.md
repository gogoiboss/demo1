# Progress Log

- **2026-09-04**: Project scaffolding complete.
- **2026-09-04**: Data ingestion layer built. Kaggle loader, data.gov.in timetable ingestion, and RailRadar API client stub with rate limiting are in place. Exploration notebook created. Selected backtesting routes: 12301/12302 Howrah Rajdhani, 12951/12952 Mumbai Rajdhani, 12625/12626 Kerala Express.

- **2026-09-05**: Baseline vs XGBoost models built and evaluated using TimeSeriesSplit. 
  - Naive Baseline MAE: 35.28 minutes
  - XGBoost CV MAE: 27.99 minutes

- **2026-09-05**: Timed Event Graph (C3 — Network Conflict Detector) built and tested.
  - Implemented `src/graph/timed_event_graph.py`: Goverde (2010) max-plus algebra, single forward traversal (no simulation loop).
  - Two edge types: running-time edges (within-train) + conflict edges (cross-train, station-pair approximation).
  - `detect_conflicts()`: accepts live-position DataFrames or node-delay mappings; baseline vs full propagation diff gives honest conflict attribution.
  - `src/graph/worked_example.py`: two scenarios — Scenario A (PPT exact inputs, no conflict fires) and Scenario B (corrected, +9 min conflict reproduced exactly).
  - **PITCH UPDATE REQUIRED**: The original +55/+40 inputs activate no conflict. With Train 56789 at +15 min, the graph reproduces the +9 min conflict, but computes +64 min total at Allahabad, not the PPT's +57 min or 15:20–16:10 window.
  - 9/9 graph tests passing (`tests/test_graph.py`).
  - Notebook `notebooks/03_conflict_graph_demo.ipynb`: valid JSON cell metadata, NetworkX visualisation, step-by-step propagation trace, and Q&A prep notes.

- **2026-09-05**: Calibrated Output Engine (C4) implemented and empirically validated.
  - MAPIE `SplitConformalRegressor` produces P10/P50/P90 delay intervals using a chronological 70/15/15 train/calibration/test split.
  - Held-out validation: **90.3% P10-P90 coverage** on 1,500 test rows, 22.53-minute p50 MAE, and 70.9-minute average interval width. This is close to the 90% target and is measured rather than assumed.
  - `AnomalyGate` uses rolling historical uncertainty variance and suspends output when current variance exceeds 3x baseline: `PREDICTION SUSPENDED — anomalous conditions`.
  - `CalibratedPredictionPipeline` combines feature engineering, optional timed-event conflict adjustment, MAPIE calibration, and anomaly-aware output.
  - Notebook `notebooks/02_baseline_vs_xgboost.ipynb` now reports the held-out coverage result.

- **2026-09-05**: FastAPI API layer (C5) implemented and tested.
  - Core calibrated prediction and health endpoints are available under `src/api/app.py`.
  - Five distinct stakeholder framings are exposed: passenger, station master, crew controller, feeder transport, and maintenance.
  - Pydantic response schemas, clear 404/422/503 handling, OpenAPI docs, and deterministic endpoint tests are included.
  - `/docs` renders successfully; full project suite passes with 21 tests.
