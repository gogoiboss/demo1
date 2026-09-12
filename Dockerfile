# ── Stage 1: dependency layer (cached independently of source changes) ──────
FROM python:3.10-slim AS deps

WORKDIR /app

# System libs needed by XGBoost / scikit-learn
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt httpx

# ── Stage 2: application image ───────────────────────────────────────────────
FROM deps AS app

WORKDIR /app

# Copy source and data assets into container
COPY config.yaml ./
COPY src/ ./src/
COPY models/ ./models/
COPY data/ ./data/
COPY dashboard/ ./dashboard/

# The pipeline reads config.yaml from the working directory.
# All tunable parameters (hyperparameters, thresholds, paths) live there.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Port exposed by uvicorn
EXPOSE 8000

# Healthcheck so orchestrators know when the service is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Run the FastAPI app via uvicorn
CMD ["uvicorn", "src.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
