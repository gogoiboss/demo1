# Data Sources Notes — RippleETA

> **Last updated**: 2026-09-04

---

## 1. Data Sources: What Each Gives Us (and Doesn't)

### A. Kaggle "Indian Railways: Predict Train Delay" (Competition Dataset)

| Aspect | Detail |
|---|---|
| **Records** | ~1.5 million journey records |
| **Gives us** | Scheduled travel hours, distance (km), zone congestion index, weather factors (monsoon flag, fog risk), rolling stock details (coach count, loco age), binary delay target (>15 min) |
| **Doesn't give** | Per-station arrival/departure times, continuous delay in minutes (only binary >15min), rake ID / physical consist linkage, real GPS coordinates, route section granularity |
| **Use for** | ML model training and backtesting; understanding feature importance |

### B. Kaggle "Indian Railways Train Delays Dataset 2025"

| Aspect | Detail |
|---|---|
| **Records** | Per-train, per-station aggregated stats |
| **Gives us** | Average delay (minutes), % right-time arrivals, delay severity breakdowns, station-level detail |
| **Doesn't give** | Individual journey records (aggregated only), rake/consist linkage, real-time data |
| **Use for** | Route-specific delay pattern analysis; validating which trains/routes have most delay variability |

### C. data.gov.in — Static Timetable

| Aspect | Detail |
|---|---|
| **Records** | All trains × all stations (scheduled times) |
| **Gives us** | Scheduled arrival/departure for every halt, cumulative distance from origin, station sequence |
| **Doesn't give** | Anything dynamic — no actual running times, no delays, no real-time data |
| **Use for** | Baseline "expected" times; deriving remaining schedule buffer; computing implicit slack per section (scheduled section time − distance ÷ MPS) |

### D. RailRadar API (Live)

| Aspect | Detail |
|---|---|
| **Free tier** | ~1,000 requests/month |
| **Gives us** | Real-time delay (minutes per station), current position (lat/lng — crowd-sourced), route as GeoJSON polyline, scheduled vs actual times |
| **Doesn't give** | Historical data (live only), buffer/slack time, official RTIS GPS position |
| **Use for** | Live demo feed; map visualization; real-time ETA updates during demo |
| **Caveat** | GPS is crowd-sourced from passenger app users — accuracy proportional to app penetration on that train. Popular routes (Rajdhani, Shatabdi) have better coverage. |

### E. NTES (National Train Enquiry System)

| Aspect | Detail |
|---|---|
| **Gives us** | Per-station actual arrival/departure, current delay, last reported station, platform number |
| **Doesn't give** | GPS coordinates, speed/velocity, historical data (current-day only), buffer/slack time |
| **Access** | No public API — scraping only, fragile, rate-limit to ~1 req/5 sec |
| **Use for** | Ground truth validation (with caveats — NTES itself has 5–15 min manual-entry lag and documented data quality issues per CAG audit) |

---

## 2. What Must Be Simulated / Derived

| Missing Data | Approach |
|---|---|
| Buffer/slack time per section | Derive: `scheduled_section_time − (distance ÷ section_MPS)` |
| Section MPS | Assume by train category: Rajdhani ~130 km/h, Mail/Express ~110 km/h, Superfast ~100–120 km/h |
| Rake linkage (for rake-inheritance feature) | No public dataset has rake IDs. Derive from turnaround patterns: train 12301's rake typically becomes 12302 at the terminal. Use domain knowledge from Indian Railways rake-link charts. |
| Real-time TSRs | Cannot obtain publicly. Proxy via `section_avg_speed < 0.85 × scheduled_speed` |
| Weather at section level | Use OpenWeatherMap free tier by station lat/lng |

---

## 3. Selected Backtesting Routes

Based on research recommendations and data availability:

| # | Train | Route | Why Selected |
|---|---|---|---|
| 1 | **12301/12302** Howrah Rajdhani | NDLS ↔ HWH (1,422 km) | Extremely popular → best RailRadar crowd-GPS coverage; runs through heavily congested Delhi–Howrah HDN corridor (76% sections >100% capacity utilisation); daily service = most historical data points |
| 2 | **12951/12952** Mumbai Rajdhani | NDLS ↔ BCT (1,322 km) | Parallel Western DFC now operational → can test capacity-relief effects; different congestion profile from Route 1; high popularity = good live data |
| 3 | **12625/12626** Kerala Express | NDLS ↔ TVC (3,032 km) | Longest route = highest delay variability and most opportunity for cascade effects; crosses 4+ zones = tests multi-zone generalisation; passes through fog belt (NR, winter) AND monsoon belt (SR/Konkan-adjacent) |

**Selection rationale**: These three routes give us diversity across distance, zones, congestion levels, and weather exposure — while being popular enough for reliable RailRadar crowd-sourced data during live demos.
