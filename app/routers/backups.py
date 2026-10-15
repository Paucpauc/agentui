import os
import shutil
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_base_workspace
from app.utils import safe_path

logger = logging.getLogger("agent-webui")
router = APIRouter(tags=["backups"])


class CreateBackupRequest(BaseModel):
    workspace: str
    note: Optional[str] = None


class RestoreBackupRequest(BaseModel):
    workspace: str
    backup_path: str


def create_safety_backup_snapshot(ws_path: Path) -> str:
    """
    Creates a snapshot of the current workspace in ws_path/.backup/{datetime}/
    ignoring the .backup folder itself. Returns the snapshot folder name.
    """
    backup_root = ws_path / ".backup"
    backup_root.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    dt_str = now.strftime("%Y-%m-%d_%H-%M-%S")
    target_dir = backup_root / dt_str

    if target_dir.exists():
        dt_str = now.strftime("%Y-%m-%d_%H-%M-%S_%f")
        target_dir = backup_root / dt_str

    target_dir.mkdir(parents=True, exist_ok=True)

    for entry in ws_path.iterdir():
        if entry.name == ".backup":
            continue
        dest = target_dir / entry.name
        if entry.is_dir():
            shutil.copytree(entry, dest, symlinks=True, ignore=shutil.ignore_patterns(".backup"))
        else:
            shutil.copy2(entry, dest, follow_symlinks=False)

    return dt_str


@router.get("/api/backups")
def list_backups(workspace: str = Query(...)):
    """List available backup snapshots for a workspace"""
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    backup_root = ws_path / ".backup"
    items = []
    if backup_root.is_dir():
        for entry in sorted(backup_root.iterdir(), key=lambda x: x.name, reverse=True):
            if entry.is_dir() and not entry.name.startswith("."):
                items.append({
                    "name": entry.name,
                    "path": f".backup/{entry.name}",
                    "mtime": entry.stat().st_mtime,
                })

    return {"workspace": workspace, "backups": items}


@router.post("/api/backups")
def create_backup(req: CreateBackupRequest):
    """
    Create a quick backup of the entire workspace into .backup/{datetime}/.
    The .backup folder itself is excluded from the backup.
    """
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, req.workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    try:
        backup_name = create_safety_backup_snapshot(ws_path)
        logger.info(f"Created backup '{backup_name}' for workspace '{req.workspace}'")
        return {
            "status": "ok",
            "workspace": req.workspace,
            "backup": backup_name,
            "path": f".backup/{backup_name}",
        }
    except Exception as e:
        logger.error(f"Failed to create backup for workspace '{req.workspace}': {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create backup: {str(e)}")


@router.post("/api/backups/restore")
def restore_backup(req: RestoreBackupRequest):
    """
    Restore either the entire workspace from .backup/{datetime} or a specific
    file/folder from .backup/{datetime}/{sub_path}.
    Before restoring, always creates a safety backup of the current workspace state
    with the current datetime so no data is accidentally lost.
    """
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, req.workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    backup_root = ws_path / ".backup"
    if not backup_root.is_dir():
        raise HTTPException(status_code=404, detail="No backups found in workspace")

    clean_backup_path = req.backup_path.strip().strip("/")
    src_path = safe_path(str(ws_path), clean_backup_path)

    if not src_path.exists():
        raise HTTPException(status_code=404, detail="Backup source path not found")

    # Verify src_path is strictly inside ws_path/.backup
    try:
        rel_to_backup = src_path.resolve().relative_to(backup_root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path must be inside .backup")

    if rel_to_backup == Path("."):
        raise HTTPException(status_code=400, detail="Cannot restore .backup root folder itself")

    parts = rel_to_backup.parts
    snapshot_name = parts[0]
    snapshot_dir = backup_root / snapshot_name

    if not snapshot_dir.is_dir():
        raise HTTPException(status_code=400, detail="Invalid backup snapshot directory")

    is_full_workspace = (len(parts) == 1)
    sub_rel = Path(*parts[1:]) if not is_full_workspace else None

    try:
        # Step 1: Always create safety backup of current workspace state
        safety_name = create_safety_backup_snapshot(ws_path)
        logger.info(f"Created safety backup '{safety_name}' before restore on '{req.workspace}'")

        # Step 2: Perform restore
        if is_full_workspace:
            # Full workspace restore:
            # Remove all files and directories in ws_path EXCEPT .backup
            for entry in list(ws_path.iterdir()):
                if entry.name == ".backup":
                    continue
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()

            # Copy all files and directories from snapshot_dir into ws_path
            for entry in snapshot_dir.iterdir():
                if entry.name == ".backup":
                    continue
                dest = ws_path / entry.name
                if entry.is_dir():
                    shutil.copytree(entry, dest, symlinks=True, ignore=shutil.ignore_patterns(".backup"))
                else:
                    shutil.copy2(entry, dest, follow_symlinks=False)
        else:
            # Restore specific file or folder
            dest_target = safe_path(str(ws_path), str(sub_rel))
            if dest_target == ws_path:
                raise HTTPException(status_code=400, detail="Cannot restore to workspace root")

            if dest_target.exists():
                if dest_target.is_dir():
                    shutil.rmtree(dest_target)
                else:
                    dest_target.unlink()

            dest_target.parent.mkdir(parents=True, exist_ok=True)
            if src_path.is_dir():
                shutil.copytree(src_path, dest_target, symlinks=True, ignore=shutil.ignore_patterns(".backup"))
            else:
                shutil.copy2(src_path, dest_target, follow_symlinks=False)

        return {
            "status": "ok",
            "workspace": req.workspace,
            "restored": clean_backup_path,
            "is_full_workspace": is_full_workspace,
            "safety_backup": safety_name,
            "safety_path": f".backup/{safety_name}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Restore failed on '{req.workspace}': {e}")
        raise HTTPException(status_code=500, detail=f"Failed to restore: {str(e)}")


@router.delete("/api/backups")
def delete_backup(workspace: str = Query(...), backup: str = Query(...)):
    """Delete a backup snapshot or file/folder inside .backup"""
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    backup_root = ws_path / ".backup"
    if not backup_root.is_dir():
        raise HTTPException(status_code=404, detail="No backups found in workspace")

    clean_backup = backup.strip().strip("/")
    target = safe_path(str(backup_root), clean_backup)

    try:
        target.resolve().relative_to(backup_root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Target is outside .backup")

    if target.resolve() == backup_root.resolve():
        raise HTTPException(status_code=400, detail="Cannot delete .backup root directory")

    if not target.exists():
        raise HTTPException(status_code=404, detail="Backup item not found")

    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return {"status": "ok", "deleted": clean_backup}
    except Exception as e:
        logger.error(f"Failed to delete backup item '{clean_backup}' in '{workspace}': {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete backup item: {str(e)}")
