"""
Tests for the timed event graph: conflict detection and max-plus propagation.

Two core test cases:
1. No-conflict case   — delay stays isolated within one train's journey.
2. Conflict case      — delay propagates correctly via max-plus rule.
"""

import pytest
import pandas as pd
from src.graph.timed_event_graph import (
    build_timed_event_graph,
    inject_delays,
    propagate_delays,
    detect_conflicts,
)

# ---------------------------------------------------------------------------
# Shared test fixtures
# ---------------------------------------------------------------------------


def _two_train_schedules(same_section: bool) -> list[dict]:
    """
    Build a minimal two-train schedule.
    If same_section=True they share the A→B section (conflict possible).
    If same_section=False they use different sections (no conflict).
    """
    sched_a = {
        "train_id": "TRAIN_A",
        "category": "rajdhani",
        "stops": [
            {"station": "A", "arr_min": None, "dep_min": 0},
            {"station": "B", "arr_min": 60, "dep_min": 65},
            {"station": "C", "arr_min": 130, "dep_min": None},
        ],
    }
    if same_section:
        # TRAIN_B also uses A→B section, departing 10 min after TRAIN_A scheduled
        # so there's no structural conflict with a 10 min min_headway
        sched_b = {
            "train_id": "TRAIN_B",
            "category": "express",  # lower precedence than rajdhani
            "stops": [
                {"station": "A", "arr_min": None, "dep_min": 10},
                {"station": "B", "arr_min": 70, "dep_min": 75},
                {"station": "D", "arr_min": 140, "dep_min": None},
            ],
        }
    else:
        # TRAIN_B runs A→E→F — completely different section
        sched_b = {
            "train_id": "TRAIN_B",
            "category": "express",
            "stops": [
                {"station": "A", "arr_min": None, "dep_min": 10},
                {"station": "E", "arr_min": 70, "dep_min": 75},
                {"station": "F", "arr_min": 140, "dep_min": None},
            ],
        }
    return [sched_a, sched_b]


# ---------------------------------------------------------------------------
# Test 1: No-conflict case — delay stays isolated
# ---------------------------------------------------------------------------


class TestNoConflict:
    def test_delay_does_not_propagate_to_other_train(self):
        """When trains share no section, a delay in TRAIN_A must not affect TRAIN_B."""
        schedules = _two_train_schedules(same_section=False)
        G = build_timed_event_graph(schedules, min_headway=10.0)

        # TRAIN_A is 30 min late departing A
        inject_delays(G, {"TRAIN_A__A__dep": 30.0})
        propagate_delays(G)

        # TRAIN_A downstream should be delayed
        train_a_c = G.nodes["TRAIN_A__C__arr"]["event"]
        assert train_a_c.delay_min == pytest.approx(
            30.0
        ), "TRAIN_A final delay should equal injected delay with no recovery."

        # TRAIN_B should be completely unaffected
        train_b_f = G.nodes["TRAIN_B__F__arr"]["event"]
        assert train_b_f.delay_min == pytest.approx(
            0.0
        ), "TRAIN_B must not be affected when trains share no section."

    def test_no_conflict_edges_in_graph(self):
        """Graph with no shared sections should have zero conflict edges."""
        schedules = _two_train_schedules(same_section=False)
        G = build_timed_event_graph(schedules, min_headway=10.0)
        conflict_edges = [
            (u, v) for u, v, d in G.edges(data=True) if d.get("edge_type") == "conflict"
        ]
        assert (
            len(conflict_edges) == 0
        ), "No conflict edges expected when trains run on separate sections."


# ---------------------------------------------------------------------------
# Test 2: Conflict case — delay propagates via max-plus rule
# ---------------------------------------------------------------------------


class TestConflictPropagation:
    def test_conflict_edge_exists_on_shared_section(self):
        """When two trains share A→B, exactly one conflict edge should appear."""
        schedules = _two_train_schedules(same_section=True)
        G = build_timed_event_graph(schedules, min_headway=10.0)
        conflict_edges = [
            (u, v, d)
            for u, v, d in G.edges(data=True)
            if d.get("edge_type") == "conflict"
        ]
        assert (
            len(conflict_edges) >= 1
        ), "At least one conflict edge expected on shared section A→B."

    def test_max_plus_rule_applied_correctly(self):
        """
        Verify the propagation rule:
          actual_time = max(scheduled, max(upstream_actual + edge_weight))

        Setup:
          TRAIN_A departs A at t=0 scheduled but is 60 min late → dep actual = 60
          TRAIN_A arr@B scheduled = 60 → actual = 120 (60 min delay propagates)
          Conflict edge: TRAIN_A arr@B → TRAIN_B arr@B, weight = 10 min headway.
          TRAIN_B scheduled arr@B = 70.
          Constraint: TRAIN_B arr@B >= TRAIN_A arr@B actual + headway = 120 + 10 = 130
          So TRAIN_B arr@B actual = max(70, 130) = 130 → delay = 60 min.
        """
        schedules = _two_train_schedules(same_section=True)
        G = build_timed_event_graph(schedules, min_headway=10.0)

        # Inject 60-min delay to TRAIN_A at A: actual dep = 0 + 60 = 60
        inject_delays(G, {"TRAIN_A__A__dep": 60.0})
        propagate_delays(G)

        # TRAIN_B arr@B should be pushed by conflict:
        # TRAIN_A arr@B actual = 60 + 60 = 120, constraint = 120 + 10 = 130
        # TRAIN_B arr@B = max(70, 130) = 130, delay = 60
        b_arr_b = G.nodes["TRAIN_B__B__arr"]["event"]
        expected_delay = 130.0 - 70.0  # = 60.0
        assert b_arr_b.delay_min == pytest.approx(expected_delay, abs=0.1), (
            f"TRAIN_B arr@B delay should be {expected_delay:.1f} min by max-plus rule, "
            f"got {b_arr_b.delay_min:.1f}"
        )

    def test_first_scheduled_train_is_source_of_conflict_edge(self):
        """
        The train that enters the section first by scheduled departure time
        is the source of the conflict edge. TRAIN_A departs at t=0, TRAIN_B
        at t=10, so TRAIN_A goes first → its arrival constrains TRAIN_B.
        """
        schedules = _two_train_schedules(same_section=True)
        G = build_timed_event_graph(schedules, min_headway=10.0)
        conflict_edges = [
            (u, v, d)
            for u, v, d in G.edges(data=True)
            if d.get("edge_type") == "conflict"
        ]
        assert len(conflict_edges) >= 1
        source_node = conflict_edges[0][0]
        source_ev = G.nodes[source_node]["event"]
        assert source_ev.train_id == "TRAIN_A", (
            "TRAIN_A departs first (t=0 vs t=10), so TRAIN_A's arrival should be "
            "the source of the conflict edge."
        )

    def test_detect_conflicts_returns_nonempty_on_active_conflict(self):
        """detect_conflicts() should return at least one result when conflict is active."""
        schedules = _two_train_schedules(same_section=True)
        G = build_timed_event_graph(schedules, min_headway=10.0)
        # Both trains late enough to activate the conflict
        conflicts = detect_conflicts(
            G,
            {
                "TRAIN_A__A__dep": 60.0,
                "TRAIN_B__A__dep": 5.0,
            },
        )
        assert (
            len(conflicts) >= 1
        ), "Expected at least one conflict to be detected with both trains delayed."

    def test_detect_conflicts_returns_empty_without_delay(self):
        """If no trains are delayed, no conflicts should be activated."""
        schedules = _two_train_schedules(same_section=True)
        G = build_timed_event_graph(schedules, min_headway=10.0)
        conflicts = detect_conflicts(G, {})  # no delays injected
        assert (
            len(conflicts) == 0
        ), "No conflicts should be active when all trains are on schedule."

    def test_detect_conflicts_accepts_current_positions_dataframe(self):
        """Live train-position rows can be passed directly to the detector."""
        schedules = _two_train_schedules(same_section=True)
        G = build_timed_event_graph(schedules, min_headway=10.0)
        current_positions = pd.DataFrame(
            [
                {
                    "train_id": "TRAIN_A",
                    "station": "A",
                    "event_type": "dep",
                    "delay_min": 60.0,
                },
                {
                    "train_id": "TRAIN_B",
                    "station": "A",
                    "event_type": "dep",
                    "delay_min": 5.0,
                },
            ]
        )

        conflicts = detect_conflicts(G, current_positions)

        assert len(conflicts) >= 1
        assert conflicts[0]["affected_train"] == "TRAIN_B"

    def test_single_forward_pass_produces_same_result_as_manual(self):
        """
        End-to-end: manual computation should match propagate_delays() output.
        TRAIN_A dep@A actual=60, edge weight to B arr=60min → arr@B actual=120.
        Scheduled arr@B = 60 → delay=60.
        """
        schedules = [
            {
                "train_id": "ONLY_TRAIN",
                "category": "express",
                "stops": [
                    {"station": "X", "arr_min": None, "dep_min": 0},
                    {"station": "Y", "arr_min": 60, "dep_min": None},
                ],
            }
        ]
        G = build_timed_event_graph(schedules, min_headway=10.0)
        inject_delays(G, {"ONLY_TRAIN__X__dep": 25.0})
        result = propagate_delays(G)

        y_arr_delay = result.get("ONLY_TRAIN__Y__arr", 0.0)
        assert y_arr_delay == pytest.approx(
            25.0, abs=0.1
        ), "Single running-time edge: delay should propagate exactly through one edge."
