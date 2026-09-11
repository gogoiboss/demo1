import re

with open('src/api/app.py', 'r') as f:
    app_code = f.read()

app_code = app_code.replace(
    'from fastapi import FastAPI, Query', 
    'from fastapi import FastAPI, Query, Response, Depends\nfrom pydantic import BaseModel\nfrom .auth import create_session_token, verify_google_token, get_current_user, role_required\n\nclass GoogleLoginRequest(BaseModel):\n    credential: str\n\nclass DemoLoginRequest(BaseModel):\n    role: str\n    email: str = "demo@example.com"\n'
)

auth_routes = """
    @app.post("/api/auth/google", tags=["auth"])
    def google_login(req: GoogleLoginRequest, response: Response):
        try:
            idinfo = verify_google_token(req.credential)
            email = idinfo.get("email")
            role = "passenger"
            if "station" in email.lower(): role = "station_master"
            if "crew" in email.lower(): role = "crew_controller"
            if "feeder" in email.lower(): role = "feeder_transport"
            if "maintenance" in email.lower(): role = "maintenance"
            
            token = create_session_token(email, role)
            response.set_cookie(key="rippleeta_session", value=token, httponly=True)
            return {"success": True, "role": role}
        except Exception as e:
            return {"success": False, "error": str(e)}

    @app.post("/api/auth/demo", tags=["auth"])
    def demo_login(req: DemoLoginRequest, response: Response):
        token = create_session_token(req.email, req.role)
        response.set_cookie(key="rippleeta_session", value=token, httponly=True)
        return {"success": True, "role": req.role}

    @app.get("/api/me", tags=["auth"])
    def get_me(user: dict = Depends(get_current_user)):
        return {"email": user.get("sub"), "role": user.get("role")}
"""

app_code = app_code.replace('    @app.get("/predict/{train_id}/passenger"', auth_routes + '\n    @app.get("/predict/{train_id}/passenger"')

app_code = app_code.replace('def passenger(\n        train_id: str,', 'def passenger(\n        train_id: str,\n        user: dict = Depends(role_required("passenger")),')
app_code = app_code.replace('def station_master(\n        train_id: str,', 'def station_master(\n        train_id: str,\n        user: dict = Depends(role_required("station_master")),')
app_code = app_code.replace('def crew_controller(\n        train_id: str,', 'def crew_controller(\n        train_id: str,\n        user: dict = Depends(role_required("crew_controller")),')
app_code = app_code.replace('def feeder_transport(\n        train_id: str,', 'def feeder_transport(\n        train_id: str,\n        user: dict = Depends(role_required("feeder_transport")),')
app_code = app_code.replace('def maintenance(\n        train_id: str,', 'def maintenance(\n        train_id: str,\n        user: dict = Depends(role_required("maintenance")),')

with open('src/api/app.py', 'w') as f:
    f.write(app_code)
