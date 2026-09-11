# RippleETA — Judge Q&A Reference Document

> **For judges, reviewers, and hackathon evaluators.**
> Technical Q&A grounded in empirical evaluation results from the 10,000-row dataset, 1,500 held-out test split backtests, and system benchmarks.

---

## Technical & Architecture Q&A

### 🔴 Q8. "Does global 90% coverage hide worse performance for severely delayed or specific train buckets?"

**Answer:**
> "We specifically tested for this using **Mondrian (conditional) conformal calibration**, stratifying our 1,500-row held-out test split by delay magnitude. The empirical results show that coverage holds consistently across all buckets:
> - **0–15 min bucket (N=667):** 90.4% coverage (average interval width 84.9 min)
> - **15–60 min bucket (N=522):** 90.6% coverage (average interval width 81.7 min)
> - **60+ min bucket (N=311):** 90.4% coverage (average interval width 82.6 min)
>
> Pooled calibration had a minor 89.7% coverage on low-delay trains, but Mondrian calibration guarantees that no single delay magnitude bucket falls below the target 90% statistical coverage floor."

---

### 🔴 Q11. "How does your model compare against standard ML baselines? Did network-aware features actually improve point prediction accuracy?"

**Answer:**
> "On a 1,500-row chronological held-out test split, we evaluated four distinct models:
> 1. **Scheduled ETA (Zero Delay):** MAE 31.26 min, Pinball Loss 15.63
> 2. **Prior-Leg Baseline (Naive persistence):** MAE 36.45 min, Pinball Loss 18.23
> 3. **Per-Train Regression (No Network/Rake Features):** MAE 28.15 min, Pinball Loss 14.08
> 4. **RippleETA (Full XGBoost + MAPIE):** MAE 28.22 min, Pinball Loss 8.12
>
> On **point MAE**, Per-Train Regression and RippleETA are essentially tied (28.15 vs 28.22 minutes). However, on **Pinball Loss** (which measures quantile calibration quality across P10, P50, and P90), RippleETA achieves an **8.12 Pinball Loss** — a **55.5% reduction** against the naive baseline and a **42% reduction** against the uncalibrated per-train regression. Point estimates alone miss the risk profile; calibrated prediction intervals are where network-aware uncertainty modeling delivers its primary value."

---

### 🔴 Q16. "Can this scale to the entire Indian Railways network operating 3,000+ daily passenger trains?"

**Answer:**
> "Yes. We ran a full-pipeline scalability benchmark (`jobs/scalability_benchmark.py`) processing **3,000 journey predictions through the full pipeline** (feature vector construction → XGBoost prediction → MAPIE conformal interval calculation → SHAP feature attribution generation).
>
> Results on a single standard CPU node:
> - **Throughput:** 3,000 journey predictions in 9.890 seconds
> - **Latency:** **3.30 ms per prediction**
> - **Success Rate:** 3,000 / 3,000 (0 failures)
>
> The system's stateless serving architecture and vectorized timed-event graph engine scale horizontally and comfortably handle national coaching traffic without requiring high-end GPU infrastructure."

---

### 🔴 Q46. "Did your baseline comparison surprise you at all? Did the network model actually help?"

**Answer:**
> "Yes — and there's a real bias worth naming directly rather than glossing over: the model over-relies on `prior_leg_delay` as a static value, so for trains that actually recover and run close to on-time, we systematically overpredict — averaging roughly 25 minutes predicted against roughly 2 minutes actual for that segment. We're not going to call that a minor footnote: it's our largest single bucket, 670 of 1,500 test rows, about 45% of the entire test set. What limits the real-world damage is that this is exactly the failure mode calibrated intervals exist to handle — the P10 bound on these predictions runs meaningfully lower than the P50 point estimate, and the bucket's Pinball Loss (7.23) stays close to our overall average and far ahead of any point-estimate-only baseline on the same segment. The fix we'd prioritize next isn't a bigger model — it's an explicit recovery feature: something that tells the model when a train has already started closing the gap on its inherited delay, rather than treating prior-leg delay as fixed all the way through the journey."


---

### 🔴 Q47. "Is the Crew Controller's DISPATCH NOW / PREPARE RELIEF badge using real crew roster data?"

**Answer:**
> "No, and the UI now says so directly rather than leaving it implied. That badge is driven by an illustrative duty-elapsed estimate — a formula anchored to the predicted delay, not a real crew sign-on time — because no Crew Management System (CMS) integration exists in this prototype; there's no live source for when a specific crew's duty actually began. We flagged this ourselves in an internal audit pass and made a deliberate choice: rather than either quietly leaving the badge looking like live operational data, or attempting a rushed real-data replacement under Round 2 time pressure that would still have gaps (the duty-timeline visualization and risk matrix have no real substitute without actual CMS data), we added a visible '⚠ ILLUSTRATIVE HOER ESTIMATE — NOT LIVE CMS / CREW SIGN-ON DATA' label directly on the decision card and the multi-train dispatch board. What *is* real on this page: the secondary `relief_dispatch_deadline` clock, computed server-side from the calibrated P90 delay (`now + max(15, 120 - P90)`) — the same pattern described in Q3 above — is genuine, just not yet what drives the primary badge. Promoting it to drive the badge, and removing the illustrative math underneath the timeline and risk matrix, is scoped as a concrete post-Round-2 improvement, not attempted this round."

---

## Operational & Edge Case Q&A

### 🔴 Q1. "What happens when a train is diverted or cancelled?"

**Answer:**
> "The system monitors status feeds for exceptional train events. For cancellations or short-terminations, downstream predictions are immediately suppressed and set to `VOID`. For diversions, the graph re-initializes on the alternate route if historical data exists; if data is novel, the system outputs `PREDICTION SUSPENDED — anomalous conditions` rather than giving a false-precision point estimate."

---

### 🔴 Q2. "How do you handle black swan events like severe weather or accidents?"

**Answer:**
> "RippleETA incorporates an **Anomaly Gate** that tracks rolling prediction variance against historical baselines. When variance exceeds 3× historical baseline, point predictions are dropped and the system displays an explicit warning badge (`PREDICTION SUSPENDED — anomalous conditions`) along with a widened interval, ensuring operational transparency."

---

### 🔴 Q3. "How do stakeholders interpret the P10 / P50 / P90 output?"

**Answer:**
> "Different stakeholders consume different slices of the same calibrated distribution:
> - **Passengers:** Get the P50 point ETA + P10-P90 window + connection risk badge (e.g. 'Cutting it close').
> - **Station Masters:** Get a platform commitment recommendation (COMMIT vs DEFER) based on whether the P90 arrival falls within the conflict threshold.
> - **Crew Controllers:** Get a dispatch deadline calculated from the conservative P90 ETA to prevent HOER violation cascades."
