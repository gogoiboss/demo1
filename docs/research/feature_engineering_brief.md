# Feature Engineering Brief: Geography, Weather & Congestion in Indian Railways ETA

> [!NOTE]
> **Purpose**: Ground every ML feature choice in real, documented network characteristics — not intuition. Each section ends with a direct feature recommendation you can defend.

---

## §1. Zone-Wise Speed & Running Time Variation

### Published Data

Indian Railways comprises 18 zones with meaningfully different average speeds driven by terrain, track condition, and congestion. The following figures are drawn from Business Standard analysis of Railway Board operational data and IIT research:

| Zone | Avg. Passenger Train Speed | Key Driver of Variation |
|---|---|---|
| **Western Railway (WR)** | ~51.5 km/h | Flat terrain (Rajasthan/Gujarat plain), heavily electrified, fewer single-track sections |
| **North Western Railway (NWR)** | ~51.5 km/h | Similar terrain to WR; less dense network = fewer precedence losses |
| **Southern Railway (SR)** | ~51.4 km/h | Mix of flat Deccan plateau and hilly ghats; well-maintained track |
| **Northern Railway (NR)** | ~46–47 km/h *(recorded ~4.9 km/h drop in one period)* | Extremely high traffic density, heavy freight-passenger mixing, massive precedence losses |
| **Northeast Frontier Railway (NFR)** | ~38–42 km/h *(estimated range)* | Hilly terrain (sub-Himalayan foothills), flood-prone, many single-track sections, gauge conversion zones |
| **Konkan Railway** | ~50–55 km/h scheduled, ~35–45 km/h monsoon | Mountain tunnels + curves dominate; monsoon mandates hard speed cuts |

> [!WARNING]
> **Source reliability note**: There is no single continuously updated public report with all 18 zones' average speeds. Figures above are from Business Standard analysis of Railway Board data and IIT Kanpur research. The NR speed drop figure is from a specific reporting period. Treat as indicative ranges, not precise constants.

### What Drives the Differences

1. **Route geometry**: NFR and Konkan traverse sub-Himalayan/Western Ghat terrain with tight curves, tunnels, and severe gradients — all of which impose permanent speed limits well below flat-track counterparts. WR crosses the Gujarat–Rajasthan plain with minimal gradient.

2. **Track doubling and electrification**: ~65% of IR is now electrified (PIB 2024), but coverage is uneven. NR and NFR have significantly more single-track sections, which create precedence bottlenecks (one train must wait in a loop while another passes).

3. **Freight-passenger mixing**: NR's trunk routes carry very heavy freight alongside passenger traffic. On the Delhi–Howrah corridor, nearly every section runs above 100% utilisation, forcing passenger trains to wait in loops for freight clearance.

4. **Mission Raftaar** (ongoing): IR's initiative to raise average freight speed to 50 km/h and non-suburban passenger speed to higher baselines varies by zone based on how much track doubling and DFC diversion has been completed.

### Feature Implications
- **Zone as a categorical feature is justified** — it proxies for a bundle of physical characteristics (geometry, doubling, freight mix) that are correlated with baseline running time and delay variance.
- A more powerful derived feature: **`section_is_single_track` (binary)** — directly captures the precedence-loss mechanism rather than using zone as a blunt proxy.
- **`historical_avg_speed_on_section`** (computed from timetable data: scheduled time ÷ distance per section) is the cleanest zone-agnostic feature that captures local track quality without needing zone labels.

---

## §2. Weather Conditions That Cause Documented Delays

### 2a. Fog (North India Winter — December to February)

**Mechanism**: Dense radiation fog — worsened by crop-residue burning and vehicular smog in the Indo-Gangetic Plain — reduces visibility below 50m on the worst days. Loco pilots must operate under "Fog Working Rules," which cap speeds based on visibility and require mandatory speed reductions before signals.

**Documented Statistics (2025–26 season, Railway Board / Times of India reporting):**
- **~12.1%** of Mail/Express trains on Northern Railway lost punctuality due to fog
- **~4.4%** of Mail/Express trains on North Western Railway were affected
- **~2.7%** of scheduled trains on NR were outright cancelled (52 trips cancelled + 104 reduced-frequency trips across Dec–Feb)
- Peak fog delays range from **6 to 10 hours** on worst days
- On any given peak fog day, **12 to 80+ trains** can be affected simultaneously

**Geographic scope**: Primarily affects NR, NWR, NCR, and ECR zones — broadly the corridor from Punjab/Haryana through UP, Bihar, and into West Bengal. Trains originating from or passing through Delhi, Lucknow, Varanasi, Patna are highest-risk.

**IR response**: Fog Safe Devices (GPS-based portable units for loco pilots); advance "Fog Handling Plan" cancellations published before season; REMMLOT (Remote Monitoring of Level Crossing Gates) deployment.

**Feature implications**:
- `month` (Dec=1, Jan=1, Feb=1, else 0) is a coarse proxy
- Better: `fog_risk_flag` = 1 if zone ∈ {NR, NWR, NCR, ECR} AND month ∈ {12, 1, 2}
- Even better for live systems: **IMD visibility forecast at origin zone** (via OpenWeatherMap free tier, field: `visibility`)
- Critical: fog does not affect Konkan, Southern, or NFR zones — **this is explicitly a zone × month interaction feature, not a universal one**

---

### 2b. Monsoon (June–October, Multiple Zones)

**Mechanism**: Four distinct failure modes:
1. **Track waterlogging**: Low-lying track in Mumbai suburban, UP flood plains; trains stopped until water recedes
2. **Landslides/boulder falls**: Konkan Railway, NFR sub-Himalayan sections, Western Ghats
3. **Bridge wash-outs**: Particularly on single-track branch lines in Assam, Odisha, Andhra coast
4. **Signalling failures**: Water ingress into trackside signalling equipment

**Documented operational responses:**
- **Konkan Railway**: Formally operates a "Monsoon Timetable" (June 15 – October 20) — mandated speed reductions and round-the-clock patrolling. This is an officially published document, not informal.
- **Mumbai Central/Western Railway (July 2026)**: Severe rain → cancellation and short-termination of numerous local + long-distance trains; ~93% of Mail/Express operated despite conditions (Railway Board press release).
- **Northeast Frontier Railway**: Assam flooding (recurring at Simaluguri and other points) causes multi-day service suspensions on key lines.
- **East Coast Railway**: Odisha and Andhra coastal sections experience waterlogging during Bay of Bengal depressions even outside formal cyclone events.

**Severity gradient by zone**:

| Zone | Monsoon Severity for Rail Ops | Primary Mechanism |
|---|---|---|
| Konkan Railway | 🔴 Very High (has dedicated timetable) | Landslides, boulder falls |
| NFR (Assam) | 🔴 Very High | River flooding, embankment damage |
| Western Railway (Mumbai) | 🟠 High | Urban waterlogging, signalling failure |
| ECR / ECoR (Bihar, Odisha) | 🟠 High | Riverine flooding |
| Southern Railway (Kerala) | 🟡 Moderate–High | Landslides, fallen trees |
| Northern Railway | 🟡 Moderate | Localised flooding in UP/Bihar plains |
| WR (Rajasthan) | 🟢 Low | Arid terrain, flash flooding rare |

**Feature implications**:
- `is_monsoon_season` (Jun–Oct binary flag) is universal but weak
- More powerful: `zone_monsoon_risk_score` (ordinal: 0–3 based on table above) — per-zone sensitivity during monsoon months
- For live systems: IMD rainfall data at station coordinates (available via OpenWeatherMap `rain.1h` field)

---

### 2c. Cyclones (East/West Coasts, Variable Timing)

**Mechanism**: Bay of Bengal cyclones (primarily Oct–Dec, Apr–May) affect East Coast Railway, South East Central Railway, South Coast Railway. Arabian Sea cyclones (rarer) affect Western Railway coastal sections.

**Documented example**: Cyclone Montha (October 2025) → East Coast Railway cancelled 32 trains through Visakhapatnam and diverted several others.

**Feature implications**:
- Cyclone events are low-frequency, high-impact — not suitable as a continuous feature
- Model these as a **binary external disruption flag** (`cyclone_active_on_route`) derivable from IMD cyclone alerts
- For the prototype: treat as out-of-distribution — your model accuracy claims should explicitly exclude active-cyclone states

---

### 2d. Extreme Heat (April–June, NR/WCR/NCR)

**Mechanism**: IR imposes heat-related **speed restrictions** on sections where rail steel expands near buckling temperature thresholds. Track inspectors impose emergency TSRs when rail temperature exceeds safety limits (~60°C on rail surface). This is distinct from weather-induced disruption — it's operationally mandated speed reduction.

**Feature implications**:
- `max_temperature_forecast` at section (available from weather API) is a meaningful feature for summer months in NR/NWR/NCR zones
- Correlated with month (Apr=high risk, May/Jun=peak, Jul onward = monsoon replaces heat risk)

---

## §3. Temporary Speed Restrictions (TSRs)

### What They Are and How They're Imposed

A TSR is a formal order issued when track conditions require speed below the section's normal "Maximum Permissible Speed" (MPS). The authorization chain:

```
Permanent Way Inspector (PWI) identifies defect
        ↓
Issues "Speed Certificate" with Caution Order (CO)
        ↓
Approved by Divisional Engineer (DEN)
        ↓
Countersigned by Sr. Divisional Operations Manager (Sr. DOM)
        ↓
Loco Pilots briefed via pre-departure route chart
        ↓
Speed boards placed on track
        ↓
Valid up to 6 months (then must be reviewed/extended)
```

**Source**: Indian Railways Permanent Way Manual (IRPWM); IIT Kanpur railway operations research.

### How Frequently Do TSRs Occur?

IR maintains tracks under a continuous inspection cycle:
- **Daily patrol**: Track walkers cover all sections daily
- **Track Recording Cars (TRC)**: High-speed routes checked monthly; lower-speed routes less frequently
- **Periodic maintenance**: Intensive work (rail/sleeper replacement, realignment) every 2–3 years

TSRs are imposed whenever TRC data reveals geometry deviation exceeding safety thresholds, or after incidents. On a network of 68,000+ route-km with aging infrastructure, the total number of active TSRs at any given time is very high — estimated in the hundreds to low thousands network-wide.

> [!CAUTION]
> **Public data does not exist for TSRs.** Indian Railways does not publish a real-time or even periodic public register of active TSRs. This is internal data (Caution Orders issued to loco pilots). Furthermore, IR discontinued release of some monthly operational indicators in 2023, reducing external visibility.

**Feature implications**:
- You **cannot** use real-time TSR data in a public-facing prototype — it simply doesn't exist as a public data source
- **Proxy approach**: Historical delay data at a section implicitly encodes the TSR effect — if a section consistently runs slower than scheduled, active TSRs are a likely cause. Your model learns this through `historical_avg_speed_on_section`.
- A useful derived binary: `section_avg_speed < 0.85 × scheduled_speed` — this flags sections that are likely TSR-affected based on observed running behaviour, without needing the actual TSR data.

---

## §4. Corridor Congestion: Published Capacity Utilisation Figures

### The High-Density Network (HDN)

Indian Railways formally defines its **High-Density Network (HDN)** — 7 core trunk routes covering ~11,000 km (~16% of total network) that carry ~41% of all traffic.

**Published capacity utilisation breakdown across the HDN** (Railway Board / IIM research):

| Utilisation Band | % of HDN Sections | Interpretation |
|---|---|---|
| Below 80% | 4.6% | Operating within comfortable capacity |
| 80–100% | 18.9% | Nearing capacity |
| 100–120% | 32.8% | **Overcapacity** — delays begin materialising |
| 120–150% | 29.5% | **Severely overcapacity** — regular delays certain |
| Above 150% | 14.1% | **Extreme saturation** — chronic delay |

**→ ~76% of HDN sections run above 100% capacity.** A healthy rail system targets 70–80%.

### Corridor-Specific Observations

**Delhi–Howrah (1,422 km)**
- Almost no sections below 80% utilisation
- Mix of 100–150%+ throughout
- Both passenger and heavy freight (coal, steel) compete on the same track
- Result: frequent precedence losses; trains routinely wait in loops

**Delhi–Mumbai (1,322 km)**
- Somewhat better than Delhi–Howrah due to the parallel **Western Dedicated Freight Corridor (WDFC)** now operational — this diverts freight, freeing capacity
- No sections exceeding 150% utilisation (unlike Delhi–Howrah)
- Result: recovering; passenger train performance improving as DFC absorbs freight

**Delhi–Chennai and Howrah–Chennai**
- 50–52% of route length at 120–150% utilisation
- Particularly severe around junction points (Vijayawada, Nagpur)

**Branch lines (general)**
- Very low utilisation (<50% on many sections)
- Delays here come not from congestion but from **poor track maintenance** (fewer resources, aging infrastructure) and single-track precedence with the few trains that do run

### Feature Implications
- **`corridor_type`**: Binary or ordinal — `HDN` (1) vs `non-HDN` (0). HDN trains have structurally higher delay variance.
- **`section_capacity_utilisation`**: The most powerful congestion feature. Can be approximated from public timetable data — count scheduled trains on a section per hour and normalise by theoretical capacity. Correlates strongly with precedence-delay probability.
- **`is_dffc_parallel`**: Binary flag for routes where the Dedicated Freight Corridor now runs parallel — controls for the significant DFC effect on passenger train delay reduction (particularly Delhi–Mumbai and Delhi–Howrah east of Kanpur).

---

## §5. Feature Taxonomy: Universal vs Zone/Route-Specific

> [!IMPORTANT]
> This is the core output of the brief — which features should your model learn once (universal) vs learn per zone/route (zone-specific)?

### Universal Features
*(Safe to use as raw features; their meaning doesn't change by zone)*

| Feature | Why It's Universal | How to Compute |
|---|---|---|
| `current_delay_at_station_n` | Delay is delay regardless of zone | NTES / RailRadar live data |
| `stations_remaining` | Journey position is universal | Static timetable |
| `distance_remaining_km` | Physical distance doesn't change meaning | Static timetable |
| `remaining_schedule_buffer_min` | Buffer arithmetic is the same everywhere | `scheduled_time_remaining − min_running_time_remaining` |
| `train_category` (Rajdhani/SF/Express/Mail) | Priority and MPS class applies everywhere | Static timetable |
| `day_of_week` | Demand patterns are universal | Calendar |
| `is_weekend` | Same logic | Calendar |
| `hour_of_day` | Traffic patterns are universal | Calendar |
| `scheduled_dwell_time_at_next_station` | Buffer arithmetic | Static timetable |
| `historical_delay_this_train_this_section` | Train-specific learning | Historical NTES data |

### Zone-Specific / Route-Specific Features
*(Their magnitude or meaning changes by zone — encode as interactions or learn per-segment)*

| Feature | Why It's Zone-Specific | Zones Where It Matters |
|---|---|---|
| `fog_risk_flag` (month × zone interaction) | Only meaningful in NR/NWR/NCR/ECR in Dec–Feb | NR, NWR, NCR, ECR only |
| `monsoon_severity_score` | Konkan = 3, NFR = 3, others lower | All zones but with different weights |
| `section_is_single_track` | NFR/Konkan have far more single-track; NR's DFC corridors are double | All zones — but prevalence varies |
| `section_capacity_utilisation` | ~76% of HDN sections >100%; branch lines <50% | HDN vs non-HDN is the key split |
| `is_dffc_parallel` | Only relevant on Delhi–Mumbai and eastern DFC corridor | WR, ECR, NR (Delhi–Howrah east) |
| `terrain_type` (flat/ghat/mountain) | Affects both baseline speed AND weather vulnerability | Konkan, NFR, SR Ghats |
| `is_konkan_monsoon_timetable_active` | Binary seasonal flag unique to Konkan Railway | Konkan only |
| `historical_avg_speed_vs_scheduled` | Encodes TSR + local track quality — varies by section | Per-section, not per-zone |
| `temperature_max_forecast` | Heat TSR risk only relevant on NR/NWR/NCR in Apr–Jun | NR, NWR, NCR — Apr–Jun only |
| `cyclone_alert_active` | Only East/West coasts; rare | ECoR, SCR, ECR, WR coastal |

### Model Architecture Recommendation

**Option A (simpler, recommended for hackathon):**
Include all features in a single gradient-boosted model (XGBoost/LightGBM) with zone as a categorical feature. Tree models can learn zone × season interactions automatically through splits. Fast to train, interpretable via SHAP.

**Option B (more principled, better for judges):**
Train a universal base model on all trains, then train **zone-specific residual correctors** — a small model per zone that corrects the universal model's error using zone-specific features (fog_risk, terrain, capacity). This mirrors how production systems at Deutsche Bahn and SNCF handle regional heterogeneity.

---

## Source Reference Table

| Claim | Source | Reliability |
|---|---|---|
| WR/NWR avg speed ~51.5 km/h | Business Standard analysis of Railway Board data | 🟡 Community-verified |
| NR speed drop of ~4.9 km/h in specific period | Same source | 🟡 Community-verified |
| 12.1% NR punctuality loss to fog (2025–26) | Times of India / Ministry of Railways reporting | 🟢 Officially sourced |
| 52 trips cancelled, 104 reduced-freq in 2025–26 fog season | Same as above | 🟢 Officially sourced |
| Konkan Monsoon Timetable Jun 15–Oct 20 | Konkan Railway official press releases | 🟢 Officially documented |
| 32 trains cancelled in Cyclone Montha (Oct 2025) | ECoR press release | 🟢 Officially sourced |
| HDN = ~16% of network, carries ~41% of traffic | PIB / Indian Express / Railway Board | 🟢 Officially sourced |
| ~76% of HDN sections above 100% utilisation | IIM/Railway Board research via multiple publications | 🟢 Officially sourced |
| Delhi–Howrah almost no sections below 80% capacity | Same research | 🟢 Officially sourced |
| TSRs valid up to 6 months per IRPWM | IIT Kanpur railway engineering research | 🟢 Officially documented |
| No public TSR database exists | Policy Circle / IRPWM review | 🟢 Confirmed by absence |
| NFR average speed (38–42 km/h range) | 🔴 Inferred from terrain characteristics and news reports | 🔴 Estimated |
| Zone monsoon severity table | 🔴 Synthesised from multiple incident reports | 🔴 Inferred |
