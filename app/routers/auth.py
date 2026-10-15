from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

from app.auth import (
    is_auth_enabled,
    get_authenticated_user_from_headers,
    create_session,
    revoke_session,
    verify_credentials,
    SESSION_COOKIE_NAME,
    DEFAULT_SESSION_MAX_AGE,
)
from app.schemas import LoginRequest

router = APIRouter(tags=["auth"])


@router.get("/login")
def get_login():
    return FileResponse("static/login.html")


@router.post("/api/login")
def api_login(req: LoginRequest):
    if not is_auth_enabled():
        return {"status": "ok", "message": "Auth not enabled"}

    if not verify_credentials(req.username, req.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_session(req.username)
    response = JSONResponse({"status": "ok", "user": req.username})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=DEFAULT_SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return response


@router.post("/api/logout")
@router.get("/logout")
def api_logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        revoke_session(token)
    if request.method == "GET":
        resp = RedirectResponse(url="/login", status_code=303)
    else:
        resp = JSONResponse({"status": "ok"})
    resp.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return resp


@router.get("/api/auth/status")
def auth_status(request: Request):
    user = get_authenticated_user_from_headers(
        dict(request.headers),
        request.cookies,
        dict(request.query_params)
    )
    enabled = is_auth_enabled()
    return {
        "auth_enabled": enabled,
        "authenticated": bool(user is not None) if enabled else True,
        "user": user if enabled else None,
    }
