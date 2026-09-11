# RippleETA — Visual Excellence Backlog

Part 6 of the merged audit. Kept as its own file (rather than appended to `docs/AUDIT_REPORT.md`) since that report was already substantial by the time Parts 1-5 were done — this keeps both documents focused and reviewable.

**Scope note on confidence**: this session did not run a browser against the live dashboard (no dev server was started). Every item below is graded either from direct code/CSS evidence (concrete, cited) or marked **UNVERIFIED — needs a browser check** where a claim genuinely requires visual confirmation this session couldn't produce. Several items that would normally be judged from rendered screenshots are instead judged from the underlying CSS/JS, which is a reasonable proxy but not a substitute for opening the pages.

Prioritized by (impact on how polished/professional the project feels) ÷ (effort to implement), highest ratio first.

---

### 1. Fix the silent-failure pattern in every multi-train table (Quick effort, High impact)
Found in Part 3/4: the Station Master junction table, Crew dispatch board, Feeder board, and Maintenance board all use `Promise.all(trains.map(t => api(...).catch(() => null))).then(results => results.filter(Boolean))`. A single failed fetch for any of the 5-7 hardcoded demo trains **silently removes that row** from the table with zero error indicator — no "failed to load," no placeholder row, nothing. In a live judge demo, a transient network hiccup makes rows silently vanish rather than showing a recoverable error. Fix: render a per-row error state (`<tr class="row-error">Train {id}: failed to load</tr>`) instead of filtering it out. Same fix pattern applies to all four tables — a single small helper function would cover it.

### 2. Ghost Sandbox: add a visible API-offline state (Quick effort, High impact for judge-facing page)
Confirmed in Part 4: `runSandboxScenario()`'s error handler only calls `console.error(...)` — on an API failure the slider stops doing anything visible and the page looks frozen/broken with no explanation. This is the page most likely to be shown to judges specifically because it's interactive — a silent freeze here is the worst possible failure mode for a demo. `dashboard/sandbox.js` already contains a full local-fallback implementation that simply isn't wired up (Part 4) — either wire it in, or at minimum show an "API unreachable — retry" banner.

### 3. Decide and apply one design system (Significant effort, dominates every other visual item)
Covered in depth in Part 5. Until this is resolved, every other item on this list is being judged against a moving target — spacing/typography/contrast work done under system #2 (`dashboard/styles.css`'s actual dark palette) could be thrown away if the decision favors system #1 (the documented light palette) or system #4 (`frontend/style.css`'s independent dark palette). This is a product decision, not listed here as a task to execute — see Part 5. Everything below assumes the current shipping CSS stays as-is until that decision is made.

### 4. Station Master signal-lamp color mismatch (Quick effort, Medium impact — but a genuine, immediate bug)
Also from Part 5/4: the SVG signal lamp on Station Master is hardcoded to system #1's hex values while the rest of the page uses system #2's CSS variables — a visible, immediate clash regardless of which system eventually wins. This is a bug fix, not a design-system judgment call, and can be fixed today independent of item 3 above: change the three `setAttribute('fill', '#hex')` calls in `dashboard/app.js`'s `loadStation()` to reference the page's actual current CSS custom properties (`var(--success)`, `var(--signal)`, `var(--stamp)`) instead of literal hex codes, so it automatically tracks whatever palette the page ends up using.

### 5. Texture technique is consistent; underlying palette isn't (Informational — no action item, feeds into #3)
Checked: both `dashboard/styles.css` and `frontend/style.css` genuinely implement the DESIGN_SYSTEM.md-mandated grain/noise overlay technique (`feTurbulence` SVG filters, applied as fixed pseudo-elements). This is good — the *technique* is applied consistently across both major stylesheets. It's applied to two different color palettes, which is Part 5's problem, not a texture-application gap on its own.

### 6. Empty/loading states beyond the tables above (Moderate effort, Medium impact) — UNVERIFIED extent
Confirmed the failure-mode gap in item 1 from code. Did **not** verify from a browser whether the single-train views (Passenger/Station Master/Crew/Feeder/Maintenance hero cards) show a deliberate loading skeleton/spinner during the initial `Promise.all()` fetch, or a blank/undefined-text flash. `setText()` (the shared DOM helper) silently no-ops if the target element doesn't exist, but doesn't itself add any loading affordance — worth a manual check on a throttled connection.

### 7. Mobile / narrow-viewport check (Moderate effort to fix, unknown-until-checked severity) — **UNVERIFIED — needs a browser check**
`docs/FRONTEND_PAGES_FEATURES.md` claims fluid `clamp()`-based typography scaling for "4K monitors and mobile devices." Confirmed `clamp(...)` is used extensively in `dashboard/styles.css` (spot-checked several hero-number declarations), which is a good sign, but this session did not resize a viewport to confirm nothing breaks — the multi-train tables in particular (9-11px mono columns, per `docs/PAGE_ARCHITECTURE.md`) are a plausible narrow-viewport risk given how dense they're described as being. Flagging for a manual check rather than guessing pass/fail.

### 8. Color contrast on dark cards (Moderate effort if issues exist) — **UNVERIFIED — needs a contrast-ratio tool**
The audit brief specifically flagged "especially on the dark station-master cards." `--muted: #5A6A80` on `--surface: #111827` (`dashboard/styles.css`'s actual dark tokens) is a plausible low-contrast pairing worth running through a WCAG contrast checker, but this session didn't have one available and eyeballing hex codes isn't a reliable substitute — genuinely flagged as unverified rather than guessed.

### 9. Typography hierarchy consistency (Moderate effort) — spot-checked, not exhaustive
`docs/DESIGN_SYSTEM.md` specifies Fraunces (headlines) / Inter (body) / IBM Plex Mono (data); `dashboard/styles.css`'s `:root` block does load exactly those three font families and appears to apply them by role fairly consistently in the sections read during Part 4 (hero numbers in mono, headings in the display font). Not exhaustively checked across all 7 pages within this session's budget.

### 10. Micro-interaction polish: hover/focus states (Light effort, Low-medium impact) — UNVERIFIED
Not checked systematically. A quick `grep -c ":hover"` across `dashboard/styles.css` would give a rough density signal but wasn't run this pass; genuinely unknown whether focus states (keyboard navigation, not just mouse hover) are present on interactive elements like the action buttons found to be non-functional in Part 4 (Crew/Maintenance's Prepare/Mobilize/Confirm/Sweep buttons) — worth checking `:focus-visible` coverage specifically given those buttons already have a functionality gap.

### 11. Cross-page navigation/role-switching motion consistency (Light effort to verify) — UNVERIFIED
`docs/PAGE_ARCHITECTURE.md` (already flagged as stale in Part 5) describes a 0.35s `@keyframes reveal` page-transition used everywhere. Whether the current 7-separate-HTML-file architecture (as opposed to the tab-based SPA that doc describes) still applies a consistent transition when navigating between `passenger.html` → `crew.html` etc. (a real page load, not a JS view-swap) wasn't checked — full page navigation may simply not have the same transition opportunity a SPA tab-swap would, which would itself be worth flagging to the product owner as an architecture-vs-doc gap, not just a missing animation.

---

## What this list deliberately doesn't include
Anything requiring a rendered screenshot to judge fairly (exact spacing-scale adherence in pixels, precise contrast ratios, real mobile breakpoint behavior) is marked UNVERIFIED above rather than guessed at with a confident-sounding score. A follow-up session with actual browser access (or the user running the dev server and sharing screenshots) would let several of these move from UNVERIFIED to a real finding or a "confirmed fine."
