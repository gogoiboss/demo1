"""
RailRadar API Client — Live Train Position & Status
====================================================
API docs:  https://api.railradar.in/v1
Auth:      Bearer token (header: Authorization: Bearer rr_live_YOUR_API_KEY)
Free tier: ~1,000 requests/month  →  rate-limit to stay safe.

Endpoints used:
    GET /v1/trains/{number}/live    → real-time position, delay, current halt
    GET /v1/trains/{number}/route   → full timetable + GeoJSON polyline

This is a STUB — fill in your API key and test against the live service.
"""

import time
import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_URL = "https://api.railradar.in/v1"

# TODO: Replace with your actual RailRadar API key.
#       Sign up at https://railradar.in/login (no credit card required).
API_KEY = "rr_live_YOUR_API_KEY"

# Free tier = 1,000 requests/month ≈ 33/day ≈ 1 every ~44 minutes.
# For 3 routes polled every 15 min over 7 days ≈ 2,016 requests → exceeds
# free tier.  We enforce a minimum interval between requests to be safe.
MIN_REQUEST_INTERVAL_SEC = 12  # ~5 req/min max burst; stay well under quota
MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 30  # base wait when rate-limited (429)


# ---------------------------------------------------------------------------
# Simple rate limiter
# ---------------------------------------------------------------------------
class _RateLimiter:
    """Token-bucket-ish rate limiter: enforces minimum interval between calls."""

    def __init__(self, min_interval: float = MIN_REQUEST_INTERVAL_SEC):
        self.min_interval = min_interval
        self._last_call: float = 0.0

    def wait(self) -> None:
        """Block until it's safe to make the next request."""
        elapsed = time.time() - self._last_call
        if elapsed < self.min_interval:
            sleep_for = self.min_interval - elapsed
            logger.debug(f"Rate limiter: sleeping {sleep_for:.1f}s")
            time.sleep(sleep_for)
        self._last_call = time.time()


_limiter = _RateLimiter()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _headers() -> dict:
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
    }


def _get(endpoint: str, params: Optional[dict] = None) -> dict:
    """
    Make a rate-limited GET request with retry on 429.

    Returns parsed JSON on success.
    Raises requests.HTTPError on non-recoverable failure.
    """
    url = f"{BASE_URL}{endpoint}"

    for attempt in range(1, MAX_RETRIES + 1):
        _limiter.wait()
        logger.info(f"GET {url}  (attempt {attempt}/{MAX_RETRIES})")

        try:
            resp = requests.get(url, headers=_headers(), params=params, timeout=15)
        except requests.ConnectionError as e:
            logger.warning(f"Connection error: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SEC)
                continue
            raise

        if resp.status_code == 200:
            return resp.json()

        if resp.status_code == 429:
            # Rate limited — back off exponentially
            wait = RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            logger.warning(f"429 Too Many Requests — backing off {wait}s")
            time.sleep(wait)
            continue

        # Other HTTP errors — fail immediately
        logger.error(f"HTTP {resp.status_code}: {resp.text[:200]}")
        resp.raise_for_status()

    raise RuntimeError(f"Exhausted {MAX_RETRIES} retries for {url}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def get_live_status(train_number: str) -> dict:
    """
    Fetch real-time position, delay, and current halt for a train.

    Returns dict with keys like:
        - current_station, delay_min, lat, lng, last_updated, ...

    TODO: Parse the raw response into a clean dataclass once we have
          real response samples from the sandbox.
    """
    return _get(f"/trains/{train_number}/live")


def get_route(train_number: str) -> dict:
    """
    Fetch the full timetable + GeoJSON polyline for a train.

    Returns dict with keys like:
        - stations (list), geojson (FeatureCollection), ...

    TODO: Parse into structured format for the timed-event graph.
    """
    return _get(f"/trains/{train_number}/route")


def get_coach_composition(train_number: str) -> dict:
    """
    Fetch coach composition and layout.

    Returns dict with keys like:
        - coaches (list of {position, type, ...})
    """
    return _get(f"/trains/{train_number}/coaches")


def search_trains(query: str) -> dict:
    """
    Search / autocomplete for train numbers or names.

    Returns dict with a list of matching trains.
    """
    return _get("/lookup/search/trains", params={"q": query})


# ---------------------------------------------------------------------------
# Quick smoke test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Test with Howrah Rajdhani
    print("\n--- Live Status: 12301 (Howrah Rajdhani) ---")
    try:
        status = get_live_status("12301")
        print(status)
    except Exception as e:
        print(f"  Failed (expected if API key not set): {e}")

    print("\n--- Route: 12301 ---")
    try:
        route = get_route("12301")
        print(route)
    except Exception as e:
        print(f"  Failed (expected if API key not set): {e}")
