# RippleETA — Frontend-Backend Connection Map

_Generated as Part 4 of the merged codebase audit, 2026-09-11. This is the definitive, current source of truth for what's real in the project — it supersedes informal status claims made in `docs/FEATURE_STATUS.md`, `docs/PAGE_ARCHITECTURE.md`, `docs/LIMITATIONS.md`, and prior session notes in `PROGRESS.md`/`ROUND2_READINESS.md` wherever they conflict with what's documented here. Every row below was verified by reading the actual current code (`dashboard/app.js`, `dashboard/*.html`, `src/api/app.py`, `src/api/models.py`), not inherited from those docs._

Legend: **REAL** = genuinely computed, visibly reactive to the underlying prediction. **PARTIAL** = part real, part proxy/approximation — notes say which part. **HARDCODED** = static value or formula with no real data dependency. **BROKEN** = an actual defect (dead field, mismatched contract, or a claimed capability that doesn't run). **UNVERIFIED** = could not be determined from code alone; notes say what manual/browser check would resolve it.

---

## 0. Cross-reference: prior-session claims, verified against the code as it exists right now

These three questions were posed explicitly in the audit brief. Answered here with evidence, not inherited from any prior summary:

### Is `shap_explanation`/`shap_text` actually consumed and rendered anywhere in the frontend?

**No — returned by the API, never displayed.** Confirmed backend-side: `src/calibration/conformal.py`'s `predict()` computes real per-row SHAP attributions and returns `shap_explanation`/`shap_text` in its result dict; this flows through `src/pipeline.py` → `PredictionService.predict()` → `get_prediction()`'s dict → `PredictionResponse` via `**prediction` in `src/api/app.py`'s `predict()` handler — so `/predict/{train_id}` genuinely returns real SHAP data over the wire today. But `grep -i shap frontend/ dashboard/ eta/ --include=*.js` finds **zero** references to `shap_explanation` or `shap_text` anywhere in any frontend JS file. The only "SHAP" text that exists client-side is static citation copy in `dashboard/app.js`'s reference-panel translations and `dashboard/sandbox.html`'s "Lundberg & Lee (2017)" bibliography entry — methodology credit, not a rendering of any actual prediction's attribution data. `docs/PROGRESS.md` claims `docs/DEMO_SCRIPT.md` has a "Why does it predict that?" presenter section — that's true (it's presenter narration, meant to be spoken, not UI), but it does not mean the UI itself surfaces this data, and it doesn't.

### When a response comes back `degraded: true` or stale-widened, does the UI visibly render something different?

**Barely, and not in a way a user would understand.** Traced every page's handling of `prediction.status`/`prediction.degraded`/`prediction.stale_since`:

- `prediction.degraded` (the boolean field added specifically for this) is **never read anywhere in `dashboard/app.js`** — zero matches for `.degraded` across the entire file.
- `prediction.stale_since` is **never read anywhere in `dashboard/app.js`** either — zero matches.
- Every page's "is this suspended?" check is narrowly `prediction.anomaly_flag || prediction.status.includes('SUSPENDED')` — this correctly triggers the big, obvious red SUSPENDED treatment (banner, decision-card border, etc.) for the anomaly-gate case, but **does not fire** for `status === 'degraded_fallback'` or `status === 'stale_data_widened'`, so neither of those two states gets any of that visual treatment.
- The one partial exception: `prediction.status` (the raw string) is displayed verbatim, undecorated, in exactly two places — Passenger's small provenance line (`ticket-provenance`: "... · degraded_fallback") and Station Master's status badge (`sm-status-badge`). Both would show the literal string, but with no color/icon/explanation distinguishing it from a normal `PREDICTION ACTIVE` status — a user would need to know what "degraded_fallback" means to notice anything is wrong.
- **Crew Controller and Feeder Transport actively discard the information**: both pages fetch their endpoint's own `message` field (which server-side correctly carries the real reason — "ML unavailable. Using persistence baseline." etc., preserved end-to-end since the Part 1-verified message-overwrite-bug fix) and then **unconditionally overwrite it** with a client-side template string in every reachable branch before display (confirmed by the Part 4 fork tracing all branches). The real reason text is fetched over the wire and never shown.
- Maintenance, Control Room, and Sandbox: none of them read `status`/`degraded`/`stale_since` for anything beyond the same narrow anomaly-only check.
- **What DOES visibly change**: the p10/p90 interval numbers and bar width themselves — every page reads these directly, and a stale-widened response's genuinely wider interval would show up as a wider bar / larger spread number everywhere. So a careful user comparing bar widths over time could notice *something* changed — but nothing on any page tells them *why*, and a `degraded_fallback` response (which doesn't widen the interval, just substitutes a persistence-baseline estimate) would look completely indistinguishable from a normal confident prediction on 5 of 7 pages.

**Conclusion**: the backend-side fix (preserving the real message, computed in Part 1) is real and correct, but its value is almost entirely lost — the frontend doesn't consume the fields that would let a user see it.

### Does every stakeholder view's response shape match the real Pydantic models in `src/api/models.py`?

**Yes — no field-name, type, or nullability mismatch found on any of the 7 pages.** Checked `PassengerResponse`, `StationMasterResponse`, `CrewControllerResponse`, `FeederTransportResponse`, `MaintenanceResponse`, `GraphDemoResponse`, `SandboxResponse`, `SystemStatusResponse` against every field each page's JS actually reads. The one nullability quirk found (Maintenance's `maintenance_window_adequate !== false` treating `null` as truthy) never surfaces visibly because the suspended-anomaly branch is checked first in the same code. `CrewControllerResponse.predicted_delay_min` is fetched but never actually used by `loadCrew()` (the page uses the other endpoint's `p50_delay_min` instead) — an unused field, not a mismatch.

---

## 1. Passenger View

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Passenger | Docket ID | `dashboard/app.js loadPassenger()`, `prediction.train_id` | REAL | Wraps the real train_id from `/predict/{id}`. |
| Passenger | Train title / route | `TRAIN_NAMES[train_id]` local JS lookup (7 curated trains) | HARDCODED (curated) | Falls back to generic "Express Special" for any other train ID; no on-screen label either way. |
| Passenger | P50 window text | `prediction.p50_delay_min` | REAL | |
| Passenger | Provenance line | `prediction.provenance?.data_source`, `prediction.status` | REAL | `provenance` genuinely reflects `src/pipeline.py`'s git-commit/dataset/model SHA-256 state. |
| Passenger | Anomaly alert banner | `prediction.anomaly_flag` / `status.includes('SUSPENDED')` | REAL | |
| Passenger | P10/P50/P90 readouts + interval bar | `prediction.p10/p50/p90_delay_min` | REAL | Bar geometry genuinely computed from the real conformal interval. |
| Passenger | Trend badge | `passenger.trend` ← `get_trend()` in `src/api/app.py` | REAL, but usually uninformative | Genuinely SQLite-backed, not hardcoded — but returns "unknown" whenever `RIPPLEETA_CI=1` or there's no prior row for that train yet (i.e. usually, at demo start). |
| Passenger | Next update time | `passenger.next_update_at` | PARTIAL | Real field, but a fixed `now+30min` constant server-side, not a measured refresh cadence — not disclosed as such in the UI. |
| Passenger | Current observed delay/location, downstream delta | `passenger.historical_stations` | PARTIAL / UNVERIFIED | Real Pydantic-modeled field; whether it varies per train_id vs. reuses a shared fixture wasn't traced fully through `src/pipeline.py` this session — flagged rather than guessed. |
| Passenger | "Should I Leave Now?" calculator | Pure client-side arithmetic on `p90_delay_min` | REAL | |
| Passenger | Telemetry factor cards: congestion, signal, TSR, conflict | `prediction.downstream_congestion_score` / `signal_aspect_restriction` / `tsr_active` / `conflict_adjustment_min` | HARDCODED (3 of 4) | Congestion/signal/TSR are hardcoded off-values in `src/api/app.py predict()` (see Part 3 status comments). `conflict_adjustment_min` alone is REAL (flows from the real graph stage, usually an honest `0.0`). |
| Passenger | Historical stations timeline | `passenger.historical_stations` | PARTIAL | Same caveat as above; rendered via unescaped `innerHTML` (Part 2 XSS finding, not itself a status issue). |

## 2. Station Master View

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Station Master | Header/hero (title, route, location, target berth) | `TRAIN_NAMES` lookup | HARDCODED (curated) | Static per-train text for 7 curated IDs; a train's "location" never actually moves. |
| Station Master | Status badge, hero delay | `prediction.status`, `p50_delay_min` | REAL | |
| Station Master | Dominant decision card (COMMIT/DEFER/SUSPENDED) | `station.platform_commit` ← real ≤30min threshold in `station_master()` | REAL | Frontend mirrors the server decision here (contrast with the junction table below, which recomputes it). |
| Station Master | Decision deadline clock + countdown | `station.time_until_decision_needed_min` | REAL | `max(0, 90 - interval_width)`, computed server-side. |
| Station Master | VHF radio script | `station.radio_summary` | REAL | Server-generated, genuinely reflects real decision/delay values. |
| Station Master | P10/P50/P90 + interval bar | `prediction.p10/p50/p90_delay_min` | REAL | |
| Station Master | "Why this decision" factor telemetry | congestion/signal HARDCODED, spread/conflict REAL | HARDCODED + REAL (split) | Same split as Passenger's factor cards. |
| Station Master | Approach-scene SVG signal lamp + platform badges | Real COMMIT/DEFER/SUSPENDED state | REAL (state) / **Part 5 cross-reference** | The lamp *color values* passed to `setAttribute('fill', ...)` are hardcoded hex literals matching `docs/DESIGN_SYSTEM.md`'s LIGHT palette (`#3D7A5C`/`#E8A33D`/`#A13D2E`), while `dashboard/styles.css`'s actual dark-theme tokens for the same semantics are different hex values (`#22C55E`/`#F0A500`/`#E53E3E`). This SVG's signal colors will visibly clash with the rest of the page — a concrete on-page instance of the design-system conflict, not just an abstract two-docs disagreement. |
| Station Master | Ripple Score gauge | Backend `ripple_score: 0` (always) → frontend `\|\| 55` fallback | HARDCODED | Flat `55` for every train, every request, no disclaimer. |
| Station Master | Financial Impact | Backend `financial_impact_inr: 0` (always) → frontend `p50 * ₹1200/min` fallback | PARTIAL | Genuinely reactive to real delay; the ₹1200/min rate is an undisclosed constant. |
| Station Master | Multi-train junction table (5 hardcoded trains) | `/predict/{tid}` (not `/station-master`), COMMIT/DEFER recomputed client-side | PARTIAL / duplicated logic | Re-derives the same `≤30min` rule instead of reading the authoritative `platform_commit` field — currently correct by coincidence, a drift risk (Part 3). A failed per-train fetch silently drops that row, no error shown. |

## 3. Crew Controller View

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Crew | Hero delay | `prediction.p50_delay_min` | REAL | |
| Crew | HOER duty elapsed | Client formula `clamp(360,520, 430+p50*1.5)` | **HARDCODED (fabricated)** | No real crew sign-on/CMS data exists anywhere in the repo — this is an invented number with plausible-looking constants. |
| Crew | HOER directive badge (DISPATCH NOW / PREPARE RELIEF / NO RELIEF REQUIRED) | Derived from the fabricated duty-elapsed value above, **not** `crew.relief_dispatch_deadline` | **HARDCODED (fabricated)** | The page's single largest, most prominent element ignores the real backend deadline field entirely. |
| Crew | Directive explanation text | `crew.message`, always overwritten by a client template | BROKEN (dead field) | Real backend message fetched, never rendered — confirmed on every branch. |
| Crew | Relief dispatch deadline clock + countdown | `crew.relief_dispatch_deadline` | REAL | `now + max(15, 120 - p90)`, `src/api/app.py crew_controller()`. |
| Crew | P10/P50/P90 + interval bar | `prediction.p10/p50/p90_delay_min` | REAL | |
| Crew | "Will the Crew Make It?" risk pills | Fabricated `elapsedMinutes` | **HARDCODED (fabricated)** | Inherits the fake duty-elapsed number. |
| Crew | Sign-on/expiry clocks | `new Date()` + fabricated offset | HARDCODED (derived from fabricated input) | |
| Crew | Multi-train crew dispatch board (7 hardcoded trains) | Same fabricated HOER formula, duplicated per row | **HARDCODED (fabricated), duplicated logic** | A second independent instance of the fake-math pattern. Silent row-drop on fetch failure. |
| Crew | Action buttons (Prepare/Mobilize/Standby) | Client-only DOM toggle | HARDCODED (by design) | Cosmetic, no API call — not a bug. |

## 4. Feeder Transport View

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Feeder | Hero delay, P10/P50/P90, sigma | `prediction.*` | REAL | Sigma recomputed client-side, duplicates the backend's identical formula (consistent today, a drift risk). |
| Feeder | Probability hero | `feeder.probability_arrival_before_cutoff` | REAL | Backend: `NormalDist(p50,sigma).cdf(minutes_until_cutoff)` — real, normal-approximation. |
| Feeder | Recommendation badge | `feeder.recommendation` | REAL/PARTIAL | Real field/thresholds; UI's stated 80%/40% cutoffs match the backend exactly (implicit disclosure), though the word "approximation" appears only in docs, never the UI. |
| Feeder | Explanation text | `feeder.message`, always overwritten | BROKEN (dead field) | Same discard pattern as Crew. |
| Feeder | Transfer hub / connecting service | Hardcoded strings | HARDCODED | Identical for every train, no disclaimer. |
| Feeder | Buffer minutes | Client-computed `minutesUntilCutoff - p50` | REAL | |
| Feeder | Schematic SVG, CDF curve position | Derived from real `recommendation`/`probability` | REAL | Curve shape itself is a fixed decorative SVG path. |
| Feeder | Multi-train feeder board (7 hardcoded trains) | Real per-row `probability`/`recommendation` | REAL | Correctly reads real fields, unlike Crew's board. Same silent-row-drop-on-failure gap. |
| Feeder | Action buttons | Client-only toggle | HARDCODED (by design) | |

## 5. Maintenance Yard View

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Maintenance | Hero delay, P10/P50/P90, interval bar | `prediction.*` | REAL | Falls back to hardcoded demo values only if the fetch fails. |
| Maintenance | Turnaround window / measuring tape | `maintenance.available_turnaround_min` | REAL | Backend: `360.0 - p90_delay_min`. |
| Maintenance | 360-min budget / 90-min threshold labels | Static HTML | PARTIAL, honestly hardcoded | Matches backend's own constants; not configurable per rake/terminus (disclosed limitation). |
| Maintenance | Directive text/color, rubber stamp, status badge | Real `isCritical`/`isAdequate`/`isSuspended` | REAL | |
| Maintenance | Rake progression clocks | `now + p50`, `arrival + minutes` | REAL (derived) | |
| Maintenance | Stamp timestamp | `new Date()` at render | REAL (not live-ticking) | |
| Maintenance | Action buttons (Confirm/Sweep/Hold) | Client-only DOM rewrite | HARDCODED, client-only | No API call, nothing persisted. |
| Maintenance | Multi-train turnaround board (7 rows) | Hardcoded train list, real per-train data | REAL data / HARDCODED train list | Same hardcoded-junction-list pattern as Station Master; silent row-drop on failure. |

## 6. Control Room / Network View

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Control Room | Full network diagram (trains, section, delays, SVG, headway, calc boxes) | `/graph/demo`, called with **zero parameters** | **BROKEN relative to how the page presents itself** | 100% fixed to the Kanpur↔Allahabad/56789→12301 scenario regardless of the header's selected train ID. Replay nature disclosed once at the bottom, not near the diagram. |
| Control Room | "Network Ripple Score" gauge | Local JS: `isSuspended ? 0 : 55` | HARDCODED | Not read from any API field at all — even more direct than Station Master's version of the same flat-55 pattern. |
| Control Room | 5-step propagation playback animation | Hand-authored fixed keyframes | HARDCODED | Not computed from real conflict magnitude; identical regardless of train selection. |
| Control Room | Live prediction counter | `/api/stats` → `total_predictions_served` | REAL, with fallback | Falls back to a hardcoded `1204` only on fetch failure, correctly presented as a fallback. |
| Control Room | "DATA SOURCE: Local Graph Replay" label | `graph.source_type` | REAL (and honest) | The one transparent element on this page — genuinely reads the field, would say something else if the backend ever returned live data. |
| Control Room | "Regional Network Matrix" (7 rows) | Real per-train P50/P90; conflict column hardcoded per-train-ID if/else | REAL data / HARDCODED conflict logic | Every train besides the two baked into the fixed scenario always shows static CLEAR/+0.0m regardless of its actual data. Same silent-row-drop pattern. |
| Control Room | Static corridor/track SVG, captions | Static HTML | HARDCODED, appropriately so | Not misleading given the disclosure elsewhere on the page. |

## 7. Ghost Train Sandbox

**Structural finding first**: `dashboard/sandbox.js` (320 lines — a well-built API+local-fallback+debounce implementation) is **never loaded by `dashboard/sandbox.html`** (confirmed: `sandbox.html` loads only `app.js`; zero references to `sandbox.js` in any dashboard HTML). Every claim resting on that file — dynamic threshold-line position, graceful offline fallback, debounced slider, ambient steam particles — describes dead code that does not run. The page's real behavior is `dashboard/app.js`'s separate, independent `runSandboxScenario()`/`loadSandbox()`, which has materially different (weaker) behavior.

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| Sandbox | Delay injection slider + preset chips | `runSandboxScenario()` → `/graph/sandbox?source_delay=N` | REAL | Live on every interaction. |
| Sandbox | Conflict addition readout | `data.conflict_addition_min` | REAL | Real max-plus graph engine (`src/graph/sandbox_endpoint.py`). |
| Sandbox | Resulting Rajdhani total delay | `data.affected_total_delay_min` | REAL | |
| Sandbox | Scenario stamp, severity text | `data.conflict_active`, `data.severity` | REAL | |
| Sandbox | "AVAILABLE HEADWAY" telemetry | Client formula `10.8 - delay*0.31` | **HARDCODED (fabricated)** | No basis in the API response — an invented linear formula presented as precise telemetry. Real backend constraint is a fixed 10-min minimum. The single most misleading element on this page. |
| Sandbox | Headway scale pin position | Client formula `75 - delay*0.9` | HARDCODED (visual-only) | Decorative, not real geometry. |
| Sandbox | Formula display (`sb-formula-code`) | Client-rebuilt with constants copy-pasted from backend | PARTIAL / duplicated logic | Agrees with backend today (fixed scenario); would silently go stale if backend constants ever changed. |
| Sandbox | Formula explanation text | `data.propagation_explanation` | REAL | |
| Sandbox | Signal lamp + text | Recomputes `conflictAdd > 15` instead of reading `data.severity === 'high'` | PARTIAL | Functionally correct today, duplicates backend classification with a magic number. |
| Sandbox | Ghost train tokens, conflict beam, delay tags | Branch-selected between two fixed layouts, driven by real `isConflict` | REAL | |
| Sandbox | "Before vs After" baseline value | Binding not located in JS | UNVERIFIED | Needs a browser check — likely static "55.0" given the fixed scenario, not confirmed. |
| Sandbox | Identity card (train/section/threshold/headway/engine model) | Static HTML | HARDCODED (but accurate) | Values match backend's real fixed constants — correctly static for a genuinely fixed scenario. |
| Sandbox | Scenario preset chip values | Static HTML, real API call on click | REAL (interaction) / HARDCODED (values) | |
| Sandbox | API-offline fallback / "LOCAL CALCULATION FALLBACK" indicator | **Does not exist in the live code path** — only in the orphaned `sandbox.js` | **BROKEN (claimed capability absent)** | The live `catch` block only `console.error`s — no UI update, no fallback, no status indicator. `docs/PAGE_ARCHITECTURE.md` explicitly claims this fallback exists; it doesn't, in what actually runs. On a real API outage the page silently freezes with no error shown. |
| Sandbox | Steam particles / ambient train float | Only in unused `sandbox.js` | HARDCODED/decorative, likely absent in practice | Since `sandbox.js` never loads, this described effect doesn't run. |
| Sandbox | EN/HI/MR language toggle | `applyGlobalLanguage()` | REAL | |
| Sandbox | FAQ accordion (8 Q&As) | Static content | REAL (interaction) / HARDCODED (content) | Appropriately static. |
| Sandbox | References & Technical Provenance section | Static HTML | HARDCODED (appropriate) | Citation content, correctly static. |

## 8. Global elements (present on all 7 pages)

| Page | UI Element | Data Source (file/function) | Status | Evidence/Notes |
|---|---|---|---|---|
| All 7 | Live/Replay ticker badge | `updateMode()` ← `/system/status` | REAL | Confirmed present in all 7 HTML files. Reflects the real `RIPPLEETA_MODE`/`RIPPLEETA_API_KEY` server config with genuinely distinct CSS — verified true in the code as it exists now, not inherited from `ROUND2_READINESS.md`'s claim. |
| All 7 | EN/HI/MR language switcher | `applyGlobalLanguage()` | REAL (static text) / PARTIAL (dynamic text) | Static labels use a local translation table. Dynamic (API-derived) text optionally calls Google Translate (BYO key) or the free MyMemory API as fallback — real live calls, but MyMemory has no SLA. |
| All 7 | Train ID input + demo-train chips | `trainId()`/`persistTrain()` | REAL | Drives every subsequent API call. |

---

## Summary counts (approximate, by row above)

- **REAL**: the majority of numeric readouts tied directly to `p10_delay_min`/`p50_delay_min`/`p90_delay_min`, the two stakeholder-decision fields that are genuinely server-computed (`platform_commit`, `relief_dispatch_deadline`, `probability_arrival_before_cutoff`, `available_turnaround_min`), the graph/sandbox conflict math, and the Live/Replay + language systems.
- **HARDCODED (fabricated, most concerning)**: Crew Controller's entire dominant decision badge and risk pills (invented HOER duty-elapsed formula), Sandbox's "AVAILABLE HEADWAY" telemetry, both Ripple Score gauges (Station Master and Control Room).
- **HARDCODED (curated/appropriate)**: train display metadata, fixed scenario identity cards, static reference/citation content — labeled here as hardcoded for completeness, not flagged as misleading.
- **BROKEN**: Crew's and Feeder's discarded `message` fields; Control Room's `/graph/demo` never actually taking the selected train as a parameter; Sandbox's claimed-but-nonexistent offline fallback (dead `sandbox.js`).
- **PARTIAL**: financial impact (real delay, undisclosed rate constant), feeder probability (real, normal-approximation), several duplicated-logic instances (COMMIT/DEFER recomputation, sigma recomputation, sandbox severity recomputation, sandbox formula-constant duplication) that agree with the backend today but can silently drift.
- **UNVERIFIED**: passenger `historical_stations`' true per-train variance; sandbox's before/after baseline value binding.
