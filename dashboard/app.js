
async function fetchSystemMode() {
  try {
    const res = await fetch(`${API_BASE}/system/mode`);
    if (!res.ok) return;
    const data = await res.json();
    const badge = $('#mode-badge');
    if (badge) {
      badge.style.display = 'inline-block';
      if (data.mode === 'REPLAY') {
        badge.textContent = 'REPLAY MODE - recorded data';
        badge.style.background = '#eab308'; // yellow-500
        badge.style.color = '#000';
      } else {
        badge.textContent = 'LIVE MODE';
        badge.style.background = '#22c55e'; // green-500
        badge.style.color = '#fff';
      }
    }
  } catch (err) {
    console.error('Failed to fetch system mode', err);
  }
}

const API_BASE = (window.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const DEMO_TRAIN = '20507';
const JUNCTION_TRAINS = ['12301', '12302', '12951', '12952', '12625'];

const state = {
  trainId: DEMO_TRAIN,
  prediction: null, passenger: null, station: null, graphDemo: null,
  crew: null, feeder: null, maintenance: null,
  junctionData: [],
  tracing: false, online: false,
};

const $ = (selector) => document.querySelector(selector);
const formatMinutes = (value) => value == null ? '--' : `${Number(value).toFixed(1)} min`;
const formatClock = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
const formatClockIST = (isoStr) => {
  if (!isoStr) return '--:--';
  return new Date(isoStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
};

// ── Connection ────────────────────────────────────────────────────────────────
function setConnection(online) {
  state.online = online;
  $('#connection-dot').classList.toggle('is-online', online);
  $('#connection-label').textContent = online ? 'API ONLINE' : 'DEMO DATA / API OFFLINE';
}
function showNotice(message = '') { $('#notice').textContent = message; }

// ── API fetch helper ──────────────────────────────────────────────────────────
async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error((await response.json()).detail || `API ${response.status}`);
  return response.json();
}

async function fetchPipelineStatus() {
  const modeEl = $('#pipeline-mode');
  const healthEl = $('#pipeline-health');
  const modelEl = $('#pipeline-model');
  try {
    const [mode, health] = await Promise.all([apiGet('/system/mode'), apiGet('/health')]);
    const replay = mode.mode === 'REPLAY';
    $('#station-stamp').textContent = replay ? 'REPLAY SNAPSHOT' : 'LIVE SNAPSHOT';
    const modeBadge = $('#mode-badge');
    if (modeBadge) {
      modeBadge.style.display = 'inline-block';
      modeBadge.textContent = replay ? 'REPLAY MODE · recorded input' : 'LIVE MODE';
      modeBadge.className = replay ? 'mode-replay' : 'mode-live';
    }
    modeEl.textContent = replay ? 'REPLAY' : 'LIVE';
    modeEl.className = replay ? 'status-replay' : 'status-live';
    healthEl.textContent = health.status === 'ok' ? 'ONLINE' : 'DEGRADED';
    healthEl.className = health.status === 'ok' ? 'status-live' : 'status-degraded';
    modelEl.textContent = health.model_loaded ? 'READY' : 'DEGRADED';
    modelEl.className = health.model_loaded ? 'status-live' : 'status-degraded';
    $('#pipeline-explanation').textContent = replay
      ? 'Recorded input path; prediction is real, data source is replay.'
      : 'Live input path; prediction is served by the active API.';
  } catch (error) {
    modeEl.textContent = 'UNKNOWN';
    healthEl.textContent = 'OFFLINE';
    modelEl.textContent = 'UNAVAILABLE';
    modeEl.className = healthEl.className = modelEl.className = 'status-degraded';
    $('#pipeline-explanation').textContent = 'API unavailable; no operational prediction is being displayed.';
  }
}

function renderPipelineStatus() {
  const prediction = state.prediction;
  const modelEl = $('#pipeline-model');
  if (!modelEl || !prediction) return;
  const degraded = prediction.degraded || prediction.anomaly_flag || String(prediction.status).includes('SUSPENDED');
  modelEl.textContent = degraded ? 'DEGRADED / GUARDED' : 'READY';
  modelEl.className = degraded ? 'status-degraded' : 'status-live';
  if (degraded) {
    $('#pipeline-explanation').textContent = prediction.anomaly_flag
      ? 'Anomaly gate active; manual control charts required.'
      : 'Degraded prediction path; confidence is explicitly limited.';
  }
}

// ── Build feeder cutoff ISO string from local time input ──────────────────────
function getFeederCutoffISO() {
  const timeVal = $('#feeder-cutoff-input').value || '03:00';
  const [h, m] = timeVal.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  // If the time already passed today, push to tomorrow
  if (d < new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// ── Demo fallbacks (shown when API is offline) ────────────────────────────────
const DEMO_PREDICTION = {
  train_id: DEMO_TRAIN, status: 'PREDICTION ACTIVE',
  p10_delay_min: 18.2, p50_delay_min: 26.5, p90_delay_min: 38.1,
  anomaly_flag: false, uncertainty_mode: false, conflict_adjustment_min: 0,
};
const DEMO_PASSENGER = {
  train_id: DEMO_TRAIN, status: 'DEMO DATA', delay_min: 26.5,
  trend: 'stable', next_update_at: null, message: 'Start the API to load a real prediction.',
};
const DEMO_STATION = {
  train_id: DEMO_TRAIN, status: 'DEMO DATA', platform_commit: 'DEFER',
  time_until_decision_needed_min: 70.1, p10_delay_min: 18.2, p90_delay_min: 38.1,
  message: 'Defer platform commitment until uncertainty narrows.',
};
const DEMO_GRAPH = {
  status: 'API UNAVAILABLE', section: 'KANPUR → ALLAHABAD',
  delaying_train: '56789', affected_train: '12301',
  source_delay_min: 15, base_delay_min: 55,
  conflict_addition_min: 9, final_delay_min: 64,
  message: 'Start the API to load the graph result.',
};
const DEMO_CREW = {
  train_id: DEMO_TRAIN, status: 'DEMO DATA',
  relief_dispatch_deadline: (() => { const d = new Date(); d.setHours(d.getHours() + 2); return d.toISOString(); })(),
  predicted_delay_min: 26.5, message: 'Dispatch relief against the predicted arrival window.',
};
const DEMO_FEEDER = {
  train_id: DEMO_TRAIN, status: 'DEMO DATA',
  cutoff_time: (() => { const d = new Date(); d.setHours(d.getHours() + 1, 30, 0, 0); return d.toISOString(); })(),
  probability_arrival_before_cutoff: 0.73,
  recommendation: 'USE JUDGMENT', message: 'Use dispatcher judgment with the current interval.',
};
const DEMO_MAINTENANCE = {
  train_id: DEMO_TRAIN, status: 'DEMO DATA',
  available_turnaround_min: 321.9, maintenance_window_adequate: true,
  message: 'Standard turnaround window remains available.',
};

// ── Load all data ─────────────────────────────────────────────────────────────
async function loadData() {
  state.trainId = $('#train-id').value.trim() || DEMO_TRAIN;
  state.tracing = false;
  showNotice('Refreshing calibrated signal…');

  const id = encodeURIComponent(state.trainId);

  try {
    const [prediction, station, graphDemo] = await Promise.all([
      apiGet(`/predict/${id}`),
      apiGet(`/predict/${id}/station-master`),
      apiGet('/graph/demo'),
    ]);
    Object.assign(state, { prediction, station, graphDemo });
    setConnection(true);
    showNotice('');
  } catch (error) {
    Object.assign(state, { prediction: null, station: null, graphDemo: null });
    setConnection(false);
    showNotice(`API unavailable: ${error.message}. Station Master controls are suspended.`);
  }

  renderAll();
  renderPipelineStatus();
}

// ── Re-fetch feeder only (when time picker changes) ───────────────────────────
async function reloadFeeder() {
  const id = encodeURIComponent(state.trainId);
  const cutoffISO = encodeURIComponent(getFeederCutoffISO());
  try {
    state.feeder = await apiGet(`/predict/${id}/feeder-transport?cutoff_time=${cutoffISO}`);
  } catch {
    state.feeder = { ...DEMO_FEEDER };
  }
  renderFeeder();
}

// ── Junction table (parallel fetches for 5 trains) ───────────────────────────
async function loadJunctionTable() {
  const tbody = $('#junction-body');
  tbody.innerHTML = '<tr><td colspan="6" class="junction-loading">Loading junction data…</td></tr>';
  try {
    const results = await Promise.allSettled(
      JUNCTION_TRAINS.map(async (tid) => {
        const [pred, sm] = await Promise.all([
          apiGet(`/predict/${encodeURIComponent(tid)}`),
          apiGet(`/predict/${encodeURIComponent(tid)}/station-master`),
        ]);
        return { tid, pred, sm };
      })
    );
    const rows = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .sort((a, b) => (a.pred.p50_delay_min ?? 0) - (b.pred.p50_delay_min ?? 0));

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="junction-loading">No data — API offline. Start the server to load junction data.</td></tr>';
      return;
    }

    const maxDelay = Math.max(...rows.map(r => r.pred.p90_delay_min ?? 0), 60);
    tbody.innerHTML = rows.map(({ tid, pred, sm }) => {
      const p50 = pred.p50_delay_min != null ? pred.p50_delay_min.toFixed(1) : '--';
      const interval = pred.p10_delay_min != null
        ? `${pred.p10_delay_min.toFixed(0)}–${pred.p90_delay_min.toFixed(0)} min` : '--';
      const commit = sm.platform_commit;
      const commitClass = commit === 'COMMIT' ? 'jc-commit' : commit === 'DEFER' ? 'jc-defer' : 'jc-suspended';
      const deadline = sm.time_until_decision_needed_min != null
        ? `${sm.time_until_decision_needed_min.toFixed(0)} min` : '--';
      const barPct = pred.p50_delay_min != null ? Math.min(100, (pred.p50_delay_min / maxDelay) * 100) : 0;
      const isSelected = tid === state.trainId;
      return `<tr class="${isSelected ? 'junction-row-active' : ''}">
        <td class="jt-train">${tid}${isSelected ? ' <span class="jt-selected-tag">SELECTED</span>' : ''}</td>
        <td class="jt-mono">${p50}</td>
        <td class="jt-mono jt-interval">${interval}</td>
        <td><span class="jt-commit ${commitClass}">${commit}</span></td>
        <td class="jt-mono">${deadline}</td>
        <td class="bar-col"><div class="delay-bar-mini"><div class="delay-bar-fill" style="width:${barPct}%"></div></div></td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="junction-loading">Junction data unavailable — API offline.</td></tr>';
  }
}

// ── Render: Passenger ─────────────────────────────────────────────────────────
function renderPassenger() {
  const p = state.prediction;
  const pax = state.passenger;
  if (!p || !pax) return;

  $('#passenger-train').textContent = `TRAIN ${pax.train_id}`;
  $('#passenger-updated').textContent = `UPDATED ${formatClockIST(new Date().toISOString())}`;

  const trend = (pax.trend || 'unknown').toLowerCase();
  const trendEl = $('#passenger-trend');
  trendEl.textContent = trend.toUpperCase();
  trendEl.className = 'trend-chip';
  if (trend === 'worsening') trendEl.classList.add('trend-worsening');
  else if (trend === 'improving') trendEl.classList.add('trend-improving');
  else if (trend === 'stable') trendEl.classList.add('trend-stable');
  else trendEl.classList.add('trend-unknown');

  $('#passenger-next-update').textContent = formatClockIST(pax.next_update_at);

  const flagEl = $('#passenger-safety-flag');
  const deadlineVal = $('#passenger-deadline-input').value;
  let deadlineMinutes = null;
  if (deadlineVal) {
    const [h, m] = deadlineVal.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d < new Date()) d.setDate(d.getDate() + 1);
    deadlineMinutes = (d - new Date()) / 60000;
  }

  // Feature 2: Anomaly gate honesty
  if (p.anomaly_flag || p.status.includes('SUSPENDED')) {
    $('#passenger-delay').innerHTML = `--<span>min late</span>`;
    $('#passenger-message').textContent = "Unusual conditions detected — we're being extra cautious rather than giving you an unreliable estimate right now.";
    $('#passenger-window').textContent = "PREDICTION SUSPENDED";
    $('#range-p10').textContent = "ANOMALY";
    $('#range-p50-label').textContent = "";
    $('#range-p90').textContent = "GATE ACTIVE";
    $('#range-p50').style.display = 'none';
    const fill = document.querySelector('#passenger-view .range-fill');
    if (fill) { fill.style.left = '0%'; fill.style.width = '100%'; fill.style.background = 'var(--red)'; }
    if (flagEl) {
      flagEl.textContent = 'DEFER TO ANOMALY GATE';
      flagEl.style.color = 'var(--red)';
      flagEl.style.borderColor = 'var(--red)';
    }
  } else {
    $('#passenger-delay').innerHTML = p.p50_delay_min != null ? `${p.p50_delay_min.toFixed(0)}<span>min late</span>` : `--<span>min late</span>`;
    $('#passenger-message').textContent = pax.message;
    if (p.p10_delay_min != null && p.p90_delay_min != null) {
      $('#passenger-window').textContent = `${p.p10_delay_min.toFixed(0)} to ${p.p90_delay_min.toFixed(0)} min`;
      const width = Math.max(1, p.p90_delay_min - p.p10_delay_min);
      const marker = Math.max(4, Math.min(96, ((p.p50_delay_min - p.p10_delay_min) / width) * 100));
      $('#range-p50').style.display = 'block';
      $('#range-p50').style.left = `${marker}%`;
      $('#range-p10').textContent = `LOWER ${p.p10_delay_min.toFixed(0)}`;
      $('#range-p50-label').textContent = `P50 ${p.p50_delay_min.toFixed(0)}`;
      $('#range-p90').textContent = `UPPER ${p.p90_delay_min.toFixed(0)}`;
      const fill = document.querySelector('#passenger-view .range-fill');
      if (fill) { fill.style.background = 'linear-gradient(90deg, var(--teal-deep), var(--amber))'; fill.style.left='0%'; fill.style.width='100%'; }

      // Feature 1
      if (flagEl && deadlineMinutes != null) {
        if (p.p90_delay_min < deadlineMinutes - 30) {
          flagEl.textContent = "Safe to leave";
          flagEl.style.color = "var(--teal)";
          flagEl.style.borderColor = "var(--teal)";
        } else if (p.p90_delay_min > deadlineMinutes) {
          flagEl.textContent = "Wait — high risk of missing it";
          flagEl.style.color = "var(--red)";
          flagEl.style.borderColor = "var(--red)";
        } else {
          flagEl.textContent = "Cutting it close";
          flagEl.style.color = "var(--amber)";
          flagEl.style.borderColor = "var(--amber)";
        }
      }
    }
  }
  
  const hasRealConflict = p.conflict_adjustment_min > 0;
  $('#passenger-conflict').textContent = hasRealConflict
    ? `Prediction includes +${p.conflict_adjustment_min.toFixed(1)} min conflict adjustment`
    : 'No conflict in current prediction (live data lacks paired station state)';
}

// ── Render: Station ───────────────────────────────────────────────────────────
function renderStation() {
  const p = state.prediction;
  const station = state.station;
  if (!p || !station) {
    $('#station-decision').textContent = 'OFFLINE';
    $('#station-decision').style.color = 'var(--red)';
    $('#station-message').textContent = 'No API prediction available. Platform commitment is suspended.';
    $('#station-p10').textContent = '--';
    $('#station-p50').textContent = '--';
    $('#station-p90').textContent = '--';
    $('#station-width').textContent = '--';
    $('#station-deadline').textContent = '--';
    $('#station-state').textContent = 'API OFFLINE';
    return;
  }

  const isSuspended = p.anomaly_flag || p.status.includes('SUSPENDED');
  $('#station-train-label').textContent = p.train_id || state.trainId;
  
  const card = document.querySelector('#station-decision-card');
  const decisionEl = $('#station-decision');
  const msgEl = $('#station-message');
  
  // Feature 2: Anomaly gate honesty for Station Master
  if (isSuspended) {
    decisionEl.textContent = 'SUSPENDED';
    decisionEl.style.color = 'var(--red)';
    if (card) card.style.borderColor = 'var(--red)';
    msgEl.textContent = "Unusual conditions detected — prediction suspended. Use manual control charts.";
    
    $('#station-p10').textContent = '--';
    $('#station-p50').textContent = '--';
    $('#station-p90').textContent = '--';
    $('#station-width').textContent = '--';
  } else {
    decisionEl.textContent = station.platform_commit;
    decisionEl.style.color = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
    if (card) card.style.borderColor = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
    msgEl.textContent = station.message;
    
    $('#station-p10').textContent = p.p10_delay_min == null ? '--' : p.p10_delay_min.toFixed(1);
    $('#station-p50').textContent = p.p50_delay_min == null ? '--' : p.p50_delay_min.toFixed(1);
    $('#station-p90').textContent = p.p90_delay_min == null ? '--' : p.p90_delay_min.toFixed(1);
    $('#station-width').textContent = p.p10_delay_min == null ? '--' : `${(p.p90_delay_min - p.p10_delay_min).toFixed(1)} min`;
  }
  
  $('#station-deadline').textContent = station.time_until_decision_needed_min == null ? '--' : `${station.time_until_decision_needed_min.toFixed(1)} min`;
  $('#station-state').textContent = p.status;

  // Feature 3: Station master platform/section conflict forecast
  // We use track section conflicts because platform data doesn't exist.
  const conflictArea = $('#station-conflict-forecast');
  const conflictDetail = $('#station-conflict-detail');
  
  if (p.conflict_adjustment_min > 0 && state.graphDemo) {
      if (conflictArea) conflictArea.style.display = 'block';
      if (conflictDetail) conflictDetail.textContent = `Conflict with Train ${state.graphDemo.delaying_train} on ${state.graphDemo.section} (+${p.conflict_adjustment_min.toFixed(1)}m)`;
      $('#station-conflict').textContent = `+${p.conflict_adjustment_min.toFixed(1)} min / AMBER`;
  } else {
      if (conflictArea) conflictArea.style.display = 'none';
      $('#station-conflict').textContent = p.conflict_adjustment_min > 0 ? `+${p.conflict_adjustment_min.toFixed(1)} min / AMBER` : 'None / CLEAR';
  }
}

// ── Render: Crew Controller ───────────────────────────────────────────────────
function renderCrew() {
  const crew = state.crew;
  if (!crew) return;

  $('#crew-clock').textContent = formatClockIST(crew.relief_dispatch_deadline);
  $('#crew-delay').textContent = crew.predicted_delay_min != null ? crew.predicted_delay_min.toFixed(1) : '--';
  $('#crew-status').textContent = crew.status;
  $('#crew-message').textContent = crew.message;

  const badge = $('#crew-action-badge');
  if (!crew.relief_dispatch_deadline) {
    badge.textContent = 'SUSPEND AUTOMATED TIMING';
    badge.className = 'crew-action-badge crew-badge-suspend';
  } else {
    badge.textContent = '⟶ DISPATCH RELIEF';
    badge.className = 'crew-action-badge crew-badge-dispatch';
  }
}

// ── Render: Feeder Transport ──────────────────────────────────────────────────
function renderFeeder() {
  const feeder = state.feeder;
  const pred = state.prediction;
  if (!feeder) return;

  const prob = feeder.probability_arrival_before_cutoff;
  const probPct = prob != null ? `${Math.round(prob * 100)}%` : '--%';
  $('#feeder-probability').textContent = probPct;

  const probEl = $('#feeder-probability');
  probEl.className = 'probability-hero';
  if (prob != null) {
    if (prob >= 0.8) probEl.classList.add('prob-high');
    else if (prob < 0.4) probEl.classList.add('prob-low');
    else probEl.classList.add('prob-mid');
  }

  const rec = feeder.recommendation;
  const recEl = $('#feeder-recommendation');
  recEl.textContent = rec;
  recEl.className = 'recommendation-badge';
  if (rec === 'WAIT') recEl.classList.add('rec-wait');
  else if (rec === 'DEPART') recEl.classList.add('rec-depart');
  else if (rec === 'USE JUDGMENT') recEl.classList.add('rec-judgment');
  else recEl.classList.add('rec-hold');

  $('#feeder-message').textContent = feeder.message;

  // Interval vs cutoff strip
  if (pred && pred.p10_delay_min != null) {
    const p10 = pred.p10_delay_min, p90 = pred.p90_delay_min, p50 = pred.p50_delay_min;
    const minutesUntilCutoff = (() => {
      try {
        return (new Date(feeder.cutoff_time) - new Date()) / 60000;
      } catch { return p90 + 30; }
    })();
    const maxScale = Math.max(p90 + 20, minutesUntilCutoff + 10);
    const p10Pct = Math.max(0, Math.min(100, (p10 / maxScale) * 100));
    const p90Pct = Math.max(0, Math.min(100, (p90 / maxScale) * 100));
    const p50Pct = Math.max(0, Math.min(100, (p50 / maxScale) * 100));
    const cutoffPct = Math.max(0, Math.min(100, (minutesUntilCutoff / maxScale) * 100));

    const fill = $('#feeder-strip-fill');
    fill.style.left = `${p10Pct}%`;
    fill.style.width = `${p90Pct - p10Pct}%`;
    $('#feeder-strip-p50-marker').style.left = `${p50Pct}%`;
    $('#feeder-strip-cutoff-marker').style.left = `${cutoffPct}%`;

    $('#feeder-scale-p10').textContent = `P10 ${p10.toFixed(0)}m`;
    $('#feeder-scale-p50').textContent = `P50 ${p50.toFixed(0)}m`;
    $('#feeder-scale-p90').textContent = `P90 ${p90.toFixed(0)}m`;
    $('#feeder-scale-cutoff').textContent = `CUTOFF ${minutesUntilCutoff.toFixed(0)}m`;
  }
}

// ── Render: Maintenance Yard ──────────────────────────────────────────────────
function renderMaintenance() {
  const maint = state.maintenance;
  const pred = state.prediction;
  if (!maint) return;

  const avail = maint.available_turnaround_min;
  $('#maintenance-minutes').textContent = avail != null ? avail.toFixed(0) : '--';
  $('#maintenance-p90').textContent = pred && pred.p90_delay_min != null ? pred.p90_delay_min.toFixed(1) : '--';
  $('#maintenance-message').textContent = maint.message;

  // Progress bar
  const barEl = $('#maintenance-bar');
  if (avail != null) {
    const pct = Math.max(0, Math.min(100, (avail / 360) * 100));
    barEl.style.width = `${pct}%`;
    barEl.className = 'turnaround-bar-fill';
    if (avail >= 180) barEl.classList.add('bar-adequate');
    else if (avail >= 90) barEl.classList.add('bar-compressed');
    else barEl.classList.add('bar-critical');
  }

  // Adequacy badge
  const adequate = maint.maintenance_window_adequate;
  const adequacyEl = $('#maintenance-adequacy');
  const crewEl = $('#maintenance-crew-mode');

  if (avail == null || adequate == null) {
    adequacyEl.textContent = 'SUSPENDED';
    adequacyEl.className = 'adequacy-badge adequacy-suspended';
    crewEl.textContent = 'UNKNOWN';
    crewEl.style.color = 'var(--muted)';
  } else if (avail < 90) {
    adequacyEl.textContent = '⚠ CRITICAL — ESCALATE';
    adequacyEl.className = 'adequacy-badge adequacy-critical';
    crewEl.textContent = 'RAPID INTERVENTION';
    crewEl.style.color = 'var(--red)';
  } else if (avail < 180) {
    adequacyEl.textContent = 'COMPRESSED WINDOW';
    adequacyEl.className = 'adequacy-badge adequacy-compressed';
    crewEl.textContent = 'RAPID CLEANING';
    crewEl.style.color = 'var(--amber)';
  } else {
    adequacyEl.textContent = '✓ ADEQUATE';
    adequacyEl.className = 'adequacy-badge adequacy-ok';
    crewEl.textContent = 'STANDARD TURNAROUND';
    crewEl.style.color = 'var(--teal)';
  }

  // Amber card border change when critical
  const actionCard = $('#maintenance-action-card');
  actionCard.style.borderColor = avail != null && avail < 90 ? 'var(--red)' : '';
}

// ── Render: Network ───────────────────────────────────────────────────────────
function renderNetwork() {
  const p = state.prediction;
  const graph = state.graphDemo;
  const hasGraph = graph && graph.base_delay_min != null;
  $('#network-before').textContent = hasGraph ? `12301 · +${graph.base_delay_min.toFixed(1)} min base delay (fixed scenario)` : 'Scenario graph unavailable';
  $('#network-after').textContent = hasGraph && state.tracing ? `12301 · +${graph.final_delay_min.toFixed(1)} min after conflict propagation` : hasGraph ? '12301 · click replay to run scenario' : 'Start API to load graph';
  $('#network-state').textContent = state.tracing ? 'REPLAYED' : 'READY';
  $('#network-canvas').classList.toggle('is-tracing', state.tracing);
  $('#trace-conflict').textContent = state.tracing ? '⏹ CLEAR REPLAY' : '▶ SCENARIO REPLAY — station-pair conflict example';
  $('#conflict-path span').textContent = hasGraph ? `+${graph.conflict_addition_min.toFixed(0)} MIN PROPAGATED (SCENARIO)` : 'GRAPH UNAVAILABLE';
  const hasRealConflict = p && p.conflict_adjustment_min > 0;
  $('#passenger-conflict').textContent = hasRealConflict
    ? `Prediction includes +${p.conflict_adjustment_min.toFixed(1)} min conflict adjustment`
    : 'No conflict in current prediction (live data lacks paired station state)';
}

// ── Render all ────────────────────────────────────────────────────────────────
function renderAll() {
  renderStation();
  renderNetwork();
}

// ── View switching ────────────────────────────────────────────────────────────
function setView(view) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view));
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.toggle('is-hidden', panel.dataset.panel !== view));
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function startClock() {
  const tick = () => { $('#clock').textContent = `${new Date().toLocaleTimeString([], { hour12: false })} IST`; };
  tick();
  setInterval(tick, 1000);
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
$('#refresh-button').addEventListener('click', loadData);
$('#train-id').addEventListener('change', loadData);
$('#trace-conflict').addEventListener('click', () => { state.tracing = !state.tracing; renderNetwork(); });
$('#trace-passenger').addEventListener('click', () => { state.tracing = true; setView('network'); renderNetwork(); });
$('#feeder-cutoff-input').addEventListener('change', reloadFeeder);

startClock();
fetchPipelineStatus();
loadData();
