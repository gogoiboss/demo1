# RippleETA: Architecture & Intelligence Deep-Dive

This document details the complete backend architecture, mathematical models, and "intelligence" layers that power RippleETA.

## 1. The Core Prediction Engine (XGBoost)
* **Tech Stack:** Python, `xgboost`, `pandas`, `scikit-learn`.
* **Intelligence:** Standard ML point-prediction is handled by an XGBoost regressor trained on a historical dataset of train journeys. 
* **Validation:** We strictly use `TimeSeriesSplit` to prevent future data leakage (a common flaw in student ML projects that artificially inflates accuracy).
* **Feature Set:** Predicts based on scheduled travel hours, distance, and critical explicit variables like `weather_risk_flag` (Monsoon/Fog), `tsr_active` (Temporary Speed Restrictions), and `signal_aspect_restriction`.

## 2. The Uncertainty Engine (Conformal Prediction)
* **Tech Stack:** `mapie` (Model Agnostic Prediction Interval Estimator).
* **Intelligence:** Neural networks output dangerous "black-box" point estimates. We wrap our XGBoost model in MAPIE to perform **Conformal Prediction**.
* **Output:** It mathematically calibrates the residuals to generate guaranteed P10, P50, and P90 confidence intervals (e.g., 90% guaranteed coverage). We output bounded risk (a time window) instead of a false certainty.

## 3. The Physics Engine (Timed Event Graph)
* **Tech Stack:** Python, `networkx`, Max-Plus Algebra (Goverde, 2010).
* **Intelligence:** ML models treat trains as isolated vehicles. Our Timed Event Graph treats the railway as a shared resource. If Train A is delayed, the graph uses max-plus algebra to physically propagate that delay to Train B because they share a downstream track section.
* **Output:** Generates a `downstream_congestion_score` and `cross_train_attribution` (e.g., "40% of this train's delay is inherited from Train X").

## 4. The Prescriptive Layer (Game Theory & Triage)
* **Tech Stack:** FastAPI Python Logic.
* **Intelligence:** Moves the system from *Predictive* (what will happen) to *Prescriptive* (what to do about it).
* **Ripple Score:** Ranks trains by network criticality (how much cascading damage they will cause if delayed further), rather than just raw minutes late.
* **Financial Impact:** Translates network delay into a real INR (Rupee) cost (e.g., crew overtime burn + penalties) to drive executive decision-making.
* **Cost-Asymmetry Aware:** The logic heavily penalizes false negatives (predicting on-time when actually late) because trapping a platform destroys downstream capacity.

## 5. The Anomaly Gate (Honesty & Safety)
* **Intelligence:** The pipeline continually tracks prediction variance against a historical baseline threshold. 
* **Action:** If the data is too chaotic (e.g., a derailment or sensor failure), the Anomaly Gate fires, intercepts the API payload, and explicitly outputs `PREDICTION SUSPENDED`. It tells the Station Master to fall back to manual charts, proving the system is self-aware of its own limitations.

## 6. Continuous Refinement Loop (MLOps)
* **Tech Stack:** `sqlite3`, Python (`jobs/nightly_recalibration.py`).
* **Current prototype:** Predictions are logged locally, and the nightly script can evaluate a candidate in backtest mode against a deterministic chronological holdout. The candidate is not written to the deployed path, and there is no live rolling-MAE or ADWIN detector.
* **Phase 2 roadmap:** Add live ground-truth monitoring, rolling-MAE plus ADWIN change-point detection, and an alert-driven, human-reviewed retraining process. Promotion must be gated by non-regressing pinball loss and coverage on a frozen holdout.

## 7. The API Layer
* **Tech Stack:** `FastAPI`, `uvicorn`, `pydantic`.
* **Design:** Fully decoupled, event-driven REST API. It exposes 5 distinct endpoints tailored to specific railway stakeholders (`/passenger`, `/station-master`, `/crew-controller`, `/feeder-transport`, `/maintenance`).
* **Performance:** Benchmarked to process 3,000 trains (the daily coaching fleet) in milliseconds on a single CPU, bypassing the need for expensive GPU clusters.
