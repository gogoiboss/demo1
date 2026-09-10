with open("src/api/app.py", "r", encoding="utf-8") as f:
    text = f.read()

mode_endpoint = """
    @app.get("/system/mode", tags=["system"])
    def get_mode() -> dict:
        import os
        return {"mode": os.environ.get("RIPPLEETA_MODE", "live").upper()}
"""

if "/system/mode" not in text:
    text = text.replace('def health() -> HealthResponse:', mode_endpoint + '\n    @app.get("/health", response_model=HealthResponse, tags=["system"])\n    def health() -> HealthResponse:')

with open("src/api/app.py", "w", encoding="utf-8") as f:
    f.write(text)
