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
 * 00:21 — Executive Operational Dashboard
 */

import { detectTier, initScene, disposeScene } from './js/scene.js';
import { initAuth, getUser } from './js/auth.js';
import { initDashboard } from './js/dashboard.js';
import { prefersReducedMotion } from './js/animations.js';

const $ = id => document.getElementById(id);

let _tier = 'high';
let _scene = null;
let _reduced = false;
let _journeyStarted = false;

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

// 00:14 Storyboard: Google Authentication Modal
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

  // Wire close button
  const closeBtn = $('auth-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      _proceedToDashboard();
    };
  }

  // Wire Google Sign-In & Demo Mode
  await initAuth(
    user => { _onAuthSuccess(user); },
    () => { _onDemoMode(); }
  );

  const demoBtn = $('btn-demo-mode');
  if (demoBtn) {
    demoBtn.onclick = () => _onDemoMode();
  }

  const fallbackGoogle = $('btn-google-fallback');
  if (fallbackGoogle) {
    fallbackGoogle.onclick = () => _onDemoMode();
  }
}

function _onAuthSuccess(user) {
  _showSunlightExitAndTransition();
}

function _onDemoMode() {
  _showSunlightExitAndTransition();
}

// 00:18 Storyboard: Tunnel Exit Sunlight Burst ("You're In!")
async function _showSunlightExitAndTransition() {
  const authWrapper = $('auth-modal-wrapper');
  if (authWrapper) {
    if (window.gsap) {
      window.gsap.to(authWrapper, { opacity: 0, duration: 0.4, onComplete: () => { authWrapper.style.display = 'none'; } });
    } else {
      authWrapper.style.display = 'none';
    }
  }

  // Sunlight floods the scene as train exits tunnel
  if (_scene && _scene.setSunlightMode) {
    _scene.setSunlightMode(true);
  }

  const youreIn = $('youre-in-overlay');
  if (youreIn) {
    youreIn.style.display = 'flex';
    const gsap = window.gsap;
    if (gsap && !_reduced) {
      await new Promise(resolve => {
        gsap.timeline({ onComplete: resolve })
          .fromTo(youreIn, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.5)' })
          .to(youreIn, { opacity: 0, scale: 1.05, duration: 0.5, delay: 1.4, ease: 'power2.in' });
      });
    } else {
      youreIn.style.opacity = '1';
      await new Promise(r => setTimeout(r, 1600));
      youreIn.style.opacity = '0';
    }
    youreIn.style.display = 'none';
  }

  _proceedToDashboard();
}

// 00:21 Storyboard: Executive Operational Dashboard
function _proceedToDashboard() {
  // Hard redirect to the actual ML dashboard built in rippleeta
  window.location.href = '/dashboard/index.html';
}

// ── DOM Ready Boot ──────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
