// File Explorer Tree, Context Menu, Inline Rename, File Operations

import { state, indexWorkspaceTree } from "./state.js";
import { dom } from "./dom.js";
import { getIconSvg } from "./icons.js";
import { openFile, saveFile, closeTab, updateViewerHeaderActions, checkOpenTabsAgainstTree, reloadTabWithContent } from "./tabs.js";
import { isExecutableFile, executeFileInTty } from "./terminal.js";
import { openShareLinkModal } from "./shareModal.js";
import { openUploadFilesModal } from "./fileUpload.js";
import { getFilePreviewType } from "./preview.js";

export function toggleNewFileForm() {
  if (!state.currentWorkspace) return;
  const newFileForm = dom.newFileForm;
  const newFileInput = dom.newFileInput;
  if (!newFileForm) return;

  if (newFileForm.style.display === "none" || !newFileForm.style.display) {
    newFileForm.style.display = "flex";
    if (newFileInput) {
      newFileInput.value = "";
      newFileInput.focus();
    }
  } else {
    hideNewFileForm();
  }
}

export function hideNewFileForm() {
  const newFileForm = dom.newFileForm;
  const newFileInput = dom.newFileInput;
  if (newFileForm) newFileForm.style.display = "none";
  if (newFileInput) newFileInput.value = "";
}

export async function createNewFile() {
  if (!state.currentWorkspace) {
    alert("Please select a workspace first.");
    return;
  }
  const fileName = dom.newFileInput ? dom.newFileInput.value.trim() : "";
  if (!fileName) {
    alert("Please enter a file name.");
    return;
  }

  try {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: state.currentWorkspace,
        path: fileName,
        content: ""
      })
    });

    if (res.ok) {
      const data = await res.json();
      hideNewFileForm();
      await loadFiles();
      openFile(data.path, data.name);
    } else {
      const err = await res.json();
      alert("Error: " + (err.detail || "Could not create file"));
    }
  } catch (e) {
    alert("Request failed: " + e.message);
  }
}

export function showContextMenu(x, y, item, onRename, onDelete) {
  const ctxMenu = dom.ctxMenu;
  if (!ctxMenu) return;
  state.contextMenuTarget = { item, onRename, onDelete };

  const normPath = (item.path || "").replace(/\\/g, "/");
  const isBackupRoot = Boolean(normPath === ".backup" || item.name === ".backup");
  const isInsideBackup = Boolean(normPath.startsWith(".backup/"));
  const isBackupItem = isBackupRoot || isInsideBackup;

  if (dom.ctxExecute) {
    dom.ctxExecute.style.display = (!item.is_dir && isExecutableFile(item.name) && !isBackupItem) ? "" : "none";
  }

  if (dom.ctxUploadFolder) {
    dom.ctxUploadFolder.style.display = (item.is_dir && !isBackupItem) ? "" : "none";
  }

  if (dom.ctxShare) {
    dom.ctxShare.style.display = (item.is_dir || isBackupItem) ? "none" : "";
  }

  if (dom.ctxRename) {
    dom.ctxRename.style.display = isBackupItem ? "none" : "";
  }

  if (dom.ctxRestore) {
    dom.ctxRestore.style.display = isInsideBackup ? "" : "none";
  }

  if (dom.ctxQuickBackup) {
    dom.ctxQuickBackup.style.display = isBackupRoot ? "" : "none";
  }

  ctxMenu.style.display = "block";
  const rect = ctxMenu.getBoundingClientRect();
  const posX = Math.min(x, window.innerWidth - rect.width - 8);
  const posY = Math.min(y, window.innerHeight - rect.height - 8);

  ctxMenu.style.left = `${posX}px`;
  ctxMenu.style.top = `${posY}px`;
}

export function hideContextMenu() {
  if (dom.ctxMenu) {
    dom.ctxMenu.style.display = "none";
  }
  state.contextMenuTarget = null;
}

export function handleFileRenamed(oldPath, newPath, newName, isDir) {
  if (state.collapsedDirs.has(oldPath)) {
    state.collapsedDirs.delete(oldPath);
    state.collapsedDirs.add(newPath);
  }
  if (isDir) {
    const oldPrefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
    const newPrefix = newPath.endsWith("/") ? newPath : newPath + "/";

    for (const [tabId, tabInfo] of Array.from(state.openTabs.entries())) {
      if (tabInfo.path && (tabInfo.path === oldPath || tabInfo.path.startsWith(oldPrefix))) {
        const subPath = tabInfo.path.substring(oldPrefix.length);
        const updatedPath = newPrefix + subPath;
        const updatedName = updatedPath.split("/").pop();
        const updatedTabId = "file:" + updatedPath;

        state.openTabs.delete(tabId);
        tabInfo.tabId = updatedTabId;
        tabInfo.path = updatedPath;
        tabInfo.name = updatedName;
        tabInfo.tabElement.dataset.tabId = updatedTabId;
        tabInfo.titleElement.textContent = updatedName;
        tabInfo.titleElement.title = updatedPath;
        const pathSpan = tabInfo.paneElement.querySelector(".viewer-filepath");
        if (pathSpan) {
          pathSpan.textContent = updatedPath;
          pathSpan.title = updatedPath;
        }
        tabInfo.paneElement.id = "pane-" + CSS.escape(updatedTabId);
        state.openTabs.set(updatedTabId, tabInfo);
        updateViewerHeaderActions(tabInfo);
        if (state.activeTabId === tabId) {
          state.activeTabId = updatedTabId;
        }
      }
    }
  } else {
    const oldTabId = "file:" + oldPath;
    if (state.openTabs.has(oldTabId)) {
      const tabInfo = state.openTabs.get(oldTabId);
      state.openTabs.delete(oldTabId);
      const newTabId = "file:" + newPath;
      tabInfo.tabId = newTabId;
      tabInfo.path = newPath;
      tabInfo.name = newName;
      tabInfo.tabElement.dataset.tabId = newTabId;
      tabInfo.titleElement.textContent = newName;
      tabInfo.titleElement.title = newPath;
      const pathSpan = tabInfo.paneElement.querySelector(".viewer-filepath");
      if (pathSpan) {
        pathSpan.textContent = newPath;
        pathSpan.title = newPath;
      }
      tabInfo.paneElement.id = "pane-" + CSS.escape(newTabId);
      state.openTabs.set(newTabId, tabInfo);
      updateViewerHeaderActions(tabInfo);
      if (state.activeTabId === oldTabId) {
        state.activeTabId = newTabId;
      }
    }
  }
}

export function handleFileDeleted(deletedPath, isDir) {
  state.collapsedDirs.delete(deletedPath);
  if (isDir) {
    const prefix = deletedPath.endsWith("/") ? deletedPath : deletedPath + "/";
    for (const [tabId, tabInfo] of Array.from(state.openTabs.entries())) {
      if (tabInfo.path && (tabInfo.path === deletedPath || tabInfo.path.startsWith(prefix))) {
        closeTab(tabId, true);
      }
    }
  } else {
    const tabId = "file:" + deletedPath;
    if (state.openTabs.has(tabId)) {
      closeTab(tabId, true);
    }
  }
}

export async function doRenameFile(item, newName) {
  if (!state.currentWorkspace) return;
  const normPath = (item.path || "").replace(/\\/g, "/");
  if (normPath === ".backup" || normPath.startsWith(".backup/")) {
    alert("Renaming files or folders in .backup is forbidden.");
    return;
  }
  const cleanName = newName.trim();
  if (!cleanName || cleanName === item.name) return;

  try {
    const res = await fetch("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: state.currentWorkspace,
        old_path: item.path,
        new_path: cleanName
      })
    });

    if (res.ok) {
      const data = await res.json();
      handleFileRenamed(item.path, data.new_path, data.name, Boolean(item.is_dir));
      await loadFiles();
    } else {
      const err = await res.json();
      alert("Error: " + (err.detail || "Could not rename"));
      await loadFiles();
    }
  } catch (e) {
    alert("Rename failed: " + e.message);
    await loadFiles();
  }
}

export async function doDeleteFile(item) {
  if (!state.currentWorkspace) return;
  const isDir = Boolean(item.is_dir);
  const msg = isDir
    ? `Are you sure you want to delete folder "${item.name}" and all its contents?`
    : `Are you sure you want to delete "${item.name}"?`;
  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/files?workspace=${encodeURIComponent(state.currentWorkspace)}&path=${encodeURIComponent(item.path)}`, {
      method: "DELETE"
    });

    if (res.ok) {
      handleFileDeleted(item.path, isDir);
      await loadFiles();
    } else {
      const err = await res.json();
      alert("Error: " + (err.detail || "Could not delete"));
    }
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}

export function startInlineRename(row, nameSpan, item) {
  const normPath = (item.path || "").replace(/\\/g, "/");
  if (normPath === ".backup" || normPath.startsWith(".backup/")) {
    alert("Renaming files or folders in .backup is forbidden.");
    return;
  }
  if (state.activeInlineRename) {
    state.activeInlineRename.cancel();
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-rename-input";
  input.value = item.name;

  nameSpan.style.display = "none";
  row.insertBefore(input, nameSpan.nextSibling);

  let finished = false;

  const cancel = () => {
    if (finished) return;
    finished = true;
    input.remove();
    nameSpan.style.display = "";
    state.activeInlineRename = null;
    loadFiles();
  };

  const commit = async () => {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    if (!newName || newName === item.name) {
      input.remove();
      nameSpan.style.display = "";
      state.activeInlineRename = null;
      loadFiles();
      return;
    }
    input.remove();
    nameSpan.style.display = "";
    state.activeInlineRename = null;
    await doRenameFile(item, newName);
  };

  state.activeInlineRename = { commit, cancel };

  input.onclick = (e) => e.stopPropagation();
  input.ondblclick = (e) => e.stopPropagation();

  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      cancel();
    }
  };

  input.onblur = () => {
    commit();
  };

  input.focus();
  const lastDot = item.name.lastIndexOf(".");
  if (!item.is_dir && lastDot > 0) {
    input.setSelectionRange(0, lastDot);
  } else {
    input.select();
  }
}

export async function loadFiles(forceRender = false) {
  if (!state.currentWorkspace) return;
  const wsToFetch = state.currentWorkspace;
  try {
    const res = await fetch(`/api/files?workspace=${encodeURIComponent(wsToFetch)}`);
    if (!res.ok) throw new Error("Failed to fetch files");
    const data = await res.json();
    if (state.currentWorkspace === wsToFetch) {
      indexWorkspaceTree(data.tree);
      checkOpenTabsAgainstTree(data.tree);
      const treeJson = JSON.stringify(data.tree);
      if (!forceRender && treeJson === state.lastRenderedTreeJson) {
        return;
      }
      if (state.activeInlineRename) {
        return;
      }
      state.lastRenderedTreeJson = treeJson;
      renderFileTree(data.tree);
    }
  } catch (err) {
    if (state.currentWorkspace === wsToFetch && dom.fileTreeContainer) {
      dom.fileTreeContainer.innerHTML = `<div class="empty-state">Error loading files: ${err.message}</div>`;
    }
  }
}

export function isDirCollapsed(item) {
  const normPath = (item.path || "").replace(/\\/g, "/");
  if (state.collapsedDirs.has(normPath) || state.collapsedDirs.has(item.path)) {
    return true;
  }
  if (state.expandedDirs && (state.expandedDirs.has(normPath) || state.expandedDirs.has(item.path))) {
    return false;
  }
  if (normPath === ".backup" || item.name === ".backup" || normPath.startsWith(".backup/")) {
    return true;
  }
  return false;
}

export function renderFileTree(tree) {
  const container = dom.fileTreeContainer;
  if (!container) return;
  container.innerHTML = "";
  if (!tree || tree.length === 0) {
    container.innerHTML = '<div class="empty-state">Empty workspace</div>';
    return;
  }

  function createNode(item) {
    const wrapper = document.createElement("div");
    
    const row = document.createElement("div");
    row.className = "tree-node";

    const normPath = (item.path || "").replace(/\\/g, "/");
    const isPublicFolder = Boolean(
      item.is_dir && (
        normPath === "public" ||
        item.name.toLowerCase() === "public"
      )
    );
    const isBackupRoot = Boolean(
      item.is_dir && (
        normPath === ".backup" ||
        item.name === ".backup"
      )
    );
    const isInsideBackup = Boolean(normPath.startsWith(".backup/"));
    const isBackupItem = isBackupRoot || isInsideBackup;

    const icon = document.createElement("span");
    icon.className = "tree-icon";
    const pType = getFilePreviewType(item.name);
    if (isPublicFolder) {
      icon.innerHTML = getIconSvg("globe");
    } else if (isBackupRoot) {
      icon.innerHTML = getIconSvg("history");
    } else if (item.is_dir) {
      const isExpanded = !isDirCollapsed(item);
      icon.innerHTML = getIconSvg(isExpanded ? "folder-open" : "folder");
    } else if (pType === "markdown") {
      icon.innerHTML = getIconSvg("file-text");
    } else if (pType === "html") {
      icon.innerHTML = getIconSvg("globe");
    } else if (pType === "svg" || pType === "image") {
      icon.innerHTML = getIconSvg("image");
    } else if (pType === "office" || pType === "pdf") {
      icon.innerHTML = getIconSvg("file-text");
    } else if (item.name.toLowerCase().endsWith(".js") || item.name.toLowerCase().endsWith(".py") || item.name.toLowerCase().endsWith(".sh") || item.name.toLowerCase().endsWith(".bash")) {
      icon.innerHTML = getIconSvg("code");
    } else {
      icon.innerHTML = getIconSvg("file");
    }

    if (isPublicFolder) {
      row.classList.add("tree-node-public");
      icon.title = `Public folder: /public/${state.currentWorkspace || ""}`;
    } else if (isBackupRoot) {
      row.classList.add("tree-node-backup");
      icon.title = "Workspace Backups (.backup)";
    }

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = item.name;

    const actions = document.createElement("div");
    actions.className = "tree-actions";

    if (!item.is_dir && isExecutableFile(item.name) && !isBackupItem) {
      const btnExecute = document.createElement("button");
      btnExecute.className = "tree-action-btn btn-execute";
      btnExecute.title = "Execute";
      btnExecute.innerHTML = getIconSvg("zap");
      btnExecute.onclick = async (e) => {
        e.stopPropagation();
        const tabId = "file:" + item.path;
        if (state.openTabs.has(tabId)) {
          const tInfo = state.openTabs.get(tabId);
          if (tInfo && tInfo.isDirty) {
            await saveFile(tInfo);
          }
        }
        executeFileInTty(item.name);
      };
      actions.appendChild(btnExecute);
    }

    if (isInsideBackup) {
      const btnRestore = document.createElement("button");
      btnRestore.className = "tree-action-btn btn-restore";
      btnRestore.title = "Restore from backup";
      btnRestore.innerHTML = getIconSvg("rotate-ccw");
      btnRestore.onclick = (e) => {
        e.stopPropagation();
        doRestoreBackup(item);
      };
      actions.appendChild(btnRestore);
    }

    if (!isBackupItem) {
      const btnRename = document.createElement("button");
      btnRename.className = "tree-action-btn btn-rename";
      btnRename.title = "Rename";
      btnRename.innerHTML = getIconSvg("edit");
      btnRename.onclick = (e) => {
        e.stopPropagation();
        startInlineRename(row, name, item);
      };
      actions.appendChild(btnRename);
    }

    const btnDelete = document.createElement("button");
    btnDelete.className = "tree-action-btn btn-delete";
    btnDelete.title = "Delete";
    btnDelete.innerHTML = getIconSvg("trash");
    btnDelete.onclick = (e) => {
      e.stopPropagation();
      doDeleteFile(item);
    };
    actions.appendChild(btnDelete);

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(actions);
    wrapper.appendChild(row);

    // Right-click context menu
    row.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, item, () => startInlineRename(row, name, item), () => doDeleteFile(item));
    };

    if (item.is_dir) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      let expanded = !isDirCollapsed(item);
      childrenContainer.style.display = expanded ? "block" : "none";
      if (isPublicFolder) {
        icon.innerHTML = getIconSvg("globe");
      } else if (isBackupRoot) {
        icon.innerHTML = getIconSvg("history");
      } else {
        icon.innerHTML = getIconSvg(expanded ? "folder-open" : "folder");
      }

      row.addEventListener("dragover", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(it => it.kind === "file")) {
          e.preventDefault();
          e.stopPropagation();
          row.classList.add("dragover");
        }
      });
      row.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        row.classList.remove("dragover");
      });
      row.addEventListener("drop", (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove("dragover");
          openUploadFilesModal({ targetDir: item.path }, e.dataTransfer.files);
        }
      });

      row.onclick = () => {
        const wasCollapsed = isDirCollapsed(item);
        if (wasCollapsed) {
          state.collapsedDirs.delete(item.path);
          state.collapsedDirs.delete(normPath);
          if (state.expandedDirs) {
            state.expandedDirs.add(item.path);
            state.expandedDirs.add(normPath);
          }
        } else {
          state.collapsedDirs.add(item.path);
          state.collapsedDirs.add(normPath);
          if (state.expandedDirs) {
            state.expandedDirs.delete(item.path);
            state.expandedDirs.delete(normPath);
          }
        }
        const isNowExpanded = !isDirCollapsed(item);
        childrenContainer.style.display = isNowExpanded ? "block" : "none";
        if (isPublicFolder) {
          icon.innerHTML = getIconSvg("globe");
        } else if (isBackupRoot) {
          icon.innerHTML = getIconSvg("history");
        } else {
          icon.innerHTML = getIconSvg(isNowExpanded ? "folder-open" : "folder");
        }
      };

      if (item.children) {
        item.children.forEach(child => {
          childrenContainer.appendChild(createNode(child));
        });
      }
      wrapper.appendChild(childrenContainer);
    } else {
      row.onclick = () => {
        openFile(item.path, item.name);
      };
    }

    return wrapper;
  }

  tree.forEach(item => {
    container.appendChild(createNode(item));
  });
}

export function revealPathInTree(filePath) {
  if (!filePath || !filePath.includes("/")) return;
  const parts = filePath.split("/");
  parts.pop();
  let current = "";
  let changed = false;
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (state.collapsedDirs.has(current)) {
      state.collapsedDirs.delete(current);
      changed = true;
    }
    if (state.expandedDirs && !state.expandedDirs.has(current)) {
      state.expandedDirs.add(current);
      changed = true;
    }
  }
  if (changed) {
    loadFiles(true);
  }
}

export function initFileTreeEvents() {
  if (dom.btnNewFile) dom.btnNewFile.onclick = toggleNewFileForm;
  if (dom.btnCreateFileSubmit) dom.btnCreateFileSubmit.onclick = createNewFile;
  if (dom.btnCreateFileCancel) dom.btnCreateFileCancel.onclick = hideNewFileForm;
  if (dom.newFileInput) {
    dom.newFileInput.onkeydown = (e) => {
      if (e.key === "Enter") createNewFile();
      else if (e.key === "Escape") hideNewFileForm();
    };
  }

  if (dom.ctxExecute) {
    dom.ctxExecute.onclick = async () => {
      if (state.contextMenuTarget && state.contextMenuTarget.item && !state.contextMenuTarget.item.is_dir) {
        const item = state.contextMenuTarget.item;
        hideContextMenu();
        const tabId = "file:" + item.path;
        if (state.openTabs.has(tabId)) {
          const tInfo = state.openTabs.get(tabId);
          if (tInfo && tInfo.isDirty) {
            await saveFile(tInfo);
          }
        }
        executeFileInTty(item.name);
      }
    };
  }

  if (dom.ctxUploadFolder) {
    dom.ctxUploadFolder.onclick = () => {
      if (state.contextMenuTarget && state.contextMenuTarget.item && state.contextMenuTarget.item.is_dir) {
        const item = state.contextMenuTarget.item;
        hideContextMenu();
        openUploadFilesModal({ targetDir: item.path });
      }
    };
  }

  if (dom.ctxShare) {
    dom.ctxShare.onclick = () => {
      if (state.contextMenuTarget && state.contextMenuTarget.item && !state.contextMenuTarget.item.is_dir) {
        const item = state.contextMenuTarget.item;
        hideContextMenu();
        openShareLinkModal(state.currentWorkspace, item.path, item.name);
      }
    };
  }

  if (dom.ctxRename) {
    dom.ctxRename.onclick = () => {
      if (state.contextMenuTarget && state.contextMenuTarget.onRename) {
        const action = state.contextMenuTarget.onRename;
        hideContextMenu();
        action();
      }
    };
  }

  if (dom.ctxDelete) {
    dom.ctxDelete.onclick = () => {
      if (state.contextMenuTarget && state.contextMenuTarget.onDelete) {
        const action = state.contextMenuTarget.onDelete;
        hideContextMenu();
        action();
      }
    };
  }

  if (dom.ctxRestore) {
    dom.ctxRestore.onclick = () => {
      if (state.contextMenuTarget && state.contextMenuTarget.item) {
        const item = state.contextMenuTarget.item;
        hideContextMenu();
        doRestoreBackup(item);
      }
    };
  }

  if (dom.ctxQuickBackup) {
    dom.ctxQuickBackup.onclick = () => {
      hideContextMenu();
      createQuickBackup();
    };
  }

  window.addEventListener("click", (e) => {
    if (dom.ctxMenu && dom.ctxMenu.style.display !== "none" && !dom.ctxMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
    }
  });
}

export async function doRestoreBackup(item) {
  if (!state.currentWorkspace) return;
  const normPath = (item.path || "").replace(/\\/g, "/");
  if (!normPath.startsWith(".backup/")) {
    alert("Only items inside .backup can be restored.");
    return;
  }

  const rel = normPath.replace(/^\.backup\//, "");
  const parts = rel.split("/");
  const snapshotName = parts[0];
  const isFullWorkspace = parts.length === 1;
  const subPath = parts.slice(1).join("/");

  const msg = isFullWorkspace
    ? `Restore entire workspace to backup "${snapshotName}"?\n\nA safety backup of your current workspace will be created automatically before restoring.`
    : `Restore "${subPath}" from backup "${snapshotName}"?\n\nA safety backup of your current workspace will be created automatically before restoring.`;

  if (!confirm(msg)) return;

  try {
    const res = await fetch("/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: state.currentWorkspace,
        backup_path: item.path
      })
    });

    if (res.ok) {
      const data = await res.json();
      const safetyMsg = data.safety_backup ? `\n(Safety backup created: ${data.safety_backup})` : "";
      alert(`Successfully restored!${safetyMsg}`);
      await loadFiles(true);

      for (const [tabId, tabInfo] of state.openTabs.entries()) {
        if (tabInfo.path && !tabInfo.path.startsWith(".backup/")) {
          if (isFullWorkspace || tabInfo.path === subPath || tabInfo.path.startsWith(subPath + "/")) {
            reloadTabWithContent(tabInfo);
          }
        }
      }
    } else {
      const err = await res.json();
      alert("Restore failed: " + (err.detail || "Could not restore"));
    }
  } catch (e) {
    alert("Restore request failed: " + e.message);
  }
}

export async function createQuickBackup() {
  if (!state.currentWorkspace) {
    alert("Please select a workspace first.");
    return;
  }

  try {
    const res = await fetch("/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: state.currentWorkspace
      })
    });

    if (res.ok) {
      const data = await res.json();
      alert(`Backup created successfully: .backup/${data.backup}/`);
      await loadFiles(true);
    } else {
      const err = await res.json();
      alert("Backup failed: " + (err.detail || "Could not create backup"));
    }
  } catch (e) {
    alert("Backup request failed: " + e.message);
  }
}

