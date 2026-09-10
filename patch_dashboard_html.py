with open("dashboard/index.html", "r", encoding="utf-8") as f:
    text = f.read()

badge_html = '<span id="mode-badge" style="margin-left: 1rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: bold; background: var(--warning); color: #000; display: none;"></span>'

if 'id="mode-badge"' not in text:
    text = text.replace('<span><strong>RippleETA</strong><small>NETWORK-AWARE ETA CONTROL</small></span>', '<span><strong>RippleETA</strong><small>NETWORK-AWARE ETA CONTROL</small></span>\n' + badge_html)

with open("dashboard/index.html", "w", encoding="utf-8") as f:
    f.write(text)
