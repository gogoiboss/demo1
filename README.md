# RippleETA

*We do for train ETAs what weather forecasting did for rain — replace false precision with an honest, narrowing probability window.*

**Status: In Development**

## Core Differentiator
Unlike systems that treat trains in isolation, RippleETA models the network — capturing what trains inherit from their last journey (rake-delay) and what they face from the network ahead (cross-train conflict propagation) to output an honest arrival window, rather than a confident wrong time.

## Architecture
*(Placeholder for architecture diagram and details)*

## Local Setup

### Virtual Environment setup

1. Ensure Python 3.9+ is installed.
2. Create a virtual environment:
   ```bash
   python -m venv .venv
   ```
3. Activate the virtual environment:
   - On Windows:
     ```bash
     .venv\Scripts\activate
     ```
   - On macOS/Linux:
     ```bash
     source .venv/bin/activate
     ```
4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
