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

- **2026-09-05**: Stakeholder dashboards (C6) implemented and browser-validated.
  - `dashboard/index.html`, `styles.css`, and `app.js` provide distinct Passenger, Station Controller, and Control Room views.
  - Dark control-panel design uses amber for calibrated/conflict signals and teal-gray for standard operations.
  - Live API data loads for train 20507; the Control Room demo trace visibly changes P50 from 83.1 to 92.1 minutes with a +9-minute amber conflict edge.
  - Desktop and 390px mobile browser checks passed. Setup is documented in `docs/dashboard_notes.md`.

- **2026-09-05**: Final selected-route backtest completed and documented.
  - Six selected routes, 174 chronological held-out test rows: prior-leg baseline MAE **34.746 min**, evaluated XGBoost + MAPIE P50 MAE **28.386 min**, absolute improvement **6.360 min / 18.30%**.
  - P10-P90 empirical coverage: **97.70%**, with average interval width **106.589 min**.
  - Graph conflict adjustment rows: **0** because the journey-level artifact has no station-pair live state; this is explicitly not a measured network-propagation result.
  - Real held-out Train 12301 example: actual **85.499 min**, P50 **14.200 min**, interval **0.000-84.400 min**, missed by **1.099 min**. The illustrative 12301/56789 conflict remains unvalidated on real paired data.
  - Final report: `notebooks/04_final_backtest_report.ipynb`; measured pitch numbers: `docs/RESULTS.md`.

- **2026-09-05**: Final polish and submission preparation complete.
  - README rewritten with the actual architecture, setup path, measured results, and limitations.
  - Live demo script added with Passenger, Station Controller, Control Room, API, and fallback walkthroughs.
  - MIT license and final ignore rules added; tracked-history audit found no oversized or sensitive artifacts.
  - Final claim audit distinguishes measured route results from literature ranges and the illustrative, unvalidated station-pair example.
