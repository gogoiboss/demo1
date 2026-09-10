import re
with open("src/api/app.py", "r", encoding="utf-8") as f:
    content = f.read()

# Add StaticFiles import if missing
if "from fastapi.staticfiles import StaticFiles" not in content:
    content = content.replace("from fastapi import FastAPI, HTTPException, Query", 
                              "from fastapi import FastAPI, HTTPException, Query\nfrom fastapi.staticfiles import StaticFiles")

# Add Mounts at the end of the file
mounts = """
import os
from pathlib import Path

# Mount the static frontends
frontend_path = Path(__file__).resolve().parent.parent.parent.parent / "outliers-frontend"
dashboard_path = Path(__file__).resolve().parent.parent.parent / "dashboard"

if dashboard_path.exists():
    app.mount("/dashboard", StaticFiles(directory=str(dashboard_path), html=True), name="dashboard")

if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
"""
if "app.mount" not in content:
    content = content + mounts

with open("src/api/app.py", "w", encoding="utf-8") as f:
    f.write(content)

print("Added StaticFiles mounting to app.py")
