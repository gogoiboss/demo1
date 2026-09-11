# RippleETA — Full Audit Report

_Audit date: 2026-09-11. Solo session, no push/pull. Checkpoint commits made locally per part._

---

## 0. Scope inventory

**Repo root for this audit:** `E:\Hackathon 2026\SIH\rippleeta` (the outer `E:\Hackathon 2026\SIH` is not itself a git repo — `rippleeta/` is the actual project and the only git repository).

**Git state at audit start:** branch `main`, 1 commit ahead of `origin/main`, working tree clean. The most recent commit, `998be4b — "feat: Integrate remote repo UI, 3D viewer (/eta), dark dropdown styling, and universal EN/HI/MR language switcher"`, is the teammate's newly-arrived frontend work referenced in this audit's brief. It touched 42 files, +27,525/-5,563 lines, and:

- Rewrote most of `dashboard/*.html`, `dashboard/app.js`, `dashboard/styles.css` (all pre-existing files, dashboard/ already existed from commits `689190c`…`be495c4`, but this commit is a near-total rewrite of every page).
- Rewrote `frontend/app.js`, `frontend/index.html`, `frontend/js/api.js`, `frontend/js/auth.js`, `frontend/style.css` (frontend/ also pre-existing).
- Added a brand-new `eta/` directory: a standalone Three.js-based 3D train viewer (`eta/index.html`, `eta/three.min.js` vendored, `eta/GLTFLoader.js` vendored, `eta/wap7.glb` model + textures). This is entirely new, not a rewrite of anything pre-existing.
- Added `frontend/js/animations.js`, `frontend/js/dashboard.js`, `frontend/js/scene.js`, `frontend/js/tunnel.js` — also new.
- Added video/poster assets to both `frontend/video/` and `dashboard/video/`.

**Duplication confirmed:** `frontend/` and `dashboard/` are two separate, independently-maintained implementations that both claim to serve dashboard views. `frontend/index.html` is a single-page app with its own role switcher and its own login flow (`frontend/js/auth.js`); `dashboard/` is a multi-page-per-role app (`passenger.html`, `station-master.html`, `crew.html`, `feeder.html`, `maintenance.html`, `control.html`, `sandbox.html`, plus `index.html` as a hub) with login handled in `dashboard/app.js`. This is a real product-ownership question, not just a naming coincidence — see Part 5.

**File inventory:**

| Area | Files | Lines (approx) |
|---|---|---|
| `src/` (backend) | 24 `.py` files across `api/`, `calibration/`, `evaluation/`, `features/`, `graph/`, `ingestion/`, `models/`, plus `pipeline.py`, `model_promotion.py`, `reproducibility.py`, `validation.py` | — |
| `tests/` | 21 test files | — |
| `eval/`, `jobs/`, `scripts/` | 6 files (backtest harness, baseline comparison, comprehensive evaluation, SHAP generation, nightly recalibration, scalability benchmark, DB seeding) | — |
| `frontend/` | `index.html`, `app.js`, `style.css`, `js/{api,auth,animations,dashboard,scene,tunnel}.js` | 1,736 + 521 + 4,011 + 3,930 = ~10,200 |
| `dashboard/` | `index.html` + 7 stakeholder pages, `app.js`, `sandbox.js`, `styles.css` | ~19,700 |
| `eta/` (new) | `index.html`, vendored `three.min.js`, `GLTFLoader.js`, GLTF/GLB model assets | new, unaudited before this pass |
| `docs/` | `ARCHITECTURE_AND_INTELLIGENCE.md`, `DESIGN_SYSTEM.md`, `FEATURE_STATUS.md`, `LIMITATIONS.md`, `PAGE_ARCHITECTURE.md`, `FRONTEND_PAGES_FEATURES.md`, `RESULTS.md`, `DEMO_SCRIPT.md`, `api_notes.md`, `dashboard_notes.md`, `data_notes.md`, plus `judge_prep/`, `research/`, `assets/` subfolders | pre-existing docs this audit cross-references |
| Root-level `.md` | `PROGRESS.md`, `README.md`, `ROUND2_READINESS.md` | pre-existing |

There is also a large collection of one-off `patch_*.py` / `fix_*.py` / `force_patch.py` scripts at the repo root (18 files, e.g. `patch_backend.py`, `patch_dashboard_html.py`, `patch_railradar.py`, `fix_unicode.py`) — these read as scratch scripts used during earlier live-patching sessions rather than part of the maintained pipeline. Flagged for Part 3 (dead code / repo hygiene) rather than resolved here.

This inventory sets the scope for Parts 1–6 below.

---

## 1. Backend security findings (Critical / Important / Minor)

Tooling: `pip-audit` (against `requirements.txt`) and `bandit -r src/`, both already present in `.venv`. Environment: Python 3.12.10, Windows.

### Dependency scan

- **`pip-audit -r requirements.txt`: No known vulnerabilities found.** Clean.
- **Unpinned dependencies — Minor, but a real recurrence-risk finding.** Every line in `requirements.txt` uses `>=` with no upper bound (`xgboost>=2.0.0`, `fastapi>=0.103.0`, `pandas>=2.0.0`, `scikit-learn>=1.3.0`, `mapie>=0.8.0`, `shap>=0.44.0`, etc. — 19 packages, all loose). This is exactly the "resolves differently later" pattern already fixed once for the lint tool (`pyproject.toml` now pins Ruff's rule surface explicitly, with a comment explaining why — see the `[tool.ruff.lint]` block). The same risk exists here at the dependency level: a fresh `pip install -r requirements.txt` next month can silently pick up a new major `xgboost` or `scikit-learn` release with breaking API or numeric-behavior changes, which is a training-serving-skew risk for a project that has already had one such bug. **Why this matters:** a judge or teammate re-running `pip install` on demo day could get a different model behavior than what was tested. **Not fixed here** — pinning exact versions is a judgment call (it requires deciding a lockfile strategy: `pip freeze` snapshot vs. `pip-compile` vs. leaving ranges) and is flagged for a follow-up rather than silently rewritten.
- **`pip list --outdated`** (against the installed `.venv`, not the requirements ranges): only 3 packages have newer releases available — `protobuf` (6.33.6 → 7.36.1), `pydantic_core` (2.46.5 → 2.49.0), `PyJWT` (2.13.0 → 2.14.0). None flagged by `pip-audit` as vulnerable; routine minor-version drift only.

### Static security scan (`bandit -r src/`)

9 findings total: 8 LOW, 1 MEDIUM. Own assessment below — none are real exploitable issues in this codebase:

| Severity | Test | Location | Assessment |
|---|---|---|---|
| MEDIUM | B608 (SQL injection vector) | `src/ingestion/railradar_client.py:145` | **False positive.** `c.execute(f"SELECT data FROM {table} WHERE train_number=?", (train_number,))` — the f-string only interpolates `table`, which is assigned two lines earlier via `table = "live_status" if parts[1] == "live" else "route"`, i.e. it can only ever be one of two hardcoded literals regardless of input. `train_number`, the actual untrusted value, is passed through the parameterized `?` placeholder correctly. Not exploitable. |
| LOW×3 | B101 (`assert` used) | `src/calibration/conformal.py:412`, `src/pipeline.py:85`, `src/pipeline.py:172` | Real but low-stakes: `assert` statements are stripped under `python -O`. None of these guard a security boundary (they check internal invariants like array shape/ordering), so the risk is a silently-skipped internal sanity check under optimized bytecode, not a security hole. No fix applied — converting to explicit `raise` would be a behavior-preserving cleanup, noted for Part 3 but not security-critical. |
| LOW×2 | B110 (`try/except/pass`) | `src/ingestion/load_kaggle.py:70`, `src/ingestion/railradar_client.py:37` | Real code-quality smell (silently swallowed exceptions), not a security issue on its own — both are in data-ingestion fallback paths. Cross-referenced in Part 3. |
| LOW×3 | B404/B607/B603 (subprocess usage) | `src/reproducibility.py:6,20` | `subprocess` is used to shell out to `git` for commit-hash capture (reproducibility metadata), not on any user-controllable input. Not exploitable — flagged by bandit purely because `subprocess` is imported at all. |

**No Critical or Important findings from bandit.**

### Secrets re-verification

- **JWT secret fix confirmed still correct** (`src/api/auth.py:19`): `JWT_SECRET = os.environ.get('JWT_SECRET') or secrets.token_hex(32)`. No hardcoded fallback string — falls back to a freshly random secret generated at process start if the env var is unset, with an explanatory comment in the source. This matches the fix described from an earlier session and has not regressed. `.env.example` correctly documents `JWT_SECRET` as a value to set, with no real secret committed.
- **Broad secret-shaped-string grep** (`grep -rniE "(api_key|secret|password|token)\s*=\s*['\"][a-zA-Z0-9]{8,}" src/`): **no matches.** No other hardcoded secret-shaped strings anywhere in `src/`.
- **`GOOGLE_CLIENT_ID`** is read from env (`os.getenv("GOOGLE_CLIENT_ID")`, `src/api/app.py:340` and `src/api/auth.py:21`) and only exposed to the client via `/api/auth/config` when actually configured — this is the intended behavior since the Google OAuth Client ID is meant to be public (see Part 2 for the client-side half of this check).

### CORS

`src/api/app.py:92-101`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```
**Not wide open.** `allow_origins` is an explicit local-development allowlist (the FastAPI app's own port 8000, plus 5500 which is the VS Code Live Server default — used when a dashboard is served separately from the API). No wildcard `"*"`. `allow_credentials=True` combined with an explicit origin list (not a wildcard) is the correct, safe pairing — FastAPI/Starlette would actually reject `allow_credentials=True` with a wildcard origin. Appropriate for local/demo deployment; would need updating (not hardening — it would need the production origin added) if actually deployed to a public host. No finding.

### SQL injection

Checked every `.execute(`/`.executemany(` call against `predictions_history.db` (`src/api/app.py:66,70,209-220,230-256,399`) and the replay fixture DB (`src/ingestion/railradar_client.py:145`). **All parameterized with `?` placeholders — no string-concatenated or f-string-interpolated *values* anywhere** (the one f-string-interpolated *identifier*, the table name in `railradar_client.py`, is restricted to two hardcoded literals as covered above). No SQL injection vector.

### Rate limiting

**Confirmed finding: no rate limiting anywhere in the API.** The only rate-limiting code in the repo is `_RateLimiter` in `src/ingestion/railradar_client.py:96-107`, which throttles *outbound* calls this service makes to the external RailRadar API — it has nothing to do with protecting `/predict/{train_id}` or any other endpoint from being hammered by a client. No `slowapi`, no dependency-based throttling, no request-count tracking on the FastAPI side. **Severity: Important for a real deployment, Minor for this hackathon demo context** (single-machine local demo, not internet-exposed) — noted as a genuine gap, not fixed here since adding rate limiting is a design decision (per-IP? per-session? what limit?) rather than a mechanical fix.

### Logging

`grep -rn "logger\.\(info\|debug\|error\)" src/api/ src/pipeline.py` — 6 call sites, all in `src/pipeline.py` (config path, row counts, feature counts, calibration stage name, versioned artifact identifier, train ID + graph status). **None log secrets, tokens, or full request/response bodies.** No finding.

### Exception leakage

- Confirmed FastAPI is constructed as `FastAPI(title=..., description=..., version="1.0.0")` with **no `debug=True`** anywhere in `src/api/app.py`, and no custom exception handler that would echo tracebacks. Starlette's default `ServerErrorMiddleware` only returns tracebacks when the app is explicitly constructed with `debug=True`; the default here is the safe one — an unhandled exception returns a generic 500 with no stack trace to the client. Verified by reading the actual constructor call, not assumed.
- **One real (Minor) finding:** `google_login` (`src/api/app.py:348-369`) has `except Exception as e: return {"success": False, "error": str(e)}`. This deliberately returns the raw exception message (not a stack trace, but internal error text — e.g. whatever `google-auth`'s token-verification library raises) to the client in a `200 OK` response, rather than a generic message with a proper 4xx/5xx status. **Why this matters:** low severity since it's message text not a traceback, but it's still an unnecessary internal-detail leak on an auth endpoint, and returning HTTP 200 for a failed login is also a minor API-correctness issue. Not fixed here (changing status codes touches the frontend's error-handling contract — flagged rather than silently changed, consistent with "don't make functional frontend-facing changes without flagging").

**Positive finding worth recording:** session tokens are set via `response.set_cookie(key="rippleeta_session", value=token, httponly=True, samesite="lax")` (`app.py:366` and `:388`) — `httponly=True` means the JS-accessible `document.cookie` never sees the session token, which is the correct defense against the token being exfiltrated by an XSS bug on the frontend. This matters directly for the Part 2 XSS findings below.

**CHECKPOINT COMMIT:** `security: backend dependency, secrets, and injection audit`

---

## 2. Frontend security findings (Critical / Important / Minor)

Scope: `frontend/` (pre-existing but almost entirely rewritten in commit `998be4b`), `dashboard/` (also pre-existing, also rewritten in that commit), and `eta/` (brand new 3D viewer added in that same commit). Treated as unverified per the audit brief. No `package.json` exists anywhere in the repo — both `frontend/` and `dashboard/` are genuinely zero-dependency vanilla HTML/CSS/JS, so `npm audit` is **not applicable**, not silently skipped.

### Important — logout does not actually end the session

`frontend/js/api.js`'s `RippleETAClient.logout()` calls `POST /api/auth/logout` (`api.js:118`). **This route does not exist in `src/api/app.py`** — grepped the full route table (`@app.get`/`@app.post` decorators), confirmed no `/api/auth/logout` anywhere. The call 404s, is caught (`frontend/js/auth.js:78-86`'s `signOut()` wraps it in `try/catch/finally`), and execution continues: the in-memory user object and `localStorage` auth cache are cleared, giving the UI every visual sign of a successful logout.

**What actually happens server-side: nothing.** `src/api/app.py` never calls `response.delete_cookie(...)` anywhere (confirmed — no such call exists in the file). The httponly `rippleeta_session` cookie set at login (`app.py:366`, `:388`) is a 12-hour JWT and is never invalidated. On a shared or kiosk demo machine, clicking "Sign Out" clears the client-side UI state but leaves a live, valid session cookie in the browser for up to 12 hours — the next person to open the app (or a script with cookie access) is still authenticated as the previous user. This is a real, currently-reachable bug (`signOut()` is wired to the real UI, not dead code), not a hypothetical.

**Not fixed here** — this is a small, well-understood fix (add a `POST /api/auth/logout` route that calls `response.delete_cookie("rippleeta_session")`) but touches the backend's route table, which Part 2's brief scopes as frontend-only; flagged for a follow-up rather than reaching into `src/api/app.py` mid-audit.

### Minor — inconsistent XSS-defensive coding discipline

`grep -rn "innerHTML\|document.write" frontend/ dashboard/ eta/` returns 50+ hits. The large majority are safe (clearing content, or template strings built entirely from static markup/enum values). Two patterns are worth flagging even though neither is demonstrated exploitable today:

- **`dashboard/app.js:294`** (`loadPassenger`'s station timeline) and 5 more `tbody.innerHTML = results.map(...)` sites (`:538, :833, :1092, :1335, :1579`) interpolate API-response fields (`station.station_name`, `station.station_code`, train IDs) directly into template-literal HTML with no escaping. Today these values are all backend-generated from a fixed historical dataset/hardcoded scenario data (see Part 4), so there is no current attacker-controlled path — but the pattern itself does not defend against one.
- **`frontend/js/dashboard.js`** has ~15 sites of the shape `tableContainer.innerHTML = \`<div>Error loading X: ${err.message}</div>\`` (e.g. lines 607, 693, 750, 827, 897, 982, 1071). Some of these `err` objects are constructed from parsed JSON error response bodies (`throw new Error(errJson.error || ...)`, line 339) — i.e. backend-response text flows unescaped into `innerHTML`. Contrast this with the file's own `showError()` helper (`dashboard.js:94-96`), which correctly uses `textContent` for the same kind of message. The discipline is inconsistent within the same file — one code path is safe, a dozen others are not. No concrete exploit was constructed (would require a backend response echoing attacker-supplied text through an `error`/`detail` field with a rendered HTML payload, which was not found), so this is Minor, not Critical — but it's the kind of gap a security-literate judge would find in under a minute.

`eta/index.html:605/764` also use `innerHTML` with interpolated values, but they're built from a hardcoded local `TRAINS` array — not attacker-reachable.

### Minor — dead client-side Bearer-token auth path

`frontend/js/api.js` and `dashboard/app.js` both implement a `localStorage`-backed Bearer-token auth path (`localStorage.getItem('rippleeta_token')`, sent as `Authorization: Bearer ${token}`) alongside the real cookie-based session. Traced where the token would come from: `dashboard/app.js:55-57` only calls `localStorage.setItem('rippleeta_token', demoData.token)` **if** `demoData.token` is truthy — but `src/api/app.py`'s `/api/auth/demo` and `/api/auth/google` handlers return `{"success": True, "role": role}` only, no `token` field, ever. So this branch is correctly guarded and never fires; no real credential ever lands in `localStorage` in the current system (confirmed — not a live secrets-in-localStorage vulnerability). It is, however, confusing dead code implying a Bearer-token security model that doesn't exist in the current backend contract — flagged for Part 3 cleanup rather than a security fix.

### Minor — vendored 3D-viewer script loaded via `document.write` with no SRI

`eta/index.html:540` loads `GLTFLoader.js` from `cdn.jsdelivr.net` via `document.write('<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/...">')`, with no Subresource Integrity hash. `three.min.js` itself and the `.glb`/texture assets are vendored locally (no supply-chain exposure there). Low real risk (jsdelivr, pinned version, `/eta` is a standalone demo page not part of the authenticated app), but a one-line SRI hash would close the gap.

### Clean — no findings

- **Secrets/credentials:** `grep -rniE "(api[_-]?key|secret|client_secret|bearer)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{15,}"` returns only two hits, both in `frontend/js/dashboard.js`'s in-UI help text showing a user how to set their *own* `RAILRADAR_API_KEY`/`NTES_API_KEY` env vars (`export RAILRADAR_API_KEY="your-railradar-api-key"`) — clearly placeholder, not a real credential.
- **Google Auth:** only the public OAuth `client_id` is used client-side (`frontend/js/auth.js:182-183`, via `window.google.accounts.id.initialize({ client_id: clientId, ... })`), sourced from the backend's `/api/auth/config`, which itself only echoes `GOOGLE_CLIENT_ID` when explicitly configured (`app.py:338-346`). No client secret, service-account key, or other server-side-only credential is present anywhere client-side.
- **Translate API key:** `dashboard/app.js:2038` reads a Google Translate key from `localStorage.getItem('rippleeta_translate_api_key')` — this is bring-your-own-key, user-supplied, never hardcoded or shipped in source.
- **Hardcoded environment-specific URLs:** none found. The only `localhost`/`127.0.0.1` references are legitimate local-dev defaults (`dashboard/sandbox.js:14`'s `window.API_BASE_URL || 'http://127.0.0.1:8000'`, `frontend/app.js:322`'s same-origin fallback) — nothing points at a specific teammate's machine or a non-reproducible address.
- **`console.log`/`console.debug`:** `dashboard/app.js` has zero; `frontend/app.js` has 3, all inert UI-event breadcrumbs (`'[RippleETA] Received ETA complete callback'` etc.) with no tokens, payloads, or PII.
- **Accessibility:** no `<img>` tags exist anywhere in `dashboard/*.html` or `frontend/index.html` (all visuals are CSS/SVG/3D-canvas/video), so there is no missing-`alt` surface to find. The one input family checked in depth (`#train-id`, repeated across 6 stakeholder pages) has a proper `<label for="train-id">` (e.g. `dashboard/passenger.html:1095`); same for `#leave-deadline-input`. Not exhaustively checked across all 7 pages' every control — spot-checked the highest-traffic ones.
- **`session cookie` hardening (positive, cross-referenced from Part 1):** `httponly=True, samesite="lax"` on `rippleeta_session` means the XSS gaps above, even if ever made exploitable, could not exfiltrate the session cookie via `document.cookie` — a meaningful mitigating layer.

### Endpoint cross-reference (frontend calls vs. backend routes)

Backend routes (`src/api/app.py`): `/system/mode`, `/system/status`, `/trains`, `/health`, `/graph/demo`, `/graph/sandbox`, `/demo-launcher`, `/api/auth/config`, `/api/auth/google` (POST), `/api/auth/demo` (POST), `/api/stats`, `/api/me`, `/predict/{id}`, `/predict/{id}/passenger`, `/predict/{id}/station-master`, `/predict/{id}/crew-controller`, `/predict/{id}/feeder-transport`, `/predict/{id}/maintenance`.

| Frontend call | Backend route exists? |
|---|---|
| `/health`, `/system/mode`, `/api/auth/config`, `/api/auth/google`, `/api/auth/demo`, `/api/me`, `/predict/{id}` (+ all 5 stakeholder sub-routes), `/graph/demo`, `/graph/sandbox`, `/trains`, `/system/status`, `/api/stats` | ✅ all matched |
| `/api/auth/logout` (`frontend/js/api.js:118`) | ❌ **orphaned frontend call — no matching backend route** (see Important finding above) |

Backend routes never called by any frontend/dashboard JS: `/demo-launcher` (a manual-navigation redirect, not meant to be fetched by JS — not a bug) — no other orphaned backend routes found.

**CHECKPOINT COMMIT:** `security: frontend secrets, XSS, and dependency audit`

---

## 3. Code cleanliness findings and fixes applied

Five checkpoint commits this part (kept separate so each diff stays reviewable): dead-code/lint removal, an import-placement correction to a wrong claim made in that same commit, an isolated `black` formatting pass, a CSS/HTML corruption bugfix, and status-honesty code comments.

### Dead code — fixed

- **26 root-level one-off scripts removed** (`patch_*.py`, `fix_*.py`, `check.py`, `inspect_db.py`, `force_patch.py`, `mount_frontend.py`, `add_mode_endpoint.py`). Verified unreferenced by any Makefile/CI/Docker/tracked-source word-boundary grep before deleting (the two apparent hits — `check.py`, `patch.py` — were false positives: the English word "check" in CI/comments, and `unittest.mock.patch`). Read a sample of three (`check.py`, `inspect_db.py`, `patch_models.py`) in full to confirm they're genuinely disposable — `patch_models.py`'s own regex-guard (`if "degraded: bool" not in text`) confirms its edit was already applied and it would now no-op if re-run.
- **`ruff check src/ tests/ eval/ jobs/ scripts/`**: 6 unused imports, 1 unused exception-binding variable, 7 pointless f-string prefixes — all fixed. 68/68 tests unaffected.
- **Frontend dead-but-harmless auth path**: `frontend/js/api.js` / `dashboard/app.js` implement a `localStorage`-backed Bearer-token path that never actually receives a value in the current system (traced in Part 2 — the login responses never include a `token` field). Flagged, not removed — removing it touches live auth-adjacent frontend code beyond a "trivial, unambiguous fix."

### Real bugs found while doing mechanical cleanup (not originally in scope, but surfaced by the process)

- **Two silently-broken CSS declarations** in `dashboard/styles.css` (`.ticket-stub`, `.sm-lever-card` borders, and `.pax-time-input` background) had leftover fragments fused onto a valid declaration (`var(--border-300);(--brass-line);` and `var(--surface);af0;`) — invalid CSS a browser silently drops. Found via `npx prettier --check`, which refused to parse the file with a hard syntax error rather than a style warning. Fixed by removing the dead fragments.
- **One unbalanced `<div>` in `frontend/index.html`**: the navbar's right-hand action group (3D-viewer link, language select, status pill, sign-in button, user panel) was missing its opening `<div class="nav-actions">` tag. Confirmed this was a lost tag rather than a deliberate un-wrap: the matching closing `</div>` and a real `.nav-actions` flex-layout CSS rule (`frontend/style.css:412`) both already exist. Fixed by restoring the opening tag. **Not verified in a browser** (no dev server run this session) — the fix restores markup to what the surrounding code and CSS clearly intend, but visual confirmation is still owed.
- Corrected an inaccurate claim made in this session's own dead-code commit message (see the `fix:` commit immediately following it) — moved 3 module-level imports that were misplaced mid-file, not "deliberately lazy" as first asserted without checking each one individually.

### Duplicated logic — found, flagged, not fixed (judgment call)

The COMMIT/DEFER platform decision rule (`interval width ≤ 30 min → COMMIT, else DEFER`) is implemented **twice**: authoritatively in `src/api/app.py`'s `station_master()` handler (which already returns it as `platform_commit`), and independently re-derived in `dashboard/app.js` at two sites — `:442` (a display-only annotation, low stakes) and `:544` (the multi-train junction table, which actually drives each row's displayed COMMIT/DEFER badge). The junction table calls the generic `/predict/{tid}` endpoint rather than `/predict/{tid}/station-master`, so it never receives the authoritative `platform_commit` field and recomputes the same `<= 30` rule client-side instead. Today the two thresholds agree (both `30`), so there is no visible bug — but they can silently drift apart the moment the backend's cost-asymmetry tuning changes. **Not fixed**: the mechanical fix (switch the junction table to call `/station-master` and read its `platform_commit` field) changes the frontend's live network behavior, which the audit brief asks to flag rather than silently change.

### Missing error handling — spot-checked

- `dashboard/app.js:534`'s junction table: `Promise.all(supportedTrains.map(tid => api(...).catch(() => null)))` then `.filter(Boolean)` — if a single train's prediction fetch fails, that row **silently disappears** from the table with no error indicator, rather than showing a per-row error state. Cross-referenced in Part 6 (empty/error states).
- The backend's `get_prediction()` (audited in depth in Part 1) already has real, tested fallback coverage for ML failure and stale feeds — this was not re-litigated here.
- Not exhaustively swept across all 30k lines of frontend/dashboard JS or all `eval`/`jobs` scripts within this session's budget — the above are the concrete instances found, not a claim of completeness.

### Formatting — isolated commit

`black` had never been run on this repo (CI pins `ruff`+`mypy` only). Applied it across `src/`, `tests/`, `eval/`, `jobs/`, `scripts/` — 47 of 54 files reformatted, pure whitespace/line-wrap/quote-style, zero logic change, committed alone. `prettier` was test-run (`--check`) across all of `frontend/`, `dashboard/`, and `eta/` to gauge scope before deciding whether to apply it: **not bulk-applied**. Judgment call, not a mechanical no-brainer like `black` — the frontend/dashboard tree is ~30k lines of hand-crafted, animation-heavy UI currently in the middle of an unresolved design-system question (see Part 5), and a repo-wide reformat would produce a very large, low-value diff riding on top of that unresolved decision. It was, however, valuable as a syntax linter — see the two real bugs it surfaced above.

### Status honesty in code — fixed

Added code comments directly above the specific fields previously described as proxy/stub/hardcoded in `docs/LIMITATIONS.md`, so the status survives future edits without needing the external doc: `ripple_score`, `cross_train_attribution`, `financial_impact_inr` in `src/api/app.py`'s `station_master()`, the five hardcoded fields in `predict()` (`weather_risk_flag` etc. — and corrected: `LIMITATIONS.md` describes these as hash-based proxy logic, which no longer exists in this handler; they are HARDCODED, not PARTIAL), and both frontend consumption sites in `dashboard/app.js` (`ripple_score`'s always-55 fallback, `financial_impact_inr`'s undisclosed ₹1200/min constant).

### Naming — not deeply audited

Given the session's remaining scope for Part 4 (the centerpiece), naming consistency was not given a dedicated exhaustive pass beyond what surfaced incidentally above. No major cross-file naming inconsistency was noticed in the areas actually read (`src/`'s naming is consistent snake_case throughout; `dashboard/app.js`/`frontend/js/*.js` are consistent camelCase). Flagged as unaudited rather than claimed clean.

**CHECKPOINT COMMITS:** `chore: remove dead scratch scripts, fix ruff-flagged dead code`; `fix: correct E402 misplaced imports (previous commit's claim was wrong)`; `style: apply black formatting across the Python backend`; `fix: corrupted CSS declarations and unbalanced div in frontend/dashboard`; `docs: pin REAL/PARTIAL/HARDCODED status as code comments, not just docs`

---

## 4. Prior-session claim verification

The Part 4 connection-map pass (full table: `docs/CONNECTION_MAP.md`) was used as the vehicle for this verification, since most of these claims are frontend-visibility questions. Summary here; evidence lives in `docs/CONNECTION_MAP.md` section 0 and its per-page tables.

| Prior claim | Verdict | Evidence |
|---|---|---|
| Hardcoded JWT secret — fixed | **CONFIRMED RESOLVED** | `src/api/auth.py:19` — env var required, random per-process fallback only, no hardcoded string anywhere in `src/`. Re-verified independently in Part 1 (both by the fork and cross-checked directly). |
| Message-overwrite bug in degraded API responses — fixed | **CONFIRMED RESOLVED at the API layer; the fix's value is mostly lost at the frontend layer** | `src/api/app.py`'s `predict()` correctly preserves `original_message` (Part 1). But `docs/CONNECTION_MAP.md` section 0 found Crew Controller and Feeder Transport **discard** their own endpoint's `message` field and overwrite it with a client template on every branch — so the backend fix doesn't reach the user on 2 of 7 pages. Passenger/Station Master show the raw `status` string undecorated; no page reads `degraded`/`stale_since` at all. |
| Audit-log persistence gap — fixed | **CONFIRMED RESOLVED** | `src/api/app.py`'s `get_prediction()` writes a real `prediction_audit_log` table with real provenance (git commit, dataset/model SHA-256), input features, and SHAP text — read directly in Part 1/this session, not just cited from `PROGRESS.md`. |
| SHAP surfaced through `/predict/{train_id}` — fixed | **CONFIRMED RESOLVED at the API layer; NEVER surfaced to a user** | `shap_explanation`/`shap_text` are genuinely computed and returned over the wire (verified by tracing `conformal.py` → `pipeline.py` → `app.py`). But zero references to either field exist anywhere in frontend JS — see `docs/CONNECTION_MAP.md` section 0. The only "SHAP" text client-side is static bibliography copy, unrelated to any actual prediction's data. |
| Training-serving skew (latent fallback risk) — mitigated with a warning log | **CONFIRMED, not re-verified in depth this session** | `docs/LIMITATIONS.md` section 7 describes this precisely and a regression test was cited in `PROGRESS.md`; not independently re-run this session (out of this audit's declared scope — Part 1/2 focus on security, Part 3/4 on cleanliness/connections). No new evidence found that contradicts it. |
| A "reconciliation audit," an "architecture-doc verification pass," and "8 screenshot-grounded UI bugs" — referenced in this audit's own brief as having happened in prior sessions | **COULD NOT VERIFY THESE EXIST** | Searched `PROGRESS.md` (full read), `git log --oneline --all` for "reconcil"/"screenshot"/"architecture.*verif", and `docs/` for "screenshot"/"UI bug"/"Bug #" patterns. Found only one commit, `54437ac docs: reconcile evaluation anomalies...`, about numeric/statistical reconciliation (regression-to-the-mean framing), not a UI or architecture audit. No trace of an architecture-doc verification pass or 8 enumerated screenshot bugs anywhere in this repo's history or docs. This is itself informative: `docs/PAGE_ARCHITECTURE.md` is demonstrably stale (still describes a tab-based single-page `dashboard/index.html` and "OAuth: zero code written," both false — see Section 5 below), which is exactly the kind of drift an architecture-doc verification pass would have caught. Stating this plainly rather than fabricating specifics for claims that don't appear to exist in this codebase's history. |

**CHECKPOINT COMMIT:** `docs: complete frontend-backend connection map, all elements audited` (the connection-map commit doubles as this section's evidence-gathering pass)

---

## 5. Design system conflict — decision needed

**Factual state only — not resolved, not recommended.** Inspected the actual, currently-shipping CSS/token values in every relevant file (not what any doc claims). Found **five** distinct, non-interoperable color systems currently coexisting in this repo, not the two originally suspected:

| # | Source | Type | Base | Primary accent 1 | Primary accent 2 | Notes |
|---|---|---|---|---|---|---|
| 1 | `docs/DESIGN_SYSTEM.md` (documented) | Light, warm cream | `--base:#F3EDE3` | `--primary:#1B2A4A` (indigo) | `--signal:#E8A33D` (marigold) | States "This file is the single source of truth for all frontend work... If `styles.css` contradicts this document, the CSS is wrong." Explicitly lists **"Dark mode"** as an **anti-pattern** ("the warm cream base IS the identity"). Implemented nowhere in the current codebase. |
| 2 | `dashboard/styles.css` (actual, shipping) | Dark cinematic | `--base:#0B0F1A` | `--primary:#E8EDF5` | `--signal:#F0A500` | The file's own header comment says "Source of truth: docs/DESIGN_SYSTEM.md ... If this file contradicts that document, this file is wrong" — directly beneath that, its `:root` block is internally labeled `/* Palette (Dark Cinematic) */` and uses entirely different hex values under the SAME token names as #1 (`--base`, `--primary`, `--signal`, `--stamp`, `--success`). Self-contradicting: the comment claims fidelity to a doc it visibly does not implement. |
| 3 | `docs/FRONTEND_PAGES_FEATURES.md` + `docs/PAGE_ARCHITECTURE.md` (documented, agree with each other) | Dark ink/teal/amber | Ink `#091113` | Teal `#61c5bd` | Amber `#f5b84b` | A third specification, matching neither #1 nor #2. Reads as documentation of an *earlier* iteration of `dashboard/`'s actual CSS that has since drifted — plausible given `PAGE_ARCHITECTURE.md` also describes a tab-based single-page `dashboard/index.html` architecture that no longer exists (see below). |
| 4 | `frontend/style.css` (actual, shipping — the teammate's newly-arrived "Outliers" cinematic UI) | Dark cinematic railway | `--bg:#090a09` | Amber `#d8a548` | Green `#7da887` / Red `#c97970` / Blue `#7896a7` | Entirely disjoint token vocabulary from #1-#3 (no shared variable names at all). Closest in spirit to #2 (both dark) but different exact values and no overlap in naming convention. |
| 5 | `eta/index.html` (actual, shipping — new 3D train viewer, linked from `frontend/index.html`'s nav) | Light | `--bg:#F5F3EE` | Rail-blue `#123B5D` | Yellow `#E5B83F` | A fifth, independent specification — closest in *spirit* (light background) to #1's stated identity, but different token names and different exact hex values from #1. |

**Concrete on-page collision (not just an abstract "docs disagree" issue):** `dashboard/app.js`'s Station Master approach-scene signal lamp (`sm-sig-green/amber1/red`) sets SVG `fill` via hardcoded hex literals matching system #1's exact values (`#3D7A5C`, `#E8A33D`, `#A13D2E`) via `setAttribute()`, while every other color on that same page comes from system #2's CSS variables. The signal lamp will visibly not match the rest of the page it's on, regardless of which system "wins" — this one is a bug under any resolution, not a matter of taste.

**Architecture drift, closely related**: `docs/PAGE_ARCHITECTURE.md` (source of system #3 above) also describes `dashboard/`'s 7 stakeholder views as tabs within one single-page `dashboard/index.html` application, and describes Google OAuth as "🔮 PLANNED — not built... zero code written." Both are now false: `dashboard/index.html` is a role-selection hub linking to 7 separate HTML files (`passenger.html`, `station-master.html`, etc. — confirmed via `grep`), and Google OAuth is fully implemented (`frontend/js/auth.js`, `src/api/auth.py`, `/api/auth/google`). This document was not caught by any "architecture-doc verification pass" — see Section 4 (prior-claim verification) below; no evidence such a pass ever ran in this repo's history.

**Not resolved here, per instructions.** This is a product decision (which visual identity RippleETA actually presents to judges), not an engineering one — reported factually so the human can decide before anything gets merged or presented together.

---

## 6. What needs explicit decision or a follow-up session

**Decisions only the user can make:**
1. **Which design system RippleETA actually ships with** (Section 5) — light cream/indigo/marigold per the documented `DESIGN_SYSTEM.md`, the dark cinematic palette `dashboard/styles.css` actually implements, or `frontend/style.css`'s independent third dark palette (the newly-arrived teammate frontend). Everything in the Part 6 visual backlog is downstream of this.
2. **Which frontend is canonical for the demo**: `frontend/` (a single-page "Outliers" cinematic-3D-scene app with its own login flow, `frontend/js/auth.js`) or `dashboard/` (7 separate role pages, hub-and-spoke via `dashboard/index.html`, login in `dashboard/app.js`)? Both are live, both work, both call the same backend — this audit did not judge which is "better," only that they are genuinely duplicated, independently-maintained implementations (confirmed in Part 0/4).
3. **Whether Crew Controller's fabricated HOER duty-elapsed math (Section 4/`CONNECTION_MAP.md` section 3) should be disclosed as illustrative, replaced with something that reads `relief_dispatch_deadline` directly, or left as-is for the demo.** This is the single most misleading element found in this audit — it looks like a calibrated operational output but has no real data behind it — and fixing it (switching the decision badge to derive from the already-fetched `crew.relief_dispatch_deadline` instead of the invented duty-elapsed formula) is a real behavior change to flag, not something to silently patch.
4. **Whether to add a `POST /api/auth/logout` route** (Section 2) so "Sign Out" actually invalidates the session cookie server-side, rather than only clearing client-side state.

**Follow-up technical work, lower priority / needs more time than this session had:**
- Verify `PassengerResponse.historical_stations`'s true per-train variance (traced partway through `src/pipeline.py`, not conclusively).
- Confirm the Ghost Sandbox's "before/after baseline value" element binding (UNVERIFIED in `CONNECTION_MAP.md`).
- A browser-based pass for the UNVERIFIED items in `docs/VISUAL_BACKLOG.md` (contrast ratios, mobile viewport, loading-state affordances, hover/focus coverage) — this session had no dev server running and no way to render the pages visually.
- Decide whether to wire up `dashboard/sandbox.js`'s orphaned offline-fallback code (Section 4/`CONNECTION_MAP.md`) or delete it, now that it's confirmed dead.
- Naming consistency (Part 3) was not given a dedicated exhaustive pass — flagged as unaudited, not claimed clean.

---
