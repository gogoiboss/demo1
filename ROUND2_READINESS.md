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
- [x] A. Midnight rollover — VERIFIED: `pytest tests/test_midnight_crossing.py -v` → 1 passed
- [x] B. GPS dedup + watermark — VERIFIED: `pytest tests/test_dedup_watermark.py -v` → 1 passed
- [x] C. Ingest validation — VERIFIED: `pytest tests/test_schema_validation.py tests/test_validation.py -v` → 3 passed

### ML correctness
- [ ] D. Baseline table (4-model) — 4th model (per-train regression, no network features) added to `eval/baseline_comparison.py`, but NO REAL NUMBERS yet — blocked on missing dataset in this environment
- [x] E. Pinball loss + segmented eval — DONE THIS SESSION: added `segment_metrics()` to `eval/baseline_comparison.py`, segmenting all 4 models by delay magnitude (0-15/15-60/60+ min), forecast horizon (<4/4-12/>12 hrs), and route (documented zone proxy — the public dataset has no true IR-zone identifier). 4 synthetic tests in `tests/test_segmented_evaluation.py` prove the segmentation logic itself is correct (per-segment row counts, MAE, pinball loss); real per-segment numbers still blocked on the missing dataset in this environment
- [x] F. Mondrian conformal — IMPLEMENTED this session: stratified by delay bucket, per-bucket coverage reporting, synthetic test passing

### Training-serving correctness
- [x] G. Shared features module — VERIFIED THIS SESSION with real tests, plus one genuine latent risk found and mitigated. `engineer_all_features()` is the single shared implementation (no duplicated feature logic anywhere — confirmed by grep). The actual exercised serving path (`RippleETAPipeline.run()` slicing an already-batch-engineered row) is proven byte-identical to the training path (`tests/test_features.py::test_training_and_serving_paths_agree_when_serving_uses_preengineered_batch_row`). However, `CalibratedPredictionPipeline.predict()`'s fallback re-engineering branch would silently produce a wrong `prior_leg_delay` (defaults to 0) if ever called with an isolated single row with no per-train history — confirmed empirically and pinned by a regression test; not reachable by any current caller, but added a runtime warning log and a `docs/LIMITATIONS.md` entry so it can't regress silently
- [ ] H. Point-in-time backfill correctness — NOT yet explicitly audited this session

### Performance
- [x] I. Static graph caching — VERIFIED: `CachedPropagationEngine` in `src/graph/timed_event_graph.py`; exercised by `eval/bench_propagation.py` at 50/200/500-train scale, numerical equivalence PASS at all three
- [x] J. Vectorized topological traversal — VERIFIED: same benchmark run confirms the NumPy-vectorized pass matches the reference NetworkX implementation exactly at all three scales
- [x] K. Incremental propagation — FIXED THIS SESSION (was broken, not just unverified): `propagate_incremental()` derived its recompute boundary from `changed_nodes` alone, which is unsafe — a two-independent-train reproduction showed it silently returning 0.0 for a delay's own downstream cascade when an unrelated node sorted later in topo order. Fixed to derive the boundary from the full `delays` set instead (always safe — see commit `07bb3ea`). New regression test `test_incremental_propagation_matches_full_pass_when_changed_node_sorts_later` in `tests/test_graph_boundaries.py` fails against the pre-fix code and passes against the fix. Not used in the live serving path (only `eval/bench_propagation.py`'s benchmark), so no prediction was ever affected — but the benchmark's own "incremental" timing number was previously computed from a function that silently gave wrong answers whenever it was actually exercising the intended single-train-update case.

### Automation
- [~] L. Offline seed — `Makefile` has `make seed` / `make demo` targets and `scripts/seed_db.py` exists; VERIFY it actually loads a real recorded capture, not just a stub
- [x] M. CI green check — WIDENED this session with pinned ruff + `pyproject.toml` rule selection, covering `src/graph/`, `src/calibration/`, `src/api/`, `src/features/`, `src/pipeline.py`
- [x] N. Git history secret scan — DONE THIS SESSION. Scanned `git log -p --all` for key/secret/password/token/bearer patterns and specifically `.env`/`*railradar*`/`*config*` file history. Result: no real third-party credential was ever committed — RailRadar/NTES API key references in history are all clearly-labeled placeholders (`rr_live_YOUR_API_KEY`, `your-ministry-key`) or correctly sourced from environment variables; only `.env.example` (never a real `.env`) was ever tracked. **One real, currently-live weakness found and fixed**: `src/api/auth.py` had a hardcoded fallback JWT signing secret (`'super-secret-rippleeta-key'`) committed to git and used whenever the `JWT_SECRET` env var was unset — anyone with repo access could read it and forge valid session tokens. Fixed to generate a fresh random secret per process start instead when unset (sessions just don't survive a restart, which is safe); `.env.example` now documents setting a real `JWT_SECRET` for production. This was an internal secret with no external provider to rotate — the fix itself is the mitigation.

### Testing
- [x] O. Propagation boundary tests — VERIFIED: `pytest tests/test_graph.py tests/test_graph_boundaries.py -v` → 12 passed (8 + 4, including the new incremental-propagation regression test)
- [x] P. Property tests — VERIFIED: `pytest tests/test_invariants.py -v` → 3 passed
- [x] Q. Golden scenarios — VERIFIED: `pytest tests/test_golden_scenarios.py -v` → 3 passed
- [~] R. Backtest harness — `eval/backtest_harness.py` and `tests/test_backtest_harness.py` exist and are wired correctly, but the test SKIPS in this environment ("checked-in historical artifact is optional locally") because `data/` does not exist here — genuinely blocked on the missing dataset, not failing. Cannot mark `[x]` without having seen it actually pass.

### Serving
- [ ] S. Graceful degradation — NOT yet confirmed implemented (persistence fallback when ML down, interval widening when feed stale) — do this session
- [~] T. Prediction audit log — PARTIALLY DONE: `src/pipeline.py` already logs `git_commit`, `dataset_sha256`, `saved_model_artifact_sha256`, `config_path` as provenance on every prediction result. Verify this is actually persisted somewhere queryable (not just returned in the response and discarded) — if not, add persistence this session.

### Government-readiness
- [x] U. Deployment topology — DOCUMENTED: `docs/ARCHITECTURE_AND_INTELLIGENCE.md` covers on-prem/NIC/MeghRaj, CRIS/RTIS integration path
- [ ] V. Low-bandwidth mode — NOT yet done, low priority, stretch goal this session

---

## What to do this session

See the numbered tasks in the accompanying prompt. Update the checkboxes above as you go — do not mark anything `[x]` without having actually run it and seen it pass.
