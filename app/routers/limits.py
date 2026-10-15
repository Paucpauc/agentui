import logging
from fastapi import APIRouter, Query
from app.limits import limits_service

logger = logging.getLogger("agent-webui")
router = APIRouter(tags=["limits"])


@router.get("/api/limits")
async def get_limits(refresh: bool = Query(False, description="Force immediate refresh")):
    """
    Returns current remaining 5-hour and weekly limits.
    If refresh=true, forces an immediate update from agent CLI.
    If no data has been cached yet, performs an initial refresh.
    """
    if refresh:
        return await limits_service.refresh(force=True)

    if limits_service.last_data is None:
        return await limits_service.refresh()

    return limits_service.get_data()


@router.post("/api/limits/refresh")
async def refresh_limits():
    """
    Triggers an immediate background/API refresh of limits and returns the result.
    """
    return await limits_service.refresh(force=True)
