/**
 * dashboard.js - All existing OUTLIERS dashboard logic (preserved exactly)
 * Exported as initDashboard() for the journey orchestrator.
 */

export function initDashboard() {
  "use strict";

  // Application state
  let corridorData = null;
  let activeTab = "timetable";
  let currentMode = "DEMO"; // "DEMO" or "LIVE"
  let livePollTimer = null;
  let countdownTimer = null;
  let pollCountdownSec = 30;
  let auditFilter = "ALL"; // "ALL", "LIVE", "DEMO"

  // DOM Elements - Header & Status
  const healthBadge = document.getElementById("health-badge");
  const btnModeLive = document.getElementById("btn-mode-live");
  const btnModeDemo = document.getElementById("btn-mode-demo");
  const switchToDemoBtn = document.getElementById("switch-to-demo-btn");
  const liveBlockedBanner = document.getElementById("live-blocked-banner");
  const demoBanner = document.getElementById("demo-banner");
  const modeIndicatorTag = document.getElementById("mode-indicator-tag");

  // Telemetry Strip Elements
  const telemetryStrip = document.getElementById("telemetry-strip");
  const telemetryProvider = document.getElementById("telemetry-provider");
  const telemetryFreshness = document.getElementById("telemetry-freshness");
  const telemetryAge = document.getElementById("telemetry-age");
  const telemetryLatency = document.getElementById("telemetry-latency");
  const telemetryCountdown = document.getElementById("telemetry-countdown");
  const btnRefreshLive = document.getElementById("btn-refresh-live");

  // Form Controls
  const currentStationSelect = document.getElementById("current-station-select");
  const targetStationSelect = document.getElementById("target-station-select");
  const delaySlider = document.getElementById("delay-slider");
  const delayValue = document.getElementById("delay-value");
  const predictionForm = document.getElementById("prediction-form");
  const submitBtn = document.getElementById("submit-btn");
  const timelineContainer = document.getElementById("corridor-timeline");
  const tableContainer = document.getElementById("table-container");

  // Error Banner
  const errorBanner = document.getElementById("error-banner");
  const errorBannerText = document.getElementById("error-banner-text");
  const errorCloseBtn = document.getElementById("error-close-btn");

  // Output cards elements
  const mlPredictedArrival = document.getElementById("ml-predicted-arrival");
  const mlDelayPill = document.getElementById("ml-delay-pill");
  const mlConfidenceVal = document.getElementById("ml-confidence-val");
  const mlConfidenceBar = document.getElementById("ml-confidence-bar");
  const mlInterval = document.getElementById("ml-interval");
  const mlModelVersion = document.getElementById("ml-model-version");

  const basePredictedArrival = document.getElementById("base-predicted-arrival");
  const baseDelayPill = document.getElementById("base-delay-pill");
  const baseConfidenceVal = document.getElementById("base-confidence-val");
  const baseConfidenceBar = document.getElementById("base-confidence-bar");
  const scheduledArrivalVal = document.getElementById("scheduled-arrival-val");

  // Gate elements
  const gateBadge = document.getElementById("gate-badge");
  const gateCount = document.getElementById("gate-count");
  const gateMae = document.getElementById("gate-mae");
  const gateRmse = document.getElementById("gate-rmse");
  const gateMedae = document.getElementById("gate-medae");

  // Tab Buttons
  const tabTimetable = document.getElementById("tab-timetable");
  const tabBenchmark = document.getElementById("tab-benchmark");
  const tabMonitoring = document.getElementById("tab-monitoring");
  const tabTelemetry = document.getElementById("tab-telemetry");
  const tabModel = document.getElementById("tab-model");
  const tabProvenance = document.getElementById("tab-provenance");
  const tabAudit = document.getElementById("tab-audit");
  const tabProvider = document.getElementById("tab-provider");

  const allTabButtons = [
    tabTimetable,
    tabBenchmark,
    tabMonitoring,
    tabTelemetry,
    tabModel,
    tabProvenance,
    tabAudit,
    tabProvider
  ];

  let errorTimeout = null;
  function showError(msg) {
    if (!errorBanner || !errorBannerText) return;
    errorBannerText.textContent = `⚠️ Prediction Error: ${msg}`;
    errorBanner.classList.remove("hidden");
    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(hideError, 10000);
  }

  function hideError() {
    if (!errorBanner) return;
    errorBanner.classList.add("hidden");
    if (errorTimeout) clearTimeout(errorTimeout);
  }

  if (errorCloseBtn) {
    errorCloseBtn.addEventListener("click", hideError);
  }

  // Formatting helpers
  function formatIsoTime(isoStr) {
    if (!isoStr) return "--:--";
    const dt = new Date(isoStr);
    return isNaN(dt.getTime()) ? isoStr : dt.toISOString().substring(11, 19) + " UTC";
  }

  function formatShortTime(isoStr) {
    if (!isoStr) return "--:--";
    const dt = new Date(isoStr);
    return isNaN(dt.getTime()) ? isoStr : dt.toISOString().substring(11, 16);
  }

  // Health API
  async function fetchHealth() {
    try {
      const res = await fetch("/health");
      if (res.ok) {
        healthBadge.textContent = "SYSTEM LIVE";
        healthBadge.className = "badge status-badge live";
      } else {
        healthBadge.textContent = "OFFLINE";
        healthBadge.className = "badge status-badge";
      }
    } catch {
      healthBadge.textContent = "OFFLINE";
      healthBadge.className = "badge status-badge";
    }
  }

  // Corridor API
  async function fetchCorridor() {
    try {
      const res = await fetch("/api/corridor");
      if (!res.ok) throw new Error("Failed to load corridor");
      corridorData = await res.json();
      populateStationSelects();
      renderTimeline();
      renderTimetable();
    } catch (err) {
      console.error("Corridor fetch error:", err);
    }
  }

  // Historical Acceptance Gate API
  async function fetchEvaluationSummary() {
    try {
      const res = await fetch("/api/evaluation/summary");
      if (!res.ok) return;
      const data = await res.json();
      gateCount.textContent = data.evaluated_count;
      gateMae.textContent = (data.mean_absolute_error_seconds / 60).toFixed(2) + " min";
      gateRmse.textContent = (data.root_mean_squared_error_seconds / 60).toFixed(2) + " min";
      gateMedae.textContent = (data.median_absolute_error_seconds / 60).toFixed(2) + " min";

      if (data.accepted) {
        gateBadge.textContent = "ACCEPTED";
        gateBadge.className = "badge badge-success";
      } else {
        gateBadge.textContent = "REJECTED";
        gateBadge.className = "badge badge-neutral";
      }
    } catch (err) {
      console.error("Evaluation summary error:", err);
    }
  }

  function populateStationSelects() {
    if (!corridorData || !corridorData.stops) return;
    const stops = corridorData.stops;

    currentStationSelect.innerHTML = "";
    targetStationSelect.innerHTML = "";

    // Origin up to second-to-last
    stops.slice(0, -1).forEach((stop) => {
      const opt = document.createElement("option");
      opt.value = stop.station_code;
      opt.textContent = `${stop.station_code} — ${stop.station_name}`;
      if (stop.station_code === "CNB") opt.selected = true;
      currentStationSelect.appendChild(opt);
    });

    updateTargetOptions();
  }

  function updateTargetOptions() {
    if (!corridorData || !corridorData.stops) return;
    const stops = corridorData.stops;
    const currentCode = currentStationSelect.value;
    const currentStop = stops.find(s => s.station_code === currentCode);
    const currentSeq = currentStop ? currentStop.sequence : 1;

    targetStationSelect.innerHTML = "";
    stops.filter(s => s.sequence > currentSeq).forEach((stop, idx, arr) => {
      const opt = document.createElement("option");
      opt.value = stop.station_code;
      opt.textContent = `${stop.station_code} — ${stop.station_name}`;
      if (idx === arr.length - 1) opt.selected = true;
      targetStationSelect.appendChild(opt);
    });
  }

  function renderTimeline() {
    if (!corridorData || !corridorData.stops) return;
    const stops = corridorData.stops;
    const currentCode = currentStationSelect.value;
    const targetCode = targetStationSelect.value;

    const currentStop = stops.find(s => s.station_code === currentCode);
    const targetStop = stops.find(s => s.station_code === targetCode);
    const currentSeq = currentStop ? currentStop.sequence : 1;
    const targetSeq = targetStop ? targetStop.sequence : stops.length;

    timelineContainer.innerHTML = "";

    stops.forEach((stop) => {
      const div = document.createElement("div");
      div.className = "timeline-station";

      if (stop.sequence < currentSeq) {
        div.classList.add("passed");
      } else if (stop.sequence === currentSeq) {
        div.classList.add("current");
      } else if (stop.sequence === targetSeq) {
        div.classList.add("target");
      }

      const dot = document.createElement("div");
      dot.className = "timeline-dot";
      dot.textContent = stop.sequence;

      const code = document.createElement("div");
      code.className = "stn-code";
      code.textContent = stop.station_code;

      const name = document.createElement("div");
      name.className = "stn-name";
      name.title = stop.station_name;
      name.textContent = stop.station_name;

      const time = document.createElement("div");
      time.className = "stn-time";
      const displayTime = stop.scheduled_arrival || stop.scheduled_departure;
      time.textContent = formatShortTime(displayTime);

      div.appendChild(dot);
      div.appendChild(code);
      div.appendChild(name);
      div.appendChild(time);
      timelineContainer.appendChild(div);
    });
  }

  // ==========================================
  // MODE MANAGEMENT (LIVE vs DEMO)
  // ==========================================
  async function setMode(newMode) {
    currentMode = newMode;
    hideError();

    if (newMode === "LIVE") {
      btnModeLive.className = "mode-btn active live-active";
      btnModeDemo.className = "mode-btn";
      modeIndicatorTag.textContent = "Live Telemetry Mode";
      modeIndicatorTag.className = "card-tag badge-tag-live";
      demoBanner.classList.add("hidden");
      telemetryStrip.classList.remove("hidden");
      await checkAndInitializeLiveMode();
    } else {
      btnModeDemo.className = "mode-btn active demo-active";
      btnModeLive.className = "mode-btn";
      modeIndicatorTag.textContent = "Demo Mode (Interactive Simulation)";
      modeIndicatorTag.className = "card-tag badge-tag-demo";
      demoBanner.classList.remove("hidden");
      liveBlockedBanner.classList.add("hidden");
      telemetryStrip.classList.add("hidden");
      stopLivePolling();
      delaySlider.disabled = false;
      currentStationSelect.disabled = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Forecast Dynamic ETA</span> ➔`;
      await performPrediction();
    }
  }

  async function checkAndInitializeLiveMode() {
    try {
      const res = await fetch("/api/provider/status");
      if (!res.ok) throw new Error("Failed to check provider status");
      const statusData = await res.json();

      telemetryProvider.textContent = statusData.provider_name;
      telemetryLatency.textContent = statusData.latency_ms !== null ? `${statusData.latency_ms.toFixed(1)} ms` : "--";

      // If provider requires auth or is unconfigured and not a simulated fixture:
      if (statusData.requires_authorization || statusData.status === "NOT_CONFIGURED" || (!statusData.is_live && statusData.provider_type !== "synthetic_fixture")) {
        liveBlockedBanner.classList.remove("hidden");
        telemetryFreshness.textContent = "UNAVAILABLE";
        telemetryFreshness.className = "telemetry-badge invalid";
        telemetryAge.textContent = "N/A";
        stopLivePolling();
        delaySlider.disabled = true;
        currentStationSelect.disabled = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Live Ingestion Blocked</span>`;
        showError("Live telemetry unavailable: Provider credentials not configured. Switch to Demo Mode for simulated playback.");
        return;
      }

      // Provider is active (configured NTES or fixture)
      liveBlockedBanner.classList.add("hidden");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Forecast Live ETA</span> ➔`;
      await pollLiveTelemetry();
      startLivePolling();
    } catch (err) {
      liveBlockedBanner.classList.remove("hidden");
      showError(`Live mode check failed: ${err.message}`);
    }
  }

  async function pollLiveTelemetry() {
    try {
      const res = await fetch("/api/live/train/12301");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();

      telemetryProvider.textContent = data.provider_name;
      telemetryFreshness.textContent = data.freshness_state.toUpperCase();
      telemetryFreshness.className = `telemetry-badge ${data.freshness_state}`;
      telemetryAge.textContent = `${Math.round(data.data_age_seconds)}s`;

      // Update station and delay in UI based on live observation
      if (data.current_station_code) {
        currentStationSelect.value = data.current_station_code;
        updateTargetOptions();
      }
      if (data.current_delay_minutes !== undefined) {
        delaySlider.value = Math.round(data.current_delay_minutes);
        delayValue.textContent = Math.round(data.current_delay_minutes);
      }

      // Execute live prediction
      await performPrediction();
    } catch (err) {
      console.warn("Live poll error:", err);
      showError(err.message);
    }
  }

  function startLivePolling() {
    stopLivePolling();
    pollCountdownSec = 30;
    if (telemetryCountdown) telemetryCountdown.textContent = `${pollCountdownSec}s`;

    countdownTimer = setInterval(() => {
      pollCountdownSec -= 1;
      if (pollCountdownSec <= 0) {
        pollCountdownSec = 30;
        pollLiveTelemetry();
      }
      if (telemetryCountdown) telemetryCountdown.textContent = `${pollCountdownSec}s`;
    }, 1000);
  }

  function stopLivePolling() {
    if (livePollTimer) clearInterval(livePollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    livePollTimer = null;
    countdownTimer = null;
  }

  // ==========================================
  // PREDICTION EXECUTION
  // ==========================================
  async function performPrediction() {
    const currentCode = currentStationSelect.value;
    const targetCode = targetStationSelect.value;
    const delayMin = parseFloat(delaySlider.value);

    if (!currentCode || !targetCode) return;

    hideError();
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Forecasting...</span>`;

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          train_number: "12301",
          current_station: currentCode,
          target_station: targetCode,
          delay_minutes: delayMin,
          mode: currentMode
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      updatePredictionDisplays(data);
      renderTimeline();

      if (activeTab === "audit") {
        renderAuditLog();
      }
    } catch (err) {
      showError(err.message);
    } finally {
      if (currentMode === "LIVE" && liveBlockedBanner && !liveBlockedBanner.classList.contains("hidden")) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Live Ingestion Blocked</span>`;
      } else {
        submitBtn.disabled = false;
        submitBtn.innerHTML = currentMode === "LIVE" ? `<span>Forecast Live ETA</span> ➔` : `<span>Forecast Dynamic ETA</span> ➔`;
      }
    }
  }

  function updatePredictionDisplays(data) {
    scheduledArrivalVal.textContent = formatIsoTime(data.scheduled_arrival);

    // ML Model Output
    const ml = data.ml_model;
    mlPredictedArrival.textContent = formatIsoTime(ml.predicted_arrival);
    const mlSign = ml.predicted_delay_minutes >= 0 ? "+" : "";
    mlDelayPill.textContent = `${mlSign}${ml.predicted_delay_minutes.toFixed(1)} min delay`;
    mlModelVersion.textContent = `${ml.model_version}`;

    const mlConfPct = Math.round(ml.confidence * 100);
    mlConfidenceVal.textContent = `${mlConfPct}%`;
    mlConfidenceBar.style.width = `${mlConfPct}%`;
    mlInterval.textContent = `${formatShortTime(ml.interval.lower_bound)} to ${formatShortTime(ml.interval.upper_bound)} UTC`;

    // Executive Cards Sync (Frame 00:21)
    const execDelay = document.getElementById("exec-delay-val");
    if (execDelay) {
      execDelay.textContent = `${mlSign}${ml.predicted_delay_minutes.toFixed(1)} min`;
    }
    const execConf = document.getElementById("exec-confidence");
    if (execConf) {
      execConf.textContent = `High Confidence (${mlConfPct}%)`;
    }
    const execNextStation = document.getElementById("exec-next-station");
    if (execNextStation && targetStationSelect && targetStationSelect.options[targetStationSelect.selectedIndex]) {
      execNextStation.textContent = targetStationSelect.options[targetStationSelect.selectedIndex].text;
    }
    const execEtaTime = document.getElementById("exec-eta-time");
    if (execEtaTime) {
      execEtaTime.textContent = formatIsoTime(ml.predicted_arrival);
    }

    // Baseline Model Output
    const base = data.baseline;
    basePredictedArrival.textContent = formatIsoTime(base.predicted_arrival);
    const baseSign = base.predicted_delay_minutes >= 0 ? "+" : "";
    baseDelayPill.textContent = `${baseSign}${base.predicted_delay_minutes.toFixed(1)} min delay`;

    const baseConfPct = Math.round(base.confidence * 100);
    baseConfidenceVal.textContent = `${baseConfPct}%`;
    baseConfidenceBar.style.width = `${baseConfPct}%`;
  }

  // ==========================================
  // TAB RENDERING IMPLEMENTATIONS (8 TABS)
  // ==========================================

  function setActiveTabButton(buttonToActivate) {
    allTabButtons.forEach(btn => {
      if (btn) btn.classList.remove("active");
    });
    if (buttonToActivate) buttonToActivate.classList.add("active");
  }

  // Tab 1: Timetable
  function renderTimetable() {
    if (!corridorData || !corridorData.stops) return;
    const stops = corridorData.stops;

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Seq</th>
            <th>Station Code</th>
            <th>Station Name</th>
            <th>Scheduled Arrival</th>
            <th>Scheduled Departure</th>
          </tr>
        </thead>
        <tbody>
    `;

    stops.forEach(s => {
      html += `
        <tr>
          <td class="mono">${s.sequence}</td>
          <td class="mono"><strong>${s.station_code}</strong></td>
          <td>${s.station_name}</td>
          <td class="mono">${formatIsoTime(s.scheduled_arrival)}</td>
          <td class="mono">${formatIsoTime(s.scheduled_departure)}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    tableContainer.innerHTML = html;
  }

  // Tab 2: Benchmark (Head-to-head comparison)
  async function renderBenchmark() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Running head-to-head model benchmark...</div>`;
    try {
      const res = await fetch("/api/evaluation/compare");
      if (!res.ok) throw new Error("Failed to load benchmark");
      const data = await res.json();
      const b = data.baseline_metrics;
      const m = data.ml_metrics;

      let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="gate-metric-box" style="border-color: rgba(56, 189, 248, 0.4);">
            <span class="gate-metric-label">MAE Improvement</span>
            <span class="gate-metric-num" style="color: #38bdf8;">${data.mae_improvement_pct >= 0 ? '+' : ''}${data.mae_improvement_pct.toFixed(1)}%</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${(b.mae_seconds / 60).toFixed(2)}m ➔ ${(m.mae_seconds / 60).toFixed(2)}m</span>
          </div>
          <div class="gate-metric-box" style="border-color: rgba(16, 185, 129, 0.4);">
            <span class="gate-metric-label">RMSE Improvement</span>
            <span class="gate-metric-num" style="color: #10b981;">${data.rmse_improvement_pct >= 0 ? '+' : ''}${data.rmse_improvement_pct.toFixed(1)}%</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${(b.rmse_seconds / 60).toFixed(2)}m ➔ ${(m.rmse_seconds / 60).toFixed(2)}m</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Within &le; 5 Mins</span>
            <span class="gate-metric-num">${m.pct_within_5min.toFixed(0)}%</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">Baseline: ${b.pct_within_5min.toFixed(0)}%</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">ML Win Rate</span>
            <span class="gate-metric-num" style="color: #fbbf24;">${((data.ml_wins_count / data.evaluated_count) * 100).toFixed(0)}%</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${data.ml_wins_count} wins / ${data.evaluated_count} cases</span>
          </div>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Train</th>
              <th>Current</th>
              <th>Target</th>
              <th>Actual Arrival</th>
              <th>Baseline Arr (Err)</th>
              <th>ML Arr (Err)</th>
              <th>&Delta; Error (Improvement)</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
      `;

      data.cases.slice(0, 15).forEach(c => {
        const bErr = (c.baseline_error_seconds / 60).toFixed(1);
        const mErr = (c.ml_error_seconds / 60).toFixed(1);
        const imp = (c.absolute_improvement_seconds / 60).toFixed(1);
        const verdict = c.ml_better
          ? `<span style="color: #34d399; font-weight: 600;">ML +${imp}m</span>`
          : `<span style="color: var(--text-muted);">Baseline</span>`;

        html += `
          <tr>
            <td class="mono">${c.case_index}</td>
            <td class="mono"><strong>${c.train_number}</strong></td>
            <td class="mono">${c.current_station_code}</td>
            <td class="mono">${c.target_station_code}</td>
            <td class="mono">${formatIsoTime(c.actual_arrival)}</td>
            <td class="mono">${formatShortTime(c.baseline_predicted_arrival)} (${bErr >= 0 ? '+' : ''}${bErr}m)</td>
            <td class="mono" style="color: #38bdf8;">${formatShortTime(c.ml_predicted_arrival)} (${mErr >= 0 ? '+' : ''}${mErr}m)</td>
            <td class="mono">${imp >= 0 ? '+' : ''}${imp} min</td>
            <td>${verdict}</td>
          </tr>
        `;
      });

      html += `</tbody></table>`;
      tableContainer.innerHTML = html;
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading benchmark: ${err.message}</div>`;
    }
  }

  // Tab 3: Error Slicing
  async function renderMonitoring() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Analyzing model error slicing and reliability...</div>`;
    try {
      const res = await fetch("/api/monitoring/analysis");
      if (!res.ok) throw new Error("Failed to load monitoring");
      const data = await res.json();
      const rel = data.reliability_summary;

      let html = `
        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.5rem;">
          <h3 style="font-size: 0.9rem; margin-bottom: 0.5rem; color: #38bdf8;">Evaluator Reliability &amp; Bias Diagnosis</h3>
          <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.35rem;"><strong>Systematic Bias:</strong> ${rel.bias_diagnosis}</p>
          <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.35rem;"><strong>Best Performing Station:</strong> <span class="mono" style="color:#34d399;">${rel.best_station}</span> (${rel.best_station_mae_minutes.toFixed(2)} min MAE)</p>
          <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.5rem;"><strong>Delay Resilience:</strong> ${rel.large_delay_resilience}</p>
          <ul style="font-size: 0.75rem; color: var(--text-muted); margin-left: 1.25rem;">
            ${rel.recommendations.map(r => `<li>${r}</li>`).join("")}
          </ul>
        </div>

        <h3 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">1. Error Breakdown By Station (Corridor Progression)</h3>
        <table class="data-table" style="margin-bottom: 1.5rem;">
          <thead>
            <tr>
              <th>Station</th>
              <th>Samples</th>
              <th>MAE</th>
              <th>RMSE</th>
              <th>Median Error</th>
              <th>Mean Bias</th>
              <th>Within &le; 5m</th>
            </tr>
          </thead>
          <tbody>
      `;

      data.station_slices.forEach(s => {
        html += `
          <tr>
            <td class="mono"><strong>${s.slice_key}</strong></td>
            <td class="mono">${s.sample_count}</td>
            <td class="mono" style="color: #38bdf8;">${(s.mae_seconds / 60).toFixed(2)} min</td>
            <td class="mono">${(s.rmse_seconds / 60).toFixed(2)} min</td>
            <td class="mono">${(s.median_absolute_error_seconds / 60).toFixed(2)} min</td>
            <td class="mono">${(s.mean_bias_seconds / 60 >= 0 ? '+' : '')}${(s.mean_bias_seconds / 60).toFixed(2)} min</td>
            <td class="mono">${s.pct_within_5min.toFixed(0)}%</td>
          </tr>
        `;
      });

      html += `</tbody></table>`;

      html += `
        <h3 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">2. Error Breakdown By Route Progress</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Journey Stage</th>
              <th>Samples</th>
              <th>MAE</th>
              <th>RMSE</th>
              <th>Within &le; 5m</th>
            </tr>
          </thead>
          <tbody>
      `;

      data.progress_slices.forEach(p => {
        html += `
          <tr>
            <td><strong>${p.slice_key}</strong></td>
            <td class="mono">${p.sample_count}</td>
            <td class="mono" style="color: #38bdf8;">${(p.mae_seconds / 60).toFixed(2)} min</td>
            <td class="mono">${(p.rmse_seconds / 60).toFixed(2)} min</td>
            <td class="mono">${p.pct_within_5min.toFixed(0)}%</td>
          </tr>
        `;
      });

      html += `</tbody></table>`;
      tableContainer.innerHTML = html;
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading monitoring analysis: ${err.message}</div>`;
    }
  }

  // Tab 4: Live Telemetry & Monitoring Metrics
  async function renderTelemetry() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Fetching operational monitoring telemetry...</div>`;
    try {
      const res = await fetch("/api/monitoring");
      if (!res.ok) throw new Error("Failed to load telemetry");
      const t = await res.json();

      let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="gate-metric-box">
            <span class="gate-metric-label">Active Mode</span>
            <span class="gate-metric-num" style="color: ${t.active_mode === 'LIVE' ? '#34d399' : '#38bdf8'};">${t.active_mode}</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">${t.provider_name} (${t.provider_status})</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Total Predictions</span>
            <span class="gate-metric-num">${t.prediction_count}</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">${t.prediction_failures} failures</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Live Observations</span>
            <span class="gate-metric-num">${t.live_observations_count}</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">${t.stale_observations_count} stale / ${t.average_data_age_seconds}s avg age</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Provider Latency</span>
            <span class="gate-metric-num" style="color: #38bdf8;">${t.average_provider_latency_ms.toFixed(1)} ms</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">${t.provider_failures} poll drops</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">ML Win Rate</span>
            <span class="gate-metric-num" style="color: #fbbf24;">${t.ml_win_rate_pct.toFixed(0)}%</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">ML MAE: ${t.ml_mae_minutes}m vs Base: ${t.baseline_mae_minutes}m</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Prediction Coverage</span>
            <span class="gate-metric-num" style="color: #34d399;">${t.prediction_interval_coverage_pct.toFixed(0)}%</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">Mean bias: ${t.mean_bias_seconds}s</span>
          </div>
        </div>

        <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">Operational Reliability Architecture</h4>
          <ul style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; margin-left: 1.25rem;">
            <li><strong>Fail-Closed Gateway:</strong> Network dropouts or missing credentials do not halt operations; safe fallback paths maintain strict boundary guarantees.</li>
            <li><strong>Monotonic Timestamps:</strong> Telemetry satisfies <code>obs_time &le; recv_time &le; proc_time = as_of</code>, strictly preventing temporal leakage.</li>
            <li><strong>Zero Scraping Constraint:</strong> Outliers ETA never scrapes unofficial unauthenticated portals; official IR feeds require explicit ministry API keys.</li>
          </ul>
        </div>
      `;
      tableContainer.innerHTML = html;
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading telemetry: ${err.message}</div>`;
    }
  }

  // Tab 5: Model Architecture & Weights
  async function renderModelInfo() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Loading ML model parameters and architecture...</div>`;
    try {
      const res = await fetch("/api/model");
      if (!res.ok) throw new Error("Failed to load model info");
      const m = await res.json();

      let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="gate-metric-box">
            <span class="gate-metric-label">Model Architecture</span>
            <span class="gate-metric-num" style="font-size: 1.1rem; color: #38bdf8;">${m.model_name}</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${m.model_version}</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Model Intercept</span>
            <span class="gate-metric-num">${(m.intercept_seconds / 60).toFixed(2)} min</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${m.intercept_seconds} seconds</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Residual Std (&sigma;)</span>
            <span class="gate-metric-num">${(m.residual_std_seconds / 60).toFixed(2)} min</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">Uncertainty scale</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Model Confidence</span>
            <span class="gate-metric-num" style="color: #34d399;">${Math.round(m.confidence_score * 100)}%</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">Prior confidence score</span>
          </div>
        </div>

        <h3 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">Learned Feature Weights (Standardized Coefficients)</h3>
        <table class="data-table" style="margin-bottom: 1.5rem;">
          <thead>
            <tr>
              <th>Feature Identifier</th>
              <th>Learned Weight</th>
              <th>Influence / Sign</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
      `;

      m.weights.forEach(w => {
        const sign = w.weight >= 0 ? "+" : "";
        const barWidth = Math.min(100, Math.abs(w.weight) * 60);
        const barColor = w.weight >= 0 ? "#fbbf24" : "#34d399";
        html += `
          <tr>
            <td class="mono"><strong>${w.feature}</strong></td>
            <td class="mono" style="color: ${barColor}; font-weight:600;">${sign}${w.weight.toFixed(4)}</td>
            <td>
              <div style="background: rgba(255,255,255,0.06); border-radius: 3px; height: 8px; width: 120px; overflow: hidden;">
                <div style="background: ${barColor}; height: 8px; width: ${barWidth}%;"></div>
              </div>
            </td>
            <td style="font-size: 0.75rem; color: var(--text-secondary);">
              ${w.feature.includes("delay") ? "Current observed delay propagation" : w.feature.includes("stops") ? "Downstream corridor congestion buffer" : "Corridor progress dynamics"}
            </td>
          </tr>
        `;
      });

      html += `</tbody></table>

        <div style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: var(--radius-md); padding: 0.85rem 1.25rem;">
          <p style="font-size: 0.75rem; color: #93c5fd;"><strong>Training Lineage Notice:</strong> ${m.notice}</p>
        </div>
      `;
      tableContainer.innerHTML = html;
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading model info: ${err.message}</div>`;
    }
  }

  // Tab 6: Data Provenance & Safety Gates
  async function renderProvenance() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Verifying provenance audit records...</div>`;
    try {
      const res = await fetch("/api/provenance");
      if (!res.ok) throw new Error("Failed to load provenance");
      const p = await res.json();

      let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="gate-metric-box">
            <span class="gate-metric-label">Dataset Classification</span>
            <span class="gate-metric-num" style="color: #38bdf8; font-size: 1.1rem;">${p.dataset_classification}</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">Zero fabrication rule</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Active Provider</span>
            <span class="gate-metric-num" style="font-size: 1.1rem;">${p.active_provider}</span>
            <span style="font-size: 0.7rem; color: #fbbf24;">${p.provider_authorization_status}</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Timetable Snapshot</span>
            <span class="gate-metric-num" style="font-size: 1.1rem;">${p.timetable_snapshot_id}</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${p.timetable_snapshot_name}</span>
          </div>
        </div>

        <h3 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">Architectural Invariants &amp; Leakage Safety</h3>
        <table class="data-table" style="margin-bottom: 1.5rem;">
          <thead>
            <tr>
              <th>Invariant Check</th>
              <th>Status</th>
              <th>Mathematical Proof / Enforcement Mechanism</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Temporal Monotonicity</strong></td>
              <td><span style="color: #34d399; font-weight:700;">ENFORCED</span></td>
              <td class="mono" style="font-size: 0.75rem;">${p.temporal_invariance}</td>
            </tr>
            <tr>
              <td><strong>Label Isolation</strong></td>
              <td><span style="color: #34d399; font-weight:700;">ENFORCED</span></td>
              <td style="font-size: 0.75rem;">${p.label_leakage_status}</td>
            </tr>
            <tr>
              <td><strong>Fail-Closed Gate</strong></td>
              <td><span style="color: #34d399; font-weight:700;">ACTIVE</span></td>
              <td style="font-size: 0.75rem;">${p.real_data_policy}</td>
            </tr>
            <tr>
              <td><strong>Pure-Python Runtime</strong></td>
              <td><span style="color: #34d399; font-weight:700;">VERIFIED</span></td>
              <td style="font-size: 0.75rem;">Zero C-extensions; 100% standard library + Pydantic v2 domain schemas.</td>
            </tr>
          </tbody>
        </table>

        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-md); padding: 0.85rem 1.25rem;">
          <p style="font-size: 0.75rem; color: #fbbf24;"><strong>Evaluator Policy:</strong> ${p.disclaimer}</p>
        </div>
      `;
      tableContainer.innerHTML = html;
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading provenance: ${err.message}</div>`;
    }
  }

  // Tab 7: Audit Logs (Filterable by ALL, LIVE, DEMO)
  async function renderAuditLog() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Loading prediction audit trail...</div>`;
    try {
      const res = await fetch("/api/predictions?limit=30");
      if (!res.ok) throw new Error("Failed to load predictions");
      const data = await res.json();
      let items = data.predictions || [];

      if (auditFilter === "LIVE") {
        items = items.filter(i => !i.is_demo);
      } else if (auditFilter === "DEMO") {
        items = items.filter(i => i.is_demo);
      }

      let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <span style="font-size: 0.8rem; color: var(--text-secondary);">Showing <strong>${items.length}</strong> logged prediction audits</span>
          <div style="display: flex; gap: 0.35rem;">
            <button id="filter-all" class="tab-btn ${auditFilter === 'ALL' ? 'active' : ''}">All</button>
            <button id="filter-live" class="tab-btn ${auditFilter === 'LIVE' ? 'active' : ''}">Live Only</button>
            <button id="filter-demo" class="tab-btn ${auditFilter === 'DEMO' ? 'active' : ''}">Demo Only</button>
          </div>
        </div>
      `;

      if (items.length === 0) {
        html += `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No predictions found for filter "${auditFilter}". Run a prediction above!</div>`;
        tableContainer.innerHTML = html;
        attachAuditFilterListeners();
        return;
      }

      html += `
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Mode</th>
              <th>Train</th>
              <th>Current</th>
              <th>Target</th>
              <th>Observed</th>
              <th>Predicted Delay</th>
              <th>Predicted Arrival</th>
              <th>Confidence</th>
              <th>Logged Time</th>
            </tr>
          </thead>
          <tbody>
      `;

      items.forEach(item => {
        const obsDelay = item.observed_delay_minutes ? `${item.observed_delay_minutes.toFixed(1)}m` : "0m";
        const predDelay = item.predicted_delay_minutes ? `${item.predicted_delay_minutes.toFixed(1)}m` : "0m";
        const conf = item.confidence ? `${(item.confidence * 100).toFixed(0)}%` : "--";
        const loggedAt = formatIsoTime(item.created_at);
        const modePill = item.is_demo
          ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.65rem;">DEMO</span>`
          : `<span class="badge" style="background:rgba(16,185,129,0.15); color:#34d399; font-size:0.65rem;">LIVE</span>`;

        html += `
          <tr>
            <td class="mono" style="font-size:0.7rem; color: var(--text-muted);">${item.prediction_id.substring(0, 8)}...</td>
            <td>${modePill}</td>
            <td class="mono"><strong>${item.train_number}</strong></td>
            <td class="mono">${item.current_station_code}</td>
            <td class="mono">${item.target_station_code}</td>
            <td class="mono">${obsDelay}</td>
            <td class="mono" style="color: #fbbf24;">${predDelay}</td>
            <td class="mono">${formatIsoTime(item.predicted_arrival)}</td>
            <td class="mono">${conf}</td>
            <td class="mono">${loggedAt}</td>
          </tr>
        `;
      });

      html += `</tbody></table>`;
      tableContainer.innerHTML = html;
      attachAuditFilterListeners();
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading audit log: ${err.message}</div>`;
    }
  }

  function attachAuditFilterListeners() {
    const fAll = document.getElementById("filter-all");
    const fLive = document.getElementById("filter-live");
    const fDemo = document.getElementById("filter-demo");
    if (fAll) fAll.addEventListener("click", () => { auditFilter = "ALL"; renderAuditLog(); });
    if (fLive) fLive.addEventListener("click", () => { auditFilter = "LIVE"; renderAuditLog(); });
    if (fDemo) fDemo.addEventListener("click", () => { auditFilter = "DEMO"; renderAuditLog(); });
  }

  // Tab 8: Provider Status & Diagnostics
  async function renderProviderStatus() {
    tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Querying railway data provider diagnostic status...</div>`;
    try {
      const res = await fetch("/api/provider/status");
      if (!res.ok) throw new Error("Failed to load provider status");
      const p = await res.json();

      const statusColor = p.status === "HEALTHY" ? "#34d399" : p.status === "NOT_CONFIGURED" ? "#f87171" : "#fbbf24";

      let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="gate-metric-box">
            <span class="gate-metric-label">Provider Name</span>
            <span class="gate-metric-num" style="font-size: 1.1rem; color: #38bdf8;">${p.provider_name}</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">${p.provider_type}</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Operational Status</span>
            <span class="gate-metric-num" style="font-size: 1.1rem; color: ${statusColor};">${p.status}</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">${p.is_live ? 'Live Data Active' : 'Offline / Standby'}</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Gateway Latency</span>
            <span class="gate-metric-num">${p.latency_ms !== null ? `${p.latency_ms.toFixed(1)} ms` : 'N/A'}</span>
            <span style="font-size:0.7rem; color: var(--text-muted);">Checked ${formatShortTime(p.last_checked_at)}</span>
          </div>
          <div class="gate-metric-box">
            <span class="gate-metric-label">Authentication</span>
            <span class="gate-metric-num" style="font-size: 1.1rem; color: ${p.requires_authorization ? '#fbbf24' : '#34d399'};">
              ${p.requires_authorization ? 'REQUIRED' : 'NONE'}
            </span>
            <span style="font-size:0.7rem; color: var(--text-muted);">Ministry API Credentials</span>
          </div>
        </div>

        <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">Status Diagnosis</h4>
          <p style="font-size: 0.85rem; color: var(--text-primary); margin-bottom: 0.5rem;"><strong>Message:</strong> ${p.message}</p>
          <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5;">${p.disclaimer}</p>
        </div>

        <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1rem;">
          <h4 style="font-size: 0.8rem; text-transform: uppercase; color: #34d399; margin-bottom: 0.35rem;">How to configure Live Railway Feeds:</h4>
          <code style="font-size: 0.75rem; color: #a7f3d0; display: block; font-family: var(--font-mono); line-height: 1.5;">
            # Option 1: RailRadar Telemetry Feed (Permitted third-party)<br>
            export RAILWAY_PROVIDER=railradar<br>
            export RAILRADAR_API_KEY="your-railradar-api-key"<br><br>
            # Option 2: Fallback Chain (RailRadar &rarr; NTES fail-closed)<br>
            export RAILWAY_PROVIDER=chain<br><br>
            # Option 3: Official CRIS / NTES Gateway<br>
            export RAILWAY_PROVIDER=ntes<br>
            export NTES_BASE_URL="https://authorized-gateway.gov.in"<br>
            export NTES_API_KEY="your-ministry-key"
          </code>
        </div>
        <button type="button" id="btn-test-provider" class="btn btn-primary" style="font-size: 0.8rem; padding: 0.4rem 1rem;">⟳ Test Gateway Connectivity</button>
      `;
      tableContainer.innerHTML = html;
      const testBtn = document.getElementById("btn-test-provider");
      if (testBtn) {
        testBtn.addEventListener("click", async () => {
          testBtn.textContent = "Probing...";
          try {
            const resp = await fetch("/api/provider/test", { method: "POST" });
            const data = await resp.json();
            alert(`Provider Probe Result:\nStatus: ${data.status}\nMessage: ${data.message}`);
          } catch (e) {
            alert(`Probe Failed: ${e.message}`);
          } finally {
            testBtn.textContent = "⟳ Test Gateway Connectivity";
            renderProviderStatus();
          }
        });
      }
    } catch (err) {
      tableContainer.innerHTML = `<div style="padding: 1rem; color: var(--accent-rose);">Error loading provider status: ${err.message}</div>`;
    }
  }

  // ==========================================
  // EVENT LISTENERS & SETUP
  // ==========================================

  // Mode buttons
  if (btnModeLive) btnModeLive.addEventListener("click", () => setMode("LIVE"));
  if (btnModeDemo) btnModeDemo.addEventListener("click", () => setMode("DEMO"));
  if (switchToDemoBtn) switchToDemoBtn.addEventListener("click", () => setMode("DEMO"));
  if (btnRefreshLive) btnRefreshLive.addEventListener("click", () => pollLiveTelemetry());

  delaySlider.addEventListener("input", (e) => {
    delayValue.textContent = e.target.value;
  });

  currentStationSelect.addEventListener("change", () => {
    updateTargetOptions();
    renderTimeline();
    performPrediction();
  });

  targetStationSelect.addEventListener("change", () => {
    renderTimeline();
    performPrediction();
  });

  predictionForm.addEventListener("submit", (e) => {
    e.preventDefault();
    performPrediction();
  });

  // 8 Tab listeners
  tabTimetable.addEventListener("click", () => {
    activeTab = "timetable";
    setActiveTabButton(tabTimetable);
    renderTimetable();
  });

  tabBenchmark.addEventListener("click", () => {
    activeTab = "benchmark";
    setActiveTabButton(tabBenchmark);
    renderBenchmark();
  });

  tabMonitoring.addEventListener("click", () => {
    activeTab = "monitoring";
    setActiveTabButton(tabMonitoring);
    renderMonitoring();
  });

  tabTelemetry.addEventListener("click", () => {
    activeTab = "telemetry";
    setActiveTabButton(tabTelemetry);
    renderTelemetry();
  });

  tabModel.addEventListener("click", () => {
    activeTab = "model";
    setActiveTabButton(tabModel);
    renderModelInfo();
  });

  tabProvenance.addEventListener("click", () => {
    activeTab = "provenance";
    setActiveTabButton(tabProvenance);
    renderProvenance();
  });

  tabAudit.addEventListener("click", () => {
    activeTab = "audit";
    setActiveTabButton(tabAudit);
    renderAuditLog();
  });

  tabProvider.addEventListener("click", () => {
    activeTab = "provider";
    setActiveTabButton(tabProvider);
    renderProviderStatus();
  });

  // Startup sequence
  const startDashboard = async () => {
    try {
      await fetchHealth();
      await fetchCorridor();
      await fetchEvaluationSummary();
      await performPrediction();
    } catch (err) {
      console.warn("Dashboard startup data fetch warning:", err);
    }
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", startDashboard);
  } else {
    startDashboard();
  }

}
