/**
 * app.js — OUTLIERS Continuous Cinematic Journey Orchestrator
 * Faithful to Storyboard Reference Video:
 * 00:00 — Realistic Station Platform & 3D Train
 * 00:03 — Train Hover & "Click the train" prompt
 * 00:05 — Physical Train Acceleration along tracks
 * 00:08 — Scenic Viaduct with Feature Highlights
 * 00:12 — Tunnel Approach & "Almost There" prompt
 * 00:14 — Google Authentication / Demo Mode Modal
 * 00:18 — Tunnel Exit into Morning Sunlight ("You're In!")
 * 00:21 — Seamless Landing Resume with Active Session & Portal Access
 */

import { detectTier, initScene, disposeScene } from './js/scene.js';
import { initAuth, getUser, isAuthenticated, signOut, loginAsDemo } from './js/auth.js';
import { prefersReducedMotion } from './js/animations.js';

const $ = id => document.getElementById(id);

let _tier = 'high';
let _scene = null;
let _reduced = false;
let _journeyStarted = false;

function _updateNavAuthUI(user) {
  const signinBtn = $('btn-nav-signin');
  const userPanel = $('nav-user-panel');
  const userName = $('nav-user-name');
  const userRole = $('nav-user-role');
  const demoBadge = $('nav-demo-badge');

  if (user) {
    if (signinBtn) signinBtn.style.display = 'none';
    if (userPanel) userPanel.style.display = 'flex';
    if (userName) userName.textContent = user.name || user.email || 'User';
    if (userRole) userRole.textContent = (user.role || 'Passenger').replace(/_/g, ' ').toUpperCase();
    if (demoBadge) demoBadge.style.display = user.is_demo ? 'inline-block' : 'none';
  } else {
    if (signinBtn) signinBtn.style.display = 'inline-block';
    if (userPanel) userPanel.style.display = 'none';
  }
}

// ── Boot Sequence ───────────────────────────────────────────────────────────
const boot = async () => {
  try {
    _reduced = prefersReducedMotion();
  } catch {
    _reduced = false;
  }

  try {
    _tier = detectTier();
  } catch {
    _tier = 'low';
  }

  // Initialize the 3D Railway World immediately
  const canvas = $('hero-canvas');
  if (canvas && _tier !== 'none') {
    try {
      _scene = initScene(canvas, _tier, () => _startJourney());
    } catch (err) {
      console.warn('Three.js initialization failed, falling back to 2.5D mode:', err);
      document.body.classList.add('no-webgl');
    }
  } else {
    document.body.classList.add('no-webgl');
  }

  _wireLandingInteractions();
  _startBoardClock();

  // Capture any returnTo URL parameter and persist in sessionStorage
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const returnToParam = urlParams.get('returnTo');
    if (returnToParam) {
      sessionStorage.setItem('rippleeta_auth_return_to', returnToParam);
    }
  } catch (err) {
    console.warn('[RippleETA] Could not sync returnTo param:', err);
  }

  // Initialize and restore auth state
  try {
    const user = await initAuth(
      u => _onAuthSuccess(u),
      u => _updateNavAuthUI(u)
    );
    _updateNavAuthUI(user);
  } catch (err) {
    console.warn('Auth initialization warning:', err);
  }
};

// The departure-board time is intentionally a live, small detail—not a
// dashboard counter. It makes the entry screen feel like a real platform.
function _startBoardClock() {
  const clock = $('board-clock');
  if (!clock) return;
  const update = () => {
    clock.textContent = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date()) + ' IST';
  };
  update();
  window.setInterval(update, 1000);
}

function _wireLandingInteractions() {
  // Train search button click
  const startBtn = $('btn-start-journey');
  if (startBtn) {
    startBtn.onclick = () => _startJourney();
  }

  // Enter key on train number input
  const trainInput = $('train-number-input');
  if (trainInput) {
    trainInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') _startJourney();
    });
  }

  // Top nav Sign In button
  const navSignIn = $('btn-nav-signin');
  if (navSignIn) {
    navSignIn.onclick = () => _showAuthModal();
  }

  // Top nav Sign Out button
  const navSignOut = $('btn-nav-signout');
  if (navSignOut) {
    navSignOut.onclick = async () => {
      await signOut();
      _updateNavAuthUI(null);
    };
  }

  // Modal close button
  const closeBtn = $('auth-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => _closeAuthModal();
  }
}

// ── Cinematic Storyboard Journey Flow ───────────────────────────────────────
async function _startJourney() {
  if (_journeyStarted) return;
  _journeyStarted = true;

  const gsap = window.gsap;

  // Fade out station hero overlay & nav (00:03)
  const stationHero = $('station-hero');
  const nav = $('landing-navbar');
  if (gsap) {
    gsap.to(stationHero, { opacity: 0, y: -20, duration: 0.8, onComplete: () => { stationHero.style.display = 'none'; } });
    gsap.to(nav, { opacity: 0, duration: 0.6, onComplete: () => { nav.style.display = 'none'; } });
  } else {
    stationHero.style.display = 'none';
    nav.style.display = 'none';
  }

  // Trigger physical train movement and camera flow
  if (_scene && _scene.startJourney) {
    _scene.startJourney(milestone => {
      if (milestone === 'viaduct') {
        _showViaductOverlays();
      } else if (milestone === 'tunnel') {
        _showTunnelApproachAndAuth();
      }
    });
  } else {
    // Fallback if 3D scene unavailable
    _showViaductOverlays();
    setTimeout(() => _showTunnelApproachAndAuth(), 3500);
  }
}

// 00:05–00:10 Storyboard: Viaduct Overlays
function _showViaductOverlays() {
  const overlay = $('viaduct-journey-overlay');
  if (!overlay) return;
  overlay.style.display = 'block';

  const gsap = window.gsap;
  if (gsap && !_reduced) {
    gsap.to(overlay, { opacity: 1, duration: 1.0, ease: 'power2.out' });

    // Animate script storytelling lines sequentially
    const s1 = $('script-step-1');
    const s2 = $('script-step-2');
    const s3 = $('script-step-3');

    gsap.fromTo(s1, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.8, delay: 0.5 });
    gsap.fromTo(s2, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.8, delay: 1.8 });
    gsap.fromTo(s3, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.8, delay: 3.1 });

    // Animate 3 feature cards on right
    const cards = document.querySelectorAll('.viaduct-feature-cards .feature-card');
    cards.forEach((card, idx) => {
      gsap.fromTo(card, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.6, delay: 0.8 + idx * 0.4 });
    });
  } else {
    overlay.style.opacity = '1';
  }
}

// 00:11–00:14 Storyboard: Tunnel Approach & Authentication
function _showTunnelApproachAndAuth() {
  const approachCard = $('tunnel-approach-card');
  const viaductOverlay = $('viaduct-journey-overlay');

  const gsap = window.gsap;
  if (viaductOverlay && gsap) {
    gsap.to(viaductOverlay, { opacity: 0, duration: 0.8, onComplete: () => { viaductOverlay.style.display = 'none'; } });
  }

  // If already authenticated, continue directly through tunnel into sunlight
  if (isAuthenticated()) {
    if (approachCard) {
      approachCard.style.display = 'block';
      if (gsap) {
        gsap.fromTo(approachCard, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' });
        setTimeout(() => {
          gsap.to(approachCard, { opacity: 0, duration: 0.5, onComplete: () => {
            approachCard.style.display = 'none';
            _showSunlightExitAndTransition();
          }});
        }, 1200);
      } else {
        approachCard.style.opacity = '1';
        setTimeout(() => {
          approachCard.style.display = 'none';
          _showSunlightExitAndTransition();
        }, 1000);
      }
    } else {
      _showSunlightExitAndTransition();
    }
    return;
  }

  // Otherwise, present tunnel approach card before opening auth modal
  if (approachCard) {
    approachCard.style.display = 'block';
    if (gsap) {
      gsap.fromTo(approachCard, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' });
      setTimeout(() => {
        gsap.to(approachCard, { opacity: 0, duration: 0.5, onComplete: () => { approachCard.style.display = 'none'; } });
        _showAuthModal();
      }, 1800);
    } else {
      approachCard.style.opacity = '1';
      setTimeout(() => {
        approachCard.style.display = 'none';
        _showAuthModal();
      }, 1500);
    }
  } else {
    _showAuthModal();
  }
}

// 00:14 Storyboard: Authentication Modal
async function _showAuthModal() {
  const authWrapper = $('auth-modal-wrapper');
  if (!authWrapper) return;
  authWrapper.style.display = 'flex';

  const gsap = window.gsap;
  if (gsap) {
    gsap.to(authWrapper, { opacity: 1, duration: 0.6 });
  } else {
    authWrapper.style.opacity = '1';
  }

  const closeBtn = $('auth-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => _closeAuthModal();
  }
}

function _closeAuthModal() {
  const authWrapper = $('auth-modal-wrapper');
  if (!authWrapper) return;
  const gsap = window.gsap;
  if (gsap) {
    gsap.to(authWrapper, { opacity: 0, duration: 0.4, onComplete: () => { authWrapper.style.display = 'none'; } });
  } else {
    authWrapper.style.display = 'none';
  }

  // Restore navigation bar and hero if journey had not progressed
  const nav = $('landing-navbar');
  if (nav && nav.style.display === 'none') {
    nav.style.display = 'flex';
    if (gsap) gsap.to(nav, { opacity: 1, duration: 0.5 });
    else nav.style.opacity = '1';
  }
}

export function getSafeReturnUrl(rawUrl) {
  const DEFAULT_DESTINATION = '/dashboard/';
  if (!rawUrl || typeof rawUrl !== 'string') {
    return DEFAULT_DESTINATION;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return DEFAULT_DESTINATION;
  }

  // Reject protocol-relative URLs (//evil.com) and any URI with an explicit scheme (https:, http:, javascript:, data:, etc.)
  if (trimmed.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return DEFAULT_DESTINATION;
  }

  try {
    const base = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const parsed = new URL(trimmed, base);

    // Ensure origin matches exactly
    if (parsed.origin !== base) {
      return DEFAULT_DESTINATION;
    }

    let pathname = parsed.pathname;
    if (!pathname.startsWith('/dashboard/')) {
      if (pathname.startsWith('/')) {
        pathname = '/dashboard' + pathname;
      } else {
        pathname = '/dashboard/' + pathname;
      }
    }

    // Whitelist allowed stakeholder dashboard pages
    const ALLOWED_PAGES = /^\/dashboard\/(index|passenger|station-master|crew|feeder|maintenance|control|sandbox)$/;
    if (!ALLOWED_PAGES.test(pathname)) {
      return DEFAULT_DESTINATION;
    }

    return pathname + parsed.search + parsed.hash;
  } catch {
    return DEFAULT_DESTINATION;
  }
}

function _getResolvedReturnUrl() {
  let candidate = null;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    candidate = urlParams.get('returnTo');
    if (!candidate) {
      candidate = sessionStorage.getItem('rippleeta_auth_return_to');
    }
  } catch {
    candidate = null;
  }
  return getSafeReturnUrl(candidate);
}

let _isNavigatingToDashboard = false;
function _navigateToDashboard() {
  if (_isNavigatingToDashboard) return;
  _isNavigatingToDashboard = true;
  const destination = _getResolvedReturnUrl();
  try {
    sessionStorage.removeItem('rippleeta_auth_return_to');
  } catch { /* ignore storage clear errors */ }

  const overlay = $('eta-transition-overlay');
  if (overlay && window.gsap && !_reduced) {
    window.gsap.to(overlay, {
      opacity: 0,
      duration: 0.5,
      ease: 'power2.inOut',
      onComplete: () => {
        window.location.href = destination;
      }
    });
  } else {
    window.location.href = destination;
  }
}

// Global hook for ETA completion from child iframe
window.onETAComplete = function() {
  console.log('[RippleETA] Received ETA complete callback');
  _navigateToDashboard();
};

window.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'ETA_ANIMATION_COMPLETE') {
    console.log('[RippleETA] Received ETA_ANIMATION_COMPLETE message');
    _navigateToDashboard();
  }
});

function _onAuthSuccess(user) {
  _updateNavAuthUI(user);
  _startETATransitionSequence(user);
}

function _onDemoMode() {
  const user = getUser();
  _updateNavAuthUI(user);
  _startETATransitionSequence(user);
}

// Cinematic sequence: Auth modal close -> Sunlight burst -> ETA Second 3D Experience -> Dashboard
async function _startETATransitionSequence(user) {
  _closeAuthModal();

  // If reduced motion requested, navigate directly
  if (_reduced) {
    _navigateToDashboard();
    return;
  }

  // Sunlight burst in first 3D scene
  if (_scene && _scene.setSunlightMode) {
    _scene.setSunlightMode(true);
  }

  const youreIn = $('youre-in-overlay');
  if (youreIn) {
    youreIn.style.display = 'flex';
    const gsap = window.gsap;
    if (gsap) {
      await new Promise(resolve => {
        gsap.timeline({ onComplete: resolve })
          .fromTo(youreIn, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.5)' })
          .to(youreIn, { opacity: 0, scale: 1.05, duration: 0.4, delay: 0.8, ease: 'power2.in' });
      });
    } else {
      youreIn.style.opacity = '1';
      await new Promise(r => setTimeout(r, 700));
      youreIn.style.opacity = '0';
    }
    youreIn.style.display = 'none';
  }

  // Launch ETA Second 3D Experience inside overlay
  const overlay = $('eta-transition-overlay');
  const frame = $('eta-frame');
  const directSkip = $('eta-direct-skip');

  if (directSkip) {
    directSkip.onclick = () => {
      console.log('[RippleETA] Skip to Dashboard clicked');
      _navigateToDashboard();
    };
  }

  if (overlay && frame) {
    overlay.style.display = 'block';
    const returnTarget = _getResolvedReturnUrl();
    frame.src = '/?mode=transition&returnTo=' + encodeURIComponent(returnTarget);

    if (window.gsap) {
      window.gsap.to(overlay, { opacity: 1, duration: 0.6, ease: 'power2.out' });
    } else {
      overlay.style.opacity = '1';
    }

    // Safety timeout: guaranteed transition after 12s even if frame load hangs
    setTimeout(() => {
      if (!_isNavigatingToDashboard) {
        console.warn('[RippleETA] ETA safety timer elapsed (12s) — navigating to dashboard');
        _navigateToDashboard();
      }
    }, 12000);
  } else {
    _navigateToDashboard();
  }
}

// 00:21 Storyboard: Same 3D experience resumes with authenticated nav and intentional portal access
function _resumeLandingWithAuthenticatedState() {
  const user = getUser();
  _updateNavAuthUI(user);

  const dashLink = $('nav-dashboard-link');
  if (dashLink) {
    dashLink.href = _getResolvedReturnUrl();
  }

  const gsap = window.gsap;

  // Restore the navbar with the user info and "Portals ↗" button
  const nav = $('landing-navbar');
  if (nav) {
    nav.style.display = 'flex';
    if (gsap) {
      gsap.fromTo(nav, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
    } else {
      nav.style.opacity = '1';
    }
  }

  // Restore station hero editorial content with updated authenticated CTA
  const stationHero = $('station-hero');
  if (stationHero) {
    stationHero.style.display = 'flex';
    if (gsap) {
      gsap.fromTo(stationHero, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
    } else {
      stationHero.style.opacity = '1';
    }
  }
}

// ── DOM Ready Boot ──────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
