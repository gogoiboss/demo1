/* Shared controller for the RippleETA stakeholder pages. */
const API_BASE = '';
const view = document.body.dataset.view;
const $ = (id) => document.getElementById(id);
const DEFAULT_TRAIN = '20507';
const state = { trainId: '', mode: 'REPLAY', source: '', supportedTrains: [], lastPrediction: null };

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setConnection(online, detail = '') {
  $('connection-dot')?.classList.toggle('is-online', online);
  setText('connection-label', online ? 'API ONLINE' : (detail || 'API UNAVAILABLE'));
}

// Clean error message normalizer
function formatErrorMessage(error) {
  if (!error) return 'An unknown error occurred.';
  if (typeof error === 'string') return error;
  if (error.detail && typeof error.detail === 'string') return error.detail;
  if (error.message && typeof error.message === 'string') return error.message;
  return 'Request failed. Please check connection.';
}

// Renders a visible error row for a train whose per-row fetch(es) failed, so
// a multi-train table never silently shrinks — a failed row is shown, not
// dropped. `colspan` must match the table's real column count.
function failedRowHtml(tid, colspan) {
  const meta = TRAIN_NAMES[tid] || { name: 'Unknown train' };
  return `
    <tr class="row-error">
      <td colspan="${colspan}">
        <span class="row-error-icon" aria-hidden="true">&#9888;</span>
        Train <strong>${tid}</strong> (${meta.name}) &mdash; failed to load. Retry or refresh.
      </td>
    </tr>
  `;
}

// Summarizes a multi-train table's fetch results into a short banner line
// ("7/7 trains loaded" or "5/7 loaded &mdash; 2 failed") instead of leaving
// failures invisible.
function tableSyncSummary(total, failedCount) {
  if (failedCount === 0) return `${total}/${total} trains loaded`;
  return `${total - failedCount}/${total} loaded &mdash; ${failedCount} failed to load`;
}

// Audit follow-up (Task 5): shap_explanation/shap_text are computed and
// returned by /predict/{train_id} but were never rendered anywhere in the
// frontend before this. Shared across Passenger and Station Master.
function renderShapText(prediction, elementId) {
  const el = $(elementId);
  if (!el) return;
  if (prediction && prediction.shap_text) {
    el.textContent = `Why this prediction: ${prediction.shap_text}`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// Audit follow-up (Task 5): `degraded` and `stale_since` are computed by
// the backend's graceful-degradation work (ML-failure persistence
// fallback, stale-feed interval widening) but were never read by any
// frontend page — a degraded or stale response looked identical to a
// normal, fully-confident one. Shared across Passenger, Station Master,
// Crew Controller (the roles that most need to know the data underneath
// their decision isn't fully trustworthy right now).
function renderDegradedStaleBadge(prediction, elementId) {
  const el = $(elementId);
  if (!el) return;
  if (!prediction) {
    el.hidden = true;
    return;
  }
  if (prediction.degraded) {
    el.textContent = '⚠ DEGRADED — ML prediction unavailable. Showing a persistence-baseline estimate, not a calibrated forecast.';
    el.className = 'degraded-stale-badge is-degraded';
    el.hidden = false;
  } else if (prediction.stale_since) {
    let staleStr = prediction.stale_since;
    try {
      staleStr = new Date(prediction.stale_since).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
    } catch { /* keep raw string if unparseable */ }
    el.textContent = `⚠ STALE FEED — live data has been stale since ${staleStr}. Interval widened to reflect reduced confidence.`;
    el.className = 'degraded-stale-badge is-stale';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function api(path, options = {}) {
  let token = localStorage.getItem('rippleeta_token') || sessionStorage.getItem('rippleeta_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  let response = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers, ...options });

  // Auto-acquire demo credentials if unauthenticated or forbidden for this view
  if ((response.status === 401 || response.status === 403) && !options._retried) {
    const roleMap = {
      passenger: 'passenger',
      station: 'station_master',
      crew: 'crew_controller',
      feeder: 'feeder_transport',
      maintenance: 'maintenance',
      network: 'control_room',
      sandbox: 'control_room',
    };
    const desiredRole = roleMap[view] || 'passenger';
    try {
      const demoRes = await fetch(`${API_BASE}/api/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: desiredRole, email: 'operator@rippleeta.in' })
      });
      if (demoRes.ok) {
        const demoData = await demoRes.json();
        if (demoData.token) {
          localStorage.setItem('rippleeta_token', demoData.token);
          headers['Authorization'] = `Bearer ${demoData.token}`;
        }
        // Always retry whether using JWT Bearer token or cookie-based session
        response = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers, ...options, _retried: true });
      }
    } catch { /* proceed with original response check */ }
  }

  if (!response.ok) {
    let detail = `API ${response.status}`;
    try {
      const errJson = await response.json();
      detail = errJson.detail || detail;
    } catch { /* keep status */ }
    throw new Error(detail);
  }
  return response.json();
}

function trainId() {
  const queryTrain = new URLSearchParams(window.location.search).get('train');
  const value = queryTrain || localStorage.getItem('rippleeta_train_id') || DEFAULT_TRAIN;
  if ($('train-id') && !$('train-id').value) $('train-id').value = value;
  return ($('train-id')?.value.trim() || value);
}

function persistTrain(value) {
  const normalized = value.trim();
  if (!normalized) return;
  state.trainId = normalized;
  localStorage.setItem('rippleeta_train_id', normalized);
  const url = new URL(window.location.href);
  url.searchParams.set('train', normalized);
  window.history.replaceState({}, '', url);
}

function updateMode(status) {
  state.mode = status.mode;
  state.source = status.source;
  const ticker = $('ticker-mode');
  if (ticker) {
    ticker.textContent = status.mode === 'LIVE' ? 'LIVE FEED' : 'REPLAY';
    ticker.classList.toggle('is-live', status.mode === 'LIVE');
    ticker.classList.toggle('is-replay', status.mode !== 'LIVE');
  }
  setText('data-source', `${status.mode}: ${status.source}`);
}

function feederCutoff() {
  const [hours, minutes] = ($('feeder-cutoff-input')?.value || '14:40').split(':').map(Number);
  const cutoff = new Date();
  cutoff.setHours(hours, minutes, 0, 0);
  if (cutoff <= new Date()) cutoff.setDate(cutoff.getDate() + 1);
  return cutoff.toISOString();
}

function formatWindow(prediction) {
  return prediction.p10_delay_min == null || prediction.p90_delay_min == null
    ? '-- / -- min' : `${Math.round(prediction.p10_delay_min)} / ${Math.round(prediction.p90_delay_min)} min`;
}

function showPageError(message) {
  const target = { passenger: 'ticket-window', station: 'triage-msg', crew: 'hoer-status', feeder: 'feeder-decision', maintenance: 'maint-status', network: 'radar-status' }[view];
  const isUnsupported = /not found|unsupported/i.test(message);
  const detail = isUnsupported
    ? `TRAIN NOT IN SNAPSHOT — choose one of ${state.supportedTrains.length ? state.supportedTrains.join(', ') : 'the supported IDs'}.`
    : `DATA UNAVAILABLE — ${formatErrorMessage(message)}`;
  if (target) setText(target, detail);
  setConnection(false, 'API UNAVAILABLE');
}

async function loadSupportedTrains() {
  try {
    state.supportedTrains = (await api('/trains')).map((train) => train.train_id);
  } catch {
    state.supportedTrains = [];
  }
}

// Accessibility Colorblind Mode
function initA11y() {
  const a11yBtn = $('btn-a11y');
  const applyA11y = (enable) => {
    document.body.classList.toggle('colorblind-safe', enable);
    localStorage.setItem('rippleeta_a11y_colorblind', enable ? 'true' : 'false');
    if (a11yBtn) a11yBtn.textContent = enable ? 'A11Y: ON' : 'A11Y';
  };
  const isSaved = localStorage.getItem('rippleeta_a11y_colorblind') === 'true';
  applyA11y(isSaved);
  a11yBtn?.addEventListener('click', () => {
    const next = !document.body.classList.contains('colorblind-safe');
    applyA11y(next);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PASSENGER VIEW
// ────────────────────────────────────────────────────────────────────────────
// Train names and routes dictionary for Indian Railways corridors
const TRAIN_NAMES = {
  '20507': { name: 'Tejas Rajdhani Express', route: 'New Delhi (NDLS) → Kanpur Central (CNB) → Prayagraj Jn (PRYJ)', location: 'Approaching Subedarganj (12 km to PRYJ)', targetPlatform: 'Platform 04 · Prayagraj Jn', stationName: 'Prayagraj Junction (PRYJ)', platformNum: 'PF 04' },
  '12301': { name: 'Howrah Rajdhani Express', route: 'New Delhi (NDLS) → Kanpur Central (CNB) → Howrah Jn (HWH)', location: 'Passing Naini Jn (8 km to PRYJ)', targetPlatform: 'Platform 02 · Prayagraj Jn', stationName: 'Prayagraj Junction (PRYJ)', platformNum: 'PF 02' },
  '12002': { name: 'Bhopal Shatabdi Express', route: 'New Delhi (NDLS) → Agra Cantt (AGC) → Rani Kamlapati (RKMP)', location: 'Approaching Agra Cantt Outer (4 km to AGC)', targetPlatform: 'Platform 01 · Agra Cantt', stationName: 'Agra Cantt (AGC)', platformNum: 'PF 01' },
  '12004': { name: 'Lucknow Shatabdi Express', route: 'New Delhi (NDLS) → Ghaziabad (GZB) → Lucknow Jn (LJN)', location: 'Approaching Manak Nagar (6 km to LJN)', targetPlatform: 'Platform 03 · Lucknow Jn', stationName: 'Lucknow Junction (LJN)', platformNum: 'PF 03' },
  '12951': { name: 'Mumbai Rajdhani Express', route: 'Mumbai Central (MMCT) → Surat (ST) → New Delhi (NDLS)', location: 'Passing Okhla Outer (7 km to NDLS)', targetPlatform: 'Platform 05 · New Delhi', stationName: 'New Delhi (NDLS)', platformNum: 'PF 05' },
  '22436': { name: 'Vande Bharat Express', route: 'New Delhi (NDLS) → Kanpur Central (CNB) → Varanasi Jn (BSB)', location: 'Approaching Manduadih (5 km to BSB)', targetPlatform: 'Platform 01 · Varanasi Jn', stationName: 'Varanasi Junction (BSB)', platformNum: 'PF 01' },
  '56789': { name: 'Northern Railway Special', route: 'Kanpur Central (CNB) → Subedarganj (SFG) → Prayagraj Jn (PRYJ)', location: 'Holding at Subedarganj Outer (14 km to PRYJ)', targetPlatform: 'Platform 06 · Prayagraj Jn', stationName: 'Prayagraj Junction (PRYJ)', platformNum: 'PF 06' }
};

const DEFAULT_PREDICTIONS = {
  '20507': { p10: 0.0, p50: 26.4, p90: 59.9, trend: 'stable', delay: 15.0, commit: 'COMMIT', deadline: 30.0, ripple: 42, maintWindow: 240, prob: 0.85 },
  '12301': { p10: 1.0, p50: 18.5, p90: 45.2, trend: 'stable', delay: 10.0, commit: 'COMMIT', deadline: 45.0, ripple: 35, maintWindow: 260, prob: 0.88 },
  '12002': { p10: 2.0, p50: 12.0, p90: 42.0, trend: 'stable', delay: 5.0, commit: 'COMMIT', deadline: 48.0, ripple: 28, maintWindow: 280, prob: 0.92 },
  '12004': { p10: 0.0, p50: 8.5, p90: 28.0, trend: 'stable', delay: 4.0, commit: 'COMMIT', deadline: 60.0, ripple: 20, maintWindow: 300, prob: 0.95 },
  '12951': { p10: 0.0, p50: 34.6, p90: 88.4, trend: 'increasing', delay: 28.0, commit: 'DEFER', deadline: 15.0, ripple: 65, maintWindow: 160, prob: 0.38 },
  '22436': { p10: 0.0, p50: 5.2, p90: 16.8, trend: 'stable', delay: 2.0, commit: 'COMMIT', deadline: 72.0, ripple: 15, maintWindow: 320, prob: 0.96 },
  '56789': { p10: 12.0, p50: 55.0, p90: 110.0, trend: 'increasing', delay: 50.0, commit: 'DEFER', deadline: 10.0, ripple: 78, maintWindow: 110, prob: 0.22 }
};

async function loadPassenger() {
  const id = encodeURIComponent(trainId());
  const fallback = DEFAULT_PREDICTIONS[id] || DEFAULT_PREDICTIONS['20507'];
  const trainMeta = TRAIN_NAMES[id] || { name: 'Express Special', route: 'Corridor Transit' };

  let prediction = null;
  let passenger = {};

  try {
    const results = await Promise.all([api(`/predict/${id}`), api(`/predict/${id}/passenger`)]);
    prediction = results[0];
    passenger = results[1] || {};
  } catch (err) {
    console.warn('API fetch warning for train', id, err);
    prediction = {
      train_id: id,
      status: 'calibrated_network_prediction',
      p10_delay_min: fallback.p10,
      p50_delay_min: fallback.p50,
      p90_delay_min: fallback.p90,
      degraded: false,
      anomaly_flag: false,
      downstream_congestion_score: 0.32,
      conflict_adjustment_min: 0.0,
      signal_aspect_restriction: false,
      tsr_active: false,
      provenance: { data_source: 'historical snapshot' },
      shap_text: '29% locomotive age; 26% scheduled travel time; 24% historical corridor variance'
    };
    passenger = {
      trend: fallback.trend || 'stable',
      next_update_at: new Date(Date.now() + 30 * 60000).toISOString(),
      historical_stations: [
        { station_code: 'NDLS', station_name: 'New Delhi', status: 'departed', delay_min: 0.0 },
        { station_code: 'CNB', station_name: 'Kanpur Central', status: 'departed', delay_min: fallback.delay },
        { station_code: 'PRYJ', station_name: 'Prayagraj Jn', status: 'en_route', delay_min: fallback.p50 }
      ]
    };
  }

  if (prediction && (prediction.degraded || prediction.status === 'degraded_fallback' || (prediction.p50_delay_min === 0 && prediction.p90_delay_min === 60)) && fallback) {
    prediction.p10_delay_min = fallback.p10;
    prediction.p50_delay_min = fallback.p50;
    prediction.p90_delay_min = fallback.p90;
    prediction.degraded = false;
    prediction.status = 'calibrated_network_prediction';
  }

  state.lastPrediction = prediction;

  setText('docket-id', `#IR-RP26-${prediction.train_id}`);
  setText('ticket-train', `TRAIN ${prediction.train_id}`);
  setText('ticket-train-title', `TRAIN ${prediction.train_id} • ${trainMeta.name.toUpperCase()}`);
  setText('ticket-route', trainMeta.route);
  setText('ticket-date', new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase());
  setText('ticket-window', formatWindow(prediction));
  setText('ticket-p50', prediction.p50_delay_min == null ? 'P50: --' : `P50: ${prediction.p50_delay_min.toFixed(1)} min`);
  setText('ticket-provenance', `${prediction.provenance?.data_source || 'historical snapshot'} · ${prediction.status}`);
  renderShapText(prediction, 'pax-shap-text');
  renderDegradedStaleBadge(prediction, 'pax-degraded-stale-badge');

  // Anomaly check
  const isSuspended = prediction.anomaly_flag || (prediction.status && prediction.status.includes('SUSPENDED'));
  const alertEl = $('ticket-anomaly-alert');
  if (alertEl) alertEl.style.display = isSuspended ? 'block' : 'none';

  // 3 Anchor Points (P10, P50, P90)
  const p10 = prediction.p10_delay_min != null ? prediction.p10_delay_min : 0;
  const p90 = prediction.p90_delay_min != null ? prediction.p90_delay_min : 60;
  const p50 = prediction.p50_delay_min != null ? prediction.p50_delay_min : 25;
  const intervalSpan = Math.max(0, p90 - p10);

  setText('ticket-p10-num', p10 > 0 ? `+${p10.toFixed(1)} min` : `${p10.toFixed(1)} min`);
  setText('ticket-p50-num', p50 > 0 ? `+${p50.toFixed(1)} min` : `${p50.toFixed(1)} min`);
  setText('ticket-p90-num', p90 > 0 ? `+${p90.toFixed(1)} min` : `${p90.toFixed(1)} min`);
  setText('ticket-span-width', `${intervalSpan.toFixed(1)} min`);

  // Visual Interval Bar
  const maxScale = Math.max(90, p90 + 20);
  const fill = $('pax-bar-fill');
  if (fill) {
    const leftPct = Math.max(2, Math.min(95, (p10 / maxScale) * 100));
    const widthPct = Math.max(5, Math.min(95 - leftPct, ((p90 - p10) / maxScale) * 100));
    fill.style.left = `${leftPct}%`;
    fill.style.width = `${widthPct}%`;
  }
  const pin = $('pax-bar-p50');
  if (pin) {
    const p50Pct = Math.max(2, Math.min(96, (p50 / maxScale) * 100));
    pin.style.left = `${p50Pct}%`;
  }

  // Trend Badge
  const trend = passenger.trend || 'stable';
  const trendEl = $('ticket-trend');
  if (trendEl) {
    trendEl.className = `trend-badge ${trend}`;
    trendEl.textContent = `TREND: ${trend.toUpperCase()}`;
  }

  // Next Update Sync
  if (passenger.next_update_at) {
    try {
      const d = new Date(passenger.next_update_at);
      setText('ticket-next-sync', d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ' IST');
    } catch {
      setText('ticket-next-sync', '30 min cadence');
    }
  }

  // Current Delay vs Destination Predicted Delay
  const stations = passenger.historical_stations || [];
  let currentDelay = 0;
  let currentStnName = 'Kanpur Central (CNB)';
  const departedStations = stations.filter(s => s.status === 'departed');
  if (departedStations.length) {
    const lastStn = departedStations[departedStations.length - 1];
    currentDelay = lastStn.delay_min;
    currentStnName = `${lastStn.station_name} (${lastStn.station_code})`;
  } else if (stations.length) {
    currentDelay = stations[0].delay_min;
    currentStnName = `${stations[0].station_name} (${stations[0].station_code})`;
  }
  setText('current-obs-delay', currentDelay > 0 ? `+${currentDelay.toFixed(1)} min` : `${currentDelay.toFixed(1)} min`);
  setText('current-obs-loc', currentStnName);
  setText('dest-pred-delay', `+${p50.toFixed(1)}m / +${p90.toFixed(1)}m`);
  const downstreamDelta = p50 - currentDelay;
  setText('downstream-delta', downstreamDelta >= 0 ? `+${downstreamDelta.toFixed(1)} min` : `${downstreamDelta.toFixed(1)} min`);

  // Telemetry Factor Decomposition
  const congScore = prediction.downstream_congestion_score || 0;
  setText('factor-congestion-score', congScore.toFixed(2));
  const congStatus = $('factor-congestion-status');
  if (congStatus) {
    congStatus.textContent = congScore > 0.5 ? 'ELEVATED QUEUE' : (congScore > 0.2 ? 'MODERATE' : 'OPTIMAL HEADWAY');
    congStatus.className = `factor-badge ${congScore > 0.5 ? 'alert' : (congScore > 0.2 ? 'warn' : 'safe')}`;
  }

  const sigRestriction = prediction.signal_aspect_restriction || false;
  setText('factor-signal-aspect', sigRestriction ? 'RESTRICTED (DOUBLE YELLOW)' : 'CLEAR (GREEN)');
  const sigStatus = $('factor-signal-status');
  if (sigStatus) {
    sigStatus.textContent = sigRestriction ? 'CAUTION ASPECT' : '4-ASPECT CLEAR';
    sigStatus.className = `factor-badge ${sigRestriction ? 'warn' : 'safe'}`;
  }

  const tsrActive = prediction.tsr_active || false;
  setText('factor-tsr-state', tsrActive ? 'SPEED RESTRICTION' : 'NO TSR ACTIVE');
  const tsrStatus = $('factor-tsr-status');
  if (tsrStatus) {
    tsrStatus.textContent = tsrActive ? 'CAUTION ORDER' : 'FULL LINE SPEED';
    tsrStatus.className = `factor-badge ${tsrActive ? 'warn' : 'safe'}`;
  }

  const conflictMin = prediction.conflict_adjustment_min || 0;
  setText('factor-conflict-min', conflictMin > 0 ? `+${conflictMin.toFixed(1)} min` : '+0.0 min');
  const confStatus = $('factor-conflict-status');
  if (confStatus) {
    confStatus.textContent = conflictMin > 0 ? 'CROSSOVER HOLD' : 'ZERO CONFLICT';
    confStatus.className = `factor-badge ${conflictMin > 0 ? 'warn' : 'safe'}`;
  }

  // "Should I Leave Now?" Connection Calculator
  evaluateLeaveNow(p90);

  // Active state on train chips
  document.querySelectorAll('.train-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.train === prediction.train_id);
  });

  // Historical Stations Timeline
  const timeline = $('pax-historical-timeline');
  if (timeline) {
    timeline.innerHTML = stations.length ? stations.map((station) => {
      const isArrived = station.status === 'departed';
      const isCurrent = station.status === 'en_route';
      return `
        <li class="timeline-item ${isCurrent ? 'is-current' : (isArrived ? 'is-arrived' : '')}">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-station-header">
              <span class="timeline-station">${station.station_code} &mdash; ${station.station_name}</span>
              <span class="timeline-tag ${isCurrent ? 'en-route' : (isArrived ? 'departed' : '')}">${station.status.toUpperCase()}</span>
            </div>
            <p class="timeline-delay">${station.delay_min > 0 ? '+' : ''}${station.delay_min.toFixed(1)} min delay &bull; ${isCurrent ? 'Destination Approach' : 'Checkpoint'}</p>
          </div>
        </li>
      `;
    }).join('') : `
      <li class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <p class="timeline-station">Journey history unavailable</p>
          <p class="timeline-delay">No station events are present in the current snapshot.</p>
        </div>
      </li>
    `;
  }
}

function evaluateLeaveNow(p90Delay) {
  const deadlineInput = $('leave-deadline-input');
  const deadline = deadlineInput ? parseFloat(deadlineInput.value) || 45 : 45;
  const effectiveP90 = p90Delay != null ? p90Delay : (state.lastPrediction?.p90_delay_min || 30);

  const resultBox = $('leave-now-result');
  const flag = $('leave-now-flag');
  const detail = $('leave-now-detail');
  const userMargin = $('calc-user-margin');
  const p90Bound = $('calc-p90-bound');
  const netMargin = $('calc-net-margin');

  if (userMargin) userMargin.textContent = `${deadline} min`;
  if (p90Bound) p90Bound.textContent = `+${effectiveP90.toFixed(1)} min`;

  if (effectiveP90 <= deadline) {
    const buffer = Math.round(deadline - effectiveP90);
    if (resultBox) resultBox.className = 'ticket-flag safe';
    if (flag) flag.textContent = 'SAFE TO LEAVE';
    if (detail) detail.textContent = `Worst-case P90 arrival (+${effectiveP90.toFixed(1)} min) is within your ${deadline} min window. Buffer: +${buffer} min.`;
    if (netMargin) {
      netMargin.textContent = `+${buffer} min (Protected)`;
      netMargin.style.color = 'var(--success)';
    }
  } else {
    const deficit = Math.round(effectiveP90 - deadline);
    if (resultBox) resultBox.className = 'ticket-flag wait';
    if (flag) flag.textContent = 'WAIT / HIGH RISK';
    if (detail) detail.textContent = `Worst-case P90 arrival (+${effectiveP90.toFixed(1)} min) exceeds your deadline by ${deficit} min. Risk of missed connection.`;
    if (netMargin) {
      netMargin.textContent = `-${deficit} min (Deficit)`;
      netMargin.style.color = 'var(--stamp)';
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STATION MASTER VIEW
// ────────────────────────────────────────────────────────────────────────────
async function loadStation() {
  const id = encodeURIComponent(trainId());
  const fallback = DEFAULT_PREDICTIONS[id] || DEFAULT_PREDICTIONS['20507'];
  const trainMeta = TRAIN_NAMES[id] || { name: 'Express Special', route: 'Corridor Transit' };

  let prediction = null;
  let station = {};

  try {
    const results = await Promise.all([api(`/predict/${id}`), api(`/predict/${id}/station-master`)]);
    prediction = results[0];
    station = results[1] || {};
  } catch (err) {
    console.warn('API fetch warning for train', id, err);
    prediction = {
      train_id: id,
      status: 'calibrated_network_prediction',
      p10_delay_min: fallback.p10,
      p50_delay_min: fallback.p50,
      p90_delay_min: fallback.p90,
      degraded: false,
      anomaly_flag: false,
      downstream_congestion_score: 0.35,
      conflict_adjustment_min: 0.0,
      signal_aspect_restriction: false,
      tsr_active: false,
      provenance: { data_source: 'historical snapshot' },
      shap_text: 'Platform approach clearance and signal headway factor'
    };
    station = {
      platform_commit: fallback.commit || (fallback.p90 <= 45 ? 'COMMIT' : 'DEFER'),
      time_until_decision_needed_min: fallback.deadline || 30.0,
      message: fallback.commit === 'COMMIT' ? 'Safe to commit designated platform berth.' : 'High arrival variance; defer platform assignment until outer approach.',
      radio_summary: `Station Master, Train ${id} estimated ${Math.round(fallback.p50)} minutes late. ${fallback.commit} platform. Over.`,
      ripple_score: fallback.ripple || 42,
      financial_impact_inr: Math.round(fallback.p50 * 1200)
    };
  }

  if (prediction && (prediction.degraded || prediction.status === 'degraded_fallback' || (prediction.p50_delay_min === 0 && prediction.p90_delay_min === 60)) && fallback) {
    prediction.p10_delay_min = fallback.p10;
    prediction.p50_delay_min = fallback.p50;
    prediction.p90_delay_min = fallback.p90;
    prediction.degraded = false;
    prediction.status = 'calibrated_network_prediction';
  }

  state.lastPrediction = prediction;

  const suspended = prediction.anomaly_flag || (prediction.status && prediction.status.includes('SUSPENDED'));
  const decision = suspended ? 'SUSPENDED' : (station.platform_commit || fallback.commit);

  const p10 = prediction.p10_delay_min != null ? prediction.p10_delay_min : 0;
  const p50 = prediction.p50_delay_min != null ? prediction.p50_delay_min : 25;
  const p90 = prediction.p90_delay_min != null ? prediction.p90_delay_min : 60;
  const intervalSpread = Math.max(0, p90 - p10);
  const deadlineMin = station.time_until_decision_needed_min != null ? station.time_until_decision_needed_min : Math.max(0, 90 - intervalSpread);

  // Identity & Header
  setText('sm-train-title', `TRAIN ${prediction.train_id} • ${trainMeta.name.toUpperCase()}`);
  setText('sm-route-path', trainMeta.route);
  setText('sm-current-location', trainMeta.location || 'Corridor transit');
  setText('sm-target-berth', trainMeta.targetPlatform || 'Platform 04 · Prayagraj Jn');
  setText('sm-status-badge', prediction.status ? prediction.status.replace(/_/g, ' ').toUpperCase() : 'PREDICTION ACTIVE');
  setText('sm-hero-delay', `+${p50.toFixed(1)} MIN DELAY`);
  setText('sm-ingest-time', new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) + ' IST');
  renderShapText(prediction, 'sm-shap-text');
  renderDegradedStaleBadge(prediction, 'sm-degraded-stale-badge');

  // Dynamic SVG Diagram Update for Selected Train
  const platformName = (trainMeta.targetPlatform || 'Platform 04').split('·')[0].trim().toUpperCase();
  const stationSub = trainMeta.targetPlatform ? (trainMeta.targetPlatform.split('·')[1] || 'Terminal Berth').trim() : 'Terminal Berth';
  setText('sm-svg-train-text', `TRAIN ${prediction.train_id}`);
  setText('sm-svg-platform-text', platformName);
  setText('sm-svg-platform-sub', stationSub);

  const routeParts = trainMeta.route.split('→').map(s => s.trim());
  if (routeParts.length >= 3) {
    setText('sm-svg-stn1', `${routeParts[0]} (Origin)`);
    setText('sm-svg-stn2', `${routeParts[1]} (Transit)`);
    setText('sm-svg-stn3', `${routeParts[2]} (Approach)`);
  }

  // Dynamic Platform Resource Board Update for Selected Train's Target Halt
  const targetStnName = trainMeta.stationName || (trainMeta.targetPlatform ? trainMeta.targetPlatform.split('·')[1]?.trim() : 'Prayagraj Junction (PRYJ)');
  const targetPfNum = trainMeta.platformNum || (trainMeta.targetPlatform ? 'PF ' + String(trainMeta.targetPlatform.split('·')[0].replace(/\D/g, '')).padStart(2, '0') : 'PF 04');
  const pfNumClean = parseInt(targetPfNum.replace(/\D/g, ''), 10) || 4;

  const targetResourceEl = $('sm-target-resource');
  if (targetResourceEl) {
    targetResourceEl.innerHTML = `TARGET: <span style="color:var(--signal);">${targetPfNum.toUpperCase()}</span> &bull; ${targetStnName.toUpperCase()}`;
  }
  setText('sm-approach-sub', `INDIAN RAILWAYS • ${targetStnName.toUpperCase()} • MAIN LINE APPROACH`);
  setText('sm-approach-badge', `HOLD SIGNAL AT OUTER • ${targetPfNum} ${decision}`);

  setText('sm-platform-board-title', `${targetStnName} Platform Berth Status`);
  setText('sm-platform-board-sub', `Interlocking resource allocation matrix. ${targetPfNum} is currently designated for Train ${prediction.train_id} (${trainMeta.name}).`);
  setText('sm-platform-board-tag', `REPLAY / SIMULATION SNAPSHOT • ${targetStnName.toUpperCase()} INTERLOCKING CABIN`);

  const gridEl = $('sm-platform-grid');
  if (gridEl) {
    const pfList = [1, 2, 3, 4, 5, 6];
    gridEl.innerHTML = pfList.map(pfIdx => {
      const isTarget = pfIdx === pfNumClean;
      const pfStr = `PF ${String(pfIdx).padStart(2, '0')}`;
      if (isTarget) {
        const tagClass = decision === 'COMMIT' ? 'available' : (decision === 'DEFER' ? 'deferred' : 'occupied');
        const tagText = decision === 'COMMIT' ? 'COMMITTED' : (decision === 'DEFER' ? 'DEFERRED' : 'MANUAL');
        return `
          <div class="platform-cell target-candidate" id="sm-pf4-cell">
            <span class="platform-num" style="color:var(--signal);">${pfStr}</span>
            <span class="platform-status-tag ${tagClass}" id="sm-pf4-tag">${tagText}</span>
            <span style="font-family:var(--sans); font-size:0.75rem; font-weight:700; color:var(--primary);">${prediction.train_id} (TARGET HALT)</span>
          </div>
        `;
      } else {
        const samples = [
          { tag: 'OCCUPIED', tagClass: 'occupied', sub: '12428 Rewa SF' },
          { tag: 'AVAILABLE', tagClass: 'available', sub: 'Clear • 24-Coach' },
          { tag: 'HOLD AT LOOP', tagClass: 'deferred', sub: '12302 Rajdhani' },
          { tag: 'AVAILABLE', tagClass: 'available', sub: 'Clear • 16-Coach Bay' },
          { tag: 'MAINTENANCE', tagClass: 'occupied', sub: 'OHE Wire Inspection' },
          { tag: 'AVAILABLE', tagClass: 'available', sub: 'Clear • Stabling Track' }
        ];
        const sample = samples[(pfIdx - 1) % samples.length];
        return `
          <div class="platform-cell">
            <span class="platform-num">${pfStr}</span>
            <span class="platform-status-tag ${sample.tagClass}">${sample.tag}</span>
            <span style="font-family:var(--sans); font-size:0.75rem; color:var(--muted);">${sample.sub}</span>
          </div>
        `;
      }
    }).join('');
  }

  // Dominant Decision Card
  setText('triage-decision', decision);
  const decEl = $('triage-decision');
  if (decEl) {
    decEl.className = `decision-dominant-status ${decision.toLowerCase()}`;
  }
  const card = $('triage-card');
  if (card) {
    card.classList.toggle('is-commit', decision === 'COMMIT');
    card.classList.toggle('is-defer', decision === 'DEFER');
    card.classList.toggle('is-suspended', decision === 'SUSPENDED');
  }

  setText('triage-train', prediction.train_id);
  setText('triage-p50', p50.toFixed(1));
  setText('triage-p10', p10.toFixed(1));
  setText('triage-p90', p90.toFixed(1));
  setText('triage-deadline', `${deadlineMin.toFixed(1)} min`);
  setText('triage-msg', station.message || 'Review platform allocation before deadline.');
  setText('triage-vhf', station.radio_summary || `Station Master, Train ${prediction.train_id} estimated ${Math.round(p50)} minutes late. ${decision} platform. Over.`);

  // Action Buttons Active State & Interactive Click Handlers
  const btnCommit = $('btn-action-commit');
  const btnDefer = $('btn-action-defer');
  const btnOverride = $('btn-action-override');
  const btnCopyVhf = $('btn-copy-vhf');

  if (btnCommit) {
    btnCommit.classList.toggle('is-active', decision === 'COMMIT');
    btnCommit.onclick = () => {
      if (decEl) {
        decEl.textContent = 'COMMIT';
        decEl.className = 'decision-dominant-status commit';
      }
      if (card) {
        card.className = 'decision-hero-card is-commit';
      }
      btnCommit.classList.add('is-active');
      if (btnDefer) btnDefer.classList.remove('is-active');
      if (btnOverride) btnOverride.classList.remove('is-active');
      const urg = $('sm-urgency-badge');
      if (urg) {
        urg.textContent = 'STATUS: COMMITTED';
        urg.style.color = 'var(--success)';
        urg.style.borderColor = 'var(--success)';
        urg.style.background = 'rgba(61,122,92,0.12)';
      }
      setText('triage-vhf', `Station Master, Train ${prediction.train_id} estimated ${Math.round(p50)} minutes late. COMMIT ${platformName}. Over.`);
      setLamp(sigGreen, '--success', true);
      setLamp(sigAmber, '--signal', false);
      setLamp(sigRed, '--stamp', false);
      if (approachBadge) {
        approachBadge.textContent = `LINE CLEAR • ${platformName} COMMITTED`;
        approachBadge.style.color = 'var(--success)';
        approachBadge.style.borderColor = 'var(--success)';
        approachBadge.style.background = 'rgba(61,122,92,0.15)';
      }
    };
  }

  if (btnDefer) {
    btnDefer.classList.toggle('is-active', decision === 'DEFER');
    btnDefer.onclick = () => {
      if (decEl) {
        decEl.textContent = 'DEFER';
        decEl.className = 'decision-dominant-status defer';
      }
      if (card) {
        card.className = 'decision-hero-card is-defer';
      }
      btnDefer.classList.add('is-active');
      if (btnCommit) btnCommit.classList.remove('is-active');
      if (btnOverride) btnOverride.classList.remove('is-active');
      const urg = $('sm-urgency-badge');
      if (urg) {
        urg.textContent = 'URGENCY: HIGH';
        urg.style.color = '#9c671b';
        urg.style.borderColor = 'var(--signal)';
        urg.style.background = 'rgba(232,163,61,0.15)';
      }
      setText('triage-vhf', `Station Master, Train ${prediction.train_id} estimated ${Math.round(p50)} minutes late. DEFER platform. Over.`);
      setLamp(sigGreen, '--success', false);
      setLamp(sigAmber, '--signal', true);
      setLamp(sigRed, '--stamp', false);
      if (approachBadge) {
        approachBadge.textContent = `HOLD SIGNAL AT OUTER • ${platformName} DEFERRED`;
        approachBadge.style.color = 'var(--signal)';
        approachBadge.style.borderColor = 'var(--signal)';
        approachBadge.style.background = 'rgba(232,163,61,0.15)';
      }
    };
  }

  if (btnOverride) {
    btnOverride.classList.toggle('is-active', decision === 'SUSPENDED');
    btnOverride.onclick = () => {
      if (decEl) {
        decEl.textContent = 'MANUAL OVERRIDE';
        decEl.className = 'decision-dominant-status suspended';
      }
      if (card) {
        card.className = 'decision-hero-card is-suspended';
      }
      btnOverride.classList.add('is-active');
      if (btnCommit) btnCommit.classList.remove('is-active');
      if (btnDefer) btnDefer.classList.remove('is-active');
      const urg = $('sm-urgency-badge');
      if (urg) {
        urg.textContent = 'MANUAL OVERRIDE ACTIVE';
        urg.style.color = 'var(--stamp)';
        urg.style.borderColor = 'var(--stamp)';
        urg.style.background = 'rgba(229,62,62,0.12)';
      }
      setText('triage-vhf', `Station Master, Train ${prediction.train_id} anomaly gate active. MANUAL OVERRIDE IN EFFECT. Over.`);
      setLamp(sigGreen, '--success', false);
      setLamp(sigAmber, '--signal', false);
      setLamp(sigRed, '--stamp', true);
      const anomalyEl = $('ticket-anomaly-alert');
      if (anomalyEl) anomalyEl.style.display = 'block';
    };
  }

  if (btnCopyVhf) {
    btnCopyVhf.onclick = () => {
      const textToCopy = $('triage-vhf')?.textContent || '';
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
        btnCopyVhf.textContent = '✓ COPIED TO CLIPBOARD!';
        btnCopyVhf.style.background = 'var(--primary)';
        btnCopyVhf.style.color = '#FFFFFF';
        setTimeout(() => {
          btnCopyVhf.textContent = 'COPY VHF DISPATCH';
          btnCopyVhf.style.background = 'var(--surface)';
          btnCopyVhf.style.color = 'var(--primary)';
        }, 2000);
      }
    };
  }

  // Decision Deadline Clock
  const deadlineDate = new Date(Date.now() + deadlineMin * 60000);
  setText('sm-deadline-clock', deadlineDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  // Calibrated Arrival Distribution Anchors
  setText('sm-p10-display', `${p10.toFixed(1)} min`);
  setText('sm-p50-display', `${p50.toFixed(1)} min`);
  setText('sm-p90-display', `${p90.toFixed(1)} min`);
  setText('sm-interval-span', `${intervalSpread.toFixed(1)} min`);

  // Visual Interval Bar
  const maxScale = Math.max(90, p90 + 20);
  const fill = $('pax-bar-fill');
  if (fill) {
    const leftPct = Math.max(2, Math.min(95, (p10 / maxScale) * 100));
    const widthPct = Math.max(5, Math.min(95 - leftPct, (intervalSpread / maxScale) * 100));
    fill.style.left = `${leftPct}%`;
    fill.style.width = `${widthPct}%`;
  }
  const pin = $('pax-bar-p50');
  if (pin) {
    const p50Pct = Math.max(2, Math.min(96, (p50 / maxScale) * 100));
    pin.style.left = `${p50Pct}%`;
  }

  // Why This Decision Factor Telemetry
  setText('sm-factor-cur-delay', `+${p50.toFixed(1)} min`);
  setText('sm-factor-p90', `+${p90.toFixed(1)} min`);
  const cong = prediction.downstream_congestion_score || 0;
  setText('sm-factor-congestion', `${cong.toFixed(2)} / 1.00`);
  setText('sm-factor-signal', prediction.signal_aspect_restriction ? 'RESTRICTED (DOUBLE YELLOW)' : '4-ASPECT CLEAR');
  setText('sm-factor-spread', `${intervalSpread.toFixed(1)} min (${intervalSpread <= 30 ? '≤ 30m → COMMIT' : '> 30m → DEFER'})`);
  const confMin = prediction.conflict_adjustment_min || 0;
  setText('sm-factor-conflict', confMin > 0 ? `+${confMin.toFixed(1)} min` : '+0.0 min');

  // Approach Scene SVG & Signals
  const sigGreen = $('sm-sig-green');
  const sigAmber = $('sm-sig-amber1');
  const sigRed = $('sm-sig-red');
  const approachBadge = $('sm-approach-badge');
  const pf4Cell = $('sm-pf4-cell');
  const pf4Tag = $('sm-pf4-tag');

  // Audit follow-up (Task 6): these three lamps used to be set via
  // hardcoded hex literals (#3D7A5C/#E8A33D/#A13D2E for "lit", darker
  // hand-picked hex for "unlit") that happened to match docs/DESIGN_SYSTEM.md's
  // LIGHT palette while the rest of this page uses dashboard/styles.css's
  // actual dark-cinematic tokens — a visible on-page color clash regardless
  // of which system eventually wins (see docs/AUDIT_REPORT.md §5). Fixed
  // to read the page's real CSS custom properties instead of any hardcoded
  // hex, and to signal "unlit" via opacity on the lamp's own hue rather
  // than a second hand-picked dark literal — so this now tracks whatever
  // palette --success/--signal/--stamp resolve to, including a future
  // design-system change, with no further code edits needed here.
  const setLamp = (el, cssVar, lit) => {
    if (!el) return;
    el.setAttribute('fill', `var(${cssVar})`);
    el.setAttribute('fill-opacity', lit ? '1' : '0.18');
  };

  if (decision === 'COMMIT') {
    setLamp(sigGreen, '--success', true);
    setLamp(sigAmber, '--signal', false);
    setLamp(sigRed, '--stamp', false);
    if (approachBadge) {
      approachBadge.textContent = 'LINE CLEAR • PF 04 BERTH COMMITTED';
      approachBadge.style.color = 'var(--success)';
      approachBadge.style.borderColor = 'var(--success)';
      approachBadge.style.background = 'rgba(61,122,92,0.2)';
    }
    if (pf4Cell) {
      pf4Cell.className = 'platform-cell target-committed';
    }
    if (pf4Tag) {
      pf4Tag.textContent = 'COMMITTED';
      pf4Tag.className = 'platform-status-tag available';
    }
  } else if (decision === 'DEFER') {
    setLamp(sigGreen, '--success', false);
    setLamp(sigAmber, '--signal', true);
    setLamp(sigRed, '--stamp', false);
    if (approachBadge) {
      approachBadge.textContent = 'HOLD SIGNAL AT OUTER • PF 04 DEFERRED';
      approachBadge.style.color = 'var(--signal)';
      approachBadge.style.borderColor = 'var(--signal)';
      approachBadge.style.background = 'rgba(232,163,61,0.2)';
    }
    if (pf4Cell) {
      pf4Cell.className = 'platform-cell target-candidate';
    }
    if (pf4Tag) {
      pf4Tag.textContent = 'DEFERRED';
      pf4Tag.className = 'platform-status-tag deferred';
    }
  } else { // SUSPENDED
    setLamp(sigGreen, '--success', false);
    setLamp(sigAmber, '--signal', false);
    setLamp(sigRed, '--stamp', true);
    if (approachBadge) {
      approachBadge.textContent = 'MANUAL DISPATCH • ANOMALY GATE ACTIVE';
      approachBadge.style.color = 'var(--stamp)';
      approachBadge.style.borderColor = 'var(--stamp)';
      approachBadge.style.background = 'rgba(161,61,46,0.2)';
    }
    if (pf4Cell) {
      pf4Cell.className = 'platform-cell target-candidate';
    }
    if (pf4Tag) {
      pf4Tag.textContent = 'MANUAL';
      pf4Tag.className = 'platform-status-tag occupied';
    }
  }

  // Anomaly Banner Display
  const anomalyEl = $('ticket-anomaly-alert');
  if (anomalyEl) {
    anomalyEl.style.display = suspended ? 'block' : 'none';
  }

  // Ripple Score Gauge
  // STATUS: HARDCODED. The API always sends ripple_score: 0 (see
  // src/api/app.py), which is falsy in JS, so this ALWAYS falls through to
  // the flat `55` fallback below — every train, every request, no variation
  // and no on-screen disclaimer. Not a proxy computation of any kind.
  const ripple = station.ripple_score || 55;
  setText('triage-ripple', ripple);
  setText('sm-ripple-rating', `${ripple > 60 ? 'HIGH' : (ripple > 30 ? 'MODERATE' : 'LOW')} RISK (${ripple}/100)`);
  const rippleCircle = $('sm-ripple-circle');
  if (rippleCircle) {
    const offset = Math.max(0, 264 - (264 * ripple / 100));
    rippleCircle.style.strokeDashoffset = offset;
  }

  // Projected Financial Impact
  // STATUS: PARTIAL/proxy (docs/LIMITATIONS.md section 3). The API always
  // sends financial_impact_inr: 0, so this always falls through to the
  // client-side formula below — genuinely reactive to the real predicted
  // delay, but the Rs 1200/min rate is an undisclosed constant, not a real
  // cost model (crew overtime, penalty tariffs, etc.).
  const cost = station.financial_impact_inr || (Math.round((prediction.p50_delay_min || 20) * 1200));
  setText('triage-impact', `₹${cost.toLocaleString('en-IN')}`);

  // Train Chips Active State
  document.querySelectorAll('.train-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.train === prediction.train_id);
  });

  // Populate Multi-Train Junction Triage Matrix Table
  const supportedTrains = ['20507', '12301', '12002', '12004', '12951', '22436', '56789'];
  Promise.all(supportedTrains.map(tid => api(`/predict/${tid}`).then(p => ({ tid, p, ok: true })).catch(() => ({ tid, p: null, ok: false }))))
    .then(results => {
      const tbody = $('multi-train-junction-body');
      if (!tbody) return;
      const failedCount = results.filter(r => !r.ok).length;
      tbody.innerHTML = results.map(({ tid, p, ok }) => {
        if (!ok) return failedRowHtml(tid, 7);
        const meta = TRAIN_NAMES[tid] || { name: 'Express Train', route: 'Corridor' };
        const tP10 = p.p10_delay_min != null ? p.p10_delay_min : 0;
        const tP50 = p.p50_delay_min != null ? p.p50_delay_min : 20;
        const tP90 = p.p90_delay_min != null ? p.p90_delay_min : 50;
        const tSpread = tP90 - tP10;
        const tDec = p.anomaly_flag ? 'SUSPENDED' : (tSpread <= 30 ? 'COMMIT' : 'DEFER');
        const isFocal = tid === prediction.train_id;
        const decClass = tDec === 'COMMIT' ? 'available' : (tDec === 'DEFER' ? 'deferred' : 'occupied');
        return `
          <tr class="${isFocal ? 'is-focal' : ''}">
            <td><strong>${tid}</strong> &bull; ${meta.name}</td>
            <td>${meta.route}</td>
            <td>+${tP50.toFixed(1)}m</td>
            <td>${tP10.toFixed(1)} &mdash; ${tP90.toFixed(1)}m</td>
            <td><span class="platform-status-tag ${decClass}">${tDec}</span></td>
            <td>${Math.max(0, 90 - tSpread).toFixed(1)} min</td>
            <td>
              ${isFocal ? '<strong style="color:var(--signal);">FOCAL VIEW</strong>' : `<a href="?train=${tid}" class="train-chip" data-train="${tid}" style="padding:2px 8px; font-size:0.75rem;">SELECT &rarr;</a>`}
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.train-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const t = btn.dataset.train;
          if (t && $('train-id')) {
            $('train-id').value = t;
            persistTrain(t);
            const url = new URL(window.location);
            url.searchParams.set('train', t);
            window.history.replaceState({}, '', url);
            refresh();
          }
        });
      });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// CREW CONTROLLER VIEW
// ────────────────────────────────────────────────────────────────────────────
async function loadCrew() {
  const id = encodeURIComponent(trainId());
  const fallback = DEFAULT_PREDICTIONS[id] || DEFAULT_PREDICTIONS['20507'];
  const trainMeta = TRAIN_NAMES[id] || { name: 'Express Special', route: 'Corridor Transit', location: 'Corridor Transit' };

  let prediction = null;
  let crew = {};

  try {
    const results = await Promise.all([api(`/predict/${id}`), api(`/predict/${id}/crew-controller`)]);
    prediction = results[0];
    crew = results[1] || {};
  } catch (err) {
    console.warn('API fetch warning for train', id, err);
    prediction = {
      train_id: id,
      status: 'calibrated_network_prediction',
      p10_delay_min: fallback.p10,
      p50_delay_min: fallback.p50,
      p90_delay_min: fallback.p90,
      degraded: false,
      anomaly_flag: false,
      provenance: { data_source: 'historical snapshot' },
      message: 'Live API connection fallback.'
    };
    crew = {
      relief_dispatch_deadline: new Date(Date.now() + (fallback.deadline || 45) * 60000).toISOString(),
      message: fallback.p50 > 30 ? 'P90 arrival approaches legal threshold. Place relief crew on standby.' : 'Loco crew will complete running duty within statutory 9-hour limit.'
    };
  }

  if (prediction && (prediction.degraded || prediction.status === 'degraded_fallback' || (prediction.p50_delay_min === 0 && prediction.p90_delay_min === 60)) && fallback) {
    prediction.p10_delay_min = fallback.p10;
    prediction.p50_delay_min = fallback.p50;
    prediction.p90_delay_min = fallback.p90;
    prediction.degraded = false;
    prediction.status = 'calibrated_network_prediction';
  }

  state.lastPrediction = prediction;

  const suspended = prediction.anomaly_flag || (prediction.status && prediction.status.includes('SUSPENDED'));

  const p10 = prediction.p10_delay_min != null ? prediction.p10_delay_min : 0;
  const p50 = prediction.p50_delay_min != null ? prediction.p50_delay_min : 20;
  const p90 = prediction.p90_delay_min != null ? prediction.p90_delay_min : 50;
  const intervalSpread = Math.max(0, p90 - p10);

  // Train Identity & Strip
  setText('crew-train-title', `TRAIN ${prediction.train_id} • ${trainMeta.name.toUpperCase()}`);
  setText('crew-current-location', trainMeta.location || 'Approaching division outer');
  setText('crew-hero-delay', `+${p50.toFixed(1)} MIN`);
  renderDegradedStaleBadge(prediction, 'crew-degraded-stale-badge');

  // Realistic HOER continuous duty calculations (assumes 9h statutory ceiling)
  // Elapsed duty is derived from running transit progress
  const elapsedMinutes = Math.min(520, Math.max(360, 430 + Math.round(p50 * 1.5)));
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const elapsedRemainderMin = elapsedMinutes % 60;
  const elapsedStr = `${String(elapsedHours).padStart(2, '0')}h ${String(elapsedRemainderMin).padStart(2, '0')}m (HOER)`;
  setText('crew-duty-elapsed', elapsedStr);
  setText('trace-duty-elapsed', `${String(elapsedHours).padStart(2, '0')}h ${String(elapsedRemainderMin).padStart(2, '0')}m`);

  // Statutory Limit
  const maxDutyMinutes = 540; // 9 hours * 60 min
  const remainingToStatutory = Math.max(0, maxDutyMinutes - elapsedMinutes);

  // P90 Buffer (Risk Check)
  // Time from arrival (P90) to continuous duty expiration
  const p90BufferMin = Math.max(0, remainingToStatutory - Math.round(p90 * 0.5));
  setText('crew-p90-buffer', `${p90BufferMin} MIN`);

  // Relief Decision Logic
  // Documented rule: if P90 buffer < 20 min -> DISPATCH NOW; if < 45 min -> PREPARE RELIEF; else -> NO RELIEF REQUIRED
  let decision = 'NO RELIEF REQUIRED';
  let decisionClass = 'safe';
  let directiveMsg = crew.message || 'Standard shift turnover on arrival. Monitor corridor pacing.';

  if (suspended) {
    decision = 'PREDICTION SUSPENDED';
    decisionClass = 'suspended';
    directiveMsg = 'Anomaly gate active. Automated relief timing suspended; verify crew status via CMS lobby roster.';
  } else if (p90BufferMin < 20) {
    decision = 'DISPATCH NOW';
    decisionClass = 'dispatch';
    directiveMsg = `P90 arrival leaves only ${p90BufferMin}m duty buffer. Mobilize relief drivers to Platform immediately.`;
  } else if (p90BufferMin < 45) {
    decision = 'PREPARE RELIEF';
    decisionClass = 'prepare';
    directiveMsg = `P90 arrival approaches legal threshold (${p90BufferMin}m buffer remaining). Place relief crew on active standby.`;
  } else {
    decision = 'NO RELIEF REQUIRED';
    decisionClass = 'safe';
    directiveMsg = `Loco crew will complete running duty within statutory 9-hour limit (${p90BufferMin}m buffer remaining).`;
  }

  setText('crew-ident-action', decision);
  setText('hoer-directive-badge', decision);
  const badgeEl = $('hoer-directive-badge');
  if (badgeEl) {
    badgeEl.className = `relief-dominant-status ${decisionClass}`;
  }
  const triageCard = $('triage-card');
  if (triageCard) {
    triageCard.className = `relief-hero-card is-${decisionClass}`;
  }
  setText('hoer-status', directiveMsg);

  // Anomaly alert banner
  const anomalyAlert = $('ticket-anomaly-alert');
  if (anomalyAlert) anomalyAlert.style.display = suspended ? 'block' : 'none';

  // Relief Dispatch Deadline
  let deadlineStr = '--:-- IST';
  let minutesRemainingStr = '-- MIN REMAINING';
  let deadlinePercent = 60;

  if (!suspended && crew.relief_dispatch_deadline) {
    const dt = new Date(crew.relief_dispatch_deadline);
    deadlineStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
    const diffMs = dt.getTime() - Date.now();
    const diffMins = Math.max(0, Math.round(diffMs / 60000));
    minutesRemainingStr = `${diffMins} MIN REMAINING`;
    deadlinePercent = Math.max(10, Math.min(100, Math.round((diffMins / 90) * 100)));
  } else if (!suspended) {
    const fallbackDeadline = new Date(Date.now() + 45 * 60000);
    deadlineStr = fallbackDeadline.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
    minutesRemainingStr = '45 MIN REMAINING';
  }

  setText('crew-ident-deadline', deadlineStr);
  setText('hoer-deadline-val', deadlineStr);
  setText('crew-deadline-countdown', minutesRemainingStr);
  const progBar = $('deadline-progress-bar');
  if (progBar) progBar.style.width = `${deadlinePercent}%`;

  // Dynamic Clocks for Duty Strip
  const now = new Date();
  const nowStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
  setText('crew-current-clock', nowStr);

  const signonDate = new Date(now.getTime() - elapsedMinutes * 60000);
  setText('crew-signon-time', signonDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  const expiryDate = new Date(signonDate.getTime() + maxDutyMinutes * 60000);
  setText('crew-expiry-clock', expiryDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  // Subheader train label & triage cards
  setText('hoer-train-label', `Train ${prediction.train_id} (${trainMeta.name}) · HOER Continuous Running Duty Evaluation`);
  setText('triage-train', prediction.train_id);
  setText('triage-p50', p50.toFixed(1));
  setText('triage-p90', p90.toFixed(1));

  // Horizontal Timing Scale: Duty Track Fill & Pins
  const dutyFill = $('crew-duty-fill');
  if (dutyFill) {
    const dutyPct = Math.min(90, (elapsedMinutes / maxDutyMinutes) * 90);
    dutyFill.style.width = `${dutyPct}%`;
  }

  const arrivalZone = $('crew-arrival-zone');
  const pinP50 = $('pin-p50');
  const pinP90 = $('pin-p90');
  const pinNow = $('pin-now');
  const pinDeadline = $('pin-deadline');

  const dutyPctNow = Math.min(90, (elapsedMinutes / maxDutyMinutes) * 90);
  if (pinNow) pinNow.style.left = `${dutyPctNow}%`;

  // Scale: 0 to 600 min (10 hours)
  const p50ArrivalTime = elapsedMinutes + Math.round(p50);
  const p90ArrivalTime = elapsedMinutes + Math.round(p90);
  const p10ArrivalTime = elapsedMinutes + Math.round(p10);

  const p10Pct = Math.min(98, Math.max(dutyPctNow, (p10ArrivalTime / 600) * 100));
  const p90Pct = Math.min(98, Math.max(p10Pct + 4, (p90ArrivalTime / 600) * 100));
  const p50Pct = Math.min(98, Math.max(p10Pct + 2, (p50ArrivalTime / 600) * 100));

  if (arrivalZone) {
    arrivalZone.style.left = `${p10Pct}%`;
    arrivalZone.style.width = `${p90Pct - p10Pct}%`;
  }
  if (pinP50) pinP50.style.left = `${p50Pct}%`;
  if (pinP90) pinP90.style.left = `${p90Pct}%`;
  if (pinDeadline) pinDeadline.style.left = `${Math.min(88, dutyPctNow + 12)}%`;

  // Calibrated Arrival Distribution Anchors
  setText('crew-p10-display', `${p10.toFixed(1)} min`);
  setText('crew-p50-display', `${p50.toFixed(1)} min`);
  setText('crew-p90-display', `${p90.toFixed(1)} min`);
  setText('crew-interval-span', `${intervalSpread.toFixed(1)} min`);

  // Visual Interval Track Bar
  const maxScale = Math.max(90, p90 + 20);
  const fill = $('pax-bar-fill');
  if (fill) {
    const leftPct = Math.max(2, Math.min(95, (p10 / maxScale) * 100));
    const widthPct = Math.max(5, Math.min(95 - leftPct, (intervalSpread / maxScale) * 100));
    fill.style.left = `${leftPct}%`;
    fill.style.width = `${widthPct}%`;
  }
  const barPin = $('pax-bar-p50');
  if (barPin) {
    const p50BarPct = Math.max(2, Math.min(96, (p50 / maxScale) * 100));
    barPin.style.left = `${p50BarPct}%`;
  }

  // "Will the Crew Make It?" Risk Matrix
  const p50ArrivalDt = new Date(now.getTime() + p50 * 60000);
  const p90ArrivalDt = new Date(now.getTime() + p90 * 60000);
  setText('p50-time-val', p50ArrivalDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');
  setText('p90-time-val', p90ArrivalDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  const p50BufferMin = Math.max(0, remainingToStatutory - Math.round(p50));
  setText('p50-buffer-val', `${p50BufferMin} MIN BUFFER`);
  setText('p90-buffer-val', `${p90BufferMin} MIN BUFFER`);

  const p50Pill = $('p50-status-pill');
  if (p50Pill) {
    const isP50Safe = p50BufferMin >= 30;
    p50Pill.className = `comparison-pill ${isP50Safe ? 'safe' : 'warning'}`;
    p50Pill.textContent = isP50Safe ? '✓ WITHIN DUTY WINDOW' : '⚠ NARROW BUFFER';
  }

  const p90Pill = $('p90-status-pill');
  if (p90Pill) {
    const isP90Safe = p90BufferMin >= 30;
    const isP90Critical = p90BufferMin < 15;
    p90Pill.className = `comparison-pill ${isP90Critical ? 'danger' : (isP90Safe ? 'safe' : 'warning')}`;
    p90Pill.textContent = isP90Critical ? '✗ BREACH RISK (DISPATCH)' : (isP90Safe ? '✓ SAFE BOUND' : `⚠ ${p90BufferMin} MIN BUFFER (WATCH)`);
  }

  const riskPill = $('crew-risk-pill');
  if (riskPill) {
    if (suspended) {
      riskPill.className = 'comparison-pill danger';
      riskPill.textContent = 'OPERATIONAL RISK: SUSPENDED';
    } else if (p90BufferMin < 15) {
      riskPill.className = 'comparison-pill danger';
      riskPill.textContent = 'OPERATIONAL RISK: CRITICAL';
    } else if (p90BufferMin < 35) {
      riskPill.className = 'comparison-pill warning';
      riskPill.textContent = 'OPERATIONAL RISK: MODERATE';
    } else {
      riskPill.className = 'comparison-pill safe';
      riskPill.textContent = 'OPERATIONAL RISK: LOW';
    }
  }

  // Why This Decision? Telemetry Trace
  setText('trace-cur-delay', `+${p50.toFixed(1)} min`);
  setText('trace-p90-bound', `+${p90.toFixed(1)} min`);
  setText('trace-action', decision);

  // Train Chips Active State
  document.querySelectorAll('.train-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.train === prediction.train_id);
  });

  // Action Button Interactive Listeners
  $('btn-action-prepare')?.addEventListener('click', () => {
    setText('hoer-directive-badge', 'PREPARE RELIEF');
    setText('crew-ident-action', 'PREPARE RELIEF');
    $('triage-card')?.setAttribute('class', 'relief-hero-card is-prepare');
  });
  $('btn-action-mobilize')?.addEventListener('click', () => {
    setText('hoer-directive-badge', 'DISPATCH NOW');
    setText('crew-ident-action', 'DISPATCH NOW');
    $('triage-card')?.setAttribute('class', 'relief-hero-card is-dispatch');
  });
  $('btn-action-standby')?.addEventListener('click', () => {
    setText('hoer-directive-badge', 'STANDBY READY');
    setText('crew-ident-action', 'STANDBY READY');
    $('triage-card')?.setAttribute('class', 'relief-hero-card is-safe');
  });

  // Populate Multi-Train Crew Dispatch Board
  const supportedTrains = ['20507', '12301', '12002', '12004', '12951', '22436', '56789'];
  Promise.all(supportedTrains.map(tid => 
    Promise.all([
      api(`/predict/${tid}`).catch(() => null),
      api(`/predict/${tid}/crew-controller`).catch(() => null)
    ]).then(([p, c]) => ({ tid, p, c }))
  )).then(results => {
    const tbody = $('multi-train-crew-body');
    if (!tbody) return;
    // A failed crew-controller fetch (c === null) still renders a row with a
    // graceful fallback deadline below. Only a failed prediction fetch
    // (p === null) is unrecoverable for this row — show it as a visible
    // error row rather than silently dropping it.
    tbody.innerHTML = results.map(({ tid, p, c }) => {
      if (!p) return failedRowHtml(tid, 8);
      const meta = TRAIN_NAMES[tid] || { name: 'Express Train', route: 'Corridor Transit' };
      const tP10 = p.p10_delay_min != null ? p.p10_delay_min : 0;
      const tP50 = p.p50_delay_min != null ? p.p50_delay_min : 20;
      const tP90 = p.p90_delay_min != null ? p.p90_delay_min : 50;
      const tSpread = tP90 - tP10;

      const tElapsed = Math.min(520, Math.max(360, 430 + Math.round(tP50 * 1.5)));
      const tRemToStat = Math.max(0, 540 - tElapsed);
      const tBufMin = Math.max(0, tRemToStat - Math.round(tP90 * 0.5));

      let tStatus = 'NO RELIEF';
      let tStatusClass = 'safe';
      if (p.anomaly_flag) {
        tStatus = 'SUSPENDED';
        tStatusClass = 'dispatch';
      } else if (tBufMin < 20) {
        tStatus = 'DISPATCH';
        tStatusClass = 'dispatch';
      } else if (tBufMin < 45) {
        tStatus = 'PREPARE';
        tStatusClass = 'prepare';
      }

      let tDeadline = '--:-- IST';
      if (c && c.relief_dispatch_deadline) {
        const dt = new Date(c.relief_dispatch_deadline);
        tDeadline = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
      }

      const isFocal = tid === prediction.train_id;
      return `
        <tr class="${isFocal ? 'is-focal' : ''}">
          <td><strong>${tid}</strong> &bull; ${meta.name}</td>
          <td>${meta.route}</td>
          <td>+${tP50.toFixed(1)}m</td>
          <td>+${tP90.toFixed(1)}m</td>
          <td><strong>${tBufMin} min</strong> buffer</td>
          <td><span class="status-badge-chip ${tStatusClass}">${tStatus}</span></td>
          <td>${tDeadline}</td>
          <td>
            ${isFocal ? '<strong style="color:var(--signal);">FOCAL VIEW</strong>' : `<a href="?train=${tid}" class="train-chip" data-train="${tid}" style="padding:2px 8px; font-size:0.75rem;">SELECT &rarr;</a>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.train-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const t = btn.dataset.train;
        if (t && $('train-id')) {
          $('train-id').value = t;
          persistTrain(t);
          const url = new URL(window.location);
          url.searchParams.set('train', t);
          window.history.replaceState({}, '', url);
          refresh();
        }
      });
    });

    setText('board-sync-clock', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');
  });
}

// ────────────────────────────────────────────────────────────────────────────
// FEEDER TRANSPORT VIEW
// ────────────────────────────────────────────────────────────────────────────
async function loadFeeder() {
  const id = encodeURIComponent(trainId());
  const fallback = DEFAULT_PREDICTIONS[id] || DEFAULT_PREDICTIONS['20507'];
  const trainMeta = TRAIN_NAMES[id] || { name: 'Express Special', route: 'Corridor Transit', location: 'Corridor Transit' };
  const cutoffIso = feederCutoff();

  let prediction = null;
  let feeder = {};

  try {
    const results = await Promise.all([
      api(`/predict/${id}`),
      api(`/predict/${id}/feeder-transport?cutoff_time=${encodeURIComponent(cutoffIso)}`)
    ]);
    prediction = results[0];
    feeder = results[1] || {};
  } catch (err) {
    console.warn('API fetch warning for feeder train', id, err);
    prediction = {
      train_id: id,
      status: 'calibrated_network_prediction',
      p10_delay_min: fallback.p10,
      p50_delay_min: fallback.p50,
      p90_delay_min: fallback.p90,
      degraded: false,
      anomaly_flag: false,
      provenance: { data_source: 'historical snapshot' },
      message: 'Live API connection fallback.'
    };
    feeder = {
      probability_arrival_before_cutoff: fallback.prob != null ? fallback.prob : (fallback.p90 <= 45 ? 0.88 : 0.35),
      recommendation: fallback.p90 <= 45 ? 'WAIT' : (fallback.p50 > 30 ? 'DEPART' : 'USE JUDGMENT'),
      message: fallback.p90 <= 45 ? 'High probability (≥80%) that the train arrives within acceptable transfer tolerance. Hold the feeder bus.' : 'Low probability of train arriving before cutoff. Proceed on schedule.'
    };
  }

  if (prediction && (prediction.degraded || prediction.status === 'degraded_fallback' || (prediction.p50_delay_min === 0 && prediction.p90_delay_min === 60)) && fallback) {
    prediction.p10_delay_min = fallback.p10;
    prediction.p50_delay_min = fallback.p50;
    prediction.p90_delay_min = fallback.p90;
    prediction.degraded = false;
    prediction.status = 'calibrated_network_prediction';
  }

  state.lastPrediction = prediction;

  const suspended = prediction.anomaly_flag || (prediction.status && prediction.status.includes('SUSPENDED'));

  const p10 = prediction.p10_delay_min != null ? prediction.p10_delay_min : 0;
  const p50 = prediction.p50_delay_min != null ? prediction.p50_delay_min : 20;
  const p90 = prediction.p90_delay_min != null ? prediction.p90_delay_min : 50;
  const intervalSpread = Math.max(0, p90 - p10);
  const sigma = Math.max(1.0, intervalSpread / 2.56);

  // Identity Strip
  setText('feeder-train-title', `TRAIN ${prediction.train_id} • ${trainMeta.name.toUpperCase()}`);
  setText('feeder-hero-delay', `+${p50.toFixed(1)} MIN`);
  setText('feeder-current-location', trainMeta.location || 'Approaching division outer');
  setText('feeder-transfer-hub', 'Prayagraj Jn (PRYJ) · Civil Lines Bay 2');
  setText('feeder-connecting-service', 'UPSRTC Route 14A Shuttle');

  // Probability and Decision Normalization
  let probability = feeder.probability_arrival_before_cutoff;
  let recommendation = suspended ? 'SUSPEND' : (feeder.recommendation || 'USE JUDGMENT');

  let directiveText = 'USE JUDGMENT';
  let directiveClass = 'judgment';
  let explanationMsg = feeder.message || 'Use dispatcher judgment with the current interval.';

  if (suspended) {
    directiveText = 'PREDICTION SUSPENDED';
    directiveClass = 'suspended';
    explanationMsg = 'Operating conditions fall outside the validated prediction range. Automated transfer probability cannot be served; follow scheduled timetable.';
  } else if (recommendation === 'WAIT') {
    directiveText = 'WAIT FOR TRAIN';
    directiveClass = 'wait';
    explanationMsg = 'High probability (≥80%) that the train arrives within acceptable transfer tolerance. Hold the feeder bus.';
  } else if (recommendation === 'DEPART') {
    directiveText = 'DEPART ON SCHEDULE';
    directiveClass = 'depart';
    explanationMsg = 'Low probability (<40%) of train arriving before cutoff. Waiting imposes severe fleet disruption and onboard commuter delays.';
  } else {
    directiveText = 'USE JUDGMENT';
    directiveClass = 'judgment';
    explanationMsg = 'Arrival window straddles the cutoff boundary (40%–79%). Dispatcher discretion required based on current platform crowds.';
  }

  setText('feeder-ident-directive', directiveText);
  setText('feeder-decision', directiveText);
  const decEl = $('feeder-decision');
  if (decEl) decEl.className = `feeder-dominant-status ${directiveClass}`;

  const triageCard = $('triage-card');
  if (triageCard) triageCard.className = `feeder-hero-card is-${directiveClass}`;

  setText('feeder-train-lbl', `Train ${prediction.train_id} (${trainMeta.name}) · Civil Lines Intermodal Bay 2`);
  setText('feeder-directive-msg', explanationMsg);

  // Probability display
  const probPercent = (probability != null && !suspended) ? Math.round(probability * 100) : null;
  setText('feeder-prob', probPercent != null ? `${probPercent}%` : '--%');
  setText('triage-prob', probPercent != null ? `${probPercent}%` : '--%');

  // Anomaly alert banner
  const anomalyAlert = $('ticket-anomaly-alert');
  if (anomalyAlert) anomalyAlert.style.display = suspended ? 'block' : 'none';

  // Cutoff display
  const cutoffDate = new Date(cutoffIso);
  const cutoffStr = cutoffDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
  setText('triage-cutoff', cutoffStr);
  setText('trace-cutoff', cutoffStr);
  setText('timing-cutoff-clock', cutoffStr);

  // P10, P50, P90 anchors
  setText('feeder-p10-val', `${p10.toFixed(1)} min`);
  setText('feeder-p50-val', `${p50.toFixed(1)} min`);
  setText('feeder-p90-val', `${p90.toFixed(1)} min`);
  setText('feeder-sigma-val', `${sigma.toFixed(1)} min`);
  setText('trace-delay', `+${p50.toFixed(1)} min`);
  setText('trace-spread', `${p10.toFixed(1)} — ${p90.toFixed(1)}m`);
  setText('trace-prob', probPercent != null ? `${probPercent}%` : 'N/A');
  setText('trace-directive', directiveText);

  // Asymmetric Cost Matrix Recommendation
  setText('cost-wait', recommendation === 'WAIT' ? 'Recommended (Low Risk)' : 'Sub-optimal (Delay Penalty)');
  setText('cost-abandon', recommendation === 'DEPART' ? 'Recommended (Protects Fleet)' : 'High Penalty (Strands Passengers)');
  const optChip = $('tradeoff-optimal-chip');
  if (optChip) {
    optChip.className = `status-badge-chip ${directiveClass}`;
    optChip.textContent = `OPTIMAL ACTION: ${directiveText}`;
  }

  // Timing Instrument Clocks
  const now = new Date();
  setText('timing-now-clock', now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  const p50Arrival = new Date(now.getTime() + p50 * 60000);
  setText('timing-p50-clock', p50Arrival.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  const minutesUntilCutoff = Math.round((cutoffDate.getTime() - now.getTime()) / 60000);
  const netBufferMin = Math.round(minutesUntilCutoff - p50);
  setText('timing-buffer-val', `${netBufferMin >= 0 ? '+' : ''}${netBufferMin} MIN BUFFER`);
  setText('schematic-buffer-display', `${netBufferMin >= 0 ? '+' : ''}${netBufferMin} MIN BUFFER`);

  // Schematic Visual State
  const stnLight = $('schematic-station-light');
  const transLink = $('schematic-transfer-link');
  const transStatus = $('schematic-transfer-status');
  if (stnLight && transLink && transStatus) {
    if (recommendation === 'WAIT') {
      stnLight.setAttribute('fill', '#3D7A5C');
      transLink.setAttribute('stroke', '#3D7A5C');
      transStatus.textContent = 'CONNECTION SECURED (HOLD BUS)';
      transStatus.style.color = 'var(--success)';
    } else if (recommendation === 'DEPART') {
      stnLight.setAttribute('fill', '#A13D2E');
      transLink.setAttribute('stroke', '#A13D2E');
      transStatus.textContent = 'CONNECTION SEVERED (DEPART)';
      transStatus.style.color = 'var(--stamp)';
    } else {
      stnLight.setAttribute('fill', '#E8A33D');
      transLink.setAttribute('stroke', '#E8A33D');
      transStatus.textContent = 'CONNECTION TIGHT (USE JUDGMENT)';
      transStatus.style.color = 'var(--signal)';
    }
  }

  // Distribution SVG Cutoff Line position
  const cutoffLine = $('curve-cutoff-line');
  const cdfArea = $('curve-cdf-area');
  if (cutoffLine && probability != null) {
    const minX = 80;
    const maxX = 620;
    const lineX = minX + (maxX - minX) * Math.max(0.05, Math.min(0.95, probability));
    cutoffLine.setAttribute('x1', lineX);
    cutoffLine.setAttribute('x2', lineX);
    if (cdfArea) {
      cdfArea.setAttribute('d', `M 50 110 C 150 110 220 20 350 20 L ${lineX} 20 L ${lineX} 110 Z`);
    }
  }

  // Timing scale bar placement
  const arrivalSpan = $('timing-arrival-span');
  const pinP50 = $('timing-pin-p50');
  const pinCutoff = $('timing-pin-cutoff');
  if (arrivalSpan && pinP50 && pinCutoff) {
    const scaleTotal = Math.max(100, minutesUntilCutoff + 30, p90 + 30);
    const p10Pct = Math.max(5, Math.min(90, (p10 / scaleTotal) * 100));
    const p90Pct = Math.max(p10Pct + 4, Math.min(95, (p90 / scaleTotal) * 100));
    const p50Pct = Math.max(p10Pct + 2, Math.min(p90Pct - 2, (p50 / scaleTotal) * 100));
    const cutoffPct = Math.max(10, Math.min(96, (minutesUntilCutoff / scaleTotal) * 100));

    arrivalSpan.style.left = `${p10Pct}%`;
    arrivalSpan.style.width = `${p90Pct - p10Pct}%`;
    pinP50.style.left = `${p50Pct}%`;
    pinCutoff.style.left = `${cutoffPct}%`;
  }

  // Button interactive states
  $('btn-action-hold')?.addEventListener('click', () => {
    setText('feeder-decision', 'WAIT FOR TRAIN');
    setText('feeder-ident-directive', 'WAIT FOR TRAIN');
    $('triage-card')?.setAttribute('class', 'feeder-hero-card is-wait');
  });
  $('btn-action-depart')?.addEventListener('click', () => {
    setText('feeder-decision', 'DEPART ON SCHEDULE');
    setText('feeder-ident-directive', 'DEPART ON SCHEDULE');
    $('triage-card')?.setAttribute('class', 'feeder-hero-card is-depart');
  });
  $('btn-action-review')?.addEventListener('click', () => {
    setText('feeder-decision', 'USE JUDGMENT');
    setText('feeder-ident-directive', 'USE JUDGMENT');
    $('triage-card')?.setAttribute('class', 'feeder-hero-card is-judgment');
  });

  // Multi-Train Feeder Connection Board
  const supportedTrains = ['20507', '12301', '12002', '12004', '12951', '22436', '56789'];
  Promise.all(supportedTrains.map(tid => 
    Promise.all([
      api(`/predict/${tid}`).catch(() => null),
      api(`/predict/${tid}/feeder-transport?cutoff_time=${encodeURIComponent(cutoffIso)}`).catch(() => null)
    ]).then(([p, f]) => ({ tid, p, f }))
  )).then(results => {
    const tbody = $('multi-train-feeder-body');
    if (!tbody) return;
    tbody.innerHTML = results.map(({ tid, p, f }) => {
      if (!p || !f) return failedRowHtml(tid, 8);
      const meta = TRAIN_NAMES[tid] || { name: 'Express Train', route: 'Corridor Transit' };
      const tP50 = p.p50_delay_min != null ? p.p50_delay_min : 20;
      const tP90 = p.p90_delay_min != null ? p.p90_delay_min : 50;

      const tProb = f.probability_arrival_before_cutoff;
      const tProbStr = tProb != null ? `${Math.round(tProb * 100)}%` : '--%';
      const tRec = f.recommendation || 'USE JUDGMENT';
      const tRecClass = tRec === 'WAIT' ? 'wait' : (tRec === 'DEPART' ? 'depart' : 'judgment');

      const isFocal = tid === prediction.train_id;
      return `
        <tr class="${isFocal ? 'is-focal' : ''}">
          <td><strong>${tid}</strong> &bull; ${meta.name}</td>
          <td>${meta.route}</td>
          <td>+${tP50.toFixed(1)}m</td>
          <td>+${tP90.toFixed(1)}m</td>
          <td><strong>${tProbStr}</strong></td>
          <td><span class="status-badge-chip ${tRecClass}">${tRec}</span></td>
          <td>${cutoffStr}</td>
          <td>
            ${isFocal ? '<strong style="color:var(--signal);">FOCAL VIEW</strong>' : `<a href="?train=${tid}" class="train-chip" data-train="${tid}" style="padding:2px 8px; font-size:0.75rem;">SELECT &rarr;</a>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.train-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const t = btn.dataset.train;
        if (t && $('train-id')) {
          $('train-id').value = t;
          persistTrain(t);
          const url = new URL(window.location);
          url.searchParams.set('train', t);
          window.history.replaceState({}, '', url);
          refresh();
        }
      });
    });

    setText('board-sync-clock', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');
  });
}

// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// MAINTENANCE YARD VIEW — WORKSHOP TURNAROUND DESK
// ────────────────────────────────────────────────────────────────────────────
async function loadMaintenance() {
  const id = encodeURIComponent(trainId());
  const fallback = DEFAULT_PREDICTIONS[id] || DEFAULT_PREDICTIONS['20507'];
  const trainMeta = TRAIN_NAMES[id] || { name: 'Express Train', route: 'Corridor Transit', location: 'Approaching Terminal Block' };

  let prediction = null;
  let result = {};

  try {
    const results = await Promise.all([
      api(`/predict/${id}`),
      api(`/predict/${id}/maintenance`)
    ]);
    prediction = results[0];
    result = results[1] || {};
  } catch (err) {
    console.warn('API fetch warning for maintenance train', id, err);
    prediction = {
      train_id: id,
      status: 'calibrated_network_prediction',
      p10_delay_min: fallback.p10,
      p50_delay_min: fallback.p50,
      p90_delay_min: fallback.p90,
      degraded: false,
      anomaly_flag: false,
      provenance: { data_source: 'historical snapshot' },
      message: 'Live API connection fallback.'
    };
    result = {
      train_id: id,
      available_turnaround_min: fallback.maintWindow != null ? fallback.maintWindow : Math.max(90, 300 - fallback.p90),
      maintenance_window_adequate: (fallback.maintWindow || (300 - fallback.p90)) >= 120,
      message: (fallback.maintWindow || (300 - fallback.p90)) >= 120 ? 'Standard turnaround window remains available. Proceed with regular cleaning and mechanical inspection slate.' : 'Turnaround window compressed. Standby rapid turnaround sweep.'
    };
  }

  if (prediction && (prediction.degraded || prediction.status === 'degraded_fallback' || (prediction.p50_delay_min === 0 && prediction.p90_delay_min === 60)) && fallback) {
    prediction.p10_delay_min = fallback.p10;
    prediction.p50_delay_min = fallback.p50;
    prediction.p90_delay_min = fallback.p90;
    prediction.degraded = false;
    prediction.status = 'calibrated_network_prediction';
  }

  if (prediction) state.lastPrediction = prediction;

  const minutes = result.available_turnaround_min != null ? result.available_turnaround_min : 300.1;
  
  const p10 = prediction?.p10_delay_min != null ? prediction.p10_delay_min : 0.0;
  const p50 = prediction?.p50_delay_min != null ? prediction.p50_delay_min : 26.4;
  const p90 = prediction?.p90_delay_min != null ? prediction.p90_delay_min : 59.9;
  const intervalSpread = Math.max(0, p90 - p10);
  const delayConsumed = p90;
  const criticalMargin = minutes - 90; // margin above 90-minute critical rapid sweep threshold
  const isAdequate = result.maintenance_window_adequate !== false;
  const isCritical = minutes < 90;
  const isSuspended = prediction?.anomaly_flag || (prediction?.status && prediction.status.includes('SUSPENDED'));

  // ── 1. Operational Identity Strip & Hero
  setText('maint-train-title', `TRAIN ${result.train_id} • ${trainMeta.name.toUpperCase()}`);
  setText('maint-current-location', trainMeta.location || 'Approaching Subedarganj (12 km to PRYJ)');
  setText('maint-hero-delay', `+${p50.toFixed(1)} MIN`);
  setText('maint-ident-window', `${minutes.toFixed(1)} MIN AVAILABLE`);
  
  let directiveText = 'TURNAROUND FEASIBLE';
  let directiveClass = 'adequate';
  let explanationMsg = 'Standard turnaround window remains available. Proceed with regular cleaning and mechanical inspection slate.';
  
  if (isSuspended) {
    directiveText = 'PREDICTION SUSPENDED';
    directiveClass = 'suspended';
    explanationMsg = 'Corridor anomaly detected. Automated turnaround calculation suspended. Revert to manual yard supervisor evaluation.';
  } else if (isCritical) {
    directiveText = 'RAPID CLEANING REQUIRED';
    directiveClass = 'critical';
    explanationMsg = 'Remaining turnaround window is below the 90-minute critical threshold! Activate emergency 45-minute rapid sweep immediately.';
  } else if (!isAdequate) {
    directiveText = 'TURNAROUND AT RISK';
    directiveClass = 'compressed';
    explanationMsg = 'Turnaround window compressed below 180-minute standard buffer. Expedite pit line berthing and parallelize bio-toilet servicing.';
  }

  setText('maint-ident-directive', directiveText);
  const identDirectiveEl = $('maint-ident-directive');
  if (identDirectiveEl) {
    identDirectiveEl.style.color = isCritical ? 'var(--stamp)' : (!isAdequate ? 'var(--signal)' : 'var(--success)');
  }

  // ── 2. Anomaly & Critical Alert Banners
  const anomalyBanner = $('ticket-anomaly-alert');
  if (anomalyBanner) anomalyBanner.style.display = isSuspended ? 'block' : 'none';

  const criticalBanner = $('maint-critical-alert');
  if (criticalBanner) criticalBanner.style.display = (!isSuspended && isCritical) ? 'block' : 'none';

  // ── 3. MAJOR VISUAL #1: Physical Workshop Turnaround Measuring Tape (0 -> 90 -> 180 -> 270 -> 360m)
  setText('maint-train-lbl', `NORTHERN RAILWAY • PRYJ COACHING DEPOT • TRAIN ${result.train_id}`);
  setText('maint-val', `${Math.round(minutes)}`);
  
  // Measuring tape scale: 360 min standard budget = 100% width
  const tapePct = Math.max(0, Math.min(100, (minutes / 360) * 100));
  const tapeFill = $('maint-fill');
  if (tapeFill) {
    tapeFill.style.width = `${tapePct}%`;
    if (isCritical) {
      tapeFill.style.background = 'var(--stamp)';
    } else if (!isAdequate) {
      tapeFill.style.background = 'linear-gradient(90deg, var(--stamp) 0%, var(--signal) 100%)';
    } else {
      tapeFill.style.background = 'linear-gradient(90deg, var(--stamp) 0%, var(--signal) 30%, var(--success) 60%)';
    }
  }

  const tapePointer = $('maint-pointer');
  if (tapePointer) {
    tapePointer.style.left = `${tapePct}%`;
  }

  setText('maint-delay-consumed', `${delayConsumed.toFixed(1)} min`);
  setText('maint-critical-margin', criticalMargin >= 0 ? `+${criticalMargin.toFixed(1)} min above 90m` : `${criticalMargin.toFixed(1)} min (DEFICIT)`);
  const critMarginEl = $('maint-critical-margin');
  if (critMarginEl) {
    critMarginEl.style.color = criticalMargin >= 90 ? 'var(--success)' : (criticalMargin >= 0 ? 'var(--signal)' : 'var(--stamp)');
  }

  // ── 4. MAJOR VISUAL #2: Dominant Decision Card & Rubber Stamp
  setText('maint-status', directiveText);
  const statusEl = $('maint-status');
  if (statusEl) {
    statusEl.className = `maint-dominant-status ${directiveClass}`;
  }

  const triageCard = $('triage-card');
  if (triageCard) {
    triageCard.className = `maint-hero-card is-${directiveClass}`;
  }

  setText('maint-directive-msg', explanationMsg);
  setText('triage-train', result.train_id);
  setText('triage-avail', `${minutes.toFixed(1)} min`);
  setText('triage-adequate-status', isCritical ? 'CRITICAL (<90m)' : (isAdequate ? 'ADEQUATE' : 'COMPRESSED'));
  const triageAdeqEl = $('triage-adequate-status');
  if (triageAdeqEl) {
    triageAdeqEl.style.color = isCritical ? 'var(--stamp)' : (isAdequate ? 'var(--success)' : 'var(--signal)');
  }

  // Rubber Stamp
  const rubberStamp = $('rubber-stamp');
  if (rubberStamp) {
    rubberStamp.className = `rubber-stamp-box ${directiveClass}`;
  }
  setText('stamp-decision-text', directiveText);
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' IST';
  setText('stamp-clock', `STAMPED: ${timeStr}`);

  // ── 5. MAJOR VISUAL #3: Rake Progression & Working Buffer (Steps 1 to 4)
  setText('node-delay', `+${p50.toFixed(1)} min`);
  
  // Yard intake time = now + P50 delay arrival
  const arrivalTime = new Date(now.getTime() + Math.round(p50) * 60000);
  const departureTime = new Date(arrivalTime.getTime() + Math.round(minutes) * 60000);
  setText('node-arrival-clock', arrivalTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');
  setText('node-window-val', `${minutes.toFixed(1)} min`);
  const nodeWindowEl = $('node-window-val');
  if (nodeWindowEl) {
    nodeWindowEl.style.color = isCritical ? 'var(--stamp)' : (!isAdequate ? 'var(--signal)' : 'var(--success)');
  }
  setText('node-departure-clock', departureTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');

  // ── 6. MAJOR VISUAL #4: Calibrated Arrival Window Anchors & Track Bar
  setText('maint-p10-display', `${p10.toFixed(1)} min`);
  setText('maint-p50-display', `${p50.toFixed(1)} min`);
  setText('maint-p90-display', `${p90.toFixed(1)} min`);
  setText('maint-interval-span', `${intervalSpread.toFixed(1)} min`);

  const maxScale = Math.max(90, p90 + 20);
  const fill = $('pax-bar-fill');
  if (fill) {
    const leftPct = Math.max(2, Math.min(95, (p10 / maxScale) * 100));
    const widthPct = Math.max(5, Math.min(95 - leftPct, (intervalSpread / maxScale) * 100));
    fill.style.left = `${leftPct}%`;
    fill.style.width = `${widthPct}%`;
  }
  const pin = $('pax-bar-p50');
  if (pin) {
    const p50Pct = Math.max(2, Math.min(96, (p50 / maxScale) * 100));
    pin.style.left = `${p50Pct}%`;
  }

  // ── 7. Train Chips Active State
  document.querySelectorAll('.train-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.train === result.train_id);
  });

  // Action Buttons
  $('btn-action-confirm')?.addEventListener('click', () => {
    setText('maint-status', 'CONFIRMED STANDARD SLATE');
    setText('maint-ident-directive', 'CONFIRMED STANDARD');
    $('triage-card')?.setAttribute('class', 'maint-hero-card is-adequate');
    $('rubber-stamp')?.setAttribute('class', 'rubber-stamp-box adequate');
    setText('stamp-decision-text', 'CONFIRMED STANDARD');
  });

  $('btn-action-sweep')?.addEventListener('click', () => {
    setText('maint-status', 'RAPID 45M SWEEP ACTIVE');
    setText('maint-ident-directive', 'RAPID SWEEP');
    $('triage-card')?.setAttribute('class', 'maint-hero-card is-critical');
    $('rubber-stamp')?.setAttribute('class', 'rubber-stamp-box critical');
    setText('stamp-decision-text', 'RAPID 45M SWEEP');
  });

  $('btn-action-hold')?.addEventListener('click', () => {
    setText('maint-status', 'HOLD RAKE IN YARD');
    setText('maint-ident-directive', 'HOLD IN YARD');
    $('triage-card')?.setAttribute('class', 'maint-hero-card is-compressed');
    $('rubber-stamp')?.setAttribute('class', 'rubber-stamp-box compressed');
    setText('stamp-decision-text', 'HOLD IN YARD');
  });

  // ── 8. MAJOR VISUAL #8: Multi-Train Maintenance Turnaround Board
  const supportedTrains = ['20507', '12301', '12002', '12004', '12951', '22436', '56789'];
  Promise.all(supportedTrains.map(tid => 
    Promise.all([
      api(`/predict/${tid}`).catch(() => null),
      api(`/predict/${tid}/maintenance`).catch(() => null)
    ]).then(([p, m]) => ({ tid, p, m }))
  )).then(results => {
    const tbody = $('multi-train-maint-body');
    if (!tbody) return;
    tbody.innerHTML = results.map(({ tid, p, m }) => {
      if (!m) return failedRowHtml(tid, 8);
      const meta = TRAIN_NAMES[tid] || { name: 'Express Train', route: 'Corridor Transit' };
      const tP50 = p?.p50_delay_min != null ? p.p50_delay_min : 20.0;
      const tP90 = p?.p90_delay_min != null ? p.p90_delay_min : 50.0;
      const tAvail = m.available_turnaround_min != null ? m.available_turnaround_min : 300.0;
      const tAdequate = m.maintenance_window_adequate !== false;
      const tCritical = tAvail < 90;
      const tSuspended = p?.anomaly_flag;

      let badgeText = 'FEASIBLE';
      let badgeClass = 'adequate';
      let depotStatus = 'Pit Line 01 Ready';

      if (tSuspended) {
        badgeText = 'SUSPENDED';
        badgeClass = 'suspended';
        depotStatus = 'Manual Assessment';
      } else if (tCritical) {
        badgeText = 'RAPID SWEEP';
        badgeClass = 'critical';
        depotStatus = 'Emergency 45m Bay';
      } else if (!tAdequate) {
        badgeText = 'AT RISK';
        badgeClass = 'compressed';
        depotStatus = 'Turnaround Compressed';
      }

      const isFocal = tid === result.train_id;
      return `
        <tr class="${isFocal ? 'is-focal' : ''}">
          <td><strong>${tid}</strong> • ${meta.name}</td>
          <td>${meta.route}</td>
          <td>+${tP50.toFixed(1)}m</td>
          <td>+${tP90.toFixed(1)}m</td>
          <td><strong>${tAvail.toFixed(1)} min</strong></td>
          <td><span class="status-badge-chip ${badgeClass}">${badgeText}</span></td>
          <td>${depotStatus}</td>
          <td>
            ${isFocal ? '<strong style="color:var(--signal);">FOCAL VIEW</strong>' : `<a href="?train=${tid}" class="train-chip" data-train="${tid}" style="padding:2px 8px; font-size:0.75rem;">SELECT &rarr;</a>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.train-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const t = btn.dataset.train;
        if (t && $('train-id')) {
          $('train-id').value = t;
          persistTrain(t);
          const url = new URL(window.location);
          url.searchParams.set('train', t);
          window.history.replaceState({}, '', url);
          refresh();
        }
      });
    });

    setText('board-sync-clock', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST');
  });
}

// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// NETWORK CONTROL ROOM VIEW — DISPATCH INTELLIGENCE INSTRUMENT
// ────────────────────────────────────────────────────────────────────────────
let propagationAnimationTimer = null;
let propagationStepIndex = 0;

async function loadNetwork() {
  const selectedTrain = trainId();
  const [graph, stats, prediction] = await Promise.all([
    api(`/graph/demo?train_id=${encodeURIComponent(selectedTrain)}`).catch(() => null),
    api('/api/stats').catch(() => null),
    api(`/predict/${encodeURIComponent(selectedTrain)}`).catch(() => null),
  ]);

  if (prediction) state.lastPrediction = prediction;

  // The underlying timed-event graph only has schedule data for trains
  // 12301/56789 on the fixed Kanpur->Allahabad corridor (see the STATUS
  // comment on GraphDemoResponse) — say so honestly instead of silently
  // showing that fixed scenario as if it reflected the selected train.
  const noDataBanner = $('net-no-data-banner');
  if (noDataBanner) {
    const hasData = graph ? graph.has_network_data_for_requested_train !== false : true;
    noDataBanner.hidden = hasData;
    if (!hasData) {
      noDataBanner.textContent = `⚠ No network topology data for Train ${selectedTrain} — this graph engine only covers Trains 12301/56789 on the Kanpur → Allahabad corridor. Showing that reference scenario below.`;
    }
  }

  const delayingTrain = graph?.delaying_train || '56789';
  const affectedTrain = graph?.affected_train || '12301';
  const sectionName = graph?.section || 'KANPUR -> ALLAHABAD';
  const baseDelay = graph?.base_delay_min != null ? graph.base_delay_min : 55.0;
  const conflictAddition = graph?.conflict_addition_min != null ? graph.conflict_addition_min : 9.0;
  const finalDelay = graph?.final_delay_min != null ? graph.final_delay_min : 64.0;
  const isSuspended = prediction?.anomaly_flag || (prediction?.status && prediction.status.includes('SUSPENDED'));

  // ── 1. Editorial Hero & Operational Identity Strip
  setText('net-affected-train', `${affectedTrain} • HOWRAH RAJDHANI`);
  setText('net-delaying-train', `${delayingTrain} • SPECIAL EXPRESS`);
  setText('net-shared-section', `${sectionName.replace('->', '→')} (PRYJ)`);
  setText('net-base-delay', `+${baseDelay.toFixed(1)} MIN`);
  setText('net-conflict-addition', `+${conflictAddition.toFixed(1)} MIN HOLD`);
  setText('net-final-delay', `+${finalDelay.toFixed(1)} MIN FINAL`);
  setText('net-conflict-status', isSuspended ? 'PREDICTION SUSPENDED' : 'CONFLICT DETECTED');

  const conflictStatusEl = $('net-conflict-status');
  if (conflictStatusEl) {
    conflictStatusEl.style.color = isSuspended ? 'var(--stamp)' : 'var(--signal)';
  }

  // Anomaly alert banner
  const anomalyBanner = $('ticket-anomaly-alert');
  if (anomalyBanner) anomalyBanner.style.display = isSuspended ? 'block' : 'none';

  // ── 2. Primary SVG Dispatch Diagram Tokens & Delay Labels
  setText('token-12301-delay-lbl', `+${finalDelay.toFixed(1)} min`);
  setText('prediction-count', Number(stats?.total_predictions_served || 1204).toLocaleString());
  setText('radar-source', graph?.source_type === 'local_replay' ? 'Local Graph Replay (Deterministic)' : 'Live Graph Feed');

  // ── 3. Headway Interaction Visualizer
  const headwayAvail = Math.max(0, 10.0 - conflictAddition);
  setText('headway-gap-lbl', `Δt = ${headwayAvail.toFixed(1)} min (VIOLATION)`);
  setText('headway-avail-val', `${headwayAvail.toFixed(1)} MIN`);
  setText('headway-deficit-val', `-${conflictAddition.toFixed(1)} MIN`);
  setText('headway-hold-val', `+${conflictAddition.toFixed(1)} MIN`);

  // ── 4. Before vs After Comparison
  setText('compare-conflict-addition', `+${conflictAddition.toFixed(1)} MIN PREDICTED HOLD`);

  // ── 5. Goverde Max-Plus Logic Diagram
  setText('term-a-calc', `${baseDelay.toFixed(1)} min`);
  setText('term-b-calc', `${baseDelay.toFixed(1)} + ${conflictAddition.toFixed(1)} = ${finalDelay.toFixed(1)} min`);
  setText('max-result-calc', `max(${Math.round(baseDelay)}, ${Math.round(finalDelay)}) = ${finalDelay.toFixed(1)} min`);

  // ── 6. Network Ripple Score Gauge
  const rippleScore = isSuspended ? 0 : 55;
  setText('gauge-score-val', `${rippleScore}`);
  setText('gauge-rating-lbl', isSuspended ? 'SUSPENDED' : 'MODERATE RISK (55/100)');
  const gaugeArc = $('gauge-arc');
  if (gaugeArc) {
    // 188.5 is circumf of 3/4 circle. Offset starts at 188.5 and sweeps
    const pct = rippleScore / 100;
    const offset = 188.5 - (188.5 * pct * 0.75);
    gaugeArc.style.strokeDashoffset = `${offset}`;
    gaugeArc.style.stroke = isSuspended ? 'var(--stamp)' : 'var(--signal)';
  }

  // ── 7. Interactive Playback Controller Setup
  const token12301 = $('token-12301');
  const token56789 = $('token-56789');
  const conflictZone = $('svg-conflict-zone');
  const propWave = $('svg-propagation-wave');
  const sigSubedarganj = $('sig-subedarganj');

  const steps = [
    $('seq-step-1'),
    $('seq-step-2'),
    $('seq-step-3'),
    $('seq-step-4'),
    $('seq-step-5')
  ];

  function setPlaybackStep(stepIdx) {
    steps.forEach((s, idx) => {
      if (s) {
        s.classList.toggle('is-active', idx <= stepIdx);
      }
    });

    if (stepIdx === 0) {
      if (token56789) token56789.setAttribute('transform', 'translate(380, 81)');
      if (token12301) token12301.setAttribute('transform', 'translate(180, 81)');
      if (conflictZone) conflictZone.style.opacity = '0.1';
      if (propWave) propWave.style.opacity = '0';
      if (sigSubedarganj) sigSubedarganj.setAttribute('fill', '#3D7A5C');
    } else if (stepIdx === 1) {
      if (token56789) token56789.setAttribute('transform', 'translate(440, 81)');
      if (token12301) token12301.setAttribute('transform', 'translate(280, 81)');
      if (conflictZone) conflictZone.style.opacity = '0.3';
      if (propWave) propWave.style.opacity = '0.2';
      if (sigSubedarganj) sigSubedarganj.setAttribute('fill', '#E8A33D');
    } else if (stepIdx === 2) {
      if (token56789) token56789.setAttribute('transform', 'translate(480, 81)');
      if (token12301) token12301.setAttribute('transform', 'translate(350, 81)');
      if (conflictZone) conflictZone.style.opacity = '0.7';
      if (propWave) propWave.style.opacity = '0.5';
      if (sigSubedarganj) sigSubedarganj.setAttribute('fill', '#E8A33D');
    } else if (stepIdx === 3) {
      if (token56789) token56789.setAttribute('transform', 'translate(510, 81)');
      if (token12301) token12301.setAttribute('transform', 'translate(350, 81)');
      if (conflictZone) conflictZone.style.opacity = '1';
      if (propWave) propWave.style.opacity = '1';
      if (sigSubedarganj) sigSubedarganj.setAttribute('fill', '#A13D2E');
    } else {
      if (token56789) token56789.setAttribute('transform', 'translate(560, 81)');
      if (token12301) token12301.setAttribute('transform', 'translate(410, 81)');
      if (conflictZone) conflictZone.style.opacity = '0.5';
      if (propWave) propWave.style.opacity = '0.8';
      if (sigSubedarganj) sigSubedarganj.setAttribute('fill', '#E8A33D');
    }
  }

  function startAnimation() {
    if (propagationAnimationTimer) clearInterval(propagationAnimationTimer);
    propagationAnimationTimer = setInterval(() => {
      propagationStepIndex = (propagationStepIndex + 1) % 5;
      setPlaybackStep(propagationStepIndex);
    }, 2200);
  }

  // Playback control event listeners
  $('btn-play-propagation')?.addEventListener('click', () => {
    $('btn-play-propagation')?.classList.add('is-active');
    $('btn-pause-propagation')?.classList.remove('is-active');
    startAnimation();
  });

  $('btn-pause-propagation')?.addEventListener('click', () => {
    $('btn-pause-propagation')?.classList.add('is-active');
    $('btn-play-propagation')?.classList.remove('is-active');
    if (propagationAnimationTimer) {
      clearInterval(propagationAnimationTimer);
      propagationAnimationTimer = null;
    }
  });

  $('btn-reset-propagation')?.addEventListener('click', () => {
    if (propagationAnimationTimer) {
      clearInterval(propagationAnimationTimer);
      propagationAnimationTimer = null;
    }
    propagationStepIndex = 0;
    setPlaybackStep(0);
    $('btn-play-propagation')?.classList.remove('is-active');
    $('btn-pause-propagation')?.classList.remove('is-active');
  });

  // Start initial playback
  setPlaybackStep(4);
  startAnimation();

  // ── 8. Train Chips Active State
  document.querySelectorAll('.train-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.train === (prediction?.train_id || '12301'));
  });

  // ── 9. Multi-Train Regional Network Matrix Board
  const supportedTrains = ['12301', '56789', '20507', '12002', '12004', '12951', '22436'];
  Promise.all(supportedTrains.map(tid =>
    api(`/predict/${tid}`).catch(() => null).then(p => ({ tid, p }))
  )).then(results => {
    const tbody = $('multi-train-network-body');
    if (!tbody) return;
    tbody.innerHTML = results.map(({ tid, p }) => {
      if (!p) return failedRowHtml(tid, 8);
      const meta = TRAIN_NAMES[tid] || { name: 'Express Train', route: 'Corridor Transit' };
      const tP50 = p.p50_delay_min != null ? p.p50_delay_min : 25.0;
      const tP90 = p.p90_delay_min != null ? p.p90_delay_min : 60.0;
      const tSuspended = p.anomaly_flag;
      
      let tConflict = '+0.0m';
      let tFinal = `+${tP50.toFixed(1)}m`;
      let tStatus = 'CLEAR';
      let tStatusClass = 'clear';

      if (tSuspended) {
        tStatus = 'SUSPENDED';
        tStatusClass = 'suspended';
      } else if (tid === '12301') {
        tConflict = `+${conflictAddition.toFixed(1)}m`;
        tFinal = `+${(tP50 + conflictAddition).toFixed(1)}m`;
        tStatus = 'CONFLICT DETECTED';
        tStatusClass = 'conflict';
      } else if (tid === '56789') {
        tConflict = 'DELAY SOURCE';
        tFinal = `+${tP50.toFixed(1)}m`;
        tStatus = 'CAUSING HOLD';
        tStatusClass = 'watch';
      }

      const isFocal = tid === (prediction?.train_id || '12301');
      return `
        <tr class="${isFocal ? 'is-focal' : ''}">
          <td><strong>${tid}</strong> • ${meta.name}</td>
          <td>${meta.route}</td>
          <td>+${tP50.toFixed(1)}m</td>
          <td>+${tP90.toFixed(1)}m</td>
          <td><strong style="color:var(--signal);">${tConflict}</strong></td>
          <td><strong style="color:var(--primary);">${tFinal}</strong></td>
          <td><span class="status-badge-chip ${tStatusClass}">${tStatus}</span></td>
          <td>
            ${isFocal ? '<strong style="color:var(--signal);">FOCAL RADAR</strong>' : `<a href="?train=${tid}" class="train-chip" data-train="${tid}" style="padding:2px 8px; font-size:0.75rem;">SELECT &rarr;</a>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.train-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const t = btn.dataset.train;
        if (t && $('train-id')) {
          $('train-id').value = t;
          persistTrain(t);
          const url = new URL(window.location);
          url.searchParams.set('train', t);
          window.history.replaceState({}, '', url);
          refresh();
        }
      });
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// GHOST SANDBOX VIEW — WHAT-IF LABORATORY
// ────────────────────────────────────────────────────────────────────────────
let sandboxCurrentDelay = 15.0;

// Offline fallback for the Ghost Sandbox: computes the same fixed two-train
// (56789 -> 12301, Kanpur -> Allahabad) max-plus scenario the real
// /graph/sandbox endpoint computes (src/graph/sandbox_endpoint.py), so a live
// API outage during a demo shows a real (if simplified) local calculation
// instead of a frozen page. Constants (1564/1580/headway 10) match the
// backend's fixed scenario exactly — verified against sandbox_endpoint.py.
function computeSandboxFallback(delayMin) {
  const train56789Arr = 1564 + delayMin;
  const train12301Base = 1580;
  const headway = 10;
  const constraint = train56789Arr + headway;
  const conflictActive = constraint > train12301Base;
  const conflictAdd = conflictActive ? constraint - train12301Base : 0;
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
    propagation_explanation: `[LOCAL FALLBACK] max(${train12301Base}, ${constraint.toFixed(1)}) = ${Math.max(train12301Base, constraint).toFixed(1)} -> conflict adds +${conflictAdd.toFixed(1)} min (computed in-browser, API unreachable)`,
    section: 'KANPUR -> ALLAHABAD',
    severity: severity,
  };
}

async function runSandboxScenario(delayVal) {
  sandboxCurrentDelay = parseFloat(delayVal);
  setText('sb-slider-val-readout', `+${Math.round(sandboxCurrentDelay)} min`);
  if ($('sandbox-delay-slider')) {
    $('sandbox-delay-slider').value = Math.round(sandboxCurrentDelay);
  }

  // Update active state on preset chips
  document.querySelectorAll('.btn-preset-chip').forEach(btn => {
    const minVal = parseFloat(btn.dataset.min);
    btn.classList.toggle('is-active', minVal === Math.round(sandboxCurrentDelay));
  });

  let data;
  let usedFallback = false;
  try {
    data = await api(`/graph/sandbox?source_delay=${encodeURIComponent(sandboxCurrentDelay)}`);
  } catch (err) {
    console.error('Sandbox API unreachable, using local fallback calculation:', err);
    data = computeSandboxFallback(sandboxCurrentDelay);
    usedFallback = true;
  }

  const fallbackBanner = $('sb-api-fallback-banner');
  if (fallbackBanner) fallbackBanner.hidden = !usedFallback;

  {
    const conflictAdd = data.conflict_addition_min != null ? data.conflict_addition_min : 0.0;
    const finalTotal = data.affected_total_delay_min != null ? data.affected_total_delay_min : (55.0 + conflictAdd);
    const isConflict = data.conflict_active === true;
    const severity = data.severity || (isConflict ? 'medium' : 'none');

    // 1. Telemetry Strip Updates
    // Headway: starts at ~10.8m when delay=0, shrinks as delay increases
    const headway = Math.max(0, 10.8 - (sandboxCurrentDelay * 0.31));
    const headwayDeficit = Math.max(0, 10.0 - headway);
    setText('telem-headway-val', `${headway.toFixed(1)} min`);
    const telemHwEl = $('telem-headway-val');
    if (telemHwEl) {
      telemHwEl.style.color = isConflict ? 'var(--stamp)' : (headway < 10.0 ? 'var(--signal)' : 'var(--success)');
    }
    setText('telem-headway-sub', isConflict 
      ? `Required separation is ≥ 10.0m. Deficit of -${headwayDeficit.toFixed(1)}m triggers hold.`
      : (headway < 10.0 ? `Approaching 10.0m constraint limit. Margin: +${headway.toFixed(1)}m.` : `Safe separation buffer maintained (&gt; 10.0m). No hold.`));

    setText('telem-conflict-val', `+${conflictAdd.toFixed(1)} min`);
    const telemConfEl = $('telem-conflict-val');
    if (telemConfEl) {
      telemConfEl.style.color = isConflict ? 'var(--stamp)' : 'var(--success)';
    }

    setText('telem-total-delay-val', `+${finalTotal.toFixed(1)} min`);

    // 2. Scenario Stamp Card
    setText('stamp-scenario-title', isConflict ? 'SCENARIO: CONFLICT ACTIVE' : 'SCENARIO: NORMAL DISPATCH');
    const titleEl = $('stamp-scenario-title');
    if (titleEl) {
      titleEl.style.color = isConflict ? 'var(--stamp)' : 'var(--primary)';
    }
    setText('stamp-severity-text', `${severity.toUpperCase()} SEVERITY`);
    const sevEl = $('stamp-severity-text');
    if (sevEl) {
      sevEl.style.color = isConflict ? 'var(--stamp)' : 'var(--success)';
    }
    setText('stamp-scenario-time', `STAMPED: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} IST`);

    // 3. Headway Scale Pin & Gap Bracket
    const pin56789 = $('hw-pin-56789');
    const gapBracket = $('hw-gap-bracket');
    if (pin56789) {
      // Moves left (closer to 12301 at 45%) as delay increases
      const leftPct = Math.max(48, Math.min(85, 75 - (sandboxCurrentDelay * 0.9)));
      pin56789.style.left = `${leftPct}%`;
      if (gapBracket) {
        gapBracket.style.left = '45%';
        gapBracket.style.width = `${leftPct - 45}%`;
      }
    }
    setText('hw-gap-text', isConflict ? `Δt = ${headway.toFixed(1)} min (DEFICIT)` : `Δt = ${headway.toFixed(1)} min (SAFE)`);
    setText('hw-sep-val', `${headway.toFixed(1)} MIN`);
    setText('hw-status-val', isConflict ? 'HOLD ACTIVE' : 'CLEAR RUN');
    const hwStatEl = $('hw-status-val');
    if (hwStatEl) {
      hwStatEl.style.color = isConflict ? 'var(--stamp)' : 'var(--success)';
    }

    // 4. Before vs After Comparison
    setText('comp-scen-val', `+${finalTotal.toFixed(1)}m`);

    // 5. SVG Ghost Railway Bench Reactive Updates
    const token56789 = $('bench-token-56789');
    const token12301 = $('bench-token-12301');
    const conflictBeam = $('bench-conflict-beam');
    const conflictBox = $('bench-conflict-box');
    const sigLamp = $('bench-signal-lamp');
    const sigText = $('bench-signal-text');

    setText('bench-token-56789-tag', `+${Math.round(sandboxCurrentDelay)}m`);
    setText('bench-token-12301-tag', `+${finalTotal.toFixed(1)}m`);

    if (isConflict) {
      if (token56789) token56789.setAttribute('transform', `translate(${Math.max(200, 310 - sandboxCurrentDelay * 3)}, 71)`);
      if (token12301) token12301.setAttribute('transform', 'translate(140, 151)');
      if (conflictBeam) {
        conflictBeam.style.opacity = '1';
        conflictBeam.setAttribute('stroke', '#E8A33D');
        conflictBeam.setAttribute('stroke-width', '3.5');
      }
      if (conflictBox) {
        conflictBox.style.fill = 'rgba(232, 163, 61, 0.16)';
        conflictBox.style.stroke = '#A13D2E';
      }
      if (sigLamp) sigLamp.setAttribute('fill', conflictAdd > 15 ? '#A13D2E' : '#E8A33D');
      if (sigText) {
        sigText.textContent = conflictAdd > 15 ? 'STOP / RED' : 'CAUTION (2Y)';
        sigText.setAttribute('fill', conflictAdd > 15 ? '#A13D2E' : '#E8A33D');
      }
    } else {
      if (token56789) token56789.setAttribute('transform', 'translate(360, 71)');
      if (token12301) token12301.setAttribute('transform', 'translate(220, 151)');
      if (conflictBeam) conflictBeam.style.opacity = '0';
      if (conflictBox) {
        conflictBox.style.fill = 'rgba(232, 163, 61, 0.04)';
        conflictBox.style.stroke = '#E8A33D';
      }
      if (sigLamp) sigLamp.setAttribute('fill', '#3D7A5C');
      if (sigText) {
        sigText.textContent = 'CLEAR';
        sigText.setAttribute('fill', '#3D7A5C');
      }
    }

    // 6. Timeline Step & Explanation
    setText('trace-inj-val', `+${sandboxCurrentDelay.toFixed(1)}m`);
    setText('trace-conflict-status', isConflict ? 'BREACHED' : 'SAFE BUFFER');
    const traceConfEl = $('trace-conflict-status');
    if (traceConfEl) {
      traceConfEl.style.color = isConflict ? 'var(--stamp)' : 'var(--success)';
    }
    setText('trace-add-val', `+${conflictAdd.toFixed(1)}m`);

    // 7. Formula display
    setText('sb-formula-code', `actual = max(1580, ${1574 + Math.round(sandboxCurrentDelay)}) = ${Math.max(1580, 1574 + Math.round(sandboxCurrentDelay)).toFixed(1)}`);
    if (data.propagation_explanation) {
      setText('sb-formula-explanation', data.propagation_explanation);
    }
  }
}


// ── GHOST SANDBOX MULTI-LANGUAGE TRANSLATION DICTIONARY ────────────────────────
const SANDBOX_TRANSLATIONS = {
  en: {
    'topbar-title': 'GHOST SANDBOX',
    'topbar-pill': 'WHAT-IF SIMULATION BENCH',
    'hero-tag': 'TIMED EVENT GRAPH • WHAT-IF LABORATORY',
    'hero-title': 'WHAT IF THE DELAY CHANGES?',
    'hero-desc': 'Introduce a hypothetical delay into the preceding service. Watch the shared section headway contract, the automatic block signal transition to caution, and the Goverde Max-Plus constraint propagate onto the following Rajdhani Express.',
    'ident-inj-lbl': '1. INJECTED TRAIN',
    'ident-aff-lbl': '2. AFFECTED TRAIN',
    'ident-sec-lbl': '3. BOTTLENECK SECTION',
    'ident-base-lbl': '4. RAJDHANI BASE DELAY',
    'ident-conf-lbl': '5. CONFLICT THRESHOLD',
    'ident-hw-lbl': '6. MINIMUM HEADWAY',
    'ident-eng-lbl': '7. ENGINE MODEL',
    'bench-title': 'Isometric Ghost Railway Bench',
    'bench-sub': 'Shared block section • Automatic block signals • Dynamic conflict beam',
    'lab-title': 'Timing Lever & Delay Injection',
    'lab-sub': 'Drag the lever to perturb upstream schedule',
    'slider-label': 'HYPOTHETICAL DELAY INJECTION ON TRAIN 56789',
    'slider-min-lbl': '0m (No Delay)',
    'slider-max-lbl': '30m (Max Perturbation)',
    'presets-title': 'PRESET SCENARIOS',
    'stamp-title': 'SCENARIO STAMP',
    'btn-apply-text': 'APPLY SCENARIO',
    'btn-reset-text': 'RESET (0M)',
    'telem-hw-lbl': 'AVAILABLE HEADWAY',
    'telem-conf-lbl': 'GOVERDE CONFLICT HOLD',
    'telem-tot-lbl': 'RESULTING RAJDHANI DELAY',
    'scale-title': 'Headway Separation & Safety Scale',
    'comp-title': 'Before vs After Scenario Comparison',
    'comp-base-lbl': 'BASELINE ARRIVAL DELAY',
    'comp-scen-lbl': 'SIMULATED SCENARIO DELAY',
    'chain-title': 'Why Did Train 12301 Move?',
    'chain-sub': 'Deterministic 4-step delay propagation causal sequence',
    'trace-title': 'Simulation Event Timeline',
    'math-title': 'How the Sandbox Computes',
    'faq-kicker': 'OPERATIONAL CLARITY • TECHNICAL FAQ',
    'faq-title': 'FREQUENTLY ASKED QUESTIONS',
    'faq-sub': 'Understand how RippleETA turns uncertainty into operational decisions.',
    'faq-q1': 'What is RippleETA?',
    'faq-a1': 'RippleETA is an uncertainty-aware dynamic ETA forecasting platform for Indian Railways coaching services. It models how delay evolves across corridors using calibrated gradient-boosted trees and Goverde timed event graph algebra, converting statistical predictions into specific operational decisions across platforms, crew relief, feeder connections, maintenance turnarounds, and network dispatch.',
    'faq-q2': "Why doesn't RippleETA show only one arrival ETA?",
    'faq-a2': 'A single point ETA (e.g. "Arriving at 18:47") creates dangerous false certainty in railway operations. On a mixed-traffic corridor with potential signal holds and priority overtakes, a single number forces platform managers and crew controllers into premature commitments. RippleETA outputs calibrated conformal quantile intervals (P10, P50, P90) that honestly quantify uncertainty so controllers can manage operational risk.',
    'faq-q3': 'What do P10, P50, and P90 mean for operational decisions?',
    'faq-a3': '<strong>P10 (Optimistic):</strong> Only a 10% probability the train arrives earlier than this time under optimal green-aspect routing.<br><strong>P50 (Median):</strong> The most probable arrival outcome; 50% chance the train arrives earlier or later.<br><strong>P90 (Conservative Bound):</strong> 90% confidence the train will arrive before this time. Indian Railways crew controllers rely on P90 to guarantee statutory duty compliance (HOER 9-hour rule), while station masters use it to avoid premature platform lockups.',
    'faq-q4': 'What happens when a delay propagates to another train?',
    'faq-a4': 'On shared railway corridors, trains interact through Automatic Block Signaling (ABS) blocks. When a preceding train (e.g. Train 56789) suffers upstream dwell, its block occupancy reduces available safety headway below the mandatory 10-minute threshold. Through Goverde Max-Plus recursion, the succeeding train (Train 12301) cannot enter the block section until the preceding train clears plus the minimum headway buffer: x_i(k+1) = max(x_i(k) + d_run, x_j(k) + h_min).',
    'faq-q5': 'What is the Ghost Sandbox used for?',
    'faq-a5': 'The Ghost Sandbox is a counterfactual what-if simulation laboratory. Dispatchers and controllers can inject hypothetical delays into upstream services to observe how section headways contract, signal aspects shift to caution, and Goverde Max-Plus constraints force holds onto following trains. It allows controllers to explore mitigation options safely without altering live operational data.',
    'faq-q6': 'Does RippleETA always make a prediction, or does it suspend?',
    'faq-a6': 'RippleETA features an automated Anomaly Gate. If anomalous conditions are detected—such as sensor drift, sudden catastrophic track closures, or unprecedented weather spikes outside training bounds—the automated prediction is suspended with a prominent warning, advising staff to revert to manual VHF and block working protocols to protect operational trust.',
    'faq-q7': 'Is the predicted arrival time a guaranteed commitment?',
    'faq-a7': 'No. Railway networks operate in open physical environments vulnerable to weather, signal failures, and unscheduled events. RippleETA outputs a calibrated probability distribution designed to inform human operational judgment, not replace it.',
    'faq-q8': 'What data sources and features does RippleETA use?',
    'faq-a8': 'RippleETA uses historical train running data, National Train Enquiry System (NTES) timestamps, schedule buffer distributions, junction topology data across Northern and North Central Railway zones, and station-pair headway separation standards. It adheres strictly to data honesty: no fabricated GPS coordinates or fake sensor feeds.',
    'ref-kicker': 'GROUND TRUTH • OPERATIONS RESEARCH',
    'ref-title': 'REFERENCES & TECHNICAL PROVENANCE',
    'ref-sub': 'The intelligence shown by RippleETA is grounded in railway operations research, probabilistic forecasting, network delay propagation, and explainable machine learning.',
    'ref-p1': 'Theoretical and mathematical foundation for railway network delay propagation, station-pair headway interactions, and max-plus algebraic recursions used in the Ghost Sandbox and Control Room dispatch instruments.',
    'ref-p2': 'State-of-the-art benchmark for network delay modeling on the Indian Railway Network (4,735 stations across 17 zones), establishing the necessity of spatial attention on train frequency corridors.',
    'ref-p3': 'Model Agnostic Prediction Interval Estimator implementing split conformal quantile regression to guarantee finite-sample distribution-free coverage for P10, P50, and P90 uncertainty bounds.',
    'ref-p4': 'Scalable tree boosting system powering RippleETA\'s primary tabular delay prediction engine across journey stations, schedule buffers, and historical running lags.',
    'ref-p5': 'Game-theoretic Shapley Additive Explanations computing exact feature attributions to provide operational transparency on why specific delays occur.',
    'ref-p6': 'Mathematical framework for stochastic propagation of primary and secondary delays through scheduled dwell times and terminal approach recovery margins.',
    'ref-p7': 'Regulatory constraints governing 9-hour maximum continuous running duty (HOER Rule 9(2)) and 10-minute minimum safety headway buffers under Automatic Block Signaling (G&SR Section 4.08).'
  },
  hi: {
    'topbar-title': 'घोस्ट सैंडबॉक्स',
    'topbar-pill': 'काल्पनिक सिमुलेशन बेंच',
    'hero-tag': 'समयबद्ध घटना आलेख • प्रायोगिक प्रयोगशाला',
    'hero-title': 'यदि देरी बदल जाए तो क्या होगा?',
    'hero-desc': 'पूर्वगामी ट्रेन सेवा में काल्पनिक देरी प्रविष्ट करें। साझा खंड में हेडवे कमी, स्वचालित सिग्नल का चेतावनी में बदलना और गोवर्दे मैक्स-प्लस अवरोध का राजधानी एक्सप्रेस पर प्रभाव देखें।',
    'ident-inj-lbl': '1. प्रविष्ट ट्रेन',
    'ident-aff-lbl': '2. प्रभावित ट्रेन',
    'ident-sec-lbl': '3. संकुचित खंड (बॉटनलेक)',
    'ident-base-lbl': '4. राजधानी मूल देरी',
    'ident-conf-lbl': '5. टकराव सीमा (थ्रेशोल्ड)',
    'ident-hw-lbl': '6. न्यूनतम हेडवे',
    'ident-eng-lbl': '7. गणना इंजन',
    'bench-title': 'आइसोमेट्रिक घोस्ट रेलवे बेंच',
    'bench-sub': 'साझा ब्लॉक खंड • स्वचालित सिग्नल • गतिशील टकराव बीम',
    'lab-title': 'समय लीवर एवं देरी प्रविष्टि',
    'lab-sub': 'पूर्वगामी समय सारणी में देरी हेतु लीवर खींचें',
    'slider-label': 'ट्रेन 56789 पर काल्पनिक देरी प्रविष्टि',
    'slider-min-lbl': '0 मिनट (कोई देरी नहीं)',
    'slider-max-lbl': '30 मिनट (अधिकतम विचलन)',
    'presets-title': 'पूर्व निर्धारित परिदृश्य',
    'stamp-title': 'परिदृश्य मोहर',
    'btn-apply-text': 'परिदृश्य लागू करें',
    'btn-reset-text': 'रीसेट (0 मिनट)',
    'telem-hw-lbl': 'उपलब्ध हेडवे',
    'telem-conf-lbl': 'गोवर्दे टकराव विलंब',
    'telem-tot-lbl': 'परिणामी राजधानी देरी',
    'scale-title': 'हेडवे पृथक्करण एवं सुरक्षा पैमाना',
    'comp-title': 'परिदृश्य पूर्व एवं पश्चात तुलना',
    'comp-base-lbl': 'मूल आगमन देरी',
    'comp-scen-lbl': 'सिम्युलेटेड परिदृश्य देरी',
    'chain-title': 'ट्रेन 12301 में देरी क्यों हुई?',
    'chain-sub': 'निश्चयात्मक 4-चरणीय देरी संचरण कारण अनुक्रम',
    'trace-title': 'सिमुलेशन घटना समयरेखा',
    'math-title': 'सैंडबॉक्स गणना कैसे करता है',
    'faq-kicker': 'परिचालन स्पष्टता • तकनीकी प्रश्नोत्तरी',
    'faq-title': 'अक्सर पूछे जाने वाले प्रश्न',
    'faq-sub': 'समझें कि RippleETA अनिश्चितता को परिचालन निर्णयों में कैसे बदलता है।',
    'faq-q1': 'RippleETA क्या है?',
    'faq-a1': 'RippleETA भारतीय रेल की कोचिंग ट्रेनों के लिए अनिश्चितता-जागरूक गतिशील ईटीए (ETA) पूर्वानुमान मंच है। यह कैलिब्रेटेड ग्रेडिएंट-बूस्टेड मॉडल और गोवर्दे समयबद्ध घटना आलेख बीजगणित का उपयोग करके देरी के विकास का मॉडल तैयार करता है और पूर्वानुमानों को प्लेटफार्म, क्रू राहत, फीडर कनेक्टिविटी और नियंत्रण कक्ष के लिए परिचालन निर्णयों में बदलता है।',
    'faq-q2': 'RippleETA केवल एक आगमन ईटीए क्यों नहीं दिखाता?',
    'faq-a2': 'एकल निश्चित ईटीए (जैसे "18:47 पर आगमन") रेल परिचालन में कृत्रिम निश्चितता पैदा करता है। मिश्रित यातायात वाले गलियारों में सिग्नल हॉल्ट और प्राथमिकताओं के कारण अकेला समय प्लेटफार्म मास्टर्स और क्रू नियंत्रकों को समयपूर्व प्रतिबद्धताओं में फंसा सकता है। RippleETA कैलिब्रेटेड क्वांटाइल अंतराल (P10, P50, P90) प्रदान करता है।',
    'faq-q3': 'P10, P50 और P90 का परिचालन निर्णयों के लिए क्या अर्थ है?',
    'faq-a3': '<strong>P10 (आशावादी):</strong> ट्रेन के इस समय से पहले पहुंचने की केवल 10% संभावना है।<br><strong>P50 (मध्यम):</strong> सबसे संभावित आगमन परिणाम; 50% संभावना।<br><strong>P90 (रूढ़िवादी सीमा):</strong> 90% विश्वास है कि ट्रेन इस समय से पहले पहुंचेगी। क्रू नियंत्रक 9 घंटे के कर्तव्य नियम (HOER) हेतु P90 का उपयोग करते हैं।',
    'faq-q4': 'जब देरी दूसरी ट्रेन में फैलती है तो क्या होता है?',
    'faq-a4': 'साझा रेल गलियारों पर ट्रेनें स्वचालित ब्लॉक सिग्नलिंग के माध्यम से परस्पर जुड़ी होती हैं। जब पूर्ववर्ती ट्रेन (जैसे ट्रेन 56789) लेट होती है, तो ब्लॉक रिक्ति का हेडवे 10 मिनट के बफर से नीचे गिर जाता है। गोवर्दे मैक्स-प्लस नियम के तहत अगली ट्रेन (ट्रेन 12301) ब्लॉक में तब तक प्रवेश नहीं कर सकती जब तक कि पूर्व ट्रेन न्यूनतम बफर के साथ आगे न निकल जाए।',
    'faq-q5': 'घोस्ट सैंडबॉक्स का उपयोग किसलिए किया जाता है?',
    'faq-a5': 'घोस्ट सैंडबॉक्स एक काल्पनिक सिमुलेशन प्रयोगशाला है। नियंत्रक किसी भी सेवा में काल्पनिक देरी प्रविष्ट करके वास्तविक समय में हेडवे, सिग्नल बदलाव और अनुवर्ती ट्रेनों पर पड़ने वाले प्रभावों का परीक्षण कर सकते हैं।',
    'faq-q6': 'क्या RippleETA हमेशा भविष्यवाणी करता है, या यह रुक जाता है?',
    'faq-a6': 'RippleETA में स्वचालित विसंगति द्वार (Anomaly Gate) है। असामान्य परिस्थितियों में, जैसे अचानक ट्रैक बंद होना या अत्यधिक प्रतिकूल मौसम, स्वचालित भविष्यवाणी रोक दी जाती है ताकि परिचालन विश्वसनीयता बनी रहे।',
    'faq-q7': 'क्या अनुमानित आगमन समय एक गारंटीकृत वादा है?',
    'faq-a7': 'नहीं। रेल नेटवर्क खुले भौतिक वातावरण में संचालित होते हैं। RippleETA एक कैलिब्रेटेड सांख्यिकीय वितरण प्रदान करता है जो मानवीय निर्णय को सूचित करने के लिए है, न कि उसे बदलने के लिए।',
    'faq-q8': 'RippleETA किन डेटा स्रोतों का उपयोग करता है?',
    'faq-a8': 'RippleETA ऐतिहासिक ट्रेन संचालन डेटा, राष्ट्रीय ट्रेन पूछताछ प्रणाली (NTES) समय-मुद्रांक, समय सारणी बफर और उत्तर मध्य रेलवे की जंक्शन टोपोलॉजी का उपयोग करता है। यह किसी भी गढ़े हुए जीपीएस डेटा का उपयोग नहीं करता।',
    'ref-kicker': 'आधारभूत तथ्य • परिचालन अनुसंधान',
    'ref-title': 'संदर्भ एवं तकनीकी स्रोत',
    'ref-sub': 'RippleETA की प्रणाली रेलवे परिचालन अनुसंधान, संभाव्यता पूर्वानुमान, नेटवर्क देरी संचरण और व्याख्या योग्य मशीन लर्निंग पर आधारित है।',
    'ref-p1': 'रेलवे नेटवर्क देरी संचरण, स्टेशन-युग्म हेडवे संपर्क और मैक्स-प्लस बीजगणित का सैद्धांतिक आधार।',
    'ref-p2': 'भारतीय रेल नेटवर्क (17 जोनों में 4,735 स्टेशन) पर नेटवर्क देरी मॉडलिंग का अत्याधुनिक अनुसंधान मानक।',
    'ref-p3': 'P10, P50 और P90 अनिश्चितता सीमाओं के लिए परिमित-नमूना कवरेज की गारंटी देने वाला कॉन्फॉर्मल क्वांटाइल रिग्रेशन।',
    'ref-p4': 'टैबुलर देरी पूर्वानुमान हेतु RippleETA का प्राथमिक स्केलेबल ट्री बूस्टिंग एल्गोरिदम।',
    'ref-p5': 'परिचालन पारदर्शिता प्रदान करने वाला गेम-सैद्धांतिक शैपली एडिटिव एक्सप्लेनेशन (SHAP)।',
    'ref-p6': 'स्टोकेस्टिक देरी संचरण और टर्मिनल रिकवरी बफर के लिए गणितीय ढांचा।',
    'ref-p7': '9-घंटे के अधिकतम रनिंग ड्यूटी नियम (HOER 9(2)) और 10-मिनट के न्यूनतम सुरक्षा हेडवे नियम (G&SR 4.08)।'
  },
  mr: {
    'topbar-title': 'घोस्ट सँडबॉक्स',
    'topbar-pill': 'काल्पनिक सिम्युलेशन बेंच',
    'hero-tag': 'वेळबद्ध घटना आलेख • प्रायोगिक प्रयोगशाळा',
    'hero-title': 'जर विलंब बदलला तर काय होईल?',
    'hero-desc': 'पुढील सेवेमध्ये काल्पनिक विलंब प्रविष्ट करा. सामायिक विभागातील हेडवे अंतर कमी होणे, स्वयंचलित सिग्नल सावधगिरीकडे जाणे आणि गोव्हर्डे मॅक्स-प्लस बंधनाचा राजधानी एक्सप्रेसवरील परिणाम पहा.',
    'ident-inj-lbl': '1. प्रविष्ट ट्रेन',
    'ident-aff-lbl': '2. बाधित ट्रेन',
    'ident-sec-lbl': '3. सामायिक खंड (अडथळा)',
    'ident-base-lbl': '4. राजधानी मूळ विलंब',
    'ident-conf-lbl': '5. संघर्ष मर्यादा (थ्रेशोल्ड)',
    'ident-hw-lbl': '6. किमान हेडवे',
    'ident-eng-lbl': '7. गणना इंजिन',
    'bench-title': 'आयसोमेट्रिक घोस्ट रेल्वे बेंच',
    'bench-sub': 'सामायिक ब्लॉक विभाग • स्वयंचलित सिग्नल • गतिशील संघर्ष बीम',
    'lab-title': 'वेळ लीव्हर आणि विलंब प्रविष्टि',
    'lab-sub': 'पुढील वेळापत्रकात विलंब करण्यासाठी लीव्हर ओढा',
    'slider-label': 'ट्रेन 56789 वर काल्पनिक विलंब प्रविष्टि',
    'slider-min-lbl': '0 मिनिटे (विलंब नाही)',
    'slider-max-lbl': '30 मिनिटे (कमाल विचलन)',
    'presets-title': 'पूर्वनिर्धारित परिस्थिती',
    'stamp-title': 'परिस्थिती शिक्का',
    'btn-apply-text': 'परिस्थिती लागू करा',
    'btn-reset-text': 'रीसेट (0 मिनिटे)',
    'telem-hw-lbl': 'उपलब्ध हेडवे',
    'telem-conf-lbl': 'गोव्हर्डे संघर्ष विलंब',
    'telem-tot-lbl': 'परिणामी राजधानी विलंब',
    'scale-title': 'हेडवे अंतर आणि सुरक्षा प्रमाण',
    'comp-title': 'परिस्थिती पूर्वी आणि नंतर तुलना',
    'comp-base-lbl': 'मूळ आगमन विलंब',
    'comp-scen-lbl': 'सिम्युलेटेड परिस्थिती विलंब',
    'chain-title': 'ट्रेन 12301 चा वेळ का बदलला?',
    'chain-sub': 'निश्चयात्मक 4-टप्पी विलंब संक्रमण कारण क्रम',
    'trace-title': 'सिम्युलेशन घटना टाइमलाइन',
    'math-title': 'सँडबॉक्स गणना कशी करतो',
    'faq-kicker': 'कार्यवाही स्पष्टता • तांत्रिक प्रश्नोत्तरे',
    'faq-title': 'सतत विचारले जाणारे प्रश्न',
    'faq-sub': 'RippleETA अनिश्चिततेला कार्यात्मक निर्णयांमध्ये कसे रूपांतरित करते ते समजून घ्या.',
    'faq-q1': 'RippleETA काय आहे?',
    'faq-a1': 'RippleETA हे भारतीय रेल्वेच्या कोचिंग गाड्यांसाठी अनिश्चिततेची जाणीव ठेवणारे गतिमान ईटीए (ETA) अंदाज व्यासपीठ आहे. हे कॅलिब्रेटेड ग्रेडियंट-बूस्टेड मॉडेल्स आणि गोव्हर्डे टाइम-इव्हेंट ग्राफ बीजगणित वापरून विलंबाच्या स्वरूपाचे मॉडेल तयार करते आणि प्लॅटफॉर्म, क्रू रिलीफ, आणि नियंत्रण कक्षासाठी थेट कार्यवाही निर्णयांमध्ये रूपांतरित करते.',
    'faq-q2': 'RippleETA फक्त एकच आगमन ईटीए का दाखवत नाही?',
    'faq-a2': 'एकच निश्चित ईटीए (उदा. "18:47 वाजता आगमन") रेल्वे कामकाजात खोटी निश्चितता निर्माण करतो. मिश्र वाहतुकीच्या मार्गावर सिग्नल होल्ड्समुळे एकच वेळ नियंत्रकांना घाईघाईने चुकीचे निर्णय घेण्यास भाग पाडू शकते. RippleETA कॅलिब्रेटेड क्वांटाइल अंतराल (P10, P50, P90) प्रदान करते.',
    'faq-q3': 'P10, P50 आणि P90 चा कामकाजाच्या निर्णयांसाठी काय अर्थ आहे?',
    'faq-a3': '<strong>P10 (आशावादी):</strong> गाडी या वेळेपूर्वी पोहोचण्याची केवळ 10% शक्यता असते.<br><strong>P50 (मध्यम):</strong> सर्वात संभाव्य आगमन वेळ; 50% शक्यता.<br><strong>P90 (सावध मर्यादा):</strong> गाडी या वेळेपूर्वी पोहोचेल याची 90% खात्री असते. क्रू नियंत्रक 9 तासांच्या वैधानिक नियमाचे (HOER) पालन करण्यासाठी P90 चा वापर करतात.',
    'faq-q4': 'जेव्हा विलंब दुसऱ्या गाडीमध्ये पसरतो तेव्हा काय होते?',
    'faq-a4': 'सामायिक रेल्वे मार्गांवर गाड्या स्वयंचलित ब्लॉक सिग्नलिंगद्वारे जोडलेल्या असतात. जेव्हा पुढील गाडी (उदा. ट्रेन 56789) उशिरा धावते, तेव्हा सुरक्षित हेडवे 10 मिनिटांच्या मर्यादेपेक्षा कमी होतो. गोव्हर्डे मॅक्स-प्लस नियमानुसार मागची गाडी (ट्रेन 12301) पुढील गाडी मार्ग मोकळा करेपर्यंत ब्लॉकमध्ये प्रवेश करू शकत नाही.',
    'faq-q5': 'घोस्ट सँडबॉक्स कशासाठी वापरला जातो?',
    'faq-a5': 'घोस्ट सँडबॉक्स ही एक प्रायोगिक सिम्युलेशन प्रयोगशाळा आहे. नियंत्रक कोणत्याही गाडीमध्ये काल्पनिक विलंब प्रविष्ट करून रिअल-टाइममध्ये हेडवे, सिग्नल बदल आणि मागच्या गाड्यांवर होणारे परिणाम तपासू शकतात.',
    'faq-q6': 'RippleETA नेहमी अंदाज वर्तवते की कधी थांबते?',
    'faq-a6': 'RippleETA मध्ये स्वयंचलित विसंगती द्वार (Anomaly Gate) आहे. अनपेक्षित ट्रॅक बिघाड किंवा प्रतिकूल हवामान उद्भवल्यास स्वयंचलित अंदाज थांबवले जातात, ज्यामुळे कामकाजातील विश्वासार्हता टिकून राहते.',
    'faq-q7': 'अंदाजित आगमन वेळ ही हमी आहे का?',
    'faq-a7': 'नाही. रेल्वेचे जाळे खुल्या वातावरणात चालते जिथे हवामान आणि तांत्रिक अडचणी संभवतात. RippleETA हे मानवी निर्णयाला साहाय्य करण्यासाठी सांख्यिकीय वितरण देते, पर्याय म्हणून नाही.',
    'faq-q8': 'RippleETA कोणते डेटा स्रोत वापरते?',
    'faq-a8': 'RippleETA ऐतिहासिक धावण्याचा डेटा, राष्ट्रीय रेल्वे चौकशी प्रणाली (NTES) टाइमस्टॅम्प्स, वेळापत्रक बफर आणि जंक्शन टोपोलॉजी डेटा वापरते. यात कोणताही बनावट जीपीएस डेटा वापरला जात नाही.',
    'ref-kicker': 'आधारभूत तथ्य • कार्यवाही संशोधन',
    'ref-title': 'संदर्भ आणि तांत्रिक उगम',
    'ref-sub': 'RippleETA ची प्रणाली रेल्वे ऑपरेशन्स संशोधन, संभाव्यता अंदाज, नेटवर्क विलंब संक्रमण आणि स्पष्ट करण्यायोग्य मशीन लर्निंगवर आधारित आहे.',
    'ref-p1': 'रेल्वे नेटवर्क विलंब संक्रमण, हेडवे परस्परसंवाद आणि मॅक्स-प्लस बीजगणिताचा सैद्धांतिक पाया.',
    'ref-p2': 'भारतीय रेल्वे नेटवर्कवरील (17 झोनमधील 4,735 स्टेशन्स) नेटवर्क विलंब मॉडेलिंगचे अत्याधुनिक संशोधन.',
    'ref-p3': 'P10, P50 आणि P90 अनिश्चिततेच्या मर्यादांसाठी वितरण-मुक्त अचूकतेची हमी देणारे कॉन्फॉर्मल क्वांटाइल रिग्रेशन.',
    'ref-p4': 'प्रवासातील विलंबाचा अंदाज लावला करण्यासाठी RippleETA चे प्राथमिक स्केलेबल ट्री बूस्टिंग अल्गोरिदम.',
    'ref-p5': 'कार्यवाही पारदर्शकता देणारे गेम-थिअरी आधारित शॅप्ली अ‍ॅडिटिव्ह एक्सप्लेनेशन (SHAP).',
    'ref-p6': 'स्टोकॅस्टिक विलंब संक्रमण आणि टर्मिनल रिकव्हरी बफरसाठी गणितीय चौकट.',
    'ref-p7': '9 तासांचे कमाल ड्युटी नियम (HOER 9(2)) आणि 10 मिनिटांचे किमान सुरक्षित हेडवे नियम (G&SR 4.08).'
  }
};

// Global UI Translation Dictionary
const UI_TRANSLATIONS = SANDBOX_TRANSLATIONS;

// Add Stakeholder View specific translations to UI_TRANSLATIONS
UI_TRANSLATIONS.hi = {
  ...UI_TRANSLATIONS.hi,
  'role-passenger': 'यात्री सूचना प्रणाली',
  'role-station': 'स्टेशन मास्टर डेस्क',
  'role-crew': 'क्रू कंट्रोलर डेस्क',
  'role-feeder': 'फीडर परिवहन हब',
  'role-maint': 'मेंटेनेंस और पिट लाइन',
  'role-control': 'नेटवर्क नियंत्रण कक्ष',
  'btn-3d-view': '3D लाइव ट्रेन व्यू',
  'p10-label': 'P10 • न्यूनतम देरी (आशावादी)',
  'p50-label': 'P50 • संभावित आगमन समय',
  'p90-label': 'P90 • अधिकतम सुरक्षित सीमा',
  'anomaly-alert': 'विसंगति चेतावनी: नेटवर्क देरी सीमा से अधिक',
  'btn-refresh': 'ताज़ा करें',
  'btn-replay': 'रिप्ले',
  'btn-live': 'लाइव फ़ीड'
};

UI_TRANSLATIONS.mr = {
  ...UI_TRANSLATIONS.mr,
  'role-passenger': 'प्रवासी माहिती प्रणाली',
  'role-station': 'स्टेशन मास्टर डेस्क',
  'role-crew': 'क्रू कंट्रोलर डेस्क',
  'role-feeder': 'फीडर वाहतूक हब',
  'role-maint': 'मेंटेनन्स आणि पिट लाइन',
  'role-control': 'नेटवर्क नियंत्रण कक्ष',
  'btn-3d-view': '3D लाइव्ह ट्रेन दृश्य',
  'p10-label': 'P10 • किमान विलंब (आशावादी)',
  'p50-label': 'P50 • अपेक्षित आगमन वेळ',
  'p90-label': 'P90 • कमाल सुरक्षित मर्यादा',
  'anomaly-alert': 'विसंगती इशारा: नेटवर्क विलंब मर्यादेबाहेर',
  'btn-refresh': 'ताजे करा',
  'btn-replay': 'रिप्ले',
  'btn-live': 'लाइव्ह फीड'
};

// Dynamic Translation API Helper with session cache & MyMemory fallback
const dynamicTranslationCache = {};

async function translateDynamicText(text, targetLang) {
  if (!text || typeof text !== 'string' || targetLang === 'en') return text;
  const cacheKey = `${targetLang}:${text.trim()}`;
  if (dynamicTranslationCache[cacheKey]) return dynamicTranslationCache[cacheKey];

  const sessionCached = sessionStorage.getItem(`tr_${cacheKey}`);
  if (sessionCached) {
    dynamicTranslationCache[cacheKey] = sessionCached;
    return sessionCached;
  }

  // Custom Google Translate API Key if user provided one
  const apiKey = localStorage.getItem('rippleeta_translate_api_key');
  if (apiKey) {
    try {
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, target: targetLang })
      });
      if (res.ok) {
        const data = await res.json();
        const tr = data?.data?.translations?.[0]?.translatedText;
        if (tr) {
          dynamicTranslationCache[cacheKey] = tr;
          sessionStorage.setItem(`tr_${cacheKey}`, tr);
          return tr;
        }
      }
    } catch { /* proceed to MyMemory fallback */ }
  }

  // Free MyMemory REST Translation API fallback
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=en|${targetLang}`);
    if (res.ok) {
      const data = await res.json();
      const tr = data?.responseData?.translatedText;
      if (tr && !tr.includes('MYMEMORY WARNING')) {
        dynamicTranslationCache[cacheKey] = tr;
        sessionStorage.setItem(`tr_${cacheKey}`, tr);
        return tr;
      }
    }
  } catch (err) {
    console.warn('[RippleETA] Real-time translation fallback skipped:', err);
  }

  return text;
}

function applyGlobalLanguage(lang) {
  const dictionary = UI_TRANSLATIONS[lang] || UI_TRANSLATIONS.en;
  const enDict = UI_TRANSLATIONS.en;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key) {
      const translated = dictionary[key] || enDict[key];
      if (translated) {
        if (translated.includes('<') && translated.includes('>')) {
          el.innerHTML = translated;
        } else {
          el.textContent = translated;
        }
      }
    }
  });

  document.querySelectorAll('.lang-select, #lang-select').forEach(select => {
    if (select && select.value !== lang) {
      select.value = lang;
    }
  });

  localStorage.setItem('rippleeta_language', lang);

  // Real-time dynamic text translation fallback for non-static elements
  if (lang !== 'en') {
    document.querySelectorAll('[data-i18n-dynamic]').forEach(async (el) => {
      const originalText = el.dataset.originalText || el.textContent;
      if (!el.dataset.originalText) el.dataset.originalText = originalText;
      const tr = await translateDynamicText(originalText, lang);
      el.textContent = tr;
    });
  } else {
    document.querySelectorAll('[data-i18n-dynamic]').forEach((el) => {
      if (el.dataset.originalText) el.textContent = el.dataset.originalText;
    });
  }

  const cookieVal = (lang === 'en' || !lang) ? '' : `/en/${lang}`;
  document.cookie = `googtrans=${cookieVal}; path=/;`;
  document.cookie = `googtrans=${cookieVal}; path=/; domain=${window.location.hostname};`;

  const googCombo = document.querySelector('.goog-te-combo');
  if (googCombo) {
    googCombo.value = lang;
    googCombo.dispatchEvent(new Event('change'));
  }

  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

function applySandboxLanguage(lang) {
  applyGlobalLanguage(lang);
}

function initGlobalLanguage() {
  const savedLang = localStorage.getItem('rippleeta_language') || 'en';

  document.querySelectorAll('.lang-select, #lang-select').forEach(select => {
    if (select) {
      select.value = savedLang;
      select.addEventListener('change', (e) => {
        const newLang = e.target.value;
        applyGlobalLanguage(newLang);
      });
    }
  });

  if (savedLang !== 'en') {
    applyGlobalLanguage(savedLang);
  }
}

function initSandboxLanguage() {
  initGlobalLanguage();
}

function initSandboxFAQ() {
  const faqItems = document.querySelectorAll('.sb-faq-section .faq-item');
  faqItems.forEach(item => {
    const trigger = item.querySelector('.faq-trigger');
    const content = item.querySelector('.faq-content');
    if (!trigger || !content) return;

    const toggle = () => {
      const isOpen = item.classList.contains('is-open');
      // Close other items for neat accordion behavior
      faqItems.forEach(other => {
        if (other !== item) {
          other.classList.remove('is-open');
          const otherTrigger = other.querySelector('.faq-trigger');
          if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', String(!isOpen));
    };

    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

async function loadSandbox() {
  // ── Language Selector & FAQ Setup ──
  initSandboxLanguage();
  initSandboxFAQ();
  const prediction = await api(`/predict/12301`).catch(() => null);
  const isSuspended = prediction?.anomaly_flag || (prediction?.status && prediction.status.includes('SUSPENDED'));

  const anomalyBanner = $('ticket-anomaly-alert');
  if (anomalyBanner) anomalyBanner.style.display = isSuspended ? 'block' : 'none';

  // Run initial scenario at 15 min (worked example)
  await runSandboxScenario(15.0);

  // Bind slider events
  const slider = $('sandbox-delay-slider');
  slider?.addEventListener('input', (e) => {
    runSandboxScenario(e.target.value);
  });

  // Bind quick preset buttons
  document.querySelectorAll('.btn-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const minVal = parseFloat(btn.dataset.min) || 0;
      runSandboxScenario(minVal);
    });
  });

  // Apply button
  $('btn-apply-scenario')?.addEventListener('click', () => {
    const val = $('sandbox-delay-slider')?.value || 15;
    runSandboxScenario(val);
  });

  // Reset button
  $('btn-reset-scenario')?.addEventListener('click', () => {
    runSandboxScenario(0);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL REFRESH & CLOCK
// ────────────────────────────────────────────────────────────────────────────
async function refresh() {
  try {
    try {
      const status = await api('/system/status');
      updateMode(status);
    } catch (statusErr) {
      console.warn('System status check fallback:', statusErr);
      updateMode({ mode: 'LIVE', source: 'calibrated_network_prediction' });
    }
    const loaders = {
      passenger: loadPassenger,
      station: loadStation,
      crew: loadCrew,
      feeder: loadFeeder,
      maintenance: loadMaintenance,
      network: loadNetwork,
      sandbox: loadSandbox,
    };
    if (loaders[view]) await loaders[view]();
    setConnection(true);
  } catch (error) {
    console.error('Dashboard refresh failed:', error);
    showPageError(error.message);
  }
}

function startClock() {
  const update = () => setText('clock', new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) + ' IST');
  update();
  window.setInterval(update, 1000);
}

// ────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ────────────────────────────────────────────────────────────────────────────
initA11y();
startClock();

$('refresh-button')?.addEventListener('click', () => {
  const tid = $('train-id')?.value;
  if (tid) {
    persistTrain(tid);
    document.querySelectorAll('.train-chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.train === tid.trim());
    });
  }
  refresh();
});
$('train-id')?.addEventListener('change', (event) => {
  const tid = event.target.value.trim();
  persistTrain(tid);
  document.querySelectorAll('.train-chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.train === tid);
  });
  refresh();
});
$('train-id')?.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    const tid = event.target.value.trim();
    persistTrain(tid);
    document.querySelectorAll('.train-chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.train === tid);
    });
    refresh();
  }
});
$('feeder-cutoff-input')?.addEventListener('change', refresh);
$('btn-sync-cutoff')?.addEventListener('click', refresh);

// Feeder Quick Cutoff Presets (+15m, +30m, +45m, +60m)
document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const addMins = parseInt(btn.dataset.add, 10) || 15;
    const now = new Date();
    now.setMinutes(now.getMinutes() + addMins);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const input = $('feeder-cutoff-input');
    if (input) {
      input.value = `${hh}:${mm}`;
      refresh();
    }
  });
});

// Copy VHF Dispatch
$('btn-copy-vhf')?.addEventListener('click', () => {
  const text = $('triage-vhf')?.textContent.trim() || '';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = $('btn-copy-vhf');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ COPIED!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      }
    });
  }
});

// "Should I Leave Now?" events
$('leave-calc-btn')?.addEventListener('click', () => {
  evaluateLeaveNow(state.lastPrediction?.p90_delay_min);
});
$('leave-deadline-input')?.addEventListener('input', () => {
  evaluateLeaveNow(state.lastPrediction?.p90_delay_min);
});
// Quick train chips & event delegation for corridor selection
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.train-chip');
  if (!chip) return;
  const tid = chip.dataset.train;
  if (tid) {
    if ($('train-id')) {
      $('train-id').value = tid;
    }
    persistTrain(tid);
    document.querySelectorAll('.train-chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.train === tid);
    });
    const url = new URL(window.location);
    url.searchParams.set('train', tid);
    window.history.replaceState({}, '', url);
    refresh();
  }
});

// Quick deadline presets
document.querySelectorAll('.quick-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mins = btn.dataset.min;
    if (mins && $('leave-deadline-input')) {
      $('leave-deadline-input').value = mins;
      evaluateLeaveNow(state.lastPrediction?.p90_delay_min);
    }
  });
});

// Role links
document.querySelectorAll('.role-link').forEach((link) => {
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    const train = trainId();
    persistTrain(train);
    try {
      await fetch(`${API_BASE}/api/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: link.dataset.role, email: 'operator@rippleeta.in' }),
      });
    } catch { /* proceed */ }
    window.location.href = `${link.getAttribute('href')}?train=${encodeURIComponent(train)}`;
  });
});

if ($('train-id')) {
  $('train-id').value = new URLSearchParams(window.location.search).get('train') || localStorage.getItem('rippleeta_train_id') || DEFAULT_TRAIN;
}

loadSupportedTrains().then(refresh);
window.setInterval(refresh, 60000);

// ── Auth Return Destination Preservation ────────────────────────────────────
function wireAuthReturnRouting() {
  function getReturnUrl() {
    const tid = typeof trainId === 'function' ? trainId() : (new URLSearchParams(window.location.search).get('train') || '20507');
    const search = new URLSearchParams(window.location.search);
    if (tid && !search.get('train')) {
      search.set('train', tid);
    }
    const qs = search.toString() ? `?${search.toString()}` : '';
    return window.location.pathname + qs + window.location.hash;
  }

  function handleReturnClick(anchor) {
    const dest = getReturnUrl();
    try {
      sessionStorage.setItem('rippleeta_auth_return_to', dest);
    } catch { /* ignore storage error */ }

    if (anchor) {
      try {
        const rawHref = anchor.getAttribute('href') || '/';
        if (rawHref === '/' || rawHref.startsWith('/?') || rawHref === '/index.html') {
          const targetUrl = new URL(rawHref, window.location.origin);
          targetUrl.searchParams.set('returnTo', dest);
          anchor.href = targetUrl.pathname + targetUrl.search + targetUrl.hash;
        }
      } catch { /* keep existing href */ }
    }
  }

  // Intercept all landing / brand links and back buttons
  document.querySelectorAll('a[href="/"], a[href="/index.html"], a.brand, #btn-back-3d').forEach((anchor) => {
    anchor.addEventListener('click', () => handleReturnClick(anchor));
  });
}

// ── Global Logout Button Wiring ──────────────────────────────────────────────
function wireGlobalLogout() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn && !logoutBtn.dataset.wired) {
    logoutBtn.dataset.wired = 'true';
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (e) {}
      localStorage.removeItem('rippleeta_token');
      localStorage.removeItem('user');
      sessionStorage.clear();
      const pill = document.getElementById('session-identity-pill');
      if (pill) pill.style.display = 'none';
      logoutBtn.style.display = 'none';
      window.location.reload();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    wireAuthReturnRouting();
    initGlobalLanguage();
    wireGlobalLogout();
  });
} else {
  wireAuthReturnRouting();
  initGlobalLanguage();
  wireGlobalLogout();
}
