"""End-to-end calibrated prediction pipeline."""

from __future__ import annotations

from typing import Any

import pandas as pd

from src.features.engineering import engineer_all_features
from src.graph.timed_event_graph import detect_conflicts


class CalibratedPredictionPipeline:
    """Compose feature engineering, graph adjustment, MAPIE, and anomaly gating."""

    def __init__(self, engine, graph=None):
        self.engine = engine
        self.graph = graph

    def predict(
        self,
        current_state: pd.DataFrame,
        prediction_variance: float | None = None,
    ) -> list[dict[str, Any]]:
        state = current_state.copy()
        if not set(self.engine.features).issubset(state.columns):
            state = engineer_all_features(state)

        adjustments: dict[str, float] = {}
        if self.graph is not None:
            conflicts = detect_conflicts(self.graph, current_state)
            for conflict in conflicts:
                train_id = conflict["affected_train"]
                adjustments[train_id] = adjustments.get(train_id, 0.0) + float(
                    conflict["propagated_delay_min"]
                )

        results = self.engine.predict(
            state,
            current_delay_rate=None,
            current_prediction_variance=prediction_variance,
        )
        if not adjustments:
            return results

        for index, row in state.reset_index(drop=True).iterrows():
            train_id = str(row.get("train_id", ""))
            adjustment = adjustments.get(train_id, 0.0)
            if not adjustment:
                continue
            result = results[index]
            if result["p50_delay_min"] is not None:
                result["p50_delay_min"] = round(result["p50_delay_min"] + adjustment, 1)
                result["p10_delay_min"] = round(max(0.0, result["p10_delay_min"] + adjustment), 1)
                result["p90_delay_min"] = round(result["p90_delay_min"] + adjustment, 1)
            result["conflict_adjustment_min"] = round(adjustment, 1)
        return results
