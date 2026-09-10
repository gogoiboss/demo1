with open("src/ingestion/load_timetable.py", "r", encoding="utf-8") as f:
    text = f.read()

if "import numpy as np" not in text:
    text = "import numpy as np\n" + text

with open("src/ingestion/load_timetable.py", "w", encoding="utf-8") as f:
    f.write(text)
