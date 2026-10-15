import logging
from pathlib import Path
from typing import Optional, Union
from fastapi import HTTPException, Request

from app.config import get_base_workspace

logger = logging.getLogger("agent-webui")


def safe_path(base: Union[str, Path, None], path: str) -> Path:
    """
    Safely resolves a path relative to the base directory (defaults to current base workspace).
    Prevents path traversal vulnerabilities.
    """
    if base is None:
        base_p = get_base_workspace()
    else:
        base_p = Path(base).resolve()
    target_p = (base_p / path.lstrip("/")).resolve()
    try:
        target_p.relative_to(base_p)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: path outside workspace")
    return target_p


def cleanup_file(path: str):
    """Safely removes a temporary file."""
    try:
        p = Path(path)
        if p.is_file():
            p.unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"Failed to remove temporary file {path}: {e}")


def get_request_base_url(request: Request, client_base_url: Optional[str] = None) -> str:
    """
    Determine the effective base URL taking into account reverse proxy headers
    (X-Forwarded-Proto, X-Forwarded-Host, X-Forwarded-Port, Forwarded) or client-supplied base_url.
    """
    if client_base_url and client_base_url.strip():
        b = client_base_url.strip().rstrip("/")
        if b.startswith("http://") or b.startswith("https://"):
            return b

    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_port = request.headers.get("x-forwarded-port")

    forwarded_header = request.headers.get("forwarded")
    if forwarded_header and not (forwarded_proto and forwarded_host):
        for part in forwarded_header.split(";"):
            part = part.strip()
            if part.lower().startswith("proto=") and not forwarded_proto:
                forwarded_proto = part[6:].strip('"')
            elif part.lower().startswith("host=") and not forwarded_host:
                forwarded_host = part[5:].strip('"')

    proto = forwarded_proto.split(",")[0].strip() if forwarded_proto else None
    host = forwarded_host.split(",")[0].strip() if forwarded_host else None

    if not proto:
        proto = request.url.scheme
    if not host:
        host = request.headers.get("host") or request.url.netloc

    if host:
        if forwarded_port and ":" not in host:
            f_port = forwarded_port.split(",")[0].strip()
            if (proto == "http" and f_port != "80") or (proto == "https" and f_port != "443"):
                host = f"{host}:{f_port}"
        return f"{proto}://{host}".rstrip("/")

    return str(request.base_url).rstrip("/")
