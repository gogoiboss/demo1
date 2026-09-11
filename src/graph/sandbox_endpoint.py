"""
Sandbox endpoint logic for delay propagation on the timed event graph.
"""
from src.graph.timed_event_graph import CachedPropagationEngine
from src.graph.worked_example import SCHEDULES_DEMO

def compute_sandbox_propagation(source_delay_min: float) -> dict:
    affected_base_delay = 55.0
    delays = {
        "56789__KANPUR__dep": source_delay_min,
        "12301__KANPUR__dep": affected_base_delay,
    }
    
    # Build graph and run conflict detection
    engine = CachedPropagationEngine(SCHEDULES_DEMO)
    conflicts = engine.detect_conflicts(delays)
    
    # Extract conflict addition
    conflict_addition = 0.0
    for c in conflicts:
        if c["affected_train"] == "12301" and c["delaying_train"] == "56789":
            conflict_addition = c["propagated_delay_min"]
            break
            
    # Calculate exact threshold
    # 56789 scheduled ALLD arr: 1564
    # 12301 scheduled ALLD arr: 1525
    # Headway: 10
    # Conflict fires when: 1564 + source_delay_min + 10 > 1525 + 55 => source_delay_min > 6
    threshold_delay_min = 6.0
    
    affected_total_delay_min = affected_base_delay + conflict_addition
    
    # Compute severity
    if conflict_addition == 0:
        severity = "none"
    elif conflict_addition < 5:
        severity = "low"
    elif conflict_addition <= 15:
        severity = "medium"
    else:
        severity = "high"
        
    explanation = (
        f"Train 56789 arr ALLAHABAD: 1564 + {source_delay_min:.1f} = {1564 + source_delay_min:.1f}. "
        f"Headway constraint: {1564 + source_delay_min:.1f} + 10 = {1574 + source_delay_min:.1f}. "
        f"Train 12301 unhindered arr ALLAHABAD: 1525 + {affected_base_delay:.1f} = {1525 + affected_base_delay:.1f}. "
        f"Actual arr: max({1525 + affected_base_delay:.1f}, {1574 + source_delay_min:.1f}) = {max(1580.0, 1574.0 + source_delay_min):.1f}."
    )

    return {
        "source_train": "56789",
        "source_delay_min": source_delay_min,
        "affected_train": "12301",
        "affected_base_delay_min": affected_base_delay,
        "conflict_addition_min": conflict_addition,
        "affected_total_delay_min": affected_total_delay_min,
        "conflict_active": conflict_addition > 0,
        "threshold_delay_min": threshold_delay_min,
        "propagation_explanation": explanation,
        "section": "KANPUR -> ALLAHABAD",
        "severity": severity,
    }
