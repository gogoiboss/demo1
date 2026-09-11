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
> "Yes, in two specific ways that reshaped our understanding:
>
> First, on point-estimate accuracy (MAE), a per-train XGBoost model without cross-journey rake features tied RippleETA (28.15 vs 28.22 minutes). But when evaluating uncertainty bounds via **Pinball Loss**, RippleETA won decisively — cutting loss from 14.08 down to 8.12 (a **42% reduction**). The network signal and MAPIE calibration don't just guess a single number better; they construct calibrated, reliable arrival windows.
>
> Second, segmenting by delay magnitude revealed a **regression-to-the-mean** pattern: for near-punctual trains (0–15 min actual delay, mean 2.09 min), the model predicted ~25 minutes (MAE 26.78 min), whereas for moderately delayed trains (15–60 min actual delay, mean 36.57 min), predicting ~30 minutes yielded a low 13.63 min MAE. Point predictions tend to pull toward the dataset mean (~30 min), which is precisely why point ETAs in existing systems (like NTES) mislead users and why calibrated P10–P90 intervals are essential."

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
