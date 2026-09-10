# Project Limitations and Assumptions

This document clearly outlines the current limitations of the RippleETA prototype and the assumptions made during its development. 

## 1. Ground Truth & MLOps Recalibration
**Limitation:** Due to the lack of live NTES (National Train Enquiry System) or COA (Control Office Application) API keys during this hackathon, we cannot log live actual arrival times.
**Current behavior (Backtest Mode):** `jobs/nightly_recalibration.py` evaluates the current model and an unsaved candidate against a deterministic chronological holdout from the historical dataset. It reports the comparison and never replaces the deployed artifact. It does not run live rolling-MAE monitoring, ADWIN, or automatic retraining.
**Phase 2 roadmap:** Add live ground-truth collection, a rolling-MAE monitor, ADWIN change-point detection, and a human-reviewed retraining workflow. A candidate must beat or match the frozen holdout's pinball loss and coverage before any explicitly approved promotion; drift alerts must not silently swap models.

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