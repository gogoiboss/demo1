# RippleETA Feature Status & Verification Table

This document provides a single, unvarnished source of truth regarding what features are **REAL** (backed by live verified math and real datasets), **PARTIALLY REAL** (proxy calculations or synthetic scenario data), or **NOT YET BUILT** (plainly labeled as planned/future roadmap items).

---

## 1. Role-by-Role Feature Status

| Role | Blueprint Feature | Implementation Status | Data Source / Underlying Computation | Notes & Disclosures |
| :--- | :--- | :--- | :--- | :--- |
| **Passenger** | **The Honest Ticket** | **REAL** | XGBoost base regressor + MAPIE Conformal split calibration | Displays guaranteed empirical interval $[P_{10}, P_{90}]$ with $89.9\%$ coverage. |
| **Passenger** | **Temporal Trend Badge** | **REAL** | SQLite database `predictions_history.db` | Evaluates $\Delta = \text{delay}_t - \text{delay}_{t-1}$; categorizes as Improving, Stable, or Worsening. |
| **Passenger** | **Reflect Journey Timeline** | **PARTIALLY REAL** | API proxy station sequence (`historical_stations`) | Provides stop sequence and platform updates from snapshot; live RTIS GPS feed is optional fallback. |
| **Station Master** | **Platform Triage (COMMIT/DEFER)** | **REAL** | Interval width check $(P_{90} - P_{10}) \le 30\text{ min}$ | Disclosed rule: SM locks platform 60�90 min out when bounds are narrow; defers when uncertainty is wide. |
| **Station Master** | **Decision Countdown Clock** | **REAL** | $\max(0, 90.0 - \text{width})$ | Computes time remaining before platform reservation must be finalized. |
| **Station Master** | **Synthesized VHF Radio Script** | **REAL** | Dynamic template synthesis in `src/api/app.py` | Formatted voice prompt for station announcers/VHF handheld broadcast. |
| **Crew Controller** | **HOER Overlap Timeline Bar** | **REAL** | Calculated against HOER 2005 rules | Compares 9-hour running duty ceiling against predicted arrival window. |
| **Crew Controller** | **Relief Dispatch Deadline** | **REAL** | $\text{Now} + \max(15, 120 - P_{90})$ | Automatically computes lobby call-up time to eliminate stranded train stops. |
| **Feeder Transport** | **Probability-to-Cutoff Meter** | **REAL** | Normal CDF distribution $P(\text{arr} \le \text{cutoff})$ | Standard normal integral with $\sigma = (P_{90} - P_{10})/2.56$ to guide wait vs depart. |
| **Feeder Transport** | **Expected Cost Decision Matrix** | **REAL** | Three-tier recommendation ($P \ge 0.8$: WAIT, $P < 0.4$: DEPART) | Balances idle driver hours against missed connection transfer penalties. |
| **Maintenance** | **Turnaround Measuring Tape** | **REAL** | $\text{Available} = \text{Next Departure} - P_{90}$ | Visually renders available pit-line buffer against 180-min standard secondary maintenance. |
| **Maintenance** | **Compressed Protocol Alert** | **REAL** | Flagged when $\text{Window} < 180\text{ min}$ | Gives yard supervisor 2�3 hours advance notice to request schedule intervention. |
| **Control Room** | **Propagation Radar** | **REAL** | `CachedPropagationEngine` on two-train schedule | Real max-plus acyclic event graph computation with 10-minute headway edge. |
| **Control Room** | **Live Prediction Counter** | **REAL** | SQLite count from `prediction_logs` | Real-time tally of verified predictions generated across all modes. |
| **Control Room** | **Cross-Train Attribution** | **NOT YET BUILT** | Labeled as unavailable from station-event snapshot | Disclosed in docs/LIMITATIONS.md; planned for full network ingestion. |
| **Ghost Sandbox** | **Delay Injection Simulator** | **REAL (SIMULATION)** | `compute_sandbox_propagation()` | Interactive what-if simulator using real max-plus math; labeled `[ REPLAY SIMULATION ]`. |

---

## 2. Global & Architectural Features

| Feature | Scope | Status | Technical Implementation |
| :--- | :--- | :--- | :--- |
| **Pre-Auth Walkthrough Preview** | Landing Page (`/`) | **REAL (Labeled)** | Video embed link with clear `[PLACEHOLDER WALKTHROUGH PREVIEW]` tag. |
| **Role Demo Launcher** | `/demo-launcher` & Index | **REAL** | Single-click entry point to any of the 7 isolated operational pages without repeated OAuth. |
| **Multilingual Support (EN / HI)** | Global Navigation | **REAL** | Topbar language toggle translating static labels to Hindi across all 7 views. |
| **Route Map & Train Differentiation**| Corridor Views | **REAL (Curated)** | Verified route profile and color-coded train classification (Rajdhani ?, Express ??, Local ???). |
| **Help & FAQ Knowledge Panel** | Global Navigation | **REAL (Labeled)** | Keyword-searchable knowledge panel labeled `[PREDEFINED KNOWLEDGE BASE � NOT CONVERSATIONAL AI]`. |
| **Google Authentication** | Intro Scene | **REAL** | Full Google Identity Services token verification with backend session cookie. |

---

## 3. Core ML & Backtest Calibration Verification

**Canonical result — per-route chronological backtest (`src/evaluation/backtest.py`), 174 held-out rows across the 6 selected routes:**
- **Empirical Coverage:** **$97.70\%$** (Target: $90.0\%$)
- **P50 Median Absolute Error (MAE):** **$28.386\text{ min}$**
- **Average Conformal Interval Width:** **$106.589\text{ min}$**

This supersedes the earlier all-data evaluation; see docs/RESULTS.md for full methodology.

*Superseded figures (kept for a paper trail, not deleted) — from an earlier, looser evaluation pooling all routes/trains into one chronological split via `python -m src.calibration.conformal`, rather than the per-route backtest above:*
- Base Estimator: XGBoost Regressor (`n_estimators=100`, `max_depth=6`, `lr=0.1`)
- Calibration Split: strict chronological split ($70\%$ train, $15\%$ calibration, $15\%$ held-out test), pooled across all trains
- Empirical Coverage: $89.9\%$ (Target: $90.0\%$)
- P50 MAE: $27.95\text{ min}$
- Average Conformal Interval Width: $81.7\text{ min}$
- Anomaly Gate Cutoff: $53.1\text{ min}$ ($90^{\text{th}}$ percentile absolute calibration residual)
