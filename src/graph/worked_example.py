"""
Worked Example: Train 12301 (Howrah Rajdhani) + Train 56789 (Conflicting Express)
==================================================================================

Reproduces the conflict scenario from our pitch materials (Slide 3), with an
honest note on what the graph actually computes vs what the PPT claimed.

KEY FINDING (run to see computed numbers):
    The PPT scenario as originally stated (12301 +55 min, 56789 +40 min,
    same section) does NOT produce a conflict in the max-plus propagation
    because 12301 is already so delayed that it naturally trails 56789 by
    more than the 10-min headway. The conflict only fires when 12301 is fast
    enough on a section to catch up to a slower preceding train.

    We demonstrate the correct scenario below and report the honest numbers.
    Pitch materials should be updated to match this scenario.

Graph theory: Goverde (2010), "A delay propagation algorithm for large-scale
railway traffic networks," Transportation Research Part C.
Propagation rule: actual_time = max(scheduled, max(upstream_actual + edge_weight))

Usage:
    python -m src.graph.worked_example
"""

from __future__ import annotations
from src.graph.timed_event_graph import (
    build_timed_event_graph,
    detect_conflicts,
)

# ---------------------------------------------------------------------------
# Scenario A — Original PPT numbers (12301 +55, 56789 +40)
# ---------------------------------------------------------------------------
# 12301 (Rajdhani): KANPUR dep 22:30, ALLAHABAD arr 01:25 (175 min section)
# 56789 (Express):  KANPUR dep 22:15, ALLAHABAD arr 00:46 (151 min section — faster!)
# Delays: 12301 = +55 min, 56789 = +40 min at Kanpur departure
#
# 56789 arr ALLD actual = 1486 + 40 = 1526 min = 01:26
# 12301 arr ALLD actual = 1525 + 55 = 1580 min = 02:20
# Headway constraint on 12301 = 1526 + 10 = 1536
# max(1580, 1536) = 1580 → NO CONFLICT. 12301's own delay dominates.
#
# Conclusion: The PPT's "+9 min conflict addition" cannot come from this input.
# ---------------------------------------------------------------------------

SCHEDULES_PPT = [
    {
        "train_id": "12301",
        "category": "rajdhani",
        "stops": [
            {"station": "NDLS",      "arr_min": None,       "dep_min": 16*60+55},   # 16:55
            {"station": "KANPUR",    "arr_min": 22*60+25,   "dep_min": 22*60+30},   # 22:25/22:30
            {"station": "ALLAHABAD", "arr_min": 25*60+25,   "dep_min": 25*60+30},   # 01:25/01:30
            {"station": "MUGHAL",    "arr_min": 28*60+10,   "dep_min": 28*60+15},   # 04:10/04:15
            {"station": "HWH",       "arr_min": 34*60+0,    "dep_min": None},       # 10:00
        ],
    },
    {
        "train_id": "56789",
        "category": "express",
        "stops": [
            {"station": "KANPUR",    "arr_min": None,       "dep_min": 22*60+15},   # 22:15 (15 min earlier)
            {"station": "ALLAHABAD", "arr_min": 24*60+46,   "dep_min": 24*60+56},   # 00:46/00:56
            {"station": "VARANASI",  "arr_min": 27*60+30,   "dep_min": None},
        ],
    },
]

DELAYS_PPT = {
    "12301__KANPUR__dep": 55.0,  # +55 min
    "56789__KANPUR__dep": 40.0,  # +40 min
}

# ---------------------------------------------------------------------------
# Scenario B — Correctly activated conflict demo
# ---------------------------------------------------------------------------
# For conflict to fire, 12301 must catch up to 56789 on the section.
# We use a scenario where 56789 is a very slow freight/express that departs
# just 5 min before 12301 but takes 45 min longer on the section.
#
# 56789: KANPUR dep 22:25, ALLD arr 02:10 (225 min, slow train)
# 12301: KANPUR dep 22:30, ALLD arr 01:25 (175 min, faster Rajdhani)
# Without delays: 12301 arr ALLD = 01:25, 56789 arr ALLD = 02:10. Scheduled gap = 45 min.
# No structural conflict on schedule.
#
# With delays: 12301 +55, 56789 +15 min:
#   12301 arr ALLD actual = 1525 + 55 = 1580 = 02:20
#   56789 arr ALLD actual = 2*60+10 + 60 + 15 = 25*60+10 + 15 = 1510 + 15 = 1525 + 10 = ???
#
# Let me work backwards for a clean +9 min conflict:
# We want: 56789 arr ALLD actual + 10 = 12301 arr ALLD (no-conflict) + 9
# → 56789 arr ALLD actual = 1525 + 9 - 10 + 55 = 1579 (one minute before 12301 would arrive)
# → 56789 arr ALLD scheduled = 1579 - 15 (delay) = 1564 = 02:04
#
# Verify: 56789 +15 delay → arr ALLD actual = 1564+15 = 1579
#   12301 no-conflict arr ALLD actual = 1525+55 = 1580
#   Constraint = 1579+10 = 1589
#   12301 actual = max(1580, 1589) = 1589 → delay = 1589-1525 = 64 min
#   Conflict addition = 1589 - 1580 = +9 min  ✓
# ---------------------------------------------------------------------------

SCHEDULES_DEMO = [
    {
        "train_id": "12301",
        "category": "rajdhani",
        "stops": [
            {"station": "NDLS",      "arr_min": None,       "dep_min": 16*60+55},   # 16:55
            {"station": "KANPUR",    "arr_min": 22*60+25,   "dep_min": 22*60+30},   # 22:25/22:30
            {"station": "ALLAHABAD", "arr_min": 25*60+25,   "dep_min": 25*60+30},   # 01:25/01:30
            {"station": "MUGHAL",    "arr_min": 28*60+10,   "dep_min": 28*60+15},   # 04:10/04:15
            {"station": "HWH",       "arr_min": 34*60+0,    "dep_min": None},       # 10:00
        ],
    },
    {
        # Slow express, departs 5 min before 12301 but arrives 39 min later (scheduled).
        # With only +15 min delay vs 12301's +55, it gets in the way.
        "train_id": "56789",
        "category": "express",
        "stops": [
            {"station": "KANPUR",    "arr_min": None,       "dep_min": 22*60+25},   # 22:25 (same as 12301 arr)
            {"station": "ALLAHABAD", "arr_min": 26*60+4,    "dep_min": 26*60+14},   # 02:04/02:14 (slow)
            {"station": "VARANASI",  "arr_min": 28*60+30,   "dep_min": None},
        ],
    },
]

DELAYS_DEMO = {
    "12301__KANPUR__dep": 55.0,  # 12301 is +55 min at Kanpur (PPT scenario)
    "56789__KANPUR__dep": 15.0,  # 56789 only +15 min — slow train, less delayed
}

PPT_CLAIMED_CONFLICT_ADDITION = 9.0
PPT_CLAIMED_FINAL_DELAY       = 57.0


def run_worked_example(verbose: bool = True) -> dict:
    """
    Run both scenarios and report the honest numbers with PPT comparison.
    """
    # --- Scenario A: PPT's exact inputs ---
    G_ppt = build_timed_event_graph(SCHEDULES_PPT, min_headway=10.0)
    conflicts_ppt = detect_conflicts(G_ppt, DELAYS_PPT)
    alld_ppt = G_ppt.nodes["12301__ALLAHABAD__arr"]["event"].delay_min
    hwh_ppt  = G_ppt.nodes["12301__HWH__arr"]["event"].delay_min
    conflict_ppt = next((c["propagated_delay_min"] for c in conflicts_ppt
                         if c["affected_train"] == "12301"), 0.0)

    # --- Scenario B: Corrected demo with real conflict ---
    G_demo = build_timed_event_graph(SCHEDULES_DEMO, min_headway=10.0)
    conflicts_demo = detect_conflicts(G_demo, DELAYS_DEMO)
    alld_demo = G_demo.nodes["12301__ALLAHABAD__arr"]["event"].delay_min
    hwh_demo  = G_demo.nodes["12301__HWH__arr"]["event"].delay_min
    conflict_demo = next((c["propagated_delay_min"] for c in conflicts_demo
                          if c["affected_train"] == "12301"), 0.0)

    if verbose:
        print("\n" + "="*64)
        print("  WORKED EXAMPLE — Timed Event Graph Conflict Propagation")
        print("="*64)

        print("\n  [SCENARIO A] — PPT's exact inputs (Train 12301 +55, 56789 +40)")
        print(f"    12301 delay at Allahabad:    +{alld_ppt:.1f} min")
        print(f"    12301 final delay at HWH:    +{hwh_ppt:.1f} min")
        print(f"    Conflict contribution:        +{conflict_ppt:.1f} min")
        print(f"    --> No conflict fires because 12301's own +55 min delay")
        print(f"        already places it well behind 56789 (+40 min).")
        print(f"        The headway constraint is satisfied without extra delay.")

        print("\n  [SCENARIO B] — Corrected demo (12301 +55, 56789 +15, slow express)")
        print(f"    12301 delay at Allahabad:    +{alld_demo:.1f} min")
        print(f"    12301 final delay at HWH:    +{hwh_demo:.1f} min")
        print(f"    Conflict contribution:        +{conflict_demo:.1f} min")

        print("\n  PPT claims vs Scenario B (corrected demo):")
        print(f"    PPT says conflict adds:   +{PPT_CLAIMED_CONFLICT_ADDITION:.0f} min")
        print(f"    Code computes:            +{conflict_demo:.1f} min")
        print(f"    PPT says final delay:     +{PPT_CLAIMED_FINAL_DELAY:.0f} min")
        print(f"    Code computes (Alld):     +{alld_demo:.1f} min")

        conflict_match = abs(conflict_demo - PPT_CLAIMED_CONFLICT_ADDITION) <= 1.0
        if conflict_match:
            print("\n  OK — Scenario B matches PPT conflict addition (+9 min). GOOD.")
            print("     Update pitch to use Scenario B inputs.")
        else:
            print(f"\n  MISMATCH — Update pitch materials with Scenario B numbers:")
            print(f"     Conflict addition: {conflict_demo:.1f} min (not {PPT_CLAIMED_CONFLICT_ADDITION:.0f})")
            print(f"     Final delay at Allahabad: +{alld_demo:.1f} min")
            print(f"     Pitch should say: base +55 -> conflict adds +{conflict_demo:.1f} -> total +{alld_demo:.1f}")

        if conflicts_demo:
            print(f"\n  Active conflicts in Scenario B:")
            for c in conflicts_demo:
                print(f"    Train {c['delaying_train']} (+{c['source_delay_min']:.0f} min) "
                      f"--> Train {c['affected_train']}: +{c['propagated_delay_min']:.1f} min added")
        print()

    return {
        "scenario_a": {
            "conflict_min": conflict_ppt,
            "alld_delay_min": alld_ppt,
            "hwh_delay_min": hwh_ppt,
        },
        "scenario_b": {
            "conflict_min": conflict_demo,
            "alld_delay_min": alld_demo,
            "hwh_delay_min": hwh_demo,
        },
        "ppt_claimed_conflict_min": PPT_CLAIMED_CONFLICT_ADDITION,
        "ppt_claimed_final_delay_min": PPT_CLAIMED_FINAL_DELAY,
    }


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING)
    run_worked_example(verbose=True)
