# Project Limitations and Assumptions

This document clearly outlines the current limitations of the RippleETA prototype and the assumptions made during its development. 

## 1. Ground Truth & MLOps Recalibration
**Limitation:** Due to the lack of live NTES (National Train Enquiry System) or COA (Control Office Application) API keys during this hackathon, we cannot log live actual arrival times.
**Current behavior (Backtest Mode):** `jobs/nightly_recalibration.py` computes MAE on a deterministic chronological holdout from the historical dataset and applies a real threshold-based drift trigger (retrains a candidate only when MAE exceeds a configurable 15-minute default). Any candidate is evaluated against the current model and never replaces the deployed artifact. This is a static threshold, not statistical change-point detection — it does not run live rolling-MAE monitoring, ADWIN, or automatic retraining.
**Phase 2 roadmap:** Add live ground-truth collection, a rolling-MAE monitor, ADWIN change-point detection, and a human-reviewed retraining workflow. A candidate must beat or match the frozen holdout's pinball loss and coverage before any explicitly approved promotion; drift alerts must not silently swap models.

## 6. Validated Scope & Deployment Path
The checked-in artifact contains 10,000 journey rows covering 56 train numbers. The measured Phase 3A benchmark is a synthetic 500-train, 8-stop cached propagation pass completed in 20.58 ms with numerical equivalence to the reference implementation. This supports a zone-scale hypothesis (roughly 500–800 trains), but it is not a national load test or proof of national modeling performance.

Full national rollout is a phased infrastructure question: CRIS/RTIS access and data contracts, zone-by-zone operational validation, station integration, capacity testing, and governance must precede expansion. The service is designed to be stateless and horizontally scalable on railway-controlled on-premise infrastructure or NIC/MeghRaj. RailRadar and scraped NTES are prototype/replay paths; CRIS/RTIS is the intended production integration path once deployed. Hindi plus zone-language passenger output and low-bandwidth/offline station displays are near-term deployment items, not implemented claims in this prototype.

## 2. Real-Time Feeds (Weather, TSRs, Signal Aspects)
**Limitation:** The Problem Statement requires adapting to dynamic real-time events like Temporary Speed Restrictions (TSRs) and signal aspects.
**Workaround:** We built the API schemas and UI to correctly handle and display this data. However, the data currently populating these fields in the prototype is injected via deterministic proxy logic (hashing the Train ID) to simulate how the system reacts. The XGBoost model itself is currently trained only on static historical metrics (distance, scheduled travel hours).

## 3. Prescriptive Tier (Ripple Score & INR Financial Cost)
**Limitation:** A true network criticality ranking requires simulating dozens of counterfactual realities (e.g., holding Train A vs Train B) across the full Indian Railways schedule.
**Workaround:** Our UI proudly features a Ripple Score and INR Cost translation to demonstrate the *concept* of shifting from predictive ETA to prescriptive triage. However, the exact numbers shown in the demo are proxy constants. A production rollout would require a full schedule integration to accurately run the max-plus propagation counterfactuals.

## 4. Graph Propagation Scope
**Limitation:** The Timed Event Graph currently relies on a fixed network topology and is heavily optimized for a localized corridor demo (e.g., Kanpur to Allahabad).
**Future Work:** Scaling this graph to all 17 administrative zones requires comprehensive adjacency lists and scheduled headroom/turnaround matrices that were beyond the scope of a 36-hour hackathon.

## 4. Hard vs. Soft Network Conflicts (Explicit Design Decision)
Because real-time block-section occupancy data (track circuits / live signaling) is not publicly available, we cannot deterministically model micro-level network congestion.

Rather than silently ignoring this gap, we made an explicit modeling choice to split the graph propagation into two strictly defined edge types:
- **HARD Conflicts (`conflict_type="hard"`):** Rake reuse and crew handoff. These are **deterministic** constraints fully supported by the operational scheduling data we ingest. A train's next assignment either shares a rake/crew with a prior service, or it doesn't.
- **SOFT Conflicts (`conflict_type="soft"`):** Shared-section headway. These are **probabilistic approximations**. We infer section congestion dynamically from the scheduled timetable's station-pairs rather than relying on absent signal-state telemetry.

This distinction is baked directly into the graph data structure and surfaced through the API (`get_prediction`) so that downstream consumers (e.g. Station Masters) can assign different confidence levels to a deterministic hardware delay vs. a probabilistic congestion delay.

## 7. Training-Serving Feature Skew Risk (Shared Module, Latent Only)
**Finding (Round 2 verification):** `src/features/engineering.py` is genuinely shared — every training, backtest, and serving call site delegates to the same `engineer_all_features()` function, with no duplicated feature logic anywhere in the codebase. The real, exercised serving path (`RippleETAPipeline.run()`) engineers features once over the full historical batch and slices an already-engineered row out for prediction; this is verified byte-identical to the training path in `tests/test_features.py`.
**Latent risk:** `CalibratedPredictionPipeline.predict()` has a fallback that calls `engineer_all_features()` itself when handed a DataFrame missing the model's feature columns. Rake inheritance (`prior_leg_delay`) is a `groupby().shift(1)` over the full batch, so if that fallback were ever exercised with a single isolated row (no current caller does this), it cannot see a real previous leg and silently defaults `prior_leg_delay` to 0 instead of the true value — a genuine training-serving skew, confirmed empirically and pinned by a regression test. A warning is now logged if this path is hit with insufficient per-train history. Any future caller must supply pre-engineered features or a batch with real history, never a raw isolated row.

## 8. Low-Bandwidth / 2G Station Display Mode (Acknowledged, Unaddressed)
**Finding (Round 2 verification):** Checked `dashboard/` and `frontend/` directly for any low-bandwidth fallback (text-only mode, reduced asset loading, offline-friendly rendering) — none exists. Every view loads the full dashboard/frontend asset set regardless of connection quality. This is a genuine, acknowledged gap, not a stub or partial implementation to describe further. Given how low a priority this is relative to the core prediction and stakeholder-decision features, it has not been built, and none should be assumed or claimed in a demo. A real low-bandwidth mode (text-only rendering, minimal payload, no client-side JS framework weight) remains future work.

## Phase 1 Audit Disclosures
- **Cross-Train Attribution:** NOT IMPLEMENTED. The UI field is a stub based on train ID hashing.
- **Downstream Congestion Score:** NOT IMPLEMENTED. The UI field is a stub.
- **Ripple Score & Financial INR Impact:** NOT IMPLEMENTED. Currently computed via modulo arithmetic.
- **Cost Asymmetry:** NOT IMPLEMENTED. Hardcoded to True in the API.
- **Nightly Recalibration:** PARTIALLY IMPLEMENTED. The script exists and trains a model, but explicitly prevents auto-deployment.
