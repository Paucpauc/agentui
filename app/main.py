import os
import logging
from contextlib import asynccontextmanager
from urllib.parse import quote
from typing import Optional
from fastapi import FastAPI, Request

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

from app.auth import (
    is_auth_enabled,
    get_authenticated_user_from_headers,
)
from app.config import (
    BASE_WORKSPACE,
    AGENT_BIN,
    AGENT_ARGS,
)
from app.utils import safe_path
from app.schemas import (
    LoginRequest,
    CreateDirRequest,
    CreateFileRequest,
    SaveFileRequest,
    RenameFileRequest,
    DeleteFileRequest,
    CreatePublicLinkRequest,
)
from app.routers import (
    auth_router,
    workspaces_router,
    files_router,
    public_router,
    websockets_router,
    limits_router,
    backups_router,
)
from app.limits import limits_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent-webui")


@asynccontextmanager
async def lifespan(app: FastAPI):
    enable_bg = os.environ.get("ENABLE_LIMITS_BACKGROUND", "true").lower() in ("true", "1", "yes")
    if enable_bg:
        limits_service.start()
    yield
    limits_service.stop()


app = FastAPI(title="Agent Web UI", lifespan=lifespan)

os.makedirs(BASE_WORKSPACE, exist_ok=True)



@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not is_auth_enabled():
        return await call_next(request)

    path = request.url.path

    # Public paths
    PUBLIC_PATHS = {"/login", "/api/login", "/api/auth/status", "/logout", "/favicon.ico"}
    if (
        path in PUBLIC_PATHS
        or path.startswith("/static/")
        or path.startswith("/api/public/")
        or path == "/api/public"
        or path.startswith("/public/")
        or path == "/public"
    ):
        # If user visits /login while already logged in, redirect to index
        if path == "/login" and request.method == "GET":
            user = get_authenticated_user_from_headers(
                dict(request.headers),
                request.cookies,
                dict(request.query_params),
            )
            if user:
                return RedirectResponse(url="/", status_code=303)
        return await call_next(request)

    # Check authentication
    user = get_authenticated_user_from_headers(
        dict(request.headers),
        request.cookies,
        dict(request.query_params),
    )

    if user:
        request.state.user = user
        return await call_next(request)

    # Not authenticated:
    if path.startswith("/api/"):
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"},
        )

    # HTML / Browser request -> redirect to login
    next_path = path
    if request.url.query:
        next_path += f"?{request.url.query}"
    return RedirectResponse(url=f"/login?next={quote(next_path)}", status_code=303)


# Register routers
app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(files_router)
app.include_router(public_router)
app.include_router(websockets_router)
app.include_router(limits_router)
app.include_router(backups_router)


# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
@app.get("/workspace")
@app.get("/workspace/{workspace_name:path}")
@app.get("/workspaces")
@app.get("/workspaces/{workspace_name:path}")
def get_index(workspace_name: Optional[str] = None):
    return FileResponse("static/index.html")
