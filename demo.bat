@echo off
echo ========================================================
echo   Launching RippleETA in REPLAY MODE
echo   Zero-network demo with recorded live/route scenarios
echo ========================================================

set RIPPLEETA_MODE=replay
uvicorn src.api.app:app --reload --port 8000
