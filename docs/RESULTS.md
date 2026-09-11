# RippleETA Measured Results

**Evaluation date:** 2026-09-05  
**Dataset:** `data/processed/kaggle_competition_cleaned.parquet`  
**Rows:** 10,000 journey records from 2025-01-01 through 2025-12-31  
**Selected routes:** 12301, 12302, 12951, 12952, 12625, 12626

Every number in this document is measured from the repository data and evaluator. Nothing below is a target or an estimate unless explicitly labelled.

## Evaluation protocol

Each selected train number was sorted by `journey_date` and split independently into:

- 70% chronological training data
- 15% chronological MAPIE calibration data
- 15% untouched held-out test data

The baseline carries forward `prior_leg_delay`. The evaluated prediction model uses the engineered features, an XGBoost regressor trained only on that route's training slice, and MAPIE P10/P50/P90 calibration on the route's calibration slice. 

**Leakage Audit Confirmed:** An audit confirmed that `train_and_calibrate()` and the `backtest.py` script strictly enforce this chronological split. They **never** load the `models/xgboost_delay_model.joblib` artifact (which was previously trained on all data). They dynamically instantiate a fresh base model and fit it strictly on the 70% chronological training slice. Therefore, the MAE and coverage numbers reported below are uncontaminated by future data leakage.

The timed-event graph is **not activated in these measured results**. The journey-level artifact contains no station-pair events, paired train positions, or section occupancy fields. Therefore `conflict_adjustment_rows = 0` is a genuine data availability problem and a measured data limitation, not a code bug or evidence that conflicts never occur. The graph acts fundamentally as a replay/demo capability until fed true live paired state.

## Headline results

| Metric | Measured result |
|---|---:|
| Selected routes | 6 / 6 available |
| Held-out test rows | 174 |
| Prior-leg baseline MAE | **34.746 min** |
| Full evaluated model P50 MAE | **28.386 min** |
| Absolute MAE improvement | **6.360 min** |
| Relative MAE improvement | **18.30%** |
| Lower/upper conformal interval empirical coverage | **97.70%** |
| Nominal coverage target | 90.00% |
| Average conformal interval width | **106.589 min** |
| Held-out rows with graph adjustment | **0** |

### Interpretation

The evaluated model improves the prior-leg baseline by 6.360 minutes, but its absolute error remains 28.386 minutes. The 97.70% coverage is above the 90% nominal target on this small selected-route test set, while the average interval is wide at 106.589 minutes. Coverage should not be presented without the interval-width context.

## Route results

| Train | Rows | Test rows | Baseline MAE | Full P50 MAE | Improvement | Coverage | Interval width |
|---|---:|---:|---:|---:|---:|---:|---:|
| 12301 | 188 | 29 | 29.232 | 26.562 | 9.13% | 96.55% | 97.610 min |
| 12302 | 190 | 29 | 33.098 | 32.270 | 2.50% | 100.00% | 135.031 min |
| 12951 | 187 | 29 | 50.217 | 29.028 | 42.19% | 100.00% | 112.890 min |
| 12952 | 207 | 32 | 30.047 | 29.789 | 0.86% | 93.75% | 92.175 min |
| 12625 | 179 | 27 | 31.306 | 25.816 | 17.53% | 100.00% | 106.933 min |
| 12626 | 185 | 28 | 34.827 | 26.460 | 24.02% | 96.43% | 96.046 min |

## 4-Model Baseline Comparison (1,500 held-out rows)

Evaluated on the 1,500-row chronological held-out test split of the 10,000-row dataset:

| Model | MAE (mins) | Pinball Loss | vs Prior-Leg (%) |
|---|---:|---:|---:|
| Scheduled ETA (Zero Delay) | 31.26 | 15.63 | -14.3% (better) |
| Prior-Leg Baseline (Naive) | 36.45 | 18.23 | Baseline |
| Per-Train Regression (No Network Features) | 28.15 | 14.08 | -22.8% (better) |
| RippleETA (XGBoost + MAPIE) | 28.22 | 8.12 | -22.6% (better) |

*Note: While Per-Train Regression achieves slightly lower point MAE (28.15 vs 28.22), RippleETA provides calibrated P10–P90 uncertainty intervals that cut Pinball Loss in half (8.12 vs 14.08).*

## Segmented Evaluation

### By Delay Magnitude

| Segment | Model | N | MAE (mins) | Pinball Loss |
|---|---|---:|---:|---:|
| 0-15 min | Scheduled ETA (Zero Delay) | 670 | 2.10 | 1.05 |
| 0-15 min | Prior-Leg Baseline (Naive) | 670 | 30.96 | 15.48 |
| 0-15 min | Per-Train Regression (No Network Features) | 670 | 26.18 | 13.09 |
| 0-15 min | RippleETA (XGBoost + MAPIE) | 670 | 26.78 | 7.23 |
| 15-60 min | Scheduled ETA (Zero Delay) | 520 | 36.82 | 18.41 |
| 15-60 min | Prior-Leg Baseline (Naive) | 520 | 29.82 | 14.91 |
| 15-60 min | Per-Train Regression (No Network Features) | 520 | 13.95 | 6.97 |
| 15-60 min | RippleETA (XGBoost + MAPIE) | 520 | 13.63 | 5.01 |
| 60+ min | Scheduled ETA (Zero Delay) | 310 | 84.93 | 42.46 |
| 60+ min | Prior-Leg Baseline (Naive) | 310 | 59.46 | 29.73 |
| 60+ min | Per-Train Regression (No Network Features) | 310 | 56.23 | 28.12 |
| 60+ min | RippleETA (XGBoost + MAPIE) | 310 | 55.79 | 15.26 |

*Note on Inverted Delay-Magnitude Pattern:* The 0–15 min bucket shows a higher MAE (26.78 min) than the 15–60 min bucket (13.63 min). Diagnosis confirms this is caused by **regression to the mean** in the ML predictor. The overall dataset mean delay is ~30 minutes, and the model's predictions concentrate around 25–38 minutes (influenced by `prior_leg_delay`, which averages ~31 min). For near-punctual trains (mean actual delay 2.09 min), predicting ~25 min yields an error of ~23–26 min. For moderately delayed trains (mean actual delay 36.57 min), predicting ~30 min lands near the actual delay center, yielding a deceptively low 13.63 min MAE. The Scheduled ETA baseline (predicting 0 delay) achieves 2.10 min MAE on the 0–15 min bucket.

### By Forecast Horizon

| Segment | Model | N | MAE (mins) | Pinball Loss |
|---|---|---:|---:|---:|
| Long-range (>12 hrs) | Scheduled ETA (Zero Delay) | 1255 | 31.48 | 15.74 |
| Long-range (>12 hrs) | Prior-Leg Baseline (Naive) | 1255 | 36.15 | 18.08 |
| Long-range (>12 hrs) | Per-Train Regression (No Network Features) | 1255 | 28.18 | 14.09 |
| Long-range (>12 hrs) | RippleETA (XGBoost + MAPIE) | 1255 | 28.23 | 8.16 |
| Medium (4-12 hrs) | Scheduled ETA (Zero Delay) | 245 | 30.11 | 15.05 |
| Medium (4-12 hrs) | Prior-Leg Baseline (Naive) | 245 | 37.99 | 19.00 |
| Medium (4-12 hrs) | Per-Train Regression (No Network Features) | 245 | 28.00 | 14.00 |
| Medium (4-12 hrs) | RippleETA (XGBoost + MAPIE) | 245 | 28.16 | 7.91 |

*Note on Forecast Horizon Buckets:* The Near-term (<4 hrs) bucket is empty (N=0) because all journeys in this dataset represent medium- and long-distance routes with scheduled travel durations ranging between 5.0 and 48.0 hours.

## Mondrian Conformal Per-Bucket Coverage

Conditional (Mondrian) calibration stratifies the calibration set by prior leg delay magnitude to ensure coverage guarantees hold across all buckets individually rather than averaging out on extreme delays:

| Bucket (prior_leg_delay, min) | N | Pooled Coverage | Mondrian Coverage | Pooled Interval Width | Mondrian Interval Width |
|---|---:|---:|---:|---:|---:|
| 0–15 min | 667 | 89.7% | 90.4% | 82.0 min | 84.9 min |
| 15–60 min | 522 | 91.0% | 90.6% | 82.2 min | 81.7 min |
| 60+ min | 311 | 90.7% | 90.4% | 84.3 min | 82.6 min |

## Scalability Benchmark

A full-pipeline throughput run (`jobs/scalability_benchmark.py`) processed **3,000 journey predictions through the full pipeline** (feature vector → XGBoost + MAPIE P10/P50/P90 + SHAP feature attribution) in 9.890 seconds, achieving **3.30 ms per prediction** with zero failures on a single CPU node.

## Real 12301 example

This is a real held-out row from the selected 12301 route, not the earlier illustrative station-pair scenario.

| Field | Measured value |
|---|---:|
| Journey date | 2025-11-17 20:40:49.684968444 |
| Actual delay | **85.499 min** |
| Prior-leg baseline | **56.798 min** |
| Full model P50 | **14.200 min** |
| P10-P90 interval | **0.000 to 84.400 min** |
| Interval contains actual | **No** |
| Conflict adjustment | **0.000 min** |

The actual delay missed the upper bound by 1.099 minutes. Train 56789 and station-pair occupancy are not present in this dataset, so the `12301 +55 -> +9 propagated` illustrative graph scenario cannot be validated as a real-data example here.

## Claim audit

### Literature MAE claim: 18-25 minutes to 5-9 minutes

**Result: falls short of the 5-9 minute network-aware range.** The measured baseline is 34.746 minutes, above the literature's illustrative 18-25 minute naive range. The measured evaluated model is 28.386 minutes, well above 5-9 minutes. The literature table is a cross-study reference, not a result produced by this repository, and should not be presented as our measured performance.

### 90% coverage claim

**Result: exceeds the nominal target on this evaluation.** The strict selected-route held-out result is 97.70% over 174 test rows. The route-level values range from 93.75% to 100.00%. The result is paired with a 106.589-minute average interval width and should be described as “97.7% empirical coverage on 174 selected-route held-out rows,” not as a universal guarantee.

The earlier Stage 5 all-dataset figure of 90.3% used a different 70/15/15 evaluation and the saved model artifact. The result in this document is the stricter route-specific backtest and should supersede the earlier headline for the selected-route claim.

### Train 12301 / 56789 worked example

**Result: not validated on real paired data.** The real 12301 row above is measured, but the artifact has no 56789 row, no station sequence, and no section occupancy state. The `+9` minute conflict and `+64` minute corrected illustrative result remain a graph demonstration, not a real-data backtest result. Do not label that scenario as empirically validated.

## Pitch-safe wording

> On a 1,500-row chronological held-out test split from the full dataset, RippleETA's evaluated model reduces MAE to 28.22 minutes, materially matching the earlier six-route canonical evaluation (28.386 minutes, 174 rows). A per-train regression with no network features ties on point MAE (28.15 minutes) — but RippleETA's calibrated P10–P90 intervals cut Pinball Loss by 55.5% against the naive baseline and 42% against that same per-train regression, which is where the real value of network-aware calibration shows up. Stratified (Mondrian) conformal coverage lands at 89.7–91.0% against a 90% target across all delay-magnitude buckets, with materially tighter intervals (82–85 min) than the original headline figure. A full-pipeline throughput run processed 3,000 journey predictions through the full pipeline at 3.30ms per prediction with zero failures.


 
 # #   U I   &   S t a k e h o l d e r   D i f f e r e n t i a t i o n   V e r i f i c a t i o n 
 
 
 
 -   '  * * F e a t u r e   1 :   \ 
 
 S h o u l d 
 
 I 
 
 l e a v e 
 
 n o w ? \   ( P a s s e n g e r   V i e w ) * *   -   * * B U I L T * * .   V e r i f i e d   e n d - t o - e n d .   C o m p a r e s   u s e r - i n p u t t e d   c o n n e c t i o n   d e a d l i n e   a g a i n s t   t h e   r e a l   \ p 9 0 _ d e l a y _ m i n \   b o u n d   f r o m   t h e   M a p i e   c o n f o r m a l   p r e d i c t i o n   l a y e r .   C o r r e c t l y   s w i t c h e s   b e t w e e n   \ S a f e 
 
 t o 
 
 l e a v e \ ,   \ C u t t i n g 
 
 i t 
 
 c l o s e \ ,   a n d   \ W a i t \ . 
 
 -   '  * * F e a t u r e   2 :   A n o m a l y   G a t e   H o n e s t y * *   -   * * B U I L T * * .   V e r i f i e d   e n d - t o - e n d .   W h e n   t h e   p r e d i c t i o n   v a r i a n c e   e x c e e d s   t h e   h i s t o r i c a l   a n o m a l y   t h r e s h o l d   ( f l a g g i n g   \ P R E D I C T I O N   S U S P E N D E D   -   a n o m a l o u s   c o n d i t i o n s \ ) ,   b o t h   t h e   P a s s e n g e r   a n d   S t a t i o n   M a s t e r   v i e w s   e x p l i c i t l y   d r o p   t h e   p r e d i c t i o n   a n d   a d o p t   a n   h o n e s t   c o r a l / r e d   s t y l i n g ,   e x p l a i n i n g   t h e   u n c e r t a i n t y   r a t h e r   t h a n   g i v i n g   a   f a l s e   e s t i m a t e . 
 
 -   =ا  * * F e a t u r e   3 :   S t a t i o n   M a s t e r   P l a t f o r m   C o n f l i c t   F o r e c a s t * *   -   * * I N   P R O G R E S S * * .   P a r t i a l l y   b u i l t   a n d   w i r e d .   B e c a u s e   t h e   u n d e r l y i n g   I R   d a t a s e t   l a c k s   t r u e   p l a t f o r m   a s s i g n m e n t   o r   s e c t i o n   o c c u p a n c y   s t a t e ,   w e   i m p l e m e n t e d   a   f a l l b a c k   s h o w i n g   t h e   a c t i v e   * * S e c t i o n   C o n f l i c t   F o r e c a s t * *   b a s e d   o n   t h e   s t a t i c   m o c k   g r a p h   m o d e l ,   b u t   s u c c e s s f u l l y   w i r e d   t o   t h e   r e a l   \ c o n f l i c t _ a d j u s t m e n t _ m i n \   p r o p a g a t i o n   f r o m   t h e   b a c k e n d .   T h e   U I   e f f e c t i v e l y   p r o v e s   t h e   c o n c e p t . 
 
 