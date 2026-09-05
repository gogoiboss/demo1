"""
Timed Event Graph — Conflict Detection and Delay Propagation
=============================================================

Mathematical foundation: Goverde (2010), "A delay propagation algorithm for
large-scale railway traffic networks," Transportation Research Part C.

Core idea (max-plus algebra):
  actual_time = max(scheduled, max(upstream_actual + edge_weight))

This single rule, applied in topological order (sorted by scheduled time),
converges in ONE forward pass — no simulation loop required.
That single-pass property is both the theoretical claim and the efficiency
claim in our pitch materials (Slide 3, Pillar 2).

Two edge types:
  1. Running-time edges  — within a single train's journey, consecutive events.
                           Edge weight = minimum technically-possible running time
                           between two consecutive stations for that train.
  2. Conflict edges      — between two different trains that share the same
                           station-pair section. Edge weight = minimum headway
                           required between the two trains on that section.

IMPORTANT data caveat (documented in research/data_sources_brief.md, §4):
  Section-level block-section occupancy data does NOT exist publicly.
  We approximate conflict edges at the station-pair level, using the scheduled
  timetable to infer which trains share the same consecutive station pair.
  This approximation is stated explicitly in our pitch materials (S2, S3)
  and documented here to ensure code matches pitch claims.

Train precedence (Goverde, IRFCA FAQ III):
  When two trains share a section, the higher-precedence train's departure
  becomes the "source" of the conflict edge, delaying the lower-precedence
  train. Precedence is configurable — not hardcoded — because real IR
  dispatchers override it based on HOER, commuter loads, and local judgment.

  Default rank (higher number = higher priority):
    Vande Bharat: 7, Rajdhani: 6, Duronto/Shatabdi: 5, Superfast: 4,
    Mail/Express: 3, Ordinary Passenger: 2, Goods: 1
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Optional

import networkx as nx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default precedence ranks (configurable, not hardcoded — see docstring above)
# ---------------------------------------------------------------------------
DEFAULT_PRECEDENCE_RANK: dict[str, int] = {
    "vande_bharat": 7,
    "rajdhani":     6,
    "shatabdi":     5,
    "duronto":      5,
    "superfast":    4,
    "mail":         3,
    "express":      3,
    "passenger":    2,
    "goods":        1,
}

# Minimum headway in minutes between two trains on the same station-pair section.
# This is an approximation — actual headways depend on block lengths and MPS,
# which are not publicly available at section level (see docstring).
DEFAULT_MIN_HEADWAY_MINUTES = 10


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class TrainEvent:
    """
    A single node in the timed event graph.

    Represents a train arriving at or departing from a station.
    Node ID convention: f"{train_id}__{station}__arr" or f"...__dep"
    """
    train_id:       str
    station:        str
    event_type:     str          # "arr" | "dep"
    scheduled_min:  float        # minutes from midnight (or from journey start)
    actual_min:     float = field(default=None)   # filled during propagation
    delay_min:      float = field(default=0.0)    # current observed/propagated delay
    category:       str  = field(default="express")

    @property
    def node_id(self) -> str:
        return f"{self.train_id}__{self.station}__{self.event_type}"

    def precedence(self, rank_table: dict[str, int] | None = None) -> int:
        rt = rank_table or DEFAULT_PRECEDENCE_RANK
        return rt.get(self.category.lower(), 3)


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------
def build_timed_event_graph(
    schedules: list[dict],
    min_headway: float = DEFAULT_MIN_HEADWAY_MINUTES,
    precedence_rank: dict[str, int] | None = None,
) -> nx.DiGraph:
    """
    Build the timed event graph from a list of train schedules.

    Parameters
    ----------
    schedules : list of dict, each with keys:
        - train_id: str
        - category: str  (e.g. "rajdhani", "express")
        - stops: list of dict, each with:
            - station: str
            - arr_min: float   (arrival, minutes from midnight; None for origin)
            - dep_min: float   (departure; None for terminus)
    min_headway : float
        Minimum headway in minutes between two trains on the same section.
        Approximated at station-pair level (see module docstring).
    precedence_rank : dict, optional
        Override default precedence ranks.

    Returns
    -------
    G : nx.DiGraph
        Nodes carry TrainEvent objects (node attribute "event").
        Edges carry weight = minimum time (minutes) that must elapse
        between source event and target event.
    """
    G = nx.DiGraph()
    rank = precedence_rank or DEFAULT_PRECEDENCE_RANK

    # ----- Step 1: Add all nodes (one per train × station × event_type) -----
    events_by_id: dict[str, TrainEvent] = {}

    for sched in schedules:
        tid = sched["train_id"]
        cat = sched.get("category", "express")
        stops = sched["stops"]

        for stop in stops:
            stn = stop["station"]

            if stop.get("arr_min") is not None:
                ev = TrainEvent(
                    train_id=tid, station=stn, event_type="arr",
                    scheduled_min=stop["arr_min"],
                    actual_min=stop["arr_min"],   # will be updated during propagation
                    delay_min=0.0, category=cat,
                )
                G.add_node(ev.node_id, event=ev)
                events_by_id[ev.node_id] = ev

            if stop.get("dep_min") is not None:
                ev = TrainEvent(
                    train_id=tid, station=stn, event_type="dep",
                    scheduled_min=stop["dep_min"],
                    actual_min=stop["dep_min"],
                    delay_min=0.0, category=cat,
                )
                G.add_node(ev.node_id, event=ev)
                events_by_id[ev.node_id] = ev

    # ----- Step 2: Add running-time edges (within each train) ---------------
    # Running-time edge: dep@A → arr@B for consecutive stations of same train.
    # Edge weight = minimum running time = scheduled_arr_B - scheduled_dep_A.
    # (We use scheduled times as the minimum technically-possible time; actual
    #  minimum would require MPS data not available publicly.)

    for sched in schedules:
        tid = sched["train_id"]
        stops = sched["stops"]

        for i, stop in enumerate(stops):
            stn = stop["station"]

            # dep → arr at SAME station (dwell time edge)
            arr_id = f"{tid}__{stn}__arr"
            dep_id = f"{tid}__{stn}__dep"
            if arr_id in events_by_id and dep_id in events_by_id:
                arr_ev = events_by_id[arr_id]
                dep_ev = events_by_id[dep_id]
                dwell = dep_ev.scheduled_min - arr_ev.scheduled_min
                G.add_edge(arr_id, dep_id,
                           edge_type="dwell",
                           weight=max(0.0, dwell),
                           label=f"dwell@{stn}")

            # dep@current → arr@next (running time edge)
            if i < len(stops) - 1:
                next_stop = stops[i + 1]
                next_stn = next_stop["station"]
                dep_id = f"{tid}__{stn}__dep"
                next_arr_id = f"{tid}__{next_stn}__arr"

                if dep_id in events_by_id and next_arr_id in events_by_id:
                    dep_ev = events_by_id[dep_id]
                    next_arr_ev = events_by_id[next_arr_id]
                    run_time = next_arr_ev.scheduled_min - dep_ev.scheduled_min
                    G.add_edge(dep_id, next_arr_id,
                               edge_type="running_time",
                               weight=max(0.0, run_time),
                               label=f"run:{stn}→{next_stn}")

    # ----- Step 3: Add conflict edges (cross-train, shared station-pair) ----
    # APPROXIMATION: we identify two trains as sharing a section if they both
    # call at the same consecutive station-pair A→B (or B→A, since single-line).
    # This is the station-pair approximation disclosed in our pitch materials.

    # Build a dict: (stn_A, stn_B, sorted) → list of (dep_event, arr_event, train)
    section_users: dict[tuple, list] = {}

    for sched in schedules:
        tid = sched["train_id"]
        stops = sched["stops"]
        for i in range(len(stops) - 1):
            stn_a = stops[i]["station"]
            stn_b = stops[i + 1]["station"]
            key = tuple(sorted([stn_a, stn_b]))  # direction-agnostic

            dep_id = f"{tid}__{stn_a}__dep"
            arr_id = f"{tid}__{stn_b}__arr"

            if dep_id in events_by_id and arr_id in events_by_id:
                dep_ev = events_by_id[dep_id]
                arr_ev = events_by_id[arr_id]
                section_users.setdefault(key, []).append({
                    "train_id": tid,
                    "category": sched.get("category", "express"),
                    "dep_ev": dep_ev,
                    "arr_ev": arr_ev,
                })

    for section_key, users in section_users.items():
        if len(users) < 2:
            continue  # no conflict on this section

        # For each pair of trains on the same section, add a conflict edge
        # from the FIRST train's arrival at the section exit to the SECOND
        # train's arrival at the section exit, weight = min_headway.
        #
        # "First" = whichever train enters the section first by scheduled
        # departure time. When dep times are equal, higher precedence goes
        # first (this is the dispatcher's decision modeled as a tiebreaker).
        #
        # This correctly models: the following train cannot arrive at the
        # section exit until the leading train has cleared it + headway.
        # Goverde (2010): "following_train_event ≥ preceding_train_event + headway"
        for i in range(len(users)):
            for j in range(i + 1, len(users)):
                u = users[i]
                v = users[j]

                u_dep_time = u["dep_ev"].scheduled_min
                v_dep_time = v["dep_ev"].scheduled_min

                # Determine which train enters the section first
                if u_dep_time < v_dep_time:
                    first, second = u, v
                elif v_dep_time < u_dep_time:
                    first, second = v, u
                else:
                    # Same scheduled dep time — higher precedence goes first
                    rank_u = rank.get(u["category"].lower(), 3)
                    rank_v = rank.get(v["category"].lower(), 3)
                    if rank_u >= rank_v:
                        first, second = u, v
                    else:
                        first, second = v, u

                # Edge: first train's arrival at exit → second train's arrival at exit
                # Weight = minimum headway between consecutive trains
                G.add_edge(
                    first["arr_ev"].node_id,
                    second["arr_ev"].node_id,
                    edge_type="conflict",
                    weight=min_headway,
                    label=f"conflict:{section_key[0]}-{section_key[1]}",
                )
                logger.debug(
                    f"Conflict edge: {first['train_id']} arr → {second['train_id']} arr "
                    f"on section {section_key}, headway={min_headway} min"
                )

    return G


# ---------------------------------------------------------------------------
# Delay injection
# ---------------------------------------------------------------------------
def inject_delays(G: nx.DiGraph, delays: dict[str, float]) -> None:
    """
    Inject observed delays into specific nodes before running propagation.

    For mid-journey nodes (those with predecessors), injected actual_min is
    stored as a 'pinned' constraint. propagate_delays() will treat it as a
    hard lower bound: actual = max(scheduled, pinned, upstream_predecessors).
    This correctly handles the case where we observe Train 12301 is +55 min
    at Kanpur departure — even though Kanpur dep has predecessors in the graph,
    the observed delay must dominate whatever the predecessor chain computes.

    Parameters
    ----------
    delays : dict mapping node_id → observed_delay_minutes
        Example: {"12301__KANPUR__dep": 55.0}
    """
    for node_id, delay in delays.items():
        if node_id not in G.nodes:
            logger.warning(f"Node {node_id!r} not found in graph; skipping.")
            continue
        ev: TrainEvent = G.nodes[node_id]["event"]
        ev.delay_min = delay
        ev.actual_min = ev.scheduled_min + delay
        # Mark as pinned so propagate_delays respects the observed value
        G.nodes[node_id]["pinned_actual_min"] = ev.actual_min
        logger.debug(f"Injected (pinned) delay {delay:.1f} min into {node_id}")


# ---------------------------------------------------------------------------
# Forward propagation — ONE PASS (this is the core of the max-plus algebra)
# ---------------------------------------------------------------------------
def propagate_delays(G: nx.DiGraph) -> dict[str, float]:
    """
    Run the single-pass forward propagation.

    Processes nodes in topological order (guaranteed acyclic if schedule is
    internally consistent). For each node applies:

        actual_time = max(scheduled_time, max(predecessor_actual + edge_weight))

    This IS max-plus algebra, written without the exotic notation.
    One traversal — no iteration or simulation loop — because topological
    ordering ensures every predecessor is processed before its successor.

    Returns
    -------
    result : dict mapping node_id → propagated delay (minutes)
    """
    # Topological sort requires DAG. Train schedules with well-ordered
    # scheduled times are a DAG by construction (time flows forward).
    try:
        topo_order = list(nx.topological_sort(G))
    except nx.NetworkXUnfeasible:
        raise ValueError(
            "Graph contains a cycle — schedule data is inconsistent. "
            "Check that all departure times precede arrival times."
        )

    result: dict[str, float] = {}

    for node_id in topo_order:
        ev: TrainEvent = G.nodes[node_id]["event"]
        node_data = G.nodes[node_id]

        # Start from either injected (pinned) actual_min or scheduled_min.
        # pinned_actual_min is set by inject_delays() to represent a live
        # observed delay — it acts as a hard lower bound regardless of whether
        # this node has predecessors (mid-journey observation).
        pinned = node_data.get("pinned_actual_min", None)
        if pinned is not None:
            predecessor_constraint = pinned
        elif G.in_degree(node_id) == 0:
            predecessor_constraint = ev.actual_min   # source node, already set
        else:
            predecessor_constraint = ev.scheduled_min  # will be pushed by preds

        for pred_id in G.predecessors(node_id):
            edge_data = G.edges[pred_id, node_id]
            pred_ev: TrainEvent = G.nodes[pred_id]["event"]
            constraint = pred_ev.actual_min + edge_data["weight"]
            if constraint > predecessor_constraint:
                predecessor_constraint = constraint
                logger.debug(
                    f"  {node_id}: constrained by {pred_id} "
                    f"(actual={pred_ev.actual_min:.1f} + weight={edge_data['weight']:.1f} "
                    f"= {constraint:.1f})"
                )

        # The max-plus propagation rule
        ev.actual_min = max(ev.scheduled_min, predecessor_constraint)
        ev.delay_min = ev.actual_min - ev.scheduled_min
        result[node_id] = ev.delay_min

    return result


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------
def _coerce_current_delays(current_delays) -> dict[str, float]:
    """Convert the supported delay inputs to the graph's node-id mapping."""
    if isinstance(current_delays, Mapping):
        return {str(node_id): float(delay) for node_id, delay in current_delays.items()}

    if not hasattr(current_delays, "to_dict") or not hasattr(current_delays, "columns"):
        raise TypeError(
            "current_delays must be a mapping or a DataFrame with delay_min and "
            "node_id columns (or train_id, station, and event_type columns)."
        )

    columns = set(current_delays.columns)
    if "delay_min" not in columns:
        raise ValueError("current_delays DataFrame must contain a 'delay_min' column.")

    delays = {}
    for row in current_delays.to_dict(orient="records"):
        if "node_id" in columns:
            node_id = row["node_id"]
        elif {"train_id", "station"}.issubset(columns):
            event_type = row.get("event_type", "dep")
            node_id = f"{row['train_id']}__{row['station']}__{event_type}"
        else:
            raise ValueError(
                "current_delays DataFrame must contain either 'node_id' or "
                "'train_id' and 'station' columns."
            )
        delays[str(node_id)] = float(row["delay_min"])
    return delays


def _reset_propagation_state(G: nx.DiGraph) -> None:
    """Clear results from an earlier propagation before a fresh traversal."""
    for node_data in G.nodes.values():
        event: TrainEvent = node_data["event"]
        event.actual_min = event.scheduled_min
        event.delay_min = 0.0
        node_data.pop("pinned_actual_min", None)


def detect_conflicts(
    G: nx.DiGraph,
    current_delays,
) -> list[dict]:
    """
    Given current train delays, identify activated conflict edges and compute
    the propagated delay to the affected train.

    ``current_delays`` may be a node-id mapping for backwards compatibility,
    or a DataFrame containing ``delay_min`` plus either ``node_id`` or
    ``train_id``, ``station``, and optional ``event_type`` (default ``dep``).
    """
    delays = _coerce_current_delays(current_delays)

    # 1. Run propagation without conflict edges to establish baseline
    G_no_conflict = copy.deepcopy(G)
    conflict_edges = [
        (u, v) for u, v, d in G_no_conflict.edges(data=True)
        if d.get("edge_type") == "conflict"
    ]
    G_no_conflict.remove_edges_from(conflict_edges)

    _reset_propagation_state(G_no_conflict)
    _reset_propagation_state(G)
    inject_delays(G_no_conflict, delays)
    baseline_delays = propagate_delays(G_no_conflict)

    # 2. Run propagation with conflict edges
    inject_delays(G, delays)
    actual_delays = propagate_delays(G)

    conflicts = []
    for u, v, data in G.edges(data=True):
        if data.get("edge_type") != "conflict":
            continue

        u_ev: TrainEvent = G.nodes[u]["event"]
        v_ev: TrainEvent = G.nodes[v]["event"]

        baseline_v_actual = v_ev.scheduled_min + baseline_delays[v]
        actual_u_actual = u_ev.scheduled_min + actual_delays[u]
        conflict_constraint = actual_u_actual + data["weight"]

        if conflict_constraint > baseline_v_actual:
            edge_contribution = conflict_constraint - baseline_v_actual
            conflicts.append({
                "section":               data.get("label", ""),
                "delaying_train":        u_ev.train_id,
                "affected_train":        v_ev.train_id,
                "source_delay_min":      u_ev.delay_min,
                "propagated_delay_min":  edge_contribution,
                "affected_node":         v,
                "source_node":           u,
            })

    return conflicts
