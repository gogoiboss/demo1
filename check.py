import sys
import ast

def check_file(filepath):
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        ast.parse(content)
        print(f"Syntax OK: {filepath}")
    except SyntaxError as e:
        print(f"Syntax ERROR in {filepath}: {e}")

files = [
    'src/features/engineering.py',
    'src/models/xgboost_model.py',
    'src/calibration/conformal.py',
    'src/pipeline.py'
]
for f in files:
    check_file(f)
