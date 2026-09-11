## 5 One-Sentence Elevator Pitches

---

**Version 1 — Problem-first**
> *"India's train system gives every stakeholder one wrong number to act on — we give each a decision-ready answer and the honest uncertainty behind it."*

| Criterion | Rating |
|---|---|
| Zero-jargon understandable | ✅ Plain English throughout |
| Hints at WHY different | ⚠️ Hints at output difference, not the mechanism |
| Under 25 words | ✅ 25 words |

---

**Version 2 — Insight-first**
> *"We model what trains inherit from their last journey and what they face from the network ahead — the two signals that determine most delays."*

| Criterion | Rating |
|---|---|
| Zero-jargon understandable | ✅ No technical terms |
| Hints at WHY different | ✅ Names the mechanism directly (rake + network) |
| Under 25 words | ✅ 25 words |

---

**Version 3 — Analogy-first**
> *"We do for train ETAs what weather forecasting did for rain — replace false precision with an honest, narrowing probability window."*

| Criterion | Rating |
|---|---|
| Zero-jargon understandable | ✅✅ Universal analogy, instant mental model |
| Hints at WHY different | ✅ "false precision" indicts NTES; "narrowing" shows it's dynamic |
| Under 25 words | ✅ 20 words — shortest of the five |

---

**Version 4 — Outcome-first**
> *"For the first time, every stakeholder — from station master to passenger — gets a train arrival they can actually make decisions from."*

| Criterion | Rating |
|---|---|
| Zero-jargon understandable | ✅✅ Purest plain English |
| Hints at WHY different | ⚠️ Tells you what changes, not why or how |
| Under 25 words | ✅ 22 words |

---

**Version 5 — Contrast-with-status-quo-first**
> *"Unlike systems that treat trains in isolation, ours models the network and outputs an honest arrival window — not a confident wrong time."*

| Criterion | Rating |
|---|---|
| Zero-jargon understandable | ✅ "models the network" is slightly abstract but recoverable |
| Hints at WHY different | ✅✅ Directly names the architectural gap (isolated vs. network) |
| Under 25 words | ✅ 22 words |

---

## Recommendation

**Use Version 3 for both — verbal opener and PPT first slide.**

> *"We do for train ETAs what weather forecasting did for rain — replace false precision with an honest, narrowing probability window."*

**Why it wins:**

- **Analogy does the hardest work instantly.** Every judge knows weather forecasting solved exactly this problem 40 years ago. You don't explain uncertainty quantification — you inherit 40 years of public familiarity with it in six words.
- **"False precision" is the indictment.** It names NTES's fundamental flaw without naming NTES — a judge who knows the domain gets it, a judge who doesn't still understands "wrong number that sounds right."
- **"Honest, narrowing" does double duty.** "Honest" signals the anomaly gate (system says I don't know). "Narrowing" signals it's dynamic, not static — the interval shrinks as the train approaches, which is the behaviour that makes it operationally useful.
- **20 words.** Shortest, most memorable, no syllable wasted.

**Then immediately follow it with Version 5 as the second sentence verbally:**
> *"Unlike every existing system that treats trains in isolation, ours models the network — so when one train is late, every train sharing that track knows it."*

Together they form a 2-sentence opener: the analogy establishes *what* the output is, the contrast establishes *why the model is fundamentally different*. Everything else in your pitch is proof of those two claims.