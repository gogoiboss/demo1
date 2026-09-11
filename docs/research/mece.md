> **Status boundary:** This is the target architecture. Implemented scope is
> journey-level prediction/calibration, an isolated station-pair graph replay,
> and prototype API translations. Live ingestion, segmented submodels, SHAP in
> the API, and drift monitoring are not implemented.

## Step 1: MECE violations in the current list

**Mutual exclusivity violations — things that overlap:**

| Item | Violation |
|---|---|
| "Late incoming rake lookup" under Baseline Model | It's a data fetch operation — it sits in the data pipeline as much as in the model. Ambiguous ownership. |
| "Remaining schedule buffer" under Baseline Model | It's also an input to conflict detection (how much buffer remains determines whether a conflict propagates to the final ETA). It straddles two layers. |
| "Data pipeline" as a parallel pillar | It feeds *everything* upstream — it's infrastructure, not a value pillar at the same level as the model, the propagation layer, or the outputs. Listing it alongside them is a category error. |
| "SHAP explanation layer" as standalone | It's how the output is *delivered credibly* — it belongs inside the output/trust layer, not as its own top-level pillar. |
| "Historical validation story" as item 9 | Correctly noted as "not a component" — then listed as one anyway. Remove from the architecture. It's a demo artifact. |

**Collective exhaustiveness gap — what's missing:**
- No explicit home for the **data reliability / fallback logic** (what happens when NTES is stale, GPS drops in a tunnel, or signals conflict). The datafailures doc treats this as architecturally significant. Currently homeless.
- **Concept drift monitoring** (rolling MAE watchdog + retraining trigger) has no clear home. It's the system's self-maintenance mechanism — currently bolted on at the end.

---

## Step 2: The clean MECE structure — 4 value pillars

The four things that make this system genuinely different from NTES + a basic XGBoost, each addressing a distinct gap, with zero overlap:

---

```
┌─────────────────────────────────────────────────────────┐
│         FOUNDATION: Live Data Ingestion Layer           │
│  NTES/RailRadar (live) · Kaggle (historical training)  │
│  Public timetable · Rake history lookup                 │
└──────────────┬──────────────────────────────────────────┘
               │ feeds all four pillars
    ┌──────────┴─────────────────────────────────────┐
    ▼           ▼              ▼              ▼
┌────────┐ ┌────────┐   ┌─────────┐   ┌──────────┐
│ P1     │ │ P2     │   │ P3      │   │ P4       │
│ Rake-  │ │Network │   │Calibrated│  │Decision  │
│ Aware  │ │Conflict│   │Uncertainty│ │Translation│
│ Engine │ │Detection│  │Engine   │   │Layer     │
└────────┘ └────────┘   └─────────┘   └──────────┘
```

---

### Pillar 1 — Rake-Aware Prediction Engine
*What the train carries from its past*

**Sub-points:**
- Late incoming rake lookup — prior leg delay as the primary feature (>80% correlation, separate query before departure)
- Remaining schedule buffer — `scheduled_time_remaining − min_running_time_remaining`, derived from public timetable
- Segmented sub-models per journey phase — origin departure, within-zone, zone-boundary transfer, Day 2+ cumulative

**One-sentence explanation (technical):**
> We model what the train inherits before it moves — its rake's prior delay and how much timetable slack remains to absorb it — because these two signals predict over 80% of real delays and no existing system computes them.

**Grandmother test:**
> If the train was late yesterday, it starts today already behind — we check that, and we check how much cushion time is left in the timetable for it to recover.

✅ Passes.

---

### Pillar 2 — Network Conflict Detection
*What the train faces from the track ahead*

**Sub-points:**
- Timed event graph — stations as nodes, arrivals/departures as events, two edge types: same-train running edges and cross-train resource-conflict edges
- Headway-based conflict detection — if two trains share the same station-pair within a time window and one is significantly late, apply a historically-calibrated delay increment to the other
- Train precedence encoding — Vande Bharat / Rajdhani / Superfast / Mail hierarchy governs which train's conflict edge becomes the source

**One-sentence explanation (technical):**
> We model the track as a shared resource graph, not a collection of isolated train runs, so when a train upstream is blocking the only available section, our system sees it — where NTES, treating each train independently, is structurally blind to it.

**Grandmother test:**
> If one train is late and blocking the track, every train behind it on the same track gets delayed too — we track that chain reaction, which the official system completely ignores.

✅ Passes.

---

### Pillar 3 — Calibrated Uncertainty Engine
*How honest the forecast is about what it doesn't know*

**Sub-points:**
- Conformal prediction interval generator — MAPIE library wraps the model, outputs statistically guaranteed p10/p50/p90 windows (coverage-validated: "our 90% interval contains the true arrival 90% of the time")
- Anomaly detection gate — monitors delay accumulation rate; if it exceeds 3× historical 90th percentile, switches from prediction mode to uncertainty mode and suppresses the point estimate
- SHAP explanation per prediction — surfaces the primary reason in plain language ("55-min delay — preceding train on same section running 40 min late"), making the output verifiable by staff

**One-sentence explanation (technical):**
> We output a probability window that narrows as the train approaches and explicitly says "I don't know" during genuinely anomalous events — because a confident wrong prediction causes categorically more harm than an honest wide interval.

**Grandmother test:**
> Instead of saying "arrives at 4:17" and being wrong, we say "arrives somewhere between 4:10 and 4:25" — and if something really unpredictable is happening, we say "we don't know yet" instead of guessing.

✅ Passes.

---

### Pillar 4 — Decision Translation Layer
*How each stakeholder gets an answer, not a data point*

**Sub-points:**
- Per-stakeholder output framing — same prediction engine, different translation per role: station master gets a binary "safe to commit platform now?", crew controller gets a deadline timestamp, passenger gets delay + trend + next update time
- REST API — endpoints for mobile apps, station displays, control room dashboards
- Concept drift monitor — **Phase 2 roadmap:** rolling 30-day MAE watchdog + ADWIN alerting and human-reviewed retraining for timetable changes, new infrastructure, or new train classes

**One-sentence explanation (technical):**
> We translate the same probability window into a ready-made decision for each stakeholder — because showing a station master a confidence interval and expecting them to derive a platform allocation decision is not a product, it's homework.

**Grandmother test:**
> The same prediction tells the ticket counter person "the train will probably be late," tells the platform manager "don't book Platform 4 yet," and tells the bus company "don't leave yet" — automatically, for each person, in the right words.

✅ Passes.

---

## Step 3: Full MECE check on the final structure

| Test | Result |
|---|---|
| **P1 ∩ P2 = ∅?** | Yes. P1 is about *this train's* history and timetable. P2 is about *other trains* and the shared track. Different data sources, different computations. |
| **P2 ∩ P3 = ∅?** | Yes. P2 computes *what* the delay will be. P3 computes *how confident* we are in that computation. Distinct operations. |
| **P3 ∩ P4 = ∅?** | Yes. P3 is about the quality and honesty of the output. P4 is about the format and delivery of that output to different people. |
| **P1 ∩ P4 = ∅?** | Yes. P1 is model inputs. P4 is model outputs and delivery. |
| **Collectively exhaustive?** | Yes. Every component from the full list now has exactly one home. The data pipeline is correctly demoted to infrastructure. Historical validation is correctly removed from the architecture. |

---

## The slide, as it would read

```
┌─────────────────────────────────────────────────────────────────┐
│                  FOUNDATION: Data Ingestion                     │
│        Live: NTES / RailRadar    Historical: Kaggle / data.gov  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PILLAR 1    │  │  PILLAR 2    │  │  PILLAR 3    │  │  PILLAR 4    │
│  Rake-Aware  │  │  Network     │  │  Calibrated  │  │  Decision    │
│  Engine      │  │  Conflict    │  │  Uncertainty │  │  Translation │
│              │  │  Detection   │  │  Engine      │  │  Layer       │
│ · Rake cycle │  │ · Event graph│  │ · p10/p50/p90│  │ · Role-based │
│ · Buffer     │  │ · Headway    │  │   intervals  │  │   outputs    │
│   remaining  │  │   detection  │  │ · Anomaly    │  │ · REST API   │
│ · Segmented  │  │ · Precedence │  │   gate       │  │ · Drift      │
│   sub-models │  │   encoding   │  │ · SHAP "why" │  │   monitor    │
│              │  │              │  │              │  │              │
│ "What it     │  │ "What the    │  │ "How honest  │  │ "What action │
│  carries"    │  │  track holds"│  │  the forecast│  │  each person │
│              │  │              │  │  is"         │  │  should take"│
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

Four pillars. Zero overlap. Nothing missing. Each earns its place because the problem is unsolvable without it.