"""Variance-based prediction suspension gate."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np


SUSPENSION_MESSAGE = "PREDICTION SUSPENDED — anomalous conditions"


@dataclass
class AnomalyGate:
    """Suspend predictions when current uncertainty exceeds a historical norm."""

    multiplier: float = 3.0
    min_history: int = 2
    baseline_variance_: float | None = None

    def fit(self, historical_uncertainty: Iterable[float]) -> "AnomalyGate":
        values = np.asarray(list(historical_uncertainty), dtype=float)
        values = values[np.isfinite(values)]
        if len(values) < self.min_history:
            raise ValueError(
                f"At least {self.min_history} historical uncertainty values are required."
            )
        self.baseline_variance_ = float(np.var(values, ddof=1))
        if self.baseline_variance_ <= 0:
            self.baseline_variance_ = float(np.finfo(float).eps)
        return self

    def evaluate(self, current_uncertainty: float) -> dict[str, object]:
        if self.baseline_variance_ is None:
            raise RuntimeError("Call fit() before evaluate().")
        current_variance = float(current_uncertainty) ** 2
        suspended = current_variance > self.multiplier * self.baseline_variance_
        return {
            "suspended": suspended,
            "status": SUSPENSION_MESSAGE if suspended else "PREDICTION ACTIVE",
            "current_variance": current_variance,
            "baseline_variance": self.baseline_variance_,
            "threshold_variance": self.multiplier * self.baseline_variance_,
        }

    def evaluate_variance(self, current_variance: float) -> dict[str, object]:
        """Evaluate a variance directly, useful when a model supplies one."""
        if self.baseline_variance_ is None:
            raise RuntimeError("Call fit() before evaluate_variance().")
        current_variance = float(current_variance)
        suspended = current_variance > self.multiplier * self.baseline_variance_
        return {
            "suspended": suspended,
            "status": SUSPENSION_MESSAGE if suspended else "PREDICTION ACTIVE",
            "current_variance": current_variance,
            "baseline_variance": self.baseline_variance_,
            "threshold_variance": self.multiplier * self.baseline_variance_,
        }


def rolling_variance(values: Iterable[float], window: int = 20) -> np.ndarray:
    """Return rolling sample variances for a historical uncertainty series."""
    series = np.asarray(list(values), dtype=float)
    if window < 2:
        raise ValueError("window must be at least 2")
    if len(series) < window:
        return np.array([], dtype=float)
    return np.array([
        np.var(series[index - window:index], ddof=1)
        for index in range(window, len(series) + 1)
    ])
