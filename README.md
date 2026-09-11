# RippleETA

**Network-aware train ETAs that replace false precision with an honest, narrowing delay window.**

> Smart India Hackathon 2026 · Problem Statement 26028 · Team Outliers  
> Ministry of Railways · Theme: Smart Automation · Category: Software  
> **Round 1: Cleared — 86.5 / 100**

Indian Railways' existing systems (NTES, RailYatri, Where Is My Train) all treat trains as isolated vehicles on empty tracks and report a single point-estimate ETA that can be 30 minutes stale between stations. RippleETA models trains as a network — a delay in one train propagates into others through shared rakes, shared crew, and shared track sections. It outputs a calibrated P10/P50/P90 uncertainty window per stakeholder rather than one number that pretends to be certain.

## Why Existing Systems Fail

| System | What it does wrong |
|---|---|
| **NTES** | Assumes max line speed; position frozen between stations (up to 30-min lag) |
| **RailYatri** | Pattern-matches historical runs; ignores network effects |
| **Where Is My Train** | Cell-tower triangulation; no delay propagation, no uncertainty |
| **RippleETA** | Predicts how delay spreads across the network; outputs P10/P50/P90 intervals |

## How It Works

### 3.1 Inherits — rake-cycle awareness

A train's delay is not random. When the incoming rake (the physical train set) ran late on its previous leg, the next departure starts late. This correlation is strong (>80% on the training set). RippleETA models this explicitly as the `prior_leg_delay` feature — a signal no public-facing system queries.

### 3.2 Faces — headway-based network conflict detection

The railway is modelled as a timed event graph (Goverde, 2010 — max-plus algebra). Trains share track sections; if Train A holds a section, Train B cannot enter until Train A clears. RippleETA propagates delays through this graph in a single forward traversal using two explicit conflict edge types:

- **Hard conflicts** (rake reuse, crew handoff) — deterministic; fully supported by operational scheduling data.
- **Soft conflicts** (shared-section headway) — probabilistic; inferred from timetabled station-pair headway because live block-signal telemetry is not publicly available. This is an explicit, stated modeling assumption, not a hidden gap.

### 3.3 Translates — calibrated probability windows per stakeholder

Instead of one ETA for everyone, RippleETA outputs five distinct decision-ready answers from one forecast, using MAPIE conformal prediction (P10/P50/P90) with a statistical coverage guarantee. When conditions are anomalous (variance > 3× historical baseline), the system outputs `PREDICTION SUSPENDED` rather than a false number.

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


| Layer | Technology |
|---|---|
| Language | Python 3.9+ |
| Prediction engine | XGBoost + scikit-learn (TimeSeriesSplit — no future leakage) |
| Calibrated output | MAPIE (conformal prediction — P10/P50/P90) |
| Explainability | SHAP (per-prediction feature attribution) |
| Network modelling | NetworkX (timed event graph, max-plus algebra) |
| Anomaly detection | Variance gate (3× historical baseline → PREDICTION SUSPENDED) |
| API | FastAPI + uvicorn + Pydantic |
| Auth | Google Identity Services (JWT) |
| Dashboard | HTML/CSS/JS (5 role views + Ghost Sandbox) |
| Database | SQLite (prediction history, audit logs) |
| MLOps | MLflow model registry (docker-compose) |
| Containers | Docker + docker-compose |

## Five Stakeholder Outputs

| Stakeholder | What they get today (NTES) | What RippleETA gives them |
|---|---|---|
| Passenger | "Running on time" while train sits still | Delay in minutes + trend badge (Improving/Stable/Worsening) + P10–P90 window |
| Station Master | Platform committed only 30 min out; lines idle under uncertainty | COMMIT/DEFER flag 60–90 min out; interval width drives the call |
| Crew Controller | Relief timed from scheduled ETA → HOER stops block 5–15 trains | Dispatch deadline from predicted ETA, recalculated every 30 min |
| Feeder Transport | No signal exists; buses guess or wait idle | P(arrival before cutoff) — one probability, not guesswork |
| Maintenance | Turnaround window discovered on arrival — rushed or cascades | Alert 2–3 hrs early: flags when turnaround window drops below threshold |

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

Evaluation methodology: Each of the six routes was split independently into 70% chronological training / 15% MAPIE calibration / 15% held-out test data. No future data was used for training (TimeSeriesSplit). The `prior_leg_delay` persistence model (which just carries the last known delay forward) is the baseline. Full detail in [docs/RESULTS.md](docs/RESULTS.md).

- **Selected routes:** 6 (12301, 12302, 12951, 12952, 12625, 12626)
- **Held-out test rows:** 174
- **Prior-leg baseline MAE:** 34.746 min
- **Full evaluated model P50 MAE:** 28.386 min
- **Absolute improvement:** 6.360 min (18.30%)
- **Empirical P10–P90 coverage:** 97.70%
- **Average conformal interval width:** 106.589 min
- **Graph-adjusted rows in backtest:** 0 (data limitation — see Known Limitations)
- **Synthetic propagation benchmark:** 500 trains × 8 stops in 20.58 ms

On a 1,500-row chronological held-out test split from the full dataset, RippleETA's evaluated model reduces MAE to 28.22 minutes, materially matching the earlier six-route canonical evaluation (28.386 minutes, 174 rows). A per-train regression with no network features ties on point MAE (28.15 minutes) — but RippleETA's calibrated P10–P90 intervals cut Pinball Loss by 55.5% against the naive baseline and 42% against that same per-train regression, which is where the real value of network-aware calibration shows up. Stratified (Mondrian) conformal coverage lands at 89.7–91.0% against a 90% target across all delay-magnitude buckets, with materially tighter intervals (82–85 min) than the original headline figure. A full-pipeline throughput run processed 3,000 journey predictions through the full pipeline at 3.30ms per prediction with zero failures.

## Repository Structure

```text
rippleeta/
├── src/
│   ├── api/            # FastAPI app, Pydantic schemas, Google Auth
│   ├── calibration/    # MAPIE conformal, anomaly gate, pipeline
│   ├── evaluation/     # Chronological backtest (canonical results)
│   ├── features/       # Feature engineering (shared by training + serving)
│   ├── graph/          # Timed event graph, max-plus algebra, worked example
│   ├── ingestion/      # Kaggle loader, timetable, RailRadar client
│   ├── models/         # XGBoost model, persistence baseline
│   ├── pipeline.py     # End-to-end orchestration with provenance
│   ├── model_promotion.py  # Promotion gate — never auto-deploys
│   └── validation.py   # Ingest schema validation
├── dashboard/          # 5 stakeholder HTML views + Ghost Sandbox
├── frontend/           # React/HTML landing page with Google Auth
├── eval/               # Standalone evaluation scripts (SHAP, baselines, bench)
├── tests/              # 26 pytest tests
├── notebooks/          # 4 Jupyter notebooks (exploration → backtest report)
├── jobs/               # Nightly recalibration (backtest-mode only, no auto-deploy)
├── docs/               # Architecture, results, limitations, demo script
├── scripts/            # seed_db.py
├── config.yaml         # All tuneable parameters
├── docker-compose.yml  # API + dashboard + MLflow
├── Makefile            # make seed / make demo
└── requirements.txt
```

> **Note:** `data/` and `models/` are gitignored — generate them locally using the setup steps below.

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

   `data/raw/train_delay.csv` is **not** checked into git (`data/` is
   gitignored — see the note above); you must place the raw Kaggle CSV
   there yourself before running this. This command then regenerates
   `data/processed/kaggle_competition_cleaned.parquet` from it. Required
   columns: `train_number`, `journey_date`, `actual_delay_minutes`,
   `scheduled_travel_hours`, `distance_km`, `zone_congestion_index`,
   `monsoon_flag`, `fog_risk`, `coach_count`, `loco_age_years` — see
   `src/ingestion/load_kaggle.py` for the full variant-detection schema.

2. **Train the baseline/XGBoost artifact**

   ```powershell
   python -m src.models.xgboost_model
   ```

3. **Run the final chronological backtest**

   ```powershell
   python -m src.evaluation.backtest
   ```

4. **Verify the complete prediction chain** from raw data to calibrated output:

   ```powershell
   python -c "from src.pipeline import RippleETAPipeline; print(RippleETAPipeline().run('20507'))"
   ```

   This runs raw-data loading, feature engineering, XGBoost fitting, the
   explicit conflict-graph boundary, MAPIE calibration, and the final result.
   The graph reports `not_activated_no_station_event_state` because the public
   journey artifact has no paired station-event observations; it does not
   fabricate a network adjustment.

5. **Start the API** in one terminal:

   ```powershell
   uvicorn src.api.app:app --reload --port 8000
   ```

   Open the interactive API at `http://127.0.0.1:8000/docs`.

6. **Start the dashboard** in a second terminal:

   ```powershell
   python -m http.server 5500 --directory dashboard
   ```

   Open `http://127.0.0.1:5500`. Enter a train ID such as `20507`, then move through Passenger, Station Controller, and Control Room views. The dashboard displays `API UNAVAILABLE` rather than local sample data if the API is stopped. Full demo instructions are in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

Run all tests with:

```powershell
python -m pytest -q
```

## Known Limitations / Future Work

### Validated Scope And Deployment Boundary

The checked-in artifact contains 10,000 journey rows covering 56 train numbers. The Phase 3A synthetic benchmark completes a cached propagation pass for 500 trains × 8 stops in 20.58 ms with numerical equivalence to the reference implementation. This supports a zone-scale hypothesis of roughly 500–800 trains, not a national load-test claim. Full national rollout is a phased infrastructure program requiring CRIS/RTIS access, zone-by-zone validation, capacity testing, and station integration.

The deployment path is stateless and horizontally scalable on railway-controlled on-premise infrastructure or NIC/MeghRaj rather than foreign public cloud. RailRadar and scraped NTES are prototype/replay sources; CRIS/RTIS is the production integration target once deployed. Hindi plus zone-language passenger output and low-bandwidth/offline station displays are near-term deployment requirements, not current prototype claims.

- The checked-in journey artifact does not contain signal-aspect, block occupancy, station-event sequences, or paired live positions. Conflict propagation is therefore not measured in the final backtest.
- Weather fields are coarse binary indicators; live weather and continuous signal/aspect feeds are not connected.
- The six selected train IDs are a narrow validation scope, not a network-wide Indian Railways benchmark.
- The real held-out 12301 example missed its upper interval by 1.099 minutes; the illustrative 12301/56789 `+9` minute conflict is not validated on real paired data.
- The measured 28.386-minute MAE does not reach the 5-9-minute literature range. It should not be presented as reproducing that range.
- CRIS/RTIS integration, route-specific station graph construction, drift monitoring, authentication, persistence, and production deployment remain future work; RailRadar/NTES are prototype/replay sources only.
- docs/FEATURE_STATUS.md reports a different coverage figure (89.9%) from an earlier all-data evaluation; docs/RESULTS.md is canonical and supersedes it.
- jobs/scalability_benchmark.py currently reports near-zero latency due to an AttributeError silently caught — the legitimate performance claim comes from eval/bench_propagation.py (500 trains × 8 stops / 20.58 ms).
- Ripple Score, INR financial impact, and downstream congestion score shown in the Control Room dashboard are proxy calculations (modulo arithmetic), not real counterfactual simulations.
- Cross-train attribution in the UI is a stub based on train ID hashing, not real graph attribution.
- ADWIN / drift detection is a Phase 2 roadmap item; nightly_recalibration.py exists but does not auto-deploy or run live drift monitoring.

## License

MIT. See [LICENSE](LICENSE).
