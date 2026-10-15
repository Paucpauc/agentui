import time
from urllib.parse import quote
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.auth import generate_public_file_signature, verify_public_file_signature
from app.config import get_base_workspace
from app.schemas import CreatePublicLinkRequest
from app.utils import safe_path, get_request_base_url

router = APIRouter(tags=["public"])


def _create_public_link(
    request: Request,
    workspace: str,
    path: str,
    expires_in: Optional[int] = None,
    expires: Optional[int] = None,
    download: bool = False,
    base_url: Optional[str] = None,
):
    ws_clean = (workspace or "").strip().strip("/")
    if not ws_clean or "/" in ws_clean or ".." in ws_clean:
        raise HTTPException(status_code=400, detail="Invalid workspace name")

    base_p = get_base_workspace()
    ws_path = safe_path(base_p, ws_clean)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_name = (path or "").strip()
    if not file_name:
        raise HTTPException(status_code=400, detail="File path cannot be empty")

    file_path = safe_path(str(ws_path), file_name)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.is_dir():
        raise HTTPException(status_code=400, detail="Target is a directory, not a file")

    now = int(time.time())
    if expires is not None:
        try:
            expires_ts = int(expires)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid expires timestamp")
    elif expires_in is not None:
        try:
            exp_in = int(expires_in)
            if exp_in <= 0:
                raise ValueError()
            expires_ts = now + exp_in
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="expires_in must be a positive integer")
    else:
        # Default: 24 hours (86400 seconds)
        expires_ts = now + 86400

    if expires_ts <= now:
        raise HTTPException(status_code=400, detail="Expiration time must be in the future")

    rel_file = str(file_path.relative_to(ws_path))
    sig = generate_public_file_signature(ws_clean, rel_file, expires_ts)

    query_parts = [
        f"workspace={quote(ws_clean)}",
        f"path={quote(rel_file)}",
        f"expires={expires_ts}",
        f"signature={sig}",
    ]
    if download:
        query_parts.append("download=1")
    query_str = "&".join(query_parts)

    url = f"/api/public/file?{query_str}"
    resolved_base = get_request_base_url(request, client_base_url=base_url)
    full_url = f"{resolved_base}{url}"

    # Path-based URL (critical for third-party viewers like Microsoft 365 that rely on URL file extensions)
    path_clean = quote(rel_file, safe="/")
    path_query = f"expires={expires_ts}&signature={sig}"
    if download:
        path_query += "&download=1"
    path_url = f"/api/public/files/{quote(ws_clean)}/{path_clean}?{path_query}"
    full_path_url = f"{resolved_base}{path_url}"

    return {
        "status": "ok",
        "workspace": ws_clean,
        "path": rel_file,
        "filename": file_path.name,
        "size": file_path.stat().st_size,
        "expires": expires_ts,
        "expires_in": expires_ts - now,
        "signature": sig,
        "download": download,
        "url": url,
        "full_url": full_url,
        "path_url": path_url,
        "full_path_url": full_path_url,
    }


@router.post("/api/files/public-link")
def create_public_link_post(req: CreatePublicLinkRequest, request: Request):
    """
    Generate a signed public link for a file with an expiration timestamp.
    Requires authentication when auth is enabled.
    """
    return _create_public_link(
        request=request,
        workspace=req.workspace,
        path=req.path,
        expires_in=req.expires_in,
        expires=req.expires,
        download=req.download or False,
        base_url=req.base_url,
    )


@router.get("/api/files/public-link")
def create_public_link_get(
    request: Request,
    workspace: str = Query(...),
    path: str = Query(...),
    expires_in: Optional[int] = Query(None),
    expires: Optional[int] = Query(None),
    download: bool = Query(False),
    base_url: Optional[str] = Query(None),
):
    """
    Generate a signed public link for a file with an expiration timestamp.
    Requires authentication when auth is enabled.
    """
    return _create_public_link(
        request=request,
        workspace=workspace,
        path=path,
        expires_in=expires_in,
        expires=expires,
        download=download,
        base_url=base_url,
    )


@router.get("/api/public/file")
@router.get("/api/public/files/{workspace}/{path:path}")
def get_public_file(
    request: Request,
    workspace: Optional[str] = None,
    path: Optional[str] = None,
    expires: Optional[int] = Query(None),
    signature: Optional[str] = Query(None),
    sig: Optional[str] = Query(None),
    download: bool = Query(False),
):
    """
    Access or download a file using a signed public link.
    Bypasses standard authentication using stateless SHA-256 HMAC verification.
    """
    ws = workspace or request.query_params.get("workspace")
    file_path_str = path or request.query_params.get("path") or request.query_params.get("file")
    signature_val = signature or sig or request.query_params.get("signature") or request.query_params.get("sig")
    expires_val = expires
    if expires_val is None:
        expires_param = request.query_params.get("expires") or request.query_params.get("exp")
        if expires_param is not None:
            try:
                expires_val = int(expires_param)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid expires parameter")

    if not ws:
        raise HTTPException(status_code=400, detail="Workspace parameter is required")
    if not file_path_str:
        raise HTTPException(status_code=400, detail="Path parameter is required")
    if expires_val is None:
        raise HTTPException(status_code=400, detail="Expires parameter is required")
    if not signature_val:
        raise HTTPException(status_code=403, detail="Signature is required")

    # 1. Verify signature and expiration
    is_valid, reason = verify_public_file_signature(ws, file_path_str, expires_val, signature_val)
    if not is_valid:
        if "expired" in reason.lower():
            raise HTTPException(status_code=410, detail=reason)
        raise HTTPException(status_code=403, detail=reason)

    # 2. Check path security and existence
    ws_clean = ws.strip().strip("/")
    if not ws_clean or "/" in ws_clean or ".." in ws_clean:
        raise HTTPException(status_code=400, detail="Invalid workspace name")

    base_p = get_base_workspace()
    ws_dir = safe_path(base_p, ws_clean)
    if not ws_dir.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    target_file = safe_path(str(ws_dir), file_path_str)
    if not target_file.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if target_file.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory, not a file")

    dl_flag = download
    if not dl_flag:
        dl_param = request.query_params.get("download", "").lower()
        if dl_param in ("1", "true", "yes"):
            dl_flag = True

    content_disposition_type = "attachment" if dl_flag else "inline"
    return FileResponse(
        path=str(target_file),
        filename=target_file.name,
        content_disposition_type=content_disposition_type,
        headers={"Access-Control-Allow-Origin": "*"},
    )


@router.api_route("/public/{workspace}", methods=["GET", "HEAD"])
@router.api_route("/public/{workspace}/", methods=["GET", "HEAD"])
@router.api_route("/public/{workspace}/{file_path:path}", methods=["GET", "HEAD"])
def get_public_workspace_content(
    workspace: str,
    request: Request,
    file_path: str = "",
    download: bool = Query(False),
):
    """
    Serve static files from the workspace's 'public' directory without authentication.
    - /public/$workspace and /public/$workspace/ serve index.html
    - /public/$workspace/... serves the corresponding file in $workspace/public/
    """
    # Backwards compatibility: if a signed file link was sent to /public/...
    if request.query_params.get("signature") or request.query_params.get("sig"):
        return get_public_file(
            request=request,
            workspace=workspace,
            path=file_path,
            download=download,
        )

    ws_clean = (workspace or "").strip().strip("/")
    if not ws_clean or "/" in ws_clean or ".." in ws_clean:
        raise HTTPException(status_code=400, detail="Invalid workspace name")

    base_p = get_base_workspace()
    ws_dir = safe_path(base_p, ws_clean)
    if not ws_dir.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    public_dir = safe_path(str(ws_dir), "public")
    if not public_dir.is_dir():
        raise HTTPException(status_code=404, detail="Public directory not found")

    clean_file_path = file_path.strip().lstrip("/")
    cors_headers = {"Access-Control-Allow-Origin": "*"}
    if not clean_file_path:
        index_file = public_dir / "index.html"
        if not index_file.is_file():
            raise HTTPException(status_code=404, detail="index.html not found")
        dl_flag = download or (request.query_params.get("download", "").lower() in ("1", "true", "yes"))
        return FileResponse(
            path=str(index_file),
            filename="index.html",
            media_type="text/html",
            content_disposition_type="attachment" if dl_flag else "inline",
            headers=cors_headers,
        )

    target_file = safe_path(str(public_dir), clean_file_path)
    if not target_file.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if target_file.is_dir():
        sub_index = target_file / "index.html"
        if sub_index.is_file():
            dl_flag = download or (request.query_params.get("download", "").lower() in ("1", "true", "yes"))
            return FileResponse(
                path=str(sub_index),
                filename="index.html",
                media_type="text/html",
                content_disposition_type="attachment" if dl_flag else "inline",
                headers=cors_headers,
            )
        raise HTTPException(status_code=404, detail="index.html not found in directory")

    dl_flag = download or (request.query_params.get("download", "").lower() in ("1", "true", "yes"))
    return FileResponse(
        path=str(target_file),
        filename=target_file.name,
        content_disposition_type="attachment" if dl_flag else "inline",
        headers=cors_headers,
    )

