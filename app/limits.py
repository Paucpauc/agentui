import os
import json
import asyncio
import logging
from typing import Optional, Dict, Any, List, Set
from datetime import datetime, timezone

from app.config import get_agent_bin

logger = logging.getLogger("agent-webui")

DEFAULT_INTERVAL_SECONDS = int(os.environ.get("LIMITS_REFRESH_INTERVAL", 1200))  # 20 minutes


def parse_usage_output(output_str: str) -> Dict[str, Any]:
    """
    Parses the JSON output from `agent --output-format json --print "/usage"`.
    Extracts 5-hour and weekly limits for groups (Gemini Models, Claude and GPT, etc.)
    and determines the primary limits for display in the header.
    """
    if not output_str or not output_str.strip():
        raise ValueError("Empty output from agent /usage")

    data = json.loads(output_str.strip())
    command_data = data.get("command", {}).get("data", {})
    groups_data = command_data.get("groups", [])
    raw_desc = command_data.get("description", "")

    parsed_groups: List[Dict[str, Any]] = []
    primary_group: Optional[Dict[str, Any]] = None

    for g in groups_data:
        g_name = g.get("name", "Unknown")
        g_desc = g.get("description", "")
        buckets: List[Dict[str, Any]] = []
        five_h_bucket: Optional[Dict[str, Any]] = None
        weekly_bucket: Optional[Dict[str, Any]] = None

        for b in g.get("buckets", []):
            b_id = b.get("id", "")
            b_name = b.get("name", "")
            b_window = b.get("window", "")
            raw_fraction = b.get("remaining_fraction", 0.0)
            try:
                rem_fraction = float(raw_fraction)
            except (ValueError, TypeError):
                rem_fraction = 0.0

            # Convert 0.0-1.0 fraction to integer percent (0-100)
            percent = max(0, min(100, round(rem_fraction * 100)))
            reset_time = b.get("reset_time", "")
            b_desc = b.get("description", "")

            b_info = {
                "id": b_id,
                "name": b_name,
                "window": b_window,
                "remaining_fraction": rem_fraction,
                "percent": percent,
                "reset_time": reset_time,
                "description": b_desc,
            }
            buckets.append(b_info)

            # Match 5-hour and weekly windows
            if b_window == "5h" or "5h" in b_id or "5-hour" in b_name.lower() or "five hour" in b_name.lower():
                five_h_bucket = b_info
            elif b_window == "weekly" or "week" in b_id or "weekly" in b_name.lower():
                weekly_bucket = b_info

        group_info = {
            "name": g_name,
            "description": g_desc,
            "buckets": buckets,
            "five_hour": five_h_bucket,
            "weekly": weekly_bucket,
        }
        parsed_groups.append(group_info)

        # Primary selection: prefer group containing 'gemini', else first available group
        if primary_group is None:
            primary_group = group_info
        elif "gemini" in g_name.lower():
            primary_group = group_info

    primary_summary: Optional[Dict[str, Any]] = None
    if primary_group:
        primary_summary = {
            "group_name": primary_group["name"],
            "five_hour": primary_group.get("five_hour"),
            "weekly": primary_group.get("weekly"),
        }

    return {
        "status": "ok",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "primary": primary_summary,
        "groups": parsed_groups,
        "raw_description": raw_desc,
    }


class LimitsService:
    def __init__(self, interval_seconds: int = DEFAULT_INTERVAL_SECONDS):
        self.interval_seconds = interval_seconds
        self.last_data: Optional[Dict[str, Any]] = None
        self.last_error: Optional[str] = None
        self.is_updating: bool = False
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None
        self._last_refresh_loop_time: float = 0.0
        self._active_sessions: Set[Any] = set()

    def register_pty_session(self, session_id: Any) -> None:
        """
        Registers an active TTY/PTY session.
        If cache is stale or uninitialized, proactively triggers an update.
        """
        self._active_sessions.add(session_id)
        logger.info(f"PTY session connected: {session_id} (active TTY sessions: {len(self._active_sessions)})")
        try:
            loop = asyncio.get_running_loop()
            now = loop.time()
            if self._last_refresh_loop_time == 0.0 or (now - self._last_refresh_loop_time >= self.interval_seconds):
                asyncio.create_task(self.refresh(force=True))
        except RuntimeError:
            pass

    def unregister_pty_session(self, session_id: Any) -> None:
        """Unregisters a closed TTY/PTY session."""
        self._active_sessions.discard(session_id)
        logger.info(f"PTY session disconnected: {session_id} (active TTY sessions: {len(self._active_sessions)})")

    def has_active_pty_sessions(self) -> bool:
        """Returns True if at least one active TTY session is connected."""
        return len(self._active_sessions) > 0

    @property
    def active_session_count(self) -> int:
        return len(self._active_sessions)

    async def fetch_limits(self) -> Dict[str, Any]:
        """
        Executes agent CLI command to retrieve limits and parses result.
        """
        agent_bin = get_agent_bin()
        cmd = [agent_bin, "--output-format", "json", "--print", "/usage"]
        logger.info(f"Executing limits fetch command: {' '.join(cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=os.environ.copy()
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=45.0)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            raise TimeoutError("Timeout waiting for agent /usage command")

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"agent /usage exited with code {proc.returncode}: {err_msg}")

        out_str = stdout.decode("utf-8", errors="replace").strip()
        return parse_usage_output(out_str)

    async def refresh(self, force: bool = False) -> Dict[str, Any]:
        """
        Refreshes limits. If force is False and limits were updated within the last 10 seconds,
        returns the cached data. Uses an asyncio lock to ensure concurrent requests
        wait for the ongoing fetch instead of spawning duplicate processes.
        """
        async with self._lock:
            now = asyncio.get_event_loop().time()
            if not force and self.last_data and (now - self._last_refresh_loop_time < 10.0):
                return self.get_data()

            self.is_updating = True
            try:
                result = await self.fetch_limits()
                self.last_data = result
                self.last_error = None
                self._last_refresh_loop_time = now
                logger.info("Limits refreshed successfully.")
            except Exception as e:
                logger.warning(f"Failed to refresh limits: {e}")
                self.last_error = str(e)
                if not self.last_data:
                    self.last_data = {
                        "status": "error",
                        "error": str(e),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "primary": None,
                        "groups": [],
                    }
                else:
                    self.last_data["error"] = str(e)
            finally:
                self.is_updating = False

            return self.get_data()

    def get_data(self) -> Dict[str, Any]:
        """Returns the current data or a default initial state."""
        if self.last_data is not None:
            data = dict(self.last_data)
            data["is_updating"] = self.is_updating
            data["active_tty_sessions"] = self.active_session_count
            if self.last_error:
                data["last_error"] = self.last_error
            return data

        return {
            "status": "pending",
            "is_updating": self.is_updating,
            "active_tty_sessions": self.active_session_count,
            "updated_at": None,
            "primary": None,
            "groups": [],
        }

    async def _background_loop(self):
        """
        Background update loop: runs every interval_seconds (default 20 minutes),
        but ONLY executes a refresh when at least one active TTY session exists.
        """
        logger.info(f"Limits background loop initialized (interval={self.interval_seconds}s, condition=active_tty_session)")
        while True:
            try:
                await asyncio.sleep(self.interval_seconds)
            except asyncio.CancelledError:
                break

            try:
                if self.has_active_pty_sessions():
                    logger.info(f"Active TTY session(s) detected ({self.active_session_count}). Refreshing limits in background...")
                    await self.refresh(force=True)
                else:
                    logger.info("Skipping background limits refresh: no active TTY sessions.")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in limits background loop: {e}")

        logger.info("Limits background refresh loop stopped.")

    def start(self):
        """Starts the background task if not already running."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._background_loop())

    def stop(self):
        """Cancels and stops the background task."""
        if self._task and not self._task.done():
            self._task.cancel()


limits_service = LimitsService(interval_seconds=DEFAULT_INTERVAL_SECONDS)
