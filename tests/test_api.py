import pytest
import os
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app, BASE_WORKSPACE

client = TestClient(app)

@pytest.fixture(autouse=True)
def disable_auth_for_api_tests(monkeypatch):
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("AUTH_ENABLED", raising=False)

def test_static_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "Agent Web UI" in response.text
    assert "terminal-container" in response.text
    assert "katex" in response.text
    assert "mermaid" in response.text
    assert "flowchart" in response.text

def test_workspaces_crud(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Initial list is empty
    resp = client.get("/api/workspaces")
    assert resp.status_code == 200
    assert resp.json()["workspaces"] == []

    # Create workspace
    resp = client.post("/api/workspaces", json={"name": "project_alpha"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "project_alpha"
    assert (test_base / "project_alpha").is_dir()
    agents_file = test_base / "project_alpha" / "AGENTS.md"
    assert agents_file.exists()
    assert agents_file.read_text(encoding="utf-8") == "@../AGENTS.md\n"

    # List again
    resp = client.get("/api/workspaces")
    assert resp.status_code == 200
    assert "project_alpha" in resp.json()["workspaces"]

    # Delete non-existent workspace
    resp = client.delete("/api/workspaces/non_existent")
    assert resp.status_code == 404

    # Delete workspace project_alpha
    resp = client.delete("/api/workspaces/project_alpha")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["deleted"] == "project_alpha"
    assert not (test_base / "project_alpha").exists()

    # List after delete
    resp = client.get("/api/workspaces")
    assert resp.status_code == 200
    assert "project_alpha" not in resp.json()["workspaces"]

    # Test delete via query param
    resp = client.post("/api/workspaces", json={"name": "project_beta"})
    assert resp.status_code == 200
    resp = client.delete("/api/workspaces?workspace=project_beta")
    assert resp.status_code == 200
    assert not (test_base / "project_beta").exists()

    # Test delete via post
    resp = client.post("/api/workspaces", json={"name": "project_gamma"})
    assert resp.status_code == 200
    resp = client.post("/api/workspaces/delete", json={"name": "project_gamma"})
    assert resp.status_code == 200
    assert not (test_base / "project_gamma").exists()

    # Test rename workspace
    resp = client.post("/api/workspaces", json={"name": "project_delta"})
    assert resp.status_code == 200

    # Non-existent rename
    resp = client.post("/api/workspaces/rename", json={"old_name": "non_existent", "new_name": "new_name"})
    assert resp.status_code == 404

    # Path traversal rejected
    resp = client.post("/api/workspaces/rename", json={"old_name": "project_delta", "new_name": "../outside"})
    assert resp.status_code == 400

    # Successful rename
    resp = client.post("/api/workspaces/rename", json={"old_name": "project_delta", "new_name": "project_epsilon"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["old_name"] == "project_delta"
    assert resp.json()["new_name"] == "project_epsilon"
    assert not (test_base / "project_delta").exists()
    assert (test_base / "project_epsilon").is_dir()

    # Collision check
    resp = client.post("/api/workspaces", json={"name": "project_delta"})
    assert resp.status_code == 200
    resp = client.post("/api/workspaces/rename", json={"old_name": "project_delta", "new_name": "project_epsilon"})
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]

    # Path-based rename endpoint
    resp = client.post("/api/workspaces/project_delta/rename", json={"name": "project_zeta"})
    assert resp.status_code == 200
    assert (test_base / "project_zeta").is_dir()
    assert not (test_base / "project_delta").exists()

def test_files_listing_and_content(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Create sample files
    readme = ws_dir / "README.md"
    readme.write_text("# Hello Markdown\nThis is a test.", encoding="utf-8")

    code = ws_dir / "main.py"
    code.write_text("print('hello')", encoding="utf-8")

    sub = ws_dir / "subdir"
    sub.mkdir()
    subfile = sub / "nested.txt"
    subfile.write_text("nested content", encoding="utf-8")

    # List files
    resp = client.get("/api/files?workspace=demo")
    assert resp.status_code == 200
    tree = resp.json()["tree"]
    names = [node["name"] for node in tree]
    assert "README.md" in names
    assert "main.py" in names
    assert "subdir" in names

    # Read markdown content
    resp = client.get("/api/file-content?workspace=demo&path=README.md")
    assert resp.status_code == 200
    assert resp.json()["content"] == "# Hello Markdown\nThis is a test."

    # Read nested content
    resp = client.get("/api/file-content?workspace=demo&path=subdir/nested.txt")
    assert resp.status_code == 200
    assert resp.json()["content"] == "nested content"

def test_security_path_traversal(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Malicious workspace name
    resp = client.post("/api/workspaces", json={"name": "../etc"})
    assert resp.status_code == 400

    # Path traversal in get file
    resp = client.get("/api/file-content?workspace=demo&path=../../etc/passwd")
    assert resp.status_code in [403, 404]

    # Path traversal in create file
    resp = client.post("/api/files", json={"workspace": "demo", "path": "../hacked.txt", "content": "bad"})
    assert resp.status_code == 403

    # Path traversal in save file
    resp = client.post("/api/file-content", json={"workspace": "demo", "path": "../hacked.txt", "content": "bad"})
    assert resp.status_code == 403

def test_create_and_save_file(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1. Create a new text file
    resp = client.post("/api/files", json={"workspace": "demo", "path": "new_note.txt", "content": "hello world"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["path"] == "new_note.txt"
    assert (ws_dir / "new_note.txt").read_text(encoding="utf-8") == "hello world"

    # 2. Prevent duplicate creation
    resp = client.post("/api/files", json={"workspace": "demo", "path": "new_note.txt"})
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]

    # 3. Create nested file with directories
    resp = client.post("/api/files", json={"workspace": "demo", "path": "docs/guide.md", "content": "# Guide"})
    assert resp.status_code == 200
    assert (ws_dir / "docs" / "guide.md").read_text(encoding="utf-8") == "# Guide"

    # 4. Save/update file content
    resp = client.post("/api/file-content", json={"workspace": "demo", "path": "new_note.txt", "content": "updated content"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert (ws_dir / "new_note.txt").read_text(encoding="utf-8") == "updated content"

    # Verify via get
    resp = client.get("/api/file-content?workspace=demo&path=new_note.txt")
    assert resp.status_code == 200
    assert resp.json()["content"] == "updated content"

def test_markdown_file_with_flowchart_and_latex(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    md_content = """# Diagram and Math Test

```mermaid
flowchart TD
    A[Start] --> B[Process]
    B --> C[End]
```

Inline formula: $E = mc^2$ and $x \\to y$.

Block formula:
$$
\\int_{-\\infty}^\\infty e^{-x^2} dx = \\sqrt{\\pi}
$$
"""
    # Create file
    resp = client.post("/api/files", json={"workspace": "demo", "path": "DIAGRAM_MATH.md", "content": md_content})
    assert resp.status_code == 200

    # Fetch file
    resp = client.get("/api/file-content?workspace=demo&path=DIAGRAM_MATH.md")
    assert resp.status_code == 200
    assert "flowchart TD" in resp.json()["content"]
    assert "E = mc^2" in resp.json()["content"]

def get_frontend_js():
    modules = [
        "app.js",
        "js/icons.js",
        "js/state.js",
        "js/dom.js",
        "js/terminal.js",
        "js/workspace.js",
        "js/fileWatcher.js",
        "js/workspaceZip.js",
        "js/fileUpload.js",
        "js/shareModal.js",
        "js/fileTree.js",
        "js/markdown.js",
        "js/preview.js",
        "js/tabs.js",
        "js/auth.js",
    ]
    texts = []
    for mod in modules:
        r = client.get(f"/static/{mod}")
        assert r.status_code == 200, f"Module /static/{mod} not found"
        texts.append(r.text)
    return "\n".join(texts)

def test_app_js_workspace_tab_closing_and_unsaved_warning():
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    js = get_frontend_js()

    assert "function confirmDiscardUnsavedChanges()" in js
    assert "function closeAllTabs()" in js
    assert "selectWorkspace(name, force = false)" in js
    assert "closeAllTabs();" in js
    assert "confirmDiscardUnsavedChanges()" in js

def test_frontend_rename_and_delete_support():
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    assert "tree-context-menu" in resp_index.text
    assert "ctx-menu-rename" in resp_index.text
    assert "ctx-menu-delete" in resp_index.text

    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()
    assert "function doRenameFile(" in js
    assert "function doDeleteFile(" in js
    assert "function startInlineRename(" in js
    assert "function showContextMenu(" in js
    assert "btn-rename-file" in js
    assert "btn-delete-file" in js
    assert "/api/files/rename" in js
    assert "DELETE" in js

def test_rename_file_api(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1. Create initial files and directory
    f1 = ws_dir / "old_name.txt"
    f1.write_text("hello old", encoding="utf-8")

    sub = ws_dir / "nested_dir"
    sub.mkdir()
    f2 = sub / "child.txt"
    f2.write_text("child content", encoding="utf-8")

    # 2. Rename root-level file
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "old_name.txt",
        "new_path": "new_name.txt"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["old_path"] == "old_name.txt"
    assert resp.json()["new_path"] == "new_name.txt"
    assert not (ws_dir / "old_name.txt").exists()
    assert (ws_dir / "new_name.txt").read_text(encoding="utf-8") == "hello old"

    # 3. Rename nested file with simple name (stays in same parent directory)
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "nested_dir/child.txt",
        "new_path": "renamed_child.txt"
    })
    assert resp.status_code == 200
    assert resp.json()["new_path"] == "nested_dir/renamed_child.txt"
    assert (ws_dir / "nested_dir" / "renamed_child.txt").read_text(encoding="utf-8") == "child content"

    # 4. Move/rename to another subfolder
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "nested_dir/renamed_child.txt",
        "new_path": "other_dir/moved_child.txt"
    })
    assert resp.status_code == 200
    assert resp.json()["new_path"] == "other_dir/moved_child.txt"
    assert (ws_dir / "other_dir" / "moved_child.txt").read_text(encoding="utf-8") == "child content"

    # 5. Rename directory
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "other_dir",
        "new_path": "final_dir"
    })
    assert resp.status_code == 200
    assert (ws_dir / "final_dir" / "moved_child.txt").exists()

    # 6. Error: non-existent file
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "not_found.txt",
        "new_path": "any.txt"
    })
    assert resp.status_code == 404

    # 7. Error: target already exists
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "new_name.txt",
        "new_path": "final_dir/moved_child.txt"
    })
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]

    # 8. Error: path traversal
    resp = client.post("/api/files/rename", json={
        "workspace": "demo",
        "old_path": "new_name.txt",
        "new_path": "../../evil.txt"
    })
    assert resp.status_code in [400, 403]

def test_delete_file_api(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1. Create files and folders
    f1 = ws_dir / "to_delete.txt"
    f1.write_text("bye", encoding="utf-8")
    f2 = ws_dir / "to_delete2.txt"
    f2.write_text("bye2", encoding="utf-8")

    sub = ws_dir / "folder_to_delete"
    sub.mkdir()
    sub_child = sub / "sub_child.txt"
    sub_child.write_text("sub bye", encoding="utf-8")

    # 2. DELETE /api/files via Query params
    resp = client.delete("/api/files?workspace=demo&path=to_delete.txt")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["path"] == "to_delete.txt"
    assert not (ws_dir / "to_delete.txt").exists()

    # 3. POST /api/files/delete via JSON body
    resp = client.post("/api/files/delete", json={
        "workspace": "demo",
        "path": "to_delete2.txt"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert not (ws_dir / "to_delete2.txt").exists()

    # 4. Delete directory and all contents
    resp = client.delete("/api/files?workspace=demo&path=folder_to_delete")
    assert resp.status_code == 200
    assert not (ws_dir / "folder_to_delete").exists()

    # 5. Non-existent file
    resp = client.delete("/api/files?workspace=demo&path=non_existent.txt")
    assert resp.status_code == 404

    # 6. Cannot delete workspace root
    resp = client.delete("/api/files?workspace=demo&path=.")
    assert resp.status_code == 400

    # 7. Path traversal
    resp = client.delete("/api/files?workspace=demo&path=../../etc")
    assert resp.status_code in [400, 403]


def test_workspace_url_routing():
    # 1. Root with and without query param
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Agent Web UI" in resp.text

    resp = client.get("/?workspace=demo")
    assert resp.status_code == 200
    assert "Agent Web UI" in resp.text

    # 2. Path-based /workspace routes
    for path in [
        "/workspace",
        "/workspace/demo",
        "/workspace/demo/",
        "/workspaces",
        "/workspaces/demo",
        "/workspaces/demo/",
    ]:
        resp = client.get(path)
        assert resp.status_code == 200
        assert "Agent Web UI" in resp.text


def test_app_js_workspace_url_sync_and_routing():
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    js = get_frontend_js()

    assert "function getWorkspaceFromUrl()" in js
    assert "function updateUrl(workspaceName, replace = false)" in js
    assert "window.addEventListener(\"popstate\"" in js
    assert "history.pushState" in js
    assert "history.replaceState" in js
    assert "getWorkspaceFromUrl()" in js


def test_preview_default_mode_for_previewable_files():
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    js = get_frontend_js()

    assert "function getFilePreviewType(fileName)" in js
    assert "function hasPreview(fileName)" in js
    assert "function canRunFile(fileName)" in js
    assert "function renderTabPreview(tabInfo" in js
    assert "const initialMode = canPreview ? \"preview\" : \"edit\";" in js
    assert "if (canPreview && tabInfo.mode === \"preview\")" in js
    assert "renderTabPreview(tabInfo" in js
    assert "btn-run" in js
    assert "allow-scripts allow-forms allow-modals" in js
    assert 'allow-same-origin' not in js  # Ensure allow-same-origin is strictly omitted for security!


def test_markdown_preview_layout_styles():
    # Verify CSS prevents code blocks and diagrams from shrinking
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text

    assert ".markdown-content {" in css
    assert "display: block;" in css
    assert "flex-shrink: 0;" in css
    assert "min-height: fit-content;" in css
    assert "max-width: 900px;" not in css
    assert "width: 100%;" in css

    # Verify app.js sets block display for markdown previews
    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()
    assert 'tabInfo.previewContainer.style.display = "block";' in js


def test_app_js_auto_refresh_support():
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    js = get_frontend_js()

    assert "function connectFileWatcher()" in js
    assert "function disconnectFileWatcher()" in js
    assert "function scheduleLoadFiles(" in js
    assert "function startFilePolling()" in js
    assert "lastRenderedTreeJson" in js
    assert "collapsedDirs" in js
    assert "/ws/files?workspace=" in js
    assert "visibilitychange" in js


def test_ws_files_validation():
    from starlette.websockets import WebSocketDisconnect

    # 1. Missing workspace query parameter
    with client.websocket_connect("/ws/files") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1008

    # 2. Non-existent workspace
    with client.websocket_connect("/ws/files?workspace=does_not_exist_xyz") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1008


def test_ws_files_detects_changes(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo_watch"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    with client.websocket_connect("/ws/files?workspace=demo_watch") as ws:
        # Create a new file in workspace
        new_file = ws_dir / "agent_created.txt"
        new_file.write_text("Hello from agent", encoding="utf-8")

        # Receive WebSocket message
        msg = ws.receive_json()
        assert msg["type"] == "files_changed"
        assert msg["workspace"] == "demo_watch"
        change_paths = [c["path"] for c in msg["changes"]]
        assert "agent_created.txt" in change_paths


def test_markdown_relative_links_frontend_implementation():
    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()

    # Core helper functions
    assert "function normalizePath(" in js
    assert "function parseMarkdownLink(" in js
    assert "function scrollToAnchorInContainer(" in js
    assert "function scrollToHashInTab(" in js
    assert "function handleMarkdownLinkClick(" in js
    assert "function revealPathInTree(" in js
    assert "function indexWorkspaceTree(" in js

    # Event delegation and integration
    assert "tabViewsContainer.addEventListener(\"click\"" in js
    assert "handleMarkdownLinkClick(e, anchor, previewContainer)" in js
    assert "renderMarkdown(content, tabInfo.previewContainer, tabInfo.path)" in js
    assert "previewContainer.dataset.basePath = filePath;" in js
    assert "md-file-link" in js

    # Existing tab check in openFile
    assert "const tabId = \"file:\" + filePath;" in js
    assert "if (openTabs.has(tabId)) {" in js
    assert "activateTab(tabId);" in js

    # CSS styles
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".markdown-content a" in css
    assert ".markdown-content a.md-file-link" in css


def test_markdown_relative_link_resolution_logic():
    """Verify relative path resolution matching parseMarkdownLink and normalizePath logic."""
    def normalize_path(path_str: str):
        if not path_str:
            return ""
        parts = path_str.replace("\\", "/").split("/")
        stack = []
        for part in parts:
            if not part or part == ".":
                continue
            if part == "..":
                if stack:
                    stack.pop()
                else:
                    return None
            else:
                stack.append(part)
        return "/".join(stack)

    def resolve_md_link(href: str, current_file: str):
        trimmed = href.strip()
        if trimmed.startswith("#"):
            return {"type": "anchor", "hash": trimmed[1:]}
        if "://" in trimmed and not trimmed.startswith("file://"):
            return {"type": "external", "url": trimmed}

        path_part, *hash_parts = trimmed.split("#", 1)
        hash_val = hash_parts[0] if hash_parts else ""
        clean_path = path_part.split("?", 1)[0].strip()

        is_root = clean_path.startswith("/")
        stripped = clean_path.lstrip("/")

        base_dir = ""
        if not is_root and "/" in current_file:
            base_dir = current_file.rsplit("/", 1)[0]

        combined = f"{base_dir}/{stripped}" if base_dir else stripped
        normalized = normalize_path(combined)
        return {"type": "file", "path": normalized, "hash": hash_val}

    # 1. Sibling link at workspace root
    res1 = resolve_md_link("CRM_SUMMARY_TABLE.md", "CRM_RESEARCH_PLAN.md")
    assert res1["type"] == "file"
    assert res1["path"] == "CRM_SUMMARY_TABLE.md"

    # 2. Relative subfolder link
    res2 = resolve_md_link("crm_details/onesignal.md", "CRM_SUMMARY_TABLE.md")
    assert res2["type"] == "file"
    assert res2["path"] == "crm_details/onesignal.md"

    # 3. Parent link from subfolder
    res3 = resolve_md_link("../CRM_SUMMARY_TABLE.md", "crm_details/onesignal.md")
    assert res3["type"] == "file"
    assert res3["path"] == "CRM_SUMMARY_TABLE.md"

    # 4. Dot-slash relative link
    res4 = resolve_md_link("./optimove.md", "crm_details/onesignal.md")
    assert res4["type"] == "file"
    assert res4["path"] == "crm_details/optimove.md"

    # 5. Link with hash anchor
    res5 = resolve_md_link("PLAN.md#phase-2", "notes/doc.md")
    assert res5["type"] == "file"
    assert res5["path"] == "notes/PLAN.md"
    assert res5["hash"] == "phase-2"

    # 6. Pure anchor link
    res6 = resolve_md_link("#methodology", "CRM_RESEARCH_PLAN.md")
    assert res6["type"] == "anchor"
    assert res6["hash"] == "methodology"

    # 7. Root-relative link
    res7 = resolve_md_link("/README.md", "nested/deep/doc.md")
    assert res7["type"] == "file"
    assert res7["path"] == "README.md"

    # 8. External link
    res8 = resolve_md_link("https://github.com", "README.md")
    assert res8["type"] == "external"

    # 9. Path traversal attempt blocked
    res9 = resolve_md_link("../../../etc/passwd", "file.md")
    assert res9["path"] is None


def test_download_workspace_zip(tmp_path, monkeypatch):
    import io
    import zipfile

    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "dl_demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Populate demo files
    (ws_dir / "README.md").write_text("# DL Demo\nHello ZIP", encoding="utf-8")
    sub = ws_dir / "src"
    sub.mkdir()
    (sub / "app.py").write_text("print('test')", encoding="utf-8")
    empty_sub = ws_dir / "empty_dir"
    empty_sub.mkdir()

    # 1. Download via query parameter
    resp = client.get("/api/workspaces/download?workspace=dl_demo")
    assert resp.status_code == 200
    assert "application/zip" in resp.headers.get("content-type", "")
    assert 'filename="dl_demo.zip"' in resp.headers.get("content-disposition", "")

    # Inspect zip contents
    with zipfile.ZipFile(io.BytesIO(resp.content), "r") as zf:
        names = zf.namelist()
        assert "README.md" in names
        assert "src/app.py" in names
        assert zf.read("README.md").decode("utf-8") == "# DL Demo\nHello ZIP"
        assert zf.read("src/app.py").decode("utf-8") == "print('test')"

    # 2. Download via path parameter
    resp_path = client.get("/api/workspaces/dl_demo/download")
    assert resp_path.status_code == 200
    with zipfile.ZipFile(io.BytesIO(resp_path.content), "r") as zf:
        assert "README.md" in zf.namelist()

    # 3. Download non-existent workspace -> 404
    resp_404 = client.get("/api/workspaces/download?workspace=does_not_exist")
    assert resp_404.status_code == 404

    # 4. Download without workspace param -> 400
    resp_400 = client.get("/api/workspaces/download")
    assert resp_400.status_code == 400

    # 5. Path traversal attempt -> 400
    resp_trav = client.get("/api/workspaces/download?workspace=../../etc")
    assert resp_trav.status_code in [400, 403]

    # 6. Download empty workspace
    empty_ws = test_base / "empty_ws"
    empty_ws.mkdir()
    resp_empty = client.get("/api/workspaces/empty_ws/download")
    assert resp_empty.status_code == 200
    with zipfile.ZipFile(io.BytesIO(resp_empty.content), "r") as zf:
        assert isinstance(zf.namelist(), list)


def test_upload_workspace_zip(tmp_path, monkeypatch):
    import io
    import zipfile

    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Helper to build in-memory zip
    def create_zip(files_dict):
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
            for arcname, content in files_dict.items():
                zf.writestr(arcname, content)
        bio.seek(0)
        return bio.getvalue()

    # 1. Basic upload with explicit workspace name
    zip_bytes = create_zip({
        "README.md": "# Project from ZIP",
        "nested/config.json": '{"active": true}',
    })
    resp = client.post(
        "/api/workspaces/upload",
        data={"workspace": "imported_proj"},
        files={"file": ("imported.zip", zip_bytes, "application/zip")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["workspace"] == "imported_proj"
    assert data["extracted_files"] == 2

    # Check files on disk
    ws_dir = test_base / "imported_proj"
    assert (ws_dir / "README.md").read_text(encoding="utf-8") == "# Project from ZIP"
    assert (ws_dir / "nested" / "config.json").read_text(encoding="utf-8") == '{"active": true}'

    # 2. Upload without workspace name (auto-derived from filename)
    auto_zip_bytes = create_zip({"index.html": "<h1>Hello</h1>"})
    resp_auto = client.post(
        "/api/workspaces/upload",
        files={"file": ("auto_named_ws.zip", auto_zip_bytes, "application/zip")},
    )
    assert resp_auto.status_code == 200
    assert resp_auto.json()["workspace"] == "auto_named_ws"
    assert (test_base / "auto_named_ws" / "index.html").read_text(encoding="utf-8") == "<h1>Hello</h1>"

    # 3. Upload with single root directory in zip (stripping redundant folder)
    folder_zip_bytes = create_zip({
        "my_repo/main.py": "print('root stripped')",
        "my_repo/sub/util.py": "# util",
    })
    resp_strip = client.post(
        "/api/workspaces/upload",
        data={"workspace": "my_repo"},
        files={"file": ("my_repo.zip", folder_zip_bytes, "application/zip")},
    )
    assert resp_strip.status_code == 200
    # main.py should be directly at root of workspace, not my_repo/my_repo/main.py
    assert (test_base / "my_repo" / "main.py").read_text(encoding="utf-8") == "print('root stripped')"
    assert (test_base / "my_repo" / "sub" / "util.py").exists()

    # 4. Overwrite testing: overwrite=False should not modify existing files
    update_zip = create_zip({"README.md": "# Overwritten Content", "new_file.txt": "brand new"})
    resp_no_ovw = client.post(
        "/api/workspaces/upload",
        data={"workspace": "imported_proj", "overwrite": "false"},
        files={"file": ("update.zip", update_zip, "application/zip")},
    )
    assert resp_no_ovw.status_code == 200
    assert (ws_dir / "README.md").read_text(encoding="utf-8") == "# Project from ZIP"
    assert (ws_dir / "new_file.txt").read_text(encoding="utf-8") == "brand new"

    # Now overwrite=True
    resp_ovw = client.post(
        "/api/workspaces/upload",
        data={"workspace": "imported_proj", "overwrite": "true"},
        files={"file": ("update.zip", update_zip, "application/zip")},
    )
    assert resp_ovw.status_code == 200
    assert (ws_dir / "README.md").read_text(encoding="utf-8") == "# Overwritten Content"

    # 5. Invalid non-zip file upload -> 400
    resp_invalid = client.post(
        "/api/workspaces/upload",
        data={"workspace": "bad_zip"},
        files={"file": ("corrupt.zip", b"not a real zip file", "application/zip")},
    )
    assert resp_invalid.status_code == 400
    assert "not a valid ZIP archive" in resp_invalid.json()["detail"]

    # 6. Zip Slip security: archive with traversal paths
    slip_zip = create_zip({"../../escaped.txt": "malicious content", "safe.txt": "safe content"})
    resp_slip = client.post(
        "/api/workspaces/upload",
        data={"workspace": "slip_test"},
        files={"file": ("slip.zip", slip_zip, "application/zip")},
    )
    assert resp_slip.status_code == 200
    assert not (test_base / "escaped.txt").exists()
    assert not Path(tmp_path / "escaped.txt").exists()
    assert (test_base / "slip_test" / "safe.txt").exists()

    # 7. Path traversal in workspace parameter -> 400
    resp_trav_ws = client.post(
        "/api/workspaces/upload",
        data={"workspace": "../etc_attack"},
        files={"file": ("any.zip", auto_zip_bytes, "application/zip")},
    )
    assert resp_trav_ws.status_code in [400, 403]


def test_frontend_workspace_zip_support():
    # 1. index.html checks
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    html = resp_index.text
    assert "btn-download-ws" in html
    assert "btn-upload-ws" in html
    assert "upload-zip-modal" in html
    assert "modal-dropzone" in html
    assert "zip-file-input" in html
    assert "btn-submit-upload" in html

    # 2. style.css checks
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".modal-overlay" in css
    assert ".modal-content" in css
    assert ".modal-file-dropzone" in css

    # 3. app.js checks
    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()
    assert "downloadWorkspaceZip" in js
    assert "openUploadModal" in js
    assert "closeUploadModal" in js
    assert "uploadWorkspaceZip" in js
    assert "btnDownloadWs" in js
    assert "btnUploadWs" in js
    assert "/api/workspaces/upload" in js
    assert "/download" in js


def test_public_link_generation_and_download(tmp_path, monkeypatch):
    import time
    from app.auth import generate_public_file_signature, verify_public_file_signature

    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "my_project"
    ws_dir.mkdir()
    sub_dir = ws_dir / "docs"
    sub_dir.mkdir()
    test_file = sub_dir / "guide.md"
    test_file.write_text("# Public Guide\nSecret content shared publicly.", encoding="utf-8")

    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))
    monkeypatch.setenv("PUBLIC_LINK_SECRET", "test-secret-key-12345")

    # 1. Signature unit verification
    now = int(time.time())
    sig = generate_public_file_signature("my_project", "docs/guide.md", now + 3600)
    assert len(sig) == 64

    is_valid, msg = verify_public_file_signature("my_project", "docs/guide.md", now + 3600, sig)
    assert is_valid is True
    assert msg == "ok"

    # Expired signature
    is_valid_exp, msg_exp = verify_public_file_signature("my_project", "docs/guide.md", now - 10, sig)
    assert is_valid_exp is False
    assert "expired" in msg_exp.lower()

    # Tampered path
    is_valid_tampered, msg_tampered = verify_public_file_signature("my_project", "docs/other.md", now + 3600, sig)
    assert is_valid_tampered is False
    assert "invalid" in msg_tampered.lower()

    # 2. Generate public link via POST endpoint
    resp_post = client.post(
        "/api/files/public-link",
        json={"workspace": "my_project", "path": "docs/guide.md", "expires_in": 3600}
    )
    assert resp_post.status_code == 200
    data = resp_post.json()
    assert data["status"] == "ok"
    assert data["workspace"] == "my_project"
    assert data["path"] == "docs/guide.md"
    assert data["filename"] == "guide.md"
    assert "signature" in data
    assert "url" in data
    assert "full_url" in data
    assert data["signature"] == sig

    # 3. Generate public link via GET endpoint
    resp_get = client.get(
        "/api/files/public-link?workspace=my_project&path=docs/guide.md&expires_in=3600"
    )
    assert resp_get.status_code == 200
    assert resp_get.json()["signature"] == sig

    # 4. Download file via public link query URL
    public_url = data["url"]
    resp_dl = client.get(public_url)
    assert resp_dl.status_code == 200
    assert resp_dl.text == "# Public Guide\nSecret content shared publicly."
    assert 'filename="guide.md"' in resp_dl.headers.get("content-disposition", "")
    assert "inline" in resp_dl.headers.get("content-disposition", "")

    # 5. Access file via path-based public URL
    resp_path_based = client.get(
        f"/api/public/files/my_project/docs/guide.md?expires={data['expires']}&signature={data['signature']}"
    )
    assert resp_path_based.status_code == 200
    assert resp_path_based.text == "# Public Guide\nSecret content shared publicly."

    # 6. Force download attachment
    resp_force_dl = client.get(f"{public_url}&download=1")
    assert resp_force_dl.status_code == 200
    assert "attachment" in resp_force_dl.headers.get("content-disposition", "")

    # 7. Expired link should return 410 Gone
    expired_ts = now - 50
    expired_sig = generate_public_file_signature("my_project", "docs/guide.md", expired_ts)
    resp_expired = client.get(
        f"/api/public/file?workspace=my_project&path=docs/guide.md&expires={expired_ts}&signature={expired_sig}"
    )
    assert resp_expired.status_code == 410
    assert "expired" in resp_expired.json()["detail"].lower()

    # 8. Tampered / invalid signature should return 403 Forbidden
    resp_bad_sig = client.get(
        f"/api/public/file?workspace=my_project&path=docs/guide.md&expires={data['expires']}&signature=badbadbad123"
    )
    assert resp_bad_sig.status_code == 403
    assert "invalid" in resp_bad_sig.json()["detail"].lower()

    # 9. Tampered path should return 403 Forbidden
    resp_bad_path = client.get(
        f"/api/public/file?workspace=my_project&path=docs/another.md&expires={data['expires']}&signature={data['signature']}"
    )
    assert resp_bad_path.status_code == 403

    # 10. Missing signature should return 403 Forbidden
    resp_no_sig = client.get(
        f"/api/public/file?workspace=my_project&path=docs/guide.md&expires={data['expires']}"
    )
    assert resp_no_sig.status_code == 403

    # 11. Path traversal attempt should be rejected
    trav_sig = generate_public_file_signature("my_project", "../../etc/passwd", now + 3600)
    resp_trav = client.get(
        f"/api/public/file?workspace=my_project&path=../../etc/passwd&expires={now + 3600}&signature={trav_sig}"
    )
    assert resp_trav.status_code in [400, 403]

    # 12. Non-existent file with valid signature should return 404
    ghost_sig = generate_public_file_signature("my_project", "ghost.txt", now + 3600)
    resp_ghost = client.get(
        f"/api/public/file?workspace=my_project&path=ghost.txt&expires={now + 3600}&signature={ghost_sig}"
    )
    assert resp_ghost.status_code == 404


def test_frontend_public_share_elements():
    # index.html elements
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    html = resp_index.text
    assert "ctx-menu-share" in html
    assert "share-link-modal" in html
    assert "share-expiry-select" in html
    assert "share-download-check" in html
    assert "share-link-url" in html
    assert "btn-copy-share-link" in html

    # style.css elements
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".modal-file-display" in css
    assert ".modal-link-row" in css
    assert ".modal-info-box" in css

    # app.js elements
    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()
    assert "shareLinkModal" in js
    assert "openShareLinkModal" in js
    assert "generateAndDisplayShareLink" in js
    assert "btn-share-file" in js
    assert "/api/files/public-link" in js
    assert "browserOrigin" in js


def test_public_link_reverse_proxy_and_base_url(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "proxy_project"
    ws_dir.mkdir()
    guide_file = ws_dir / "test.txt"
    guide_file.write_text("Proxy content", encoding="utf-8")
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1. Custom base_url in POST payload
    resp1 = client.post(
        "/api/files/public-link",
        json={"workspace": "proxy_project", "path": "test.txt", "base_url": "https://browser.example.com"}
    )
    assert resp1.status_code == 200
    assert resp1.json()["full_url"].startswith("https://browser.example.com/api/public/file?")

    # 2. Custom base_url in GET query parameter
    resp2 = client.get(
        "/api/files/public-link?workspace=proxy_project&path=test.txt&base_url=https://browser.example.com"
    )
    assert resp2.status_code == 200
    assert resp2.json()["full_url"].startswith("https://browser.example.com/api/public/file?")

    # 3. X-Forwarded-Proto and X-Forwarded-Host headers
    resp3 = client.post(
        "/api/files/public-link",
        json={"workspace": "proxy_project", "path": "test.txt"},
        headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "proxy.example.com"}
    )
    assert resp3.status_code == 200
    assert resp3.json()["full_url"].startswith("https://proxy.example.com/api/public/file?")

    # 4. X-Forwarded-Proto, X-Forwarded-Host with custom X-Forwarded-Port
    resp4 = client.post(
        "/api/files/public-link",
        json={"workspace": "proxy_project", "path": "test.txt"},
        headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "proxy.example.com", "X-Forwarded-Port": "8443"}
    )
    assert resp4.status_code == 200
    assert resp4.json()["full_url"].startswith("https://proxy.example.com:8443/api/public/file?")

    # 5. RFC 7239 Forwarded header
    resp5 = client.post(
        "/api/files/public-link",
        json={"workspace": "proxy_project", "path": "test.txt"},
        headers={"Forwarded": "proto=https;host=rfc.example.com"}
    )
    assert resp5.status_code == 200
    assert resp5.json()["full_url"].startswith("https://rfc.example.com/api/public/file?")


def test_upload_files_api(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "upload_demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1. Single file upload to root
    resp = client.post(
        "/api/files/upload",
        data={"workspace": "upload_demo"},
        files={"file": ("hello.txt", b"Hello, World!", "text/plain")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["workspace"] == "upload_demo"
    assert data["count"] == 1
    assert (ws_dir / "hello.txt").read_text(encoding="utf-8") == "Hello, World!"

    # 2. Multiple files upload with target_dir
    resp_multi = client.post(
        "/api/files/upload",
        data={"workspace": "upload_demo", "target_dir": "subfolder/docs"},
        files=[
            ("files", ("doc1.md", b"# Document 1", "text/markdown")),
            ("files", ("image.png", b"\x89PNG\r\n\x1a\nfake-png-bytes", "image/png")),
        ],
    )
    assert resp_multi.status_code == 200
    data_multi = resp_multi.json()
    assert data_multi["count"] == 2
    assert (ws_dir / "subfolder" / "docs" / "doc1.md").read_text(encoding="utf-8") == "# Document 1"
    assert (ws_dir / "subfolder" / "docs" / "image.png").read_bytes() == b"\x89PNG\r\n\x1a\nfake-png-bytes"

    # 3. Path with workspace in URL route
    resp_route = client.post(
        "/api/workspaces/upload_demo/upload-files",
        files={"files": ("from_route.txt", b"Route content", "text/plain")},
    )
    assert resp_route.status_code == 200
    assert (ws_dir / "from_route.txt").read_text(encoding="utf-8") == "Route content"

    # 4. Overwrite testing: overwrite=False should skip
    resp_skip = client.post(
        "/api/files/upload",
        data={"workspace": "upload_demo", "overwrite": "false"},
        files={"files": ("hello.txt", b"Ignored new text", "text/plain")},
    )
    assert resp_skip.status_code == 200
    assert "hello.txt" in resp_skip.json()["skipped"]
    assert (ws_dir / "hello.txt").read_text(encoding="utf-8") == "Hello, World!"

    # Overwrite=True should overwrite
    resp_ovw = client.post(
        "/api/files/upload",
        data={"workspace": "upload_demo", "overwrite": "true"},
        files={"files": ("hello.txt", b"New overwritten text", "text/plain")},
    )
    assert resp_ovw.status_code == 200
    assert (ws_dir / "hello.txt").read_text(encoding="utf-8") == "New overwritten text"

    # 5. Security & error handling:
    # Traversal in filename
    resp_trav = client.post(
        "/api/files/upload",
        data={"workspace": "upload_demo"},
        files={"files": ("../../evil.txt", b"evil", "text/plain")},
    )
    assert resp_trav.status_code in [400, 403]

    # Traversal in target_dir
    resp_trav_dir = client.post(
        "/api/files/upload",
        data={"workspace": "upload_demo", "target_dir": "../evil_dir"},
        files={"files": ("test.txt", b"data", "text/plain")},
    )
    assert resp_trav_dir.status_code in [400, 403]

    # Non-existent workspace -> 404
    resp_404 = client.post(
        "/api/files/upload",
        data={"workspace": "non_existent_workspace"},
        files={"files": ("test.txt", b"data", "text/plain")},
    )
    assert resp_404.status_code == 404


def test_frontend_workspace_files_upload_support():
    # 1. index.html checks
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    html = resp_index.text
    assert "btn-upload-file" in html
    assert "upload-files-modal" in html
    assert "btn-close-upload-files-modal" in html
    assert "modal-files-dropzone" in html
    assert "files-dropzone-label" in html
    assert "files-dropzone-list" in html
    assert "file-upload-input" in html
    assert "upload-files-dest-dir" in html
    assert "upload-files-overwrite-check" in html
    assert "btn-submit-upload-files" in html
    assert "ctx-menu-upload-folder" in html

    # 2. style.css checks
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".modal-folder-row" in css
    assert ".modal-target-badge" in css
    assert ".modal-files-list" in css
    assert ".modal-file-list-item" in css
    assert ".file-explorer-sec.dragover" in css

    # 3. app.js checks
    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()
    assert "btnUploadFile" in js
    assert "uploadFilesModal" in js
    assert "openUploadFilesModal" in js
    assert "closeUploadFilesModal" in js
    assert "addFilesToUpload" in js
    assert "removeFileFromUpload" in js
    assert "renderSelectedUploadFiles" in js
    assert "submitUploadFiles" in js
    assert "ctxUploadFolder" in js
    assert "/api/files/upload" in js


def test_execute_action_frontend_assets():
    # 1. index.html checks
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    html = resp_index.text
    assert "ctx-menu-execute" in html
    assert "Execute" in html
    assert '<svg class="ui-icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>' in html

    # 2. style.css checks
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".btn-execute-file" in css
    assert ".tree-action-btn.btn-execute" in css

    # 3. app.js checks
    resp_js = client.get("/static/app.js")
    assert resp_js.status_code == 200
    js = get_frontend_js()
    assert "isExecutableFile" in js
    assert "executeFileInTty" in js
    assert "btn-execute-file" in js
    assert "btn-execute" in js
    assert "ctx-menu-execute" in js
    assert "execute @" in js
    assert "prompt|task|plan" in js


def test_websocket_pty_prompt_argument(tmp_path, monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch

    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo_exec"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    captured_cmds = []

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        captured_cmds.append(list(cmd))
        mock_proc = AsyncMock()
        mock_proc.terminate = MagicMock()
        mock_proc.wait = AsyncMock()
        return mock_proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    try:
        with client.websocket_connect("/ws/pty?workspace=demo_exec&prompt=execute%20%40PROMPT.md") as ws:
            pass
    except Exception:
        pass

    assert len(captured_cmds) > 0
    cmd_args = captured_cmds[0]
    assert "-i" in cmd_args
    idx = cmd_args.index("-i")
    assert cmd_args[idx + 1] == "execute @PROMPT.md"


def test_frontend_modular_architecture():
    # 1. Main app.js is a clean coordinator
    resp_app = client.get("/static/app.js")
    assert resp_app.status_code == 200
    app_lines = resp_app.text.splitlines()
    assert len(app_lines) < 400  # Verified that app.js is no longer monolithic (>3400 lines)

    # 2. Check each semantic module exists and is served
    modules = [
        "icons.js",
        "state.js",
        "dom.js",
        "terminal.js",
        "workspace.js",
        "fileWatcher.js",
        "workspaceZip.js",
        "fileUpload.js",
        "shareModal.js",
        "fileTree.js",
        "markdown.js",
        "preview.js",
        "tabs.js",
        "auth.js",
    ]
    for mod in modules:
        res = client.get(f"/static/js/{mod}")
        assert res.status_code == 200, f"/static/js/{mod} should return 200"
        assert len(res.text) > 0

    # 3. index.html imports app.js with type="module"
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    assert '<script type="module" src="/static/app.js' in resp_index.text


def test_public_workspace_serving(tmp_path, monkeypatch):
    """
    Test that if a workspace has a 'public' directory:
    - Everything inside is served without authorization at /public/$workspace/...
    - index.html is served at /public/$workspace/ and /public/$workspace
    - Path traversal is blocked
    - Missing workspace or missing public dir or missing file returns 404
    """
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))
    monkeypatch.setattr("app.config.BASE_WORKSPACE", str(test_base))

    # Workspace 1: has public dir with index.html, style.css, and nested files
    ws1 = test_base / "my_site"
    ws1.mkdir()
    ws1_public = ws1 / "public"
    ws1_public.mkdir()
    (ws1_public / "index.html").write_text("<!DOCTYPE html><html><body><h1>Hello Public!</h1></body></html>", encoding="utf-8")
    (ws1_public / "style.css").write_text("body { background: #123456; }", encoding="utf-8")
    (ws1_public / "app.js").write_text("console.log('public js');", encoding="utf-8")
    sub_dir = ws1_public / "docs"
    sub_dir.mkdir()
    (sub_dir / "index.html").write_text("<p>Docs Index</p>", encoding="utf-8")
    (sub_dir / "page.txt").write_text("Some text in subfolder", encoding="utf-8")

    # Workspace 2: has NO public directory
    ws2 = test_base / "no_public"
    ws2.mkdir()
    (ws2 / "index.html").write_text("Not public", encoding="utf-8")

    # Workspace 3: has public dir, but NO index.html
    ws3 = test_base / "empty_public"
    ws3.mkdir()
    (ws3 / "public").mkdir()
    (ws3 / "public" / "about.txt").write_text("About info", encoding="utf-8")

    # 1. /public/my_site serves index.html
    resp_root_no_slash = client.get("/public/my_site")
    assert resp_root_no_slash.status_code == 200
    assert "Hello Public!" in resp_root_no_slash.text
    assert "text/html" in resp_root_no_slash.headers.get("content-type", "")

    # 2. /public/my_site/ serves index.html
    resp_root_slash = client.get("/public/my_site/")
    assert resp_root_slash.status_code == 200
    assert "Hello Public!" in resp_root_slash.text

    # 3. /public/my_site/index.html serves index.html
    resp_index = client.get("/public/my_site/index.html")
    assert resp_index.status_code == 200
    assert "Hello Public!" in resp_index.text

    # 4. /public/my_site/style.css serves css
    resp_css = client.get("/public/my_site/style.css")
    assert resp_css.status_code == 200
    assert "body { background: #123456; }" in resp_css.text

    # 5. /public/my_site/app.js serves js
    resp_js = client.get("/public/my_site/app.js")
    assert resp_js.status_code == 200
    assert "console.log('public js');" in resp_js.text

    # 6. /public/my_site/docs/page.txt serves nested file
    resp_nested = client.get("/public/my_site/docs/page.txt")
    assert resp_nested.status_code == 200
    assert "Some text in subfolder" in resp_nested.text

    # 7. /public/my_site/docs (directory with index.html)
    resp_sub_idx = client.get("/public/my_site/docs")
    assert resp_sub_idx.status_code == 200
    assert "Docs Index" in resp_sub_idx.text

    # 8. Download query param sets attachment
    resp_dl = client.get("/public/my_site/style.css?download=1")
    assert resp_dl.status_code == 200
    assert "attachment" in resp_dl.headers.get("content-disposition", "")

    # 9. Non-existent file in public dir -> 404
    resp_404_file = client.get("/public/my_site/missing.txt")
    assert resp_404_file.status_code == 404

    # 10. Workspace without public dir -> 404
    resp_no_pub = client.get("/public/no_public")
    assert resp_no_pub.status_code == 404
    resp_no_pub_file = client.get("/public/no_public/index.html")
    assert resp_no_pub_file.status_code == 404

    # 11. Workspace with public dir but no index.html -> 404 for root, but files in it work
    resp_empty_root = client.get("/public/empty_public")
    assert resp_empty_root.status_code == 404
    resp_empty_file = client.get("/public/empty_public/about.txt")
    assert resp_empty_file.status_code == 200
    assert "About info" in resp_empty_file.text

    # 12. Non-existent workspace -> 404
    resp_ghost_ws = client.get("/public/ghost_workspace")
    assert resp_ghost_ws.status_code == 404

    # 13. Path traversal security checks
    resp_trav1 = client.get("/public/my_site/../secret.txt")
    assert resp_trav1.status_code in [400, 403, 404]

    resp_trav2 = client.get("/public/my_site/../../etc/passwd")
    assert resp_trav2.status_code in [400, 403, 404]


def test_public_workspace_bypasses_auth(tmp_path, monkeypatch):
    """
    Test that /public/$workspace/... is accessible without authentication
    even when authentication is enabled.
    """
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws = test_base / "auth_protected_ws"
    ws.mkdir()
    ws_pub = ws / "public"
    ws_pub.mkdir()
    (ws_pub / "index.html").write_text("<h1>Public Page Accessible Without Auth</h1>", encoding="utf-8")
    (ws_pub / "main.css").write_text("h1 { color: green; }", encoding="utf-8")
    (ws / "secret.txt").write_text("Private file", encoding="utf-8")

    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))
    monkeypatch.setattr("app.config.BASE_WORKSPACE", str(test_base))
    monkeypatch.setenv("AUTH_USERNAME", "admin")
    monkeypatch.setenv("AUTH_PASSWORD", "supersecret")

    # Regular endpoints should be protected (redirect 303 or 401)
    resp_ws = client.get("/api/workspaces")
    assert resp_ws.status_code == 401

    # But /public/$workspace and /public/$workspace/... should be 200 OK without any auth
    resp_pub_root = client.get("/public/auth_protected_ws")
    assert resp_pub_root.status_code == 200
    assert "Public Page Accessible Without Auth" in resp_pub_root.text

    resp_pub_root_slash = client.get("/public/auth_protected_ws/")
    assert resp_pub_root_slash.status_code == 200
    assert "Public Page Accessible Without Auth" in resp_pub_root_slash.text

    resp_pub_css = client.get("/public/auth_protected_ws/main.css")
    assert resp_pub_css.status_code == 200
    assert "h1 { color: green; }" in resp_pub_css.text
    assert resp_pub_css.headers.get("access-control-allow-origin") == "*"


def test_frontend_filetree_marks_public_folder_with_globe():
    """
    Verify that in static/js/fileTree.js, a public directory is marked
    with the globe icon (like html files).
    """
    from pathlib import Path
    tree_js = Path("static/js/fileTree.js").read_text(encoding="utf-8")
    assert "isPublicFolder" in tree_js
    assert 'getIconSvg("globe")' in tree_js
    assert 'normPath === "public"' in tree_js or 'item.name.toLowerCase() === "public"' in tree_js


def test_frontend_share_modal_and_preview_public_urls():
    """
    Verify that in static/js/preview.js and static/js/shareModal.js:
    - getPublicUrlForFile generates the direct public URL for files in public/
    - shareModal uses direct public URL without calling signed link API
    - renderHtmlPreview and renderTabPreview run public HTML files via public URL
    """
    from pathlib import Path
    preview_js = Path("static/js/preview.js").read_text(encoding="utf-8")
    share_js = Path("static/js/shareModal.js").read_text(encoding="utf-8")
    tabs_js = Path("static/js/tabs.js").read_text(encoding="utf-8")

    # preview.js: getPublicUrlForFile, isPublicFilePath and iframe.src only with publicUrl
    assert "getPublicUrlForFile" in preview_js
    assert "isPublicFilePath" in preview_js
    assert "iframe.src" in preview_js
    assert "publicUrl" in preview_js
    assert "isPublicFilePath(tabInfo.path)" in preview_js

    # shareModal.js: uses directPublicUrl without HMAC signature for files in public
    assert "getPublicUrlForFile" in share_js
    assert "directPublicUrl" in share_js

    # tabs.js: auto-saves dirty files when switching to run mode
    assert "saveFile(tabInfo)" in tabs_js


def test_disk_change_mtime_api_and_frontend_behavior(tmp_path, monkeypatch):
    """
    Verify:
    1. /api/files, /api/file-content, /api/files (POST), /api/file-content (POST) return mtime
    2. static/js/tabs.js implements:
       - Auto-refresh in preview mode on disk change (reloadTabWithContent)
       - Banner notification in source mode (showDiskChangeBanner, file-changed-banner, Reload, Ignore)
       - WebSocket handler integration (handleFilesChangedOnDisk)
       - Polling fallback handler (checkOpenTabsAgainstTree)
    3. static/style.css defines .file-changed-banner styles
    """
    from pathlib import Path
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "test_mtime_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1. API tests for mtime
    create_resp = client.post("/api/files", json={"workspace": "test_mtime_ws", "path": "doc.md", "content": "# Initial"})
    assert create_resp.status_code == 200
    create_data = create_resp.json()
    assert "mtime" in create_data

    tree_resp = client.get("/api/files?workspace=test_mtime_ws")
    assert tree_resp.status_code == 200
    tree = tree_resp.json()["tree"]
    assert len(tree) == 1
    assert "mtime" in tree[0]
    assert tree[0]["name"] == "doc.md"

    content_resp = client.get("/api/file-content?workspace=test_mtime_ws&path=doc.md")
    assert content_resp.status_code == 200
    content_data = content_resp.json()
    assert "mtime" in content_data
    assert content_data["content"] == "# Initial"

    save_resp = client.post("/api/file-content", json={"workspace": "test_mtime_ws", "path": "doc.md", "content": "# Updated"})
    assert save_resp.status_code == 200
    save_data = save_resp.json()
    assert "mtime" in save_data

    # 2. Frontend verification
    tabs_js = Path("static/js/tabs.js").read_text(encoding="utf-8")
    file_watcher_js = Path("static/js/fileWatcher.js").read_text(encoding="utf-8")
    file_tree_js = Path("static/js/fileTree.js").read_text(encoding="utf-8")
    style_css = Path("static/style.css").read_text(encoding="utf-8")

    # Tabs module exports & functionality
    assert "showDiskChangeBanner" in tabs_js
    assert "hideDiskChangeBanner" in tabs_js
    assert "reloadTabWithContent" in tabs_js
    assert "checkDiskFileForTab" in tabs_js
    assert "handleFilesChangedOnDisk" in tabs_js
    assert "checkOpenTabsAgainstTree" in tabs_js
    assert "Reload" in tabs_js
    assert "Ignore" in tabs_js
    assert "File was modified on disk" in tabs_js

    # Preview mode auto-reloads
    assert 'tabInfo.mode === "preview"' in tabs_js
    assert "reloadTabWithContent(tabInfo, diskContent)" in tabs_js

    # Source mode displays banner
    assert "showDiskChangeBanner(tabInfo, diskContent)" in tabs_js

    # WebSocket integration in fileWatcher.js
    assert "handleFilesChangedOnDisk" in file_watcher_js

    # Polling integration in fileTree.js
    assert "checkOpenTabsAgainstTree" in file_tree_js

    # CSS styles for .file-changed-banner
    assert ".file-changed-banner" in style_css
    assert ".btn-banner-reload" in style_css
    assert ".btn-banner-dismiss" in style_css


def test_image_file_preview_content_and_raw(tmp_path, monkeypatch):
    import base64
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "demo"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # 1x1 transparent PNG bytes
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
    img_file = ws_dir / "sample.png"
    img_file.write_bytes(png_bytes)

    # 1. Test get file content
    resp = client.get("/api/file-content?workspace=demo&path=sample.png")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_image"] is True
    assert data["mime_type"] == "image/png"
    assert data["content"].startswith("data:image/png;base64,")
    b64_part = data["content"].split("data:image/png;base64,")[1]
    assert base64.b64decode(b64_part) == png_bytes

    # 2. Test get raw file
    raw_resp = client.get("/api/files/raw?workspace=demo&path=sample.png")
    assert raw_resp.status_code == 200
    assert raw_resp.content == png_bytes

    # 3. Test saving image with data URL
    new_png_bytes = png_bytes + b"\x00"
    new_b64 = base64.b64encode(new_png_bytes).decode("ascii")
    save_resp = client.post(
        "/api/file-content",
        json={
            "workspace": "demo",
            "path": "sample.png",
            "content": f"data:image/png;base64,{new_b64}"
        }
    )
    assert save_resp.status_code == 200
    assert img_file.read_bytes() == new_png_bytes


def test_image_preview_and_editor_frontend_assets():
    index_html = Path("static/index.html").read_text(encoding="utf-8")
    preview_js = Path("static/js/preview.js").read_text(encoding="utf-8")
    image_editor_js = Path("static/js/imageEditor.js").read_text(encoding="utf-8")
    tabs_js = Path("static/js/tabs.js").read_text(encoding="utf-8")
    style_css = Path("static/style.css").read_text(encoding="utf-8")

    # index.html includes TUI image editor libraries
    assert "tui-image-editor" in index_html
    assert "fabric" in index_html
    assert "tui-code-snippet" in index_html
    assert "tui-color-picker" in index_html

    # preview.js has image preview type and renderer
    assert 'ext in ["png", "jpg"' in preview_js or '"png", "jpg"' in preview_js
    assert "renderImagePreview" in preview_js
    assert "renderTabPreview" in preview_js

    # imageEditor.js module exists and exports setupImageEditor
    assert "setupImageEditor" in image_editor_js
    assert "getTuiDarkTheme" in image_editor_js
    assert "tui.ImageEditor" in image_editor_js

    # tabs.js integrates imageEditor
    assert "setupImageEditor" in tabs_js
    assert "imageEditor" in tabs_js

    # style.css contains preview and editor styles
    assert ".image-preview-wrapper" in style_css
    assert ".image-preview-toolbar" in style_css
    assert ".checkerboard-bg" in style_css
    assert ".image-editor-container-pane" in style_css


def test_office_documents_backend_and_share_link(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "office_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Create dummy office files (docx, xlsx, pptx, doc, xls, xsl)
    doc_file = ws_dir / "report.docx"
    doc_file.write_bytes(b"PK\x03\x04dummy_word_content")
    xls_file = ws_dir / "data.xlsx"
    xls_file.write_bytes(b"PK\x03\x04dummy_excel_content")
    xsl_file = ws_dir / "style.xsl"
    xsl_file.write_bytes(b"<xsl:stylesheet></xsl:stylesheet>")

    # 1. Verify /api/file-content returns is_office: True
    res_doc = client.get("/api/file-content?workspace=office_ws&path=report.docx")
    assert res_doc.status_code == 200
    data_doc = res_doc.json()
    assert data_doc["is_office"] is True
    assert data_doc["content"] == ""
    assert data_doc["size"] == len(b"PK\x03\x04dummy_word_content")

    res_xls = client.get("/api/file-content?workspace=office_ws&path=data.xlsx")
    assert res_xls.status_code == 200
    assert res_xls.json()["is_office"] is True

    res_xsl = client.get("/api/file-content?workspace=office_ws&path=style.xsl")
    assert res_xsl.status_code == 200
    assert res_xsl.json()["is_office"] is True

    # 2. Verify /api/files/public-link returns path_url and full_path_url for office viewer
    res_share = client.post(
        "/api/files/public-link",
        json={"workspace": "office_ws", "path": "report.docx", "expires_in": 3600}
    )
    assert res_share.status_code == 200
    share_data = res_share.json()
    assert "path_url" in share_data
    assert "full_path_url" in share_data
    assert "/api/public/files/office_ws/report.docx" in share_data["path_url"]

    # 3. Access file via path_url and check CORS and content
    res_fetch = client.get(share_data["path_url"])
    assert res_fetch.status_code == 200
    assert res_fetch.content == b"PK\x03\x04dummy_word_content"
    assert res_fetch.headers.get("access-control-allow-origin") == "*"

    # 4. Raw file download endpoint
    res_raw = client.get("/api/files/raw?workspace=office_ws&path=report.docx")
    assert res_raw.status_code == 200
    assert res_raw.content == b"PK\x03\x04dummy_word_content"
    assert 'filename="report.docx"' in res_raw.headers.get("content-disposition", "")


def test_office_documents_frontend_integration():
    js = get_frontend_js()
    assert "OFFICE_EXTENSIONS" in js
    assert "renderOfficePreview" in js
    assert "getOfficeShareUrl" in js
    assert "view.officeapps.live.com" in js
    assert "office-preview-container" in js
    assert "office-preview-frame" in js

    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".office-preview-frame" in css
    assert ".office-local-warning" in css


def test_pdf_backend_and_content(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "pdf_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    pdf_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    pdf_file = ws_dir / "document.pdf"
    pdf_file.write_bytes(pdf_content)

    # 1. Verify /api/file-content returns is_pdf: True and empty content
    res = client.get("/api/file-content?workspace=pdf_ws&path=document.pdf")
    assert res.status_code == 200
    data = res.json()
    assert data["is_pdf"] is True
    assert data["content"] == ""
    assert data["size"] == len(pdf_content)

    # 2. Verify /api/files/raw with inline=1 returns inline content-disposition and application/pdf
    res_inline = client.get("/api/files/raw?workspace=pdf_ws&path=document.pdf&inline=1")
    assert res_inline.status_code == 200
    assert res_inline.content == pdf_content
    assert res_inline.headers.get("content-type") == "application/pdf"
    assert "inline" in res_inline.headers.get("content-disposition", "")
    assert 'filename="document.pdf"' in res_inline.headers.get("content-disposition", "")

    # 3. Verify /api/files/raw without inline returns attachment
    res_raw = client.get("/api/files/raw?workspace=pdf_ws&path=document.pdf")
    assert res_raw.status_code == 200
    assert res_raw.content == pdf_content
    assert "attachment" in res_raw.headers.get("content-disposition", "")
    assert 'filename="document.pdf"' in res_raw.headers.get("content-disposition", "")


def test_pdf_frontend_integration():
    js = get_frontend_js()
    assert "renderPdfPreview" in js
    assert "pdf-preview-frame" in js
    assert "pdf-preview-container" in js
    assert 'ext === "pdf"' in js
    assert "PDF Document" in js
    assert "previewType !== 'pdf'" in js

    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".pdf-preview-container" in css
    assert "iframe.pdf-preview-frame" in css


def test_workspace_modal_and_management():
    # 1. HTML elements in index.html
    resp = client.get("/")
    assert resp.status_code == 200
    html = resp.text
    assert 'id="workspace-modal"' in html
    assert 'id="workspace-active-trigger"' in html
    assert 'id="current-workspace-name"' in html
    assert 'id="btn-open-workspace-modal"' in html
    assert 'id="modal-new-ws-name"' in html
    assert 'id="modal-btn-create-ws"' in html
    assert 'id="modal-ws-search"' in html
    assert 'id="modal-ws-list"' in html

    # 2. JavaScript integration
    js = get_frontend_js()
    assert "openWorkspaceModal" in js
    assert "closeWorkspaceModal" in js
    assert "deleteWorkspace" in js
    assert "renameWorkspace" in js
    assert "renderModalWorkspaces" in js
    assert "initWorkspaceModal" in js

    # 3. CSS styles
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".workspace-active-card" in css
    assert ".modal-workspace-manager" in css
    assert ".ws-modal-list" in css
    assert ".ws-item" in css
    assert ".ws-rename-btn" in css
    assert ".ws-item-edit-row" in css













