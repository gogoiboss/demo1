# Data Sources for Dynamic ETA Prediction — Hackathon Brief

> [!IMPORTANT]
> **Bottom Line Up Front**: There is **no official public API** from Indian Railways/CRIS for real-time train data. Every real-time integration path for a hackathon prototype involves either (a) unofficial scraping, (b) third-party crowd-sourced APIs, or (c) pre-collected historical datasets. This brief gives you the realistic options ranked by feasibility.

---

## 1. NTES (National Train Enquiry System)

**URL**: [enquiry.indianrail.gov.in](https://enquiry.indianrail.gov.in/mntes)
**Operator**: CRIS (Centre for Railway Information Systems)

### What Data It Exposes
| Field | Available? | Notes |
|---|---|---|
| Train number & name | ✅ | |
| Full route schedule (all stations) | ✅ | Scheduled arrival/departure for every halt |
| Actual arrival/departure | ✅ | Per station, when available |
| Current delay (minutes) | ✅ | Derived from actual vs scheduled |
| Last reported station | ✅ | |
| "Between Station A and B" position | ✅ | Text-based, not GPS coordinates |
| Platform number | ✅ | At stations where assigned |
| Cancellation / rescheduling alerts | ✅ | |
| **GPS coordinates** | ❌ | Not exposed publicly |
| **Speed / velocity** | ❌ | Not exposed publicly |
| **Historical data / past runs** | ❌ | Only current-day status |
| **Remaining slack / buffer time** | ❌ | Internal WTT data, never exposed |

### How Station Masters Update It
The data flow has two mechanisms operating in parallel:

1. **Legacy (Manual)**: Station Master records arrival/departure → communicates to Section Controller → Controller enters into **Control Office Application (COA)** → COA pushes to NTES.
   - **Latency**: 5–15 minutes after the actual event. Worse at smaller stations.

2. **Modern (Automated via RTIS)**: GPS/NavIC devices on locomotives (developed with **ISRO**) send position updates every ~30 seconds via satellite + cellular network → auto-plotted on COA control chart → pushed to NTES.
   - **Latency**: ~1–3 minutes. Coverage is expanding but not yet universal across all locos.

> [!NOTE]
> **Source**: CRIS official documentation on RTIS (Real-Time Train Information System), developed in collaboration with ISRO. The COA is the primary backend tool for Train Controllers.

### API Access

> [!CAUTION]
> **No public API exists.** CRIS restricts API access to authorized partners via their **Pravah API Gateway**, which requires formal agreements and significant integration fees (TIES scheme). You will **not** get this for a hackathon.

**Practical access for your prototype**:
- **Scraping the NTES web interface** is the only direct path. It requires handling session cookies, CSRF tokens, and careful rate limiting.
- See Section 5 (GitHub Tools) for ready-made scrapers.

### Hackathon Feasibility Assessment
| Criterion | Assessment |
|---|---|
| **Integrable in 1 week?** | ⚠️ Possible but fragile. Scraping NTES is doable but HTML structure changes break scrapers. |
| **Rate limits / cost** | Free (it's a government site), but aggressive scraping will get your IP blocked. Limit to ~1 request per 5 seconds. |
| **Missing fields you must simulate** | GPS coords, speed, historical runs, buffer/slack time, intermediate station dwell time targets |

---

## 2. RailRadar

**URL**: [railradar.in](https://railradar.in)
**Operator**: Independent third-party (not affiliated with Indian Railways/IRCTC/CRIS)

### API Details
| Detail | Value |
|---|---|
| **Base URL** | `https://api.railradar.in/v1` |
| **Auth** | Bearer token: `Authorization: Bearer rr_live_YOUR_API_KEY` |
| **Sign-up** | [railradar.in/login](https://railradar.in/login) — no credit card required |
| **Free tier** | ~1,000 requests/month (sandbox) |
| **Rate limit exceeded** | Returns `429 Too Many Requests` |

### Endpoints
```
GET /v1/trains/{number}/live      → Real-time position, delay, current halt
GET /v1/trains/{number}/route     → Full timetable + GeoJSON polyline for mapping
GET /v1/trains/{number}/coaches   → Coach composition and layout
GET /v1/lookup/search/trains      → Autocomplete / search trains
```

### Data Fields
| Field | Available? | Notes |
|---|---|---|
| Train number, name | ✅ | |
| Real-time delay (minutes) | ✅ | Per station |
| Current position (lat/lng) | ✅ | Crowd-sourced, not official GPS |
| Route as GeoJSON polyline | ✅ | Great for map visualization |
| Scheduled vs actual times | ✅ | |
| Coach composition | ✅ | |
| **Historical data** | ❌ | Live only, no past-run archives |
| **Buffer/slack time** | ❌ | Not exposed |

### GPS Data Source — Critical Caveat

> [!WARNING]
> **Crowd-sourced, not official.** RailRadar's position data comes from **anonymized GPS signals from passengers using the RailRadar mobile app**. A consensus algorithm filters noise. This means:
> - Accuracy depends on how many RailRadar users are on that specific train.
> - Popular routes (Rajdhani, Shatabdi) will have better coverage than rural/branch lines.
> - This is **not** the RTIS/ISRO satellite data used by CRIS internally.

### Hackathon Feasibility Assessment
| Criterion | Assessment |
|---|---|
| **Integrable in 1 week?** | ✅ **Best option for live data.** Clean REST API, JSON responses, no scraping needed. |
| **Rate limits / cost** | 1,000 req/month free. For 3 routes polled every 5 min over 7 days: ~6,000 requests. **You'll exceed the free tier.** Budget for a paid plan or reduce polling frequency to every 15–20 min. |
| **Missing fields you must simulate** | Historical data (use Kaggle for backtesting), buffer/slack time, official RTIS position |

---

## 3. data.gov.in (Open Government Data Platform)

**URL**: [data.gov.in](https://data.gov.in)

### What's Actually There

> [!WARNING]
> **Disappointing for this use case.** The platform primarily hosts high-level aggregate statistics, not granular train-level delay data.

| Dataset | Granularity | Useful? |
|---|---|---|
| "Indian Railways Train Time Table" | Static schedule (all trains, all stations) | ✅ Excellent baseline for deriving "scheduled time" |
| "Year-wise Train Punctuality Index" | Yearly aggregate % | ❌ Too coarse for per-train modeling |
| Station master lists, infrastructure stats | Reference data | ⚠️ Useful as features (e.g., station type) |
| **Per-train, per-day delay history** | **Not available** | ❌ |

### What You Can Actually Use
- **The static timetable dataset** is genuinely useful. Download it to get scheduled arrival/departure for every station on every train. This becomes your "expected" baseline against which you measure delay and derive implicit slack.
- Search for: `"Indian Railways Train Time Table"` on data.gov.in → download as CSV/JSON.

### Hackathon Feasibility Assessment
| Criterion | Assessment |
|---|---|
| **Integrable in 1 week?** | ✅ Instant download, CSV format, trivial to parse. |
| **Rate limits / cost** | Free, no API needed — direct file download. |
| **Missing fields** | Everything dynamic: actual running times, delays, real-time position. This is static reference data only. |

---

## 4. Kaggle & GitHub — Historical Data for Backtesting

### Kaggle Datasets (Ranked by Usefulness)

#### A. "Indian Railways: Predict Train Delay" (Competition Dataset)
- **URL**: Search `"Indian Railways Predict Train Delay"` on [kaggle.com/competitions](https://kaggle.com/competitions)
- **Size**: ~1.5 million journey records
- **Fields**: Scheduled travel hours, distance, zone congestion index, weather factors (monsoon, fog risk), rolling stock details (coach count, loco age), binary target (delayed >15 min or not)
- **Best for**: Training ML models. Most feature-rich dataset available.

> [!TIP]
> **Start here.** This is the single best dataset for building and backtesting your prediction model. It has enough volume and features to produce meaningful results.

#### B. "Indian Railways Train Delays Dataset 2025"
- **URL**: [kaggle.com/datasets/naijilaji/indian-railways-train-delays-dataset-2025](https://www.kaggle.com/datasets/naijilaji/indian-railways-train-delays-dataset-2025)
- **Source**: Compiled from ETrain.info (scraped)
- **Fields**: Average delay time, % right-time arrivals, delay severity breakdowns, per-train per-station stats
- **Best for**: Route-specific analysis, understanding delay patterns for specific trains you want to demo.

#### C. "Indian Railways - Delay Dataset" (2016–2025)
- **URL**: [kaggle.com/datasets/rxydenxd/indian-railways-delay-dataset](https://www.kaggle.com/datasets/rxydenxd/indian-railways-delay-dataset)
- **Fields**: Scheduled vs actual arrival, delay in minutes, frequency data for selected trains
- **Best for**: Time-series analysis, seasonal trend visualization.

#### D. "Train Delay Dataset" (Beginner-Friendly)
- **Size**: ~2,800 records
- **Fields**: Distance, weather, time of day, route congestion, delay
- **Best for**: Quick prototyping if you need a small, clean dataset to get your pipeline working fast.

### GitHub Scraping Tools

| Tool | URL | What It Does |
|---|---|---|
| **railpull** | [github.com/shwetankg07/railpull](https://github.com/shwetankg07/railpull) | Polite NTES crawler. Pulls timetable data + live delay status. Outputs flat CSV. Has resume capability. **Best for bulk historical data collection.** |
| **TrainTrack** | [github.com/Arkapravo-Ghosh/TrainTrack](https://github.com/Arkapravo-Ghosh/TrainTrack) | FastAPI wrapper around NTES. Handles CSRF/session. Returns structured JSON. **Best for building your own lightweight API.** |
| **ntes-client** | [github.com/x64vbhv/ntes-client](https://github.com/x64vbhv/ntes-client) | Unofficial Python client for NTES. Simplifies querying live status. |

> [!WARNING]
> **Scraping fragility**: NTES HTML structure changes periodically. These tools may need maintenance. Always verify they work against the current site before depending on them.

### Hackathon Feasibility Assessment (Kaggle + GitHub)
| Criterion | Assessment |
|---|---|
| **Integrable in 1 week?** | ✅ Kaggle datasets: instant download. GitHub tools: 1–2 hours to set up. |
| **Rate limits / cost** | Free. For scraping, self-impose ~1 req/5 sec. |
| **Missing fields** | Kaggle data is historical only — no live component. Combine with RailRadar for live demo. |

---

## 5. Other API Options (RapidAPI)

Several unofficial Indian Railways APIs exist on [RapidAPI](https://rapidapi.com/search/Indian%20Railways):

| Feature | Details |
|---|---|
| **Free tiers** | Range from 20–100 requests/day to 500K requests/month depending on provider |
| **Typical endpoint** | `GET /api/train/status?train_number=12301&date=20260826` |
| **Auth** | `x-rapidapi-key` header |
| **Data** | Train running status, schedule, PNR — similar to NTES data |
| **Reliability** | Variable. These are unofficial wrappers, not backed by CRIS. |
| **Credit card** | Often required even for free tier |

> [!NOTE]
> **Not recommended as primary source** due to unreliable uptime and potential for sudden shutdown. Use as a backup if RailRadar's free tier is insufficient.

---

## 6. Recommended Integration Strategy for Your Hackathon

### Phase 1: Immediate (Day 1–2)
1. **Download** the "Indian Railways: Predict Train Delay" Kaggle competition dataset → use for ML model training
2. **Download** the static timetable from data.gov.in → this is your "scheduled time" baseline
3. **Sign up** for RailRadar API → get your sandbox key
4. **Pick 2–3 demo routes**: Choose high-traffic, long-distance routes where RailRadar crowd-sourced data will be reliable. Recommendations:
   - **12301/12302 Howrah Rajdhani** (NDLS ↔ HWH) — extremely popular, good coverage
   - **12951/12952 Mumbai Rajdhani** (NDLS ↔ BCT) — same reason
   - **12625/12626 Kerala Express** (NDLS ↔ TVC) — long route, lots of delay variability

### Phase 2: Build Pipeline (Day 2–4)
1. **Historical model**: Train your ML model on the Kaggle data (features: distance, season, zone congestion, train type, time of day)
2. **Derive implicit slack**: For your 3 demo routes, compare the scheduled section times (from timetable) against theoretical minimum times (distance ÷ MPS for that section). The difference is your "buffer estimate" per segment.
3. **Live feed**: Poll RailRadar every 15 minutes for your 3 trains during demo runs

### Phase 3: Demo (Day 5–7)
1. **Dynamic ETA feature**: Current delay at station X → remaining buffer on route ahead → predicted final arrival = scheduled + max(0, current_delay − remaining_buffer)
2. **Visualization**: Use RailRadar's GeoJSON polylines to render the route on a map

### What You Will Have to Simulate or Assume

> [!CAUTION]
> **These fields are NOT available from any public source**. You must derive or assume them:

| Missing Data | Recommended Approach |
|---|---|
| **Buffer/slack time per section** | Derive: `scheduled_section_time − (distance ÷ section_MPS)`. This is an approximation. |
| **Section-wise Maximum Permissible Speed (MPS)** | Assume from train category: Rajdhani ~130 km/h, Mail/Express ~110 km/h, Superfast ~100–120 km/h. Real MPS varies by section. |
| **Real-time controller decisions** (priority clearance, dwell time cuts) | Cannot model. Assume probabilistic recovery based on historical data. |
| **Internal Working Time Table (WTT)** | Not publicly available. Use public timetable + your derived buffer as proxy. |
| **Weather / fog at section level** | Use weather APIs (OpenWeatherMap free tier) by station lat/lng. |
| **Track maintenance blocks (TSRs)** | Cannot obtain in real-time. Ignore for prototype; note as limitation. |

---

## Source Reliability Legend

| Tag | Meaning |
|---|---|
| 🟢 **Officially documented** | From CRIS, RDSO, Railway Board, or government portals |
| 🟡 **Community-verified** | Consistent across multiple developer reports, GitHub repos, and forums |
| 🔴 **Inferred/estimated** | Not officially confirmed; derived from analysis or operational logic |

| Claim in this brief | Reliability |
|---|---|
| NTES has no public API | 🟢 Confirmed by CRIS |
| RTIS uses ISRO GPS/NavIC devices, updates every ~30 sec | 🟢 Official CRIS/ISRO documentation |
| Manual NTES updates have 5–15 min latency | 🟡 Widely reported by developers and railway staff |
| RailRadar free tier = 1,000 req/month | 🟡 Per RailRadar documentation at time of research |
| RailRadar GPS is crowd-sourced from passenger app | 🟢 Stated on RailRadar platform |
| Kaggle dataset sizes and fields | 🟢 Verifiable on Kaggle pages |
| Buffer/slack time derivation method | 🔴 Inferred — no official formula published |
| MPS assumptions by train category | 🔴 Approximate averages; actual MPS varies by section |
