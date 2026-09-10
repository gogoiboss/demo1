with open("../outliers-frontend/app.js", "r", encoding="utf-8") as f:
    text = f.read()

old_proceed = """function _proceedToDashboard() {
  // Hide canvas so dashboard is full interactive surface
  const canvas = $('hero-canvas');
  if (canvas && window.gsap) {
    window.gsap.to(canvas, { opacity: 0, duration: 1.5, onComplete: () => { canvas.style.display = 'none'; disposeScene(); } });
  }

  const mainDash = $('main-dashboard');
  if (mainDash) {
    mainDash.style.display = 'flex';
    if (window.gsap) {
      window.gsap.to(mainDash, { opacity: 1, duration: 1 });
    } else {
      mainDash.style.opacity = 1;
    }
  }

  // Initialize operational dashboard functionality (all 8 tabs, prediction engine, timeline)
  initDashboard();
}"""

new_proceed = """function _proceedToDashboard() {
  // Redirect to the real RippleETA Operational Dashboard
  window.location.href = '/dashboard/index.html';
}"""

text = text.replace(old_proceed, new_proceed)

with open("../outliers-frontend/app.js", "w", encoding="utf-8") as f:
    f.write(text)

print("Patched app.js to redirect to RippleETA dashboard.")
