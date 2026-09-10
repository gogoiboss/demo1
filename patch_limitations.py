with open("docs/LIMITATIONS.md", "r", encoding="utf-8") as f:
    text = f.read()

new_limitations = """## 4. Hard vs. Soft Network Conflicts (Explicit Design Decision)
Because real-time block-section occupancy data (track circuits / live signaling) is not publicly available, we cannot deterministically model micro-level network congestion.

Rather than silently ignoring this gap, we made an explicit modeling choice to split the graph propagation into two strictly defined edge types:
- **HARD Conflicts (`conflict_type="hard"`):** Rake reuse and crew handoff. These are **deterministic** constraints fully supported by the operational scheduling data we ingest. A train's next assignment either shares a rake/crew with a prior service, or it doesn't.
- **SOFT Conflicts (`conflict_type="soft"`):** Shared-section headway. These are **probabilistic approximations**. We infer section congestion dynamically from the scheduled timetable's station-pairs rather than relying on absent signal-state telemetry.

This distinction is baked directly into the graph data structure and surfaced through the API (`get_prediction`) so that downstream consumers (e.g. Station Masters) can assign different confidence levels to a deterministic hardware delay vs. a probabilistic congestion delay."""

if "Hard vs. Soft Network Conflicts" not in text:
    text += "\n\n" + new_limitations

with open("docs/LIMITATIONS.md", "w", encoding="utf-8") as f:
    f.write(text)
