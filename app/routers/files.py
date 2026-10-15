import base64
import shutil
import logging
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse

from app.config import get_base_workspace, MAX_UPLOAD_SIZE
from app.schemas import (
    CreateFileRequest,
    SaveFileRequest,
    RenameFileRequest,
    DeleteFileRequest,
)
from app.utils import safe_path

logger = logging.getLogger("agent-webui")
router = APIRouter(tags=["files"])

IMAGE_EXTENSIONS = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".avif": "image/avif",
}

OFFICE_EXTENSIONS = {
    ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf", ".odt",
    ".xls", ".xlsx", ".xlsm", ".xlt", ".xltx", ".xltm", ".xlsb", ".ods", ".xsl",
    ".ppt", ".pptx", ".pptm", ".pot", ".potx", ".pps", ".ppsx", ".odp",
}


@router.get("/api/files")
def list_files(workspace: str = Query(...)):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    def build_tree(current_path: Path):
        entries = []
        try:
            for item in sorted(current_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if item.name.startswith(".git"):
                    continue
                rel_path = str(item.relative_to(ws_path))
                st = item.stat()
                node = {
                    "name": item.name,
                    "path": rel_path,
                    "is_dir": item.is_dir()
                }
                if item.is_dir():
                    node["children"] = build_tree(item)
                else:
                    node["size"] = st.st_size
                    node["mtime"] = st.st_mtime
                entries.append(node)
        except PermissionError:
            pass
        return entries

    return {"workspace": workspace, "tree": build_tree(ws_path)}


@router.get("/api/files/raw")
def get_raw_file(
    workspace: str = Query(...),
    path: str = Query(...),
    inline: bool = Query(False),
    disposition: Optional[str] = Query(None),
):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, workspace)
    file_path = safe_path(str(ws_path), path)

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    disp_type = "inline" if (inline or disposition == "inline") else "attachment"
    media_type = "application/pdf" if file_path.suffix.lower() == ".pdf" else None
    return FileResponse(
        str(file_path),
        filename=file_path.name,
        media_type=media_type,
        content_disposition_type=disp_type,
    )


@router.get("/api/file-content")
def get_file_content(workspace: str = Query(...), path: str = Query(...)):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, workspace)
    file_path = safe_path(str(ws_path), path)

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    st = file_path.stat()
    size = st.st_size
    mtime = st.st_mtime

    ext = file_path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        mime = IMAGE_EXTENSIONS[ext]
        max_img_bytes = 50 * 1024 * 1024
        if size > max_img_bytes:
            return {
                "truncated": True,
                "size": size,
                "mtime": mtime,
                "is_image": True,
                "mime_type": mime,
                "content": ""
            }
        raw_bytes = file_path.read_bytes()
        b64_str = base64.b64encode(raw_bytes).decode("ascii")
        data_url = f"data:{mime};base64,{b64_str}"
        return {
            "truncated": False,
            "size": size,
            "mtime": mtime,
            "is_image": True,
            "mime_type": mime,
            "content": data_url
        }

    if ext in OFFICE_EXTENSIONS:
        return {
            "truncated": False,
            "size": size,
            "mtime": mtime,
            "is_office": True,
            "content": "",
        }

    if ext == ".pdf":
        return {
            "truncated": False,
            "size": size,
            "mtime": mtime,
            "is_pdf": True,
            "content": "",
        }

    # Read up to 2MB to prevent browser freeze for text files
    max_bytes = 2 * 1024 * 1024
    if size > max_bytes:
        return {
            "truncated": True,
            "size": size,
            "mtime": mtime,
            "content": f"[File too large to display directly ({size} bytes). Showing first {max_bytes} bytes]\n" +
                       file_path.read_bytes()[:max_bytes].decode("utf-8", errors="replace")
        }

    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
        return {"truncated": False, "size": size, "mtime": mtime, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/files")
def create_file(req: CreateFileRequest):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, req.workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_name = req.path.strip()
    if not file_name:
        raise HTTPException(status_code=400, detail="File name cannot be empty")
    if file_name.endswith("/"):
        raise HTTPException(status_code=400, detail="File name cannot end with a slash")

    file_path = safe_path(str(ws_path), file_name)
    if file_path == ws_path or file_path.is_dir():
        raise HTTPException(status_code=400, detail="Invalid file path")

    rel_path = str(file_path.relative_to(ws_path))
    if rel_path == ".backup" or rel_path.startswith(".backup/"):
        raise HTTPException(status_code=403, detail="Cannot create files inside .backup")

    if file_path.exists():
        raise HTTPException(status_code=400, detail="File already exists")

    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(req.content or "", encoding="utf-8")
        st = file_path.stat()
        return {
            "status": "ok",
            "name": file_path.name,
            "path": str(file_path.relative_to(ws_path)),
            "size": st.st_size,
            "mtime": st.st_mtime,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/files/upload")
@router.post("/api/workspaces/{workspace_name:path}/upload-files")
async def upload_files(
    files: Optional[List[UploadFile]] = File(None),
    file: Optional[UploadFile] = File(None),
    workspace: Optional[str] = Form(None),
    workspace_name: Optional[str] = None,
    target_dir: Optional[str] = Form(""),
    overwrite: bool = Form(True),
):
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

    target_dir_clean = (target_dir or "").strip().strip("/")
    if target_dir_clean:
        target_folder = safe_path(str(ws_path), target_dir_clean)
    else:
        target_folder = ws_path

    target_folder.mkdir(parents=True, exist_ok=True)
    target_rel = str(target_folder.relative_to(ws_path)) if target_folder != ws_path else ""
    if target_rel == ".backup" or target_rel.startswith(".backup/"):
        raise HTTPException(status_code=403, detail="Uploading files into .backup is forbidden")
    ws_resolved = ws_path.resolve()

    all_files: List[UploadFile] = []
    if files:
        all_files.extend(files)
    if file:
        all_files.append(file)

    if not all_files:
        raise HTTPException(status_code=400, detail="No files provided")

    uploaded = []
    skipped = []

    for f in all_files:
        raw_name = f.filename or ""
        norm_name = raw_name.replace("\\", "/").strip().strip("/")
        if not norm_name or "\0" in norm_name:
            continue

        parts = Path(norm_name).parts
        if ".." in parts:
            raise HTTPException(status_code=400, detail=f"Invalid file path: traversal detected in '{norm_name}'")

        dest_file = (target_folder / norm_name).resolve()
        try:
            dest_file.relative_to(ws_resolved)
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied: file path outside workspace")

        if dest_file.exists() and not overwrite:
            skipped.append(str(dest_file.relative_to(ws_path)))
            continue

        dest_file.parent.mkdir(parents=True, exist_ok=True)

        total_bytes = 0
        try:
            with open(dest_file, "wb") as dst:
                while chunk := await f.read(1024 * 1024):
                    total_bytes += len(chunk)
                    if total_bytes > MAX_UPLOAD_SIZE:
                        dest_file.unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=400,
                            detail=f"File '{norm_name}' exceeds maximum upload size of {MAX_UPLOAD_SIZE // (1024*1024)}MB"
                        )
                    dst.write(chunk)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to save uploaded file {dest_file}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to write file '{norm_name}': {str(e)}")

        uploaded.append({
            "name": dest_file.name,
            "path": str(dest_file.relative_to(ws_path)),
            "size": dest_file.stat().st_size,
        })

    return {
        "status": "ok",
        "workspace": ws_clean,
        "target_dir": str(target_folder.relative_to(ws_path)) if target_folder != ws_path else "",
        "uploaded": uploaded,
        "count": len(uploaded),
        "skipped": skipped,
        "message": f"Successfully uploaded {len(uploaded)} file(s)"
    }


@router.post("/api/file-content")
@router.put("/api/file-content")
def save_file_content(req: SaveFileRequest):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, req.workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_name = req.path.strip()
    if not file_name:
        raise HTTPException(status_code=400, detail="File path cannot be empty")

    file_path = safe_path(str(ws_path), file_name)
    if file_path == ws_path or file_path.is_dir():
        raise HTTPException(status_code=400, detail="Cannot save: path is a directory")

    rel_path = str(file_path.relative_to(ws_path))
    if rel_path == ".backup" or rel_path.startswith(".backup/"):
        raise HTTPException(status_code=403, detail="Files in .backup are read-only and cannot be modified")

    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        content_str = req.content or ""
        # Check if saving binary/image data (base64 data URL or explicit base64)
        if getattr(req, "encoding", None) == "base64" or (content_str.startswith("data:") and ";base64," in content_str):
            if ";base64," in content_str:
                _, b64_part = content_str.split(";base64,", 1)
            else:
                b64_part = content_str
            file_bytes = base64.b64decode(b64_part)
            file_path.write_bytes(file_bytes)
        else:
            file_path.write_text(content_str, encoding="utf-8")
        st = file_path.stat()
        return {
            "status": "ok",
            "path": str(file_path.relative_to(ws_path)),
            "size": st.st_size,
            "mtime": st.st_mtime,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/files/rename")
def rename_file(req: RenameFileRequest):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, req.workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    old_clean = req.old_path.strip()
    if not old_clean:
        raise HTTPException(status_code=400, detail="Old path cannot be empty")

    old_path = safe_path(str(ws_path), old_clean)
    if old_path == ws_path:
        raise HTTPException(status_code=400, detail="Cannot rename workspace root")
    if not old_path.exists():
        raise HTTPException(status_code=404, detail="File or directory not found")

    old_rel = str(old_path.relative_to(ws_path))
    if old_rel == ".backup" or old_rel.startswith(".backup/"):
        raise HTTPException(status_code=403, detail="Renaming files or folders in .backup is forbidden")

    new_clean = req.new_path.strip()
    if not new_clean:
        raise HTTPException(status_code=400, detail="New path cannot be empty")
    if new_clean.endswith("/"):
        raise HTTPException(status_code=400, detail="New path cannot end with a slash")

    # If new_clean has no slashes, treat it as renaming in the same directory as old_path
    if "/" not in new_clean:
        new_path = old_path.parent / new_clean
    else:
        new_path = safe_path(str(ws_path), new_clean)

    if new_path == ws_path:
        raise HTTPException(status_code=400, detail="Invalid target path")

    try:
        new_rel = str(new_path.relative_to(ws_path))
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: path outside workspace")

    if new_rel == ".backup" or new_rel.startswith(".backup/"):
        raise HTTPException(status_code=403, detail="Renaming files or folders into .backup is forbidden")

    if new_path.exists():
        raise HTTPException(status_code=400, detail="A file or directory with that name already exists")

    try:
        new_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_path), str(new_path))
        return {
            "status": "ok",
            "old_path": str(old_path.relative_to(ws_path)),
            "new_path": str(new_path.relative_to(ws_path)),
            "name": new_path.name,
            "is_dir": new_path.is_dir(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/files")
def delete_file(workspace: str = Query(...), path: str = Query(...)):
    base_p = get_base_workspace()
    ws_path = safe_path(base_p, workspace)
    if not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Workspace not found")

    target_name = path.strip()
    if not target_name:
        raise HTTPException(status_code=400, detail="Path cannot be empty")

    target_path = safe_path(str(ws_path), target_name)
    if target_path == ws_path:
        raise HTTPException(status_code=400, detail="Cannot delete workspace root")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File or directory not found")

    try:
        if target_path.is_dir():
            shutil.rmtree(target_path)
        else:
            target_path.unlink()
        return {
            "status": "ok",
            "path": str(target_path.relative_to(ws_path)),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/files/delete")
def delete_file_post(req: DeleteFileRequest):
    return delete_file(workspace=req.workspace, path=req.path)
