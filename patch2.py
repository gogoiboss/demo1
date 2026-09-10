import re

with open('dashboard/app.js', 'r', encoding='utf-8') as f:
    code = f.read()

new_station = '''function renderStation() {
  const p = state.prediction;
  const station = state.station;
  if (!p || !station) return;

  const isSuspended = p.anomaly_flag || p.status.includes('SUSPENDED');
  
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
    $('#station-p90').textContent = '--';
    $('#station-width').textContent = '--';
  } else {
    decisionEl.textContent = station.platform_commit;
    decisionEl.style.color = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
    if (card) card.style.borderColor = station.platform_commit === 'COMMIT' ? 'var(--teal)' : 'var(--amber)';
    msgEl.textContent = station.message;
    
    $('#station-p10').textContent = p.p10_delay_min == null ? '--' : p.p10_delay_min.toFixed(1);
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
}'''

code = re.sub(r'function renderStation\(\) \{.*?\n\}\n', new_station + '\n', code, flags=re.DOTALL)

with open('dashboard/app.js', 'w', encoding='utf-8') as f:
    f.write(code)
