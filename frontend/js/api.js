/**
 * api.js — Centralized Canonical API Client for RippleETA Engine
 * Single Source of Truth for frontend ↔ backend communication.
 */
export class APIClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this._token = localStorage.getItem('rippleeta_token') || null;
  }

  setToken(token) {
    this._token = token;
    if (token) {
      localStorage.setItem('rippleeta_token', token);
    } else {
      localStorage.removeItem('rippleeta_token');
    }
  }

  getToken() {
    return this._token || localStorage.getItem('rippleeta_token');
  }

  async _fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = this.getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const mergedOpts = {
      credentials: 'include',
      ...opts,
      headers,
    };

    const res = await fetch(this.baseUrl + path, mergedOpts);
    if (!res.ok) {
      let detail = `Request failed (HTTP ${res.status})`;
      try {
        const j = await res.json();
        if (typeof j.detail === 'string') {
          detail = j.detail;
        } else if (Array.isArray(j.detail)) {
          detail = j.detail.map(d => d.msg || d.message || JSON.stringify(d)).join('; ');
        } else if (j.detail && typeof j.detail === 'object') {
          detail = j.detail.msg || j.detail.message || JSON.stringify(j.detail);
        } else if (typeof j.message === 'string') {
          detail = j.message;
        } else if (typeof j.error === 'string') {
          detail = j.error;
        }
      } catch {}

      if (res.status === 401 && detail.startsWith('Request failed')) {
        detail = 'Authentication required or invalid session credentials.';
      } else if (res.status === 403 && detail.startsWith('Request failed')) {
        detail = 'Access forbidden: this role is not authorized.';
      } else if (res.status === 500 && detail.startsWith('Request failed')) {
        detail = 'The prediction engine is temporarily unavailable. Please try again.';
      }

      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // System & Health
  async getHealth() {
    return this._fetch('/health');
  }

  async getMode() {
    return this._fetch('/system/mode');
  }

  async getSystemStatus() {
    return this._fetch('/system/status');
  }

  async getStats() {
    return this._fetch('/api/stats');
  }

  async getTrains() {
    return this._fetch('/trains');
  }

  // Authentication
  async getAuthConfig() {
    return this._fetch('/api/auth/config');
  }

  async loginWithGoogle(credential) {
    const data = await this._fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    if (data.token) this.setToken(data.token);
    return data;
  }

  async loginDemo(email, role) {
    const data = await this._fetch('/api/auth/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (data.token) this.setToken(data.token);
    return data;
  }

  async logout() {
    try {
      await this._fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    return this._fetch('/api/me');
  }

  // Predictions & Decisions
  async getPrediction(trainId, variance = null) {
    const q = variance !== null ? `?prediction_variance=${encodeURIComponent(variance)}` : '';
    return this._fetch(`/predict/${encodeURIComponent(trainId)}${q}`);
  }

  async getPassenger(trainId, variance = null) {
    const q = variance !== null ? `?prediction_variance=${encodeURIComponent(variance)}` : '';
    return this._fetch(`/predict/${encodeURIComponent(trainId)}/passenger${q}`);
  }

  async getStationMaster(trainId, variance = null) {
    const q = variance !== null ? `?prediction_variance=${encodeURIComponent(variance)}` : '';
    return this._fetch(`/predict/${encodeURIComponent(trainId)}/station-master${q}`);
  }

  async getCrewController(trainId, variance = null) {
    const q = variance !== null ? `?prediction_variance=${encodeURIComponent(variance)}` : '';
    return this._fetch(`/predict/${encodeURIComponent(trainId)}/crew-controller${q}`);
  }

  async getFeederTransport(trainId, cutoffTime, variance = null) {
    const params = new URLSearchParams({ cutoff_time: cutoffTime });
    if (variance !== null) params.set('prediction_variance', String(variance));
    return this._fetch(`/predict/${encodeURIComponent(trainId)}/feeder-transport?${params.toString()}`);
  }

  async getMaintenance(trainId, variance = null) {
    const q = variance !== null ? `?prediction_variance=${encodeURIComponent(variance)}` : '';
    return this._fetch(`/predict/${encodeURIComponent(trainId)}/maintenance${q}`);
  }

  // Graph Engine
  async getGraphDemo() {
    return this._fetch('/graph/demo');
  }

  async getGraphSandbox(sourceDelay = 15.0) {
    return this._fetch(`/graph/sandbox?source_delay=${encodeURIComponent(sourceDelay)}`);
  }
}

export const api = new APIClient();
