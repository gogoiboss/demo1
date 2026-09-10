# RippleETA: Frontend Pages, Features & Tech Stack

This document details the Single Page Application (SPA) dashboard built for RippleETA, breaking down the 7 distinct views, their intelligence, and the underlying tech stack.

## Frontend Tech Stack
* **Architecture:** Zero-dependency Vanilla HTML, CSS, and JavaScript. Fully decoupled from the backend.
* **Performance:** Instant load times, no React overhead, runs perfectly offline or on low-bandwidth networks.
* **Aesthetics:** "Modern, confident, editorial control-room." Deep ink (`#091113`) backgrounds, Teal (`#61c5bd`) / Amber (`#f5b84b`) data signals.
* **Typography:** Space Grotesk (geometric, for large numbers) + IBM Plex Mono (for technical readouts).
* **Responsiveness:** Uses modern CSS `clamp()` functions for fluid typography scaling across 4K monitors and mobile devices.

---

## The 7 Stakeholder Views

### 1. Passenger View
* **Audience:** B2C (Consumers).
* **Intelligence:** Replaces the false certainty of a single ETA with a visual P10–P90 interval bar. 
* **Key Feature - "Should I Leave Now?":** A time-picker where the user inputs their connection deadline. The JS compares this strictly against the P90 *upper bound* (worst case) to output a safety flag ("Safe to leave", "Wait").
* **Key Feature - Trend Chip:** Queries the SQLite database to tell the user if their train's delay is "improving" or "worsening" over time.

### 2. Station Master (Controller) View
* **Audience:** Platform Managers.
* **Intelligence:** Translates ETA into a binary platform allocation decision (COMMIT vs DEFER).
* **Key Feature - Cost Asymmetry & Triage:** Warns the user that thresholds are skewed to penalize false negatives.
* **Key Feature - Radio-Ready Terse Output:** Translates complex JSON data into a standardized, 10-word sentence ready to be spoken into a VHF radio.
* **Key Feature - Ripple Score & Financial Impact:** Shows the network criticality score (0-100) and calculates the projected INR (Rupee) cost of the delay (crew overtime + penalties).

### 3. Crew Controller View
* **Audience:** Crew Rostering/Dispatch.
* **Intelligence:** Protects Hours of Employment Regulations (HOER).
* **Key Feature:** Outputs a strict "Relief Dispatch Deadline" calculated from the P90 bound, ensuring replacement drivers are mobilized with a safety margin, rather than exhausting their shift waiting for a train.

### 4. Feeder Transport View
* **Audience:** Bus/Metro Coordinators.
* **Intelligence:** Probabilistic decision making.
* **Key Feature:** The coordinator inputs their bus departure cutoff time. The UI fits a normal approximation to the P10-P90 interval and outputs the exact `% probability` the train will arrive before the bus leaves, issuing a WAIT or DEPART command.

### 5. Maintenance Yard View
* **Audience:** Rake Cleaning / Turnaround Staff.
* **Intelligence:** Forward-looking operational buffer logic.
* **Key Feature:** An animated progress bar showing the remaining "turnaround budget." If the train is so late that the window drops below 90 minutes, it automatically flags "CRITICAL - RAPID CLEANING REQUIRED".

### 6. Control Room (Network View)
* **Audience:** Regional Dispatchers.
* **Intelligence:** Visualizes the Goverde Max-Plus math.
* **Key Feature:** A 2D CSS-animated graph trace showing a fixed historical scenario (Train 12301 conflicting with Train 56789 between Kanpur and Allahabad). It visually draws the "delay ripple" flowing from one track to another.

### 7. Ghost Train Sandbox
* **Audience:** Judges / Technical Evaluators.
* **Intelligence:** Pure CSS 3D Isometric rendering (no heavy WebGL/Three.js iframes).
* **Key Feature:** An interactive sandbox where users can drag sliders to inject delay into a 3D train. If the delay crosses the max-plus conflict threshold, an amber "conflict beam" shoots across the isometric tracks to delay the second train, physically proving the math works.

---

## Global Features
* **Colorblind Safe Mode:** A toggle button in the nav bar that instantly swaps the CSS variables from Teal/Amber to a highly distinct Blue/Orange palette, proving enterprise accessibility compliance.
* **Live-Pulse Connections:** CSS micro-animations on data-stamps to indicate live API polling.
