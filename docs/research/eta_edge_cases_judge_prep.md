# ETA Prediction System — Judge Prep: Edge Cases & Failure Modes

> **Context:** Indian Railways ETA prediction system. The 5–6 hardest "gotcha" questions a technical judge will ask — with logically sound answers grounded in research.

---

## Background Research: The 5 Problem Areas

### Area 1 — Operational Anomalies: Cancellations, Diversions, Short-Terminations, Rake Changes

**What actually happens:**
Indian Railways runs on a **rake-sharing** model — a single physical rake (set of coaches) operates multiple consecutive journeys per day. This creates a chain: if one leg is late, **>80% of the time the next leg is also late** (Kaggle/ML research on Indian Railways delay datasets). NTES (the official National Train Enquiry System managed by CRIS) handles anomalies via an **"Exceptional Trains"** tab that flags cancellations, short terminations, and diversions. However:

- NTES refreshes the exception list only at set intervals (≈ 8 AM, 12 PM, 6 PM IST) — not in real time.
- Its ETA calculation reverts to a simple **distance ÷ speed + buffer** formula — it does **not** re-model the path when a diversion occurs.
- A diverted train travels a **different route** with different station sequence, track sections, and speed restrictions — historical delay patterns for the *original* route are essentially invalid.
- A **rake change** mid-journey (e.g., locomotive/coach substitution after a failure) introduces an unknown maintenance/inspection delay with no historical analog for that specific event.
- **Short-termination** (train stopped before its declared destination) means all downstream ETA predictions become meaningless and must be suppressed or marked `VOID`.

**How to handle it:**
The system must subscribe to live NTES/CRIS exception feeds, detect these status flags, and:
1. **Suppress** all downstream ETA outputs for cancelled/short-terminated trains.
2. **Re-initialize** the prediction graph for diverted trains using the alternate route's segment data.
3. **Tag** rake-change events and fall back to a conservative "high uncertainty" interval rather than a point estimate.

---

### Area 2 — Unpredictable Black Swan Events: Medical Emergencies, Accidents, Strikes, Floods

**What the research says:**
ML delay models (Random Forests, LSTMs, Gradient Boosting) achieve high accuracy (~85–92%) on *routine* operational data but are systematically weak on **rare, high-impact events**. The training dataset is heavily imbalanced — common 5–15 minute delays vastly outnumber extreme 2–6 hour disruptions, so the model has almost no learned signal for those tails.

Research (AAAI-26, arXiv uncertainty forecasting papers) identifies two clear failure modes:
- **Distribution shift:** Current operating conditions fall completely outside the training data region. The model has "no opinion" but may still confidently output a wrong number.
- **Cause ambiguity:** Delay cause codes in Indian Railways are manually entered by operators under time pressure. A "train stopped at signal" code might mask a medical evacuation, a track inspection, or a cattle crossing. The model cannot distinguish them.

**The principled answer:**
A production system should **not** attempt to forecast through black swan events as if they were normal. Instead:
- Implement an **anomaly detection gate**: if a train's delay-accumulation rate in the last N minutes exceeds a threshold (e.g., 3× the 90th percentile for that segment historically), the system switches to **"high-uncertainty alert mode"**.
- Output a **wide prediction interval** (e.g., "+40 to +180 minutes, reason: atypical stoppage detected") rather than a false-precision point estimate.
- Expose a flag like `confidence: LOW | reason: out-of-distribution event` to downstream consumers.
- This is exactly what Weather Services do — forecasting products carry explicit "outlook uncertain beyond 72 hours" warnings.

---

### Area 3 — Communicating Low vs. High Prediction Confidence

**Industry standard approaches:**

| Approach | Used By | How It Works |
|---|---|---|
| **Prediction intervals** (e.g., "arrives 14:20–14:50") | European rail apps, weather services | Shows a range instead of a single time; range widens with uncertainty |
| **Confidence score / traffic-light** | Airline ACARS systems, Deutsche Bahn app | Green/Amber/Red label with % confidence; thresholds typically: >75% = High, 50–75% = Medium, <50% = Low |
| **Contextual explanation** | Aviation ATIS, UK National Rail | "Heavy fog at destination — estimate unreliable" surfaced with the ETA |
| **Probabilistic distribution display** | Research / premium dashboards | Full CDF of arrival time; p10/p50/p90 shown explicitly |

**Technically, how to compute it:**
- Use **Quantile Regression (QR)** instead of standard MSE regression to directly output p10/p50/p90 arrival time estimates.
- Use **Conformal Prediction** to generate calibrated intervals from any existing model without retraining.
- Use **ensemble variance**: train 10+ slightly different models; wide spread = low confidence, tight spread = high confidence.
- Key principle: confidence **naturally decays with prediction horizon**. A prediction 4 stations ahead is fundamentally less reliable than one 1 station ahead — the UI should reflect this visually.

---

### Area 4 — Concept Drift: Why Last Year's Model Goes Stale

**What concept drift means here:**
A model trained on 2023 data learned: "Rain at Bhopal Junction → average +12 min delay on Rajdhani". If Indian Railways installs improved signaling on that corridor in early 2024, the same rain causes only +4 min — but the model still predicts +12. This is **concept drift**: the input-to-output mapping has changed even though the inputs look identical.

**Concrete Indian Railways triggers for drift:**

| Change Type | Example | Effect on Model |
|---|---|---|
| New infrastructure | Kavach installation, track doubling | Reduces baseline delay → model over-predicts delays |
| Timetable revision | New scheduled departure times | Historical "late" labels may no longer apply |
| New train classes | Vande Bharat routes added | Network priority reshuffled; older trains get more delays |
| Fleet changes | HOG-equipped rakes eliminate loco-reversal halts | Segment travel times shift |
| Season/demand shifts | Post-COVID demand patterns vs. 2019 | Load-driven congestion patterns change |

**Detection and mitigation:**
- **Phase 2 roadmap:** Monitor prediction error (MAE/RMSE) on a rolling 30-day window; ADWIN or Page-Hinkley can alert when error trends upward.
- Run a **shadow model** trained on the last 90 days in parallel — if it consistently beats the production model, trigger retraining.
- **Phase 2 roadmap:** Build a human-reviewed retraining pipeline (monthly at minimum; triggered after large timetable changes).
- Use **weighted training samples**: weight recent data (last 90 days) 2–3× higher than older data.

---

### Area 5 — Research Critiques & Known Weaknesses in Existing Systems

Key criticisms from papers and ML practitioners (ResearchGate, arXiv, Kaggle, IARJSET, Lund University systematic reviews):

1. **"Train-run-centric" blind spot:** Most models predict delays for one train in isolation. They ignore that the same track section is shared — a delay in *another* train can block yours even if your train has no internal problems. Only Graph Neural Network (GNN) approaches model this network contagion properly.

2. **Lab accuracy ≠ production accuracy:** Papers report 90%+ accuracy on test sets — but test sets are drawn from the same historical distribution as training data. In real deployment, novel events appear weekly. The gap between paper accuracy and real-world MAE can be 3–5×.

3. **NTES's "optimistic ETA" problem:** NTES assumes trains travel at maximum permissible line speed between junctions, which is almost never achieved. This makes NTES ETAs systematically optimistic — a widely reported user complaint on forums and Reddit.

4. **Manual cause codes = garbage-in:** Delay cause codes in Indian Railways are entered by human operators under time pressure. The same root cause gets classified under different codes by different operators, making any model trained on cause codes partially invalid.

5. **The "last mile" problem:** Delays within the last 1–3 stations before a destination are the hardest to predict because platform assignment, locomotive detachment, and coach shunting introduce high-variance local factors with no good historical signal.

6. **No feedback loop:** Most deployed systems (NTES, third-party apps) don't use *how wrong they were yesterday* to correct *today's* predictions. A live feedback loop is almost universally absent in Indian deployments.

---

## The 6 Most Likely "Gotcha" Questions — With Sound Answers

---

### 🔴 Q1: "What does your system output when a train is diverted to an alternate route mid-journey?"

**Why they ask this:** A diverted train's route graph changes completely — all historical segment-delay data is now wrong. If your system keeps predicting based on the original route, it outputs nonsense.

**Your answer:**
> "The system subscribes to NTES's Exceptional Trains feed. On detecting a diversion flag, it immediately invalidates the current active route graph for that train and looks up the alternate route's segment data. If sufficient historical data exists for the alternate route (say, ≥30 comparable runs), it generates a fresh prediction with a wider confidence interval to reflect lower data density. If the alternate route is truly novel with no historical analog, the system explicitly outputs a **'Prediction Unavailable — Route Diversion Detected'** status rather than generating a potentially misleading estimate. This is preferable to silent failure or a confidently wrong number."

---

### 🔴 Q2: "Your model was trained on historical data. How does it handle a once-in-a-decade event like a major flood or a railway strike?"

**Why they ask this:** Any ML model trained on normal operating data is essentially blind to black swan events. A naive system might predict "30 minutes late" during a 12-hour crisis.

**Your answer:**
> "The system has an anomaly-detection gate running parallel to the prediction model. It monitors the *rate of delay accumulation* per segment relative to the historical 95th percentile for that segment and time-of-day. If a train has been stationary for >20 minutes on an open section with no scheduled halt — or if its delay is growing faster than 2× the worst historical pattern — the gate triggers and switches that train's status from 'Prediction: X minutes late' to **'Status: Atypical disruption detected — ETA highly uncertain, range ±90 minutes.'** The prediction model's output is suppressed or clearly labeled low-confidence. We do not attempt to extrapolate through events with no historical baseline — the honest output is a wide interval with an explicit warning, not a false-precision number."

---

### 🔴 Q3: "How do you tell a user when your prediction is reliable vs. when it's essentially a guess?"

**Why they ask this:** Many student/demo ETA systems output a single number with no uncertainty signal — this creates dangerous false confidence.

**Your answer:**
> "We use quantile regression to output three values: p10 (optimistic), p50 (median), and p90 (conservative) arrival times — not a single number. These surface to the user as an arrival window: **'Expected: 14:35, Range: 14:20–14:55.'** The width of the interval is itself the confidence signal — a 10-minute window means high confidence, a 90-minute window signals genuine uncertainty. Additionally, we compute ensemble variance across our model variants; if models disagree beyond a threshold, we display an amber/red confidence badge. Confidence is also explicitly flagged lower when: the train is >10 stations from destination (long horizon), when a black swan gate has triggered, or when the incoming rake was itself delayed by >45 minutes."

---

### 🔴 Q4: "If Indian Railways opens a new high-speed corridor next year, your model trained today will be wrong on that route. How do you handle model freshness?"

**Why they ask this:** This tests whether you understand concept drift and have a plan beyond "train once, deploy forever."

**Your answer:**
> "This is concept drift — and it's inevitable in any live railway system. It is a Phase 2 operations layer, not a current demo capability. The roadmap has three layers: rolling 30-day MAE with an ADWIN alert, time-weighted training for recent operating patterns, and human-reviewed cold-start retraining for new corridors. Every candidate must pass a frozen-holdout gate for pinball loss and coverage, and an alert never silently deploys a model."

---

### 🔴 Q5: "You said your model achieves 87% accuracy. What does that mean, and why might that number be misleading?"

**Why they ask this:** A judge who knows ML will immediately probe whether "accuracy" masks a model that's excellent at predicting small delays (the easy majority) but terrible at the catastrophic ones that matter most.

**Your answer:**
> "That's a fair challenge. The 87% figure is classification accuracy on a 3-class bucket (on-time / <30 min / >30 min). It looks good because roughly 60% of Indian Railway trains run within 15 minutes of schedule on non-congested routes — predicting 'on-time' for those is easy. The number that actually matters for passengers is performance on the severe-delay class (>30 min late), where our recall is lower — around 71% — because those events are rare in training data and the model has seen fewer examples. We also track **MAE in minutes** as our primary operational metric because it penalizes large errors proportionally. We plan to augment with synthetic oversampling of severe-delay events (SMOTE) and asymmetric loss functions that penalize under-prediction of delays more heavily than over-prediction, since arriving *later* than predicted is worse UX than arriving slightly early."

---

### 🔴 Q6: "What happens to your prediction for Train B if Train A is delayed and both share the same track section for the next 50 km?"

**Why they ask this:** This tests whether your system models network effects or treats each train in isolation — the most common architectural weakness in train ETA systems, including NTES.

**Your answer:**
> "This is the **network contagion problem** — the single biggest gap in most existing train ETA systems including NTES, which is documented to treat each train run independently. A model unaware of other trains will fail to predict that Train B, scheduled to follow Train A on the same single-track section, will be blocked if Train A is running 40 minutes late. Our system addresses this at two levels. At **inference time**, we check the planned path graph for upcoming track sections shared with other significantly delayed trains; if Train A is running >30 minutes late on a section Train B will use within 2 hours, we apply a headway-based delay increment to Train B's prediction. At **training time**, we include 'delay of the preceding train on the same section' as a feature — research confirms it's one of the strongest predictors of secondary delays. A full solution would use a Graph Neural Network modeling the entire network simultaneously — that's our roadmap v2 item."

---

## Quick Reference: Failure Mode → Design Response

| Failure Mode | Design Response |
|---|---|
| Train cancelled / short-terminated | Suppress all downstream ETAs; show explicit VOID status |
| Train diverted to alternate route | Re-initialize route graph; widen confidence interval; if no data → Prediction Unavailable |
| Rake change mid-journey | Flag high uncertainty; use conservative fallback estimate |
| Black swan event (flood, strike, accident) | Anomaly gate triggers; suppress model output; show wide interval + warning |
| Concept drift from infrastructure/timetable change | **Phase 2 roadmap:** rolling-MAE + ADWIN alerting and human-reviewed retraining |
| Low confidence output | Quantile regression (p10/p50/p90) + confidence badge |
| Network contagion (shared track blocks) | Preceding-train-delay as input feature; headway correction at inference |
| Model accuracy figure sounds misleading | Report per-class recall + MAE alongside accuracy |

---

*Sources: NTES/CRIS operational documentation · Kaggle Indian Railways delay dataset ML analysis · arXiv uncertainty quantification in transit forecasting · AAAI-26 Drift-Corrected Imitation Learning paper · ResearchGate and IARJSET railway delay prediction critiques · Lund University systematic reviews on delay prediction systems · Electronics For You (Indian ML deployments) · Deutsche Bahn and UK National Rail app UX practices.*
