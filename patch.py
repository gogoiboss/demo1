import re

with open('dashboard/app.js', 'r', encoding='utf-8') as f:
    code = f.read()

new_passenger = '''function renderPassenger() {
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
}'''

new_station = '''function renderStation() {
  const p = state.prediction;
  const station = state.station;
  if (!p || !station) return;

  const isSuspended = p.anomaly_flag || p.status.includes('SUSPENDED');
  
  const card = document.querySelector('#station-view .decision-card');
  const decisionEl = $('#station-decision');
  const msgEl = $('#station-message');
  
  // Feature 2: Anomaly gate honesty for Station Master
  if (isSuspended) {
    decisionEl.textContent = 'SUSPENDED';
    decisionEl.style.color = 'var(--red)';
    card.style.borderColor = 'var(--red)';
    msgEl.textContent = "Unusual conditions detected — prediction suspended. Use manual control charts.";
    
    $('#station-p10').textContent = '--';
    $('#station-p90').textContent = '--';
    $('#station-width').textContent = '--';
  } else {
    decisionEl.textContent = station.platform_commit;
    decisionEl.style.color = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
    card.style.borderColor = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
    msgEl.textContent = station.message;
    
    $('#station-p10').textContent = p.p10_delay_min == null ? '--' : p.p10_delay_min.toFixed(1);
    $('#station-p90').textContent = p.p90_delay_min == null ? '--' : p.p90_delay_min.toFixed(1);
    $('#station-width').textContent = p.p10_delay_min == null ? '--' : `${(p.p90_delay_min - p.p10_delay_min).toFixed(1)} min`;
  }
  
  $('#station-deadline').textContent = station.time_until_decision_needed_min == null ? '--' : `${station.time_until_decision_needed_min.toFixed(1)} min`;
  $('#station-state').textContent = p.status;

  // Feature 3: Station master platform/section conflict forecast
  // We use track section conflicts (graph_status / conflict_adjustment) because platform data doesn't exist.
  const conflictEl = $('#station-conflict');
  if (p.conflict_adjustment_min > 0 && state.graphDemo) {
      conflictEl.innerHTML = `<span style="color:var(--amber)">Active Section Conflict:</span> Train ${state.graphDemo.delaying_train} on ${state.graphDemo.section} (+${p.conflict_adjustment_min.toFixed(1)}m)`;
  } else {
      conflictEl.textContent = p.conflict_adjustment_min > 0 ? `+${p.conflict_adjustment_min.toFixed(1)} min / AMBER` : 'None / CLEAR';
  }
}'''

# Replace renderPassenger
code = re.sub(r'function renderPassenger\(\) \{.*?\n\}\n', new_passenger + '\n', code, flags=re.DOTALL)
# Replace renderStation
code = re.sub(r'function renderStation\(\) \{.*?\n\}\n', new_station + '\n', code, flags=re.DOTALL)

with open('dashboard/app.js', 'w', encoding='utf-8') as f:
    f.write(code)
