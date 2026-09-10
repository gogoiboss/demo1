with open("dashboard/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# 1. Add Accessibility Toggle
nav_toggle = """        <nav class="view-tabs" aria-label="Stakeholder views">"""
new_nav = """        <div class="top-controls" style="display:flex;justify-content:space-between;align-items:center;">
          <nav class="view-tabs" aria-label="Stakeholder views">"""

end_nav = """        </nav>"""
new_end_nav = """        </nav>
          <button id="toggle-contrast" class="icon-button" style="font-size:12px; border:1px solid var(--amber); padding:4px 8px; border-radius:4px; color:var(--amber);">Colorblind Safe Mode</button>
        </div>"""

text = text.replace(nav_toggle, new_nav).replace(end_nav, new_end_nav)

# 2. Add Radio Summary and Urgency to Station Master
sm_old = """              <article class="metric-card">
                <span class="card-label">PREDICTION STATE</span>
                <strong id="station-status" style="font-size:18px;letter-spacing:-.02em">--</strong>
              </article>
            </div>
          </div>
        </section>"""

sm_new = """              <article class="metric-card">
                <span class="card-label">PREDICTION STATE</span>
                <strong id="station-status" style="font-size:18px;letter-spacing:-.02em">--</strong>
              </article>
              <article class="amber-card" style="margin-top:16px;">
                <span class="card-label">RADIO-READY TERSE OUTPUT</span>
                <strong id="station-radio" style="font-family:'IBM Plex Mono'; font-size:14px; color:var(--text);">Loading...</strong>
              </article>
              <article class="quiet-card" style="margin-top:8px;">
                <span class="card-label">COST-ASYMMETRY AWARENESS</span>
                <p>False negatives (predicting on-time when actually late) are operationally penalized harder than false positives. Decision thresholds are skewed to protect downstream capacity.</p>
              </article>
            </div>
          </div>
        </section>"""

text = text.replace(sm_old, sm_new)

with open("dashboard/index.html", "w", encoding="utf-8") as f:
    f.write(text)

with open("dashboard/app.js", "r", encoding="utf-8") as f:
    text = f.read()

sm_js_old = """  $('#station-status').textContent = sm.status;
  $('#station-conflict').textContent = `+${p.conflict_adjustment_min.toFixed(1)} min / AMBER`;"""

sm_js_new = """  $('#station-status').textContent = sm.status;
  $('#station-conflict').textContent = `+${p.conflict_adjustment_min.toFixed(1)} min / AMBER`;
  
  if (sm.radio_summary) {
    $('#station-radio').textContent = `"${sm.radio_summary}"`;
  }"""

text = text.replace(sm_js_old, sm_js_new)

js_toggle = """  $('#train-id').addEventListener('change', loadData);"""
js_toggle_new = """  $('#train-id').addEventListener('change', loadData);
  $('#toggle-contrast').addEventListener('click', () => {
    document.body.classList.toggle('colorblind-safe');
  });"""

text = text.replace(js_toggle, js_toggle_new)

with open("dashboard/app.js", "w", encoding="utf-8") as f:
    f.write(text)

with open("dashboard/styles.css", "a", encoding="utf-8") as f:
    f.write("""

/* Colorblind Safe Mode Overrides */
body.colorblind-safe {
  --teal: #5ea0f0; /* Switch green-ish to clear blue */
  --amber: #f28b4c; /* Switch to distinct orange */
  --red: #d94a4a;
}
body.colorblind-safe .turnaround-bar-fill {
  background: var(--teal);
}
""")

print("Frontend patched with Elite Features.")
