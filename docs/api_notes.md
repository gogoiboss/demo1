# RippleETA API Notes

Run the app from `rippleeta/` with:

```bash
uvicorn src.api.app:app --reload
```

Interactive documentation is available at `http://127.0.0.1:8000/docs`.

## Endpoints

### Health

`GET /health`

Returns service status and whether the lazy prediction model has been loaded.

```json
{"status":"ok","service":"rippleeta","model_loaded":false}
```

### Full prediction

`GET /predict/{train_id}`

Returns calibrated P10/P50/P90 delay bounds, conflict adjustment, and anomaly state.

```json
{
  "train_id": "12301",
  "status": "PREDICTION ACTIVE",
  "p10_delay_min": 20.0,
  "p50_delay_min": 35.0,
  "p90_delay_min": 55.0,
  "anomaly_flag": false,
  "uncertainty_mode": false,
  "conflict_adjustment_min": 5.0,
  "message": "Calibrated network-aware prediction."
}
```

Pass `prediction_variance` as a query parameter to exercise the anomaly gate. When it exceeds the learned 3x historical variance threshold, P50 is suppressed and the response status is `PREDICTION SUSPENDED - anomalous conditions`.

### Passenger

`GET /predict/{train_id}/passenger`

Returns delay, trend, and the next refresh time for passenger-facing displays.

### Station master

`GET /predict/{train_id}/station-master`

Returns `COMMIT`, `DEFER`, or `SUSPENDED` for platform commitment, plus the time until a decision is needed.

### Crew controller

`GET /predict/{train_id}/crew-controller`

Returns a predicted relief dispatch deadline derived from the upper calibrated delay bound.

### Feeder transport

`GET /predict/{train_id}/feeder-transport?cutoff_time=2026-09-05T18:00:00Z`

Returns the probability that the train arrives before the cutoff and a `WAIT`, `DEPART`, `USE JUDGMENT`, or `SUSPEND` recommendation.

### Maintenance

`GET /predict/{train_id}/maintenance`

Returns the estimated turnaround time remaining before the next service and whether the standard 3-hour maintenance window remains adequate.

## Errors

- `404`: the train ID is not present in the current data snapshot.
- `422`: query parameters fail Pydantic validation.
- `503`: model data or prediction service is unavailable.

All errors use FastAPI's JSON `detail` field rather than exposing a traceback.
