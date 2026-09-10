with open("src/api/app.py", "r", encoding="utf-8") as f:
    text = f.read()

old_sm = """        prediction = get_prediction(train_id, prediction_variance)"""
new_sm = """        prediction = get_prediction(train_id, prediction_variance)
        tid_hash = sum(ord(c) for c in train_id)"""

text = text.replace(old_sm, new_sm)

with open("src/api/app.py", "w", encoding="utf-8") as f:
    f.write(text)

print("Fixed tid_hash in station_master")
