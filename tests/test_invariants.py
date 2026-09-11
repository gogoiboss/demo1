from hypothesis import given, strategies as st

from src.graph.timed_event_graph import build_timed_event_graph, inject_delays, propagate_delays


@st.composite
def delay_values(draw):
    return draw(st.floats(min_value=0, max_value=500, allow_nan=False, allow_infinity=False))


@given(delay=delay_values())
def test_arrival_never_precedes_previous_actual_time(delay):
    graph = build_timed_event_graph([{
        "train_id": "PROPERTY",
        "stops": [
            {"station": "A", "arr_min": None, "dep_min": 10},
            {"station": "B", "arr_min": 70, "dep_min": None},
        ],
    }])
    inject_delays(graph, {"PROPERTY__A__dep": delay})
    propagate_delays(graph)

    previous = graph.nodes["PROPERTY__A__dep"]["event"].actual_min
    arrival = graph.nodes["PROPERTY__B__arr"]["event"].actual_min
    assert arrival >= previous


@given(values=st.lists(st.floats(min_value=0, max_value=1440, allow_nan=False, allow_infinity=False), min_size=1, max_size=30))
def test_prediction_interval_ordering_invariant(values):
    for value in values:
        p10, p50, p90 = max(0.0, value - 10), value, value + 10
        assert p10 <= p50 <= p90


@given(delay=delay_values())
def test_predicted_delay_respects_physical_minimum_run_time(delay):
    graph = build_timed_event_graph([{
        "train_id": "PHYSICAL",
        "stops": [
            {"station": "A", "arr_min": None, "dep_min": 100},
            {"station": "B", "arr_min": 140, "dep_min": None},
        ],
    }])
    inject_delays(graph, {"PHYSICAL__A__dep": delay})
    propagate_delays(graph)

    arrival = graph.nodes["PHYSICAL__B__arr"]["event"].actual_min
    assert arrival >= 140