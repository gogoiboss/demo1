# Pitch Brief: The Honest Range — Why "4:10–4:25 PM" Beats "4:17 PM"

> **Core argument:** A single precise ETA is not a more accurate answer — it is a more confident-sounding wrong answer. An honest, narrowing range is better science, better UX, and more defensible to any technically literate audience.

---

## Part 1: The Problem We're Solving — Real Complaints, Not Hypothetical

This is not a hypothetical user need. The frustration with false-precise ETAs from Indian Railways is documented, widespread, and specific.

**What NTES and third-party apps actually do:**
- NTES calculates ETA assuming maximum permissible line speed — structurally optimistic, and users have noticed.
- Data is updated manually by station staff; when a train is between two reporting stations, the app freezes at the last known status and shows "on time" even while the train is sitting still.
- Users on Reddit and Quora report the specific failure mode: *"The app showed my train arriving on time right up to 30 minutes before departure. It was actually 3 hours late."*
- NTES itself has been documented as sometimes entering optimistic data under KPI pressure, creating a gap between the displayed ETA and physical reality.
- Even Indian Railways has warned passengers not to trust private third-party apps — without acknowledging that the official system has the same problem.

**The pattern of harm:** A passenger who trusts a "14:37" ETA makes decisions — doesn't build in buffer, books connecting transport, doesn't leave early for the station. When the train arrives at 17:20, they don't just experience a delay. They experience a *decision they made based on false information*. That is a qualitatively different failure from "the train was late." It is an honesty failure in the system.

**This is the gap we're filling.** Not better ML. Honest communication.

---

## Part 2: How Weather Forecasting Solved This Exact Problem

Weather forecasting had this argument decades ago — and settled it. The evidence from that domain is directly applicable.

**The old way:** "It will rain tomorrow." A binary, confident, falsifiable claim. When it doesn't rain, the forecaster looks wrong even if their 60% estimate was correct.

**The current way:** "70% chance of rain, high of 28–32°C." A probabilistic range that is honest about what is and isn't knowable.

**What the research says (WMO, NOAA, American Meteorological Society):**
- Studies consistently show that people who receive **probabilistic forecasts make measurably better decisions** than those receiving point forecasts — from whether to carry an umbrella to whether to evacuate before a hurricane.
- *Counterintuitively*, communicating uncertainty **increases trust**, not decreases it. Users who understand that forecasts are inherently variable maintain trust in the forecasting service even when specific predictions are wrong. Users who are given confident point estimates lose trust catastrophically on the rare occasions those estimates fail.
- The WMO's official guidance (published) now recommends probabilistic communication as the standard for all public forecasting.

**The railway analogy is exact:**
| Weather Forecasting | Our ETA System |
|---|---|
| "70% chance of rain" | "80% likely to arrive 14:20–14:55" |
| Temperature range: 28–32°C | Arrival window: 4:10–4:25 PM |
| "Uncertainty cone" for hurricane tracks | Interval widens when train is far away |
| Storm warning: "Forecast unreliable beyond 72h" | Alert: "Atypical delay — prediction paused" |

The weather forecasting community spent 40 years proving that honesty about uncertainty makes forecasting more useful, not less. We don't need to re-prove it. We just need to apply the lesson.

---

## Part 3: What the Transport Industry Already Knows

### Ride-hailing (Uber/Lyft): The "3–7 minutes" decision

Uber and Lyft made a deliberate, documented UX decision to show **ranges instead of point estimates** for driver arrival times. The reasoning, from their own published engineering and UX research:

- A narrow range that proves accurate (e.g., "3–7 min," driver arrives in 5) builds trust.
- A precise number that is missed (e.g., "4 minutes," driver arrives in 7) destroys trust disproportionately.
- Users report **higher satisfaction with wider accurate ranges than with precise inaccurate estimates**.
- The specific finding: *"passengers prioritize accuracy over precision"* — they'd rather know the truth is "somewhere in a 4-minute window" than be told a single number that turns out to be wrong.
- Lyft's published engineering blog confirms: ranges reduce the "cancellation loop" — users who are given tight estimates cancel rides when drivers don't appear within that window, even if they would have arrived shortly.

### Airlines: What they do and don't do

Flight tracking apps (FlightAware, Flightradar24) do *not* currently show confidence ranges — they show a continuously updated single ETA. The gap: these estimates are accurate when the flight is in the air and normal, but become unreliable during disruptions — which is exactly when passengers need the information most. Airlines themselves know this; they withhold ETAs during crew or mechanical issues rather than communicate uncertainty, which passengers experience as the "information vacuum" and find even more frustrating.

**The gap in aviation is an opportunity for railways:** there is no incumbent doing uncertainty communication well in transport. The field is open.

---

## Part 4: What the Research Says About How People Use Ranges vs. Point Estimates

**The core behavioral finding** (across psychology, statistics, and decision science research):

A confidence interval (a range) communicates *two things* simultaneously: the best estimate **and** the reliability of that estimate. A point estimate communicates only the first. In every domain where risk matters — medicine, finance, engineering — experts prefer intervals precisely because the *width* of the interval is itself useful information.

For ETA specifically:
- A **narrow interval** (e.g., 4:10–4:15 PM) tells the stakeholder: act precisely. Book the pickup for 4:10. The crew controller should sign on the relief crew now.
- A **wide interval** (e.g., 3:45–5:30 PM) tells the stakeholder: keep options open. Don't commit the platform. Don't dispatch the hotel pickup yet.

A point estimate — no matter how accurate on average — provides **no signal for when to trust it versus when to hedge**. That signal is the interval width, and it is not available in any current Indian Railways ETA system.

**The trust dynamic (behavioral research):**
- When a point estimate is wrong: *"The app lied to me."* Trust destroyed.
- When a range is wide and then the train arrives within it: *"The app was honest about the uncertainty, and it was right."* Trust built.
- When a range is wide and the train is earlier than the pessimistic bound: *"Even better than expected."* Positive surprise.

The psychological asymmetry matters: **being more conservative than reality is forgiven; being more optimistic than reality is remembered as a lie.**

---

## Part 5: How We Generate the Honest Range — A Plain-English Explanation

The technical approach that's both simple and explainable (not a black box):

### The core idea: remaining unresolved risk

A train's ETA uncertainty is not random — it has identifiable structure. The uncertainty is large when:
1. The train is many stations away (more opportunities for something to go wrong)
2. The train is sharing track sections with other delayed trains (network risk)
3. The train has already accumulated significant delay (recovery is unlikely)
4. The train is approaching a zone boundary or crew changeover point (structured risk event)

The uncertainty is small when:
1. The train is 1–2 stations away (limited remaining exposure)
2. The current section is clear (no cross-traffic risk)
3. The delay has been stable for the last 30 minutes (trend is predictable)

**Conformal Prediction — the honest interval with a statistical guarantee:**

We use a method called Conformal Prediction, which works as follows (explainable to a non-technical judge):

> "We looked at how wrong our model has been in the past, for trains in similar situations. For a train that's 8 stations away with a 20-minute delay, we measured our historical errors and found the 90th percentile error was 18 minutes. So we say: 90% of the time, the actual arrival falls within our estimate ± 18 minutes. As the train gets closer, we only look at historical errors for trains in that closer-range situation — and those errors are smaller. So the interval gets narrower. It's not a guess about how uncertain we are. It's a measurement of how uncertain we've historically been, in situations like this one."

This is explainable, verifiable, and provably calibrated — meaning if we say "90% confidence," then 90% of the time, the true arrival is inside the range. That's a property no single-number system can claim.

**Visualizing the narrowing:**
```
10 stations away:  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━  (wide — plan loosely)
5 stations away:   ━━━━━━━━━━━━━━━━           (moderate — book pickup)
2 stations away:   ━━━━━━━━                 (narrow — commit platform)
1 station away:    ━━━━                   (tight — announce to passengers)
```

The narrowing is not magic — it is simply *having less remaining uncertainty* as fewer future events can intervene. This is logically self-evident, not model-dependent.

---

## Part 6: The Pitch Narrative — How to Deliver This

### Opening frame:
*"Every train tracking app in India shows you a time. NTES shows you 14:37. 'Where is My Train' shows you 14:37. They are all showing you a number that implies a precision that doesn't exist — and when they're wrong, which is often, they've broken your trust rather than managed your expectations. We built something different."*

### The weather analogy (30-second version):
*"Nobody looks at a weather app that says '70% chance of rain' and thinks it's worse than one that says 'It will rain.' The range is more honest, and people trust it more precisely because it's honest. Our ETA system works the same way. When a train is 10 stations away, we say '3:45–4:30 PM' — a wide window that tells you to plan loosely. When it's 1 station away, we say '4:14–4:19 PM' — a tight window that tells you to walk to the platform now."*

### The Uber comparison (15-second version):
*"Uber shows you '3–7 minutes.' They made that change deliberately because research showed users trust accurate ranges more than precise-sounding wrong numbers. We're doing the same thing for railways, where the stakes are much higher."*

### The operational argument (for technical judges):
*"A 10-minute confidence window is operationally useful in a way a single number never is. A station master who knows the train is arriving in a 10-minute window can commit a platform. The same station master with a 60-minute window knows not to commit — and that decision avoidance itself saves platform conflicts. The width of the interval is not just information — it is an instruction."*

### The closing differentiator:
*"Other teams will show you accuracy metrics. We'll show you calibration: for every range we give, we can tell you what percentage of trains actually arrived within that range. That's a different and more meaningful claim. We're not trying to be the most accurate — we're trying to be the most honest and therefore the most trustworthy."*

---

## Evidence Summary: Sources for Your Pitch

| Claim | Source |
|---|---|
| Probabilistic forecasts improve decision quality | WMO, NOAA, American Meteorological Society research |
| Communicating uncertainty increases, not decreases, trust | WMO official guidance; AMS peer-reviewed studies |
| Users prefer accurate ranges over precise wrong numbers | Uber/Lyft engineering research; transit UX studies (kobv.de) |
| NTES shows "on time" when trains are hours late | Reddit, Quora user reports; NTES manual-update architecture |
| NTES uses maximum permissible speed, making it structurally optimistic | Documented in Indian Railways technical press (Electronics For You) |
| Conformal prediction gives statistical coverage guarantee | arXiv, Towards Data Science, MAPIE/StatsForecast libraries |
| Prediction intervals naturally widen with horizon | Standard time-series forecasting literature (Hyndman, otexts.com) |
| Operational staff trust explainable outputs more | Human factors research; operational forecasting adoption studies |

---

*Built on: WMO probabilistic forecasting guidelines · NOAA uncertainty communication research · American Meteorological Society trust studies · Uber/Lyft ETA range UX research · Conformal Prediction literature (arXiv, MAPIE) · Indian Railways NTES complaint corpus (Reddit/Quora) · Behavioral decision-making research on confidence intervals*
