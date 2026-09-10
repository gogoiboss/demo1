from src.model_promotion import evaluate_promotion


def _predictions(p10, p50, p90):
    return [
        {"p10_delay_min": p10, "p50_delay_min": p50, "p90_delay_min": p90},
        {"p10_delay_min": p10, "p50_delay_min": p50, "p90_delay_min": p90},
    ]


def test_promotion_gate_rejects_coverage_regression():
    current = _predictions(0, 5, 10)
    candidate = _predictions(4, 5, 6)

    decision = evaluate_promotion([5, 50], current, candidate)

    assert not decision.promote
    assert "regresses" in decision.reason


def test_promotion_gate_can_pass_without_deploying():
    current = _predictions(0, 10, 30)
    candidate = _predictions(0, 5, 30)

    decision = evaluate_promotion([5, 25], current, candidate)

    assert decision.promote