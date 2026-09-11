import pytest

from src.graph.timed_event_graph import (
    CachedPropagationEngine,
    build_timed_event_graph,
    inject_delays,
    propagate_delays,
)


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


def test_incremental_propagation_matches_full_pass_when_changed_node_sorts_later():
    """Regression test for a real bug found during Round 2 verification.

    ``propagate_incremental()`` used to derive its recompute start position
    from ``changed_nodes`` alone. When an unrelated node happened to sort
    later in topological order than a still-active pinned delay's own
    downstream cascade, the forward pass skipped recomputing that cascade —
    silently returning 0.0 delay for nodes that a full ``propagate()`` pass
    correctly shows as delayed. Two independent trains (no shared section)
    reproduce it: delay only train A, but ask for an incremental update
    naming a train-B node that sorts after A's cascade in topo order.
    """
    schedules = [
        {"train_id": "A", "category": "express", "stops": [
            {"station": "S1", "arr_min": None, "dep_min": 0},
            {"station": "S2", "arr_min": 60, "dep_min": 65},
            {"station": "S3", "arr_min": 120, "dep_min": None},
        ]},
        {"train_id": "B", "category": "express", "stops": [
            {"station": "S4", "arr_min": None, "dep_min": 500},
            {"station": "S5", "arr_min": 560, "dep_min": None},
        ]},
    ]
    engine = CachedPropagationEngine(schedules, min_headway=10.0)
    delays = {"A__S1__dep": 50.0}

    full_result = engine.propagate(delays)
    assert full_result["A__S3__arr"] == pytest.approx(50.0)  # sanity: cascade is real

    # "B__S5__arr" deterministically sorts between A__S2__arr and
    # A__S2__dep/A__S3__arr in this schedule's topological order (Kahn's
    # algorithm round-robins between the two independent chains). Naming it
    # as the sole "changed" node exercises exactly the scenario that used to
    # silently drop the tail of A's cascade.
    incremental_result = engine.propagate_incremental(delays, changed_nodes={"B__S5__arr"})

    for node_id, expected in full_result.items():
        assert incremental_result[node_id] == pytest.approx(expected), (
            f"incremental mismatch at {node_id}: "
            f"full={expected} incremental={incremental_result[node_id]}"
        )