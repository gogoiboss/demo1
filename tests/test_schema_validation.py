import sys
import logging
from pydantic import ValidationError
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
from src.ingestion.railradar_client import LiveStatusSchema, RouteSchema, get_validation_metrics

def test_validation():
    print("Testing Validation Schemas...")
    
    # 1. Test Delay limits
    try:
        LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=-600)
        print("FAILED: Did not catch -600 delay")
    except ValidationError as e:
        print("SUCCESS: Caught negative delay outlier (-600)")
        
    try:
        LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=6000)
        print("FAILED: Did not catch +6000 delay")
    except ValidationError as e:
        print("SUCCESS: Caught positive delay outlier (+6000)")
        
    # 2. Test GPS Bounding Box
    try:
        LiveStatusSchema(train_number="123", current_station="NDLS", delay_min=10, lat=2.0, lng=80.0)
        print("FAILED: Did not catch GPS outside India")
    except ValidationError as e:
        print("SUCCESS: Caught GPS outside India bounding box")
        
    # 3. Test Monotonic Sequence
    try:
        RouteSchema(stations=[
            {"station_code": "A", "seq": 1},
            {"station_code": "B", "seq": 3},
            {"station_code": "C", "seq": 2}
        ])
        print("FAILED: Did not catch non-monotonic sequence")
    except ValidationError as e:
        print("SUCCESS: Caught non-monotonic sequence")

if __name__ == "__main__":
    test_validation()
