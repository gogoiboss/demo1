"""
C4 — Calibrated Output Engine
==============================

Wraps XGBoost point-estimate predictions in statistically calibrated
conformal prediction intervals (lower / point / upper) using MAPIE.

Key design choices (from pitch materials and research):
  1. CONFORMAL PREDICTION via MAPIE — not Bayesian, not bootstrap.
     Coverage guarantee: "our 90% interval contains truth 90% of the time."
     This is a distribution-free guarantee (Angelopoulos & Bates, 2023).
     We use MapieRegressor with method="plus" (split conformal) which gives
     marginal coverage and is the standard for tabular regression.

  2. CALIBRATION SPLIT — chronological (matching TimeSeriesSplit logic).
     Training set: first 70% of data (sorted by journey_date).
     Calibration set: next 15%.
     Test set: last 15%.
     We never use future data to calibrate past predictions.

  3. ANOMALY GATE — if delay accumulation rate exceeds 3× the historical
     90th percentile, suppress point estimate and switch to uncertainty mode.
     Threshold is based on the empirical delay distribution of our dataset.

  4. SHAP EXPLANATIONS — per-prediction feature attributions in plain language,
     matching the pitch claim: "55% weight: rake delay; 30%: section conflict".
     We use shap.TreeExplainer (exact, fast for XGBoost).

  5. INTERVAL OUTPUT — p50 is the point estimate from the model or graph.
      The lower and upper bounds are conformal prediction-interval bounds;
      they are not asserted to be conditional quantiles.

References:
  - Angelopoulos & Bates (2023), "Conformal Prediction: A Gentle Introduction"
  - MAPIE documentation: https://mapie.readthedocs.io/
  - Pitch materials: technical_slide_content.md §Step 4
"""

from __future__ import annotations

import logging
import warnings
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
import joblib
from src.calibration.anomaly_gate import AnomalyGate

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Try importing MAPIE and SHAP — both optional for unit tests
# ---------------------------------------------------------------------------
try:
    from mapie.regression import SplitConformalRegressor

    MAPIE_AVAILABLE = True
except ImportError:  # pragma: no cover
    SplitConformalRegressor = None
    MAPIE_AVAILABLE = False
    logger.warning(
        "MAPIE not installed — conformal intervals unavailable. "
        "Run: pip install mapie"
    )

try:
    import shap

    SHAP_AVAILABLE = True
except ImportError:  # pragma: no cover
    shap = None
    SHAP_AVAILABLE = False
    logger.warning(
        "SHAP not installed — explanations unavailable. " "Run: pip install shap"
    )

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ANOMALY_MULTIPLIER = 3.0  # gate fires if rate > 3× historical p90
COVERAGE_90 = 0.90  # target coverage for outer interval

DEFAULT_FEATURES = [
    "scheduled_travel_hours",
    "distance_km",
    "zone_congestion_index",
    "monsoon_flag",
    "fog_risk",
    "coach_count",
    "loco_age_years",
    "prior_leg_delay",
    "schedule_buffer_hours",
    "day_of_week",
    "month",
    "is_weekend",
]

# Mondrian (conditional) conformal calibration — bucket boundaries on
# prior_leg_delay magnitude (minutes). Buckets: [0, 15), [15, 60), [60, inf).
# Marginal (pooled) coverage can hide a split where punctual trains are
# over-covered and significantly-delayed trains are under-covered — exactly
# the trains where a Station Master most needs an honest wide interval.
MONDRIAN_BUCKET_EDGES = [15.0, 60.0]
MONDRIAN_MIN_BUCKET_SIZE = 20  # below this, fall back to the pooled calibrator


def mondrian_bucket(value: float, edges: list[float] = MONDRIAN_BUCKET_EDGES) -> int:
    """Return the bucket index for a delay magnitude given bucket edges.

    Edge list [15, 60] yields buckets: 0 -> [0,15), 1 -> [15,60), 2 -> [60,inf).
    """
    for i, edge in enumerate(edges):
        if value < edge:
            return i
    return len(edges)


def bucket_label(bucket_id: int, edges: list[float] = MONDRIAN_BUCKET_EDGES) -> str:
    """Human-readable bucket label, e.g. bucket 1 of edges [15,60] -> '15-60'."""
    lo = 0.0 if bucket_id == 0 else edges[bucket_id - 1]
    hi = edges[bucket_id] if bucket_id < len(edges) else None
    return f"{lo:g}-{hi:g}" if hi is not None else f"{lo:g}+"


def per_bucket_coverage(
    X: pd.DataFrame,
    y_true: np.ndarray,
    preds: list[dict],
    mondrian_feature: str,
    edges: list[float] = MONDRIAN_BUCKET_EDGES,
) -> dict[str, dict[str, float]]:
    """Empirical P10-P90 coverage and row count, broken out per delay bucket.

    Evidence that conditional (Mondrian) calibration is actually working:
    marginal/pooled coverage can average out a bucket that is badly
    under-covered, which is exactly the failure mode this is meant to catch.
    """
    bucket_ids = X[mondrian_feature].apply(lambda v: mondrian_bucket(v, edges)).values
    p10s = np.array([r["p10_delay_min"] for r in preds])
    p90s = np.array([r["p90_delay_min"] for r in preds])
    covered = (y_true >= p10s) & (y_true <= p90s)

    report: dict[str, dict[str, float]] = {}
    for bucket_id in sorted(set(bucket_ids.tolist())):
        mask = bucket_ids == bucket_id
        n = int(mask.sum())
        coverage_pct = round(float(np.mean(covered[mask])) * 100, 1) if n else 0.0
        report[bucket_label(bucket_id, edges)] = {
            "n": n,
            "coverage_pct": coverage_pct,
            "avg_interval_width_min": (
                round(float(np.mean(p90s[mask] - p10s[mask])), 1) if n else 0.0
            ),
        }
    return report


# ---------------------------------------------------------------------------
# CalibratedETAEngine
# ---------------------------------------------------------------------------
class CalibratedETAEngine:
    """
    C4 — Calibrated Output Engine.

    Wraps a trained XGBoost regressor with:
    - MAPIE conformal prediction intervals (p10/p50/p90)
    - Anomaly gate based on 3× historical 90th-percentile delay rate
    - SHAP feature attribution per prediction

    Usage
    -----
    engine = CalibratedETAEngine()
    engine.fit(X_train, y_train, X_cal, y_cal)
    result = engine.predict(X_new, network_adjusted_delay=57.0)
    """

    def __init__(
        self,
        base_model=None,
        features: list[str] = DEFAULT_FEATURES,
        anomaly_multiplier: float = ANOMALY_MULTIPLIER,
        use_mondrian: bool = False,
        mondrian_feature: str = "prior_leg_delay",
        mondrian_bucket_edges: list[float] = MONDRIAN_BUCKET_EDGES,
    ):
        self.features = features
        self.anomaly_multiplier = anomaly_multiplier
        self.base_model = base_model  # fitted XGBRegressor
        self.mapie_90_: Any = None  # fitted SplitConformalRegressor (90%, pooled)
        self.explainer_: Any = None  # shap.TreeExplainer
        self.delay_p90_rate_: float | None = (
            None  # historical 90th-percentile delay rate
        )
        self.anomaly_gate_ = AnomalyGate(multiplier=anomaly_multiplier)
        self.fitted_ = False

        # Mondrian (conditional) conformal calibration — optional, off by
        # default. When enabled, calibration is stratified by
        # `mondrian_feature` magnitude so coverage is reported (and held)
        # per delay-severity bucket rather than only pooled/marginal.
        self.use_mondrian = use_mondrian
        self.mondrian_feature = mondrian_feature
        self.mondrian_bucket_edges = list(mondrian_bucket_edges)
        self.mapie_buckets_: dict[int, Any] = (
            {}
        )  # bucket_id -> fitted SplitConformalRegressor

    # ------------------------------------------------------------------
    # Fitting
    # ------------------------------------------------------------------
    def fit(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_cal: pd.DataFrame,
        y_cal: pd.Series,
    ) -> "CalibratedETAEngine":
        """
        Fit MAPIE calibration layer on top of pre-trained base_model.

        Parameters
        ----------
        X_train, y_train : training set (used to build SHAP explainer baseline)
        X_cal, y_cal     : calibration set (used by MAPIE for conformity scores)
                           Must be LATER in time than X_train (chronological split).
        """
        if self.base_model is None:
            raise ValueError("base_model must be set before calling fit().")
        if not MAPIE_AVAILABLE:
            raise ImportError("MAPIE not installed. Run: pip install mapie")

        X_cal_f = X_cal[self.features]

        # ----- Compute anomaly threshold from calibration residuals ------
        cal_preds = self.base_model.predict(X_cal_f)
        cal_resids = np.abs(y_cal.values - cal_preds)
        # Delay rate = absolute residual as a fraction of predicted delay
        # Use p90 of absolute residuals as baseline; gate fires at 3× that.
        self.delay_p90_rate_ = float(np.percentile(cal_resids, 90))
        self.anomaly_gate_.fit(cal_resids)
        logger.info(
            f"Anomaly gate threshold: {self.delay_p90_rate_:.1f} min "
            f"(p90 abs residual on calibration set)"
        )

        # ----- Fit MAPIE (90% coverage) ----------------------------------
        self.mapie_90_ = SplitConformalRegressor(
            estimator=self.base_model,
            confidence_level=COVERAGE_90,
            prefit=True,
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.mapie_90_.conformalize(X_cal_f, y_cal.values)

        # ----- Mondrian (conditional) calibration, optional --------------
        if self.use_mondrian:
            self._fit_mondrian_buckets(X_cal, y_cal)

        # ----- SHAP explainer --------------------------------------------
        if SHAP_AVAILABLE:
            try:
                self.explainer_ = shap.TreeExplainer(self.base_model)
            except Exception as e:
                logger.warning(f"SHAP explainer init failed: {e}")
                self.explainer_ = None
        else:
            self.explainer_ = None

        self.fitted_ = True
        logger.info("CalibratedETAEngine fitted successfully.")
        return self

    # ------------------------------------------------------------------
    # Mondrian (conditional) calibration
    # ------------------------------------------------------------------
    def _fit_mondrian_buckets(
        self,
        X_cal: pd.DataFrame,
        y_cal: pd.Series,
        min_bucket_size: int = MONDRIAN_MIN_BUCKET_SIZE,
    ) -> None:
        """Fit one SplitConformalRegressor per delay-magnitude bucket.

        Buckets with fewer than ``min_bucket_size`` calibration rows are
        skipped; ``predict()`` falls back to the pooled ``mapie_90_``
        calibrator for those rows rather than fitting an unreliable
        few-sample conformal calibrator.
        """
        bucket_ids = X_cal[self.mondrian_feature].apply(
            lambda v: mondrian_bucket(v, self.mondrian_bucket_edges)
        )
        self.mapie_buckets_ = {}
        for bucket_id in sorted(bucket_ids.unique()):
            mask = (bucket_ids == bucket_id).values
            n = int(mask.sum())
            if n < min_bucket_size:
                logger.warning(
                    "Mondrian bucket %d has only %d calibration rows (< %d); "
                    "falling back to the pooled calibrator for this bucket.",
                    bucket_id,
                    n,
                    min_bucket_size,
                )
                continue
            X_bucket_f = X_cal.loc[mask, self.features]
            y_bucket = y_cal.loc[mask]
            mapie_bucket = SplitConformalRegressor(
                estimator=self.base_model,
                confidence_level=COVERAGE_90,
                prefit=True,
            )
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                mapie_bucket.conformalize(X_bucket_f, y_bucket.values)
            self.mapie_buckets_[bucket_id] = mapie_bucket
        logger.info(
            "Mondrian calibration fitted for buckets %s of %s on '%s' "
            "(edges=%s); remaining buckets use the pooled calibrator.",
            sorted(self.mapie_buckets_.keys()),
            sorted(bucket_ids.unique().tolist()),
            self.mondrian_feature,
            self.mondrian_bucket_edges,
        )

    # ------------------------------------------------------------------
    # Prediction
    # ------------------------------------------------------------------
    def predict(
        self,
        X: pd.DataFrame,
        network_adjusted_delay: Optional[float] = None,
        current_delay_rate: Optional[float] = None,
        current_prediction_variance: Optional[float] = None,
    ) -> list[dict]:
        """
        Generate calibrated ETA predictions for one or more train observations.

        Parameters
        ----------
        X : pd.DataFrame
            Feature matrix (must contain self.features columns).
        network_adjusted_delay : float, optional
            The delay estimate from C3 (timed event graph). If provided, this
            overrides the base model's point estimate for p50. The conformal
            interval width is still derived from the calibrated model.
        current_delay_rate : float, optional
            Current absolute delay in minutes (for anomaly gate check).

        Returns
        -------
        list of dict, one per row, each containing:
            - p10_delay_min  : lower conformal interval bound (legacy field name)
            - p50_delay_min  : point estimate (legacy field name)
            - p90_delay_min  : upper conformal interval bound (legacy field name)
            - anomaly_flag   : bool — True if anomaly gate fired
            - uncertainty_mode : bool — True if anomaly gate fired (suppress point est)
            - shap_explanation : dict of top feature importances
            - shap_text       : plain-language explanation string
        """
        if not self.fitted_:
            raise RuntimeError("Call fit() before predict().")

        X_f = X[self.features]

        # ----- MAPIE intervals -------------------------------------------
        if (
            self.use_mondrian
            and self.mapie_buckets_
            and self.mondrian_feature in X.columns
        ):
            # Route each row to its bucket-specific calibrator (falling back
            # to the pooled one for buckets that had too few calibration
            # rows), so interval width reflects delay-magnitude-conditional
            # coverage rather than one marginal average.
            bucket_ids = (
                X[self.mondrian_feature]
                .apply(lambda v: mondrian_bucket(v, self.mondrian_bucket_edges))
                .values
            )
            y_pred_90 = np.empty(len(X_f))
            lower_90 = np.empty(len(X_f))
            upper_90 = np.empty(len(X_f))
            for bucket_id in np.unique(bucket_ids):
                idx = np.where(bucket_ids == bucket_id)[0]
                calibrator = self.mapie_buckets_.get(int(bucket_id), self.mapie_90_)
                y_pred_b, y_pis_b = calibrator.predict_interval(X_f.iloc[idx])
                if y_pis_b.ndim == 3:
                    y_pis_b = y_pis_b[:, :, 0]
                y_pred_90[idx] = y_pred_b
                lower_90[idx] = y_pis_b[:, 0]
                upper_90[idx] = y_pis_b[:, 1]
        else:
            # SplitConformalRegressor returns point predictions and bounds.
            y_pred_90, y_pis_90 = self.mapie_90_.predict_interval(X_f)
            # y_pis_90 shape: (n_samples, 2) → lower=[:,0], upper=[:,1]
            if y_pis_90.ndim == 3:
                y_pis_90 = y_pis_90[:, :, 0]
            lower_90 = y_pis_90[:, 0]
            upper_90 = y_pis_90[:, 1]

        results = []
        for i in range(len(X_f)):
            p50: float | None = float(y_pred_90[i])
            p10 = float(lower_90[i])
            p90 = float(upper_90[i])

            # Override p50 with network-adjusted delay from C3 if provided
            if network_adjusted_delay is not None:
                # Shift the interval to be centred on the network estimate
                # while preserving the calibrated half-width
                half_width = (p90 - p10) / 2.0
                p50 = float(network_adjusted_delay)
                p10 = p50 - half_width
                p90 = p50 + half_width

            # Clamp to non-negative (trains can't arrive before scheduled)
            p10 = max(0.0, p10)

            # ----- Anomaly gate ------------------------------------------
            anomaly_flag = False
            uncertainty_mode = False
            if current_prediction_variance is not None:
                gate_result = self.anomaly_gate_.evaluate_variance(
                    current_prediction_variance
                )
                anomaly_flag = bool(gate_result["suspended"])
            elif current_delay_rate is not None and self.delay_p90_rate_ is not None:
                anomaly_flag = (
                    current_delay_rate > self.anomaly_multiplier * self.delay_p90_rate_
                )
            if anomaly_flag:
                anomaly_flag = True
                uncertainty_mode = True
                assert p50 is not None
                interval_width = p90 - p10
                # In uncertainty mode: widen interval significantly, suppress p50
                p10 = max(0.0, p50 - 3 * interval_width)
                p90 = p50 + 3 * interval_width
                p50 = None  # suppressed — do not display point estimate

            # ----- SHAP explanation --------------------------------------
            shap_explanation: dict[str, float] = {}
            shap_text = "Explanation unavailable."
            if self.explainer_ is not None and not anomaly_flag:
                try:
                    shap_vals = self.explainer_.shap_values(X_f.iloc[[i]])
                    # shap_vals shape: (1, n_features)
                    sv_dict = dict(zip(self.features, shap_vals[0]))
                    total_abs = sum(abs(v) for v in sv_dict.values()) or 1.0
                    shap_explanation = {
                        k: round(abs(v) / total_abs * 100, 1)
                        for k, v in sorted(sv_dict.items(), key=lambda x: -abs(x[1]))
                    }
                    # Plain-language text (top 2 drivers)
                    top2 = list(shap_explanation.items())[:2]
                    shap_text = "; ".join(
                        f"{pct:.0f}% {_readable_feature(feat)}" for feat, pct in top2
                    )
                except Exception as e:
                    logger.debug(f"SHAP computation failed for row {i}: {e}")

            results.append(
                {
                    "p10_delay_min": round(p10, 1),
                    "p50_delay_min": round(p50, 1) if p50 is not None else None,
                    "p90_delay_min": round(p90, 1),
                    "anomaly_flag": anomaly_flag,
                    "uncertainty_mode": uncertainty_mode,
                    "status": (
                        "PREDICTION SUSPENDED — anomalous conditions"
                        if anomaly_flag
                        else "PREDICTION ACTIVE"
                    ),
                    "shap_explanation": shap_explanation,
                    "shap_text": shap_text,
                }
            )

        return results

    # ------------------------------------------------------------------
    # Save / Load
    # ------------------------------------------------------------------
    def save(self, path: str | Path) -> None:
        """Persist the fitted calibration engine to disk."""
        joblib.dump(self, path)
        logger.info(f"CalibratedETAEngine saved to {path}")

    @classmethod
    def load(cls, path: str | Path) -> "CalibratedETAEngine":
        """Load a previously saved calibration engine."""
        engine = joblib.load(path)
        logger.info(f"CalibratedETAEngine loaded from {path}")
        return engine


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
def _readable_feature(name: str) -> str:
    """Map technical feature name to plain-language label for SHAP text."""
    mapping = {
        "prior_leg_delay": "rake delay",
        "schedule_buffer_hours": "schedule buffer",
        "zone_congestion_index": "zone congestion",
        "fog_risk": "fog risk",
        "monsoon_flag": "monsoon conditions",
        "distance_km": "journey distance",
        "scheduled_travel_hours": "scheduled travel time",
        "coach_count": "train length",
        "loco_age_years": "locomotive age",
        "day_of_week": "day of week",
        "month": "time of year",
        "is_weekend": "weekend travel",
    }
    return mapping.get(name, name.replace("_", " "))


# ---------------------------------------------------------------------------
# Standalone training utility
# ---------------------------------------------------------------------------
def train_and_calibrate(
    df: pd.DataFrame,
    features: list[str] = DEFAULT_FEATURES,
    target: str = "actual_delay_minutes",
    save_path: Optional[str | Path] = None,
    model_config: Optional[dict] = None,
) -> tuple[CalibratedETAEngine, dict]:
    """
    Chronological calibration split → XGBoost base → MAPIE conformal intervals.

    Parameters
    ----------
    df :
        Full feature-engineered DataFrame (already validated).
    features :
        Feature columns to use; defaults to DEFAULT_FEATURES.
    target :
        Target column name.
    save_path :
        If given, save the engine here.  A dated, git-stamped filename is
        also saved alongside it for reproducibility.
    model_config :
        Optional dict read from config.yaml ``model`` and ``calibration``
        sections.  Recognised keys:
          - ``train_fraction``    (default 0.70)
          - ``cal_fraction``     (default 0.85, cumulative)
          - ``coverage_target``  (default 0.90)
          - ``anomaly_multiplier`` (default ANOMALY_MULTIPLIER)
          - Any XGBoost hyperparameter accepted by build_model().

    Returns
    -------
    (engine, metrics) where metrics includes coverage on the held-out test set.
    """
    from src.models.xgboost_model import build_model
    from src.reproducibility import git_commit
    import datetime as _dt

    cfg = model_config or {}
    train_frac = float(cfg.get("train_fraction", 0.70))
    cal_frac = float(cfg.get("cal_fraction", 0.85))
    coverage_target = float(cfg.get("coverage_target", COVERAGE_90))
    anomaly_mult = float(cfg.get("anomaly_multiplier", ANOMALY_MULTIPLIER))
    use_mondrian = bool(cfg.get("use_mondrian", False))

    # --- Sort chronologically, apply fractional split --------------------
    df_sorted = df.sort_values("journey_date").reset_index(drop=True)
    n = len(df_sorted)
    train_end = int(n * train_frac)
    cal_end = int(n * cal_frac)

    df_train = df_sorted.iloc[:train_end]
    df_cal = df_sorted.iloc[train_end:cal_end]
    df_test = df_sorted.iloc[cal_end:]

    logger.info(
        "Split (fractions %.0f/%.0f/%.0f): train=%d, cal=%d, test=%d",
        train_frac * 100,
        (cal_frac - train_frac) * 100,
        (1 - cal_frac) * 100,
        len(df_train),
        len(df_cal),
        len(df_test),
    )

    # Fit only on the chronological training slice. A final all-data artifact
    # must never be reused here because it can already contain cal/test rows.
    base_model = build_model(cfg)
    base_model.fit(df_train[features], df_train[target])
    logger.info("Fitted base XGBoost on chronological training split only.")

    # --- Fit calibration engine ------------------------------------------
    X_train = df_train[features]
    y_train = df_train[target]
    X_cal = df_cal[features]
    y_cal = df_cal[target]
    X_test = df_test[features]
    y_test = df_test[target]

    engine = CalibratedETAEngine(
        base_model=base_model,
        features=features,
        anomaly_multiplier=anomaly_mult,
        use_mondrian=use_mondrian,
    )
    engine.fit(X_train, y_train, X_cal, y_cal)

    # --- Evaluate coverage on held-out test set --------------------------
    preds = engine.predict(X_test)
    p10s = np.array([r["p10_delay_min"] for r in preds])
    p90s = np.array([r["p90_delay_min"] for r in preds])
    y_arr = y_test.values

    coverage_90 = float(np.mean((y_arr >= p10s) & (y_arr <= p90s)))
    p50s = np.array(
        [r["p50_delay_min"] for r in preds if r["p50_delay_min"] is not None]
    )
    mae_p50 = float(np.mean(np.abs(y_arr[: len(p50s)] - p50s)))
    avg_width = float(np.mean(p90s - p10s))

    metrics: dict[str, Any] = {
        "coverage_90_pct": round(coverage_90 * 100, 1),
        "mae_p50_min": round(mae_p50, 2),
        "avg_interval_width_min": round(avg_width, 1),
        "n_train": len(df_train),
        "n_cal": len(df_cal),
        "n_test": len(df_test),
    }

    if use_mondrian:
        metrics["mondrian_bucket_coverage"] = per_bucket_coverage(
            X_test, y_arr, preds, engine.mondrian_feature, engine.mondrian_bucket_edges
        )

    logger.info(
        "Calibration complete — coverage: %s%% (target: %.0f%%), "
        "MAE p50: %s min, avg width: %s min",
        metrics["coverage_90_pct"],
        coverage_target * 100,
        metrics["mae_p50_min"],
        metrics["avg_interval_width_min"],
    )

    # --- Save engine with versioned filename (model versioning) ----------
    commit = git_commit()
    timestamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    versioned_name = f"calibrated_eta_engine_{timestamp}_{commit}.joblib"

    if save_path:
        save_path = Path(save_path)
        engine.save(save_path)  # canonical path (for API)
        versioned_path = save_path.parent / versioned_name
        engine.save(versioned_path)  # dated+commit tagged copy
        logger.info("Versioned artifact: %s", versioned_path)
        metrics["artifact_path"] = str(versioned_path)
    else:
        metrics["artifact_path"] = "not_saved"
    metrics["git_commit"] = commit
    metrics["trained_at"] = timestamp

    # --- MLflow Tracking (Tier 3) ---------------------------------------
    try:
        from src.models.xgboost_model import setup_mlflow_run
        import mlflow

        setup_mlflow_run()

        with mlflow.start_run(run_name=f"run_{timestamp}"):
            mlflow.log_params(
                {
                    "n_train": metrics["n_train"],
                    "n_cal": metrics["n_cal"],
                    "n_test": metrics["n_test"],
                    "coverage_target": coverage_target,
                    "anomaly_multiplier": anomaly_mult,
                    "git_commit": commit,
                }
            )
            mlflow.log_params(
                {
                    k: v
                    for k, v in cfg.items()
                    if k
                    in {"n_estimators", "max_depth", "learning_rate", "random_state"}
                }
            )
            mlflow.log_metrics(
                {
                    "coverage_90_pct": metrics["coverage_90_pct"],
                    "mae_p50_min": metrics["mae_p50_min"],
                    "avg_interval_width": metrics["avg_interval_width_min"],
                }
            )
            if save_path:
                mlflow.log_artifact(str(save_path), artifact_path="model")
    except Exception as exc:
        logger.warning("Could not log to MLflow: %s", exc)

    return engine, metrics


# ---------------------------------------------------------------------------
# Quick smoke test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import logging

    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s"
    )

    processed_path = Path("data/processed/kaggle_competition_cleaned.parquet")
    if not processed_path.exists():
        print("ERROR: data/processed/kaggle_competition_cleaned.parquet not found.")
        print("Run src/ingestion/load_kaggle.py first.")
        raise SystemExit(1)

    from src.features.engineering import engineer_all_features

    df = pd.read_parquet(processed_path)
    df = engineer_all_features(df)
    df = df.dropna(subset=DEFAULT_FEATURES + ["actual_delay_minutes"])

    print(f"Dataset: {len(df)} rows")
    engine, metrics = train_and_calibrate(
        df,
        save_path=Path("models/calibrated_eta_engine.joblib"),
    )

    print("\n=== Calibration Metrics ===")
    for k, v in metrics.items():
        print(f"  {k}: {v}")

    # Sample prediction
    sample = df[DEFAULT_FEATURES].iloc[:3]
    results = engine.predict(sample)
    print("\n=== Sample Predictions ===")
    for i, r in enumerate(results):
        print(
            f"  Row {i}: p10={r['p10_delay_min']:.1f}  "
            f"p50={r['p50_delay_min']}  "
            f"p90={r['p90_delay_min']:.1f}  "
            f"anomaly={r['anomaly_flag']}"
        )
        print(f"         SHAP: {r['shap_text']}")
