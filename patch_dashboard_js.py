with open("dashboard/app.js", "r", encoding="utf-8") as f:
    text = f.read()

js_code = """
async function fetchSystemMode() {
  try {
    const res = await fetch('/system/mode');
    if (!res.ok) return;
    const data = await res.json();
    const badge = $('#mode-badge');
    if (badge) {
      badge.style.display = 'inline-block';
      if (data.mode === 'REPLAY') {
        badge.textContent = 'REPLAY MODE - recorded data';
        badge.style.background = '#eab308'; // yellow-500
        badge.style.color = '#000';
      } else {
        badge.textContent = 'LIVE MODE';
        badge.style.background = '#22c55e'; // green-500
        badge.style.color = '#fff';
      }
    }
  } catch (err) {
    console.error('Failed to fetch system mode', err);
  }
}
"""

if 'fetchSystemMode' not in text:
    text = js_code + "\n" + text
    text = text.replace('initTabs();', 'initTabs();\n  fetchSystemMode();')

with open("dashboard/app.js", "w", encoding="utf-8") as f:
    f.write(text)
