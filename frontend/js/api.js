/**
 * api.js — Centralized API client for OUTLIERS ETA Engine
 */
export class APIClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this._healthCache = null;
  }

  async _fetch(path, opts = {}) {
    const res = await fetch(this.baseUrl + path, opts);
    if (!res.ok) {
      let err = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        err = j.error || err;
      } catch {}
      throw new Error(err);
    }
    return res.json();
  }

  async getHealth() {
    const d = await this._fetch('/health');
    this._healthCache = d;
    return d;
  }

  async getAuthConfig() {
    return this._fetch('/api/auth/config');
  }

  async loginWithGoogle(credential) {
    return this._fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
  }

  async getCorridor(n = '12301') {
    return this._fetch(`/api/train/${encodeURIComponent(n)}`);
  }

  async getEvaluationSummary() {
    return this._fetch('/api/evaluation/summary');
  }

  async getEvaluationCompare() {
    return this._fetch('/api/evaluation/compare');
  }

  async getMonitoring() {
    return this._fetch('/api/monitoring');
  }

  async getMonitoringAnalysis() {
    return this._fetch('/api/monitoring/analysis');
  }

  async getModel() {
    return this._fetch('/api/model');
  }

  async getModelMetrics() {
    return this._fetch('/api/model/metrics');
  }

  async getModelFeatures() {
    return this._fetch('/api/model/features');
  }

  async getProvenance() {
    return this._fetch('/api/provenance');
  }

  async getProviderStatus() {
    return this._fetch('/api/provider/status');
  }

  async getLiveTrainStatus(n = '12301') {
    return this._fetch(`/api/live/train/${encodeURIComponent(n)}`);
  }

  async predict(payload) {
    return this._fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async predictLive(payload) {
    return this._fetch('/api/live/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async testProvider() {
    return this._fetch('/api/provider/test', { method: 'POST' });
  }

  async recordArrival(predictionId, actualArrival, actualDelayMinutes) {
    return this._fetch('/api/feedback/arrival', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prediction_id: predictionId,
        actual_arrival: actualArrival,
        actual_delay_minutes: actualDelayMinutes,
      }),
    });
  }

  async getPredictions(limit = 30, train = null, station = null) {
    const p = new URLSearchParams({ limit: String(limit) });
    if (train) p.set('train', train);
    if (station) p.set('station', station);
    return this._fetch(`/api/predictions?${p.toString()}`);
  }
}

export const api = new APIClient();
