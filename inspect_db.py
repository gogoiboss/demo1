import sqlite3
import sys

try:
    conn = sqlite3.connect('predictions_history.db')
    cursor = conn.cursor()
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table';")
    print("DB Schema:")
    for row in cursor.fetchall():
        print(row[0])
    cursor.execute("SELECT * FROM history LIMIT 5;")
    print("\nDB Rows:")
    for row in cursor.fetchall():
        print(row)
except Exception as e:
    print("DB Error:", e)

print("\nPIPELINE METHODS:")
sys.path.append('.')
try:
    from src.pipeline import RippleETAPipeline
    p = RippleETAPipeline()
    print([m for m in dir(p) if not m.startswith('__')])
except Exception as e:
    print("Pipeline Error:", e)
