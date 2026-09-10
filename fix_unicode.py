with open("eval/comprehensive_evaluation.py", "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace("≈", "~")

with open("eval/comprehensive_evaluation.py", "w", encoding="utf-8") as f:
    f.write(text)
