from fastapi.testclient import TestClient
from src.api.app import create_app
import os

os.environ["RIPPLEETA_MODE"] = "replay"

app = create_app()
client = TestClient(app)

response = client.get("/predict/12301")
print(response.status_code)
print(response.json())
