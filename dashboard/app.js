/* Shared controller for the stakeholder pages. */
const API_BASE = window.location.port === '8000' ? '' : 'http://127.0.0.1:8000';
const view = document.body.dataset.view;
const $ = (id) => document.getElementById(id);
const DEFAULT_TRAIN = '20507';
const state = { trainId: '', mode: 'REPLAY', source: '', supportedTrains: [] };

function setText(id, value) { const el = $(id); if (el) el.textContent = value; }

function setConnection(online, detail = '') {
  $('connection-dot')?.classList.toggle('is-online', online);
  setText('connection-label', online ? 'API ONLINE' : (detail || 'API UNAVAILABLE'));
}

async function api(path) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    let detail = `API ${response.status}`;
    try { detail = (await response.json()).detail || detail; } catch { /* keep status */ }
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
    ? `TRAIN NOT IN SNAPSHOT — choose one of ${state.supportedTrains.length ? state.supportedTrains.join(', ') : 'the supported IDs on the launcher'}.`
    : `REPLAY DATA UNAVAILABLE — ${message}`;
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

async function loadPassenger() {
  const id = encodeURIComponent(trainId());
  const [prediction, passenger] = await Promise.all([api(`/predict/${id}`), api(`/predict/${id}/passenger`)]);
  setText('ticket-train', `TRAIN ${prediction.train_id}`);
  setText('ticket-date', new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase());
  setText('ticket-window', formatWindow(prediction));
  setText('ticket-p50', prediction.p50_delay_min == null ? '--' : `${Math.round(prediction.p50_delay_min)} min`);
  setText('ticket-provenance', `${prediction.provenance?.data_source || 'historical snapshot'} · ${prediction.status}`);
  const timeline = $('pax-historical-timeline');
  if (timeline) {
    const stations = passenger.historical_stations || [];
    timeline.innerHTML = stations.length ? stations.map((station) => `<li class="timeline-item ${station.status === 'en_route' ? 'is-current' : ''}"><div class="timeline-dot"></div><div class="timeline-content"><p class="timeline-station">${station.station_code} — ${station.station_name}</p><p class="timeline-delay">${station.delay_min > 0 ? '+' : ''}${Math.round(station.delay_min)} min · ${station.status}</p></div></li>`).join('') : '<li class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><p class="timeline-station">Journey history unavailable</p><p class="timeline-delay">No station events are present in the current snapshot.</p></div></li>';
  }
}

async function loadStation() {
  const id = encodeURIComponent(trainId());
  const [prediction, station] = await Promise.all([api(`/predict/${id}`), api(`/predict/${id}/station-master`)]);
  const suspended = prediction.anomaly_flag || prediction.status.includes('SUSPENDED');
  setText('triage-decision', suspended ? 'SUSPENDED' : station.platform_commit);
  setText('triage-train', prediction.train_id);
  setText('triage-p50', prediction.p50_delay_min == null ? '--' : `${prediction.p50_delay_min.toFixed(1)} min`);
  setText('triage-p10', prediction.p10_delay_min == null ? '--' : prediction.p10_delay_min.toFixed(1));
  setText('triage-p90', prediction.p90_delay_min == null ? '--' : prediction.p90_delay_min.toFixed(1));
  setText('triage-deadline', station.time_until_decision_needed_min == null ? '--' : `${station.time_until_decision_needed_min.toFixed(1)} min`);
  setText('triage-msg', station.message);
  setText('triage-vhf', station.radio_summary || 'AWAITING RADIO SUMMARY');
  const incoming = $('incoming-sequence');
  if (incoming) incoming.innerHTML = `<div class="incoming-train"><p class="inc-train-id">TRAIN ${prediction.train_id}</p><p>P10 / P50 / P90: ${formatWindow(prediction)} / ${prediction.p50_delay_min?.toFixed(1) || '--'} min</p><p>${station.platform_commit} · ${station.urgency_rank.toUpperCase()}</p></div>`;
}

async function loadCrew() {
  const result = await api(`/predict/${encodeURIComponent(trainId())}/crew-controller`);
  setText('hoer-train-label', `Train ${result.train_id} · predicted delay ${result.predicted_delay_min == null ? '--' : result.predicted_delay_min.toFixed(1)} min`);
  setText('hoer-status', result.message);
  const track = $('hoer-track');
  if (track) {
    const deadline = result.relief_dispatch_deadline ? new Date(result.relief_dispatch_deadline).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'MANUAL REVIEW';
    track.innerHTML = `<div class="hoer-marker" style="left:50%">Relief deadline: ${deadline}</div>`;
  }
}

async function loadFeeder() {
  const result = await api(`/predict/${encodeURIComponent(trainId())}/feeder-transport?cutoff_time=${encodeURIComponent(feederCutoff())}`);
  const probability = result.probability_arrival_before_cutoff;
  setText('feeder-prob', probability == null ? '--%' : `${Math.round(probability * 100)}%`);
  setText('feeder-train-lbl', `Train ${result.train_id}: ${result.message}`);
  setText('feeder-decision', result.recommendation);
  setText('cost-wait', result.recommendation === 'WAIT' ? 'Recommended' : 'Not recommended');
  setText('cost-abandon', result.recommendation === 'DEPART' ? 'Recommended' : 'Not recommended');
}

async function loadMaintenance() {
  const result = await api(`/predict/${encodeURIComponent(trainId())}/maintenance`);
  const minutes = result.available_turnaround_min;
  setText('maint-train-lbl', `Train ${result.train_id} · ${result.message}`);
  setText('maint-val', minutes == null ? '-- min' : `${Math.round(minutes)} min`);
  setText('maint-status', result.maintenance_window_adequate === null ? 'SUSPENDED' : result.maintenance_window_adequate ? 'ADEQUATE WINDOW' : 'COMPRESSED WINDOW');
  if ($('maint-fill') && minutes != null) $('maint-fill').style.width = `${Math.max(0, Math.min(100, minutes / 3.6))}%`;
}

async function loadNetwork() {
  const [graph, stats] = await Promise.all([api('/graph/demo'), api('/api/stats')]);
  setText('prediction-count', Number(stats.total_predictions_served || 0).toLocaleString());
  setText('radar-status', `Replay scenario: Train ${graph.delaying_train} adds ${graph.conflict_addition_min.toFixed(1)} min to Train ${graph.affected_train} near ${graph.section}.`);
  setText('radar-source', graph.message);
  if ($('radar-conflict-node')) $('radar-conflict-node').innerHTML = `${graph.affected_train}<br>+${graph.conflict_addition_min.toFixed(1)} min`;
  $('radar-pulse')?.classList.add('is-tracing');
}

async function refresh() {
  try {
    const status = await api('/system/status');
    updateMode(status);
    const loaders = { passenger: loadPassenger, station: loadStation, crew: loadCrew, feeder: loadFeeder, maintenance: loadMaintenance, network: loadNetwork };
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

$('refresh-button')?.addEventListener('click', refresh);
$('train-id')?.addEventListener('change', (event) => { persistTrain(event.target.value); refresh(); });
$('feeder-cutoff-input')?.addEventListener('change', refresh);
document.querySelectorAll('.role-link').forEach((link) => {
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    const train = trainId();
    persistTrain(train);
    await fetch(`${API_BASE}/api/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: link.dataset.role, email: 'operator@rippleeta.in' }),
    });
    window.location.href = `${link.getAttribute('href')}?train=${encodeURIComponent(train)}`;
  });
});
if ($('train-id')) {
  $('train-id').value = new URLSearchParams(window.location.search).get('train') || localStorage.getItem('rippleeta_train_id') || DEFAULT_TRAIN;
}
startClock();
loadSupportedTrains().then(refresh);
window.setInterval(refresh, 60000);
