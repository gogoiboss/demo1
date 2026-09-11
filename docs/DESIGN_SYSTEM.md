# RippleETA Design System

> **This file is the single source of truth for all frontend work.**
> It supersedes every previous style decision in the codebase.
> If `styles.css` contradicts this document, the CSS is wrong.

---

## 1. Palette

| Token | Hex | Usage | Rule |
|---|---|---|---|
| `--base` | `#F3EDE3` | Background of every large surface | Warm cream. NEVER flat; always pair with noise/grain texture overlay |
| `--primary` | `#1B2A4A` | Structural elements, dark surfaces, nav, headings | Deep railway indigo |
| `--signal` | `#E8A33D` | **Differentiator accent ONLY** — conflict propagation, calibrated uncertainty | Marigold amber. Never decorative. |
| `--stamp` | `#A13D2E` | Alerts, stamps, critical badges — used sparingly | Terracotta/vermillion |
| `--success` | `#3D7A5C` | Stable/resolved/safe states | Deep signal green |
| `--text` | `#1B1B1B` | Body text on light surfaces | Near-black |
| `--text-inv` | `#F3EDE3` | Text on dark surfaces | Cream inverse |
| `--line` | `rgba(27,42,74,.12)` | Borders, dividers | Derived from --primary at low opacity |
| `--surface` | `#FFFFFF` | Cards, elevated panels over --base | Pure white |
| `--surface-dark` | `#1B2A4A` | Dark cards (departure board, nav) | Same as --primary |
| `--muted` | `#7A7468` | Secondary text, timestamps, labels | Warm gray |

### Why this palette is not "AI slop"
- The base is warm and textured (grain overlay mandatory), not a flat neutral.
- Every accent color has a specific, limited, functional meaning stated above.
- Colors are NEVER used decoratively.

---

## 2. Texture

### Paper grain (MANDATORY on all large background surfaces)

Use a CSS SVG noise filter as a fixed pseudo-element:

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,...noise...");
  background-repeat: repeat;
  background-size: 256px 256px;
}
```

---

## 3. Typography

| Role | Font | Weight |
|---|---|---|
| **Headlines** (h1, h2) | **Fraunces** | 600-700 |
| **Body / UI** | **Inter** | 400, 500, 600 |
| **Data / Telemetry** | **IBM Plex Mono** | 400, 500 |

---

## 4. Motion Language

| State | Animation | Duration | Easing |
|---|---|---|---|
| Live/normal | Breathing pulse (opacity 0.6-1.0) | 2s loop | ease-in-out |
| Conflict propagating | Sharp color snap to --signal + glow | 300ms | cubic-bezier(.4,0,.2,1) |
| Delay resolved | Settle/decay pulse | 400ms | ease-out |
| Page transitions | Opacity + 8px translateY | 250ms | ease-out |
| Hover | Background shift | 200ms | ease |

All transitions: 200-400ms. Nothing faster or slower.

---

## 5. Component Patterns

- Cards: --surface (white), 1px solid --line, border-radius: 6px, padding: 20px 24px
- Labels: uppercase, --muted, mono or Inter 500, 0.6875rem
- Status dots: 8-10px circles, --success / --signal / --stamp only
- Departure board hero: --surface-dark bg, --text-inv text, --signal for emphasis

---

## 6. Anti-patterns (DO NOT)

- Flat solid-color backgrounds without texture
- Dark mode (the warm cream base IS the identity)
- More than 2 accent colors visible at once
- Decorative use of --signal or --stamp
- Cards with no content or purpose
- Rainbow/purple AI gradients, neon glows
- Rounded corners > 8px
- Stock dashboard aesthetics
- Giant empty hero sections
- Excessive glass/blur effects
