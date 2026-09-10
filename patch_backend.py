import re

with open('src/api/app.py', 'r', encoding='utf-8') as f:
    app_code = f.read()

# 1. Add SQLite setup
sqlite_setup = """import sqlite3
import json

def get_trend(train_id: str, current_delay: float) -> str:
    if current_delay is None:
        return "unknown"
    conn = sqlite3.connect('predictions_history.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS history 
                 (train_id TEXT, delay REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    
    # Get last delay
    c.execute('SELECT delay FROM history WHERE train_id = ? ORDER BY timestamp DESC LIMIT 1', (train_id,))
    row = c.fetchone()
    
    # Insert new delay
    c.execute('INSERT INTO history (train_id, delay) VALUES (?, ?)', (train_id, current_delay))
    conn.commit()
    conn.close()
    
    if row is None:
        return "stable"
    
    last_delay = row[0]
    if current_delay > last_delay + 1.0:
        return "worsening"
    elif current_delay < last_delay - 1.0:
        return "improving"
    return "stable"
"""

app_code = app_code.replace('from statistics import NormalDist', 'from statistics import NormalDist\n' + sqlite_setup)

# 2. Update passenger endpoint
old_passenger = """        return PassengerResponse(
            train_id=train_id,
            status=prediction["status"],
            delay_min=delay,
            trend="unknown",
            next_update_at=now_utc() + timedelta(minutes=30),"""

new_passenger = """        trend_val = get_trend(train_id, delay)
        return PassengerResponse(
            train_id=train_id,
            status=prediction["status"],
            delay_min=delay,
            trend=trend_val,
            next_update_at=now_utc() + timedelta(minutes=30),"""

app_code = app_code.replace(old_passenger, new_passenger)

with open('src/api/app.py', 'w', encoding='utf-8') as f:
    f.write(app_code)

print("Backend patched successfully.")
