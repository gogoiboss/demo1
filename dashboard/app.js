const API_BASE = (window.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const DEMO_TRAIN = '20507';
const state = { trainId: DEMO_TRAIN, prediction: null, passenger: null, station: null, graphDemo: null, tracing: false, online: false };

const $ = (selector) => document.querySelector(selector);
const formatMinutes = (value) => value == null ? '--' : `${Number(value).toFixed(1)} min`;
const formatClock = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';

function setConnection(online) {
  state.online = online;
  $('#connection-dot').classList.toggle('is-online', online);
  $('#connection-label').textContent = online ? 'API ONLINE' : 'DEMO DATA / API OFFLINE';
}

function showNotice(message = '') { $('#notice').textContent = message; }

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error((await response.json()).detail || `API ${response.status}`);
  return response.json();
}

async function loadData() {
  state.trainId = $('#train-id').value.trim() || DEMO_TRAIN;
  showNotice('Refreshing calibrated signal...');
  try {
    const [prediction, passenger, station, graphDemo] = await Promise.all([
      apiGet(`/predict/${encodeURIComponent(state.trainId)}`),
      apiGet(`/predict/${encodeURIComponent(state.trainId)}/passenger`),
      apiGet(`/predict/${encodeURIComponent(state.trainId)}/station-master`),
      apiGet('/graph/demo'),
    ]);
    state.prediction = prediction;
    state.passenger = passenger;
    state.station = station;
    state.graphDemo = graphDemo;
    setConnection(true);
    showNotice('');
  } catch (error) {
    state.prediction = { train_id: state.trainId, status: 'API UNAVAILABLE', p10_delay_min: null, p50_delay_min: null, p90_delay_min: null, anomaly_flag: false, uncertainty_mode: false, conflict_adjustment_min: 0, message: 'Live API unavailable.' };
    state.passenger = { train_id: state.trainId, status: 'API UNAVAILABLE', delay_min: null, trend: 'unknown', next_update_at: null, message: 'Start the API to load a real prediction.' };
    state.graphDemo = { status: 'API UNAVAILABLE', section: '--', delaying_train: '--', affected_train: '--', source_delay_min: null, base_delay_min: null, conflict_addition_min: null, final_delay_min: null, message: 'Start the API to load the graph result.' };
    state.station = { train_id: state.trainId, status: 'API UNAVAILABLE', platform_commit: 'SUSPENDED', time_until_decision_needed_min: null, p10_delay_min: null, p90_delay_min: null, message: 'Live API unavailable.' };
    setConnection(false);
    showNotice(`API unavailable: ${error.message}. Showing realistic demo data.`);
  }
  renderAll();
}

function renderPassenger() {
  const p = state.prediction;
  const passenger = state.passenger;
  $('#passenger-train').textContent = `TRAIN ${state.trainId}`;
  $('#passenger-delay').innerHTML = `${passenger.delay_min == null ? '--' : Number(passenger.delay_min).toFixed(0)}<span>min late</span>`;
  $('#passenger-message').textContent = passenger.message;
  $('#passenger-window').textContent = `${formatMinutes(p.p10_delay_min)} to ${formatMinutes(p.p90_delay_min)}`;
  $('#range-p10').textContent = `P10 ${formatMinutes(p.p10_delay_min)}`;
  $('#range-p50-label').textContent = `P50 ${formatMinutes(p.p50_delay_min)}`;
  $('#range-p90').textContent = `P90 ${formatMinutes(p.p90_delay_min)}`;
  const width = p.p10_delay_min != null && p.p90_delay_min != null ? Math.max(1, p.p90_delay_min - p.p10_delay_min) : 1;
  const marker = p.p10_delay_min != null && p.p50_delay_min != null ? Math.max(4, Math.min(96, ((p.p50_delay_min - p.p10_delay_min) / width) * 100)) : 50;
  $('#range-p50').style.left = `${marker}%`;
  $('#passenger-trend').textContent = (passenger.trend || 'unknown').toUpperCase();
  $('#passenger-next-update').textContent = formatClock(passenger.next_update_at);
  $('#passenger-updated').textContent = `UPDATED ${formatClock(new Date().toISOString())}`;
  $('#passenger-conflict').textContent = p.conflict_adjustment_min > 0 ? `Conflict edge adds +${p.conflict_adjustment_min.toFixed(1)} min` : 'No active conflict traced';
}

function renderStation() {
  const p = state.prediction;
  const station = state.station;
  $('#station-decision').textContent = station.platform_commit;
  $('#station-decision').style.color = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
  $('#station-message').textContent = station.message;
  $('#station-deadline').textContent = station.time_until_decision_needed_min == null ? '--' : `${station.time_until_decision_needed_min.toFixed(1)} min`;
  $('#station-p10').textContent = p.p10_delay_min == null ? '--' : p.p10_delay_min.toFixed(1);
  $('#station-p90').textContent = p.p90_delay_min == null ? '--' : p.p90_delay_min.toFixed(1);
  $('#station-width').textContent = p.p10_delay_min == null ? '--' : `${(p.p90_delay_min - p.p10_delay_min).toFixed(1)} min`;
  $('#station-conflict').textContent = p.conflict_adjustment_min > 0 ? `+${p.conflict_adjustment_min.toFixed(1)} min / AMBER` : 'None / CLEAR';
  $('#station-state').textContent = p.status;
}

function renderNetwork() {
  const p = state.prediction;
  const graph = state.graphDemo;
  const hasGraph = graph && graph.base_delay_min != null;
  $('#network-before').textContent = hasGraph ? `${graph.affected_train} · +${graph.base_delay_min.toFixed(1)} min base delay` : 'Live graph unavailable';
  $('#network-after').textContent = hasGraph && state.tracing ? `${graph.affected_train} · +${graph.final_delay_min.toFixed(1)} min propagated` : hasGraph ? `${graph.affected_train} · awaiting trace` : 'Start API to load graph';
  $('#network-state').textContent = state.tracing ? 'CONFLICT TRACED' : 'MONITORING';
  $('#network-canvas').classList.toggle('is-tracing', state.tracing);
  $('#trace-conflict').textContent = state.tracing ? 'Clear trace' : 'Trace conflict';
  $('#conflict-path span').textContent = hasGraph ? `+${graph.conflict_addition_min.toFixed(0)} MIN PROPAGATED` : 'GRAPH UNAVAILABLE';
  $('#passenger-conflict').textContent = state.tracing && hasGraph ? `Replay trace: +${graph.conflict_addition_min.toFixed(1)} min propagated` : (p.conflict_adjustment_min > 0 ? `Conflict edge adds +${p.conflict_adjustment_min.toFixed(1)} min` : 'No active conflict traced');
}

function renderAll() { renderPassenger(); renderStation(); renderNetwork(); }
function setView(view) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view));
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.toggle('is-hidden', panel.dataset.panel !== view));
}

function startClock() {
  const tick = () => { $('#clock').textContent = `${new Date().toLocaleTimeString([], { hour12: false })} IST`; };
  tick();
  setInterval(tick, 1000);
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
$('#refresh-button').addEventListener('click', loadData);
$('#train-id').addEventListener('change', loadData);
$('#trace-conflict').addEventListener('click', () => { state.tracing = !state.tracing; renderNetwork(); });
$('#trace-passenger').addEventListener('click', () => { state.tracing = true; setView('network'); renderNetwork(); });
startClock();
loadData();
