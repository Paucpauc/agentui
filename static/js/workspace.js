// Workspace Navigation, URL Routing, Modal Management, Creation & Switching

import { state } from "./state.js";
import { dom } from "./dom.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { connectPty } from "./terminal.js";
import { connectFileWatcher, disconnectFileWatcher } from "./fileWatcher.js";
import { loadFiles, hideNewFileForm } from "./fileTree.js";
import { closeAllTabs, confirmDiscardUnsavedChanges } from "./tabs.js";

export function getWorkspaceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("workspace") || params.get("ws");
  if (fromQuery && fromQuery.trim()) {
    return fromQuery.trim();
  }

  const match = window.location.pathname.match(/^\/workspaces?\/([^/]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch (e) {
      return match[1].trim();
    }
  }

  return null;
}

export function updateUrl(workspaceName, replace = false) {
  if (!workspaceName) {
    const url = new URL(window.location.href);
    url.searchParams.delete("workspace");
    url.searchParams.delete("ws");
    const newPath = url.pathname.replace(/^\/workspaces?\/[^/]+/, "") || "/";
    const targetUrl = newPath + (url.search ? url.search : "");
    if (replace) {
      window.history.replaceState({ workspace: null }, "", targetUrl);
    } else {
      window.history.pushState({ workspace: null }, "", targetUrl);
    }
    return;
  }

  const isPathBased = /^\/workspaces?(\/|$)/.test(window.location.pathname);
  if (isPathBased) {
    const basePath = window.location.pathname.startsWith("/workspaces") ? "/workspaces" : "/workspace";
    const url = new URL(window.location.href);
    url.searchParams.delete("workspace");
    url.searchParams.delete("ws");
    const search = url.search ? url.search : "";
    const targetUrl = `${basePath}/${encodeURIComponent(workspaceName)}${search}`;
    if (replace) {
      window.history.replaceState({ workspace: workspaceName }, "", targetUrl);
    } else {
      window.history.pushState({ workspace: workspaceName }, "", targetUrl);
    }
  } else {
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", workspaceName);
    url.searchParams.delete("ws");
    const targetUrl = url.pathname + url.search;
    if (replace) {
      window.history.replaceState({ workspace: workspaceName }, "", targetUrl);
    } else {
      window.history.pushState({ workspace: workspaceName }, "", targetUrl);
    }
  }
}

export async function loadWorkspaces(preferredWs = null) {
  try {
    const res = await fetch("/api/workspaces");
    const data = await res.json();
    const workspaces = data.workspaces || [];
    state.workspacesList = workspaces;

    // Backward compatibility for select if present
    const wsSelect = dom.wsSelect;
    if (wsSelect) {
      wsSelect.innerHTML = '<option value="" disabled>Select workspace...</option>';
      workspaces.forEach(ws => {
        const opt = document.createElement("option");
        opt.value = ws;
        opt.textContent = ws;
        wsSelect.appendChild(opt);
      });
    }

    const urlWs = preferredWs || getWorkspaceFromUrl();
    let targetWs = null;

    if (urlWs && workspaces.includes(urlWs)) {
      targetWs = urlWs;
    } else if (state.currentWorkspace && workspaces.includes(state.currentWorkspace)) {
      targetWs = state.currentWorkspace;
    } else if (workspaces.length > 0) {
      targetWs = workspaces[0];
    }

    if (targetWs) {
      if (state.currentWorkspace === targetWs) {
        if (wsSelect) wsSelect.value = targetWs;
        if (dom.currentWsName) dom.currentWsName.textContent = targetWs;
        if (dom.btnNewFile) dom.btnNewFile.disabled = false;
        if (dom.btnUploadFile) dom.btnUploadFile.disabled = false;
        document.title = `${targetWs} - Agent Web UI`;
        updateUrl(targetWs, true);
        loadFiles();
        connectFileWatcher();
      } else {
        selectWorkspace(targetWs, true, "replace");
      }
    } else {
      state.currentWorkspace = null;
      disconnectFileWatcher();
      if (wsSelect) wsSelect.value = "";
      if (dom.currentWsName) dom.currentWsName.textContent = "No workspace";
      updateUrl(null, true);
      if (dom.fileTreeContainer) {
        dom.fileTreeContainer.innerHTML = '<div class="empty-state">No workspaces found. Click "Manage" to create one.</div>';
      }
    }

    if (dom.btnNewFile) {
      dom.btnNewFile.disabled = !state.currentWorkspace;
    }
    if (dom.btnUploadFile) {
      dom.btnUploadFile.disabled = !state.currentWorkspace;
    }
    if (dom.btnDownloadWs) {
      dom.btnDownloadWs.disabled = !state.currentWorkspace;
    }
    if (dom.btnQuickBackup) {
      dom.btnQuickBackup.disabled = !state.currentWorkspace;
    }

    // Refresh modal list if modal is currently open
    if (dom.workspaceModal && dom.workspaceModal.style.display !== "none") {
      renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
    }
  } catch (err) {
    console.error("Failed to load workspaces", err);
  }
}

export function selectWorkspace(name, force = false) {
  const historyAction = arguments.length > 2 ? arguments[2] : "push";
  const wsSelect = dom.wsSelect;
  if (state.currentWorkspace === name && !force) return true;

  if (!force && !confirmDiscardUnsavedChanges()) {
    if (wsSelect && state.currentWorkspace) {
      wsSelect.value = state.currentWorkspace;
    }
    return false;
  }

  const wsChanged = (state.currentWorkspace !== name);

  closeAllTabs();
  hideNewFileForm();

  state.currentWorkspace = name;
  state.collapsedDirs.clear();
  state.collapsedDirs.add(".backup");
  if (state.expandedDirs) state.expandedDirs.clear();
  state.workspaceFilesMap.clear();
  state.lastRenderedTreeJson = null;

  if (wsSelect) {
    wsSelect.value = name;
  }
  if (dom.currentWsName) {
    dom.currentWsName.textContent = name || "Select workspace...";
  }
  if (dom.btnNewFile) {
    dom.btnNewFile.disabled = !name;
  }
  if (dom.btnUploadFile) {
    dom.btnUploadFile.disabled = !name;
  }
  if (dom.btnDownloadWs) {
    dom.btnDownloadWs.disabled = !name;
  }
  if (dom.btnQuickBackup) {
    dom.btnQuickBackup.disabled = !name;
  }
  document.title = name ? `${name} - Agent Web UI` : "Agent Web UI";

  if (historyAction === "push") {
    updateUrl(name, false);
  } else if (historyAction === "replace") {
    updateUrl(name, true);
  }

  loadFiles(true);
  connectFileWatcher();

  // Reconnect terminal in new workspace directory
  if (state.term) {
    if (wsChanged || !state.ptySocket || state.ptySocket.readyState !== WebSocket.OPEN) {
      state.term.reset();
      connectPty();
    }
  }

  // Refresh modal active indicator if open
  if (dom.workspaceModal && dom.workspaceModal.style.display !== "none") {
    renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
  }

  return true;
}

export async function createWorkspace(customName = null) {
  let name = customName;
  const modalInput = dom.modalNewWsInput;
  const legacyInput = dom.newWsInput;

  if (!name) {
    if (modalInput && modalInput.value.trim()) {
      name = modalInput.value.trim();
    } else if (legacyInput && legacyInput.value.trim()) {
      name = legacyInput.value.trim();
    }
  }

  if (!name) {
    showModalCreateError("Please enter a workspace name");
    return;
  }

  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    showModalCreateError("Workspace name contains invalid characters");
    return;
  }

  if (!confirmDiscardUnsavedChanges()) {
    return;
  }

  hideModalCreateError();

  try {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    if (res.ok) {
      if (modalInput) modalInput.value = "";
      if (legacyInput) legacyInput.value = "";
      await loadWorkspaces(name);
      selectWorkspace(name, true, "push");
      closeWorkspaceModal();
    } else {
      const err = await res.json().catch(() => ({}));
      const msg = err.detail || "Could not create workspace";
      showModalCreateError(msg);
    }
  } catch (e) {
    showModalCreateError("Request failed: " + e.message);
  }
}

export async function deleteWorkspace(name) {
  if (!name) return;

  const confirmed = window.confirm(
    `Are you sure you want to delete workspace "${name}"?\n\nAll files and folders in this workspace will be permanently deleted.`
  );
  if (!confirmed) return;

  if (state.currentWorkspace === name && !confirmDiscardUnsavedChanges()) {
    return;
  }

  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Error: " + (err.detail || "Could not delete workspace"));
      return;
    }

    const wasCurrent = (state.currentWorkspace === name);
    await loadWorkspaces();

    if (wasCurrent) {
      // Find remaining workspace
      if (state.workspacesList && state.workspacesList.length > 0) {
        selectWorkspace(state.workspacesList[0], true, "replace");
      } else {
        state.currentWorkspace = null;
        if (dom.currentWsName) dom.currentWsName.textContent = "No workspace";
        updateUrl(null, true);
        loadFiles(true);
      }
    } else {
      if (dom.workspaceModal && dom.workspaceModal.style.display !== "none") {
        renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
      }
    }
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}

export async function renameWorkspace(oldName, newName) {
  if (!oldName || !newName) return false;
  oldName = oldName.trim();
  newName = newName.trim();

  if (!newName || oldName === newName) {
    state.activeWorkspaceRename = null;
    renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
    return true;
  }

  if (newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
    alert("Invalid workspace name. Slashes and relative dots are not allowed.");
    return false;
  }

  if (state.workspacesList && state.workspacesList.includes(newName)) {
    alert(`A workspace with name "${newName}" already exists.`);
    return false;
  }

  try {
    const res = await fetch("/api/workspaces/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_name: oldName, new_name: newName })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Failed to rename workspace: " + (err.detail || res.statusText));
      return false;
    }

    state.activeWorkspaceRename = null;

    const wasCurrent = (state.currentWorkspace === oldName);
    if (wasCurrent) {
      for (const [, tabInfo] of state.openTabs.entries()) {
        if (tabInfo.workspace === oldName) {
          tabInfo.workspace = newName;
        }
      }
      state.currentWorkspace = newName;
      if (dom.currentWsName) dom.currentWsName.textContent = newName;
      updateUrl(newName, true);
      document.title = `${newName} - Agent Web UI`;
    }

    await loadWorkspaces(wasCurrent ? newName : state.currentWorkspace);

    if (wasCurrent) {
      loadFiles(true);
      connectFileWatcher();
    }

    if (dom.workspaceModal && dom.workspaceModal.style.display !== "none") {
      renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
    }

    return true;
  } catch (e) {
    alert("Rename request failed: " + e.message);
    return false;
  }
}

function showModalCreateError(msg) {
  const errEl = dom.modalCreateWsError;
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = "block";
  } else {
    alert("Error: " + msg);
  }
}

function hideModalCreateError() {
  const errEl = dom.modalCreateWsError;
  if (errEl) {
    errEl.textContent = "";
    errEl.style.display = "none";
  }
}

export function renderModalWorkspaces(filterText = "") {
  const listEl = dom.modalWsList;
  if (!listEl) return;

  const countEl = dom.modalWsCount;
  const list = state.workspacesList || [];
  if (countEl) countEl.textContent = list.length;

  const query = (filterText || "").trim().toLowerCase();
  const filtered = query ? list.filter(w => w.toLowerCase().includes(query)) : list;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="ws-empty-list">
        ${query ? `No workspaces matching "${escapeHtml(query)}"` : "No workspaces found. Create one above."}
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(ws => {
    const isActive = (state.currentWorkspace === ws);
    const isEditing = (state.activeWorkspaceRename === ws);

    if (isEditing) {
      return `
        <div class="ws-item ws-item-editing ${isActive ? "active" : ""}" data-ws="${escapeHtml(ws)}">
          <div class="ws-item-edit-row">
            <span class="ws-item-icon">${getIconSvg("folder")}</span>
            <input type="text" class="modal-text-input ws-inline-rename-input" value="${escapeHtml(ws)}" data-old-ws="${escapeHtml(ws)}">
            <button class="btn-primary ws-rename-save-btn" data-action="save-rename" data-ws="${escapeHtml(ws)}" title="Save new name">
              ${getIconSvg("check")}
            </button>
            <button class="btn-icon ws-rename-cancel-btn" data-action="cancel-rename" data-ws="${escapeHtml(ws)}" title="Cancel">
              ${getIconSvg("close")}
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="ws-item ${isActive ? "active" : ""}" data-ws="${escapeHtml(ws)}">
        <div class="ws-item-left" data-action="select" data-ws="${escapeHtml(ws)}" title="Switch to ${escapeHtml(ws)}">
          <span class="ws-item-icon">${getIconSvg("folder")}</span>
          <span class="ws-item-name" title="${escapeHtml(ws)}">${escapeHtml(ws)}</span>
          ${isActive ? '<span class="ws-active-badge">Current</span>' : ''}
        </div>
        <div class="ws-item-actions">
          ${!isActive ? `
            <button class="ws-select-btn" data-action="select" data-ws="${escapeHtml(ws)}" title="Open workspace">
              ${getIconSvg("check")}<span>Select</span>
            </button>
          ` : ''}
          <button class="ws-rename-btn" data-action="rename" data-ws="${escapeHtml(ws)}" title="Rename workspace ${escapeHtml(ws)}">
            ${getIconSvg("edit")}
          </button>
          <button class="ws-delete-btn" data-action="delete" data-ws="${escapeHtml(ws)}" title="Delete workspace ${escapeHtml(ws)}">
            ${getIconSvg("trash")}
          </button>
        </div>
      </div>
    `;
  }).join("");

  if (state.activeWorkspaceRename) {
    const input = listEl.querySelector(".ws-inline-rename-input");
    if (input) {
      input.focus();
      input.select();
    }
  }
}

export function openWorkspaceModal() {
  const modal = dom.workspaceModal;
  if (!modal) return;

  hideModalCreateError();
  state.activeWorkspaceRename = null;
  if (dom.modalNewWsInput) dom.modalNewWsInput.value = "";
  if (dom.modalWsSearchInput) dom.modalWsSearchInput.value = "";

  renderModalWorkspaces();
  modal.style.display = "flex";

  setTimeout(() => {
    if (dom.modalWsSearchInput) {
      dom.modalWsSearchInput.focus();
    }
  }, 50);
}

export function closeWorkspaceModal() {
  const modal = dom.workspaceModal;
  if (!modal) return;
  modal.style.display = "none";
  state.activeWorkspaceRename = null;
  hideModalCreateError();
}

export function initWorkspaceModal() {
  // Triggers to open modal
  if (dom.btnOpenWsModal) {
    dom.btnOpenWsModal.addEventListener("click", openWorkspaceModal);
  }
  if (dom.workspaceCardTrigger) {
    dom.workspaceCardTrigger.addEventListener("click", openWorkspaceModal);
    dom.workspaceCardTrigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openWorkspaceModal();
      }
    });
  }

  // Close triggers
  if (dom.btnCloseWsModal) {
    dom.btnCloseWsModal.addEventListener("click", closeWorkspaceModal);
  }
  if (dom.btnDoneWsModal) {
    dom.btnDoneWsModal.addEventListener("click", closeWorkspaceModal);
  }
  if (dom.workspaceModal) {
    dom.workspaceModal.addEventListener("click", (e) => {
      if (e.target === dom.workspaceModal) {
        closeWorkspaceModal();
      }
    });
  }

  // Search filter
  if (dom.modalWsSearchInput) {
    dom.modalWsSearchInput.addEventListener("input", (e) => {
      renderModalWorkspaces(e.target.value);
    });
  }

  // Create workspace button and Enter key
  if (dom.modalBtnCreateWs) {
    dom.modalBtnCreateWs.addEventListener("click", () => createWorkspace());
  }
  if (dom.modalNewWsInput) {
    dom.modalNewWsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createWorkspace();
      }
    });
  }

  // Delegated events for select, rename and delete in modal workspace list
  if (dom.modalWsList) {
    dom.modalWsList.addEventListener("click", async (e) => {
      const renameBtn = e.target.closest('[data-action="rename"]');
      if (renameBtn) {
        e.stopPropagation();
        const wsName = renameBtn.dataset.ws;
        if (wsName) {
          state.activeWorkspaceRename = wsName;
          renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
        }
        return;
      }

      const saveRenameBtn = e.target.closest('[data-action="save-rename"]');
      if (saveRenameBtn) {
        e.stopPropagation();
        const oldWs = saveRenameBtn.dataset.ws;
        const row = saveRenameBtn.closest(".ws-item");
        const input = row ? row.querySelector(".ws-inline-rename-input") : null;
        if (oldWs && input) {
          await renameWorkspace(oldWs, input.value);
        }
        return;
      }

      const cancelRenameBtn = e.target.closest('[data-action="cancel-rename"]');
      if (cancelRenameBtn) {
        e.stopPropagation();
        state.activeWorkspaceRename = null;
        renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
        return;
      }

      const deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) {
        e.stopPropagation();
        const wsName = deleteBtn.dataset.ws;
        if (wsName) {
          await deleteWorkspace(wsName);
        }
        return;
      }

      const selectTarget = e.target.closest('[data-action="select"]');
      if (selectTarget) {
        e.stopPropagation();
        const wsName = selectTarget.dataset.ws;
        if (wsName) {
          selectWorkspace(wsName, false, "push");
          closeWorkspaceModal();
        }
      }
    });

    dom.modalWsList.addEventListener("keydown", async (e) => {
      if (e.target.classList.contains("ws-inline-rename-input")) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const oldWs = e.target.dataset.oldWs;
          if (oldWs) {
            await renameWorkspace(oldWs, e.target.value);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          state.activeWorkspaceRename = null;
          renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
        }
      }
    });
  }

  // Escape key to close modal
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dom.workspaceModal && dom.workspaceModal.style.display !== "none") {
      if (state.activeWorkspaceRename) {
        state.activeWorkspaceRename = null;
        renderModalWorkspaces(dom.modalWsSearchInput ? dom.modalWsSearchInput.value : "");
        return;
      }
      closeWorkspaceModal();
    }
  });
}

