from src.graph.timed_event_graph import build_timed_event_graph, detect_conflicts


def test_golden_late_rake_hard_link():
    graph = build_timed_event_graph([
        {"train_id": "INBOUND", "stops": [{"station": "YARD", "arr_min": 100, "dep_min": None}]},
        {"train_id": "OUTBOUND", "stops": [{"station": "YARD", "arr_min": None, "dep_min": 120}]},
    ], hard_links=[{"source_train_id": "INBOUND", "target_train_id": "OUTBOUND", "station": "YARD", "min_turnaround_min": 60}])

    conflicts = detect_conflicts(graph, {"INBOUND__YARD__arr": 30})

    assert conflicts[0]["conflict_type"] == "hard"
    assert conflicts[0]["affected_train"] == "OUTBOUND"
    assert conflicts[0]["propagated_delay_min"] == 70


def test_golden_headway_conflict_matches_worked_example():
    from src.graph.worked_example import SCHEDULES_DEMO, DELAYS_DEMO

    graph = build_timed_event_graph(SCHEDULES_DEMO, min_headway=10)
    conflicts = detect_conflicts(graph, DELAYS_DEMO)

    affected = next(item for item in conflicts if item["affected_train"] == "12301")
    assert affected["propagated_delay_min"] == 9
    assert affected["conflict_type"] == "soft"


def test_golden_cancelled_train_is_not_in_active_schedule():
    active_schedules = [{
        "train_id": "ACTIVE",
        "stops": [
            {"station": "A", "arr_min": None, "dep_min": 0},
            {"station": "B", "arr_min": 60, "dep_min": None},
        ],
    }]
    cancelled_train = {"train_id": "CANCELLED", "status": "cancelled", "stops": []}

    graph = build_timed_event_graph(active_schedules)

    assert cancelled_train["status"] == "cancelled"
    assert not any(node.startswith("CANCELLED__") for node in graph.nodes)
    assert graph.nodes["ACTIVE__B__arr"]["event"].scheduled_min == 60