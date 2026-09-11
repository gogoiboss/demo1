"""
Benchmark: Timed Event Graph Propagation Performance
=====================================================

Generates a synthetic railway network of configurable size and times:
  (a) The original NetworkX-based propagate_delays()
  (b) CachedPropagationEngine.propagate() — full vectorized pass
  (c) CachedPropagationEngine.propagate_incremental() — single-train update

Reports wall-clock times so there's a real number to cite for
"zone-scale feasible" rather than an assumed one.

Usage:
    python eval/bench_propagation.py
"""

from __future__ import annotations

import sys
import time
import random
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.graph.timed_event_graph import (
    build_timed_event_graph,
    inject_delays,
    propagate_delays,
    _reset_propagation_state,
    CachedPropagationEngine,
)


def generate_synthetic_network(
    num_trains: int = 200,
    stops_per_train: int = 8,
    seed: int = 42,
) -> tuple[list[dict], dict[str, float]]:
    """
    Generate a synthetic schedule with ``num_trains`` trains, each having
    ``stops_per_train`` stops. Trains share stations to create conflict edges.

    Returns (schedules, sample_delays).
    """
    rng = random.Random(seed)

    # Create a pool of stations that trains will share
    num_stations = max(30, num_trains // 3)
    station_pool = [f"STN_{i:03d}" for i in range(num_stations)]

    schedules = []
    sample_delays: dict[str, float] = {}

    for t in range(num_trains):
        train_id = f"T{t:04d}"
        category = rng.choice(["rajdhani", "express", "superfast", "mail", "passenger"])

        # Pick a random contiguous route through the station pool
        start_idx = rng.randint(0, num_stations - stops_per_train)
        route_stations = station_pool[start_idx : start_idx + stops_per_train]

        # Generate scheduled times (monotonically increasing)
        base_time = rng.randint(0, 24 * 60)  # random start within a day
        stops = []
        current_time = base_time

        for i, stn in enumerate(route_stations):
            arr_min = None if i == 0 else current_time
            if i > 0:
                current_time += rng.randint(2, 5)  # dwell time
            dep_min = current_time if i < len(route_stations) - 1 else None
            stops.append({
                "station": stn,
                "arr_min": arr_min,
                "dep_min": dep_min,
            })
            current_time += rng.randint(20, 90)  # running time to next

        schedules.append({
            "train_id": train_id,
            "category": category,
            "stops": stops,
        })

        # Inject delay into ~30% of trains at their first departure
        if rng.random() < 0.3:
            first_dep_node = f"{train_id}__{route_stations[0]}__dep"
            sample_delays[first_dep_node] = float(rng.randint(10, 120))

    return schedules, sample_delays


def benchmark_reference(G, delays: dict[str, float], iterations: int = 5) -> float:
    """Time the original propagate_delays() over multiple iterations."""
    times = []
    for _ in range(iterations):
        _reset_propagation_state(G)
        inject_delays(G, delays)
        t0 = time.perf_counter()
        propagate_delays(G)
        t1 = time.perf_counter()
        times.append(t1 - t0)
    return min(times)


def benchmark_cached_full(engine: CachedPropagationEngine, delays: dict, iterations: int = 5) -> float:
    """Time the cached engine's full propagation pass."""
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        engine.propagate(delays)
        t1 = time.perf_counter()
        times.append(t1 - t0)
    return min(times)


def benchmark_cached_incremental(
    engine: CachedPropagationEngine,
    delays: dict,
    changed: set[str],
    iterations: int = 5,
) -> float:
    """Time the cached engine's incremental propagation."""
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        engine.propagate_incremental(delays, changed_nodes=changed)
        t1 = time.perf_counter()
        times.append(t1 - t0)
    return min(times)


def verify_numerical_equivalence(G, engine: CachedPropagationEngine, delays: dict) -> bool:
    """
    Confirm the cached engine produces numerically identical results
    to the reference implementation.
    """
    # Reference
    _reset_propagation_state(G)
    inject_delays(G, delays)
    ref_result = propagate_delays(G)

    # Cached full
    cached_result = engine.propagate(delays)

    # Cached incremental (with all delays as "changed")
    incremental_result = engine.propagate_incremental(delays, changed_nodes=set(delays.keys()))

    # Compare
    all_ok = True
    for nid in ref_result:
        ref_val = ref_result[nid]
        cached_val = cached_result.get(nid, float("nan"))
        incr_val = incremental_result.get(nid, float("nan"))

        if abs(ref_val - cached_val) > 1e-9:
            print(f"  MISMATCH (cached) at {nid}: ref={ref_val:.6f} cached={cached_val:.6f}")
            all_ok = False
        if abs(ref_val - incr_val) > 1e-9:
            print(f"  MISMATCH (incremental) at {nid}: ref={ref_val:.6f} incr={incr_val:.6f}")
            all_ok = False

    return all_ok


def main():
    print("=" * 72)
    print("  PROPAGATION ENGINE BENCHMARK")
    print("=" * 72)

    for num_trains in [50, 200, 500]:
        print(f"\n--- {num_trains} trains, 8 stops each ---")

        schedules, delays = generate_synthetic_network(num_trains=num_trains)

        # Build graph (reference path)
        t0 = time.perf_counter()
        G = build_timed_event_graph(schedules, min_headway=10.0)
        build_time = time.perf_counter() - t0

        num_nodes = G.number_of_nodes()
        num_edges = G.number_of_edges()
        conflict_edges = sum(1 for _, _, d in G.edges(data=True) if d.get("edge_type") == "conflict")

        print(f"  Graph: {num_nodes} nodes, {num_edges} edges ({conflict_edges} conflict)")
        print(f"  Delays injected: {len(delays)} trains")
        print(f"  Graph build time: {build_time*1000:.1f} ms")

        # Build cached engine
        t0 = time.perf_counter()
        engine = CachedPropagationEngine(schedules, min_headway=10.0)
        cache_time = time.perf_counter() - t0
        print(f"  Cache build time (one-time): {cache_time*1000:.1f} ms")

        # Verify numerical equivalence FIRST
        equiv_ok = verify_numerical_equivalence(G, engine, delays)
        print(f"  Numerical equivalence: {'PASS' if equiv_ok else 'FAIL'}")
        if not equiv_ok:
            print("  WARNING: Results diverge! Aborting benchmark for this size.")
            continue

        # Benchmark
        ref_time = benchmark_reference(G, delays)
        cached_time = benchmark_cached_full(engine, delays)

        # Pick one changed node for incremental test
        changed = set(list(delays.keys())[:1]) if delays else set()
        incr_time = benchmark_cached_incremental(engine, delays, changed)

        print(f"\n  Reference (NetworkX propagate_delays):  {ref_time*1000:.2f} ms")
        print(f"  Cached full (NumPy arrays):             {cached_time*1000:.2f} ms  ({ref_time/cached_time:.1f}x faster)")
        print(f"  Cached incremental (1 train changed):   {incr_time*1000:.2f} ms  ({ref_time/incr_time:.1f}x faster)")

        # Zone-scale feasibility check
        if cached_time < 0.050:  # 50ms
            print(f"  [PASS] Zone-scale feasible: {cached_time*1000:.1f} ms < 50 ms target")
        elif cached_time < 0.200:
            print(f"  [WARN] Marginal: {cached_time*1000:.1f} ms (consider rustworkx if this grows)")
        else:
            print(f"  [FAIL] TOO SLOW: {cached_time*1000:.1f} ms — NetworkX is the bottleneck.")
            print("    Recommendation: replace with rustworkx for topo sort + adjacency.")

    print("\n" + "=" * 72)
    print("  BENCHMARK COMPLETE")
    print("=" * 72)


if __name__ == "__main__":
    main()
