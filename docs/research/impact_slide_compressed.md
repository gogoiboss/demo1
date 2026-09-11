# Impact & Benefits — Slide-Ready (Compressed)

## HEADLINE
> **"Five stakeholders, five broken decisions today — one system, five specific fixes."**

---

## ON-SLIDE TABLE (this IS the slide — 5 rows, tight)

| Stakeholder | ❌ Today | ✅ With Our System |
|---|---|---|
| **Station Master** | Platform committed only 30 min out; lines idle under uncertainty | Commit flag **60–90 min out** — interval width drives the call |
| **Crew Controller** | Relief timed from *scheduled* ETA → HOER stops block 5–15 trains | Dispatch deadline from *predicted* ETA, updated every 30 min |
| **Feeder Transport** | No signal exists; buses guess or wait idle | `P(arrival before cutoff)` — one probability, not guesswork |
| **Maintenance** | Turnaround window discovered on arrival — rushed or cascades | Alert 2–3 hrs early: flag if `next_departure − p90_arrival` < threshold |
| **Passenger** | "On time" while train sits still; no trend; no next-update time | Delay in minutes + trend + "next update at ___" |

---

## THREE DIMENSION BADGES (one line each, below the table)

| 🏛 Social | 💰 Economic | 🌿 Environmental |
|---|---|---|
| Same calibrated signal for every passenger — information equity, not privilege | Fewer idle platform-hours, avoided HOER section stops, reduced emergency crew dispatches | On diesel routes (~35% network): fewer unplanned signal stops → less stop-start fuel waste |

---

## SCALE STAT (bottom strip, one line)

> **Prototype scope: 56 train numbers in 10,000 checked-in journey rows · 500-train propagation benchmark: 20.58 ms synthetic pass · national rollout is phased, not yet load-tested.**

---

## SPEAKER SCRIPT (30 sec — Train 12301 story, covers the table live)

*"One real example. Train 12301, the Howrah Rajdhani, 55 minutes late at Mughalsarai. Today: NTES shows 13:40 — station master committed Platform 3, crew controller dispatched relief at 11:00, the connecting KSRTC bus has no signal at all. Train actually arrives at 14:55. Platform blocked for 75 minutes. Relief crew waited 3.5 hours — now approaching their own rest limit. Bus left at 14:00.*

*With our system, at 11:00: arrival window 14:20–15:10, reason: rake delay plus section conflict. Station master holds the commit. Crew controller dispatches at 12:45, not 11:00. Bus dispatcher sees 18% chance of arrival before 14:30 — departs on schedule, passengers informed. Train arrives at 14:55 — inside our window. No platform conflict. No crew exhaustion. No stranded passengers. Same engine, five better decisions."*

---

## VISUAL LAYOUT

```
┌─────────────────────────────────────────────────────────┐
│  HEADLINE (one line, top)                               │
│                                                         │
│  ┌─────────────┬──────────────┬───────────────┐         │
│  │ Stakeholder │  ❌ Today     │  ✅ With Ours  │  ← 5   │
│  │             │  (amber bg)  │  (green bg)   │  rows   │
│  │   icons     │  8-10 words  │  8-10 words   │         │
│  └─────────────┴──────────────┴───────────────┘         │
│                                                         │
│  [ 🏛 Social ]  [ 💰 Economic ]  [ 🌿 Environmental ]  │
│    one line         one line          one line           │
│                                                         │
│  ── validated scope: 56 train numbers · 20.58 ms at 500 synthetic trains ── │
└─────────────────────────────────────────────────────────┘
```

- Table = **80% of slide real estate** — amber left column, green right column
- Three badges = small strip below table, one sentence each
- Scale stat = bottom strip, small font, grounds everything in real numbers
- **No charts** (no backtest numbers yet), **no stock photos**
- Speaker script tells the Train 12301 story — that's where the emotional punch lives, not on the slide

---

## WHAT GOT CUT (kept in Q&A reserve, not lost)

| Cut from slide | Where it lives instead |
|---|---|
| Theory of Change chain | Previous artifact — use if judge asks "how do you know this creates impact?" |
| AT SCALE numbers per stakeholder (1,000 platform-hours, 75-225 cascading delays) | Previous artifact — use if judge asks "quantify this" |
| Full honesty audit table | Previous artifact — your internal prep, never show on slide |
| Literature MAE range (18-25 → 5-9 min) | Technical slide already covers this |
| Detailed before/after Train 12301 narrative | Speaker script covers it live — more powerful spoken than read |
