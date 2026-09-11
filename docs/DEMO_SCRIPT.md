# RippleETA Live Demo Script

## Before the demo

From `rippleeta/`, open two terminals:

```powershell
# Terminal 1: API
uvicorn src.api.app:app --reload --port 8000

# Terminal 2: dashboard
python -m http.server 5500 --directory dashboard
```

Open `http://127.0.0.1:5500` and keep `http://127.0.0.1:8000/docs` available in another tab.

Use train `20507`, which exists in the local processed artifact. The dashboard displays a clear offline demo snapshot if the API is unavailable, but live API mode is the preferred path.

## Walkthrough

### 1. Passenger view

Click **Passenger**.

Say:

> “A passenger does not need a control-room table. They need three facts: how late the train is, whether the trend is stable, and when the next update will arrive.”

Point to the P10/P50/P90 range and the amber calibrated window. Explain that the range is deliberately more honest than a single ETA.

### 2. Station Controller view

Click **Station Controller**.

Say:

> “The same forecast becomes an operational decision: commit a platform now, or defer until uncertainty narrows.”

Point to the platform decision, decision timer, interval width, and conflict signal. This view is denser because the station controller is acting on resource allocation, not planning a journey.

### 3. Control Room replayed conflict trace

Click **Control Room**, then click **Trace conflict**.

Say:

> “This is the differentiator. The amber path is the conflict edge in the timed event graph. The API runs the corrected station-pair replay: Train 56789 at +15 minutes constrains Train 12301, adding +9 minutes and producing +64 minutes at the section exit. This is a replayed graph computation, not live network inference.”

Call out the station-pair approximation note. This is a real graph computation on a replayed scenario, not a live network backtest. Do not describe it as block-level occupancy: public data does not provide that signal.

### 4. API proof

Open `/docs` and expand:

- `GET /predict/{train_id}`
- `GET /predict/{train_id}/passenger`
- `GET /predict/{train_id}/station-master`
- `GET /predict/{train_id}/crew-controller`
- `GET /predict/{train_id}/feeder-transport`
- `GET /predict/{train_id}/maintenance`

Say:

> “These are not cosmetic dashboard tabs. The API translates one calibrated forecast into five decision-specific contracts.”

### 4a. "Why does it predict that?" — SHAP explanation

If a judge asks why the model produced a given number, do not answer in the abstract — show it live:

1. In `/docs`, call `GET /predict/{train_id}` for a train (e.g. `20507`).
2. Scroll the response to the `shap_text` and `shap_explanation` fields.

Say:

> “This isn’t a black box. Every prediction carries its own SHAP attribution — computed per row from the trained XGBoost model, not a canned explanation. `shap_text` gives the plain-language version, for example ‘55% rake delay; 30% schedule buffer’; `shap_explanation` gives the full ranked percentage breakdown across every feature we feed the model.”

Note: when the anomaly gate has suspended a prediction, `shap_explanation` is intentionally empty and `shap_text` reads "Explanation unavailable." — the system doesn't fabricate a rationale for a number it isn't confident enough to show.

### 5. MLOps and Reproducibility (Q&A material)

If judges ask "How would you tune this?" or "Is this deployable?":

1. Open `config.yaml` to show that all hyperparameters, coverage targets, and anomaly thresholds are parameterized.
2. Open `models/experiment_log.jsonl` to show that every training run is logged with its exact git commit, parameters, and metrics.
3. Open `Dockerfile` and `.github/workflows/tests.yml` to show the project is containerized and protected by continuous integration.
4. Call out the API provenance dict (`GET /predict/{train_id}`), which attaches the versioned model artifact name (e.g., `calibrated_eta_engine_20260906T..._<commit>.joblib`) to every prediction.

Say:
> “We built the boring 20% around the model so it reads as engineered, not assembled. It has CI, Docker, centralized configuration, and input/output monitoring gates.”

## Fallback plan

If the API fails:

1. Leave the dashboard open. It falls back to a marked realistic demo snapshot and keeps the three views and conflict trace interactive.
2. If the static server fails, open `dashboard/index.html` directly in a browser and use the same interaction path. API mode will be unavailable, but the demo state remains visible.
3. If the browser is unavailable, show `docs/RESULTS.md`, `notebooks/04_final_backtest_report.ipynb`, and the committed dashboard files. Use the measured headline: 34.746-minute baseline MAE to 28.386-minute full P50 MAE, 18.30% improvement, and 97.70% P10-P90 coverage over 174 held-out journeys.
4. Do not claim that the real-data backtest measured graph propagation. State clearly that graph-adjusted rows were zero because station-pair live state is absent from the artifact.

## Closing line

> “RippleETA does not promise a perfect point estimate. It gives each stakeholder the uncertainty and decision signal appropriate to their job, and it is explicit about where the current public data stops.”