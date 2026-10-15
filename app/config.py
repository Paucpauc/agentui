import os
import sys
from pathlib import Path

# Workspace directory default
BASE_WORKSPACE = os.environ.get("WORKSPACE_BASE", "/workspaces")

# Agent CLI settings
AGENT_BIN = os.environ.get("AGENT_BIN", "agent")
AGENT_ARGS = os.environ.get("AGENT_ARGS", "--dangerously-skip-permissions")

# File upload and extraction limits
MAX_UPLOAD_SIZE = 200 * 1024 * 1024  # 200 MB
MAX_EXTRACT_SIZE = 500 * 1024 * 1024  # 500 MB
MAX_FILE_COUNT = 10000


def get_base_workspace() -> Path:
    """
    Returns the effective BASE_WORKSPACE as a resolved Path.
    Checks sys.modules['app.main'].BASE_WORKSPACE first so that
    monkeypatching `app.main.BASE_WORKSPACE` in tests works seamlessly.
    """
    app_main = sys.modules.get("app.main")
    if app_main and hasattr(app_main, "BASE_WORKSPACE"):
        return Path(app_main.BASE_WORKSPACE).resolve()
    return Path(BASE_WORKSPACE).resolve()


def get_agent_bin() -> str:
    app_main = sys.modules.get("app.main")
    if app_main and hasattr(app_main, "AGENT_BIN"):
        return str(app_main.AGENT_BIN)
    return AGENT_BIN


def get_agent_args() -> str:
    app_main = sys.modules.get("app.main")
    if app_main and hasattr(app_main, "AGENT_ARGS"):
        return str(app_main.AGENT_ARGS)
    return AGENT_ARGS
