---

## Value Proposition: Cost → Benefit Delta by Stakeholder

---

### 🟠 Station Master / Platform Allocation

**TODAY:** Platform committed only 30–40 min before arrival because no ETA carries a confidence signal — all ETAs treated as equally untrustworthy. When uncertain, SM holds the platform line idle in reserve, blocking it from other trains. The hidden cost is not one wasted platform — it's compounded across every busy junction, every hour.

**WITH OUR SOLUTION:** Confidence window delivered 60–90 min out with a binary flag — "safe to commit now?" — so `±8 min` triggers immediate commitment while `±40 min` triggers explicit hold + escalation to section controller. The SM isn't guessing anymore; the system makes the uncertainty legible.

**WHY THIS MATTERS AT SCALE:** Earlier platform commitment across hundreds of junctions unlocks platform throughput — fewer tracks held idle means more trains cleared on time, fewer conflict cascades at the next station downstream.

---

### 🟠 Crew Controller / HOER Scheduling

**TODAY:** CMS computes relief dispatch timing from the *scheduled* ETA, not the actual predicted one — so a 90-minute delay means the relief crew is positioned for the wrong time, the running crew risks exhausting HOER hours, and the train stops on an open section waiting 1–4 hours for emergency relief, blocking 5–15 trains behind it.

**WITH OUR SOLUTION:** System outputs a single computed deadline — "relief crew must sign on by 11:45" — recalculated every 30 minutes from the predicted ETA with confidence bounds, so the controller dispatches pessimistically when uncertainty is high and avoids the section stop entirely.

**WHY THIS MATTERS AT SCALE:** Each HOER section stop cascades to 5–15 trains for 1–4 hours; preventing even a handful per day across the network eliminates hours of compounded delay and removes the institutional pressure to backdate CMS entries to hide violations.

---

### 🟠 Feeder Transport (Buses, Hotel Pickups, Connecting Logistics)

**TODAY:** No automated signal exists — providers use fixed-buffer heuristics or manual NTES polling. NTES's structural optimism means providers who trust it arrive early and wait (idle driver cost); those who've learned to distrust it use larger buffers, so on-time passengers wait for their pickup. The wait-or-depart decision has no rational basis in either direction.

**WITH OUR SOLUTION:** REST API delivers `P(arrival before cutoff)` directly — above 80% the bus waits, below 40% it departs, in between it dispatches early and communicates — replacing a policy guess with a probability-driven decision for the first time.

**WHY THIS MATTERS AT SCALE:** An API integration means every state bus operator, hotel chain, and logistics provider can plug into the same signal — not a one-off solution for one junction, but a platform that converts feeder coordination from informal to systematic across the entire network.

---

### 🟠 Cleaning / Turnaround Supervisor

**TODAY:** Cleaning gang dispatched on scheduled time — so a 75-minute late arrival leaves 1 hour 45 minutes for a 3-hour secondary maintenance job. Supervisor discovers the conflict when the rake rolls in, not 2–3 hours earlier when there was still time to request a schedule intervention, approve overtime proactively, or renegotiate the pit-line slot with the next rake.

**WITH OUR SOLUTION:** System continuously computes `available_window = next_departure − p90_arrival` and flags below-threshold windows 2–3 hours before arrival, giving the supervisor a decision window that currently doesn't exist — act now, or accept the downstream consequences with full visibility.

**WHY THIS MATTERS AT SCALE:** Rushed secondary maintenance is a recurring CAG audit finding on cleanliness; preventing it systematically reduces audit exposure, improves published cleanliness scores, and stops departure cascades that originate at the terminating end and propagate forward into the next day's schedule.

---

### 🟠 Passenger

**TODAY:** NTES freezes at the last reported station and shows "on time" while the train sits still — passengers make departure, connection, and logistics decisions on false confidence. No trend information, no next-update time, no signal for whether to wait or make alternate arrangements.

**WITH OUR SOLUTION:** Three facts updated every 15–20 minutes — delay in plain minutes, trend direction (improving / stable / worsening), and a committed next-update time — plus the anomaly gate explicitly saying "prediction suspended" instead of projecting false precision during a genuine disruption.

**WHY THIS MATTERS AT SCALE:** Passenger trust in the information system is the precondition for behavioral adaptation — passengers who trust the system plan earlier, reduce last-minute crowding at platforms, and generate fewer complaints; at network scale this is the difference between a system people use and one they've learned to ignore.

---

## Slide-ready summary strip

| Stakeholder | Cost Today | Benefit Delta |
|---|---|---|
| **Station Master** | Platform held idle; commitment forced late | Commit 60–90 min out with confidence flag |
| **Crew Controller** | HOER violation → section stop → 5–15 trains blocked | Computed dispatch deadline, updated every 30 min |
| **Feeder Transport** | Fixed-buffer guesswork; idle cost or missed connection | `P(arrival before cutoff)` via API; rational decision |
| **Maintenance Supervisor** | Conflict discovered on arrival; 3-hr job, 1h45m window | Turnaround alert 2–3 hrs before; time to intervene |
| **Passenger** | "On time" shown while train sits still; no trend, no update | Delay + trend + next-update time; honest uncertainty mode |