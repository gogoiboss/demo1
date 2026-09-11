All 13 docs in context. Working through each dimension with evidence pulled directly from the research.

---

## FEASIBILITY — Can we build it?

**Implementation status note (2026-09-06):** The feasibility research identifies
possible public sources, but the current repository connects only the local
historical journey artifact and timetable inputs. RailRadar/NTES are not live
inputs to the API, and the public artifact lacks paired station-event state.
Therefore the graph is demonstrated by replay and not measured in the real-data
backtest.

**Evidence from the docs:**

- **Data path is staged**: the prototype uses its checked-in historical artifact and `data.gov.in` timetable; RailRadar REST API and NTES scraping tools are available only as prototype/replay options. The production target is authorized CRIS/RTIS access once the data contract exists.

- **The stack is entirely open-source**: Conformal prediction → MAPIE library (2–3 lines to wrap any model); gradient boosting → XGBoost/LightGBM (standard); timed event graph propagation → single forward traversal, no optimization loop; temporal cross-validation → `sklearn.TimeSeriesSplit` (3 lines). No proprietary dependency anywhere.

- **Credible 10-day build path exists** (the docs lay it out explicitly): baseline model 2 days, headway conflict detection 2 days, conformal prediction wrapper 2 days, one stakeholder view 1 day, live data pipeline 2 days, demo polish 1 day. 10 days, 6 people, no heroics required.

- **What we honestly cannot build**: true section-level propagation (that data doesn't exist publicly — the docs are explicit about this). We call it headway-based conflict detection and state the approximation. That honesty is itself a feasibility strength.

---

## DESIRABILITY — Do stakeholders actually need this?

**Passengers**
> Today they struggle with NTES showing "on time" while the train sits still — the app freezes at the last reported station and the ETA doesn't move, so passengers make departure decisions (leave home, book connecting transport) based on false information, and experience not just a delay but a decision made in good faith on bad data.
> Our solution directly addresses that by replacing the frozen point estimate with a delay-in-minutes + trend direction (improving / stable / worsening) + a committed next-update time — so they know when to check again, not just what to distrust.

**Station Controllers / Platform Allocation**
> Today they struggle with NTES ETAs that assume maximum permissible line speed — structurally optimistic by design — with no confidence signal attached, so platform allocation is announced only 30–40 minutes before arrival (not because that's optimal, but because the SM can't trust the estimate early enough to act sooner). When uncertainty is high, they hold a platform in reserve, blocking it from other trains — a hidden congestion cost that compounds across the day.
> Our solution directly addresses that by delivering `ETA ±N min` with a binary flag — "safe to commit platform now?" — 60–90 minutes out, so the SM can act earlier on high-confidence predictions and explicitly hold off on low-confidence ones, instead of applying the same late-commitment rule to every train regardless of certainty.

**Crew Scheduling / Crew Controller**
> Today they struggle with the Crew Management System computing relief timing from the *scheduled* arrival rather than the *predicted* arrival — so when a train is running 90 minutes late, the system may not flag that the relief crew signed on hours ago and will themselves be approaching their rest limit by the time the train arrives. HOER violations from botched reliefs are documented as a recurring operational reality, and each one blocks the section for 1–4 hours, cascading to 5–15 trains behind.
> Our solution directly addresses that by computing a single output — "relief crew must sign on by 11:45" — recalculated every 30 minutes from the predicted ETA with confidence bounds, so the controller dispatches early under pessimistic scenarios rather than discovering the problem after it's too late.

**Feeder Transport (last-mile buses, hotel pickups, connecting logistics)**
> Today they struggle with zero automated synchronization between Indian Railways ETAs and any feeder service — providers either dispatch at scheduled time (high miss rate), apply a fixed buffer heuristic (generates idle wait or missed connection), or manually monitor NTES (time-intensive and still unreliable). NTES's structural optimism means providers who trust it consistently arrive early and wait.
> Our solution directly addresses that by outputting `P(arrival before cutoff time)` — a single probability — rather than an ETA. If the probability exceeds 80%, wait; below 40%, depart; in between, dispatch early and communicate. The decision is pre-made; the provider just executes it.

**Cleaning / Maintenance Supervision**
> Today they struggle with cleaning gangs dispatched based on scheduled time, not predicted time — so an early arrival means the gang hasn't arrived yet and the rake sits idle, and a late arrival compresses the maintenance window below the 3-hour secondary maintenance minimum, forcing the supervisor to either rush the job (quality risk, CAG audit exposure) or delay the outward departure (cascading into the next rake cycle).
> Our solution directly addresses that by computing `available_window = next_departure − p90_arrival` and flagging it automatically when it falls below threshold, so the supervisor sees the conflict 2–3 hours before arrival and can request schedule intervention, not discover it when the rake rolls in.

---

## VIABILITY — Would Indian Railways actually sustain this?

**The problem is already acknowledged at the institutional level:**
The Railway Board has issued formal written directives to all 17 zones about wrong data entry into NTES, with penalties for officials who feed incorrect data — meaning the system's failure is not a technical secret, it's a governance problem Indian Railways is already trying to fix. Our system gives CRIS a technical answer to a problem they've already admitted exists.

**The infrastructure investment is already underway:**
RTIS (Real-Time Train Information System), built with ISRO using GAGAN satellite positioning on ~6,500 locomotives, is already being deployed. Our system sits on top of that investment — it's the analytics layer the telemetry doesn't yet have. We don't need new hardware; we need the computation on top of the data the hardware already produces.

**The cost of the current failure is real, recurring, and auditable:**
- Every HOER crew violation that forces an emergency section stop blocks 5–15 trains behind it for 1–4 hours — directly traceable to CMS computing relief timing from schedule rather than prediction
- Every pit-line conflict from a compressed maintenance window generates overtime wages, maintenance quality shortfalls, and CAG audit exposure
- Every platform held in reserve because the SM can't trust an early ETA is a slot unavailable to another train — compounding across hundreds of stations, thousands of trains per day
- The CAG finding that trains are late 54% of the time while zones report 95% punctuality means there's political and institutional pressure to actually fix the measurement, not just report around it

**The adoption pathway is phased and defined:**
CRIS already operates the Pravah API Gateway for authorized partners, and RTIS is the intended operational telemetry source once the required access and data contract are in place. RailRadar and scraped NTES are prototype/replay paths, not the production plan. Our API-first layer is stateless and horizontally scalable, and can run on railway-controlled on-premise infrastructure or NIC/MeghRaj rather than foreign public cloud.

Validated scope is deliberately bounded: 10,000 checked-in journey rows cover 56 train numbers; the final evaluation reports 174 selected-route held-out rows. The Phase 3A synthetic benchmark completes a 500-train, 8-stop cached propagation pass in 20.58 ms, so roughly 500–800 trains is an architectural hypothesis for zone scale, not a completed production load test. National rollout requires phased infrastructure, zone-by-zone validation, and capacity testing. Hindi plus zone-language passenger output and low-bandwidth/offline station displays are near-term deployment requirements.

**It gets better over time by design:**
The concept drift monitor is a Phase 2 roadmap item: rolling 30-day MAE plus ADWIN alerting, followed by human-reviewed retraining after a Kavach installation, timetable revision, or fleet upgrade. The current demo is backtest-only and does not silently deploy a refreshed model.

---

## The integrating sentence

**Full version (for a slide):**
> Our solution is **feasible** because the checked-in historical artifact, public timetable, and open-source stack support a credible prototype; **desirable** because stakeholders are operating on structurally broken information that the decision layer targets; and **viable** because Indian Railways is already investing in RTIS infrastructure. Production viability still depends on phased CRIS/RTIS access, zone-by-zone validation, government-hosted deployment, and capacity testing rather than a claim of national readiness.

**Compressed speaker version (30 seconds):**
> It's feasible — the data and stack exist today, 10-day build, no proprietary dependencies. It's desirable — every stakeholder we identified is currently making the wrong decision from the same broken ETA, and we give each of them a different decision-ready answer. And it's viable — Indian Railways is already building the telemetry infrastructure this sits on top of, the Railway Board has already admitted the data problem in writing, and the operational cost of not having it is measurable, recurring, and auditable.