# RippleETA — Page Architecture & Product Specification

> **For judges, reviewers, and future contributors.** This section documents every screen in the RippleETA system, reflects the real state of what is built and demoable, and explains why the architecture makes different design decisions from every existing Indian Railways ETA product.

---

## Table of Contents

1. [Why This Is Different](#1-why-this-is-different)
2. [Authentication](#2-authentication)
3. [Home / Landing](#3-home--landing)
4. [Stakeholder Dashboards](#4-stakeholder-dashboards)
   - [4.1 Passenger View — The Honest Ticket](#41-passenger-view--the-honest-ticket)
   - [4.2 Station Controller View — Triage Matrix](#42-station-controller-view--triage-matrix)
   - [4.3 Crew Controller View — Dispatch Deadline](#43-crew-controller-view--dispatch-deadline)
   - [4.4 Feeder Transport View — Probability Gate](#44-feeder-transport-view--probability-gate)
   - [4.5 Maintenance Yard View — Turnaround Budget](#45-maintenance-yard-view--turnaround-budget)
   - [4.6 Control Room / Network View — Ripple Radar](#46-control-room--network-view--ripple-radar)
   - [4.7 Ghost Train Sandbox — Interactive Proof](#47-ghost-train-sandbox--interactive-proof)
5. [Shared Design System](#5-shared-design-system)
6. [Honest Roadmap](#6-honest-roadmap)

---

## 1. Why This Is Different

> **The single sentence that no other team in the room can say:**
> *"We don't output when a train arrives. We output how confident you can be in that number — and who should act on it."*

Every Indian Railways ETA product today answers the question: *"Where is the train?"* RippleETA answers a different question: *"What should each stakeholder decide right now, given what we know and don't know?"*

### Competitive Comparison

| Capability | NTES (Official) | RailYatri Smart ETA | Where Is My Train | RippleETA |
|---|---|---|---|---|
| **Core technology** | Manual station-master reports + assumed max line speed | Historical ML clustering + crowd-sourced GPS from app users | Cell-tower triangulation (works offline, ~1 km precision) | XGBoost + MAPIE conformal prediction + timed event graph |
| **Data freshness** | 5–30 min lag; position unknown between stations | ~5 min (where crowd-GPS is dense); degrades on rural routes | Continuous (cell-tower) but approximate; no ML layer | Journey-level historical artifact; live API integration is future work (stubs built) |
| **Output type** | Single clock time (`ETA: 14:37`) | Single ETA with no uncertainty signal | Current delay + positional tracking, no forecasting | **Calibrated P10/P50/P90 interval** (`14:20–14:55, 97.7% empirical coverage`) |
| **Network awareness** | None — treats each train as isolated | None | None | **Timed event graph**: station-pair headway conflict detection (Goverde 2010 max-plus algebra); honestly stated as station-pair approximation, not block-level |
| **Rake cycle** | None | None | None | Prior-leg delay used as a primary feature (the single highest-correlation predictor in any IR delay model) |
| **Anomaly handling** | Shows "on time" while train sits stopped on open section | No uncertainty mode | No uncertainty mode | **Anomaly gate**: suspends point prediction when variance exceeds 3× historical baseline; shows `PREDICTION SUSPENDED` |
| **Stakeholder-specific outputs** | One ETA shown to everyone | One ETA shown to everyone | One delay shown to everyone | **Five distinct decision APIs**: commit flag (SM), dispatch deadline (crew), probability gate (feeder), turnaround budget (maintenance), delay+trend+next-update (passenger) |
| **Calibration validation** | None | None | None | Measured: **97.70% empirical P10–P90 coverage** on 174 selected-route held-out rows; interval width (106.6 min avg) stated alongside, not hidden |
| **Honest about limitations** | ❌ | ❌ | ❌ | ✅ — section-level data doesn't exist publicly; stated explicitly in UI labels and docs |

### The mechanism every competitor misses

Indian Railways delay is not random noise around a point estimate. It has **structure**: the previous leg of a rake delays the next (>80% correlation when prior-leg delay >30 min), and a delayed train physically occupies a single-track block section, cascading lateness to every train sharing that section — including opposite-direction trains waiting to cross. NTES, RailYatri, and Where Is My Train all treat each train as an isolated event. RippleETA models both of these causal mechanisms.

The tradeoff acknowledged honestly: the cascade detection uses a **station-pair approximation** (section-level position data is not publicly available from NTES or RailRadar), and the backtest measures 0 graph-adjusted rows because the journey-level historical artifact lacks paired station-event data. These limitations are labeled in the UI and documented in `docs/LIMITATIONS.md`. A team that can say "here is exactly where our model stops" is more trustworthy than one that can't.

---

## 2. Authentication

**Status: 🔮 PLANNED — not built in current prototype**

### Purpose

A single authenticated entry point that routes each user to their appropriate stakeholder dashboard. In production, the role determines which view they see by default and which API endpoints they have permission to call.

### Planned design

**Visual metaphor:** The login screen uses a *departure-board* aesthetic — not a generic corporate auth form. The background is the deep ink (`#091113`) base with a physical warm gradient, and the central element is a styled arrival/departure board (the split-flap "Solari board" aesthetic) that cycles through actual train categories as an ambient animation. The RippleETA brand mark appears above it.

**Entry point:** Google OAuth (or institution SSO for a production IR deployment). Single sign-on means no password fatigue for operational staff, and OAuth provider manages session security.

**Post-login flow:**

1. **First-time user:** shown a role-selection screen (five cards: Passenger / Station Controller / Crew Controller / Feeder Coordinator / Maintenance Supervisor). Selection is saved to profile.
2. **Returning operational staff:** routed directly to their saved stakeholder dashboard with the last-queried train ID pre-populated.
3. **Admin/Control Room:** bypasses role selection, goes to the Network View with all tabs accessible.

**Why this matters for judging:** Without auth, all five dashboards are accessible via tabs to anyone — which is the correct choice for a demo. In a real IR deployment, a station master should not see the maintenance yard's turnaround window for a different rake, and a passenger should not see raw interval bounds that require operational interpretation. Auth enforces the information architecture.

---

## 3. Home / Landing

**Status: 🔮 PLANNED — not built; current entry point is the dashboard directly**

### Purpose

What a first-time visitor (passenger, judging panel, potential IR partner) sees before selecting a role. This is the product's single chance to communicate the core value proposition in one glance.

### Planned design

**Hero section — Ripple Radar animation:**
The primary visual is a subtle, ambient version of the network-propagation metaphor. A simplified rail corridor (three stations, two trains) renders in the teal-on-ink palette. The source train pulses amber — a *breathing* animation at rest. When the cascade crosses the headway threshold, a ripple expands outward in amber, transitioning the downstream train's glow from teal to amber. This is the "Ripple Radar" concept from the design brief: it demonstrates the core mechanism (delay is contagious across a network) without requiring any explanation text.

**Core pitch — three facts:**
Below the hero, three cards in a row:
1. **"Not a point estimate."** — "Every other tool tells you 14:37. We tell you 14:20–14:55, with a measured 97.7% coverage rate."
2. **"Not one screen for everyone."** — "Five stakeholders. Five decisions. One forecast engine."
3. **"Not pretending the data is better than it is."** — "When our model can't give a reliable answer, it says so."

**Role-selection entry points:**
Below the three cards, five large, styled entry-point buttons — one per stakeholder role — each with a one-sentence description of the decision they help make. Clicking routes to the corresponding dashboard view.

**Why this exists separately from auth:** The landing page is public-facing (judges, potential partners, media coverage). The authenticated dashboards are operational tools. They are architecturally distinct even if currently collapsed into one demo URL.

---

## 4. Stakeholder Dashboards

> **Architecture note:** All seven views currently exist as tabs within a single-page application at `dashboard/index.html`. They are not separate pages/routes. The tab-based SPA was the correct choice for a hackathon prototype — it eliminates routing complexity and API re-authentication. In a production system they would be separate authenticated routes.

---

### 4.1 Passenger View — The Honest Ticket

**Status: ✅ BUILT**

**What's built:**
- Large hero number: delay in whole minutes (P50 point estimate)
- Calibrated arrival window: P10–P90 range rendered as a visual track bar with a white marker at P50
- **Feature 1: Connection Safety Flag**: "Should I leave now?" block comparing user-inputted connection deadline against the MAPIE calibrated `p90_delay_min`. Dynamically warns user "Safe to leave", "Cutting it close", or "Wait — high risk of missing it".
- **Feature 2: Anomaly Gate Honesty**: If the anomaly gate is triggered (`status: PREDICTION SUSPENDED - anomalous conditions`), silently drops the interval and replaces it with a prominent, honest coral/red warning rather than giving an unreliable estimate.
- Trend chip: reads the `trend` field from the API (`stable` / `worsening` / `improving` / `unknown`) — colour-coded teal/amber/red/muted
- Next update time: pulled from the API `next_update_at` field
- Conflict card: shows whether the current prediction includes a graph-based conflict adjustment
- Live API connection indicator with `live-pulse` animation

**What's missing / gap:**
- The API currently always returns `trend: "unknown"` — no time-series tracking is implemented, so the trend chip always displays `UNKNOWN` in practice. To show `stable` / `worsening` / `improving`, the system needs a rolling window of past predictions per train stored in a database. This is the single biggest functional gap in this view.
- No map integration showing the train's physical position on its route.
- The "next update" time is an API-generated timestamp (now + 30 min), not driven by actual live data ingestion.

**The decision this page exists to serve:**
> *"Should I leave home now, or do I have time?"*

**Visual treatment:**
The hero delay number is enormous (`clamp(76px, 12vw, 160px)`) and in the deep text colour — it reads across a room. The P10–P90 range bar below it uses a warm gradient from teal-deep to amber to visually communicate "this is a range, not a point." The P50 marker is a white vertical line inside the bar — the passenger immediately understands "the train will probably arrive somewhere in this band."

The `live-pulse` dot in the top-left of the section kicker breathes continuously at 1.5s — indicating live data. If the API is offline, it switches to amber and the header reads `DEMO DATA / API OFFLINE`.

**Indian Railways visual reference:**
The Honest Ticket metaphor: the delay number and window are styled to evoke the typography of a physical IRCTC ticket — monospaced IBM Plex Mono for the numbers, serif-influenced headings. The train label (`TRAIN 20507`) is displayed in teal in the same all-caps mono font used on reservation printouts.

**What the Figma/design brief specified vs. what's built:**
The brief described an *"Honest Ticket" UI concept — calibrated ETAs overlaid on a digital IRCTC ticket visual*. The current implementation captures the data content and typography of this concept but renders it as a data dashboard panel rather than a physical ticket-shaped card. The ticket-card visual treatment is planned, not built.

---

### 4.2 Station Controller View — Triage Matrix

**Status: 🚧 IN PROGRESS**

**What's built:**
- Platform commitment decision: `COMMIT` (teal) / `DEFER` (amber) / `SUSPENDED` (muted), derived from the confidence interval width (≤ 30 min → COMMIT, >30 min → DEFER)
- **Feature 2: Anomaly Gate Honesty**: If the anomaly gate is triggered, visually changes the main decision card to read `SUSPENDED` with a red border, and advises falling back to manual control charts.
- **Feature 3: Section Conflict Forecast**: Added an expandable "Active Section Conflict Forecast" on the decision card. When `conflict_adjustment_min` > 0, explicitly lists the delaying train and shared track section, acting as a proxy for platform assignment conflicts which are unavailable in the dataset.
- Decision deadline countdown: "DECISION NEEDED IN X min" — time until the window narrows past the point of no return
- P10 and P90 as separate large metric cards
- Signal table: interval width, conflict propagation status, prediction state, recommended line hold
- **Multi-train junction table** (built in latest session): 5 hardcoded demo trains fetched in parallel via `Promise.all()`, rendered as a sortable table with columns: Train | P50 Delay | Interval | Commit/Defer | Deadline | mini delay bar

**What's missing / gap:**
- The junction table uses 5 hardcoded train IDs (`['20507', '12301', '56789', '12952', '22119']`) — it is not dynamic based on actual trains scheduled at the junction the user is monitoring.
- The conflict forecast relies on static graph demo data for the `delaying_train` identifier because true station-pair occupancy tracking is unavailable in the IR dataset.
- No Gantt/timeline chart showing platform occupation vs arrival sequence — the Triage Matrix concept from the research brief imagined a time-axis grid of all incoming trains, coloured by delay severity.
- No multi-junction support — a station master managing multiple junctions still has to query one train at a time.

**The decision this page exists to serve:**
> *"Is this ETA reliable enough to commit Platform 4 right now, or do I hold it?"*

**Visual treatment:**
Dense, command-centre layout. The `COMMIT` / `DEFER` decision value uses the same 62px IBM Plex Mono as the passenger hero delay, but constrained in a card — it reads as a binary output, not a number to be interpreted. The amber border-top on the decision card signals this is an active operational signal, not informational display.

The junction table uses tight mono typography (9px column headers, 11px data rows) — deliberately information-dense because station controllers are trained to read dense control charts. Each COMMIT/DEFER badge in the table is a small bordered chip matching the main decision card's colour logic.

**Indian Railways visual reference:**
The control chart aesthetic — station masters use physical distance-versus-time charts with colour-coded train paths. The junction table approximates this as a tabular time-ordered list rather than a true graphical chart, but uses the same logic: priority order, delay magnitude, and commit decision in one glance.

---

### 4.3 Crew Controller View — Dispatch Deadline

**Status: ✅ BUILT — fully wired to backend API, offline fallback included**

**What's built:**
- Amber dispatch clock: `HH:MM IST` format, showing `relief_dispatch_deadline` from `/predict/{id}/crew-controller`
- Sub-label: "IST · based on P90 upper bound" — makes the methodology explicit in the UI
- Action badge: `⟶ DISPATCH RELIEF` (amber filled) when a deadline is set; `SUSPEND AUTOMATED TIMING` (red bordered) when the deadline is null (anomaly gate triggered)
- P50 predicted delay as a metric card
- Prediction status card
- Explainer card: "The relief dispatch deadline is derived from the P90 upper bound..."

**What's missing / gap:**
- The deadline shown is `now + max(15, 120 - p90_delay)` — a formula-based approximation from API logic in `app.py`. It does not read actual crew sign-on times from a CMS (Crew Management System) database — no such integration exists.
- No crew-hours-remaining display: the full stakeholder research described showing `projected crew hours remaining at relief point`. This requires knowing the current crew's sign-on time, which is CMS data the prototype doesn't have.
- The deadline does not update on a 30-minute push cycle — it refreshes only when the user manually refreshes or changes the train ID.

**The decision this page exists to serve:**
> *"By what time must I sign on the relief crew and dispatch them to the changeover point?"*

**Visual treatment:**
The clock is the largest element on the page — `clamp(72px, 12vw, 130px)` IBM Plex Mono in amber. The amber colour is consistent with the conflict/uncertainty signal throughout the design system: "this requires action now." The `DISPATCH RELIEF` badge uses amber-filled treatment (the highest visual urgency state in the system, same weight as the amber replay button in the Control Room).

**Indian Railways visual reference:**
HOER (Hours of Employment Regulations) documentation. The dispatch deadline is the railway's most time-critical operational output — a missed relief dispatch results in a crew hours violation, a mandatory section stop, and a cascade to 5–15 trains behind. The large clock metaphor reflects this urgency: it is not informational display, it is an action trigger.

---

### 4.4 Feeder Transport View — Probability Gate

**Status: ✅ BUILT — fully wired to backend API, time-picker interaction working**

**What's built:**
- Time picker: `<input type="time">` for the bus/metro cutoff — changing it immediately re-calls `/predict/{id}/feeder-transport?cutoff_time=...` via `reloadFeeder()`
- Probability hero: large `%` number, colour-coded: teal (≥80% → WAIT), amber (40–79% → USE JUDGMENT), red (<40% → DEPART)
- Recommendation badge: `WAIT` / `DEPART` / `USE JUDGMENT` / `SUSPEND` — bordered chip with matching colour
- Interval vs cutoff visual strip: a horizontal bar showing P10–P90 interval fill, a white vertical marker for P50, and an amber glowing marker for the cutoff position
- Strip scale: P10 / P50 / CUTOFF / P90 in minutes

**What's missing / gap:**
- The `probability_arrival_before_cutoff` uses a normal approximation from the conformal interval (σ = (P90 - P10) / 2.56). This is a legitimate approximation for the prototype but not a full conditional distribution.
- The strip scale shows minutes from now, not clock times — a dispatcher may prefer "03:45 IST" rather than "45m".
- No push notification or webhook support — in a real integration a bus dispatcher would receive a proactive alert when the probability crosses below 40%, not poll the dashboard.

**The decision this page exists to serve:**
> *"Does the bus wait for this train, or does it depart on schedule and leave passengers behind?"*

**Visual treatment:**
The probability hero number is the largest element on the page — `clamp(64px, 10vw, 110px)`. Its colour transitions smoothly (0.4s CSS transition) as the time picker changes, making the probability feel live and reactive. The strip below it gives visual context: where does the P50 estimate sit relative to the cutoff? If the cutoff marker is firmly to the right of the P90 upper bound, the bus should clearly wait. If it's inside the uncertainty band, the USE JUDGMENT recommendation reflects real ambiguity.

The time picker uses `color-scheme: dark` so the browser-native clock widget matches the dashboard's dark theme without a custom component.

**Indian Railways visual reference:**
The connecting-bus coordination problem is documented in ORF reports on last-mile rail connectivity. State bus operators (KSRTC, MSRTC) currently use fixed-buffer heuristics — this view replaces a heuristic with a computed probability for the first time.

---

### 4.5 Maintenance Yard View — Turnaround Budget

**Status: ✅ BUILT — fully wired to backend API, animated progress bar working**

**What's built:**
- Turnaround hero: large number showing `available_turnaround_min` from `/predict/{id}/maintenance`
- Unit label: "minutes available (360 min max window)"
- Animated progress bar: fills proportional to `available_turnaround_min / 360`; transitions colour: teal gradient (≥180 min — ADEQUATE) → amber gradient (90–179 min — COMPRESSED) → red gradient (<90 min — CRITICAL)
- 180-min threshold marker on the bar (the minimum adequate window line)
- Adequacy badge: `✓ ADEQUATE` (teal) / `COMPRESSED WINDOW` (amber) / `⚠ CRITICAL — ESCALATE` (red)
- Crew mode card: `STANDARD TURNAROUND` / `RAPID CLEANING` / `RAPID INTERVENTION`
- P90 delay metric card and recommended action forwarded from API

**What's missing / gap:**
- Available window is `360 - p90_delay` — the 360-minute maximum turnaround assumption is hardcoded and not configurable per rake type or terminus. A Rajdhani and a local EMU have very different turnaround requirements.
- No pit line slot reservation display — at busy terminating stations (Mumbai CST, Howrah), pit lines are shared resources. A full implementation would show the slot allocation queue.
- The action card border turns red for critical windows but this is purely visual — no alert or notification fires.

**The decision this page exists to serve:**
> *"Will I have enough time to complete standard maintenance before this rake needs to depart again — and should I request overtime or renegotiate the pit line slot now, while there's still time?"*

**Visual treatment:**
The progress bar uses a 0.6s cubic-bezier ease-in-out transition — slow enough to feel weighty, like watching a fuel gauge. The teal-to-amber-to-red colour transition is designed to read without text: green bar = safe, amber bar = watch it, red bar = act immediately. The adequacy badge below the bar makes the categorical interpretation explicit for a user who doesn't have time to interpret a gradient.

**Indian Railways visual reference:**
CAG audit reports on railway cleanliness consistently flag rushed secondary maintenance as a root cause of cleanliness score failures. The 180-minute minimum is derived from Indian Railways' secondary maintenance SOPs (3-hour minimum for a full coach set). The RAPID CLEANING crew mode matches the documented "compressed protocol" language used when yard managers request emergency turnaround.

---

### 4.6 Control Room / Network View — Ripple Radar

**Status: 🚧 IN PROGRESS**

**What's built:**
- Fixed corridor visualization: 2D track canvas with station nodes (Kanpur → Allahabad → Mughalsarai), styled as diamond markers in the teal colour
- Train tokens: two positioned train cards (`56789 EXPRESS · +15`, `12301 RAJDHANI · +55`) on separate track lines, with colour-coded dots (teal for Express, amber for Rajdhani)
- Scenario replay button: clicking "▶ SCENARIO REPLAY" triggers the `is-tracing` CSS class, which animates:
  - The two train tokens sliding toward Allahabad
  - An amber dashed conflict path appearing between them with infinite `dash` animation
  - The conflict label updating to `+9 MIN PROPAGATED (SCENARIO)`
- Before/after comparison: "12301 · +55.0 min base delay" → "12301 · +64.0 min after conflict propagation"
- Network state indicator: READY / REPLAYED
- The conflict result is pulled live from `/graph/demo` (the `run_worked_example()` call in `app.py`), which runs the real timed event graph computation

**What's missing / gap:**
- The visualization is a **fixed scenario replay** — it always shows the Kanpur–Allahabad corridor with trains 12301 and 56789. Entering a different train ID in the top bar does not change the network diagram.
- There is no dynamic graph rendering: to show a different corridor or a different train pair, you would need D3.js or Cytoscape generating the node-edge layout from the API response. This is the biggest functional gap in this view.
- The "Ripple Radar" concept from the design brief — a polar-coordinate animation showing multi-train shockwaves — is not built. The current implementation is a linear 2D track layout, not a radar.
- The track canvas does not respond to live data: the conflict path appears/disappears based on user interaction, not automatic detection of real conflict conditions.

**The decision this page exists to serve:**
> *"Which trains are blocking which, and by how many minutes — so I can re-sequence departures before the ripple reaches the next junction."*

**Visual treatment:**
The network canvas uses a `linear-gradient(180deg, #101c1e, #0b1517)` background — darker than the panel cards — to evoke a physical control room display. The station nodes use rotating diamonds (CSS `transform: rotate(45deg)`) matching the Indian Railways diamond marker convention for station symbols on control charts. The amber dashed conflict path animates with a flowing dashed pattern at `1.2s linear infinite`, making the conflict feel dynamic and directional.

The BEFORE → AFTER detail panel below the canvas uses a left-border amber highlight on the AFTER side — the same amber-card treatment used in the passenger view's conflict card, creating a consistent visual language for "this is where conflict changes a number."

**Indian Railways visual reference:**
Station controllers use physical control charts — distance-versus-time diagrams with colour-coded train paths. The network canvas approximates this as a positional diagram: two trains on two track lines, a conflict edge connecting them at a shared section. The diamond station markers, the amber conflict colour, and the "SCHEDULED MOVEMENT / LIVE PROPAGATION" caption all reference the language of Indian Railways operations documentation.

---

### 4.7 Ghost Train Sandbox — Interactive Proof

**Status: ✅ BUILT — fully interactive, wired to `/graph/sandbox` API**

**What's built:**
- 3D isometric CSS scene: two train objects (`56789 EXPRESS` in teal, `12301 RAJDHANI` in amber), three station platforms (Kanpur, Allahabad, Mughalsarai) with roofs, track rails with sleeper ties — all in pure CSS 3D transforms, no canvas/WebGL
- Continuous `train-float` animation: 3-second ease-in-out Y-axis float on both trains, giving the scene physical depth
- Delay injection slider: 0–30 min input for Express 56789; dragging it calls `/graph/sandbox?source_delay={value}` on every input event
- Conflict threshold line on the slider: a red vertical marker at the computed threshold point
- Steam particles: CSS-animated particles rise from the chimney of each train at timed intervals
- Conflict beam: an amber dashed line appears between the trains when conflict is active, with `beam-flow` animation making it look like signal energy travelling from Express to Rajdhani
- Result cards: Conflict Propagation (minutes added), Rajdhani Total Delay (base + conflict), Severity badge (none/low/medium/high), Max-Plus formula display
- The formula card shows the actual computation: `actual = max(scheduled, upstream + headway)` with syntax-coloured values
- **If API is offline:** slider still moves but sandbox falls back to local JS computation (the `sandbox.js` file contains the max-plus formula locally)

**What's missing / gap:**
- The scene is a fixed two-train, three-station scenario. There is no way to add a third train, a different corridor, or a branching junction — these would require a different scene generation approach.
- The conflict thresholds shown are from the API's `threshold_delay_min` field — they vary per scenario. The slider track background (which shows the threshold visually as a colour zone) is hardcoded to `20%` position in CSS rather than calculated from the API-returned threshold value. This means the visual threshold marker on the slider track may not align precisely with the API-computed threshold.

**The decision this page exists to serve:**
This page is not for operational decisions — it is for **understanding and trust-building**. Its purpose:
> *"Let me drag a slider and watch delay propagate in real time, so I believe the mathematical claim before I trust the operational outputs."*

**Visual treatment:**
The 3D scene uses CSS `perspective(1200px)` on the container and `rotateX(25deg) rotateZ(-2deg)` on the track element — a subtle isometric warp that makes the horizontal scene read as three-dimensional without requiring WebGL. The teal/amber train colours match the decision-system meaning throughout the dashboard: the Express (teal = normal) causes a conflict that turns the Rajdhani (amber = conflict-affected) from normal to active. Visual causality matches mathematical causality.

The steam particles use CSS custom property `--drift` for randomised horizontal drift, giving each particle a unique trajectory without JavaScript randomisation.

**Indian Railways visual reference:**
The low-poly train shapes (body block + chimney + window rectangle) evoke the stylised train illustrations used in Indian Railways safety posters and heritage imagery — not photorealistic, but immediately recognisable as trains. The Kanpur → Allahabad → Mughalsarai corridor is the actual route used in the research team's worked example (Goverde 2010 max-plus algebra applied to real IR timetable data for those stations).

**The key engineering fact for judges:**
Unlike the design brief's original plan to use Spline.design (a third-party 3D tool that would require an iframe, external CDN, internet connection, and bridging JS), the scene is built entirely in native CSS 3D. It renders in <100ms, works offline, is fully responsive, and has zero external dependencies.

---

## 5. Shared Design System

### Colour Palette

| Colour | Hex | Role in the system | When it appears |
|---|---|---|---|
| **Ink** | `#091113` | Base background — page-level | Body background |
| **Panel** | `#101b1d` | Card and section surfaces | All data cards |
| **Panel 2** | `#142326` | Slightly elevated card surface | Hover states, icon buttons |
| **Line** | `#293a3c` | Borders and dividers | All card borders, table rows |
| **Text** | `#edf4ef` | Primary readable content | Headings, data values |
| **Muted** | `#8da1a0` | Secondary and supporting text | Labels, captions, scales |
| **Teal** | `#61c5bd` | **Calibrated confidence / on-time / safe-to-commit** | COMMIT decision, WAIT recommendation, adequate turnaround, IMPROVING trend, normal train state |
| **Teal Deep** | `#1d686a` | Teal border / background tint | Card borders on teal states, track rails |
| **Amber** | `#f5b84b` | **Active conflict propagation / defer / act now** | DEFER decision, conflict path, DISPATCH badge, the Rajdhani train in conflict, slider thumb, control room buttons |
| **Amber Soft** | `#6f4d1e` | Amber tint for backgrounds | Amber-card backgrounds, conflict region on slider |
| **Red** | `#f07868` | **Anomaly gate / critical / prediction suspended** | SUSPEND badge, CRITICAL adequacy badge, conflict threshold line, DEPART recommendation, WORSENING trend |

> **Design principle:** Colour carries operational meaning, not aesthetic hierarchy. A judge or station master who learns that amber means "act now" will immediately interpret any amber element correctly, regardless of which view they are on.

### Typography

| Font | Use | Why |
|---|---|---|
| **Space Grotesk** (400–700) | Headings, hero delay numbers, labels | Modern geometric with humanist touches — legible at very large sizes, confident without being aggressive |
| **IBM Plex Mono** (400–600) | All technical data: ETAs, train IDs, intervals, formula displays, clock, badges | Monospaced ensures columns align; Plex Mono is specifically designed for technical/data-heavy UI (IBM's data studio pedigree) |

The pairing is intentional: Space Grotesk provides editorial confidence for the "decision" elements, while IBM Plex Mono provides technical credibility for the "data" elements. Numbers that are precise technical measurements (P10, P50, P90, timestamps) are always in Plex Mono. Numbers that are translated into plain language ("this train is late by X minutes") are in Space Grotesk.

### Motion Principles

All animations are CSS-only (no JS animation libraries). Motion serves information, not aesthetics.

| Animation | CSS class / keyframe | Duration | What it means |
|---|---|---|---|
| **Live pulse** | `.live-pulse` | 1.5s ease-in-out infinite | The prediction engine is connected and active |
| **Panel reveal** | `@keyframes reveal` | 0.35s ease-out | View change transition — content slides up from 5px and fades in |
| **Train float** | `@keyframes train-float` | 3s ease-in-out infinite | Trains are in motion (ambient physical metaphor) |
| **Conflict beam flow** | `@keyframes beam-flow` | 1s linear infinite | Delay energy is travelling from source train to affected train |
| **Conflict pulse** | `@keyframes conflict-pulse` | 1.5s ease-in-out infinite | A train is currently in a conflict state |
| **Steam rise** | `@keyframes steam-rise` | 2.5s ease-out forwards | Train is active / in service (ambient texture) |
| **Dashed trace** | `@keyframes dash` | 1.2s linear infinite | Conflict path is being replayed |
| **Turnaround bar** | CSS `transition: width 0.6s cubic-bezier(.22,1,.36,1)` | 0.6s | Turnaround window updates — weighted feel |
| **Probability hero** | CSS `transition: color 0.4s ease` | 0.4s | Risk level changing as time picker adjusts |

---

## 6. Honest Roadmap

### ✅ Built and demoable right now

| Component | Evidence |
|---|---|
| XGBoost + MAPIE calibrated prediction engine | `src/models/`, `src/calibration/` — 26 passing tests |
| Conformal P10/P50/P90 intervals with measured 97.7% coverage on 174 held-out rows | `docs/RESULTS.md` — verified leakage-free backtest |
| Anomaly gate (suspends prediction at 3× variance threshold) | `src/calibration/anomaly_gate.py` |
| Timed event graph + max-plus delay propagation | `src/graph/timed_event_graph.py` — 9 graph tests passing |
| FastAPI with 6 stakeholder endpoints + OpenAPI docs | `src/api/app.py` — routes: `/predict/{id}`, `/passenger`, `/station-master`, `/crew-controller`, `/feeder-transport`, `/maintenance` |
| Passenger View (P10/P50/P90 bar, trend chip, conflict card) | `dashboard/index.html` — tab 1 |
| Station Controller View (COMMIT/DEFER, junction table for 5 demo trains) | `dashboard/index.html` — tab 2 |
| Crew Controller View (dispatch deadline clock, action badge) | `dashboard/index.html` — tab 3 |
| Feeder Transport View (probability hero, time picker, interval strip) | `dashboard/index.html` — tab 4 |
| Maintenance Yard View (turnaround budget, animated progress bar, adequacy badge) | `dashboard/index.html` — tab 5 |
| Control Room / Network View (fixed Kanpur–Allahabad scenario replay) | `dashboard/index.html` — tab 6 |
| Ghost Train Sandbox (live slider → real graph API → animated CSS 3D scene) | `dashboard/index.html` + `sandbox.js` — tab 7 |
| Offline fallback (realistic demo data shown with clear API OFFLINE label) | `app.js` — all portals have demo fallback objects |
| Docker + GitHub Actions CI | `Dockerfile`, `.github/workflows/` |
| MLflow-compatible experiment logging (local) | `models/experiment_log.jsonl` |

### 🚧 Designed but not fully built

| Component | Gap |
|---|---|
| Trend chip (Passenger) | API always returns `trend: "unknown"` — no temporal tracking implemented |
| Network View — dynamic graph | Always shows fixed Kanpur–Allahabad scenario; does not redraw for different trains |
| Feeder strip scale | Shows minutes from now, not clock times |
| Slider threshold marker (Sandbox) | CSS background zones are hardcoded, not API-derived |
| Multi-train junction table | Uses 5 hardcoded train IDs; not routed to actual junction schedule |

### 🔮 Designed but not built (explicit future work)

| Component | Notes |
|---|---|
| Google OAuth authentication | Designed; zero code written |
| Home / Landing page with Ripple Radar hero animation | Designed; zero code written |
| Honest Ticket visual (IRCTC ticket-shaped passenger card) | Design concept; current implementation is a dashboard panel |
| Polar-coordinate Ripple Radar (full network view) | Design concept; D3.js implementation planned |
| Triage Matrix (time-axis Gantt for station controllers) | Design concept; current junction table is a simplified proxy |

### ❌ Explicitly out of scope for this submission

These are not missing work — they are deliberate scoping decisions for a hackathon prototype, documented in [`docs/LIMITATIONS.md`](../rippleeta/docs/LIMITATIONS.md):

| Item | Why it's out of scope |
|---|---|
| Live NTES / RailRadar data ingestion | Integration stubs are built; live connection requires sustained API access and rate-limit management beyond demo scope |
| Feature stores (Feast / Tecton) | Solves a data-freshness-at-scale problem that doesn't exist at prototype scale |
| Orchestration (Airflow / Kubeflow) | The pipeline runs as a Python class; Airflow would add infrastructure without adding correctness |
| Production model registry (MLflow server) | Experiment logging writes to local JSONL; a server-based registry is correct at multi-team scale |
| Automated retraining triggers | Model is retrained on-demand; automated drift-triggered retraining requires sustained monitoring infrastructure |
| Block-level occupancy data | Not publicly available from NTES, RailRadar, or any accessible Indian Railways API |
| A/B testing infrastructure | Appropriate after multiple model versions exist in production |
| Network-wide backtest of conflict propagation | Requires paired station-event data not present in the available journey-level artifact |

> **How to handle this in Q&A:** Do not apologize for these gaps. The correct answer is: *"We built the components that prove the mathematical and algorithmic claims — the conformal calibration and the timed event graph — because UI is cheap and algorithms are hard. The three missing portals at launch are Airflow DAGs and a React developer, not unsolved research problems."*
