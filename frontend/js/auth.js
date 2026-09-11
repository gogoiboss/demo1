/**
 * auth.js - Authentication State & Session Manager for RippleETA
 * Handles Google Sign-In, explicit Demo Personas, session restoration, and persistence.
 */
import { api } from './api.js';

const AUTH_STORAGE_KEY = 'rippleeta_user';

let _config = null;
let _user = null;
let _onAuthSuccess = null;
let _onAuthChange = null;

export async function initAuth(onAuthSuccess, onAuthChange = null) {
  _onAuthSuccess = onAuthSuccess;
  _onAuthChange = onAuthChange;

  // 1. Try restoring persisted session
  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) {
    try {
      _user = JSON.parse(stored);
    } catch {
      _user = null;
    }
  }

  // 2. Validate session against backend /api/me
  try {
    const me = await api.getMe();
    if (me && me.authenticated) {
      _user = {
        name: me.name,
        email: me.email,
        role: me.role,
        is_demo: Boolean(me.is_demo),
        authenticated_at: _user?.authenticated_at || new Date().toISOString(),
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(_user));
      if (_onAuthChange) _onAuthChange(_user);
    }
  } catch (err) {
    // If 401 or invalid, clear stale credentials
    if (err.status === 401) {
      _user = null;
      localStorage.removeItem(AUTH_STORAGE_KEY);
      api.setToken(null);
      if (_onAuthChange) _onAuthChange(null);
    }
  }

  // 3. Fetch backend auth configuration (Google OAuth availability)
  try {
    _config = await api.getAuthConfig();
  } catch {
    _config = { auth_configured: false };
  }

  // 4. Configure modal UI
  _setupAuthModal();

  // 5. Load Google GSI script if configured with real client id
  if (_config && _config.auth_configured && _config.google_client_id) {
    _loadGSI(_config.google_client_id);
  }

  return _user;
}

export function getUser() {
  return _user;
}

export function isAuthenticated() {
  return _user !== null;
}

export async function signOut() {
  try {
    await api.logout();
  } catch (err) {
    console.warn('Logout API error:', err);
  } finally {
    _user = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    api.setToken(null);
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    if (_onAuthChange) _onAuthChange(null);
  }
}

export async function loginAsDemo(role = 'passenger', email = null) {
  try {
    // Backend DemoLoginRequest requires a non-null string for `email`.
    // When no real email is supplied (unauthenticated demo mode), synthesise a
    // deterministic placeholder so Pydantic validation never sees null/undefined.
    const demoEmail = email || `demo-${(role || 'passenger').toLowerCase().replace(/\s+/g, '_')}@rippleeta.demo`;
    const res = await api.loginDemo(demoEmail, role);
    if (!res.success) {
      throw new Error(res.error || 'Demo login failed');
    }
    // Backend returns {success, role} — no nested `user` object.
    const resolvedRole = res.role || role || 'passenger';
    _user = {
      name: `Demo ${resolvedRole.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
      email: demoEmail,
      role: resolvedRole,
      is_demo: true,
      authenticated_at: new Date().toISOString(),
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(_user));
    if (_onAuthChange) _onAuthChange(_user);
    if (_onAuthSuccess) _onAuthSuccess(_user);
    return _user;
  } catch (err) {
    console.error('Demo login error:', err);
    throw err;
  }
}

function _setupAuthModal() {
  const isConfigured = _config && _config.auth_configured;
  const noteEl = document.getElementById('auth-unconfigured-note');
  const googleBtn = document.getElementById('btn-google-fallback');
  const demoBtn = document.getElementById('btn-demo-mode');
  const roleSelect = document.getElementById('demo-role-select');

  if (isConfigured) {
    if (noteEl) noteEl.style.display = 'none';
    if (googleBtn) googleBtn.style.display = 'none';
  } else {
    if (noteEl) noteEl.style.display = 'block';
    if (googleBtn) {
      googleBtn.style.display = 'flex';
      googleBtn.onclick = () => {
        // When Google OAuth is unconfigured on the server, offer demo mode gracefully
        const role = roleSelect?.value || 'passenger';
        loginAsDemo(role);
      };
    }
  }

  function showAuthError(msg) {
    const banner = document.getElementById('auth-error-banner');
    const text = document.getElementById('auth-error-text');
    const cleanMsg = typeof msg === 'string' ? msg : (msg?.message || 'Authentication failed. Please try again.');
    if (banner && text) {
      text.textContent = cleanMsg;
      banner.style.display = 'block';
    } else {
      alert(cleanMsg);
    }
  }

  function clearAuthError() {
    const banner = document.getElementById('auth-error-banner');
    if (banner) banner.style.display = 'none';
  }

  if (demoBtn) {
    demoBtn.onclick = async () => {
      clearAuthError();
      const role = roleSelect?.value || 'passenger';
      try {
        await loginAsDemo(role);
      } catch (e) {
        showAuthError(e.message || 'Demo login failed. Please try again.');
      }
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
  if (!window.google?.accounts) return;

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
    const res = await api.loginWithGoogle(response.credential);
    if (!res.success) {
      throw new Error(res.error || 'Server rejected Google sign-in');
    }
    // Backend returns {success, role} — resolve user fields defensively.
    _user = {
      name: (res.user && res.user.name) || res.name || res.email || 'Authenticated User',
      email: (res.user && res.user.email) || res.email || '',
      role: (res.user && res.user.role) || res.role || 'passenger',
      is_demo: false,
      authenticated_at: new Date().toISOString(),
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(_user));
    if (_onAuthChange) _onAuthChange(_user);
    if (_onAuthSuccess) _onAuthSuccess(_user);
  } catch (e) {
    console.error('GSI: Sign-in failed', e);
    const note = document.getElementById('auth-unconfigured-note');
    if (note) {
      note.textContent = 'Sign-in could not be completed. Use Demo Mode or check server configuration.';
      note.style.display = 'block';
    }
  }
}
