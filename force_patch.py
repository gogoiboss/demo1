import re

filepath = "../outliers-frontend/app.js"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Use regex to replace the function definition
pattern = re.compile(r"function _proceedToDashboard\(\)\s*\{.*?(?=\n\}|\nfunction|\Z)\n\}", re.DOTALL)
new_func = """function _proceedToDashboard() {
  // Hard redirect to the actual ML dashboard built in rippleeta
  window.location.href = '/dashboard/index.html';
}"""

if pattern.search(content):
    content = pattern.sub(new_func, content)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print("SUCCESS: Regex replaced _proceedToDashboard.")
else:
    print("FAILED: Could not find _proceedToDashboard using regex.")

