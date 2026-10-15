import os
import hmac
import time
import base64
import secrets
import hashlib
import logging
from pathlib import Path
from typing import Optional, Tuple
from dotenv import load_dotenv

logger = logging.getLogger("agent-webui.auth")

# Locate and load .env file at import time if present
for candidate in [
    Path(".env"),
    Path(__file__).resolve().parent.parent / ".env",
    Path("/app/.env"),
]:
    if candidate.exists() and candidate.is_file():
        load_dotenv(dotenv_path=candidate)
        break
else:
    load_dotenv()

# In-memory storage for revoked sessions
_revoked_tokens: set = set()
_ephemeral_secret: str = secrets.token_hex(32)

SESSION_COOKIE_NAME = "agent_session"
DEFAULT_SESSION_MAX_AGE = 7 * 24 * 3600  # 7 days


def reload_env():
    """Reload environment from .env file (useful for dynamic changes or testing)"""
    for candidate in [
        Path(".env"),
        Path(__file__).resolve().parent.parent / ".env",
        Path("/app/.env"),
    ]:
        if candidate.exists() and candidate.is_file():
            load_dotenv(dotenv_path=candidate, override=True)
            break


def get_auth_config() -> Tuple[str, str, str, bool]:
    """
    Returns (username, password, secret_key, is_enabled).
    Supports AUTH_USERNAME, AUTH_USER, WEBUI_USER, LOGIN, etc.
    """
    username = (
        os.environ.get("AUTH_USERNAME")
        or os.environ.get("AUTH_USER")
        or os.environ.get("WEBUI_USER")
        or os.environ.get("LOGIN")
        or os.environ.get("AUTH_LOGIN")
        or ""
    ).strip()

    password = (
        os.environ.get("AUTH_PASSWORD")
        or os.environ.get("AUTH_PASS")
        or os.environ.get("WEBUI_PASSWORD")
        or os.environ.get("PASSWORD")
        or ""
    ).strip()

    secret = (
        os.environ.get("AUTH_SECRET_KEY")
        or os.environ.get("SECRET_KEY")
        or _ephemeral_secret
    ).strip()

    enabled_env = os.environ.get("AUTH_ENABLED")
    if enabled_env is not None:
        enabled = enabled_env.strip().lower() in ("1", "true", "yes", "on")
    else:
        # Enabled by default if either username or password is set
        enabled = bool(username or password)

    return username, password, secret, enabled


def is_auth_enabled() -> bool:
    _, _, _, enabled = get_auth_config()
    return enabled


def verify_credentials(username: str, password: str) -> bool:
    cfg_user, cfg_pass, _, enabled = get_auth_config()
    if not enabled:
        return True
    if not cfg_user and not cfg_pass:
        return True

    user_matches = secrets.compare_digest(username.encode("utf-8"), cfg_user.encode("utf-8"))
    pass_matches = secrets.compare_digest(password.encode("utf-8"), cfg_pass.encode("utf-8"))
    return user_matches and pass_matches


def _generate_signature(session_id: str, timestamp: int, username: str, secret: str) -> str:
    msg = f"{session_id}:{timestamp}:{username}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def create_session(username: str) -> str:
    _, _, secret, _ = get_auth_config()
    session_id = secrets.token_hex(16)
    timestamp = int(time.time())
    sig = _generate_signature(session_id, timestamp, username, secret)
    return f"{session_id}.{timestamp}.{username}.{sig}"


def verify_session(token: str, max_age: int = DEFAULT_SESSION_MAX_AGE) -> Optional[str]:
    if not token or token in _revoked_tokens:
        return None

    parts = token.split(".")
    if len(parts) != 4:
        return None

    session_id, ts_str, username, sig = parts
    try:
        ts = int(ts_str)
    except ValueError:
        return None

    # Check expiration and timestamp tampering
    now = time.time()
    if now - ts > max_age or ts > now + 300:
        return None

    _, _, secret, _ = get_auth_config()
    expected_sig = _generate_signature(session_id, ts, username, secret)
    if not secrets.compare_digest(sig, expected_sig):
        return None

    return username


def revoke_session(token: str):
    if token:
        _revoked_tokens.add(token)


def get_authenticated_user_from_headers(
    headers: dict,
    cookies: dict,
    query_params: dict
) -> Optional[str]:
    """
    Check cookies, Authorization headers (Bearer), or query params.
    Returns username if authenticated, None otherwise.
    """
    if not is_auth_enabled():
        return "anonymous"

    header_lookup = {k.lower(): v for k, v in headers.items()}

    # 1. Check Session Cookie
    cookie_token = cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        user = verify_session(cookie_token)
        if user:
            return user

    # 2. Check Authorization Header
    auth_header = header_lookup.get("authorization")
    if auth_header:
        auth_type, _, auth_val = auth_header.partition(" ")
        auth_type = auth_type.lower()
        if auth_type == "bearer":
            user = verify_session(auth_val.strip())
            if user:
                return user

    # 3. Check query param (e.g. for WebSocket connections)
    param_token = query_params.get("session_token") or query_params.get("token")
    if param_token:
        user = verify_session(param_token)
        if user:
            return user

    return None


def get_public_link_secret() -> str:
    """
    Returns the secret key used for signing public file links.
    Reads PUBLIC_LINK_SECRET from environment/.env, falling back to
    AUTH_SECRET_KEY, SECRET_KEY, or ephemeral secret.
    """
    secret = (
        os.environ.get("PUBLIC_LINK_SECRET")
        or os.environ.get("AUTH_SECRET_KEY")
        or os.environ.get("SECRET_KEY")
        or _ephemeral_secret
    ).strip()
    return secret


def normalize_workspace_and_path(workspace: str, path: str) -> Tuple[str, str]:
    """
    Normalizes workspace name and relative file path for deterministic signing.
    """
    ws_clean = (workspace or "").strip().strip("/")
    norm_path = (path or "").replace("\\", "/").strip().lstrip("/")
    parts = [p for p in norm_path.split("/") if p and p != "."]
    file_clean = "/".join(parts)
    return ws_clean, file_clean


def generate_public_file_signature(
    workspace: str,
    path: str,
    expires: int,
    secret: Optional[str] = None,
) -> str:
    """
    Generates SHA-256 HMAC signature for workspace, file path, and expiration timestamp.
    No database required - fully stateless.
    """
    if secret is None:
        secret = get_public_link_secret()
    ws_clean, file_clean = normalize_workspace_and_path(workspace, path)
    msg = f"{ws_clean}:{file_clean}:{expires}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verify_public_file_signature(
    workspace: str,
    path: str,
    expires: int,
    signature: str,
    secret: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Verifies that the public link signature matches and expiration timestamp has not passed.
    Returns (is_valid, reason).
    """
    if not signature:
        return False, "Signature is required"

    try:
        expires_ts = int(expires)
    except (ValueError, TypeError):
        return False, "Invalid expires timestamp"

    now = int(time.time())
    if now > expires_ts:
        return False, "Public link has expired"

    if secret is None:
        secret = get_public_link_secret()

    expected_sig = generate_public_file_signature(workspace, path, expires_ts, secret=secret)
    if not secrets.compare_digest(signature, expected_sig):
        return False, "Invalid signature"

    return True, "ok"

