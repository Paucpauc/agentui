import os
import pty
import select
import struct
import fcntl
import termios
import asyncio
import logging
import shlex
import json
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from app.auth import is_auth_enabled, get_authenticated_user_from_headers
from app.config import get_base_workspace, get_agent_bin, get_agent_args
from app.utils import safe_path
from app.limits import limits_service


try:
    from watchfiles import awatch
except ImportError:
    awatch = None

logger = logging.getLogger("agent-webui")
router = APIRouter(tags=["websockets"])


@router.websocket("/ws/files")
async def websocket_file_watcher(websocket: WebSocket, workspace: Optional[str] = None):
    if is_auth_enabled():
        user = get_authenticated_user_from_headers(
            dict(websocket.headers),
            websocket.cookies,
            dict(websocket.query_params),
        )
        if not user:
            await websocket.close(code=1008, reason="Unauthorized")
            return

    await websocket.accept()

    if not workspace:
        await websocket.close(code=1008, reason="Workspace required")
        return

    base_p = get_base_workspace()
    try:
        ws_path = safe_path(base_p, workspace)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid workspace")
        return

    if not ws_path.is_dir():
        await websocket.close(code=1008, reason="Workspace not found")
        return

    if awatch is None:
        logger.warning("watchfiles not installed; file watcher WebSocket inactive")
        try:
            while True:
                await asyncio.sleep(60)
        except WebSocketDisconnect:
            pass
        return

    async def watch_filesystem():
        try:
            async for changes in awatch(ws_path, debounce=200, step=100):
                valid_changes = []
                for change_type, path_str in changes:
                    p = Path(path_str)
                    try:
                        rel = p.relative_to(ws_path)
                        if any(part.startswith(".git") for part in rel.parts):
                            continue
                        valid_changes.append({"type": change_type.name, "path": str(rel)})
                    except ValueError:
                        continue

                if valid_changes:
                    await websocket.send_json({
                        "type": "files_changed",
                        "workspace": workspace,
                        "changes": valid_changes,
                    })
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"File watcher error for {workspace}: {e}")

    async def client_listener():
        try:
            while True:
                msg = await websocket.receive_text()
                if msg == "ping":
                    await websocket.send_text("pong")
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    watcher_task = asyncio.create_task(watch_filesystem())
    listener_task = asyncio.create_task(client_listener())

    done, pending = await asyncio.wait(
        [watcher_task, listener_task],
        return_when=asyncio.FIRST_COMPLETED
    )

    for task in pending:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


@router.websocket("/ws/pty")
async def websocket_pty(websocket: WebSocket, workspace: Optional[str] = None, prompt: Optional[str] = None):
    if is_auth_enabled():
        user = get_authenticated_user_from_headers(
            dict(websocket.headers),
            websocket.cookies,
            dict(websocket.query_params),
        )
        if not user:
            await websocket.close(code=1008, reason="Unauthorized")
            return

    await websocket.accept()

    session_id = id(websocket)
    limits_service.register_pty_session(session_id)
    try:
        base_p = get_base_workspace()
        ws_dir = str(safe_path(base_p, workspace)) if workspace else str(base_p)
        if not os.path.isdir(ws_dir):
            os.makedirs(ws_dir, exist_ok=True)

        master_fd, slave_fd = pty.openpty()

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["HOME"] = os.path.expanduser("~")
        env["LANG"] = "en_US.UTF-8"
        env["LC_ALL"] = "en_US.UTF-8"

        agent_bin = get_agent_bin()
        agent_args = get_agent_args()

        # Start agent in interactive mode or bash fallback
        cmd = [agent_bin]
        if agent_args.strip():
            cmd.extend(shlex.split(agent_args.strip()))
        if prompt and prompt.strip():
            cmd.extend(["-i", prompt.strip()])

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=ws_dir,
                env=env,
                preexec_fn=os.setsid
            )
        except Exception as e:
            logger.warning(f"Failed to start {agent_bin}: {e}. Falling back to /bin/bash")
            proc = await asyncio.create_subprocess_exec(
                "/bin/bash",
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=ws_dir,
                env=env,
                preexec_fn=os.setsid
            )

        os.close(slave_fd)

        # Set non-blocking on master_fd
        fl = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        loop = asyncio.get_event_loop()

        async def pty_to_ws():
            try:
                while True:
                    # Wait for master_fd to be ready to read
                    await loop.run_in_executor(None, select.select, [master_fd], [], [], 0.1)
                    try:
                        data = os.read(master_fd, 4096)
                        if not data:
                            break
                        await websocket.send_bytes(data)
                    except (BlockingIOError, InterruptedError):
                        await asyncio.sleep(0.01)
                        continue
            except Exception:
                pass

        async def ws_to_pty():
            try:
                while True:
                    msg = await websocket.receive()
                    if "bytes" in msg and msg["bytes"]:
                        os.write(master_fd, msg["bytes"])
                    elif "text" in msg and msg["text"]:
                        text = msg["text"]
                        # Check for resize event format: {"type": "resize", "cols": 80, "rows": 24}
                        if text.startswith("{") and "resize" in text:
                            try:
                                payload = json.loads(text)
                                if payload.get("type") == "resize":
                                    cols = int(payload.get("cols", 80))
                                    rows = int(payload.get("rows", 24))
                                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                                    continue
                            except Exception:
                                pass
                        os.write(master_fd, text.encode("utf-8"))
            except WebSocketDisconnect:
                pass
            except Exception:
                pass

        reader_task = asyncio.create_task(pty_to_ws())
        writer_task = asyncio.create_task(ws_to_pty())

        done, pending = await asyncio.wait(
            [reader_task, writer_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        for task in pending:
            task.cancel()

        try:
            os.close(master_fd)
        except Exception:
            pass

        try:
            proc.terminate()
            await proc.wait()
        except Exception:
            pass
    finally:
        limits_service.unregister_pty_session(session_id)

