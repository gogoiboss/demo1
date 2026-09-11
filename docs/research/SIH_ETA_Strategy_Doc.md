# Dynamic ETA Forecast for Coaching Trains — Team Strategy Document
**Team size:** 6 | **Time available:** ~10–14 days to internal hackathon

> **Current implementation boundary (2026-09-06):** The working prototype uses
> a checked-in 10,000-row journey-level artifact, a same-train prior-delay
> proxy, a journey-level schedule-buffer proxy, XGBoost, MAPIE interval bounds,
> and a station-pair graph replay. RailRadar/NTES live ingestion, physical rake
> mapping, station-level ETA chains, and graph activation in the real-data
> backtest remain future work.

---

## 1. PROBLEM DECOMPOSITION

The PS bundles at least 6 genuinely separate engineering problems under one title. Here's the breakdown and how likely competing teams are to actually go deep on each.

| Sub-problem | What it really involves | Likely competitor depth |
|---|---|---|
| **Data ingestion** | Pulling live location/delay data from real or simulated feeds | Shallow — most will fake/mock data with random numbers, not real feeds |
| **Delay propagation modeling** | How a delay at Station A affects trains B, C, D sharing track sections downstream | Very shallow — this is the actual hard problem and most teams won't model it at all, just predict each train in isolation |
| **Point prediction (ETA at next station)** | Regression/ML on current delay + distance + historical averages | Deep — everyone will do this, it's the "obvious" part |
| **Uncertainty communication** | Confidence intervals, "ETA getting more reliable as train approaches" | Almost never done — teams present point estimates as if certain |
| **Multi-stakeholder delivery (API/UX)** | Different views for passenger app, station display, control room | Shallow — most will build one generic dashboard and call it done |
| **Scalability / multi-zone generalization** | Working across geographies with different traffic patterns | Almost never addressed beyond a slide claiming "scalable architecture" |
| **Continuous learning / feedback loop** | System retrains on actual vs predicted outcomes | Rarely demoed, usually just mentioned in future work |

**Takeaway:** Point prediction is where everyone will compete head-on. Delay propagation, uncertainty communication, and multi-stakeholder UX are where the field is wide open.

---

## 2. VAGUE / UNDERSPECIFIED AREAS IN THE PS

| Phrase in PS | Lazy team's interpretation | Rigorous team's interpretation |
|---|---|---|
| "congestion levels on downstream tracks" | Ignored entirely, or a random congestion score | Model track sections as shared resources — a delayed train occupies a block, delaying every other train that needs that block. This is a scheduling/resource-contention problem, not a feature column. |
| "historical delay patterns" | One column: "average delay for this train number" | Segment by time-of-day, season, weather, day-of-week, and *route section* — delay patterns differ wildly between a Delhi–Mumbai trunk route and a branch line. |
| "dynamically update ETAs" | Recompute on a timer (e.g., every 5 min) using the same static formula | Recompute *event-triggered* (new GPS ping, signal change, upstream delay report) and show how confidence tightens as the train approaches — this is what "dynamic" actually should mean. |
| "scalable to cover thousands of trains" | A slide claiming "microservices + Kafka" with nothing built | Actually design (even if not fully implemented) a lightweight per-route model architecture so it doesn't require training one giant model — explain the tradeoff, even if you demo only 2–3 routes. |
| "adaptable to diverse operational zones" | Ignored | Explicitly show your feature set separates "universal" features (delay so far, distance) from "zone-specific" features (average speed restriction by zone) — this signals you understand real generalization, not just a single trained model. |
| "recovery times" | Not distinguished from delay at all | Explain (and use) the real railway concept: schedules have built-in slack/buffer time to absorb minor delays — your model should account for *how much recovery buffer remains*, not just raw delay. |

---

## 3. DOMAIN RESEARCH BRIEF

Before writing a line of model code, your team should be able to answer every question below. Assign these as research tasks — don't skip this, it's what makes your Q&A answers credible.

**A. How Indian Railway scheduling actually works**
- Research: what is "recovery time" / "slack time" built into a schedule, and why timetables aren't just "distance ÷ speed"
- Should be able to answer: *"If a train is 20 minutes late at station X, why might it still arrive on time at the destination?"*

**B. How delays cascade across a shared-track network**
- Research: single-line sections, crossing/precedence rules between trains, why a late train can block others behind or ahead of it
- Should be able to answer: *"Why can one 15-minute delay early in a journey turn into a 90-minute delay 500km later?"*

**C. What real-time/historical data actually exists publicly**
- **NTES (National Train Enquiry System)** — India's official real-time train running status source, run by CRIS. Station masters update it as trains cross reporting points; updates typically land within 5–15 minutes for mainline express trains. This is the *ground truth* source, but it's not a clean public API by default.
- **RailRadar (railradar.in)** — a third-party developer-facing REST API that aggregates NTES + crowdsourced GPS data. Offers live train coordinates, GeoJSON route geometry, timetables, and station boards, with a free sandbox tier (1,000 requests/month). This is realistically your best bet for a working demo with real (not fabricated) data.
- **data.gov.in** — check for historical train-running/punctuality datasets that can be used to backtest your model against real historical delays.
- Should be able to answer: *"What data are we actually pulling live in our demo, versus what would come from Railways' internal systems in a real deployment?"* — be honest about this gap; feasibility is explicitly judged.

**D. Existing ETA/delay-prediction approaches (so you're not reinventing something already dismissed)**
- Research: how airlines and other rail networks (Deutsche Bahn, Amtrak) approach delay propagation — most use some form of network/graph-based propagation model, not pure per-vehicle regression.
- Should be able to answer: *"Why doesn't a simple regression model capture cascading delays well?"*

---

## 4. THREE DIFFERENTIATION ANGLES

### (a) Modeling angle — Delay Propagation as a Network/Graph Problem
**Core idea:** Instead of predicting each train's ETA independently, model the rail network as a graph where nodes are stations/track-sections and edges carry "occupancy" state. A delay at one node propagates to any train scheduled to use that same section later — similar to contagion/diffusion models. Combine this with a per-train regression/gradient-boosting model for the "baseline" journey time, then apply a propagation-correction layer on top.
**Why it's hard to replicate quickly:** It requires understanding train precedence/crossing logic (a genuine domain-specific concept), not just fitting a model to a CSV. Most teams won't get past "we used XGBoost on delay + distance."
**Buildable now:** A simplified 2–3 train, single-route simulation showing propagation between trains sharing a section, with a visual graph.
**Future work (stretch):** Full multi-zone network graph with real-time updates across hundreds of trains.

### (b) Data angle — Real Historical Backtesting via RailRadar + data.gov.in
**Core idea:** Most teams will fabricate/mock their training data. You instead pull real historical running data (via RailRadar's API and/or data.gov.in datasets) for 2–3 actual routes, and show a genuine baseline-vs-model comparison: "naive ETA (schedule + current delay) had X minutes average error; our model had Y minutes error, on real historical data."
**Why it's hard to replicate quickly:** Sourcing, cleaning, and backtesting against real data takes real effort most teams skip under time pressure — they'll present made-up accuracy numbers instead.
**Buildable now:** Pull a few weeks of real running data for 2–3 trains/routes, compute your baseline vs model error.
**Future work (stretch):** Live RailRadar feed integration into the actual demo dashboard (their free tier supports this at small scale).

### (c) Product/UX angle — Stakeholder-Specific Views + Confidence Communication
**Core idea:** Build three distinct interfaces from the same prediction engine: a passenger view (ETA + confidence band, e.g., "arriving 4:10–4:25 PM"), a station-controller view (platform allocation + downstream congestion alerts), and a control-room view (network-wide delay propagation map). Show confidence intervals narrowing as the train approaches — nobody else will bother distinguishing "point estimate" from "confidence."
**Why it's hard to replicate quickly:** Requires designing three different information hierarchies, not just three color schemes on one dashboard — an easy thing to underestimate and rush.
**Buildable now:** All three, since they can share a mocked/simplified backend — this is UI/UX effort, not heavy modeling effort, so it's very achievable with 6 people.
**Future work (stretch):** Real push-notification integration, actual mobile app.

---

## 5. RECOMMENDED FOCUS + JUSTIFICATION

**Recommended primary differentiator: (a) Delay Propagation Modeling**, supported by (b) real data for credibility and (c) as the demo/UX layer — don't treat these as mutually exclusive, treat (a) as your technical core and (b)+(c) as what makes it demoable and presentable.

**Why this maximizes your score against SIH's actual criteria:**
- **Novelty/complexity:** Propagation modeling is the one sub-problem almost every competing team will skip or fake. It directly answers the PS's explicit mention of "congestion levels on downstream tracks" and "delays in preceding trains" — text most teams will glaze over.
- **Feasibility:** A simplified 2–3 train propagation demo is realistically buildable in 10–14 days with 6 people, unlike a full production-scale system.
- **Scale of impact:** You can make a concrete, quantifiable claim ("naive model misses cascading delay entirely; ours reduces downstream ETA error by X%") instead of a vague "improves passenger satisfaction."
- **User experience:** Layering (c) on top gives judges something visual and intuitive to watch during the demo — a graph literally lighting up as a delay propagates is memorable in a way a table of numbers is not.

**Tradeoff:** This requires more domain research upfront (train precedence rules, section occupancy) than a pure ML approach — budget real time for section 3 research before coding starts, don't skip straight to modeling.

---

## 6. STEP-BY-STEP BUILD WORKFLOW (10–14 days, 6 people)

**Phase 1 — Research & Data (Days 1–3)**
- 2 people: complete domain research brief (Section 3) — must be able to explain recovery time, precedence, and section-occupancy logic to the rest of the team by end of Day 2
- 2 people: source and clean real data — sign up for RailRadar API, pull historical running data for 2–3 chosen routes, check data.gov.in for supplementary historical datasets
- 2 people: draft system architecture diagram + define the 3 stakeholder UX views (wireframes only, no code yet)
- End of Phase 1: team-wide sync — everyone can explain the domain concepts and the chosen routes/data

**Phase 2 — Core Model Build (Days 4–7)**
- 2 people: build baseline model (naive ETA = schedule + current delay + fixed recovery) — this is your comparison benchmark, keep it simple
- 2 people: build the propagation-correction layer — simplified graph/network model for shared-section delay spread between 2–3 trains
- 2 people: start backend/API skeleton (this is what "APIs for integration" in the PS expects) — simple REST endpoints serving predictions

**Phase 3 — Integration & Dashboard (Days 8–10)**
- Combine baseline + propagation model, run backtest against real historical data, compute error metrics (this becomes your key "scale of impact" number)
- Build the 3 stakeholder dashboards (passenger/controller/control-room) — can be a single React app with 3 views
- Add confidence-interval display (narrowing as train approaches)

**Phase 4 — Demo Polish & Pitch Prep (Days 11–14)**
- Rehearse a live or recorded demo showing: (1) baseline vs your model error comparison, (2) a simulated delay event propagating visually across the graph, (3) all 3 stakeholder views responding to the same event
- Build the 6-slide PPT mapped exactly to SIH's official template sections (idea/solution, technical approach, feasibility, impact, research/references)
- Prepare backup: a recorded video of the demo in case of live Wi-Fi/hardware failure — judges explicitly note that teams with backups look more prepared
- Do at least 2 mock Q&A sessions where teammates grill each other on the domain research questions from Section 3

---

## 7. WHAT TO SAY IN THE PITCH THAT NO ONE ELSE WILL SAY

1. **"Most ETA systems predict each train in isolation — ours models the network."** Open by naming the actual limitation of the "obvious" ML approach, then show your propagation graph lighting up as one train's delay spreads to two others sharing a section. This single visual moment does more than any slide of accuracy metrics.

2. **"Here's our model against a real historical baseline — not a made-up number."** Show the actual backtested error comparison (naive schedule-based ETA vs your model) on real historical data you sourced yourself. Naming your real data source specifically signals rigor immediately.

3. **"Our ETA gets more confident, not just more updated, as the train approaches."** Demo the shrinking confidence interval — most teams will show a single number changing, you show *uncertainty shrinking*, which is a subtly more sophisticated and honest way to communicate a forecast.

4. **"This is what a passenger sees, this is what a station controller sees, this is what a control-room operator sees — same engine, three decisions."** Toggle between your three dashboards live. This directly demonstrates "scale of impact" across multiple named stakeholder groups from the PS (passengers, station staff, crew scheduling, platform allocation) rather than a single generic UI.

---

### Honest flags
- **Safe and buildable in 10–14 days with 6 people:** baseline model, simplified 2–3 train propagation demo, real historical backtest on a couple routes, 3-view dashboard, confidence intervals.
- **Ambitious/stretch — present as future work, don't over-promise:** thousands-of-trains real-time scale, full multi-zone generalization, live production API integration with Railways' internal systems, live push notifications to a real mobile app.
