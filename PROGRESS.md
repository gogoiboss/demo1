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
