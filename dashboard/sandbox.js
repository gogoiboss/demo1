/**
 * sandbox.js — Ghost Train Sandbox
 * Interactive delay propagation proof using real FastAPI graph engine.
 *
 * Architecture:
 *   HTML slider (oninput) → fetch('/graph/sandbox?source_delay=N')
 *   → JSON response → update 3D CSS scene + readouts
 *
 * The non-linear threshold at ~6 min is the "wow" moment:
 * below 6 min → zero propagation; above 6 min → conflict kicks in.
 * This proves max-plus algebra isn't trivial addition.
 */

const SANDBOX_API = (window.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

// ── DOM refs ───────────────────────────────────────────────────────────
const sandboxEl = {
  slider:          () => document.getElementById('sandbox-delay-slider'),
  sliderValue:     () => document.getElementById('sandbox-slider-value'),
  train1:          () => document.getElementById('sandbox-train1'),
  train2:          () => document.getElementById('sandbox-train2'),
  conflictBeam:    () => document.getElementById('sandbox-conflict-beam'),
  conflictLabel:   () => document.getElementById('sandbox-conflict-label'),
  resultConflict:  () => document.getElementById('sandbox-result-conflict'),
  resultTotal:     () => document.getElementById('sandbox-result-total'),
  resultSeverity:  () => document.getElementById('sandbox-result-severity'),
  explanation:     () => document.getElementById('sandbox-explanation'),
  thresholdLine:   () => document.getElementById('sandbox-threshold-line'),
  thresholdLabel:  () => document.getElementById('sandbox-threshold-label'),
  mathFormula:     () => document.getElementById('sandbox-math'),
  sceneSurface:    () => document.getElementById('sandbox-scene'),
  statusDot:       () => document.getElementById('sandbox-status-dot'),
  statusLabel:     () => document.getElementById('sandbox-status-label'),
};

// ── Color palette (matching RippleETA design system) ───────────────────
const COLORS = {
  teal:       '#61c5bd',
  tealDeep:   '#1d686a',
  amber:      '#f5b84b',
  amberSoft:  '#6f4d1e',
  coral:      '#f07868',
  text:       '#edf4ef',
  muted:      '#8da1a0',
  ink:        '#091113',
  panel:      '#101b1d',
};

// ── Severity → visual mapping ──────────────────────────────────────────
const SEVERITY_MAP = {
  none:   { color: COLORS.teal,  glow: COLORS.tealDeep, label: 'NO CONFLICT',  trainColor: COLORS.teal  },
  low:    { color: COLORS.amber, glow: COLORS.amberSoft, label: 'LOW',         trainColor: COLORS.amber  },
  medium: { color: COLORS.amber, glow: '#b8860b',       label: 'MEDIUM',       trainColor: COLORS.amber  },
  high:   { color: COLORS.coral, glow: '#9b3a30',       label: 'HIGH',         trainColor: COLORS.coral  },
};

// ── State ──────────────────────────────────────────────────────────────
let sandboxState = {
  lastResult: null,
  debounceTimer: null,
  apiOnline: false,
  thresholdMin: 6,  // updated from API response
};

// ── Track geometry constants ───────────────────────────────────────────
// Train 1 (Express 56789) moves from Kanpur area toward Allahabad as delay increases
// Train 2 (Rajdhani 12301) position shifts when conflict pushes it
const TRACK = {
  stationKanpur:   14,   // % left position
  stationAllahabad: 50,
  stationMughal:   86,
  train1Base:      22,   // base position (% left) for train 1
  train1Max:       42,   // max position when delay = 30
  train2Base:      30,   // base position for train 2
  train2ConflictShift: 8, // max extra % shift when conflict is high
};

// ── API call ───────────────────────────────────────────────────────────
async function fetchSandboxResult(delayMin) {
  try {
    const resp = await fetch(`${SANDBOX_API}/graph/sandbox?source_delay=${delayMin}`);
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    sandboxState.apiOnline = true;
    sandboxState.thresholdMin = data.threshold_delay_min || 6;
    return data;
  } catch (err) {
    sandboxState.apiOnline = false;
    // Fallback: compute locally (simplified max-plus for demo)
    return computeLocalFallback(delayMin);
  }
}

function computeLocalFallback(delayMin) {
  // Exact same math as the real graph engine, simplified for the 2-train case:
  // 56789 arr ALLD actual = 1564 + delayMin
  // 12301 arr ALLD (no conflict) = 1525 + 55 = 1580
  // Conflict constraint = (1564 + delayMin) + 10 = 1574 + delayMin
  // Conflict fires when 1574 + delayMin > 1580, i.e., delayMin > 6
  const train56789_arr = 1564 + delayMin;
  const train12301_base = 1580;
  const headway = 10;
  const constraint = train56789_arr + headway;
  const conflictActive = constraint > train12301_base;
  const conflictAdd = conflictActive ? constraint - train12301_base : 0;
  const totalDelay = 55 + conflictAdd;

  let severity = 'none';
  if (conflictAdd > 15) severity = 'high';
  else if (conflictAdd >= 5) severity = 'medium';
  else if (conflictAdd > 0) severity = 'low';

  return {
    source_train: '56789',
    source_delay_min: delayMin,
    affected_train: '12301',
    affected_base_delay_min: 55,
    conflict_addition_min: conflictAdd,
    affected_total_delay_min: totalDelay,
    conflict_active: conflictActive,
    threshold_delay_min: 6,
    propagation_explanation: `max(${train12301_base}, ${constraint}) = ${Math.max(train12301_base, constraint)} → conflict adds +${conflictAdd.toFixed(1)} min`,
    section: 'KANPUR → ALLAHABAD',
    severity: severity,
  };
}

// ── Visual update ──────────────────────────────────────────────────────
function updateSandboxVisuals(result) {
  sandboxState.lastResult = result;
  const severity = SEVERITY_MAP[result.severity] || SEVERITY_MAP.none;
  const delay = result.source_delay_min;

  // ── Slider readout ──
  const sliderVal = sandboxEl.sliderValue();
  if (sliderVal) {
    sliderVal.textContent = `${delay.toFixed(0)} min`;
    sliderVal.style.color = severity.color;
  }

  // ── Train 1 position & color (moves right as delay increases) ──
  const train1 = sandboxEl.train1();
  if (train1) {
    const progress = Math.min(delay / 30, 1);
    const train1Left = TRACK.train1Base + progress * (TRACK.train1Max - TRACK.train1Base);
    train1.style.left = `${train1Left}%`;
    // Color transitions: teal (0-6 min) → amber (6-20) → coral (20+)
    if (delay <= sandboxState.thresholdMin) {
      train1.style.setProperty('--train-color', COLORS.teal);
      train1.querySelector('.train-body').style.background =
        `linear-gradient(135deg, ${COLORS.teal}, ${COLORS.tealDeep})`;
    } else if (delay <= 20) {
      train1.style.setProperty('--train-color', COLORS.amber);
      train1.querySelector('.train-body').style.background =
        `linear-gradient(135deg, ${COLORS.amber}, #c87f0a)`;
    } else {
      train1.style.setProperty('--train-color', COLORS.coral);
      train1.querySelector('.train-body').style.background =
        `linear-gradient(135deg, ${COLORS.coral}, #b84a3c)`;
    }
    // Update delay label
    const label = train1.querySelector('.train-delay');
    if (label) label.textContent = `+${delay.toFixed(0)}`;
  }

  // ── Train 2 position & color (shifts when conflict pushes it) ──
  const train2 = sandboxEl.train2();
  if (train2) {
    const conflictProgress = Math.min(result.conflict_addition_min / 24, 1);
    const train2Left = TRACK.train2Base + conflictProgress * TRACK.train2ConflictShift;
    train2.style.left = `${train2Left}%`;

    if (result.conflict_active) {
      train2.querySelector('.train-body').style.background =
        `linear-gradient(135deg, ${severity.trainColor}, ${severity.glow})`;
      train2.classList.add('is-conflicted');
    } else {
      train2.querySelector('.train-body').style.background =
        `linear-gradient(135deg, ${COLORS.amber}, #c87f0a)`;
      train2.classList.remove('is-conflicted');
    }
    // Update delay label
    const label = train2.querySelector('.train-delay');
    if (label) label.textContent = `+${result.affected_total_delay_min.toFixed(0)}`;
  }

  // ── Conflict beam (hidden when no conflict, amber/coral when active) ──
  const beam = sandboxEl.conflictBeam();
  if (beam) {
    if (result.conflict_active) {
      beam.classList.add('is-active');
      beam.style.setProperty('--beam-color', severity.color);
      beam.style.opacity = Math.min(0.3 + result.conflict_addition_min / 30, 1);
    } else {
      beam.classList.remove('is-active');
      beam.style.opacity = 0;
    }
  }

  // ── Conflict label on beam ──
  const beamLabel = sandboxEl.conflictLabel();
  if (beamLabel) {
    beamLabel.textContent = result.conflict_active
      ? `+${result.conflict_addition_min.toFixed(0)} MIN PROPAGATED`
      : '';
    beamLabel.style.color = severity.color;
  }

  // ── Readout cards ──
  const rc = sandboxEl.resultConflict();
  if (rc) {
    rc.textContent = result.conflict_active
      ? `+${result.conflict_addition_min.toFixed(1)}`
      : '0';
    rc.style.color = severity.color;
  }

  const rt = sandboxEl.resultTotal();
  if (rt) {
    rt.textContent = `${result.affected_total_delay_min.toFixed(1)}`;
    rt.style.color = result.conflict_active ? severity.color : COLORS.text;
  }

  const rs = sandboxEl.resultSeverity();
  if (rs) {
    rs.textContent = severity.label;
    rs.style.color = severity.color;
    rs.style.borderColor = severity.glow;
  }

  // ── Explanation text ──
  const expl = sandboxEl.explanation();
  if (expl) expl.textContent = result.propagation_explanation;

  // ── Math formula ──
  const math = sandboxEl.mathFormula();
  if (math) {
    math.innerHTML = result.conflict_active
      ? `actual = max(<span class="val-scheduled">${1580}</span>, <span class="val-upstream">${(1564 + delay).toFixed(0)}</span> + <span class="val-headway">10</span>) = <span class="val-result">${Math.max(1580, 1574 + delay).toFixed(0)}</span>`
      : `actual = max(<span class="val-scheduled">${1580}</span>, <span class="val-upstream">${(1574 + delay).toFixed(0)}</span>) = <span class="val-scheduled">${1580}</span> · no conflict`;
  }

  // ── Threshold annotation ──
  const threshLine = sandboxEl.thresholdLine();
  if (threshLine) {
    const threshPct = (sandboxState.thresholdMin / 30) * 100;
    threshLine.style.left = `${threshPct}%`;
  }

  // ── API status ──
  const dot = sandboxEl.statusDot();
  const lbl = sandboxEl.statusLabel();
  if (dot) dot.className = `status-dot ${sandboxState.apiOnline ? 'is-online' : ''}`;
  if (lbl) lbl.textContent = sandboxState.apiOnline ? 'LIVE GRAPH ENGINE' : 'LOCAL FALLBACK';
}

// ── Slider handler (debounced) ─────────────────────────────────────────
function onSliderInput(e) {
  const delay = parseFloat(e.target.value);

  // Immediate visual update with local fallback for responsiveness
  const localResult = computeLocalFallback(delay);
  updateSandboxVisuals(localResult);

  // Debounced API call for real result
  clearTimeout(sandboxState.debounceTimer);
  sandboxState.debounceTimer = setTimeout(async () => {
    const apiResult = await fetchSandboxResult(delay);
    updateSandboxVisuals(apiResult);
  }, 150);
}

// ── Initialize ─────────────────────────────────────────────────────────
function initSandbox() {
  const slider = sandboxEl.slider();
  if (!slider) return;

  slider.addEventListener('input', onSliderInput);

  // Initial state
  const initialResult = computeLocalFallback(0);
  updateSandboxVisuals(initialResult);

  // Try to reach API for initial accuracy
  fetchSandboxResult(0).then(result => updateSandboxVisuals(result));

  // Add ambient floating animation to trains
  addAmbientMotion();
}

// ── Ambient motion (subtle floating) ───────────────────────────────────
function addAmbientMotion() {
  // The CSS handles the float animation via @keyframes.
  // Here we add randomized particle generation for steam/dust.
  const scene = sandboxEl.sceneSurface();
  if (!scene) return;

  function spawnParticle(x, y) {
    const p = document.createElement('div');
    p.className = 'steam-particle';
    p.style.left = `${x}%`;
    p.style.top = `${y}%`;
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 20}px`);
    scene.appendChild(p);
    setTimeout(() => p.remove(), 2500);
  }

  setInterval(() => {
    const train1 = sandboxEl.train1();
    if (train1) {
      const rect = train1.getBoundingClientRect();
      const sceneRect = scene.getBoundingClientRect();
      const x = ((rect.left - sceneRect.left + rect.width * 0.3) / sceneRect.width) * 100;
      const y = ((rect.top - sceneRect.top - 5) / sceneRect.height) * 100;
      spawnParticle(x, y);
    }
  }, 800);
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSandbox);
} else {
  initSandbox();
}
