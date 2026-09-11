import pytest
from pydantic import ValidationError

from src.ingestion.railradar_client import LiveStatusSchema, RouteSchema


def test_negative_delay_outlier_is_rejected():
    with pytest.raises(ValidationError):
        LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=-600)


def test_extreme_positive_delay_outlier_is_rejected():
    with pytest.raises(ValidationError):
        LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=6000)


def test_gps_outside_india_bounding_box_is_rejected():
    with pytest.raises(ValidationError):
        LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=10, lat=2.0, lng=80.0)


def test_non_monotonic_station_sequence_is_rejected():
    # Real, always-whitelisted station codes (railradar_client.py's mock
    # replay stations) so this fails for exactly one reason: the
    # non-monotonic sequence, not an unrelated unknown-station rejection.
    with pytest.raises(ValidationError):
        RouteSchema(stations=[
            {"station_code": "NDLS", "seq": 1},
            {"station_code": "KANPUR", "seq": 3},
            {"station_code": "ALLAHABAD", "seq": 2},
        ])


def test_valid_live_status_is_accepted():
    # A real assertion in the other direction too: valid input must not be
    # rejected by the same rules that catch the outliers above.
    status = LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=10)
    assert status.delay_min == 10


def test_valid_monotonic_route_is_accepted():
    route = RouteSchema(stations=[
        {"station_code": "NDLS", "seq": 1},
        {"station_code": "KANPUR", "seq": 2},
        {"station_code": "ALLAHABAD", "seq": 3},
    ])
    assert [s.seq for s in route.stations] == [1, 2, 3]
