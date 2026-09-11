/**
 * auth.js - Google Identity Services & Demo Mode integration for OUTLIERS
 * Matches Frame 00:14 of Storyboard
 */
import { api } from './api.js';

const AUTH_STORAGE_KEY = 'outliers_user';

let _config = null;
let _user = null;
let _onAuthSuccess = null;
let _onDemoMode = null;

export async function initAuth(onAuthSuccess, onDemoMode) {
  _onAuthSuccess = onAuthSuccess;
  _onDemoMode = onDemoMode;

  // Load persisted user
  const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) {
    try { _user = JSON.parse(stored); } catch {}
  }

  // Fetch config from backend
  try {
    _config = await api.getAuthConfig();
  } catch {
    _config = { auth_configured: false };
  }

  // Configure modal UI
  _setupAuthModal();

  // Load Google GSI script if configured
  if (_config && _config.auth_configured && _config.google_client_id) {
    _loadGSI(_config.google_client_id);
  }
}

export function getUser() { return _user; }
export function isAuthenticated() { return _user !== null; }

export function signOut() {
  _user = null;
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  if (window.google && window.google.accounts) {
    window.google.accounts.id.disableAutoSelect();
  }
}

function _setupAuthModal() {
  const isConfigured = _config && _config.auth_configured;
  const noteEl = document.getElementById('auth-unconfigured-note');
  const googleBtn = document.getElementById('btn-google-fallback');
  const demoBtn = document.getElementById('btn-demo-mode');
  const closeBtn = document.getElementById('auth-close-btn');

  if (isConfigured) {
    if (noteEl) noteEl.style.display = 'none';
    if (googleBtn) googleBtn.style.display = 'none';
  } else {
    if (noteEl) noteEl.style.display = 'block';
    if (googleBtn) {
      googleBtn.style.display = 'flex';
      googleBtn.onclick = () => {
        if (_onDemoMode) _onDemoMode();
      };
    }
  }

  if (demoBtn) {
    demoBtn.onclick = () => {
      if (_onDemoMode) _onDemoMode();
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      if (_onDemoMode) _onDemoMode();
    };
  }
}

function _loadGSI(clientId) {
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => _initGSI(clientId);
  script.onerror = () => console.warn('GSI script failed to load');
  document.head.appendChild(script);
}

function _initGSI(clientId) {
  if (!window.google || !window.google.accounts) return;

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: _handleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: false,
  });

  const container = document.getElementById('google-signin-btn');
  if (container) {
    window.google.accounts.id.renderButton(container, {
      type: 'standard',
      size: 'large',
      theme: 'filled_black',
      text: 'continue_with',
      shape: 'rectangular',
      width: 320,
    });
  }
}

async function _handleCredentialResponse(response) {
  if (!response.credential) {
    console.error('GSI: No credential in response');
    return;
  }

  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    // Decoding the JWT only gives the landing page a display name.  The API
    // must verify it and set the HttpOnly session cookie used by the protected
    // stakeholder endpoints.
    const login = await api.loginWithGoogle(response.credential);
    if (!login.success) {
      throw new Error(login.error || 'Server rejected Google sign-in');
    }
    _user = {
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      sub: payload.sub,
      authenticated_at: new Date().toISOString(),
      role: login.role,
    };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(_user));
    if (_onAuthSuccess) _onAuthSuccess(_user);
  } catch (e) {
    console.error('GSI: Sign-in failed', e);
    const note = document.getElementById('auth-unconfigured-note');
    if (note) {
      note.textContent = 'Sign-in could not be completed. Use Demo Mode or check the server OAuth configuration.';
      note.style.display = 'block';
    }
  }
}
