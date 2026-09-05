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

The timed-event graph is **not activated in these measured results**. The journey-level artifact contains no station-pair events, paired train positions, or section occupancy fields. Therefore `conflict_adjustment_rows = 0` is a measured data limitation, not evidence that conflicts never occur.

## Headline results

| Metric | Measured result |
|---|---:|
| Selected routes | 6 / 6 available |
| Held-out test rows | 174 |
| Prior-leg baseline MAE | **34.746 min** |
| Full evaluated model P50 MAE | **28.386 min** |
| Absolute MAE improvement | **6.360 min** |
| Relative MAE improvement | **18.30%** |
| P10-P90 empirical coverage | **97.70%** |
| Nominal coverage target | 90.00% |
| Average P10-P90 interval width | **106.589 min** |
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

> On six selected train IDs and 174 chronological held-out journeys, our engineered XGBoost plus MAPIE evaluation reduced prior-leg baseline MAE from 34.746 to 28.386 minutes, an 18.30% reduction. P10-P90 intervals contained the actual delay in 97.70% of cases, with a 106.589-minute average width. Station-pair conflict propagation was not measured because the available journey-level artifact lacks paired station-state data.
