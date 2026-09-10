with open("src/api/models.py", "r", encoding="utf-8") as f:
    text = f.read()

# Change PredictionResponse status from Literal to str and add fields
import re

text = re.sub(
    r'status: Literal\["PREDICTION ACTIVE", "PREDICTION SUSPENDED \S+ anomalous conditions"\]',
    'status: str',
    text
)

if "degraded: bool" not in text:
    text = text.replace(
        'generated_at: datetime',
        'generated_at: datetime\n    degraded: bool = False\n    last_updated: str | None = None'
    )

with open("src/api/models.py", "w", encoding="utf-8") as f:
    f.write(text)
