import pytest

from src.graph.timed_event_graph import build_timed_event_graph, inject_delays, propagate_delays


def _section_graph():
    return build_timed_event_graph([{
        "train_id": "T1",
        "stops": [
            {"station": "A", "arr_min": None, "dep_min": 0},
            {"station": "B", "arr_min": 60, "dep_min": None},
        ],
    }])


def test_zero_delay_respects_scheduled_arrival():
    graph = _section_graph()
    inject_delays(graph, {"T1__A__dep": 0})
    result = propagate_delays(graph)

    assert result["T1__B__arr"] == pytest.approx(0)
    assert graph.nodes["T1__B__arr"]["event"].actual_min == pytest.approx(60)


def test_binding_headway_constraint_wins_over_schedule():
    graph = build_timed_event_graph([
        {"train_id": "LEAD", "stops": [
            {"station": "A", "arr_min": None, "dep_min": 0},
            {"station": "B", "arr_min": 60, "dep_min": None},
        ]},
        {"train_id": "FOLLOW", "stops": [
            {"station": "A", "arr_min": None, "dep_min": 10},
            {"station": "B", "arr_min": 70, "dep_min": None},
        ]},
    ], min_headway=10)
    inject_delays(graph, {"LEAD__A__dep": 60})
    propagate_delays(graph)

    assert graph.nodes["FOLLOW__B__arr"]["event"].actual_min == pytest.approx(130)


def test_negative_or_exhausted_buffer_never_moves_arrival_before_physical_run_time():
    graph = _section_graph()
    inject_delays(graph, {"T1__A__dep": -20})
    propagate_delays(graph)

    event = graph.nodes["T1__B__arr"]["event"]
    assert event.actual_min >= 60
    assert event.delay_min >= 0