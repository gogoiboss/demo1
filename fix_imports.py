with open('src/api/app.py', 'r') as f:
    app_code = f.read()

import_auth = "from .auth import create_session_token, verify_google_token, get_current_user, role_required\nfrom pydantic import BaseModel\n"
if "from .auth import" not in app_code:
    app_code = app_code.replace("from fastapi import Response, Depends\n", "from fastapi import Response, Depends\n" + import_auth)
else:
    print("Auth imports already exist")

with open('src/api/app.py', 'w') as f:
    f.write(app_code)
