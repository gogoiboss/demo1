# Multi-Stakeholder ETA System — Logical Decomposition

> **Framing:** For each stakeholder, the question is: *what binary or discrete choice do they make*, and *what information, if available earlier or more accurately, changes the outcome of that choice*? Not a feature list — a decision tree.

---

## Stakeholder 1: Station Controller / Station Master

### The actual decision
**Which physical platform line to route an incoming train to, and whether to hold, pass, or cross other trains at the same time.**

This is not a single decision — it is a sequence of nested decisions with hard physical constraints:

1. **Line assignment decision** (made 30–60 min before arrival at major junctions): Which platform track is free when this train arrives? If the "expected" platform is occupied by a delayed train, the SM must assign an alternate line — which may require routing the incoming train over a different set of points, potentially conflicting with another departure.

2. **Hold-or-pass decision** (ongoing): If Train A is 40 minutes late and Train B (lower priority) is on time, does B get cleared through first, or does the SM hold B to keep platform space available for A when A recovers? This depends entirely on how confident the SM is in A's ETA.

3. **Cascade containment decision**: If A's delay is large enough to trigger a conflict at the next junction (because a connecting train has a tight window), the SM flags the section controller to pre-emptively re-sequence traffic.

### What limits this today
- NTES ETA assumes maximum permissible line speed — it is **structurally optimistic**. SMs know this and mentally apply a correction factor, but it's informal and varies by individual.
- Platform allocation is announced only **30–40 min before arrival** at busy junctions — not because this is optimal, but because the SM doesn't have reliable enough ETA to commit earlier.
- There is no standard signal for "this ETA has ±5 min confidence" vs "this ETA has ±45 min confidence." The SM treats all ETAs as equally uncertain.

### What changes if ETA error is known

| ETA error magnitude | SM decision impact |
|---|---|
| ±5 min (high confidence) | SM can commit platform 45–60 min out; announce to passengers; position porter gangs |
| ±15 min (moderate) | SM commits platform but withholds public announcement; keeps alternate line available |
| ±45 min (low confidence) | SM cannot commit platform; holds the line in reserve, blocking it from other trains — **this is the hidden cost of uncertainty** |
| ETA flagged as "atypical / unreliable" | SM escalates to section controller to re-plan the line occupation schedule for the next 2 hours |

### Minimum useful information (not a dashboard)

> **One number + one flag, delivered 60–90 minutes before expected arrival:**
> `ETA: 14:35 | Confidence window: ±8 min | Status: Normal`
> vs.
> `ETA: 15:10 | Confidence window: ±40 min | Status: Atypical — do not commit platform`

The SM doesn't need a chart. They need to know: **"Is this ETA reliable enough to commit a platform line right now?"** That is a yes/no decision driven by the width of the confidence interval, not the ETA itself.

---

## Stakeholder 2: Crew Scheduling / Crew Controller (Loco Pilot Relief)

### The actual decision
**Whether to sign on a relief crew now, or wait — and where to position them.**

Under HOER Rules 2005, a loco pilot's continuous duty is capped at **9 hours** (standard) or up to **12 hours** in exceptional cases, with a mandatory **2-hour advance notice** required before requesting an extension beyond the 11-hour limit. The Crew Management System (CMS) tracks sign-on time and projects when each running crew will exhaust their hours at current speed.

The crew controller's decision chain:

1. **Sign-on timing decision**: Relief crew must sign on (physically report to the lobby) such that they arrive at the relief point *before* the running crew hits their hour limit. Signing on too early wastes rest (the relief crew burns their own rest hours waiting). Signing on too late risks a "crew short" situation.

2. **Positioning decision**: The relief crew must physically travel to the changeover station. If it's a junction 45 minutes away by road, the controller must dispatch the reliever at least 45 min before the train's arrival at that point.

3. **Fallback decision**: If the running crew will exhaust hours before reaching the planned relief point, the controller must either (a) arrange an emergency stop at an intermediate station for relief, or (b) invoke the HOER emergency extension — which requires documented justification and exposes the railway to safety liability.

### What "running out of hours" actually costs

- A crew that exhausts HOER hours and cannot legally continue **must stop the train** at the nearest station or signal. The train then waits until a relief crew arrives — which can take 1–4 hours at non-junction locations. This is not a theoretical risk: union documents (AILRSA) report it is a recurring operational reality, often concealed by CMS entries that are backdated to avoid showing HOER violations.
- Every such event blocks the track section, cascading delays to 5–15 trains behind it on the same line.
- The average crew changeover point serves multiple trains per day; a single botched relief can disrupt the rest of the day's scheduling for that section.

### What limits this today
The CMS tracks actual sign-on times but relies on **scheduled ETA** (not predicted ETA) to project when the crew will reach their relief point. If the train is running 90 minutes late, the CMS may not automatically flag that the relief crew signed on 3 hours ago and will themselves be approaching their rest-entitlement limit by the time the train arrives.

### Minimum useful information

> **For each running crew, one trigger alert, no interface required:**
> `Train 12301 | Running crew signed on: 06:30 | Current delay: +55 min | Projected arrival at relief point (Mughal Sarai): 13:40 | Crew hours remaining at that point: 1.5 hr | ⚠ Relief crew must sign on by 11:45`

The crew controller does not need a map or trend chart. They need: **"By what time must I dispatch the relief crew, given the train's current trajectory?"** This is a single computed timestamp, recalculated every 30 minutes as the train's position updates.

The critical difference from today: **current systems compute relief timing from scheduled arrival; the minimum viable improvement is computing it from predicted arrival with confidence bounds**, so the controller knows whether to dispatch early (pessimistic scenario) or can safely wait.

---

## Stakeholder 3: Feeder Transport / Last-Mile Logistics

### What "feeder transport" actually means in this context

Three distinct sub-segments with different decision structures:

**A. State-run connecting buses** (e.g., KSRTC, MSRTC buses timed to meet trains at junction stations): These run on fixed schedules. The bus dispatcher's decision is binary — **does the bus wait for the delayed train, or does it depart on schedule and leave passengers stranded?** Waiting has a cost (the bus is late for its next pick-up); leaving has a cost (passengers miss the connection).

**B. Hotel/resort pickup vehicles**: These are dispatched from a fixed location. The dispatcher decides **when to send the vehicle to the station**. Too early = vehicle and driver wait idle. Too late = arriving passengers wait, which is a service failure. The decision window is typically 30–60 min before expected arrival.

**C. Connecting trains** (tight interchange, same station): The station master / section controller decides whether to hold a connecting train for delayed passengers. This is a network-level decision, not a logistics-provider decision, but it has the same information dependency.

### What currently happens

There is no automated synchronization between Indian Railways ETAs and any of these services. Feeder providers (bus operators, hotels, tour operators) either:
- Dispatch at the **scheduled arrival time** (cheapest, highest miss rate)
- Dispatch at **scheduled + fixed buffer** (e.g., "we always go 30 min after scheduled time") — a heuristic
- Monitor NTES manually and dispatch based on a human reading of the situation

The documented pain point: because NTES ETAs are structurally optimistic and updated infrequently, providers who trust them tend to **arrive early and wait**, incurring idle cost. Providers who have learned not to trust NTES use a larger fixed buffer — which means passengers arriving on time wait for their pickup.

### Minimum useful information

**For bus dispatcher (connecting bus decision):**
> `Train 16526 expected at Mysuru Jn: 21:30 ± 12 min | Bus cutoff for departure: 21:55`
> Decision output: Bus waits. If window were ±40 min, dispatcher would have to choose between waiting indefinitely or leaving.

The dispatcher needs: **"Is the train going to arrive before my fixed departure cutoff?"** That is a probability estimate, not an ETA. Specifically, `P(arrival before 21:55)` — if that probability is >80%, wait; if <40%, depart; between 40–80%, dispatch early and communicate with passengers.

**For hotel pickup dispatcher:**
> `Train ETA: 14:20 | Confidence: ±6 min | Drive time from hotel: 22 min → Dispatch by 13:52`

They need: **dispatch trigger time = ETA − drive_time − buffer**, where buffer scales with ETA uncertainty. Wider uncertainty → dispatch earlier → more idle time, but less miss risk. The value of a tighter ETA window is literally measurable in idle driver-hours saved.

---

## Stakeholder 4: Cleaning / Turnaround Operations (Terminating Station)

### The actual decision
**When to deploy the cleaning gang to the pit/washing line, and whether to start primary or secondary maintenance.**

Indian Railways has two maintenance tiers:
- **Primary maintenance**: minimum 6 hours at the home coaching depot. Involves full inspection + deep clean of all coaches. Rake is taken off service.
- **Secondary maintenance**: ~3 hours at the terminating end. Lighter clean, basic technical checks. Rake returns to service.

The decision tree at a terminating station:

1. **Primary vs. secondary decision**: If the train is going to be at the terminus for ≥3 hours, secondary maintenance is scheduled. If it arrives so late that turnaround time shrinks below 3 hours, the maintenance supervisor must either (a) rush the secondary maintenance — which degrades quality and risks CAG audit failures on cleanliness — or (b) delay the outward departure, cascading into the next rake cycle.

2. **Gang deployment decision**: The cleaning gang (10–20 workers for a 24-coach Rajdhani) must be at the pit line when the rake arrives. Too early = idle wage cost. Too late = compressed turnaround.

3. **Pit line slot reservation**: At busy terminating stations (Mumbai CST, Howrah, Chennai Central), pit lines are a shared resource. If Rake A arrives late, it occupies a pit line that was allocated to Rake B. The maintenance supervisor must renegotiate the sequence — or approve overtime.

### What early vs. late arrival actually costs

**Early arrival (train arrives before expected):**
- If the cleaning gang was dispatched based on ETA and the train arrives 40 min early, the gang has not yet arrived → the rake sits on the platform or pit entry without maintenance → departure is delayed or maintenance is skipped.
- Platform occupation extends, blocking incoming trains.

**Late arrival (train arrives after expected):**
- Turnaround window shrinks. For a rake with 3 hours scheduled and 75-minute late arrival: only 1 hr 45 min left for a 3-hour job.
- Supervisor choice: rush maintenance (quality risk) or hold departure (punctuality cost to next run).
- If late arrival pushes into a shift boundary, overtime wages are triggered.

### Minimum useful information

> **For cleaning gang supervisor, 2–3 hours before expected arrival:**
> `Train 12625 arrives terminus at: 06:40 | Confidence: ±15 min | Turnaround window before next departure (08:10): 90 min`
> Flag: `⚠ Window below 3-hour secondary maintenance minimum — request schedule intervention or authorize compressed protocol`

The supervisor needs: **"Will I have enough time to complete standard maintenance before this rake needs to depart again?"** This requires two numbers: (1) predicted arrival time + confidence, and (2) next scheduled departure of the same rake. The system can compute `available_window = next_departure − p90_arrival` and flag if it falls below threshold.

Early arrival is actually *not* a problem if the gang can be notified in time to arrive earlier. The real cost of early arrival is **notification failure** — which is today's default because the gang is dispatched based on scheduled time, not predicted time.

---

## Stakeholder 5: Passenger

### The actual decision
Passengers make several layered decisions, each with a different minimum information requirement:

| Decision | When made | What they actually need |
|---|---|---|
| **Do I leave home now?** | 60–90 min before scheduled departure from origin | Is my train running on time? Yes/No + rough delay |
| **Which platform do I go to?** | Arriving at station | Platform number (confirmed or provisional) |
| **Do I wait or make alternate arrangements?** | Train already delayed, at station | Expected delay + trend: "is it getting worse or stabilizing?" |
| **Will I make my connection?** | On board, approaching interchange | Will I arrive before my connecting train departs? |

### What passengers don't need (and what overloads them)
Passengers do not need — and are not equipped to act on — raw confidence intervals, p10/p50/p90 distributions, or ensemble variance scores. What they need is a **decision-supporting statement**, not a statistical output:

- Instead of: `ETA 14:35, confidence interval ±22 min`
- Say: `Likely to arrive between 14:15 and 14:55. Current trend: delay stabilizing.`

- Instead of: `Ensemble variance: high`
- Say: `Arrival time uncertain due to unscheduled stop. Next update in 15 minutes.`

### Minimum useful information

> **Three facts, updated every 15–20 min:**
> 1. Current delay in plain minutes (not a clock time — "running 45 min late" not "ETA 17:23")
> 2. Trend: improving / stable / worsening
> 3. Next update time (so they stop compulsively checking)

The third item is underrated. Passengers' core frustration is not inaccuracy — it is the **feeling of information vacuum**. Committing to "next update at 16:45" changes the psychological experience even if the information itself hasn't changed.

---

## Summary: Stakeholder → Decision → Minimum Information Needed

| Stakeholder | The Decision | Current Limiter | Minimum Information Needed |
|---|---|---|---|
| **Station Controller / SM** | Which platform line to commit, and when | NTES ETAs are structurally optimistic; no confidence signal | `ETA + confidence window`, 60–90 min out; binary flag: "safe to commit platform now?" |
| **Crew Controller** | When to sign on relief crew and where to position them | CMS uses scheduled ETA, not predicted ETA, to compute relief timing | `Projected crew-hours-remaining at relief point`, updated every 30 min; auto-computed "latest sign-on deadline" |
| **Feeder Transport** | When to dispatch vehicle / whether bus waits or departs | No feed exists; providers use fixed buffers or manual NTES polling | `P(arrival before cutoff time)` — a single probability, not an ETA; or ETA ± uncertainty for dispatch trigger calculation |
| **Cleaning / Maintenance Supervisor** | Can standard maintenance be completed in the available window? | Gang dispatched on schedule, not predicted ETA; no turnaround window alert | `p90_arrival` (pessimistic bound) + `available_window = next_departure − p90_arrival`; flag if below threshold |
| **Passenger** | Leave home / wait / make alternate plans / catch connection | NTES gives a single time with no trend or confidence; updates too infrequent | Current delay in minutes + trend direction + time of next update |

---

## Cross-Cutting Insight: The Real Value Is Error Bounds, Not Better ETAs

The table above reveals something non-obvious: **most operational stakeholders already have an ETA** (from NTES or CMS schedule). What they lack is a reliable **error bound** on that ETA. The station master, crew controller, maintenance supervisor, and feeder dispatcher all make decisions that are essentially bets on whether actual arrival will fall within a range — not what the point estimate says.

A system that outputs `ETA 14:35 ± 8 min` is **qualitatively more useful** to every operational stakeholder than a system that outputs a more accurate but still point-estimate `ETA 14:38`. The actionable unit is the interval, not the point. Passengers are the only stakeholder who need the point estimate translated into plain language — everyone else benefits directly from calibrated uncertainty bounds.

---

*Sources: HOER Rules 2005 (Railway Board) · Indian Railways HOER circular analysis (AILRSA union documents) · CMS operational practice (PIB, Quora operational accounts) · Platform allocation protocols (Station Master operational manuals, CAG audit reports) · Pit line maintenance timelines (ICF/LHB coaching depot guidelines) · Feeder transport gap (ORF report on last-mile rail connectivity, IRCTC connecting journey documentation) · Cleaning gang operations (Railway maintenance SOPs, CAG cleanliness audit findings)*
