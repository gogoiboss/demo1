with open("src/ingestion/railradar_client.py", "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace('logger.warning(f"429 Too Many Requests ?" backing off {wait}s")', 'logger.warning(f"429 Too Many Requests - backing off {wait}s")')

with open("src/ingestion/railradar_client.py", "w", encoding="utf-8") as f:
    f.write(text)
