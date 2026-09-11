/** animations.js - GSAP helpers for OUTLIERS cinematic UI */

export function fadeUpIn(el, delay=0, duration=0.8) {
  if (!el) return;
  const g = window.gsap;
  if (!g) { el.style.opacity = '1'; return; }
  g.fromTo(el, { opacity:0, y:30 }, { opacity:1, y:0, duration, delay, ease:'power3.out' });
}

export function fadeIn(el, delay=0, duration=0.6) {
  if (!el) return;
  const g = window.gsap;
  if (!g) { el.style.opacity = '1'; return; }
  g.fromTo(el, { opacity:0 }, { opacity:1, duration, delay, ease:'power2.out' });
}

export function fadeOut(el, delay=0, duration=0.4, onComplete) {
  if (!el) { if (onComplete) onComplete(); return; }
  const g = window.gsap;
  if (!g) { el.style.opacity = '0'; if (onComplete) onComplete(); return; }
  g.to(el, { opacity:0, duration, delay, ease:'power2.in', onComplete });
}

export function counterUp(el, start, end, suffix='', duration=1.5, delay=0) {
  if (!el) return;
  const g = window.gsap;
  if (!g) { el.textContent = end + suffix; return; }
  const obj = { v:start };
  g.to(obj, { v:end, duration, delay, ease:'power2.out',
    onUpdate() { el.textContent = Math.round(obj.v) + suffix; } });
}

export function glowPulse(el, color='#38bdf8', duration=2) {
  if (!el || !window.gsap) return;
  window.gsap.to(el, {
    boxShadow: '0 0 24px ' + color + ', 0 0 48px ' + color + '40',
    duration, repeat:-1, yoyo:true, ease:'sine.inOut'
  });
}

export function staggerFadeUp(els, stagger=0.12, delay=0) {
  if (!els || !els.length || !window.gsap) return;
  window.gsap.fromTo(els, { opacity:0, y:24 },
    { opacity:1, y:0, stagger, delay, duration:0.7, ease:'power3.out' });
}

export function typewriter(el, text, speed=40) {
  if (!el) return Promise.resolve();
  return new Promise(resolve => {
    el.textContent = '';
    let i = 0;
    const timer = setInterval(() => {
      el.textContent += text[i++];
      if (i >= text.length) { clearInterval(timer); resolve(); }
    }, speed);
  });
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
