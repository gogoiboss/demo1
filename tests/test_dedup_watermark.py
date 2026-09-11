import sys
from pathlib import Path
from unittest import mock

sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.ingestion.railradar_client import (
    get_live_status,
    _WATERMARKS,
    _PROCESSED_PINGS,
    _VALIDATION_METRICS,
)

# Reset state
_WATERMARKS.clear()
_PROCESSED_PINGS.clear()
_VALIDATION_METRICS["dedup_rejected"] = 0
_VALIDATION_METRICS["stale_rejected"] = 0


def test_dedup_and_watermark():
    print("Testing Deduplication & Watermarking...")

    # 1. First Ping (Normal)
    ping_1 = {
        "train_number": "99999",
        "current_station": "NDLS",
        "delay_min": 10.0,
        "last_updated": "2026-09-10T12:00:00Z",
        "journey_date": "2026-09-10",
        "event_type": "arr",
    }

    with mock.patch(
        "src.ingestion.railradar_client._get", return_value=ping_1
    ), mock.patch("src.ingestion.railradar_client.RIPPLEETA_MODE", "live"):
        res1 = get_live_status("99999")
        assert res1 is not None, "First ping should be accepted"
        print("SUCCESS: First ping accepted")

    # 2. Duplicate Ping (Exact Repeat)
    with mock.patch(
        "src.ingestion.railradar_client._get", return_value=ping_1
    ), mock.patch("src.ingestion.railradar_client.RIPPLEETA_MODE", "live"):
        res2 = get_live_status("99999")
        assert res2 is None, "Duplicate ping should be rejected"
        assert _VALIDATION_METRICS["dedup_rejected"] == 1
        print("SUCCESS: Duplicate ping rejected")

    # 3. Newer Ping (Advances Watermark)
    ping_new = {
        "train_number": "99999",
        "current_station": "KANPUR",
        "delay_min": 20.0,
        "last_updated": "2026-09-10T13:00:00Z",
        "journey_date": "2026-09-10",
        "event_type": "dep",
    }
    with mock.patch(
        "src.ingestion.railradar_client._get", return_value=ping_new
    ), mock.patch("src.ingestion.railradar_client.RIPPLEETA_MODE", "live"):
        res3 = get_live_status("99999")
        assert res3 is not None, "New ping should be accepted"
        print("SUCCESS: Newer ping accepted and watermark advanced")

    # 4. Out-of-order Stale Ping (Arriving after newer ping)
    ping_stale = {
        "train_number": "99999",
        "current_station": "NDLS",  # Must be known station to pass validation
        "delay_min": 15.0,
        "last_updated": "2026-09-10T12:30:00Z",
        "journey_date": "2026-09-10",
        "event_type": "dep",
    }
    with mock.patch(
        "src.ingestion.railradar_client._get", return_value=ping_stale
    ), mock.patch("src.ingestion.railradar_client.RIPPLEETA_MODE", "live"):
        res4 = get_live_status("99999")
        assert res4 is None, "Stale ping should be rejected by watermark"
        assert _VALIDATION_METRICS["stale_rejected"] == 1
        print("SUCCESS: Out-of-order stale ping correctly ignored")


if __name__ == "__main__":
    test_dedup_and_watermark()
