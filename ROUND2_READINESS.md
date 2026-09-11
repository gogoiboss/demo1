# RippleETA — Round 2 Readiness Checklist

> Regenerated after the file was found missing during a verification pass.
> Reflects actual confirmed status as of this session — not the original guess.
> Scores from HackHost AI rubric: 86.5/100. Round 1 cleared.

---

## Presentation / judging gaps — status

- [x] Hard vs soft conflict framing — implemented in `src/graph/timed_event_graph.py` docstring and edge typing
- [x] SHAP evidence surfaced through the API (`/predict/{train_id}`) — was computed, was silently dropped, now wired through with a test
- [ ] Live/Replay toggle in dashboard — NOT yet confirmed built; verify before claiming in demo
- [ ] Recorded RailRadar/NTES capture for offline demo — blocked, no dataset available in this environment
- [x] Scale claim scoped honestly (zone-scale ~500-800 trains, not national) — documented in `docs/ARCHITECTURE_AND_INTELLIGENCE.md` and `docs/LIMITATIONS.md`
- [x] Drift detection wording verified precise — no doc overstates ADWIN; real threshold-based mechanism correctly credited
- [ ] One full stakeholder dashboard verified end-to-end with live/replay data — needs manual verification with real data

## Engineering items — status (A-W)

### Data layer
- [x] A. Midnight rollover — `tests/test_midnight_crossing.py` exists; VERIFY it passes in this session
- [x] B. GPS dedup + watermark — `tests/test_dedup_watermark.py` exists; VERIFY it passes in this session
- [x] C. Ingest validation — `tests/test_schema_validation.py`, `tests/test_validation.py`, `src/validation.py` exist; VERIFY

### ML correctness
- [ ] D. Baseline table (4-model) — 4th model (per-train regression, no network features) added to `eval/baseline_comparison.py`, but NO REAL NUMBERS yet — blocked on missing dataset in this environment
- [x] E. Pinball loss + segmented eval — pinball loss confirmed implemented in `eval/baseline_comparison.py`; segmentation by delay bucket/horizon/zone NOT yet confirmed — verify or add
- [x] F. Mondrian conformal — IMPLEMENTED this session: stratified by delay bucket, per-bucket coverage reporting, synthetic test passing

### Training-serving correctness
- [x] G. Shared features module — `src/features/engineering.py` used by both training and serving paths; byte-identical test NOT yet confirmed — verify or add
- [ ] H. Point-in-time backfill correctness — NOT yet explicitly audited this session

### Performance
- [x] I. Static graph caching — CONFIRMED EXISTS: `CachedPropagationEngine` in `src/graph/timed_event_graph.py`
- [x] J. Vectorized topological traversal — CONFIRMED EXISTS: NumPy-vectorized pass in `CachedPropagationEngine`
- [x] K. Incremental propagation — CONFIRMED EXISTS: `CachedPropagationEngine` supports incremental updates; VERIFY with a direct test this session, not just code presence

### Automation
- [~] L. Offline seed — `Makefile` has `make seed` / `make demo` targets and `scripts/seed_db.py` exists; VERIFY it actually loads a real recorded capture, not just a stub
- [x] M. CI green check — WIDENED this session with pinned ruff + `pyproject.toml` rule selection, covering `src/graph/`, `src/calibration/`, `src/api/`, `src/features/`, `src/pipeline.py`
- [ ] N. Git history secret scan — NOT yet done, do it this session (see Task 4 below)

### Testing
- [x] O. Propagation boundary tests — CONFIRMED EXISTS: covered within `tests/test_graph.py` / `tests/test_graph_boundaries.py`; VERIFY passing
- [x] P. Property tests — CONFIRMED EXISTS: `tests/test_invariants.py`; VERIFY passing
- [x] Q. Golden scenarios — CONFIRMED EXISTS: `tests/test_golden_scenarios.py`; VERIFY passing
- [x] R. Backtest harness — CONFIRMED EXISTS: `eval/backtest_harness.py`, `tests/test_backtest_harness.py`; VERIFY passing

### Serving
- [ ] S. Graceful degradation — NOT yet confirmed implemented (persistence fallback when ML down, interval widening when feed stale) — do this session
- [~] T. Prediction audit log — PARTIALLY DONE: `src/pipeline.py` already logs `git_commit`, `dataset_sha256`, `saved_model_artifact_sha256`, `config_path` as provenance on every prediction result. Verify this is actually persisted somewhere queryable (not just returned in the response and discarded) — if not, add persistence this session.

### Government-readiness
- [x] U. Deployment topology — DOCUMENTED: `docs/ARCHITECTURE_AND_INTELLIGENCE.md` covers on-prem/NIC/MeghRaj, CRIS/RTIS integration path
- [ ] V. Low-bandwidth mode — NOT yet done, low priority, stretch goal this session

---

## What to do this session

See the numbered tasks in the accompanying prompt. Update the checkboxes above as you go — do not mark anything `[x]` without having actually run it and seen it pass.
