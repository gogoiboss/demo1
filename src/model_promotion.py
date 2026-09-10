"""Fail-closed evaluation gate for future model retraining jobs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np


@dataclass(frozen=True)
class PromotionDecision:
    promote: bool
    reason: str
    current_pinball: float
    candidate_pinball: float
    current_coverage: float
    candidate_coverage: float


def _metrics(y_true: np.ndarray, predictions: Sequence[dict[str, Any]]) -> tuple[float, float]:
    quantiles = (("p10_delay_min", 0.1), ("p50_delay_min", 0.5), ("p90_delay_min", 0.9))
    losses = []
    for field, alpha in quantiles:
        values = np.asarray([row[field] for row in predictions], dtype=float)
        errors = y_true - values
        losses.append(float(np.mean(np.maximum(alpha * errors, (alpha - 1) * errors))))
    lower = np.asarray([row["p10_delay_min"] for row in predictions], dtype=float)
    upper = np.asarray([row["p90_delay_min"] for row in predictions], dtype=float)
    coverage = float(np.mean((y_true >= lower) & (y_true <= upper)))
    return float(np.mean(losses)), coverage


def evaluate_promotion(
    y_true: Sequence[float],
    current_predictions: Sequence[dict[str, Any]],
    candidate_predictions: Sequence[dict[str, Any]],
    *,
    current_model: str = "current",
    candidate_model: str = "candidate",
) -> PromotionDecision:
    """Compare models on one frozen holdout; never performs deployment."""
    actual = np.asarray(y_true, dtype=float)
    current_pinball, current_coverage = _metrics(actual, current_predictions)
    candidate_pinball, candidate_coverage = _metrics(actual, candidate_predictions)
    promote = candidate_pinball <= current_pinball and candidate_coverage >= current_coverage
    reason = (
        f"{candidate_model} improves or matches pinball loss and coverage versus {current_model}"
        if promote
        else f"{candidate_model} regresses pinball loss or coverage versus {current_model}"
    )
    return PromotionDecision(
        promote=promote,
        reason=reason,
        current_pinball=current_pinball,
        candidate_pinball=candidate_pinball,
        current_coverage=current_coverage,
        candidate_coverage=candidate_coverage,
    )