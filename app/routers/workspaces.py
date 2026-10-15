import os
import re
import shutil
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.config import (
    get_base_workspace,
    MAX_UPLOAD_SIZE,
    MAX_EXTRACT_SIZE,
    MAX_FILE_COUNT,
)
from app.schemas import CreateDirRequest, RenameWorkspaceRequest
from app.utils import safe_path, cleanup_file

logger = logging.getLogger("agent-webui")
router = APIRouter(tags=["workspaces"])


@router.get("/api/workspaces")
def list_workspaces():
    """List subdirectories in base workspace"""
    items = []
    base_p = get_base_workspace()
    if base_p.exists():
        for entry in sorted(base_p.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                items.append(entry.name)
    return {"base": str(base_p), "workspaces": items}


@router.post("/api/workspaces")
def create_workspace(req: CreateDirRequest):
    folder_name = req.name.strip()
    if not folder_name or "/" in folder_name or ".." in folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    base_p = get_base_workspace()
    target = safe_path(base_p, folder_name)
    target.mkdir(parents=True, exist_ok=True)

    agents_file = target / "AGENTS.md"
    if not agents_file.exists():
        agents_file.write_text("@../AGENTS.md\n", encoding="utf-8")

    return {"status": "ok", "name": folder_name, "path": str(target)}


@router.delete("/api/workspaces/{workspace_name:path}")
@router.delete("/api/workspaces")
def delete_workspace(workspace_name: Optional[str] = None, workspace: Optional[str] = None):
    ws = workspace or workspace_name
    if not ws:
        raise HTTPException(status_code=400, detail="Workspace name is required")

    ws_clean = ws.strip().strip("/")
    if not ws_clean or "/" in ws_clean or ".." in ws_clean or "\\" in ws_clean:
        raise HTTPException(status_code=400, detail="Invalid workspace name")

    base_p = get_base_workspace()
    target = safe_path(base_p, ws_clean)

    if target == base_p:
        raise HTTPException(status_code=400, detail="Cannot delete base workspace")

    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    try:
        shutil.rmtree(target)
        return {"status": "ok", "deleted": ws_clean}
    except Exception as e:
        logger.error(f"Failed to delete workspace {ws_clean}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete workspace: {str(e)}")


@router.post("/api/workspaces/delete")
def delete_workspace_post(req: CreateDirRequest):
    return delete_workspace(workspace=req.name)


@router.post("/api/workspaces/rename")
def rename_workspace(req: RenameWorkspaceRequest):
    old_clean = req.old_name.strip().strip("/")
    new_clean = req.new_name.strip().strip("/")

    if not old_clean or "/" in old_clean or ".." in old_clean or "\\" in old_clean:
        raise HTTPException(status_code=400, detail="Invalid current workspace name")
    if not new_clean or "/" in new_clean or ".." in new_clean or "\\" in new_clean:
        raise HTTPException(status_code=400, detail="Invalid new workspace name")

    if old_clean == new_clean:
        return {"status": "ok", "old_name": old_clean, "new_name": new_clean}

    base_p = get_base_workspace()
    old_target = safe_path(base_p, old_clean)
    new_target = safe_path(base_p, new_clean)

    if old_target == base_p or new_target == base_p:
        raise HTTPException(status_code=400, detail="Cannot rename base workspace")

    if not old_target.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    if new_target.exists():
        raise HTTPException(status_code=400, detail="A workspace with that name already exists")

    try:
        shutil.move(str(old_target), str(new_target))
        return {"status": "ok", "old_name": old_clean, "new_name": new_clean}
    except Exception as e:
        logger.error(f"Failed to rename workspace {old_clean} to {new_clean}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to rename workspace: {str(e)}")


@router.post("/api/workspaces/{workspace_name:path}/rename")
def rename_workspace_path(workspace_name: str, req: CreateDirRequest):
    return rename_workspace(RenameWorkspaceRequest(old_name=workspace_name, new_name=req.name))


@router.get("/api/workspaces/download")
@router.get("/api/workspaces/{workspace_name:path}/download")
def download_workspace(workspace_name: Optional[str] = None, workspace: Optional[str] = None, include_git: bool = False):
    ws = workspace or workspace_name
    if not ws:
        raise HTTPException(status_code=400, detail="Workspace name is required")

    ws_clean = ws.strip().strip("/")
    if not ws_clean or "/" in ws_clean or ".." in ws_clean or "\\" in ws_clean:
        raise HTTPException(status_code=400, detail="Invalid workspace name")

    base_p = get_base_workspace()
    ws_path = safe_path(base_p, ws_clean)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip_path = temp_zip.name
    temp_zip.close()

    try:
        with zipfile.ZipFile(temp_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(ws_path):
                dirs[:] = [d for d in dirs if d != ".backup" and (include_git or not d.startswith(".git"))]

                rel_root = Path(root).relative_to(ws_path)
                if rel_root != Path("."):
                    zf.write(root, arcname=rel_root.as_posix())

                for f in sorted(files):
                    if f == ".backup" or (not include_git and f.startswith(".git")):
                        continue
                    file_full = Path(root) / f
                    if file_full.is_symlink():
                        try:
                            resolved = file_full.resolve()
                            resolved.relative_to(ws_path.resolve())
                        except ValueError:
                            continue
                    arcname = (rel_root / f).as_posix() if rel_root != Path(".") else f
                    zf.write(file_full, arcname=arcname)
    except Exception as e:
        cleanup_file(temp_zip_path)
        logger.error(f"Failed to create zip for workspace {ws_clean}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create zip archive: {str(e)}")

    return FileResponse(
        path=temp_zip_path,
        media_type="application/zip",
        filename=f"{ws_clean}.zip",
        background=BackgroundTask(cleanup_file, temp_zip_path)
    )


@router.post("/api/workspaces/upload")
@router.post("/api/workspaces/{workspace_name:path}/upload")
async def upload_workspace(
    file: UploadFile = File(...),
    workspace: Optional[str] = Form(None),
    workspace_name: Optional[str] = None,
    overwrite: bool = Form(True),
):
    ws = workspace or workspace_name
    if not ws:
        if file.filename:
            raw_name = re.sub(r'\.zip$', '', file.filename, flags=re.IGNORECASE)
            ws = re.sub(r'[/\\?%*:|"<>]+', '_', raw_name).strip('. ')
        if not ws:
            raise HTTPException(status_code=400, detail="Workspace name is required or could not be determined")

    ws_clean = ws.strip().strip("/")
    if not ws_clean or "/" in ws_clean or ".." in ws_clean or "\\" in ws_clean:
        raise HTTPException(status_code=400, detail="Invalid workspace name")

    base_p = get_base_workspace()
    target_ws = safe_path(base_p, ws_clean)
    target_ws.mkdir(parents=True, exist_ok=True)

    temp_upload = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_upload_path = temp_upload.name

    try:
        total_upload_bytes = 0
        while chunk := await file.read(1024 * 1024):
            total_upload_bytes += len(chunk)
            if total_upload_bytes > MAX_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"File exceeds maximum upload size of {MAX_UPLOAD_SIZE // (1024*1024)}MB"
                )
            temp_upload.write(chunk)
        temp_upload.close()

        if not zipfile.is_zipfile(temp_upload_path):
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive")

        with zipfile.ZipFile(temp_upload_path, "r") as zf:
            infolist = zf.infolist()
            if len(infolist) > MAX_FILE_COUNT:
                raise HTTPException(
                    status_code=400,
                    detail=f"ZIP archive contains too many files (maximum {MAX_FILE_COUNT})"
                )

            total_uncompressed = sum(info.file_size for info in infolist)
            if total_uncompressed > MAX_EXTRACT_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"Extracted content exceeds maximum size of {MAX_EXTRACT_SIZE // (1024*1024)}MB"
                )

            # Detect single root directory in zip (e.g. created by folder compression)
            top_level_items = set()
            for info in infolist:
                norm = info.filename.replace("\\", "/").strip("/")
                if not norm:
                    continue
                top_level_items.add(norm.split("/")[0])

            strip_prefix = ""
            if len(top_level_items) == 1:
                single_top = list(top_level_items)[0]
                has_sub_items = False
                all_under_single = True
                for info in infolist:
                    norm = info.filename.replace("\\", "/").strip("/")
                    if not norm:
                        continue
                    if norm == single_top:
                        continue
                    if not norm.startswith(single_top + "/"):
                        all_under_single = False
                        break
                    has_sub_items = True
                if all_under_single and has_sub_items:
                    strip_prefix = single_top + "/"

            extracted_count = 0
            target_ws_resolved = target_ws.resolve()

            for info in infolist:
                fn = info.filename.replace("\\", "/")
                if strip_prefix and fn.startswith(strip_prefix):
                    fn = fn[len(strip_prefix):]
                fn = fn.strip("/")
                if not fn or fn.startswith("__MACOSX/") or "/__MACOSX/" in fn or fn == ".DS_Store" or fn.endswith("/.DS_Store"):
                    continue

                # Security check: null bytes or directory traversal
                parts = Path(fn).parts
                if "\0" in fn or ".." in parts:
                    continue

                dest_path = (target_ws / fn).resolve()
                try:
                    dest_path.relative_to(target_ws_resolved)
                except ValueError:
                    # Path traversal attempt!
                    continue

                # Directory entry
                if info.is_dir() or info.filename.endswith("/"):
                    dest_path.mkdir(parents=True, exist_ok=True)
                    continue

                # Symlink check
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    continue

                # Overwrite check
                if dest_path.exists() and not overwrite:
                    continue

                dest_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                extracted_count += 1

        return {
            "status": "ok",
            "workspace": ws_clean,
            "path": str(target_ws),
            "extracted_files": extracted_count,
            "message": f"Successfully extracted {extracted_count} files into '{ws_clean}'"
        }
    finally:
        cleanup_file(temp_upload_path)
