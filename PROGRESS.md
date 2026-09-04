# Progress Log

- **2026-09-04**: Project scaffolding complete.
- **2026-09-04**: Data ingestion layer built. Kaggle loader, data.gov.in timetable ingestion, and RailRadar API client stub with rate limiting are in place. Exploration notebook created. Selected backtesting routes: 12301/12302 Howrah Rajdhani, 12951/12952 Mumbai Rajdhani, 12625/12626 Kerala Express.

- **2026-09-05**: Baseline vs XGBoost models built and evaluated using TimeSeriesSplit. 
  - Naive Baseline MAE: 35.28 minutes
  - XGBoost CV MAE: 27.99 minutes
