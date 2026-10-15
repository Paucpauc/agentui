import pytest
import os
import shutil
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app, BASE_WORKSPACE

client = TestClient(app)


@pytest.fixture(autouse=True)
def disable_auth_for_backup_tests(monkeypatch):
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    monkeypatch.delenv("AUTH_ENABLED", raising=False)


def test_quick_backup_creation_and_listing(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "backup_test_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Create some files in the workspace
    (ws_dir / "file1.txt").write_text("Hello World", encoding="utf-8")
    sub_dir = ws_dir / "src"
    sub_dir.mkdir()
    (sub_dir / "code.py").write_text("print('test')", encoding="utf-8")

    # 1. Trigger quick backup
    resp = client.post("/api/backups", json={"workspace": "backup_test_ws"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "backup" in data
    backup_name = data["backup"]
    assert (ws_dir / ".backup" / backup_name).is_dir()
    assert (ws_dir / ".backup" / backup_name / "file1.txt").read_text(encoding="utf-8") == "Hello World"
    assert (ws_dir / ".backup" / backup_name / "src" / "code.py").read_text(encoding="utf-8") == "print('test')"

    # Ensure .backup itself was not copied into the backup snapshot
    assert not (ws_dir / ".backup" / backup_name / ".backup").exists()

    # 2. List backups via GET /api/backups
    resp_list = client.get("/api/backups?workspace=backup_test_ws")
    assert resp_list.status_code == 200
    backups_data = resp_list.json()
    assert len(backups_data["backups"]) == 1
    assert backups_data["backups"][0]["name"] == backup_name


def test_backup_tree_listing_and_protections(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "protection_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    (ws_dir / "doc.txt").write_text("Original Doc", encoding="utf-8")

    # Create a backup
    resp = client.post("/api/backups", json={"workspace": "protection_ws"})
    assert resp.status_code == 200
    backup_name = resp.json()["backup"]

    # 1. Verify /api/files returns .backup in tree
    resp_files = client.get("/api/files?workspace=protection_ws")
    assert resp_files.status_code == 200
    tree = resp_files.json()["tree"]
    backup_node = next((node for node in tree if node["name"] == ".backup"), None)
    assert backup_node is not None
    assert backup_node["is_dir"] is True
    assert any(child["name"] == backup_name for child in backup_node.get("children", []))

    # 2. Verify editing/saving a file inside .backup is PROHIBITED (403)
    resp_save = client.post(
        "/api/file-content",
        json={"workspace": "protection_ws", "path": f".backup/{backup_name}/doc.txt", "content": "Hacked"},
    )
    assert resp_save.status_code == 403
    assert "read-only" in resp_save.json()["detail"].lower()

    # 3. Verify creating a file inside .backup is PROHIBITED (403)
    resp_create = client.post(
        "/api/files",
        json={"workspace": "protection_ws", "path": f".backup/{backup_name}/new.txt", "content": "New"},
    )
    assert resp_create.status_code == 403

    # 4. Verify renaming files or folders inside .backup is PROHIBITED (403)
    resp_rename = client.post(
        "/api/files/rename",
        json={
            "workspace": "protection_ws",
            "old_path": f".backup/{backup_name}/doc.txt",
            "new_path": f".backup/{backup_name}/doc_renamed.txt",
        },
    )
    assert resp_rename.status_code == 403

    resp_rename_root = client.post(
        "/api/files/rename",
        json={
            "workspace": "protection_ws",
            "old_path": ".backup",
            "new_path": ".backup_renamed",
        },
    )
    assert resp_rename_root.status_code == 403

    # 5. Verify deleting files or folders inside .backup IS ALLOWED (200)
    resp_del = client.delete(f"/api/files?workspace=protection_ws&path=.backup/{backup_name}/doc.txt")
    assert resp_del.status_code == 200
    assert not (ws_dir / ".backup" / backup_name / "doc.txt").exists()


def test_restore_entire_workspace_with_safety_backup(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "restore_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Initial state
    (ws_dir / "version.txt").write_text("v1.0.0", encoding="utf-8")
    (ws_dir / "keep_me.txt").write_text("original keep", encoding="utf-8")

    # Create backup snapshot 1
    resp_bk1 = client.post("/api/backups", json={"workspace": "restore_ws"})
    assert resp_bk1.status_code == 200
    bk1_name = resp_bk1.json()["backup"]

    # Modify workspace to state 2
    (ws_dir / "version.txt").write_text("v2.0.0 (corrupted)", encoding="utf-8")
    (ws_dir / "new_unwanted_file.txt").write_text("bad data", encoding="utf-8")
    (ws_dir / "keep_me.txt").unlink()

    # Restore entire workspace from bk1
    resp_restore = client.post(
        "/api/backups/restore",
        json={"workspace": "restore_ws", "backup_path": f".backup/{bk1_name}"},
    )
    assert resp_restore.status_code == 200
    restore_data = resp_restore.json()
    assert restore_data["status"] == "ok"
    assert restore_data["is_full_workspace"] is True
    assert "safety_backup" in restore_data
    safety_name = restore_data["safety_backup"]

    # Check workspace is restored to v1.0.0
    assert (ws_dir / "version.txt").read_text(encoding="utf-8") == "v1.0.0"
    assert (ws_dir / "keep_me.txt").read_text(encoding="utf-8") == "original keep"
    assert not (ws_dir / "new_unwanted_file.txt").exists()

    # Check that safety backup contains state 2!
    safety_dir = ws_dir / ".backup" / safety_name
    assert safety_dir.is_dir()
    assert (safety_dir / "version.txt").read_text(encoding="utf-8") == "v2.0.0 (corrupted)"
    assert (safety_dir / "new_unwanted_file.txt").read_text(encoding="utf-8") == "bad data"


def test_restore_specific_file_and_folder_with_safety_backup(tmp_path, monkeypatch):
    test_base = tmp_path / "workspaces"
    test_base.mkdir()
    ws_dir = test_base / "partial_ws"
    ws_dir.mkdir()
    monkeypatch.setattr("app.main.BASE_WORKSPACE", str(test_base))

    # Initial state
    src_dir = ws_dir / "src"
    src_dir.mkdir()
    (src_dir / "app.py").write_text("GOOD CODE", encoding="utf-8")
    (ws_dir / "config.json").write_text('{"env": "prod"}', encoding="utf-8")

    # Backup
    resp_bk = client.post("/api/backups", json={"workspace": "partial_ws"})
    assert resp_bk.status_code == 200
    bk_name = resp_bk.json()["backup"]

    # Break app.py, and change config.json
    (src_dir / "app.py").write_text("BROKEN CODE", encoding="utf-8")
    (ws_dir / "config.json").write_text('{"env": "staging"}', encoding="utf-8")

    # Restore ONLY src/app.py
    resp_restore = client.post(
        "/api/backups/restore",
        json={"workspace": "partial_ws", "backup_path": f".backup/{bk_name}/src/app.py"},
    )
    assert resp_restore.status_code == 200
    assert resp_restore.json()["is_full_workspace"] is False
    safety_name = resp_restore.json()["safety_backup"]

    # app.py should be restored to GOOD CODE, but config.json should remain {"env": "staging"}
    assert (src_dir / "app.py").read_text(encoding="utf-8") == "GOOD CODE"
    assert (ws_dir / "config.json").read_text(encoding="utf-8") == '{"env": "staging"}'

    # Safety backup was created
    assert (ws_dir / ".backup" / safety_name / "src" / "app.py").read_text(encoding="utf-8") == "BROKEN CODE"


def test_frontend_backup_elements_and_logic():
    # 1. index.html has btn-quick-backup and context menu items
    resp_index = client.get("/")
    assert resp_index.status_code == 200
    html = resp_index.text
    assert "btn-quick-backup" in html
    assert "ctx-menu-restore" in html
    assert "ctx-menu-quick-backup" in html

    # 2. style.css defines backup styles
    resp_css = client.get("/static/style.css")
    assert resp_css.status_code == 200
    css = resp_css.text
    assert ".tree-node-backup" in css
    assert ".tree-action-btn.btn-restore" in css
    assert ".badge-backup-readonly" in css
    assert ".btn-restore-file" in css

    # 3. JavaScript modules contain backup functionality
    r_file_tree = client.get("/static/js/fileTree.js")
    assert r_file_tree.status_code == 200
    js_tree = r_file_tree.text
    assert "isDirCollapsed" in js_tree
    assert "doRestoreBackup" in js_tree
    assert "createQuickBackup" in js_tree
    assert "btn-restore" in js_tree
    assert ".backup" in js_tree

    r_state = client.get("/static/js/state.js")
    assert r_state.status_code == 200
    assert ".backup" in r_state.text
    assert "expandedDirs" in r_state.text

    r_tab_ui = client.get("/static/js/tabUi.js")
    assert r_tab_ui.status_code == 200
    assert "btn-restore-file" in r_tab_ui.text
    assert "badge-backup-readonly" in r_tab_ui.text

    r_tabs = client.get("/static/js/tabs.js")
    assert r_tabs.status_code == 200
    assert "backup-banner" in r_tabs.text

    r_app = client.get("/static/app.js")
    assert r_app.status_code == 200
    assert "createQuickBackup" in r_app.text
